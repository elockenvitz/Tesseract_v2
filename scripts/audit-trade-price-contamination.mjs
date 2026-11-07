#!/usr/bin/env node
/**
 * Which committed trades were sized against a price that was never a real,
 * dated observation for that symbol on that day.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Three separate things could put a fictional number into a trade:
 *
 *   1. `|| 100` in `src/lib/trade-lab/proposal-sizing.ts`. When no price
 *      resolved, sizing used the literal 100. A trade sized that way is not
 *      approximately wrong, it is unrelated to the market.
 *   2. The 10-day close window. A symbol with no close inside
 *      `LATEST_CLOSE_WINDOW_DAYS` is ABSENT from the price map, and the read
 *      falls through to the undated `assets.current_price` -- whatever it was
 *      last written to, with no date attached. During the 2026-10 outage that
 *      was a value from 2026-08-18.
 *   3. `accept-sizing` deliberately sizes against the portfolio's own book
 *      mark, because `target = current + delta` only closes if both sides are
 *      in the same money. When the book mark is a stale fixture, the trade is
 *      internally consistent and externally wrong.
 *
 * This script measures all three against the one independent reference the
 * database holds: the dated close in `price_history_cache` for the same
 * symbol on or before the acceptance date.
 *
 * ── This script does not write ───────────────────────────────────────────
 *
 * That is not a promise in a comment, it is enforced: every statement goes
 * through `assertReadOnly`, which refuses anything that is not a single
 * SELECT or WITH. Corrections to historical records are a separate,
 * separately authorised decision -- an audit that edits what it is measuring
 * destroys its own evidence.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *
 *   SUPABASE_MGMT_TOKEN=sbp_... node scripts/audit-trade-price-contamination.mjs
 *
 *   --json        machine-readable findings on stdout, nothing else
 *   --self-test   run the classifier against recorded rows; no network
 *   --limit=N     cap the per-section row listings (default 40)
 *
 * Exit 0 the audit completed, 2 it could not complete. It is a report, not a
 * gate: it never fails on what it finds, because what it finds is history and
 * history is not allowed to change.
 */

import { fileURLToPath } from 'node:url'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'wfcebeagznzgeuyysbnt'

/**
 * Bands. A trade is only called out when it is far enough from the dated
 * close that no ordinary intraday move explains it.
 *
 * 25% up / 20% down is roughly "a fifth away in either direction". Tighter
 * than that and ordinary volatility on a thin name produces findings that
 * are not findings.
 */
export const DEFAULT_BANDS = { high: 1.25, low: 0.8 }

/** The literal that `proposal-sizing.ts` used to substitute for a price. */
export const PLACEHOLDER_PRICE = 100

// ─────────────────────────────────────────────────────────────────────────
// The write guard
// ─────────────────────────────────────────────────────────────────────────

/** Words that have no business in a read. */
const WRITE_WORDS = [
  'insert', 'update', 'delete', 'truncate', 'drop', 'alter', 'create',
  'grant', 'revoke', 'merge', 'upsert', 'copy', 'vacuum', 'reindex',
  'comment', 'refresh', 'call', 'do', 'set', 'reset', 'lock', 'notify',
  'listen', 'begin', 'commit', 'rollback', 'savepoint', 'prepare', 'execute',
  'analyze', 'cluster', 'discard', 'security', 'import',
]

/** Strip `--` line comments and `/* *\/` block comments. */
const stripComments = (q) =>
  q.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

/**
 * Refuse anything that is not one read statement.
 *
 * Three ways a write could otherwise slip through, all closed here: a write
 * as the whole statement; a write smuggled after a `;` behind a legitimate
 * select; and a write hidden inside a comment that a later edit uncomments.
 * Comments are stripped BEFORE the keyword scan, so a commented-out write is
 * allowed to sit in the file -- it is the uncommenting that trips the guard.
 */
