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
 *
 * Written in the v1 `export const handler` style, matching article-extract.
 * The first version used the v2 `export default` + `config.path` form; this
 * site does not route those, so `/api/quote` fell through to the SPA catch-all
 * in public/_redirects and returned index.html with HTTP 200 — a well-formed
 * wrong answer, which is exactly the failure the client is built to distrust.
 */

const FETCH_TIMEOUT_MS = 10_000
const ALLOWED_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y'])
const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '1d', '1wk', '1mo'])

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    // Shorter than the 15-minute freshness ceiling in suppression.ts, so a
    // cached response can never be why a card claims to be fresher than it is.
    'cache-control': 'public, max-age=30',
  },
  body: JSON.stringify(body),
})

export const handler = async event => {
  if (event.httpMethod === 'OPTIONS') return reply(204, {})

  const q = event.queryStringParameters || {}
  const symbol = (q.symbol || '').trim().toUpperCase()
  const range = q.range || '5d'
  const interval = q.interval || '1d'

  // Symbols reach this from user data, so the shape is constrained rather than
  // interpolated blind — a ticker is letters, digits, dot, dash, caret.
  if (!symbol || !/^[A-Z0-9.\-^]{1,12}$/.test(symbol)) {
    return reply(400, { error: 'bad symbol' })
  }
  if (!ALLOWED_RANGES.has(range) || !ALLOWED_INTERVALS.has(interval)) {
    return reply(400, { error: 'bad range or interval' })
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
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        accept: 'application/json,text/plain,*/*',
      },
    })
    if (!res.ok) return reply(502, { error: `upstream ${res.status}` })

    const text = await res.text()
    // A 200 carrying HTML is a bot interstitial, not data. Passing it through
    // would hand the client something well-formed and wrong.
    if (!text.startsWith('{')) return reply(502, { error: 'upstream returned non-json' })

    return reply(200, JSON.parse(text))
  } catch (e) {
    return reply(502, { error: e && e.name === 'AbortError' ? 'upstream timeout' : 'upstream unreachable' })
  } finally {
    clearTimeout(timer)
  }
}
