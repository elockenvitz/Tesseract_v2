#!/usr/bin/env node
/**
 * Capture an index's constituent weights as a DATED snapshot.
 *
 * ── What this unblocks ────────────────────────────────────────────────────
 *
 * `20260818140000_benchmark_weight_history.sql` made a second `as_of_date`
 * possible. Until one actually lands, a historical active weight is computable
 * but has no history to compute over — the table holds a single file from
 * 2026-08-14. This is the job that changes that.
 *
 * ── Why SSGA ──────────────────────────────────────────────────────────────
 *
 * It is the only issuer that reliably serves a holdings file. iShares and
 * Invesco return HTTP 200 with bot interstitials (handoff §5b), and that class
 * of block escalates. Assume this one can vanish too: `fetchIssuerFile` is the
 * only function that knows about the provider.
 *
 * The redirect matters. The documented URL 301s, and following it is the
 * difference between a 54KB spreadsheet and a 340-byte HTML page — which,
 * parsed optimistically, would become a benchmark of zero names.
 *
 * ── SPY is not the S&P 500 ────────────────────────────────────────────────
 *
 * It is a fund tracking the index, with its own cash drag, rebalance lag and
 * as-of date. `source_type` records that as `etf_proxy` so a card can say so
 * on its face, exactly as `ActiveRiskInput.benchmarkSource` already does.
 * Presenting a proxy's weights as "the benchmark" is the same class of error
 * as normalising a probability distribution that does not sum to 100.
 *
 * ── The rejection rule ────────────────────────────────────────────────────
 *
 * `benchmark_weight_snapshots` CHECKs that `weight_sum` lands between 99 and
 * 101, and stores it UNROUNDED so the check is verifiable after the fact. A
 * file whose weights do not sum to ~100 is a bad parse or a bad file, and it
 * is rejected rather than rounded up — a benchmark that silently sums to 84
 * would make every active weight in the book wrong in the same direction.
 *
 * Usage:
 *   node scripts/capture-benchmark-weights.mjs            # dry run
 *   node scripts/capture-benchmark-weights.mjs --apply
 */

import * as XLSX from 'xlsx'

const APPLY = process.argv.includes('--apply')
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL

/**
 * PostgREST is PREFERRED over the Management API here.
 *
 * Both can do the job, but they are not equally dangerous. The management
 * token is project-admin: it can read every tenant's data, run arbitrary DDL
 * and rotate keys. A service-role key bypasses RLS — which this job needs,
 * since it writes benchmark weights for every organisation — but cannot alter
 * the project. For a job that runs unattended every night, on a runner, that
 * difference is the whole security posture.
 *
 * The management path is kept as a fallback because it is the one that was
 * proven first, and because a broken PostgREST deploy should not stop a
 * nightly capture.
 */
const USE_REST = !!(SERVICE_KEY && SUPABASE_URL)

if (!USE_REST && !(MGMT_TOKEN && PROJECT_REF)) {
  console.error('FAIL: no usable credentials.')
  console.error('Preferred: SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.')
  console.error('Fallback:  SUPABASE_MGMT_TOKEN + SUPABASE_PROJECT_REF (project-admin — avoid).')
  process.exit(1)
}

const rest = async (path, init = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!r.ok) throw new Error(`rest ${path.split('?')[0]} failed: ${r.status} ${(await r.text()).slice(0, 200)}`)
  const body = await r.text()
  return body ? JSON.parse(body) : []
}

/** PostgREST exact count via the Content-Range header. */
const restCount = async (path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&select=id`, {
    method: 'HEAD',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'count=exact', Range: '0-0',
    },
  })
  const range = r.headers.get('content-range') ?? ''
  return Number(range.split('/')[1] ?? 0)
}

const SOURCE = {
  index: 'S&P 500',
  proxy: 'SPY',
  sourceType: 'etf_proxy',
  url: 'https://www.ssga.com/us/en/institutional/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx',
}

const lit = (v) => v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`

const sql = async (query, attempt = 1) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) {
    if ((r.status >= 500 || r.status === 429) && attempt < 8) {
      await new Promise(res => setTimeout(res, (r.status === 429 ? 8000 : 1500) * attempt))
      return sql(query, attempt + 1)
    }
    throw new Error(`sql failed: ${r.status} ${t.slice(0, 200)}`)
  }
  return JSON.parse(t)
}

