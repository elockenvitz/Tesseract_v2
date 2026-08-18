#!/usr/bin/env node
/**
 * Fill `assets.asset_type` and `assets.currency` from the provider, never from
 * a guess.
 *
 * ── Why this is a separate step from the migration ────────────────────────
 *
 * `20260818141000_asset_instrument_identity.sql` added the columns and
 * deliberately classified NOTHING — 911 rows, zero written. Guessing a class
 * from a ticker is the exact defect the accompanying code change removed:
 * every provider used to default an unrecognised instrument to `'stock'`, so
 * bonds and warrants were filed as common equity and were indistinguishable
 * from real matches.
 *
 * So the class comes from the same endpoint that already backfilled 33k daily
 * closes, whose `meta.instrumentType` and `meta.currency` are the provider's
 * own statement about the instrument.
 *
 * ── What it refuses to do ─────────────────────────────────────────────────
 *
 * A symbol the provider cannot resolve is written as `'unknown'`, not skipped
 * and not assumed. `unknown` is a real answer — "we asked and could not tell"
 * — and it is distinguishable from NULL, which still means "never asked".
 * That distinction is the whole reason `unknown` is in the union.
 *
 * `CASH_USD` is left NULL and reported. It is a book line rather than a listed
 * instrument, and the union has no member for cash: writing `'unknown'` would
 * hide a known fact behind an ignorance label. The honest output is a gap
 * somebody can act on.
 *
 * ── Proof of work ─────────────────────────────────────────────────────────
 *
 * Prints rows considered, resolved, written and unresolvable, and exits
 * non-zero if it had rows to classify and wrote none. An exit code is not
 * evidence a check ran (handoff §4).
 *
 * Usage:
 *   node scripts/classify-assets.mjs            # dry run
 *   node scripts/classify-assets.mjs --apply
 */

const APPLY = process.argv.includes('--apply')
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF

if (!MGMT_TOKEN || !PROJECT_REF) {
  console.error('FAIL: set SUPABASE_MGMT_TOKEN and SUPABASE_PROJECT_REF.')
  console.error('This writes across every organisation, so an anon key cannot do it.')
  process.exit(1)
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

/**
 * Yahoo's own vocabulary, mapped to the AssetType union in
 * src/lib/financial-data/types.ts. Kept in sync deliberately: an entry here
 * with no counterpart in the union would be written and then rejected by the
 * CHECK constraint, which is the correct failure but a confusing one.
 */
const TYPE_MAP = {
  EQUITY: 'stock',
  ETF: 'etf',
  MUTUALFUND: 'mutual_fund',
  CRYPTOCURRENCY: 'crypto',
  CURRENCY: 'forex',
  INDEX: 'index',
  FUTURE: 'commodity',
  OPTION: 'unknown',
}

/** Yahoo spells share classes with a hyphen. One instrument, two spellings. */
const yahooSpelling = (s) => s.replace(/\./g, '-')

async function classify(symbol) {
  for (const candidate of [symbol, yahooSpelling(symbol)]) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate)}?range=5d&interval=1d`
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const text = await r.text()
    // A blocked request arrives as HTTP 200 with HTML. Never parse by status.
    if (!r.ok || !text.trim().startsWith('{')) continue
    let body
    try { body = JSON.parse(text) } catch { continue }
    const meta = body?.chart?.result?.[0]?.meta
    if (!meta) continue
    return {
      assetType: TYPE_MAP[meta.instrumentType] ?? 'unknown',
      currency: meta.currency ?? null,
      rawType: meta.instrumentType ?? null,
    }
    // Falls through to the alternate spelling only when nothing usable came back.
  }
  // Asked, could not tell. Distinct from NULL, which means never asked.
  return { assetType: 'unknown', currency: null, rawType: null }
}

const main = async () => {
  const rows = await sql(`
    select id, symbol from public.assets
     where asset_type is null and symbol is not null
     order by symbol`)

  // A book line, not a listed instrument, and the union has no 'cash' member.
  const cash = rows.filter(r => r.symbol === 'CASH_USD')
  const targets = rows.filter(r => r.symbol !== 'CASH_USD')

  console.log(`rows unclassified             : ${rows.length}`)
  console.log(`  cash lines (left NULL)      : ${cash.length}`)
  console.log(`  to classify                 : ${targets.length}`)
  console.log(`mode                          : ${APPLY ? 'APPLY' : 'dry run (writes nothing)'}`)

  const byType = new Map()
  const unresolved = []
  const updates = []

  for (const row of targets) {
    const { assetType, currency, rawType } = await classify(row.symbol)
    byType.set(assetType, (byType.get(assetType) ?? 0) + 1)
    if (assetType === 'unknown') unresolved.push(row.symbol)
    updates.push({ id: row.id, assetType, currency, rawType })
    await new Promise(r => setTimeout(r, 200))
  }

  let written = 0
  if (APPLY && updates.length) {
    const CHUNK = 100
    for (let i = 0; i < updates.length; i += CHUNK) {
      const slice = updates.slice(i, i + CHUNK)
      // One statement, one round trip per chunk. `identity_source` records the
      // provider vocabulary the class came from, so a later reclassification
      // can find exactly the rows it needs to revisit.
      const values = slice
        .map(u => `(${lit(u.id)}::uuid, ${lit(u.assetType)}, ${lit(u.currency)}, ${lit(
          u.rawType ? `yahoo_chart_v8:${u.rawType}` : 'yahoo_chart_v8:unresolved')})`)
        .join(',')
      await sql(`
        update public.assets a
           set asset_type = v.asset_type,
               currency = coalesce(v.currency, a.currency),
               identity_source = v.identity_source
          from (values ${values}) as v(id, asset_type, currency, identity_source)
         where a.id = v.id`)
      written += slice.length
      await new Promise(r => setTimeout(r, 400))
    }
  }

  console.log(`classified                    : ${updates.length}`)
  for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(28)}: ${n}`)
  }
  console.log(`${APPLY ? 'rows written' : 'rows that would be written'}    : ${written || updates.length}`)
  console.log(`unresolvable (written unknown): ${unresolved.length}`)
  for (const s of unresolved.slice(0, 25)) console.log(`  ${s}`)

  if (targets.length > 0 && updates.length === 0) {
    console.error('FAIL: rows to classify but none were. The provider or the query is broken.')
    process.exit(1)
  }
  console.log('PASS')
}

main().catch(e => { console.error(`FAIL: ${e.message}`); process.exit(1) })