export function assertReadOnly(query) {
  const bare = stripComments(String(query))

  if (!/^\s*(with|select)\b/i.test(bare)) {
    throw new Error(`refusing a statement that does not begin with SELECT or WITH: ${bare.trim().slice(0, 60)}`)
  }

  // A trailing `;` is fine. A `;` with anything after it is a second
  // statement, which is how a write rides along behind a read.
  const semi = bare.indexOf(';')
  if (semi !== -1 && bare.slice(semi + 1).trim() !== '') {
    throw new Error('refusing a multi-statement query: everything after the first `;` is a second statement')
  }

  for (const word of WRITE_WORDS) {
    // Word-bounded, so `created_at` does not look like `create` and
    // `settings` does not look like `set`.
    if (new RegExp(`(^|[^a-z_])${word}([^a-z_]|$)`, 'i').test(bare)) {
      throw new Error(`refusing a query containing \`${word}\`: this script reads and never writes`)
    }
  }

  return query
}

// ─────────────────────────────────────────────────────────────────────────
// The classifier
// ─────────────────────────────────────────────────────────────────────────

/**
 * What kind of price a trade was sized against.
 *
 *   placeholder   exactly the literal 100
 *   no_reference  the database holds no close for that symbol at all
 *   deviates      outside the band against the dated close
 *   agrees        inside the band
 *
 * `placeholder` outranks `deviates`, and it is decided on EXACTNESS, not on
 * distance. The first version of this function tried to be clever: if the
 * dated close corroborated 100 within the band, it called the trade fine.
 * That classified the one trade that matters -- 16,550 shares of ABT sized
 * at the literal 100 against a 90.62 close, complete and in the book -- as
 * `agrees`, because 100 is only 10% away from 90.62.
 *
 * The lesson is that a band cannot tell a fallback from a coincidence. A
 * price recorded as exactly 100.00 is unverifiable from the trade record
 * alone, and "unverifiable" is the finding. So every exactly-100 trade is
 * flagged and `corroborated` is reported alongside it for triage. The cost
 * of a false flag is one human glance; the cost of the miss was $1.655m of
 * wrong book value sitting unnoticed.
 */
export function classifyTrade(row, bands = DEFAULT_BANDS) {
  const px = Number(row.px)
  if (!Number.isFinite(px) || px <= 0) return 'nonpositive'

  const ref = row.ref_close == null ? null : Number(row.ref_close)

  if (px === PLACEHOLDER_PRICE) return 'placeholder'

  if (ref == null) return 'no_reference'

  const ratio = px / ref
  if (ratio > bands.high || ratio < bands.low) return 'deviates'
  return 'agrees'
}

/**
 * Whether the dated close supports the price the trade was sized at.
 *
 * Reported next to every `placeholder` so a human can triage: an exactly-100
 * trade on a name whose close is 99.40 is probably a coincidence, and one on
 * a name whose close is 8.12 is certainly the fallback. The classifier does
 * not make that call, because the trade record cannot support it.
 */
export function isCorroborated(row, bands = DEFAULT_BANDS) {
  const px = Number(row.px)
  const ref = row.ref_close == null ? null : Number(row.ref_close)
  if (ref == null || !Number.isFinite(px) || px <= 0) return false
  const ratio = px / ref
  return ratio <= bands.high && ratio >= bands.low
}

/**
 * ── A heuristic that was tried here and removed ──────────────────────────
 *
 * A gap like NFLX 780.20 book against a 63.41 close looks like a book held
 * on a pre-split basis against a split-adjusted close, and that distinction
 * matters: re-marking a book that is merely denominated differently is the
 * wrong fix. So this file briefly carried a `splitSuspect()` that matched
 * the ratio against common split factors within 3%.
 *
 * It was removed because it did not work and lied confidently. The real
 * ratios -- NFLX 12.3x, DECK 10.3x, TTD 8.4x -- are near no clean factor,
 * while the matches it DID produce were false: NOW at "1:8", which never
 * split 8-for-1, and META at "1:6" derived from a 100.00 placeholder.
 *
 * The reason is in the data, not the arithmetic. These marks are seeded
 * fixtures: one value per symbol, repeated verbatim across 27 organisations'
 * books. A fixture's ratio to the market carries no split information, so no
 * ratio test can recover one.
 *
 * What the audit reports instead is the fact it can actually establish:
 * neither `portfolio_holdings` nor `price_history_cache` records an
 * adjustment basis at all, so the question is unanswerable from the data as
 * stored. That is a finding about the schema, and it is the strongest
 * argument for putting `adjustment` in the pricing contract.
 */

/**
 * Group the trades and work out what each class costs.
 *
 * `overstatedNotional` is the figure that answers "does cash need
 * correcting": the money the book moved minus the money it should have
 * moved at the dated close. Positive means the portfolio paid out more than
 * the position was worth.
 */
