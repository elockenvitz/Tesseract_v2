/**
 * yahoo-chart-proxy — server-side Yahoo Finance chart proxy.
 *
 * Yahoo's query1 endpoint blocks browser requests via CORS, and the free
 * public CORS proxies the client used to depend on (corsproxy.io /
 * allorigins.win / codetabs) have been degraded or put behind paywalls,
 * breaking every chart in the app simultaneously.
 *
 * This function takes a minimal parameter set from the client, builds the
 * Yahoo URL server-side (where there is no CORS constraint), forwards the
 * response verbatim. The client then parses it exactly as before.
 *
 * Accepts POST JSON:
 *   {
 *     symbol: string
 *     interval: string   // 1m | 5m | 15m | 30m | 60m | 1d | 1wk | 1mo
 *     range?: string     // 1d | 5d | 1mo | 3mo | 6mo | 1y | 2y | 5y | max
 *     period1?: number   // unix seconds
 *     period2?: number   // unix seconds
 *   }
 *
 * Returns the raw Yahoo JSON (`{ chart: { result: [...], error: ... } }`).
 *
 * ── It also persists daily closes now, and that changed its auth class ───
 *
 * `price_history_cache` used to be filled for an uncached symbol by the
 * BROWSER: two upserts in `src/hooks/usePositionLifecycle.ts`, admitted by the
 * RLS policy "Users can insert price history", whose whole check was
 * `auth.uid() IS NOT NULL`. Measured against production on 2026-11-07, any
 * logged-in user of any organisation could insert any (symbol, date) that did
 * not already exist -- into the table the trade-price gate trusts as dated,
 * sourced market data. The newest real close was 2026-11-06, so every later
 * date was free.
 *
 * The data was never the problem; it already came from Yahoo through here. So
 * the write moved to this function, which holds the service-role key, and the
 * client policy is dropped by
 * `supabase/migrations/20261107190000_sec_price_history_cache_insert_policy.sql`.
 *
 * That makes this function privileged, so it is no longer a bare public proxy:
 *
 *   - It verifies a real signed-in user (`_shared/verified-user.ts`) BEFORE
 *     the Yahoo fetch and before the service-role client exists. The gateway's
 *     verify_jwt admits the public anon key that ships in the browser bundle,
 *     so verify_jwt alone would leave an open price-write endpoint, which is
 *     worse than what it replaces. Same gate as `market-events` /
 *     `market-news`, and registered the same way in `authz-registry.json`.
 *   - It writes with `ignoreDuplicates`, so an existing close is never
 *     revised, only a gap filled. Combined with the dropped INSERT policy and
 *     the absent UPDATE/DELETE policies, no browser-reachable path can change
 *     a close that is already stored.
 *   - It only persists what `_shared/chart-closes.ts` admits: daily bars,
 *     positive finite closes, never a date after today.
 *
 * No tenant check applies: `price_history_cache` carries no `organization_id`
 * and is global reference data by design -- the documented exception in
 * CLAUDE.md Standing Rule 5. The authorization is "a real user, not the bare
 * anon key."
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

import { requirePublishableKey } from '../_shared/publishable-key.ts'
import { authorizeVerifiedUser } from '../_shared/verified-user.ts'
import { dailyClosesFromYahooChart } from '../_shared/chart-closes.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ChartRequest {
  symbol?: string
  interval?: string
  range?: string
  period1?: number
  period2?: number
}

const ALLOWED_INTERVALS = new Set([
  '1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h',
  '1d', '5d', '1wk', '1mo', '3mo',
])

const ALLOWED_RANGES = new Set([
  '1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max',
])

// Simple per-symbol in-memory cache to smooth over repeated requests
// within a warm instance. TTL is short (30s) — chart views refetch on
// timeframe switches and we don't want to serve stale intraday data.
const cache = new Map<string, { data: unknown; expiresAt: number }>()
const CACHE_TTL_MS = 30_000

/**
 * Fill gaps in `price_history_cache` from a chart response.
 *
 * `ignoreDuplicates: true` makes this gap-fill only: a (symbol, date) that is
 * already stored is left exactly as it is. That is the property that matters,
 * because the nightly job's rows are the ones the product treats as canonical
 * and this path must never revise them.
 *
 * Built lazily so the service-role client does not exist on a request that
 * does not reach here -- in particular, never on a denied one.
 */
