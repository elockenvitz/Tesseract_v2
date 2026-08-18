#!/usr/bin/env node
/**
 * What happened to the tickers that no longer resolve.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * Nothing in this product handles a ticker change or a delisting. A symbol is
 * the de-facto identity of an asset, so when an issuer renames — Square to
 * Block, SQ to XYZ — the row keeps the dead ticker and every downstream lookup
 * silently stops finding it. The position is still held. The price series just
 * ends.
 *
 * That is not hypothetical: two held positions (SQ, ZOOM) have zero rows in
 * `price_history_cache`, so `buildWeightSeries` correctly skips every day for
 * their books rather than marking them at a stale price. The data is missing
 * for a reason nobody recorded.
 *
 * ── Three outcomes, deliberately distinguished ────────────────────────────
 *
 * `asset_type = 'unknown'` conflated two different questions — WHAT is this,
 * and DOES IT STILL TRADE. This separates them:
 *
 *   renamed    — a successor trades under a different ticker, and its issuer
 *                name matches ours. Same instrument, new identity.
 *   delisted   — no chart, and no primary listing found by name. Acquired,
 *                merged or wound up.
 *   unresolved — ambiguous or the provider failed. Explicitly NOT a verdict;
 *                it means a human has to look.
 *
 * ── Why the match is verified rather than taken ───────────────────────────
 *
 * Searching "Zoom Video Communications" returns `5ZM.DU`, `5ZM.HM` and
 * `5ZM.SG` — Düsseldorf, Hamburg and Stuttgart — BEFORE the US listing. Taking
 * the first result would move a US position onto a German venue in euros and
 * look entirely successful.
 *
 * So a candidate is only accepted when it is a primary US listing (no venue
 * suffix) AND its issuer name matches ours on a normalised comparison. Anything
 * else is `unresolved`, which a person can settle in seconds and a script
 * cannot settle safely at all.
 *
 * Usage:
 *   node scripts/resolve-instrument-lifecycle.mjs           # report only
 *   node scripts/resolve-instrument-lifecycle.mjs --apply   # needs the migration
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

/**
 * Renames a person confirmed that the automatic check refuses to.
 *
 * The resolver only accepts a successor whose issuer name matches ours exactly
 * after normalisation, which is what stops it moving a US position onto a
 * German venue. That strictness produces near-misses when a company changes
 * its NAME as well as its ticker, and those need a human, not a looser rule —
 * loosening the match is how you end up mapping "Block" to "H&R Block".
 *
 * Every entry records the evidence that settled it. Add one only after
 * checking the successor's own issuer name at the provider.
 */
const REVIEWED_RENAMES = {
  // Our row says "Zoom Video Communications"; ZM reports "Zoom Communications,
  // Inc." — the company dropped "Video" in 2025, so the ticker never moved and
  // only the name did. Verified 2026-08-18: ZM resolves, EQUITY, USD.
  ZOOM: { successor: 'ZM', evidence: 'ZM issuer name "Zoom Communications, Inc."; ours predates the 2025 name change' },
}

/** Strip the noise that differs between an issuer's own name and a vendor's. */
const normalise = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[.,]/g, '')
  .replace(/\b(inc|corp|corporation|company|co|ltd|plc|holdings|group|the|sa|nv|ag)\b/g, '')
  .replace(/\s+/g, ' ')
  .trim()

/** A US primary listing has no venue suffix. XYZ is; XYZ.AX and 5ZM.DU are not. */
const isPrimaryUsListing = (symbol) => /^[A-Z]{1,5}$/.test(symbol)

const chartResolves = async (symbol) => {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const t = await r.text()
  // Status alone is not enough: a block arrives as 200 with HTML.
  return r.ok && t.trim().startsWith('{') && !!JSON.parse(t)?.chart?.result?.[0]
}

