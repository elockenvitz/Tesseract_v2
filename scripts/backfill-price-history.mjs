#!/usr/bin/env node
/**
 * Daily closes for every name the books actually hold.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * "Every portfolio should be a time series" needs one input the database does
 * not have: a close, every trading day, for every held name. Measured
 * 2026-08-18, `price_history_cache` covers 8 symbols — 5 to 7 of the 35 to 92
 * names each book holds. `buildWeightSeries` refuses to emit a day below 95%
 * priced coverage, so nothing renders, which is the correct output and not a
 * bug. This closes the gap that makes it correct AND non-empty.
 *
 * ── What it does not need ─────────────────────────────────────────────────
 *
 * No migration. `price_history_cache` is already
 * `UNIQUE (symbol, date)` with the exact shape required, and it carries no
 * `organization_id` — a closing price is not tenant data, it is a market fact
 * keyed by symbol. So this is an INSERT-only backfill against an existing
 * table, and re-running it is safe by construction.
 *
 * ── Provider ──────────────────────────────────────────────────────────────
 *
 * Yahoo's chart endpoint, the same one the seed and the scenario cards already
 * use. `docs/handoff.md` §5b is explicit that it is undocumented, unlicensed
 * and a bot-interstitial risk of the same class as iShares and Invesco — both
 * of which return HTTP 200 with HTML. So:
 *
 *   - every response is checked for JSON shape, never trusted by status code
 *   - a symbol that returns HTML is reported and skipped, not written
 *   - the source is stamped on every row, so a future licensed feed can be
 *     distinguished from this one without archaeology
 *
 * This is a pilot-blocking dependency, not a permanent design. It is written
 * so the provider can be swapped by replacing `fetchDailyCloses` alone.
 *
 * ── Proof of work ─────────────────────────────────────────────────────────
 *
 * `docs/handoff.md` §4: AN EXIT CODE IS NOT EVIDENCE A CHECK RAN. This prints
 * symbols requested, symbols fetched, rows written and rows skipped, and exits
 * non-zero if it wrote nothing while having symbols to write — a silent
 * success on an empty backfill is the failure mode.
 *
 * Usage:
 *   node scripts/backfill-price-history.mjs            # dry run, writes nothing
 *   node scripts/backfill-price-history.mjs --apply    # writes
 *   node scripts/backfill-price-history.mjs --apply --range=2y
 */

const APPLY = process.argv.includes('--apply')
const RANGE = (process.argv.find(a => a.startsWith('--range=')) ?? '--range=1y').split('=')[1]

/**
 * Two credential paths, because this writes market data shared by every
 * organisation and RLS-scoped keys cannot do that.
 *
 *   SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL  -> PostgREST
 *   SUPABASE_MGMT_TOKEN + SUPABASE_PROJECT_REF     -> Management API SQL
 *
 * The Management path exists because it is the one actually used to run this
 * the first time, and shipping a script nobody has executed is how you get a
 * backfill that exits 0 having done nothing.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF

const USE_MGMT = !!(MGMT_TOKEN && PROJECT_REF)

if (!USE_MGMT && !(SUPABASE_URL && SERVICE_KEY)) {
  console.error('FAIL: no usable credentials.')
  console.error('Set SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL,')
  console.error('or SUPABASE_MGMT_TOKEN + SUPABASE_PROJECT_REF.')
  console.error('This writes market data across every organisation, so an anon key cannot do it.')
  process.exit(1)
}

/** Escape a value for inline SQL. Only ever called with symbols, ISO dates and
 *  finite numbers produced by this file — never with provider prose. */
