#!/usr/bin/env node
/**
 * Phase 2 of org-scoping the `assets` storage bucket.
 *
 * Moves existing objects under an `<organization_id>/` prefix and rewrites
 * the database rows that point at them, so the Phase 3 policy
 * (`(storage.foldername(name))[1] = current_org_id()`) can be applied
 * without cutting anyone off from their own files.
 *
 * ─── Read this before running ────────────────────────────────────────────
 *
 * Not every object can be attributed to an org. Two sources cannot be
 * resolved from the schema as it stands:
 *
 *   asset_models / model_versions
 *     asset_models has no organization_id — only created_by and asset_id
 *     (20251230000002_add_notes_models_section.sql). Its RLS is user
 *     ownership. `assets` is the global security master, so asset_id carries
 *     no tenant either. The creator's *current* org is not the same fact as
 *     the org they uploaded in, and for a multi-org user it can be a
 *     different org entirely.
 *
 *   asset_notes rows predating 20260603140000_notes_organization_id.sql
 *     That migration added organization_id and states plainly that these
 *     rows have "no reconstructable origin org" and stay NULL.
 *
 * Guessing here is worse than not moving the file: filing Firm A's model
 * under Firm B's prefix hands it to Firm B under the new policy. So this
 * script never guesses. Unattributable objects are reported and left alone,
 * and deciding what happens to them is a separate, human call — see the
 * summary it prints.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backfill-assets-bucket-org-scope.mjs            # dry run
 *
 *   ... node scripts/backfill-assets-bucket-org-scope.mjs --apply  # execute
 *
 * Dry run is the default and touches nothing. Run it against staging first,
 * read the report, and only then consider --apply. A full report lands in
 * ./assets-backfill-report.json either way.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const BUCKET = 'assets'
const APPLY = process.argv.includes('--apply')
const REPORT_PATH = './assets-backfill-report.json'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

/**
 * Sources of truth for "which object belongs to which org".
 *
 * `resolvable: false` entries are listed deliberately rather than omitted —
 * their objects must be *recognised* so they can be reported as
 * unattributable instead of silently falling into the orphan bucket, which
 * would misrepresent a schema gap as abandoned data.
 */
const SOURCES = [
  {
    table: 'asset_notes',
    pathColumn: 'file_path',
    orgColumn: 'organization_id',
    resolvable: true,
    note: 'rows predating the notes org migration have organization_id = NULL',
  },
  {
    table: 'model_templates',
    pathColumn: 'base_template_path',
    orgColumn: 'organization_id',
    resolvable: true,
  },
  {
    table: 'asset_checklist_attachments',
    pathColumn: 'file_path',
    // Org arrives through asset_checklist_items → workflows.organization_id.
    // Resolved by RPC-free join below rather than a direct column.
    orgVia: {
      select: 'file_path, asset_checklist_items!inner(workflows!inner(organization_id))',
      pick: r => r?.asset_checklist_items?.workflows?.organization_id ?? null,
    },
    resolvable: true,
  },
  {
    table: 'portfolio_checklist_attachments',
    pathColumn: 'file_path',
    orgVia: {
      select: 'file_path, portfolio_checklist_items!inner(workflows!inner(organization_id))',
      pick: r => r?.portfolio_checklist_items?.workflows?.organization_id ?? null,
    },
    resolvable: true,
  },
  {
    table: 'asset_models',
    pathColumn: 'file_path',
    resolvable: false,
    reason: 'asset_models has no organization_id; RLS is user ownership',
  },
  {
    table: 'model_versions',
    pathColumn: 'file_path',
    resolvable: false,
    reason: 'inherits asset_models, which has no organization_id',
  },
]

/** Note tables whose ProseMirror content embeds fileAttachment filePath attrs. */
const NOTE_CONTENT_TABLES = [
  { table: 'asset_notes', orgColumn: 'organization_id' },
  { table: 'portfolio_notes', orgColumn: 'organization_id' },
  { table: 'theme_notes', orgColumn: 'organization_id' },
  { table: 'custom_notebook_notes', orgColumn: 'organization_id' },
]

const isScoped = p => UUID_RE.test(String(p).split('/')[0])

async function selectAll(table, select) {
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(select).range(from, from + PAGE - 1)
    if (error) return { rows: null, error }
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return { rows, error: null }
}

