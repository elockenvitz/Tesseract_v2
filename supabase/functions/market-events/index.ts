/**
 * market-events — calendar-shaped market data for the Ideas feed.
 *
 * Companion to `market-news`, split out because these are a different kind of
 * thing: dated events with numbers attached rather than stories. Same
 * constraints apply — browser CORS and server-only API keys — so the same
 * edge-function pattern.
 *
 * Caching is in Postgres (`market_data_cache`), not in memory. A module-level
 * Map is per-isolate, and Supabase runs ephemeral instances, so a cold one
 * starts empty and every miss costs a fresh set of provider calls. Shared
 * caching makes provider cost a function of (symbol set × TTL) instead of user
 * count — which is what lets a 60 call/minute free tier serve a whole desk.
 *
 * Upcoming *and* recent earnings both come from `/calendar/earnings`. The
 * per-symbol `/stock/earnings` endpoint reports `period` — the fiscal quarter
 * *end* — not the date the company reported, so filtering it against a
 * two-week lookback silently excluded almost everything: a quarter ending
 * 30 June is typically reported in late July. The calendar carries the real
 * report date alongside actuals, and costs one call instead of one per symbol.
 *
 * `sources` reports each endpoint's HTTP outcome, because Finnhub gates some
 * of these behind paid plans and an empty array otherwise looks identical to
 * "nothing happened this week".
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SOURCE_TIMEOUT_MS = 6_000
const CACHE_TTL_SECONDS = 15 * 60
const MAX_SYMBOLS = 12

interface SourceStatus { name: string; ok: boolean; status?: number; count: number }

interface UpcomingEarnings {
  symbol: string; date: string; hour?: string
  epsEstimate?: number; revenueEstimate?: number
}
interface RecentEarnings {
  symbol: string; date: string
  epsActual?: number; epsEstimate?: number; surprisePercent?: number
  revenueActual?: number; revenueEstimate?: number
}
interface CorporateAction {
  symbol: string; type: 'dividend'
  amount?: number; currency?: string
  exDate?: string; payDate?: string; frequency?: number
}
interface EconomicRelease {
  event: string; country: string; time: string
  actual?: number | null; estimate?: number | null; prior?: number | null
  impact?: string; unit?: string
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

async function cacheGet(key: string): Promise<unknown | null> {
  try {
    const { data } = await admin
      .from('market_data_cache')
      .select('payload, expires_at')
      .eq('cache_key', key)
      .maybeSingle()
    if (!data) return null
    if (new Date((data as any).expires_at).getTime() <= Date.now()) return null
    return (data as any).payload
  } catch { return null }
}

async function cacheSet(key: string, payload: unknown, ttlSeconds: number): Promise<void> {
  try {
    await admin.from('market_data_cache').upsert({
      cache_key: key,
      payload,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    })
  } catch { /* caching is best-effort; never fail the request over it */ }
}

