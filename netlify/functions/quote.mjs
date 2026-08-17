/**
 * quote — fetch a Yahoo Finance chart payload for one symbol.
 *
 * This lives on Netlify rather than in supabase/functions/ for exactly the
 * reason article-extract does: network egress. The Supabase edge function
 * `yahoo-chart-proxy` is deployed and ACTIVE and returns **502 Bad Gateway** on
 * every call — Yahoo refuses Supabase's datacenter egress at the connection
 * level, the same refusal that made the article reader useless there.
 *
 * The consequence was not a degraded feed, it was an empty one. `getQuote`
 * returned null for every symbol, so every scenario card suppressed with
 * `quote_unavailable` and no signal content rendered at all. The suppression
 * behaved correctly; the data path under it was dead.
 *
 * Verified from this machine before writing this: the same Yahoo endpoint
 * returns 200 with live prices for AAPL, MSFT, NVDA, TSLA and AMZN, 8/8 on
 * rapid successive calls. Netlify runs on different infrastructure again, which
 * is the same lever article-extract already pulled successfully.
 *
 * If Yahoo blocks this egress too, the honest fix is a licensed quote API — a
 * pilot prerequisite already recorded in docs/handoff.md — not a third proxy
 * hop. Callers already treat a null quote as "unknown" and suppress, so a block
 * degrades to silence rather than to a wrong number.
 *
 * Dependency-free on purpose.
 */

const FETCH_TIMEOUT_MS = 10_000
const ALLOWED_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y'])
const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '1d', '1wk', '1mo'])

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    // The browser calls this from the app origin; Netlify serves both, so this
    // is same-origin in production. The header is here for `netlify dev`, which
    // serves functions on a different port.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    // Quotes are worth a few seconds of edge caching: a feed asks for the same
    // handful of symbols repeatedly on one render pass. Shorter than the
    // 15-minute freshness ceiling in suppression.ts, so a cached response can
    // never be the reason a card claims to be fresher than it is.
    'cache-control': 'public, max-age=30',
  },
})

export default async (request) => {
  if (request.method === 'OPTIONS') return json(204, {})

  const url = new URL(request.url)
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase()
  const range = url.searchParams.get('range') || '5d'
  const interval = url.searchParams.get('interval') || '1d'

  // Symbols reach this from user data, so the shape is constrained rather than
  // interpolated blind — a ticker is letters, digits, dot, dash, caret.
  if (!symbol || !/^[A-Z0-9.\-^]{1,12}$/.test(symbol)) {
    return json(400, { error: 'bad symbol' })
  }
  if (!ALLOWED_RANGES.has(range) || !ALLOWED_INTERVALS.has(interval)) {
    return json(400, { error: 'bad range or interval' })
  }

  const target =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(target, {
      signal: controller.signal,
      headers: {
        // Yahoo serves an interstitial to obviously-automated clients. This is
        // the same shape the working manual test used.
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        accept: 'application/json,text/plain,*/*',
      },
    })
    if (!res.ok) return json(502, { error: `upstream ${res.status}` })

    const text = await res.text()
    // A 200 carrying HTML is a bot interstitial, not data. Returning it as JSON
    // would hand the client something well-formed and wrong, which is the exact
    // failure mode the placeholder quote used to have.
    if (!text.startsWith('{')) return json(502, { error: 'upstream returned non-json' })

    return json(200, JSON.parse(text))
  } catch (e) {
    return json(502, { error: e?.name === 'AbortError' ? 'upstream timeout' : 'upstream unreachable' })
  } finally {
    clearTimeout(timer)
  }
}

export const config = { path: '/api/quote' }
