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
 * An audit found 22 of 27 aggregating sites had no date constraint. The defect
 * was the norm. One has been fixed; the rest are listed below and MUST ONLY
 * SHRINK.
 *
 * The allowlist is the honest form of "not yet migrated". It is not an
 * exemption: every entry is a site that will silently inflate the moment its
 * portfolio has more than one snapshot date, which the seeded tenant will
 * deliberately produce.
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
const SAFE = /\.eq\('date'|\.gte\('date'|\.lte\('date'|\.order\('date'|max\(date\)|latestSnapshotRows/

/** Sums, averages, or builds a denominator from the rows. */
const AGGREGATES = /reduce\(|totals?\b|weightPct|weight_pct|\/\s*total|percent|\*\s*100\b/

/**
 * Sites known to aggregate without a date constraint, awaiting migration to
 * latestSnapshotRows. MAY ONLY SHRINK. Adding an entry is a regression and
 * should be rejected in review, not appended to.
 */
const NOT_YET_MIGRATED = new Set([
  'src/components/tabs/AssetTab.tsx:982',
  'src/components/tabs/AssetTab.tsx:1009',
  'src/components/thoughts/QuickTradeIdeaCapture.tsx:414',
  'src/components/thoughts/QuickTradeIdeaCapture.tsx:433',
  'src/components/thoughts/QuickTradeIdeaCapture.tsx:442',
  'src/components/trading/AddTradeIdeaModal.tsx:197',
  'src/components/trading/AddTradeIdeaModal.tsx:216',
  'src/components/trading/AddTradeIdeaModal.tsx:225',
  'src/components/trading/AddTradeIdeaModal.tsx:487',
  'src/components/trading/CreateSimulationModal.tsx:85',
  'src/components/trading/TradeIdeaDetailModal.tsx:458',
  'src/components/trading/TradeIdeaDetailModal.tsx:468',
  'src/components/trading/TradeIdeaDetailModal.tsx:855',
  'src/components/trading/TradeIdeaDetailModal.tsx:864',
  'src/components/trading/TradeIdeaDetailModal.tsx:912',
  'src/components/trading/TradeIdeaDetailModal.tsx:921',
  'src/hooks/ideas/useIdeasFeed.ts:109',
  'src/pages/SimulationPage.tsx:837',
  'src/pages/SimulationPage.tsx:1650',
  'src/pages/SimulationPage.tsx:2726',
  'src/pages/TradeQueuePage.tsx:1377',
])

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