/** Every object currently in the bucket, recursively. */
async function listObjects(prefix = '') {
  const out = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list(${prefix}): ${error.message}`)
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name
      // Supabase represents folders as rows with a null id.
      if (entry.id === null) out.push(...(await listObjects(full)))
      else out.push(full)
    }
    if (data.length < PAGE) break
  }
  return out
}

/** path -> { org, table, column, resolvable, reason } */
async function buildOwnershipIndex() {
  const index = new Map()
  const skipped = []

  for (const src of SOURCES) {
    const select = src.orgVia
      ? src.orgVia.select
      : `${src.pathColumn}${src.orgColumn ? `, ${src.orgColumn}` : ''}`

    const { rows, error } = await selectAll(src.table, select)
    if (error) {
      // A missing table or column is reported, never swallowed: an
      // unqueried source shows up as orphaned objects, and orphans look
      // like safe-to-ignore junk.
      skipped.push({ table: src.table, error: error.message })
      continue
    }

    for (const row of rows) {
      const path = row[src.pathColumn]
      if (!path) continue
      const org = src.orgVia ? src.orgVia.pick(row) : row[src.orgColumn] ?? null
      index.set(path, {
        org: src.resolvable ? org : null,
        table: src.table,
        column: src.pathColumn,
        resolvable: Boolean(src.resolvable && org),
        reason: src.resolvable
          ? org ? null : (src.note ?? 'row has no organization_id')
          : src.reason,
      })
    }
  }

  return { index, skipped }
}

/** Walk a ProseMirror doc collecting fileAttachment filePath attributes. */
function collectAttachmentPaths(node, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const n of node) collectAttachmentPaths(n, acc)
    return acc
  }
  if (node.attrs?.filePath) acc.push(node.attrs.filePath)
  if (node.content) collectAttachmentPaths(node.content, acc)
  return acc
}

async function indexNoteAttachments(index, skipped) {
  for (const { table, orgColumn } of NOTE_CONTENT_TABLES) {
    const { rows, error } = await selectAll(table, `id, content, ${orgColumn}`)
    if (error) {
      skipped.push({ table: `${table} (content scan)`, error: error.message })
      continue
    }
    for (const row of rows) {
      let doc = row.content
      if (typeof doc === 'string') {
        try { doc = JSON.parse(doc) } catch { continue }
      }
      for (const path of collectAttachmentPaths(doc)) {
        if (index.has(path)) continue
        const org = row[orgColumn] ?? null
        index.set(path, {
          org,
          table,
          column: 'content(json)',
          noteId: row.id,
          resolvable: Boolean(org),
          reason: org ? null : 'note has no organization_id',
        })
      }
    }
  }
}

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — bucket "${BUCKET}"\n`)

  const objects = await listObjects()
  console.log(`objects in bucket: ${objects.length}`)

  const { index, skipped } = await buildOwnershipIndex()
  await indexNoteAttachments(index, skipped)
  console.log(`database rows referencing a path: ${index.size}`)

  if (skipped.length) {
    console.log('\n!! sources that could not be read — results are INCOMPLETE:')
    for (const s of skipped) console.log(`   ${s.table}: ${s.error}`)
  }

  const buckets = { alreadyScoped: [], resolved: [], unattributable: [], orphan: [] }

  for (const path of objects) {
    if (isScoped(path) && index.get(path)?.resolvable !== false) {
      // Ambiguous by shape for legacy checklist evidence (<assetId>/…), so
      // trust the index when it disagrees.
      const owner = index.get(path)
      if (!owner || owner.org === path.split('/')[0]) {
        buckets.alreadyScoped.push(path)
        continue
      }
    }
    const owner = index.get(path)
    if (!owner) { buckets.orphan.push(path); continue }
    if (!owner.resolvable) {
      buckets.unattributable.push({ path, table: owner.table, reason: owner.reason })
      continue
    }
    buckets.resolved.push({ path, to: `${owner.org}/${path}`, ...owner })
  }

  console.log(`
  already scoped   ${buckets.alreadyScoped.length}
  resolvable       ${buckets.resolved.length}
  UNATTRIBUTABLE   ${buckets.unattributable.length}   <- needs a human decision
  orphan           ${buckets.orphan.length}   <- object with no DB row
`)

  const byReason = {}
  for (const u of buckets.unattributable) {
    const k = `${u.table}: ${u.reason}`
    byReason[k] = (byReason[k] || 0) + 1
  }
  if (Object.keys(byReason).length) {
    console.log('unattributable breakdown:')
    for (const [k, n] of Object.entries(byReason)) console.log(`  ${n.toString().padStart(5)}  ${k}`)
  }

  writeFileSync(REPORT_PATH, JSON.stringify({ generatedFor: url, skipped, ...buckets }, null, 2))
  console.log(`\nfull report: ${REPORT_PATH}`)

  if (!APPLY) {
    console.log('\nDry run — nothing moved. Re-run with --apply once the report looks right.')
    return
  }

  if (buckets.unattributable.length > 0) {
    console.log(`
Refusing to apply: ${buckets.unattributable.length} objects cannot be attributed
to an org. Moving only the resolvable ones would leave the rest on legacy
paths, and the Phase 3 policy denies those — so applying now silently
strands them. Decide what happens to the unattributable set first.`)
    process.exit(2)
  }

  let moved = 0, failed = 0
  for (const item of buckets.resolved) {
    const { error: moveErr } = await db.storage.from(BUCKET).move(item.path, item.to)
    if (moveErr) { console.error(`move failed ${item.path}: ${moveErr.message}`); failed++; continue }

    if (item.column === 'content(json)') {
      console.error(`  ! ${item.path} lives in ${item.table}.content — rewrite the note JSON separately`)
      failed++
      continue
    }
    const { error: updErr } = await db
      .from(item.table).update({ [item.column]: item.to }).eq(item.column, item.path)
    if (updErr) {
      console.error(`row update failed ${item.path}: ${updErr.message} — rolling the object back`)
      await db.storage.from(BUCKET).move(item.to, item.path)
      failed++
      continue
    }
    moved++
  }
  console.log(`\nmoved ${moved}, failed ${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