/** Fetch returning the HTTP status, so a gated endpoint is distinguishable. */
async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Tesseract/1.0' } })
  let body: any = null
  try { body = await res.json() } catch { /* non-JSON error page */ }
  return { ok: res.ok, status: res.status, body }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]).catch(() => fallback)
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

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
  if (!key) {
    return new Response(JSON.stringify({
      upcomingEarnings: [], recentEarnings: [], corporateActions: [], economicReleases: [],
      sources: [], configured: false,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const lookahead = Math.min(Math.max(Number(body.lookaheadDays) || 21, 1), 90)
  const lookback = Math.min(Math.max(Number(body.lookbackDays) || 14, 1), 90)

  const cacheKey = `events|${symbols.join(',')}|${lookahead}|${lookback}`
  const cached = await cacheGet(cacheKey)
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    })
  }

  const now = new Date()
  const past = fmtDate(new Date(now.getTime() - lookback * 86400_000))
  const today = fmtDate(now)
  const future = fmtDate(new Date(now.getTime() + lookahead * 86400_000))

  const sources: SourceStatus[] = []
  const wanted = new Set(symbols)

  // ── Earnings: one call spanning past → future, split by report date ──────
  let upcomingEarnings: UpcomingEarnings[] = []
  let recentEarnings: RecentEarnings[] = []
  if (symbols.length) {
    const r = await withTimeout(
      fetchJson(`https://finnhub.io/api/v1/calendar/earnings?from=${past}&to=${future}&token=${key}`),
      SOURCE_TIMEOUT_MS,
      { ok: false, status: 0, body: null },
    )
    const rows = (r.body?.earningsCalendar ?? []).filter((e: any) => wanted.has(e?.symbol))
    for (const e of rows) {
      // Reported when there is an actual, regardless of which side of today
      // the date falls — a company that reported this morning is "recent".
      if (e.epsActual != null || e.date < today) {
        if (e.epsActual == null) continue
        const est = e.epsEstimate
        recentEarnings.push({
          symbol: e.symbol,
          date: e.date,
          epsActual: e.epsActual ?? undefined,
          epsEstimate: est ?? undefined,
          surprisePercent: est ? ((e.epsActual - est) / Math.abs(est)) * 100 : undefined,
          revenueActual: e.revenueActual ?? undefined,
          revenueEstimate: e.revenueEstimate ?? undefined,
        })
      } else {
        upcomingEarnings.push({
          symbol: e.symbol,
          date: e.date,
          hour: e.hour || undefined,
          epsEstimate: e.epsEstimate ?? undefined,
          revenueEstimate: e.revenueEstimate ?? undefined,
        })
      }
    }
    sources.push({ name: 'earnings_calendar', ok: r.ok, status: r.status, count: rows.length })
  }

  // ── Dividends: per symbol, no bulk endpoint ──────────────────────────────
  const corporateActions: CorporateAction[] = []
  if (symbols.length) {
    let ok = true
    let status = 200
    for (const symbol of symbols) {
      const r = await withTimeout(
        fetchJson(`https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${past}&to=${future}&token=${key}`),
        SOURCE_TIMEOUT_MS,
        { ok: false, status: 0, body: null },
      )
      // 403 means the plan does not include this endpoint, which will be true
      // for every remaining symbol too. Carrying on would spend a dozen
      // rate-limited requests to collect a dozen identical refusals — and the
      // limit is shared with the endpoints that do work.
      if (r.status === 403) { ok = false; status = 403; break }
      if (!r.ok) { ok = false; status = r.status; continue }
      for (const d of Array.isArray(r.body) ? r.body : []) {
        corporateActions.push({
          symbol,
          type: 'dividend',
          amount: d.amount ?? undefined,
          currency: d.currency ?? undefined,
          exDate: d.date ?? undefined,
          payDate: d.payDate ?? undefined,
          frequency: d.freq ?? undefined,
        })
      }
    }
    sources.push({ name: 'dividends', ok, status, count: corporateActions.length })
  }

  // ── Economic calendar: symbol-independent, so it runs regardless ─────────
  const econ = await withTimeout(
    fetchJson(`https://finnhub.io/api/v1/calendar/economic?from=${past}&to=${future}&token=${key}`),
    SOURCE_TIMEOUT_MS,
    { ok: false, status: 0, body: null },
  )
  // US only by default: a feed that opens with Latvian PPI is noise for a book
  // of US equities. Widening this is a filter change, not a rewrite.
  const economicReleases: EconomicRelease[] = (econ.body?.economicCalendar ?? [])
    .filter((e: any) => e?.country === 'US')
    .map((e: any) => ({
      event: e.event, country: e.country, time: e.time,
      actual: e.actual ?? null, estimate: e.estimate ?? null, prior: e.prev ?? null,
      impact: e.impact ?? undefined, unit: e.unit ?? undefined,
    }))
  sources.push({ name: 'economic_calendar', ok: econ.ok, status: econ.status, count: economicReleases.length })

  const payload = {
    upcomingEarnings, recentEarnings, corporateActions, economicReleases,
    sources, configured: true,
  }

  await cacheSet(cacheKey, payload, CACHE_TTL_SECONDS)

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  })
})