const searchByName = async (name) => {
  const r = await fetch(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=8&newsCount=0`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const t = await r.text()
  if (!r.ok || !t.trim().startsWith('{')) return []
  try { return JSON.parse(t)?.quotes ?? [] } catch { return [] }
}

async function resolve(asset) {
  // Still trades under its own ticker? Then nothing happened to it.
  if (await chartResolves(asset.symbol)) {
    return { status: 'active', successor: null, note: 'chart resolves under its own ticker' }
  }

  // A human already settled this one. Still verified against the provider on
  // every run, so a reviewed entry that stops resolving becomes visible rather
  // than being trusted forever.
  const reviewed = REVIEWED_RENAMES[String(asset.symbol).toUpperCase()]
  if (reviewed) {
    if (await chartResolves(reviewed.successor)) {
      return { status: 'renamed', successor: reviewed.successor, note: `reviewed: ${reviewed.evidence}` }
    }
    return { status: 'unresolved', successor: null, note: `reviewed successor ${reviewed.successor} no longer resolves` }
  }

  const wanted = normalise(asset.company_name)
  if (!wanted) {
    return { status: 'unresolved', successor: null, note: 'no company name to match on' }
  }

  const quotes = await searchByName(asset.company_name)
  const candidates = quotes.filter(q =>
    q.symbol && isPrimaryUsListing(q.symbol) &&
    normalise(q.longname || q.shortname) === wanted)

  if (candidates.length === 1) {
    return {
      status: 'renamed',
      successor: candidates[0].symbol,
      note: `name match on primary US listing (${candidates[0].longname || candidates[0].shortname})`,
    }
  }
  if (candidates.length > 1) {
    // Two primary US listings with the same issuer name is a real ambiguity —
    // share classes, most likely. A script must not pick.
    return { status: 'unresolved', successor: null, note: `${candidates.length} equally good candidates` }
  }
  if (quotes.length === 0) {
    return { status: 'delisted', successor: null, note: 'no chart and no search result' }
  }
  // Results exist but none is a US primary listing whose name matches. That is
  // exactly the Zoom case — three German venues and no verdict to draw.
  return {
    status: 'unresolved',
    successor: null,
    note: `${quotes.length} results, none a matching US primary listing (e.g. ${quotes.slice(0, 3).map(q => q.symbol).join(', ')})`,
  }
}

const main = async () => {
  const assets = await rest(
    'assets?select=id,symbol,company_name&asset_type=eq.unknown&order=symbol')
  console.log(`assets to resolve : ${assets.length}`)
  console.log(`mode              : ${APPLY ? 'APPLY' : 'report only'}`)
  console.log('')

  const out = []
  for (const a of assets) {
    const r = await resolve(a)
    out.push({ ...a, ...r })
    console.log(`${String(a.symbol).padEnd(7)} ${r.status.padEnd(11)} ${(r.successor ?? '-').padEnd(7)} ${a.company_name ?? ''}`)
    if (r.note) console.log(`        ${r.note}`)
    await new Promise(res => setTimeout(res, 450))
  }

  const by = (s) => out.filter(o => o.status === s)
  console.log('')
  console.log(`active     : ${by('active').length}`)
  console.log(`renamed    : ${by('renamed').length}  ${by('renamed').map(o => `${o.symbol}->${o.successor}`).join(', ')}`)
  console.log(`delisted   : ${by('delisted').length}`)
  console.log(`unresolved : ${by('unresolved').length}`)

  if (!APPLY) { console.log('\nPASS (report only)'); return }

  let written = 0
  for (const o of out) {
    await rest(`assets?id=eq.${o.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        lifecycle_status: o.status,
        // The ticker it trades under NOW. Left equal to `symbol` unless it
        // genuinely moved, so every price lookup can use one coalesce.
        current_symbol: o.successor ?? o.symbol,
        lifecycle_checked_at: new Date().toISOString(),
        lifecycle_note: o.note,
      }),
    })
    written += 1
  }
  console.log(`\nrows updated : ${written}`)
  if (out.length > 0 && written === 0) {
    console.error('FAIL: rows to update but none were.')
    process.exit(1)
  }
  console.log('PASS')
}

main().catch(e => { console.error(`FAIL: ${e.message}`); process.exit(1) })
