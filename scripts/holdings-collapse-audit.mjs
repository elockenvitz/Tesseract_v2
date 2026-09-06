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
/**
 * ── Two correct implementations, not one ──────────────────────────────────
 *
 * The Desktop lane arrived with its own reduction in `lib/portfolio/holdings`:
 * `currentRows()` keeps the newest row per (portfolio, asset), and `buildBook`,
 * `weightsByAsset` and `largestWeightByAsset` all run it BEFORE they sum
 * anything. Nine sites route through those four names and were being reported
 * as unsafe purely because this pattern had never heard of them -- the guard
 * was measuring a spelling, not the property it exists to protect.
 *
 * Recognising them is a correction, not an exemption. The property each one
 * guarantees is pinned by `src/lib/portfolio/holdings-parity.test.ts`, so a
 * future edit that removed the reduction fails a test rather than quietly
 * turning this pattern into a rubber stamp.
 *
 * They are NOT interchangeable with `latestSnapshotRows` and this guard does
 * not claim they are: that one keeps a portfolio's newest snapshot DATE, so a
 * position absent from the latest upload disappears, while `currentRows` keeps
 * the newest row per asset, so it survives. Both satisfy the invariant this
 * ratchet enforces -- each holding counted ONCE -- which is what is being
 * checked here. The difference is recorded in the release ledger.
 */
