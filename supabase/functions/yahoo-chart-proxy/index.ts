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
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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
