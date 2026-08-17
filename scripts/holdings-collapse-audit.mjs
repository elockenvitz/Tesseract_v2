#!/usr/bin/env node
/**
 * Enumerates every query over `portfolio_holdings` and classifies it.
 *
 * `portfolio_holdings` is a series of DATED SNAPSHOTS, not a position list.
 * Reading it without constraining the date treats every historical snapshot as
 * a current position — the distinct-vs-current collapse.
 *
 * It corrupted production silently: `usePortfolioLenses` summed value across all
 * dates for its denominator, inflating each portfolio's total by its number of
 * snapshot dates (measured at 36x). Every weight was up to 36x too small, and
 * because MIN_WEIGHT_PCT rejects anything under 0.5%, the conviction cards
 * emitted nothing rather than something visibly wrong.
 *
 * Not every site is wrong. A query that only needs the SET of names a portfolio
 * has ever held — "which portfolios hold this?" — is unaffected by duplicates.
 * The dangerous ones are those that sum, average, or compute a denominator.
 *
 * This prints the classification so the class can be closed by inspection
 * rather than estimated.
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

/** Constrains the snapshot date in the query or immediately after it. */
const DATED = /\.eq\('date'|\.gte\('date'|\.lte\('date'|\.order\('date'|max\(date\)|latestDate|latest_date/

/** Sums, averages, or builds a denominator from the rows. */
const AGGREGATES = /reduce\(|totals?\b|weightPct|weight_pct|\/\s*total|percent|\*\s*100\b/

const sites = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const re = /\.from\('portfolio_holdings'\)/g
  let m
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length
    const block = src.slice(m.index, m.index + 2500)
    sites.push({ file: f, line, dated: DATED.test(block), aggregates: AGGREGATES.test(block) })
  }
}

const agg = sites.filter(s => s.aggregates)
const risky = agg.filter(s => !s.dated)

console.log(`portfolio_holdings query sites : ${sites.length}`)
console.log(`  aggregating                  : ${agg.length}`)
console.log(`  aggregating WITHOUT a date   : ${risky.length}   <-- must be checked by hand`)
console.log(`  non-aggregating (excluded)   : ${sites.length - agg.length}`)

console.log('\nAGGREGATING SITES:')
for (const s of agg.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(`  ${s.dated ? 'DATED  ' : 'NO-DATE'}  ${s.file}:${s.line}`)
}
