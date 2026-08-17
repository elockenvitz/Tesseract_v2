#!/usr/bin/env node
/**
 * Ratchet: no NEW aggregating query over `portfolio_holdings` without a date
 * constraint or the shared helper.
 *
 * `portfolio_holdings` is a series of dated snapshots, not a position list.
 * Summing it without constraining the date treats every historical snapshot as
 * a current position.
 *
 * That corrupted production silently. `usePortfolioLenses` inflated each
 * portfolio's denominator by its number of snapshot dates — 36x on Tech &
 * Consumer Growth, 27x on Vision Fund 10K — so every weight came out up to 36
 * times too small, and because MIN_WEIGHT_PCT rejects anything under 0.5% the
 * conviction cards emitted NOTHING rather than something visibly wrong.
 *
 * An audit found 22 of 27 aggregating sites had no date constraint — the defect
 * was the norm rather than the outlier. All of them are now migrated, so the
 * allowlist below is empty and adding to it is a regression.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['src', 'supabase/functions']
const files = []
const walk = (dir) => {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (e === 'node_modules') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e)) files.push(p.split('\\').join('/'))
  }
}
roots.forEach(walk)

/** Constrains the snapshot date, or defers to the shared helper. */
/**
 * Constrains the date, defers to the shared helper, or is explicitly marked
 * reviewed-and-safe. The marker is for queries that build a SET rather than a
 * sum — duplicates across snapshots cannot change a set — and it must carry a
 * reason on the line, so a future reader can check the claim rather than trust
 * the comment.
 */
const SAFE = /\.eq\('date'|\.gte\('date'|\.lte\('date'|\.order\('date'|max\(date\)|latestSnapshotRows|holdings-audit: safe/

/** Sums, averages, or builds a denominator from the rows. */
const AGGREGATES = /reduce\(|totals?\b|weightPct|weight_pct|\/\s*total|percent|\*\s*100\b/

/**
 * Sites known to aggregate without a date constraint, awaiting migration to
 * latestSnapshotRows. MAY ONLY SHRINK. Adding an entry is a regression and
 * should be rejected in review, not appended to.
 */
/**
 * EMPTY, and it must stay that way.
 *
 * All 21 sites have been migrated to latestSnapshotRows(), or — in one case —
 * reviewed and marked `holdings-audit: safe` because it builds a Set rather
 * than a sum. Adding an entry here is a regression, not a workaround.
 */
const NOT_YET_MIGRATED = new Set([])

const sites = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const re = /\.from\('portfolio_holdings'\)/g
  let m
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length
    const block = src.slice(m.index, m.index + 2500)
    sites.push({ id: `${f}:${line}`, safe: SAFE.test(block), aggregates: AGGREGATES.test(block) })
  }
}

const agg = sites.filter(s => s.aggregates)
const unsafe = agg.filter(s => !s.safe)
const unlisted = unsafe.filter(s => !NOT_YET_MIGRATED.has(s.id))
const stale = [...NOT_YET_MIGRATED].filter(id => !unsafe.some(s => s.id === id))

console.log(`portfolio_holdings query sites : ${sites.length}`)
console.log(`  aggregating                  : ${agg.length}`)
console.log(`  aggregating without a date   : ${unsafe.length}`)
console.log(`  awaiting migration (allowed) : ${NOT_YET_MIGRATED.size}`)

if (process.argv.includes('--list')) {
  console.log('\nUNSAFE SITES (aggregating, no date constraint):')
  unsafe.forEach(s => console.log(`  ${s.id}`))
}

if (unlisted.length) {
  console.error(`\nFAIL: ${unlisted.length} NEW aggregating query/queries with no date constraint:`)
  unlisted.forEach(s => console.error('  ' + s.id))
  console.error('\nUse latestSnapshotRows() from src/lib/holdings/latest-snapshot.ts.')
  console.error('portfolio_holdings is a series of dated snapshots; summing it')
  console.error('without a date multiplies every total by the number of dates.')
  process.exit(1)
}

if (stale.length) {
  console.error(`\nFAIL: ${stale.length} allowlist entry/entries no longer match a site.`)
  console.error('Migrated or moved — remove them so the list keeps meaning something:')
  stale.forEach(id => console.error('  ' + id))
  process.exit(1)
}

console.log('PASS')