export function summarize(rows, bands = DEFAULT_BANDS) {
  const buckets = {}
  for (const row of rows) {
    const code = classifyTrade(row, bands)
    ;(buckets[code] ??= []).push({ ...row, code, corroborated: isCorroborated(row, bands) })
  }

  const consequential = (row) =>
    row.execution_status === 'complete' || row.execution_status === 'partial'

  const impact = (row) => {
    const px = Number(row.px)
    const ref = row.ref_close == null ? null : Number(row.ref_close)
    const shares = row.delta_shares == null ? null : Number(row.delta_shares)
    if (ref == null || shares == null || !Number.isFinite(px)) return null
    return { booked: shares * px, correct: shares * ref, error: shares * (px - ref) }
  }

  const flagged = [...(buckets.placeholder ?? []), ...(buckets.deviates ?? []), ...(buckets.no_reference ?? [])]
  const applied = flagged.filter(consequential)

  let overstatedNotional = 0
  for (const row of applied) {
    const i = impact(row)
    if (i) overstatedNotional += i.error
  }

  return {
    counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    buckets,
    flagged,
    applied,
    overstatedNotional,
    impact,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every accepted trade with the dated close nearest its acceptance date.
 *
 * `price_history_cache` is keyed by `coalesce(current_symbol, symbol)`, the
 * same resolution the backfill uses, so a renamed ticker joins the way the
 * ingestion wrote it rather than the way the book records it. Both are
 * returned, because a mismatch between them is itself a finding.
 */
export const Q_TRADES = `
  with t as (
    select at.id,
           at.created_at::date as d,
           at.action,
           at.price_at_acceptance::float as px,
           at.delta_shares,
           at.target_shares,
           at.notional_value::float as notional,
           at.execution_status,
           at.source,
           upper(coalesce(a.current_symbol, a.symbol)) as pricing_symbol,
           upper(a.symbol) as book_symbol,
           at.portfolio_id,
           p.name as portfolio,
           o.name as org
    from accepted_trades at
    join assets a on a.id = at.asset_id
    left join portfolios p on p.id = at.portfolio_id
    left join organizations o on o.id = p.organization_id
    where at.price_at_acceptance is not null
  )
  select t.*, c.close::float as ref_close, c.date::text as ref_date
  from t
  left join lateral (
    select close, date
    from price_history_cache ph
    where ph.symbol = t.pricing_symbol and ph.date <= t.d
    order by ph.date desc
    limit 1
  ) c on true
  order by t.d desc, t.pricing_symbol
`

/** Population, so a count in the report can be checked against the table. */
export const Q_POPULATION = `
  select count(*)::int as total,
         count(price_at_acceptance)::int as with_price,
         count(*) filter (where price_at_acceptance is null)::int as null_price,
         min(created_at)::date::text as first,
         max(created_at)::date::text as last
  from accepted_trades
`

/**
 * Current book marks that are far from the newest dated close.
 *
 * This is the upstream cause rather than a consequence: `accept-sizing`
 * reads these marks on purpose, so a stale book does not produce a visibly
 * wrong trade, it produces an internally consistent one.
 */
export const Q_STALE_MARKS = `
  with newest as (
    select symbol, close::float as close, date
    from (
      select symbol, close, date,
             row_number() over (partition by symbol order by date desc) as rn
      from price_history_cache
    ) ranked
    where rn = 1
  )
  select h.date::text as d,
         upper(coalesce(a.current_symbol, a.symbol)) as sym,
         h.shares::float as shares,
         h.price::float as book_price,
         n.close as newest_close,
         n.date::text as close_date,
         p.name as portfolio,
         o.name as org
  from portfolio_holdings h
  join assets a on a.id = h.asset_id
  join portfolios p on p.id = h.portfolio_id
  left join organizations o on o.id = p.organization_id
  join newest n on n.symbol = upper(coalesce(a.current_symbol, a.symbol))
  where h.date = (select max(date) from portfolio_holdings h2 where h2.portfolio_id = h.portfolio_id)
    and a.symbol <> 'CASH_USD'
    and h.price is not null
    and n.close > 0
    and abs(h.price - n.close) / n.close > 0.5
  order by abs(h.price - n.close) / n.close desc
`

/** Cash lines, because a trade booked at a fictional price moved real cash. */
export const Q_CASH = `
  select p.name as portfolio,
         o.name as org,
         h.date::text as d,
         h.shares::float as cash
  from portfolio_holdings h
  join assets a on a.id = h.asset_id
  join portfolios p on p.id = h.portfolio_id
  left join organizations o on o.id = p.organization_id
  where a.symbol = 'CASH_USD'
    and h.date = (select max(date) from portfolio_holdings h2 where h2.portfolio_id = h.portfolio_id)
    and h.shares < 0
  order by h.shares
`

/** Open variants still carrying a sized price, which will need re-sizing. */
export const Q_OPEN_VARIANTS = `
  select count(*)::int as total,
         count(*) filter (where computed is not null)::int as with_computed,
         count(*) filter (where computed->>'price_used' is not null)::int as with_price,
         max(updated_at)::text as newest
  from lab_variants
  where visibility_tier = 'active'
`

export const ALL_QUERIES = {
  Q_POPULATION, Q_TRADES, Q_STALE_MARKS, Q_CASH, Q_OPEN_VARIANTS,
}

// ─────────────────────────────────────────────────────────────────────────
// Recorded rows, for --self-test
// ─────────────────────────────────────────────────────────────────────────

/**
 * Real rows read on 2026-11-07, kept so the classifier can be exercised
 * without a database and so a future change to the bands is visible as a
 * change in these verdicts rather than as silence.
 */
export const RECORDED = [
  // The one real placeholder trade: complete, in the book, 16,550 shares of
  // ABT sized at the literal 100 when the close was 90.62.
  { what: 'ABT at the literal 100, booked', px: 100, ref_close: 90.62, ref_date: '2026-06-16',
    delta_shares: 16550, execution_status: 'complete', expect: 'placeholder' },
  // The live example of the stale-book class: AAPL sized off a book mark of
  // 228.50 against a 332.89 close.
  { what: 'AAPL off a stale book mark', px: 228.5, ref_close: 332.89, ref_date: '2026-10-05',
    delta_shares: 743, execution_status: 'pending', expect: 'deviates' },
  // A name with no close in the table at all.
  { what: 'a symbol the table has never priced', px: 61.4, ref_close: null, ref_date: null,
    delta_shares: 100, execution_status: 'pending', expect: 'no_reference' },
  // An honest trade, for contrast.
  { what: 'a trade sized at the dated close', px: 284.78, ref_close: 284.78, ref_date: '2026-11-06',
    delta_shares: 50, execution_status: 'complete', expect: 'agrees' },
  // Exactly 100 on a name whose close is 99.40 is probably a coincidence,
  // and it is STILL flagged. The trade record cannot distinguish it from the
  // fallback, so the audit reports it and `corroborated` says which it looks
  // like. This row is here to pin that deliberate over-reporting: the
  // earlier, cleverer rule is what hid the ABT trade above.
  { what: '100 on a name closing at 99.40', px: 100, ref_close: 99.4, ref_date: '2026-11-06',
    delta_shares: 10, execution_status: 'pending', expect: 'placeholder' },
]

/**
 * Prove the classifier and the write guard both fire.
 *
 * CLAUDE.md Standing Rule 3: a check that cannot observe its own failure
 * mode is decoration. So this does not merely confirm the recorded verdicts
 * -- it mutates each query into a write and requires the guard to refuse it.
 */
export function selfTest(log = console.log) {
  let failures = 0
  const check = (ok, label) => {
    log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
    if (!ok) failures += 1
  }

  log('classifier, against rows read on 2026-11-07:')
  for (const row of RECORDED) {
    const got = classifyTrade(row)
    const note = got === 'placeholder' ? `  (corroborated: ${isCorroborated(row)})` : ''
    check(got === row.expect, `${row.what} -> ${got}${got === row.expect ? '' : ` (expected ${row.expect})`}${note}`)
  }

  // The specific regression, named: the clever version of `classifyTrade`
  // called the ABT trade `agrees`, and a band-based rule always will,
  // because 100 is within 25% of 90.62. This assertion is the one that
  // catches a future rewrite that reintroduces the corroboration escape.
  const abt = RECORDED[0]
  check(classifyTrade(abt) !== 'agrees',
    'a 10%-away exactly-100 trade is never classified `agrees` (the ABT miss)')

  log('\nthe write guard accepts every query this script sends:')
  for (const [name, query] of Object.entries(ALL_QUERIES)) {
    let ok = true
    try { assertReadOnly(query) } catch (err) { ok = false; log(`        ${err.message}`) }
    check(ok, name)
  }

  log('\nthe write guard refuses a write (injected, one per shape):')
  const writes = [
    ['a bare update', `update accepted_trades set price_at_acceptance = 90.62`],
    ['a write behind a read', `${Q_POPULATION}; delete from accepted_trades`],
    ['a write inside a CTE', `with x as (insert into assets (symbol) values ('X') returning id) select * from x`],
    ['an uncommented write', `select 1 from accepted_trades where id in (select id from accepted_trades) /* then */ truncate accepted_trades`],
    ['a DDL', `select 1; alter table accepted_trades drop column price_at_acceptance`],
    ['a grant', `select 1; grant all on accepted_trades to anon`],
  ]
  for (const [label, query] of writes) {
    let refused = false
    try { assertReadOnly(query) } catch { refused = true }
    check(refused, `refused: ${label}`)
  }

  log(failures === 0
    ? '\nself-test PASS: the classifier reproduces the recorded verdicts and the guard refuses every write'
    : `\nself-test FAIL: ${failures} assertion(s) did not hold`)
  return failures
}

// ─────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────

const money = (n) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

const pad = (v, n) => String(v ?? '-').padEnd(n)
const padL = (v, n) => String(v ?? '-').padStart(n)

async function run(argv) {
  const flag = (name) => argv.some((a) => a === `--${name}`)
  const value = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : fallback
  }

  if (flag('self-test')) return selfTest() === 0 ? 0 : 2

  const token = process.env.SUPABASE_MGMT_TOKEN
  if (!token) {
    console.error('SUPABASE_MGMT_TOKEN is not set. This audit needs lateral joins and window')
    console.error('functions, which PostgREST cannot express, so it goes through the Management')
    console.error('API read endpoint rather than the service-role key.')
    return 2
  }

  const limit = Number(value('limit', 40))
  const asJson = flag('json')
  const out = asJson ? () => {} : (...a) => console.log(...a)

  const sql = async (query) => {
    assertReadOnly(query)
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
    const rows = JSON.parse(text)
    // Shape, not status. A 200 carrying something that is not an array of
    // rows is a failed read dressed as a successful one.
    if (!Array.isArray(rows)) throw new Error(`expected rows, got ${typeof rows}`)
    return rows
  }

  const [pop] = await sql(Q_POPULATION)
  const trades = await sql(Q_TRADES)
  const marks = await sql(Q_STALE_MARKS)
  const cash = await sql(Q_CASH)
  const [variants] = await sql(Q_OPEN_VARIANTS)

  const s = summarize(trades)

  out('── population ───────────────────────────────────────────────────────')
  out(`  accepted_trades       ${pop.total}  (${pop.with_price} with a price, ${pop.null_price} without)`)
  out(`  acceptance dates      ${pop.first} .. ${pop.last}`)
  out('')
  out('── how each trade\'s price compares to the dated close ───────────────')
  for (const [code, n] of Object.entries(s.counts).sort((a, b) => b[1] - a[1])) {
    out(`  ${pad(code, 14)} ${padL(n, 4)}`)
  }

  out('')
  out('── flagged trades, worst first ──────────────────────────────────────')
  out(`  ${pad('date', 12)}${pad('sym', 7)}${pad('class', 13)}${padL('px_used', 10)}${padL('close', 10)}  ${pad('close_date', 12)}${padL('shares', 9)}${padL('err', 13)}  ${pad('exec', 10)}${pad('portfolio', 24)}org`)
  const worst = [...s.flagged].sort((a, b) => {
    const ia = s.impact(a), ib = s.impact(b)
    return Math.abs(ib?.error ?? 0) - Math.abs(ia?.error ?? 0)
  })
  for (const row of worst.slice(0, limit)) {
    const i = s.impact(row)
    out(`  ${pad(row.d, 12)}${pad(row.pricing_symbol, 7)}${pad(row.code, 13)}` +
      `${padL(Number(row.px).toFixed(2), 10)}${padL(row.ref_close == null ? '-' : Number(row.ref_close).toFixed(2), 10)}  ` +
      `${pad(row.ref_date, 12)}${padL(row.delta_shares, 9)}${padL(i ? money(i.error) : '-', 13)}  ` +
      `${pad(row.execution_status, 10)}${pad(row.portfolio, 24)}${row.org ?? '-'}` +
      `${row.code === 'placeholder' && row.corroborated ? '   [close is near 100: may be a coincidence]' : ''}`)
  }
  if (worst.length > limit) out(`  ... ${worst.length - limit} more (raise --limit)`)

  out('')
  out('── does cash or holdings need correcting? ───────────────────────────')
  out(`  flagged trades that actually reached the book: ${s.applied.length} of ${s.flagged.length}`)
  out(`  net notional error on those                 : ${money(s.overstatedNotional)}`)
  for (const row of s.applied) {
    const i = s.impact(row)
    out(`    ${row.d}  ${pad(row.pricing_symbol, 7)} ${padL(row.delta_shares, 8)} sh  ` +
      `booked ${padL(i ? money(i.booked) : '-', 13)}  should be ${padL(i ? money(i.correct) : '-', 13)}  ${row.org ?? '-'} / ${row.portfolio ?? '-'}`)
  }
  if (cash.length) {
    out('')
    out('  portfolios whose cash line is negative:')
    for (const r of cash) out(`    ${money(r.cash)}  ${pad(r.portfolio, 26)} ${r.org ?? '-'}  (as of ${r.d})`)
  }

  out('')
  out('── the upstream cause: book marks far from the dated close ──────────')
  out(`  ${marks.length} current holdings rows are more than 50% away from the newest close`)
  out('')
  // Grouped by symbol, because the same fixture mark is shared verbatim
  // across many organisations' books -- 28 rows of NFLX at 780.20 is one
  // defect, not 28, and the per-row listing hid that.
  const bySymbol = new Map()
  for (const r of marks) {
    const g = bySymbol.get(r.sym) ?? { sym: r.sym, book: r.book_price, close: r.newest_close, orgs: new Set(), rows: 0 }
    g.orgs.add(r.org ?? '-')
    g.rows += 1
    bySymbol.set(r.sym, g)
  }
  const groups = [...bySymbol.values()].sort((a, b) => b.orgs.size - a.orgs.size || b.rows - a.rows)
  const shared = groups.filter((g) => g.orgs.size > 1)

  out(`  ${groups.length} distinct symbols. ${shared.length} of them carry the SAME mark in more`)
  out('  than one organisation\'s book, which makes them seeded fixtures rather than')
  out('  marks that drifted. The ratio column does not identify a cause: neither')
  out('  portfolio_holdings nor price_history_cache records an adjustment basis, so')
  out('  a split cannot be told from a stale mark in the data as stored.')
  out('')
  out(`  ${pad('sym', 7)}${padL('book', 11)}${padL('close', 11)}${padL('ratio', 8)}${padL('rows', 6)}${padL('orgs', 6)}  shape`)
  for (const g of groups.slice(0, limit)) {
    out(`  ${pad(g.sym, 7)}${padL(Number(g.book).toFixed(2), 11)}${padL(Number(g.close).toFixed(2), 11)}` +
      `${padL((Number(g.book) / Number(g.close)).toFixed(1) + 'x', 8)}${padL(g.rows, 6)}${padL(g.orgs.size, 6)}  ` +
      `${g.orgs.size > 1 ? 'shared fixture' : 'single book'}`)
  }
  if (groups.length > limit) out(`  ... ${groups.length - limit} more symbols (raise --limit)`)

  out('')
  out('── still open, so still re-sizeable ─────────────────────────────────')
  out(`  active lab_variants: ${variants.total}, of which ${variants.with_price} carry a sized price`)
  out(`  newest update: ${variants.newest ?? '-'}`)
  out('')
  out('Nothing above was modified. Corrections are a separate decision.')

  if (asJson) {
    console.log(JSON.stringify({
      population: pop,
      counts: s.counts,
      flagged: s.flagged.map((r) => ({ ...r, impact: s.impact(r) })),
      appliedToBook: s.applied.length,
      netNotionalError: s.overstatedNotional,
      staleMarks: marks,
      negativeCash: cash,
      openVariants: variants,
    }, null, 2))
  }

  return 0
}

const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (IS_MAIN) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { console.error(`audit could not complete: ${err.message}`); process.exit(2) },
  )
}
