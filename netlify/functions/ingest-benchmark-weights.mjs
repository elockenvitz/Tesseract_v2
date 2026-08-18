/**
 * ingest-benchmark-weights — daily SSGA holdings into portfolio_benchmark_weights.
 *
 * ── Why an ETF, and why it must say so ────────────────────────────────────
 *
 * SPY is not the S&P 500. It is a fund tracking it, with its own cash drag,
 * rebalance lag and as-of date. Every snapshot is therefore written with
 * `source_type = 'etf_proxy'`, and any card computed from it states that on its
 * face. A licensed benchmark feed is a pilot prerequisite; this is a demo-grade
 * stand-in that is honest about being one.
 *
 * SSGA is also the ONLY issuer whose holdings file is reachable. iShares and
 * Invesco both return HTTP 200 carrying an HTML bot interstitial — not a
 * licensing block, and that class of block escalates. Assume this feed can
 * vanish; the failure path below is the important part of this function, not
 * the happy path.
 *
 * ── Failure is silence, never stale ───────────────────────────────────────
 *
 * Nothing is written unless the whole file parses AND its weights sum inside
 * 99-101%. A snapshot outside that band is REJECTED, not rounded — and the
 * actual sum is stored unrounded (99.9775, not 100) so a later reader can
 * verify the rule was applied rather than trusting that it was.
 *
 * On any failure the previous snapshot is left untouched and no new one is
 * written. Staleness is then enforced downstream, in the builder, by reading
 * `as_of_date`: past the ceiling, active risk suppresses rather than computes.
 * Serving stale weights silently is the failure this whole design exists to
 * prevent, so the ceiling lives with the consumer, not here — a stalled
 * ingester cannot produce a confident card no matter what is in the table.
 *
 * Scheduled daily. Never invoked on demand by a card: a slow issuer must never
 * become a slow feed.
 */

const SSGA = slug =>
  `https://www.ssga.com/us/en/institutional/library-content/products/fund-data/etfs/us/holdings-daily-us-en-${slug}.xlsx`

/**
 * Only mappings where the ETF tracks the SAME index the portfolio names.
 *
 * Russell 1000 Growth/Value and Russell 2000 Growth are deliberately absent:
 * the only reachable proxies are S&P style funds, which are a different index
 * family with different constituents and a different rebalance. Substituting
 * across families would be inventing a benchmark — the same error as
 * normalising a probability distribution that does not sum to 100.
 */
const INDEX_TO_ETF = {
  'S&P 500': { etf: 'SPY', slug: 'spy' },
}

const WEIGHT_SUM_MIN = 99.0
const WEIGHT_SUM_MAX = 101.0

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body, null, 2),
})

/** Minimal XLSX reader: the sheet is a flat table, so a full parser is overkill. */
async function readHoldings(buf) {
  const { default: XLSX } = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false })

  const asOfCell = (rows.find(r => String(r[0]).startsWith('Holdings')) || [])[1]
  // "As of 14-Aug-2026" — taken from the FILE, never from ingestion time.
  const m = /As of (\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(String(asOfCell || ''))
  if (!m) return { error: 'no as-of date in file' }
  const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                   Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
  const asOf = `${m[3]}-${months[m[2]]}-${String(m[1]).padStart(2, '0')}`

  const headerIdx = rows.findIndex(r => r[0] === 'Name' && r[4] === 'Weight')
  if (headerIdx < 0) return { error: 'no header row — file format changed' }

  const holdings = rows.slice(headerIdx + 1)
    .filter(r => r[1] && typeof r[4] === 'number' && r[4] > 0)
    .map(r => ({ symbol: String(r[1]).trim().toUpperCase(), weight: r[4] }))

  if (!holdings.length) return { error: 'no holdings rows' }
  return { asOf, holdings, weightSum: holdings.reduce((n, h) => n + h.weight, 0) }
}

async function sb(path, init = {}) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

