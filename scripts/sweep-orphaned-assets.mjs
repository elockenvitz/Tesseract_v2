#!/usr/bin/env node
/**
 * Find (and optionally delete) objects in the `assets` bucket that no database
 * row points at.
 *
 * Orphans accumulate for ordinary reasons — an upload that succeeded while the
 * row insert failed, a row deleted by a path that predates cascade cleanup, a
 * note whose attachment was removed from the document. They are invisible in
 * the product and unreachable by any user, which is exactly what makes them a
 * problem: they are personal data we hold, cannot show anyone, and would not
 * think to include in a deletion request or a breach notification.
 *
 * Ownership sources are the same ones the org-scope backfill uses. Anything
 * not claimed by one of them is an orphan.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/sweep-orphaned-assets.mjs                 # report only
 *
 *   ... node scripts/sweep-orphaned-assets.mjs --delete      # actually delete
 *
 * Report-only is the default. --delete is irreversible: Supabase Storage has
 * no undelete, so run the report, read it, and keep the JSON before deleting.
 * A --min-age-days guard (default 7) keeps it from racing an upload that is
 * mid-flight in another tab.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const BUCKET = 'assets'
const DELETE = process.argv.includes('--delete')
const MIN_AGE_DAYS = Number(
  (process.argv.find(a => a.startsWith('--min-age-days=')) || '').split('=')[1] ?? 7
)
const REPORT = './orphaned-assets-report.json'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

/** Tables that own an object, and the column holding its path. */
const PATH_SOURCES = [
  ['asset_notes', 'file_path'],
  ['asset_models', 'file_path'],
  ['model_versions', 'file_path'],
  ['model_files', 'storage_path'],
  ['model_templates', 'base_template_path'],
  ['asset_checklist_attachments', 'file_path'],
  ['portfolio_checklist_attachments', 'file_path'],
]

/** Note tables whose ProseMirror content embeds fileAttachment filePath attrs. */
const NOTE_TABLES = ['asset_notes', 'portfolio_notes', 'theme_notes', 'custom_notebook_notes']

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

async function listObjects(prefix = '') {
  const out = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list(${prefix}): ${error.message}`)
    for (const e of data) {
      const full = prefix ? `${prefix}/${e.name}` : e.name
      if (e.id === null) out.push(...(await listObjects(full)))
      else out.push({ name: full, created_at: e.created_at, size: e.metadata?.size ?? 0 })
    }
    if (data.length < PAGE) break
  }
  return out
}

function collectPaths(node, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) { for (const n of node) collectPaths(n, acc); return acc }
  if (node.attrs?.filePath) acc.push(node.attrs.filePath)
  if (node.content) collectPaths(node.content, acc)
  return acc
}

async function main() {
  console.log(`${DELETE ? 'DELETE' : 'REPORT'} mode — bucket "${BUCKET}", min age ${MIN_AGE_DAYS}d\n`)

  const objects = await listObjects()
  const referenced = new Set()
  const unreadable = []

  for (const [table, col] of PATH_SOURCES) {
    const { rows, error } = await selectAll(table, col)
    if (error) { unreadable.push(`${table}.${col}: ${error.message}`); continue }
    for (const r of rows) if (r[col]) referenced.add(r[col])
  }

  for (const table of NOTE_TABLES) {
    const { rows, error } = await selectAll(table, 'id, content')
    if (error) { unreadable.push(`${table}.content: ${error.message}`); continue }
    for (const r of rows) {
      let doc = r.content
      if (typeof doc === 'string') { try { doc = JSON.parse(doc) } catch { continue } }
      for (const p of collectPaths(doc)) referenced.add(p)
    }
  }

  // A source we could not read makes every object it owns look orphaned.
  // Deleting on that basis would destroy live files, so refuse outright.
  if (unreadable.length) {
    console.log('!! could not read these ownership sources:')
    for (const u of unreadable) console.log(`   ${u}`)
    if (DELETE) {
      console.log('\nRefusing to delete: objects owned by an unreadable source are')
      console.log('indistinguishable from orphans. Fix the query first.')
      process.exit(2)
    }
  }

  const cutoff = Date.now() - MIN_AGE_DAYS * 86_400_000
  const orphans = objects.filter(o => !referenced.has(o.name))
  const deletable = orphans.filter(o => new Date(o.created_at).getTime() < cutoff)
  const tooNew = orphans.length - deletable.length

  console.log(`objects            ${objects.length}`)
  console.log(`referenced by a row${String(referenced.size).padStart(4)}`)
  console.log(`orphans            ${orphans.length}${tooNew ? `  (${tooNew} newer than ${MIN_AGE_DAYS}d, held back)` : ''}`)
  const bytes = deletable.reduce((n, o) => n + Number(o.size || 0), 0)
  if (deletable.length) console.log(`reclaimable        ${(bytes / 1024).toFixed(1)} kB`)

  writeFileSync(REPORT, JSON.stringify({ generatedFor: url, unreadable, orphans, deletable }, null, 2))
  console.log(`\nreport: ${REPORT}`)

  if (!DELETE) {
    if (deletable.length) console.log('\nReport only — re-run with --delete to remove them.')
    return
  }
  if (!deletable.length) { console.log('\nNothing to delete.'); return }

  for (let i = 0; i < deletable.length; i += 100) {
    const batch = deletable.slice(i, i + 100).map(o => o.name)
    const { error } = await db.storage.from(BUCKET).remove(batch)
    console.log(error ? `batch failed: ${error.message}` : `deleted ${batch.length}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