const SAFE = /\.eq\('date'|\.gte\('date'|\.lte\('date'|\.order\('date'|max\(date\)|latestSnapshotRows|currentRows|buildBook|weightsByAsset|largestWeightByAsset|holdings-audit: safe/

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

/**
 * The same class, one table over — and this half is a PREDICTION rather than a
 * post-mortem.
 *
 * `portfolio_benchmark_weights` carries an `as_of_date` and a snapshot FK, but
 * `UNIQUE (portfolio_id, asset_id)` currently permits exactly one date. Every
 * read is therefore accidentally correct, and the day that constraint is
 * relaxed for historical active weights — see
 * docs/tickets/portfolio-time-series-ingestion.md — every unfiltered read
 * starts merging index files across dates.
 *
 * This ratchet exists BEFORE the migration on purpose. Both previous times
 * this class of defect reached production, the guard was written afterwards.
 *
 * EVERY read counts here, not only aggregating ones: a benchmark weight is
 * looked up per asset far more often than it is summed, and picking the wrong
 * date returns a stale index weight rather than an obvious zero. One site used
 * `.maybeSingle()`, which ERRORS on multiple rows into a catch that returns
 * null — every asset would have read as off-benchmark with nothing logged.
 */
const BENCH_SAFE = /latestBenchmarkRows|\.eq\('as_of_date'|\.order\('as_of_date'|max\(as_of_date\)|benchmark-audit: safe/

const benchSites = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const re = /\.from\('portfolio_benchmark_weights'\)/g
  let m
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length
    // Wider window than the holdings check: several of these build their map
    // in a callback well below the select.
    const block = src.slice(m.index, m.index + 3000)
    benchSites.push({ id: `${f}:${line}`, safe: BENCH_SAFE.test(block) })
  }
}
const benchUnsafe = benchSites.filter(s => !s.safe)

/**
 * ── The half that ran in SQL, unwatched ───────────────────────────────────
 *
 * Everything above walks `.ts` and `.tsx`. `position_chart_payload` — a
 * SECURITY INVOKER RPC read by the position lifecycle chart and the Decision
 * Accountability page — carried the identical defect in plpgsql for the life
 * of this guard:
 *
 *   SELECT ... FROM portfolio_holdings ph
 *   WHERE ph.portfolio_id = ? ORDER BY ph.date DESC LIMIT 1   -- numerator
 *
 *   SELECT SUM(ph.shares * ph.price) FROM portfolio_holdings ph
 *   WHERE ph.portfolio_id = ?                                 -- denominator
 *
 * A newest-row numerator over an every-date denominator. Measured 2026-09-06:
 * Vision Fund 10K reported $199,462,674 of AUM against a real $101,461,674.
 * The guard reported PASS on every run, because the query is not in a file it
 * had ever opened. Moving a query into a function was, until now, a way out
 * of this check.
 *
 * ── Why only the LAST definition of each function counts ──────────────────
 *
 * Migrations are an append-only ledger, so the same function name is defined
 * many times across the tree and every superseded body is still on disk.
 * Checking all of them would fail on history that is not running anywhere and
 * cannot be edited. Files are read in path order — migrations are timestamp
 * prefixed, so lexical order is chronological — and each function name keeps
 * only its final body. That is what production is executing, which is the
 * thing worth checking.
 *
 * ── What counts as aggregating here ───────────────────────────────────────
 *
 * SUM and AVG only. `count(*)` over holdings answers "does this book hold
 * anything", and duplicates across dates cannot change that from zero to
 * non-zero — `can_discard_portfolio` does exactly this and is not a defect.
 * An INSERT ... SELECT is not a read and is not reported either.
 */
const sqlFiles = []
const walkSql = (dir) => {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries.sort()) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkSql(p)
    else if (e.endsWith('.sql')) sqlFiles.push(p.split('\\').join('/'))
  }
}
walkSql('supabase/migrations')
walkSql('supabase/functions')

/**
 * The body of every `CREATE [OR REPLACE] FUNCTION`, keyed by function name.
 *
 * Dollar-quoted bodies are matched by their own opening tag rather than by a
 * fixed `$$`, because this tree uses `$function$`, `$cron$` and bare `$$` in
 * different places and a fixed tag would silently truncate a body — which
 * would read as "no unsafe query found", the exact failure this guard is
 * supposed to be immune to.
 */
const finalFunctionBody = new Map()
const definedIn = new Map()
for (const f of sqlFiles) {
  const src = readFileSync(f, 'utf8')
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi
  let m
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase()
    const rest = src.slice(m.index)
    const tag = rest.match(/\$([a-z0-9_]*)\$/i)
    if (!tag) continue
    const open = rest.indexOf(tag[0]) + tag[0].length
    const close = rest.indexOf(tag[0], open)
    if (close === -1) continue
    finalFunctionBody.set(name, rest.slice(open, close))
    definedIn.set(name, f)
  }
}

/** A SUM or AVG. `count(*)` builds a set answer and is deliberately excluded. */
const SQL_AGGREGATES = /\b(sum|avg)\s*\(/i
/** Constrains the date, reduces to one row per asset, or is marked reviewed. */
const SQL_SAFE = /distinct\s+on|order\s+by[^;]{0,160}\bdate\b|\bdate\s*=|max\s*\(\s*[a-z_.]*date\s*\)|holdings-audit:\s*safe/i
const SQL_BENCH_SAFE = /distinct\s+on|order\s+by[^;]{0,160}as_of_date|\bas_of_date\s*=|max\s*\(\s*[a-z_.]*as_of_date\s*\)|benchmark-audit:\s*safe/i

const sqlSites = []
for (const [name, body] of finalFunctionBody) {
  for (const [table, aggRe, safeRe] of [
    ['portfolio_holdings', SQL_AGGREGATES, SQL_SAFE],
    ['portfolio_benchmark_weights', SQL_AGGREGATES, SQL_BENCH_SAFE],
  ]) {
    // `\b` after the name would match portfolio_holdings_positions too, so the
    // next character has to be something other than a name character.
    const re = new RegExp(`\\b(from|join)\\s+${table}(?![a-z0-9_])`, 'gi')
    let m
    while ((m = re.exec(body))) {
      // The aggregate sits BEFORE the FROM in SQL and the date constraint
      // after it, so the window has to reach in both directions.
      const window = body.slice(Math.max(0, m.index - 700), m.index + 700)
      // INSERT ... SELECT is a write, not a book number.
      if (/insert\s+into[\s\S]{0,200}$/i.test(body.slice(Math.max(0, m.index - 700), m.index))) continue
      const line = body.slice(0, m.index).split('\n').length
      sqlSites.push({
        id: `${definedIn.get(name)} :: ${name}() +${line} (${table})`,
        table,
        aggregates: aggRe.test(window),
        safe: safeRe.test(window),
      })
    }
  }
}

const sqlUnsafe = sqlSites.filter(s => s.aggregates && !s.safe)

/**
 * An empty result must not read as a pass.
 *
 * If the function extractor stops matching — a dollar-quote style this parser
 * does not know, a directory that moved — every count above drops to zero and
 * the guard reports PASS while checking nothing. These floors are well under
 * the current tree (dozens of functions across hundreds of migration files)
 * and exist only to catch a scanner that has gone blind.
 */
const SQL_FLOOR_FILES = 100
const SQL_FLOOR_FUNCTIONS = 20

const agg = sites.filter(s => s.aggregates)
const unsafe = agg.filter(s => !s.safe)
const unlisted = unsafe.filter(s => !NOT_YET_MIGRATED.has(s.id))
const stale = [...NOT_YET_MIGRATED].filter(id => !unsafe.some(s => s.id === id))

console.log(`portfolio_holdings query sites : ${sites.length}`)
console.log(`  aggregating                  : ${agg.length}`)
console.log(`  aggregating without a date   : ${unsafe.length}`)
console.log(`  awaiting migration (allowed) : ${NOT_YET_MIGRATED.size}`)
console.log(`benchmark weight query sites   : ${benchSites.length}`)
console.log(`  without a date rule          : ${benchUnsafe.length}`)
console.log(`SQL files scanned              : ${sqlFiles.length}`)
console.log(`  functions (final definition) : ${finalFunctionBody.size}`)
console.log(`  holdings reads in SQL        : ${sqlSites.length}`)
console.log(`  aggregating without a date   : ${sqlUnsafe.length}`)

if (process.argv.includes('--list')) {
  console.log('\nUNSAFE SITES (aggregating, no date constraint):')
  unsafe.forEach(s => console.log(`  ${s.id}`))
  console.log('\nSQL SITES:')
  sqlSites.forEach(s => console.log(`  ${s.safe ? 'safe  ' : 'UNSAFE'} ${s.aggregates ? 'agg ' : '    '} ${s.id}`))
}

if (sqlFiles.length < SQL_FLOOR_FILES || finalFunctionBody.size < SQL_FLOOR_FUNCTIONS) {
  console.error(`\nFAIL: the SQL scanner found ${sqlFiles.length} file(s) and ${finalFunctionBody.size} function(s).`)
  console.error('That is below the floor, so it is not reading the tree — a PASS here would')
  console.error('mean nothing. Check the migration path and the dollar-quote parser.')
  process.exit(1)
}

if (sqlUnsafe.length) {
  console.error(`\nFAIL: ${sqlUnsafe.length} SQL function(s) aggregating a dated holdings table with no date rule:`)
  sqlUnsafe.forEach(s => console.error('  ' + s.id))
  console.error('\nReduce to the current book before summing — DISTINCT ON (asset_id)')
  console.error('ORDER BY asset_id, date DESC is the SQL form of currentRows(). Summing')
  console.error('every dated row counts each superseded snapshot as another position.')
  process.exit(1)
}

if (unlisted.length) {
  console.error(`\nFAIL: ${unlisted.length} NEW aggregating query/queries with no date constraint:`)
  unlisted.forEach(s => console.error('  ' + s.id))
  console.error('\nUse latestSnapshotRows() from src/lib/holdings/latest-snapshot.ts.')
  console.error('portfolio_holdings is a series of dated snapshots; summing it')
  console.error('without a date multiplies every total by the number of dates.')
  process.exit(1)
}

if (benchUnsafe.length) {
  console.error(`\nFAIL: ${benchUnsafe.length} portfolio_benchmark_weights read(s) with no date rule:`)
  benchUnsafe.forEach(s => console.error('  ' + s.id))
  console.error('\nUse latestBenchmarkRows() from src/lib/holdings/latest-benchmark.ts,')
  console.error('or order by as_of_date and take one row. The table holds a single')
  console.error('date today and will hold a series; an unfiltered read merges them.')
  process.exit(1)
}

if (stale.length) {
  console.error(`\nFAIL: ${stale.length} allowlist entry/entries no longer match a site.`)
  console.error('Migrated or moved — remove them so the list keeps meaning something:')
  stale.forEach(id => console.error('  ' + id))
  process.exit(1)
}

console.log('PASS')