export const handler = async () => {
  const report = { ingested: [], skipped: [], rejected: [] }

  // Every portfolio whose named benchmark has a same-index ETF available.
  const indexes = Object.keys(INDEX_TO_ETF)
  const portfolios = await sb(
    `portfolios?select=id,name,benchmark,organization_id&benchmark=in.(${indexes.map(encodeURIComponent).join(',')})`,
  )
  if (!portfolios.length) return reply(200, { ...report, note: 'no portfolios name a supported index' })

  const files = new Map()
  for (const index of indexes) {
    const { etf, slug } = INDEX_TO_ETF[index]
    try {
      const res = await fetch(SSGA(slug), {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' },
      })
      if (!res.ok) { report.skipped.push({ index, reason: `http ${res.status}` }); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      // A 200 carrying HTML is a bot interstitial. `PK` is the zip magic every
      // real xlsx starts with.
      if (buf.slice(0, 2).toString() !== 'PK') {
        report.skipped.push({ index, reason: 'not an xlsx — interstitial?' })
        continue
      }
      const parsed = await readHoldings(buf)
      if (parsed.error) { report.skipped.push({ index, reason: parsed.error }); continue }
      if (parsed.weightSum < WEIGHT_SUM_MIN || parsed.weightSum > WEIGHT_SUM_MAX) {
        // Rejected, never rounded. A file whose weights do not sum is a bad
        // file, and writing it would put a wrong denominator behind every
        // active-weight number on the surface.
        report.rejected.push({ index, weightSum: parsed.weightSum })
        continue
      }
      files.set(index, { ...parsed, etf })
    } catch (e) {
      report.skipped.push({ index, reason: String(e).slice(0, 160) })
    }
  }

  if (!files.size) return reply(200, { ...report, note: 'nothing written; previous snapshots untouched' })

  // Symbols must resolve to assets this database knows about.
  const allSymbols = [...new Set([...files.values()].flatMap(f => f.holdings.map(h => h.symbol)))]
  const assets = new Map()
  for (let i = 0; i < allSymbols.length; i += 200) {
    const chunk = allSymbols.slice(i, i + 200)
    const rows = await sb(`assets?select=id,symbol&symbol=in.(${chunk.map(encodeURIComponent).join(',')})`)
    rows.forEach(a => assets.set(String(a.symbol).toUpperCase(), a.id))
  }

  for (const p of portfolios) {
    const file = files.get(p.benchmark)
    if (!file) continue

    const matched = file.holdings
      .map(h => ({ asset_id: assets.get(h.symbol), weight: h.weight }))
      .filter(h => h.asset_id)
    if (!matched.length) { report.skipped.push({ portfolio: p.name, reason: 'no constituents resolve to assets' }); continue }

    const [snapshot] = await sb('benchmark_weight_snapshots', {
      method: 'POST',
      headers: { prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify({
        portfolio_id: p.id,
        index_name: p.benchmark,
        source: file.etf,
        source_type: 'etf_proxy',
        as_of_date: file.asOf,
        weight_sum: file.weightSum,
        holdings_count: file.holdings.length,
        organization_id: p.organization_id,
      }),
    })

    // Replace rather than append: weights are a snapshot, and two snapshots
    // superimposed would double every benchmark weight — the same collapse
    // portfolio_holdings already suffers from.
    await sb(`portfolio_benchmark_weights?portfolio_id=eq.${p.id}`, { method: 'DELETE' })
    for (let i = 0; i < matched.length; i += 500) {
      await sb('portfolio_benchmark_weights', {
        method: 'POST',
        body: JSON.stringify(matched.slice(i, i + 500).map(h => ({
          portfolio_id: p.id,
          asset_id: h.asset_id,
          weight: h.weight,
          source: file.etf,
          as_of_date: file.asOf,
          snapshot_id: snapshot?.id ?? null,
        }))),
      })
    }

    report.ingested.push({
      portfolio: p.name, index: p.benchmark, etf: file.etf,
      asOf: file.asOf, weightSum: file.weightSum,
      constituents: file.holdings.length, matchedToAssets: matched.length,
    })
  }

  return reply(200, report)
}

/** Daily, well after the US close so the file is the current session's. */
export const config = { schedule: '0 7 * * *' }
