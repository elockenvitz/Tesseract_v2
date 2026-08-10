/**
 * market-events — calendar-shaped market data for the Ideas feed.
 *
 * Companion to `market-news`, split out because these are a different kind of
 * thing: dated events with numbers attached rather than stories. Same
 * constraints apply — browser CORS and server-only API keys — so the same
 * edge-function pattern.
 *
 * Returns four sets, each independently degradable:
 *
 *   upcomingEarnings   date + consensus EPS/revenue estimate
 *   recentEarnings     reported vs estimate, and the surprise
 *   corporateActions   dividend declarations (buybacks come via news)
 *   economicReleases   upcoming macro prints with prior/consensus
 *
 * Finnhub covers all four on one key. Alpha Vantage is used for earnings
 * surprises where present because its history goes back further. If no key is
 * configured the function returns empty sets rather than failing: the feed
 * templates that consume it simply produce no cards, and everything else in
 * the feed carries on.
 *
 * POST { symbols: string[], lookaheadDays?: number, lookbackDays?: number }
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SOURCE_TIMEOUT_MS = 6_000
const CACHE_TTL_MS = 15 * 60 * 1000
const MAX_SYMBOLS = 12

const cache = new Map<string, { data: unknown; expiresAt: number }>()

export interface UpcomingEarnings {
  symbol: string
  date: string
  hour?: string
  epsEstimate?: number
  revenueEstimate?: number
  quarter?: number
  year?: number
}

export interface RecentEarnings {
  symbol: string
  date: string
  epsActual?: number
  epsEstimate?: number
  surprisePercent?: number
  revenueActual?: number
  revenueEstimate?: number
}

export interface CorporateAction {
  symbol: string
  type: 'dividend'
  amount?: number
  currency?: string
  exDate?: string
  payDate?: string
  declaredDate?: string
  frequency?: number
}

export interface EconomicRelease {
  event: string
  country: string
  time: string
  actual?: number | null
  estimate?: number | null
  prior?: number | null
  impact?: string
  unit?: string
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]).catch(() => fallback)
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Tesseract/1.0' } })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

// ── Sources ────────────────────────────────────────────────────────────────

async function earningsCalendar(
  key: string, symbols: string[], from: string, to: string
): Promise<UpcomingEarnings[]> {
  // One call for the window, filtered locally — the per-symbol endpoint would
  // be `symbols.length` round-trips for the same data.
  const data = await fetchJson(
    `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`
  )
  const wanted = new Set(symbols)
  return (data?.earningsCalendar ?? [])
    .filter((e: any) => wanted.has(e?.symbol))
    .map((e: any) => ({
      symbol: e.symbol,
      date: e.date,
      hour: e.hour || undefined,
      epsEstimate: e.epsEstimate ?? undefined,
      revenueEstimate: e.revenueEstimate ?? undefined,
      quarter: e.quarter ?? undefined,
      year: e.year ?? undefined,
    }))
}

async function earningsSurprises(key: string, symbols: string[]): Promise<RecentEarnings[]> {
  const out: RecentEarnings[] = []
  for (const symbol of symbols) {
    try {
      const data = await fetchJson(
        `https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(symbol)}&limit=1&token=${key}`
      )
      const latest = Array.isArray(data) ? data[0] : null
      if (!latest?.period) continue
      out.push({
        symbol,
        date: latest.period,
        epsActual: latest.actual ?? undefined,
        epsEstimate: latest.estimate ?? undefined,
        surprisePercent: latest.surprisePercent ?? undefined,
      })
    } catch { /* skip */ }
  }
  return out
}

async function dividends(
  key: string, symbols: string[], from: string, to: string
): Promise<CorporateAction[]> {
  const out: CorporateAction[] = []
  for (const symbol of symbols) {
    try {
      const data = await fetchJson(
        `https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`
      )
      for (const d of Array.isArray(data) ? data : []) {
        out.push({
          symbol,
          type: 'dividend',
          amount: d.amount ?? undefined,
          currency: d.currency ?? undefined,
          exDate: d.date ?? undefined,
          payDate: d.payDate ?? undefined,
          declaredDate: d.declarationDate ?? undefined,
          frequency: d.freq ?? undefined,
        })
      }
    } catch { /* skip */ }
  }
  return out
}

async function economicCalendar(key: string, from: string, to: string): Promise<EconomicRelease[]> {
  const data = await fetchJson(
    `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`
  )
  return (data?.economicCalendar ?? [])
    // US only by default: a feed that opens with Latvian PPI is noise for a
    // book of US equities. Widening this is a filter change, not a rewrite.
    .filter((e: any) => e?.country === 'US')
    .map((e: any) => ({
      event: e.event,
      country: e.country,
      time: e.time,
      actual: e.actual ?? null,
      estimate: e.estimate ?? null,
      prior: e.prev ?? null,
      impact: e.impact ?? undefined,
      unit: e.unit ?? undefined,
    }))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { symbols?: unknown; lookaheadDays?: unknown; lookbackDays?: unknown }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const symbols = Array.isArray(body.symbols)
    ? body.symbols
        .filter((s): s is string => typeof s === 'string')
        .map(s => s.trim().toUpperCase())
        .filter(s => /^[A-Z0-9.\-]{1,10}$/.test(s))
        .slice(0, MAX_SYMBOLS)
    : []

  const key = Deno.env.get('FINNHUB_API_KEY')
  const empty = {
    upcomingEarnings: [], recentEarnings: [], corporateActions: [], economicReleases: [],
    configured: !!key,
  }
  if (!key) {
    return new Response(JSON.stringify(empty), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const lookahead = Math.min(Math.max(Number(body.lookaheadDays) || 21, 1), 90)
  const lookback = Math.min(Math.max(Number(body.lookbackDays) || 14, 1), 90)

  const cacheKey = `${symbols.join(',')}|${lookahead}|${lookback}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expiresAt > Date.now()) {
    return new Response(JSON.stringify(hit.data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    })
  }

  const now = new Date()
  const past = fmtDate(new Date(now.getTime() - lookback * 86400_000))
  const today = fmtDate(now)
  const future = fmtDate(new Date(now.getTime() + lookahead * 86400_000))

  // Economic releases are symbol-independent, so they run even when the caller
  // sent no symbols — a macro print matters to a book regardless of which
  // names happen to be on screen.
  const [upcomingEarnings, recentEarnings, corporateActions, economicReleases] = await Promise.all([
    symbols.length ? withTimeout(earningsCalendar(key, symbols, today, future), SOURCE_TIMEOUT_MS, []) : Promise.resolve([]),
    symbols.length ? withTimeout(earningsSurprises(key, symbols), SOURCE_TIMEOUT_MS, []) : Promise.resolve([]),
    symbols.length ? withTimeout(dividends(key, symbols, past, future), SOURCE_TIMEOUT_MS, []) : Promise.resolve([]),
    withTimeout(economicCalendar(key, past, future), SOURCE_TIMEOUT_MS, []),
  ])

  const payload = {
    upcomingEarnings,
    // Only surprises inside the lookback window are "recent" — Finnhub returns
    // the latest reported quarter whenever it was, which for a lagging filer
    // could be months ago.
    recentEarnings: recentEarnings.filter(r => r.date >= past),
    corporateActions,
    economicReleases,
    configured: true,
  }

  cache.set(cacheKey, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS })

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  })
})
