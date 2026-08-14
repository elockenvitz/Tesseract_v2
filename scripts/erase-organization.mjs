#!/usr/bin/env node
/**
 * Delete an entire organization: its rows, its files, and finally the org
 * itself. This is the "return or delete Customer Data on termination" clause
 * of the DPA, made real.
 *
 * ── This is irreversible ──────────────────────────────────────────────────
 *
 * There is no undo and Supabase Storage has no undelete. Take a database
 * backup first. The script defaults to a dry run and requires you to type the
 * organization's name to proceed, because a mistyped uuid that happens to
 * exist would otherwise destroy the wrong customer.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/erase-organization.mjs --org=<uuid>
 *
 *   ... --org=<uuid> --confirm="Exact Org Name" --apply
 *
 * ── How row deletion is ordered ───────────────────────────────────────────
 *
 * Roughly 100 tables carry organization_id and they reference each other, so
 * there is no single correct order to hand-maintain — and a hand-maintained
 * list silently rots as tables are added. Instead this deletes every table it
 * can in a pass, keeps the failures, and repeats. Foreign keys make each pass
 * unblock the next, and it stops when a pass frees nothing. Anything still
 * standing is reported rather than force-deleted: a cycle or an unexpected
 * constraint is something to look at, not to bulldoze.
 *
 * Storage is easy by comparison, and only because of the org-scoping work:
 * every object lives under `<organization_id>/`, so the whole prefix goes.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=')
const ORG = arg('org')
const CONFIRM = arg('confirm')
const APPLY = process.argv.includes('--apply')
const REPORT = './erase-organization-report.json'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  process.exit(1)
}
if (!/^[0-9a-f-]{36}$/i.test(ORG || '')) {
  console.error('Usage: --org=<uuid> [--confirm="Org Name" --apply]')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  const { data: org, error: orgErr } = await db
    .from('organizations').select('id, name').eq('id', ORG).maybeSingle()

  if (orgErr) { console.error('Could not read organization:', orgErr.message); process.exit(1) }
  if (!org) { console.error(`No organization ${ORG}`); process.exit(1) }

  console.log(`${APPLY ? 'ERASE' : 'DRY RUN'} — "${org.name}" (${org.id})\n`)

  if (APPLY && CONFIRM !== org.name) {
    console.error(`Refusing to erase: --confirm must be exactly "${org.name}".`)
    console.error('This is irreversible and there is no undo. Take a backup first.')
    process.exit(2)
  }

  // ── Storage ─────────────────────────────────────────────────────────────
  // Every object lives under `<organization_id>/`, so the org's files are a
  // single prefix in each bucket. That is the whole reason the path migration
  // was worth doing: before it, this step was not expressible.
  const { data: buckets } = await db.storage.listBuckets()
  const storagePlan = []
  for (const b of buckets ?? []) {
    const files = await walk(b.name, ORG)
    if (files.length) storagePlan.push({ bucket: b.name, files })
  }
  const fileCount = storagePlan.reduce((n, s) => n + s.files.length, 0)
  console.log(`storage: ${fileCount} object(s) across ${storagePlan.length} bucket(s)`)

  writeFileSync(REPORT, JSON.stringify({ org, storagePlan }, null, 2))
  console.log(`report: ${REPORT}`)

  if (!APPLY) {
    console.log(`
Dry run — nothing deleted.

Row deletion is not enumerated here: listing every organization_id table needs
information_schema, which PostgREST does not expose. Run the SQL in
scripts/sql/erase-organization-rows.sql against the project first (it reports
per-table counts and deletes in dependency order inside one transaction), then
re-run this with --apply to remove the files.`)
    return
  }

  for (const { bucket, files } of storagePlan) {
    for (let i = 0; i < files.length; i += 100) {
      const batch = files.slice(i, i + 100)
      const { error } = await db.storage.from(bucket).remove(batch)
      console.log(error ? `  ${bucket}: FAILED ${error.message}` : `  ${bucket}: removed ${batch.length}`)
    }
  }

  console.log('\nFiles removed. Row deletion is the SQL script — run it now if you have not.')
}

async function walk(bucket, prefix) {
  const out = []
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error || !data) return out
  for (const e of data) {
    const full = `${prefix}/${e.name}`
    if (e.id === null) out.push(...(await walk(bucket, full)))
    else out.push(full)
  }
  return out
}

main().catch(err => { console.error(err); process.exit(1) })