const lit = (v) => typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`

/**
 * Retried, because the Management API sits behind a gateway that returns a 502
 * HTML page on a large or slow statement. Measured: 500-row INSERTs failed
 * partway through a 33k-row backfill; 150 rows do not.
 *
 * The HTML body is the same shape of hazard the provider check guards against
 * — a non-JSON response that must never be parsed as data — so the status is
 * checked before the body is touched.
 */
const sql = async (query, attempt = 1) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) {
    // A 4xx is a bad statement and will fail identically forever — EXCEPT 429,
    // which is the Management API throttling a bulk write it was never
    // designed for. Gateway 5xx and 429 are both worth repeating, with a much
    // longer wait for the throttle.
    const retryable = r.status >= 500 || r.status === 429
    if (retryable && attempt < 8) {
      const wait = r.status === 429 ? attempt * 8000 : attempt * 1500
      await new Promise(res => setTimeout(res, wait))
      return sql(query, attempt + 1)
    }
    throw new Error(`sql failed: ${r.status} ${t.slice(0, 200)}`)
  }
  return JSON.parse(t)
}

const rest = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

/** Every symbol any book holds, across every org. Market data is not scoped. */
async function heldSymbols() {
  // CASH_USD is a book line, not a listed instrument. Requesting it would
  // return an interstitial and look like a provider failure.
  if (USE_MGMT) {
    const rows = await sql(`
      select distinct upper(a.symbol) as symbol
        from portfolio_holdings h join assets a on a.id = h.asset_id
       where a.symbol is not null and a.symbol <> 'CASH_USD'
       order by 1`)
    return rows.map(r => r.symbol)
  }
  /**
   * Paginated. `limit=20000` does NOT defeat PostgREST's max-rows cap, which
   * is 1,000 on this project — and `portfolio_holdings` holds 1,086.
   *
   * The first version returned the right answer anyway, purely because the 86
   * dropped rows happened to contain no symbol the first 1,000 lacked. That is
   * luck, not correctness, and it is exactly the silent truncation that made
   * the benchmark capture find two portfolios instead of seven.
   */
  const out = new Set()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const r = await rest('portfolio_holdings?select=assets(symbol)', {
      headers: { Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
    })
    if (!r.ok) throw new Error(`holdings query failed: ${r.status} ${await r.text()}`)
    const rows = await r.json()
    for (const row of rows) {
      const s = row?.assets?.symbol
      if (s && s !== 'CASH_USD') out.add(String(s).toUpperCase())
    }
    // A short page is the last page.
    if (rows.length < PAGE) break
  }
  return [...out].sort()
}

/**
 * Daily closes from Yahoo. Returns null when the response is not the JSON this
 * expects — an HTML interstitial arrives with HTTP 200 and must not be parsed
 * into prices.
 */
/**
 * Yahoo spells share classes with a hyphen: BRK.B is BRK-B, BF.B is BF-B.
 *
 * This is a SPELLING difference for the same instrument, which is why it is
 * safe to retry automatically. Ticker CHANGES are not — SQ became XYZ and ZOOM
 * became ZM through corporate actions, and silently substituting those would
 * be inventing a mapping between two different identifiers. Those are reported
 * as failures for a human to resolve, which is what
 * docs/tickets/instrument-universe.md exists to fix properly with FIGI.
 */
const yahooSpelling = (symbol) => symbol.replace(/\./g, '-')

async function fetchDailyCloses(symbol, range) {
  const attempt = await fetchOne(symbol, range)
  if (!attempt.error) return attempt
  const alt = yahooSpelling(symbol)
  if (alt !== symbol) {
    const retry = await fetchOne(alt, range)
    // Rows keep the symbol OUR database uses, not Yahoo's spelling of it.
    if (!retry.error) return { rows: retry.rows.map(r => ({ ...r, symbol })) }
  }
  return attempt
}

async function fetchOne(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const text = await r.text()
  if (!r.ok) return { error: `HTTP ${r.status}` }
  if (!text.trim().startsWith('{')) return { error: 'non-JSON response (interstitial?)' }

  let body
  try { body = JSON.parse(text) } catch { return { error: 'unparseable JSON' } }

  const result = body?.chart?.result?.[0]
  const stamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return { error: 'no series in payload' }

  const rows = []
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i]
    // A null close is a non-trading stamp. Writing it as 0 is precisely the
    // "absence rendered as a meaningful zero" defect every chart downstream
    // then has to defend against.
    if (close == null || !Number.isFinite(close) || close <= 0) continue
    rows.push({
      symbol,
      date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
      close,
      source: 'yahoo_chart_v8',
    })
  }
  return { rows }
}

async function upsert(rows) {
  if (USE_MGMT) {
    // Same conflict target as the REST path: the table's existing
    // UNIQUE (symbol, date). DO UPDATE so a re-run refreshes rather than
    // erroring, which is what makes this safe to run repeatedly.
    const values = rows
      .map(r => `(${lit(r.symbol)}, ${lit(r.date)}::date, ${lit(r.close)}, ${lit(r.source)})`)
      .join(',')
    await sql(`
      insert into public.price_history_cache (symbol, date, close, source)
      values ${values}
      on conflict (symbol, date) do update
        set close = excluded.close, source = excluded.source`)
    return
  }
  // on_conflict on the existing unique key. merge-duplicates so a re-run
  // refreshes rather than erroring — the table already guarantees one row per
  // symbol per day.
  const r = await rest('price_history_cache?on_conflict=symbol,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })
  if (!r.ok) throw new Error(`write failed: ${r.status} ${await r.text()}`)
}

const main = async () => {
  const symbols = await heldSymbols()
  console.log(`credential path               : ${USE_MGMT ? 'management API' : 'service role'}`)
  console.log(`symbols held across all books : ${symbols.length}`)
  console.log(`range                         : ${RANGE}`)
  console.log(`mode                          : ${APPLY ? 'APPLY' : 'dry run (writes nothing)'}`)

  let fetched = 0
  let written = 0
  const failures = []

  for (const symbol of symbols) {
    const { rows, error } = await fetchDailyCloses(symbol, RANGE)
    if (error || !rows?.length) {
      failures.push(`${symbol}: ${error ?? 'no rows'}`)
      continue
    }
    fetched += 1
    if (APPLY) {
      // Chunked: a 500-name book at 251 days is 125k rows in one body.
      // 150, not 500: the Management API gateway 502s on larger statements.
      const CHUNK = USE_MGMT ? 150 : 500
      for (let i = 0; i < rows.length; i += CHUNK) {
        await upsert(rows.slice(i, i + CHUNK))
        // Paced. The Management API throttles aggressively and a backfill that
        // trips it repeatedly is slower than one that never does.
        if (USE_MGMT) await new Promise(r => setTimeout(r, 400))
      }
    }
    written += rows.length
    // Deliberate pacing. §5b records 8/8 rapid calls returning 200 and also
    // that this endpoint is a bot-block risk; hammering it is how that risk
    // becomes an outage.
    await new Promise(r => setTimeout(r, 250))
  }

  console.log(`symbols fetched               : ${fetched}`)
  console.log(`rows ${APPLY ? 'written' : 'that would be written'}         : ${written}`)
  console.log(`symbols failed                : ${failures.length}`)
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`)

  // Positive proof of work. Zero rows against a non-empty symbol list means
  // the provider blocked us or the query returned nothing — either way this
  // did not do its job, and exiting 0 would report otherwise.
  if (symbols.length > 0 && written === 0) {
    console.error('FAIL: symbols to backfill but zero rows produced. The provider or the query is broken.')
    process.exit(1)
  }
  console.log('PASS')
}

main().catch(e => { console.error(`FAIL: ${e.message}`); process.exit(1) })