async function fetchIssuerFile() {
  // redirect: 'follow' is the default but stated here because the documented
  // URL 301s and NOT following it yields a 340-byte HTML page.
  const r = await fetch(SOURCE.url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  })
  if (!r.ok) throw new Error(`issuer file HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  // XLSX is a zip: it starts "PK". An interstitial starts "<". Checking the
  // bytes rather than the status is the same rule the price backfill follows.
  if (buf.subarray(0, 2).toString() !== 'PK') {
    throw new Error(`issuer returned ${buf.length} bytes that are not a spreadsheet (interstitial?)`)
  }
  return buf
}

/**
 * Pull ticker + weight + the file's own as-of date.
 *
 * The as-of date comes from the FILE, never from ingestion time. A weight
 * stamped with "now" claims a freshness it does not have — the defect this
 * codebase has met as a placeholder quote and as a `new Date()` on a holdings
 * metric, twice.
 */
function parse(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })

  let asOf = null
  for (const row of grid.slice(0, 12)) {
    for (const cell of row) {
      const m = typeof cell === 'string' && cell.match(/as of\s+(.+)$/i)
      if (m) {
        const d = new Date(m[1].trim())
        if (!Number.isNaN(d.getTime())) asOf = d.toISOString().slice(0, 10)
      }
    }
  }

  const headerIdx = grid.findIndex(r =>
    r.some(c => typeof c === 'string' && /^ticker$/i.test(c.trim())))
  if (headerIdx < 0) throw new Error('no Ticker column found — file layout changed')

  const header = grid[headerIdx].map(c => String(c ?? '').trim().toLowerCase())
  const tickerCol = header.indexOf('ticker')
  const weightCol = header.findIndex(h => h.includes('weight'))
  const nameCol = header.findIndex(h => h === 'name')
  if (weightCol < 0) throw new Error('no Weight column found — file layout changed')

  const rows = []
  for (const r of grid.slice(headerIdx + 1)) {
    const ticker = String(r[tickerCol] ?? '').trim().toUpperCase()
    const weight = Number(String(r[weightCol] ?? '').replace(/[%,\s]/g, ''))
    if (!ticker || !/^[A-Z.\-]{1,8}$/.test(ticker)) continue
    if (!Number.isFinite(weight) || weight <= 0) continue
    rows.push({ ticker, weight, name: nameCol >= 0 ? String(r[nameCol] ?? '').trim() : null })
  }
  return { asOf, rows }
}

const main = async () => {
  const buf = await fetchIssuerFile()
  const { asOf, rows } = parse(buf)
  const sum = rows.reduce((n, r) => n + r.weight, 0)

  console.log(`issuer file                   : ${SOURCE.proxy} (${SOURCE.sourceType})`)
  console.log(`file as-of date               : ${asOf ?? 'NOT FOUND'}`)
  console.log(`constituents parsed           : ${rows.length}`)
  console.log(`weight sum (unrounded)        : ${sum}`)
  console.log(`mode                          : ${APPLY ? 'APPLY' : 'dry run (writes nothing)'}`)

  if (!asOf) {
    console.error('FAIL: no as-of date in the file. Stamping ingestion time would claim')
    console.error('a freshness the weights do not have. Refusing rather than guessing.')
    process.exit(1)
  }
  // The same band the table's CHECK enforces, applied before the round trip so
  // the failure names the reason rather than surfacing as a constraint error.
  if (!(sum >= 99 && sum <= 101)) {
    console.error(`FAIL: weights sum to ${sum}, outside 99-101. Bad parse or bad file.`)
    console.error('Rejected, never rounded — a benchmark summing to 84 makes every')
    console.error('active weight in the book wrong in the same direction.')
    process.exit(1)
  }
  if (rows.length < 100) {
    console.error(`FAIL: only ${rows.length} constituents. An S&P 500 proxy has ~500.`)
    process.exit(1)
  }

  // Which portfolios already track this index, and their org. Only those get a
  // snapshot — a benchmark belongs to a portfolio, not to the database.
  const targets = USE_REST
    ? await (async () => {
        /**
         * Paginated, because PostgREST caps a response at 1,000 rows and the
         * weights table holds 6,762.
         *
         * Without this the first attempt found TWO portfolios instead of
         * seven and reported PASS — it would have captured for two books and
         * looked entirely successful. Silent truncation is the failure mode
         * this whole codebase keeps meeting, and a default page size is a
         * particularly quiet version of it.
         *
         * PostgREST has no DISTINCT either, so the dedupe happens here.
         */
        const seen = new Map()
        const PAGE = 1000
        for (let from = 0; ; from += PAGE) {
          const page = await rest(
            'portfolio_benchmark_weights?select=portfolio_id,portfolios!inner(id,organization_id)',
            { headers: { Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } },
          )
          for (const r of page) {
            const org = r.portfolios?.organization_id
            if (org && !seen.has(r.portfolio_id)) {
              seen.set(r.portfolio_id, { portfolio_id: r.portfolio_id, organization_id: org })
            }
          }
          // A short page is the last page. Guarding on length rather than on a
          // total keeps this correct if rows are written while it runs.
          if (page.length < PAGE) break
        }
        return [...seen.values()]
      })()
    : await sql(`
        select distinct p.id as portfolio_id, p.organization_id
          from public.portfolios p
          join public.portfolio_benchmark_weights w on w.portfolio_id = p.id
         where p.organization_id is not null`)
  console.log(`portfolios tracking a benchmark: ${targets.length}`)

  const existingCount = USE_REST
    ? await restCount(`portfolio_benchmark_weights?as_of_date=eq.${asOf}`)
    : (await sql(`select count(*) n from public.portfolio_benchmark_weights where as_of_date = '${asOf}'`))[0]?.n ?? 0
  console.log(`rows already at this as-of     : ${existingCount}`)

  if (!APPLY) { console.log('PASS (dry run)'); return }

  // Resolve tickers to asset ids ONCE. Constituents with no asset row are
  // skipped rather than created: this job captures index weights, and silently
  // minting 400 asset rows as a side effect would be a different, unreviewed
  // change.
  const idRows = USE_REST
    // `in.(...)` with 504 tickers is a long URL but well inside PostgREST's
    // limit, and one round trip beats paging.
    ? await rest(`assets?select=id,symbol&symbol=in.(${rows.map(r => encodeURIComponent(r.ticker)).join(',')})`)
    : await sql(`
        select id, upper(symbol) as symbol from public.assets
         where symbol is not null and upper(symbol) in (${rows.map(r => lit(r.ticker)).join(',')})`)
  const idOf = new Map(idRows.map(r => [String(r.symbol).toUpperCase(), r.id]))
  const matched = rows.filter(r => idOf.has(r.ticker))
  console.log(`constituents matched to assets : ${matched.length} of ${rows.length}`)

  let snapshots = 0
  let written = 0
  for (const t of targets) {
    if (USE_REST) {
      await rest('benchmark_weight_snapshots?on_conflict=portfolio_id,source,as_of_date', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{
          portfolio_id: t.portfolio_id, index_name: SOURCE.index, source: SOURCE.proxy,
          source_type: SOURCE.sourceType, as_of_date: asOf, weight_sum: sum,
          holdings_count: rows.length, organization_id: t.organization_id,
        }]),
      })
    } else {
      await sql(`
        insert into public.benchmark_weight_snapshots
          (portfolio_id, index_name, source, source_type, as_of_date, weight_sum, holdings_count, organization_id)
        values (${lit(t.portfolio_id)}::uuid, ${lit(SOURCE.index)}, ${lit(SOURCE.proxy)},
                ${lit(SOURCE.sourceType)}, ${lit(asOf)}::date, ${sum}, ${rows.length},
                ${lit(t.organization_id)}::uuid)
        on conflict (portfolio_id, source, as_of_date) do update
          set weight_sum = excluded.weight_sum, holdings_count = excluded.holdings_count`)
    }
    snapshots += 1

    const CHUNK = 150
    for (let i = 0; i < matched.length; i += CHUNK) {
      const slice = matched.slice(i, i + CHUNK)
      if (USE_REST) {
        await rest('portfolio_benchmark_weights?on_conflict=portfolio_id,asset_id,as_of_date', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(slice.map(r => ({
            portfolio_id: t.portfolio_id, asset_id: idOf.get(r.ticker),
            weight: r.weight, source: SOURCE.proxy, as_of_date: asOf,
          }))),
        })
      } else {
        const values = slice
          .map(r => `(${lit(t.portfolio_id)}::uuid, ${lit(idOf.get(r.ticker))}::uuid, ${r.weight}, ${lit(SOURCE.proxy)}, ${lit(asOf)}::date)`)
          .join(',')
        await sql(`
          insert into public.portfolio_benchmark_weights (portfolio_id, asset_id, weight, source, as_of_date)
          values ${values}
          on conflict (portfolio_id, asset_id, as_of_date) do update set weight = excluded.weight`)
      }
      written += Math.min(CHUNK, matched.length - i)
      await new Promise(r => setTimeout(r, 400))
    }
  }

  console.log(`snapshots written             : ${snapshots}`)
  console.log(`weight rows written           : ${written}`)

  if (targets.length > 0 && written === 0) {
    console.error('FAIL: portfolios to capture for, but nothing written.')
    process.exit(1)
  }
  console.log('PASS')
}

main().catch(e => { console.error(`FAIL: ${e.message}`); process.exit(1) })