async function persistDailyCloses(symbol: string, interval: string, payload: unknown): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = dailyClosesFromYahooChart(symbol, interval, payload, today)
  if (rows.length === 0) return

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) {
    console.warn('[yahoo-chart-proxy] no service-role key; skipping cache fill')
    return
  }

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, {
      auth: { persistSession: false },
    })
    const { error } = await admin
      .from('price_history_cache')
      .upsert(rows, { onConflict: 'symbol,date', ignoreDuplicates: true })
    if (error) {
      console.warn(`[yahoo-chart-proxy] cache fill failed for ${symbol}: ${error.message}`)
    }
  } catch (err: any) {
    console.warn(`[yahoo-chart-proxy] cache fill threw for ${symbol}: ${String(err?.message || err)}`)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Authorize before the Yahoo fetch and before any service-role client
  // exists. A denied caller reaches neither.
  const authHeader = req.headers.get('Authorization')
  let userClient
  try {
    userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      requirePublishableKey((n) => Deno.env.get(n)),
      { auth: { persistSession: false }, global: { headers: { Authorization: authHeader ?? '' } } },
    )
  } catch (err: any) {
    // A misconfiguration names the variable rather than surfacing later as a
    // confusing auth failure. See publishable-key.ts.
    return new Response(JSON.stringify({ error: 'Server misconfigured', detail: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authz = await authorizeVerifiedUser(authHeader, userClient)
  if (!authz.ok) {
    return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: ChartRequest
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const symbol = (body.symbol || '').trim()
  const interval = (body.interval || '').trim()

  if (!symbol || !/^[A-Za-z0-9._^\-=]{1,15}$/.test(symbol)) {
    return new Response(JSON.stringify({ error: 'Invalid symbol' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!ALLOWED_INTERVALS.has(interval)) {
    return new Response(JSON.stringify({ error: 'Invalid interval' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Build the Yahoo URL. Prefer range when supplied, otherwise use
  // period1/period2 for exact date windows.
  const params = new URLSearchParams()
  params.set('interval', interval)

  if (body.range && ALLOWED_RANGES.has(body.range)) {
    params.set('range', body.range)
  } else if (
    typeof body.period1 === 'number' && Number.isFinite(body.period1) &&
    typeof body.period2 === 'number' && Number.isFinite(body.period2) &&
    body.period1 > 0 && body.period2 > body.period1
  ) {
    params.set('period1', String(Math.floor(body.period1)))
    params.set('period2', String(Math.floor(body.period2)))
  } else {
    return new Response(JSON.stringify({ error: 'Must provide range or period1+period2' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  params.set('includePrePost', 'false')
  params.set('events', 'div|split')

  const cacheKey = `${symbol}:${params.toString()}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(JSON.stringify(cached.data), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
      },
    })
  }

  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)

    const upstream = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        // Yahoo rejects obviously-automated user agents; mimic a browser.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    clearTimeout(timeoutId)

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return new Response(
        JSON.stringify({
          error: `Yahoo upstream error ${upstream.status}`,
          detail: text.slice(0, 500),
        }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const data = await upstream.json()

    // Cache successful responses.
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS })

    // Persist the daily closes. This replaces the two browser upserts in
    // usePositionLifecycle.ts; see the header.
    //
    // Non-fatal by design: the chart is what the caller asked for, and a
    // failed cache fill must not turn a good response into an error. It is
    // awaited rather than floated so a failure is logged against this request
    // instead of after the response.
    await persistDailyCloses(symbol, interval, data)

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
      },
    })
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError'
    return new Response(
      JSON.stringify({
        error: isAbort ? 'Yahoo upstream timeout' : 'Yahoo fetch failed',
        detail: String(err?.message || err),
      }),
      {
        status: 504,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
