#!/usr/bin/env node
/**
 * Positions that reference no asset, and therefore do not exist.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `holdings-api` resolves each uploaded symbol against `assets` and, for
 * anything it cannot match, does two things:
 *
 *   warnings.push(`Unresolved symbols: ...`)          // read by NOTHING
 *   asset_id: assetMap.get(p.symbol) || null          // inserted anyway
 *
 * So the position lands with a null foreign key and the raw ticker. It is not
 * dropped — it is orphaned, which is worse, because it looks like a successful
 * upload. With no `asset_id` it can never join to a price, a benchmark weight,
 * an asset_type or a card. The money is in the book and invisible to the
 * entire product.
 *
 * Measured 2026-08-18: 26 positions, all DUOL — Duolingo, a live and perfectly
 * ordinary listing that simply was not in `assets`. Nothing anywhere reported
 * it, because nothing reads `warnings`.
 *
 * ── Why a nightly reconciler rather than a fix inside the edge function ───
 *
 * The edge function is the right long-term home and should also do this at
 * ingest. But changing it means deploying a live production function, and it
 * would only help FUTURE uploads — the 26 already orphaned would stay
 * invisible. This closes the existing hole and every future one within a day,
 * with no deploy, on the schedule that already exists.
 *
 * ── What it will and will not create ──────────────────────────────────────
 *
 * Creates an asset ONLY when the provider resolves the ticker and returns an
 * instrument type. Then it is created already classified — asset_type,
 * currency, lifecycle_status, identity_source — so a new name never needs the
 * retroactive classification pass the first 911 rows needed.
 *
 * It does NOT invent a row for a ticker the provider does not recognise. A
 * typo in an upload would otherwise mint a permanent junk asset that every
 * screen then has to ignore. Those are REPORTED instead, by symbol and by
 * position count, so a person can see exactly what is invisible and how much
 * of it there is — which is the thing `warnings` was supposed to do and never
 * did.
 *
 * Usage:
 *   node scripts/reconcile-orphan-positions.mjs           # report only
 *   node scripts/reconcile-orphan-positions.mjs --apply
 */

const APPLY = process.argv.includes('--apply')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL

if (!SERVICE_KEY || !SUPABASE_URL) {
  console.error('FAIL: set SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL.')
  process.exit(1)
}

const rest = async (path, init = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  })
  if (!r.ok) throw new Error(`rest ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  const b = await r.text()
  return b ? JSON.parse(b) : []
}

/** Mirrors the map in classify-assets.mjs and the AssetType union. */
const TYPE_MAP = {
  EQUITY: 'stock', ETF: 'etf', MUTUALFUND: 'mutual_fund',
  CRYPTOCURRENCY: 'crypto', CURRENCY: 'forex', INDEX: 'index',
  FUTURE: 'commodity', OPTION: 'unknown',
}

/** Yahoo spells share classes with a hyphen: BRK.B is BRK-B. */
const yahooSpelling = (s) => s.replace(/\./g, '-')

/**
 * Identify a ticker from the provider.
 *
 * The chart endpoint is used rather than search because at ingest a symbol is
 * ALL we have — there is no company name to match against, which is what makes
 * the venue-ambiguity guard in resolve-instrument-lifecycle.mjs possible there
 * and impossible here. An exact ticker lookup has no such ambiguity: it either
 * is that instrument or it is not.
 */
async function identify(symbol) {
  for (const candidate of [symbol, yahooSpelling(symbol)]) {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate)}?range=5d&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const t = await r.text()
    // A block arrives as HTTP 200 with HTML; never parse on status alone.
    if (!r.ok || !t.trim().startsWith('{')) continue
    let meta
    try { meta = JSON.parse(t)?.chart?.result?.[0]?.meta } catch { continue }
    if (!meta?.instrumentType) continue
    return {
      assetType: TYPE_MAP[meta.instrumentType] ?? 'unknown',
      currency: meta.currency ?? null,
      companyName: meta.longName || meta.shortName || null,
      rawType: meta.instrumentType,
      tradedSymbol: candidate,
    }
  }
  return null
}

const main = async () => {
  // Paginated for the same reason everything else here is: PostgREST caps at
  // 1,000 rows and a silent first page reads as a complete answer.
  const orphans = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const page = await rest(
      'portfolio_holdings_positions?select=id,symbol,market_value&asset_id=is.null',
      { headers: { Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } })
    orphans.push(...page)
    if (page.length < PAGE) break
  }

  const bySymbol = new Map()
  for (const p of orphans) {
    const s = String(p.symbol || '').toUpperCase()
    if (!s) continue
    const e = bySymbol.get(s) ?? { symbol: s, positions: 0, value: 0 }
    e.positions += 1
    e.value += Number(p.market_value) || 0
    bySymbol.set(s, e)
  }

  console.log(`orphaned positions   : ${orphans.length}`)
  console.log(`distinct symbols     : ${bySymbol.size}`)
  console.log(`mode                 : ${APPLY ? 'APPLY' : 'report only'}`)
  console.log('')

  const created = []
  const unidentified = []

  for (const e of [...bySymbol.values()].sort((a, b) => b.value - a.value)) {
    const id = await identify(e.symbol)
    if (!id) {
      unidentified.push(e)
      console.log(`${e.symbol.padEnd(8)} UNIDENTIFIED  ${e.positions} positions, $${Math.round(e.value).toLocaleString()}`)
      continue
    }
    console.log(`${e.symbol.padEnd(8)} ${id.assetType.padEnd(12)} ${e.positions} positions, $${Math.round(e.value).toLocaleString()}  ${id.companyName ?? ''}`)

    if (APPLY) {
      // An asset may already exist under this ticker even though the positions
      // were orphaned — the upload predated it. Reuse rather than duplicate.
      const found = await rest(`assets?select=id&symbol=eq.${encodeURIComponent(e.symbol)}&limit=1`)
      let assetId = found[0]?.id
      if (!assetId) {
        const [row] = await rest('assets?select=id', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify([{
            symbol: e.symbol,
            company_name: id.companyName,
            asset_type: id.assetType,
            currency: id.currency,
            // Created already classified, so a new name never needs the
            // retroactive pass the first 911 rows needed.
            lifecycle_status: 'active',
            current_symbol: id.tradedSymbol,
            lifecycle_checked_at: new Date().toISOString(),
            lifecycle_note: 'created by orphan-position reconciliation',
            identity_source: `yahoo_chart_v8:${id.rawType}`,
          }]),
        })
        assetId = row?.id
      }
      if (assetId) {
        await rest(`portfolio_holdings_positions?asset_id=is.null&symbol=eq.${encodeURIComponent(e.symbol)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ asset_id: assetId }),
        })
        created.push(e.symbol)
      }
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log('')
  console.log(`${APPLY ? 'symbols linked' : 'symbols that would link'} : ${APPLY ? created.length : bySymbol.size - unidentified.length}`)
  console.log(`unidentified          : ${unidentified.length}`)
  if (unidentified.length) {
    console.log('')
    console.log('These positions are in the books and invisible to every card.')
    console.log('No asset row is invented for them — a typo would become permanent junk.')
    for (const e of unidentified) {
      console.log(`  ${e.symbol}: ${e.positions} positions, $${Math.round(e.value).toLocaleString()}`)
    }
  }

  // Nothing orphaned is the normal state, so an empty run is a pass, not a
  // failure — unlike the backfills, where zero rows means something broke.
  console.log('PASS')
}

main().catch(e => { console.error(`FAIL: ${e.message}`); process.exit(1) })
