/**
 * market-news — multi-source company news, merged and ranked.
 *
 * Runs server-side for two reasons. The obvious one is CORS: none of these
 * endpoints allow browser origins, the same constraint that made
 * `yahoo-chart-proxy` necessary. The less obvious one is that API keys belong
 * on the server — anything in the client bundle is public, and these are
 * rate-limited credentials tied to a paid plan.
 *
 * Three sources, each independently optional:
 *
 *   Finnhub        company-news        needs FINNHUB_API_KEY
 *   Alpha Vantage  NEWS_SENTIMENT      needs ALPHAVANTAGE_API_KEY
 *   Yahoo Finance  search              no key
 *
 * Whichever are configured get used; the rest are skipped. With no keys at all
 * the function still returns Yahoo results, so the feed works out of the box
 * and improves as keys are added. A source that errors or times out is dropped
 * rather than failing the request — partial news beats no news, and one
 * provider having an outage should not empty the feed.
 *
 * Accepts POST JSON:
 *   { symbols: string[], limit?: number, lookbackDays?: number }
 *
 * Returns:
 *   { items: NewsItem[], sources: { name, ok, count }[] }
 *
 * `NewsItem` matches src/lib/financial-data/types.ts so the client can treat
 * these identically to any other provider's output.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface NewsItem {
  id: string
  headline: string
  summary?: string
  url: string
  publishedAt: string
  source: string
  symbols: string[]
  sentiment?: 'positive' | 'negative' | 'neutral'
  relevanceScore?: number
  imageUrl?: string
}

/** Per-source timeout. A slow provider must not hold up the whole response. */
const SOURCE_TIMEOUT_MS = 6_000
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_SYMBOLS = 12

/**
 * Shared cache, in Postgres rather than in memory.
 *
 * A module-level Map is per-isolate, and Supabase runs ephemeral instances, so
 * a cold one starts empty. With a handful of readers the hit rate collapses
 * and every miss is a fresh set of provider calls — which is how a 60/minute
 * free tier gets exhausted by three people opening the feed at once. Caching
 * here makes provider cost a function of (symbol set × TTL), not user count.
 */
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
  } catch { /* best-effort; never fail the request over caching */ }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Tesseract/1.0)' },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

// ── Sources ────────────────────────────────────────────────────────────────

async function fromFinnhub(symbols: string[], from: string, to: string): Promise<NewsItem[]> {
  const key = Deno.env.get('FINNHUB_API_KEY')
  if (!key) return []
  const out: NewsItem[] = []
  for (const symbol of symbols) {
    try {
      const data = await fetchJson(
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`
      )
      for (const a of Array.isArray(data) ? data.slice(0, 10) : []) {
        if (!a?.headline || !a?.url) continue
        out.push({
          id: `finnhub:${a.id ?? a.url}`,
          headline: a.headline,
          summary: a.summary || undefined,
          url: a.url,
          publishedAt: new Date((a.datetime ?? 0) * 1000).toISOString(),
          source: a.source || 'Finnhub',
          symbols: [symbol],
          imageUrl: a.image || undefined,
        })
      }
    } catch { /* skip this symbol */ }
  }
  return out
}

/**
 * Alpha Vantage is the only one of the three returning sentiment and a
 * per-ticker relevance score, which is why it is worth a key: those feed the
 * feed's ranking directly instead of news being ordered on recency alone.
 */
async function fromAlphaVantage(symbols: string[]): Promise<NewsItem[]> {
  const key = Deno.env.get('ALPHAVANTAGE_API_KEY')
  if (!key) return []
  try {
    const data = await fetchJson(
      `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(symbols.join(','))}&limit=50&apikey=${key}`
    )
    const feed = Array.isArray(data?.feed) ? data.feed : []
    return feed.flatMap((a: any) => {
      if (!a?.title || !a?.url) return []
      // "20240115T120000" → ISO
      const t = String(a.time_published ?? '')
      const iso = t.length >= 15
        ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`
        : new Date().toISOString()
      const relevant = (a.ticker_sentiment ?? [])
        .filter((ts: any) => symbols.includes(ts.ticker))
        .sort((x: any, y: any) => Number(y.relevance_score) - Number(x.relevance_score))
      const top = relevant[0]
      const label = String(a.overall_sentiment_label ?? '').toLowerCase()
      return [{
        id: `av:${a.url}`,
        headline: a.title,
        summary: a.summary || undefined,
        url: a.url,
        publishedAt: iso,
        source: a.source || 'Alpha Vantage',
        symbols: relevant.map((ts: any) => ts.ticker),
        sentiment: label.includes('bull') ? 'positive' as const
          : label.includes('bear') ? 'negative' as const
          : 'neutral' as const,
        relevanceScore: top ? Number(top.relevance_score) : undefined,
        imageUrl: a.banner_image || undefined,
      }]
    })
  } catch {
    return []
  }
}

async function fromYahoo(symbols: string[]): Promise<NewsItem[]> {
  const out: NewsItem[] = []
  for (const symbol of symbols) {
    try {
      const data = await fetchJson(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=8&quotesCount=0`
      )
      for (const a of data?.news ?? []) {
        if (!a?.title || !a?.link) continue
        out.push({
          id: `yahoo:${a.uuid ?? a.link}`,
          headline: a.title,
          url: a.link,
          publishedAt: new Date((a.providerPublishTime ?? 0) * 1000).toISOString(),
          source: a.publisher || 'Yahoo Finance',
          symbols: [symbol],
          imageUrl: a.thumbnail?.resolutions?.[0]?.url || undefined,
        })
      }
    } catch { /* skip this symbol */ }
  }
  return out
}

// ── Merge ──────────────────────────────────────────────────────────────────

/** Normalised headline, for cross-source duplicate detection. */
function dedupeKey(headline: string): string {
  return headline.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/**
 * Merge sources, preferring the richer record when the same story arrives
 * twice. The same headline routinely comes from two providers; keeping the one
 * that carries sentiment and a relevance score means the extra Alpha Vantage
 * metadata survives even when Yahoo reported the story first.
 */
function merge(lists: NewsItem[][]): NewsItem[] {
  const byKey = new Map<string, NewsItem>()
  for (const item of lists.flat()) {
    const key = dedupeKey(item.headline)
    if (!key) continue
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, item)
      continue
    }
    const richer = (item.relevanceScore != null || item.sentiment != null) &&
      existing.relevanceScore == null && existing.sentiment == null
    const merged = richer ? { ...item } : { ...existing }
    merged.symbols = Array.from(new Set([...existing.symbols, ...item.symbols]))
    merged.summary = merged.summary || existing.summary || item.summary
    merged.imageUrl = merged.imageUrl || existing.imageUrl || item.imageUrl
    byKey.set(key, merged)
  }
  return [...byKey.values()]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { symbols?: unknown; limit?: unknown; lookbackDays?: unknown }
  try {
    body = await req.json()
  } catch {
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

  if (!symbols.length) {
    return new Response(JSON.stringify({ items: [], sources: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 60)
  const lookbackDays = Math.min(Math.max(Number(body.lookbackDays) || 7, 1), 30)

  const cacheKey = `news|${symbols.join(',')}|${limit}|${lookbackDays}`
  const hit = await cacheGet(cacheKey)
  if (hit) {
    return new Response(JSON.stringify(hit), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    })
  }

  const to = new Date()
  const from = new Date(to.getTime() - lookbackDays * 86400_000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  // All three in parallel; a rejection becomes an empty list rather than a
  // failed response.
  const settled = await Promise.allSettled([
    withTimeout(fromFinnhub(symbols, fmt(from), fmt(to)), SOURCE_TIMEOUT_MS),
    withTimeout(fromAlphaVantage(symbols), SOURCE_TIMEOUT_MS),
    withTimeout(fromYahoo(symbols), SOURCE_TIMEOUT_MS),
  ])
  const names = ['finnhub', 'alphavantage', 'yahoo']
  const lists = settled.map(s => (s.status === 'fulfilled' ? s.value : []))

  const items = merge(lists)
    .filter(i => new Date(i.publishedAt).getTime() >= from.getTime())
    .sort((a, b) => {
      // Relevance first where a provider supplied it, recency otherwise. A
      // highly-relevant story from this morning should outrank a passing
      // mention from ten minutes ago.
      const ra = a.relevanceScore ?? 0
      const rb = b.relevanceScore ?? 0
      if (Math.abs(ra - rb) > 0.05) return rb - ra
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    })
    .slice(0, limit)

  const payload = {
    items,
    sources: names.map((name, i) => ({
      name,
      ok: settled[i].status === 'fulfilled',
      count: lists[i].length,
    })),
  }

  await cacheSet(cacheKey, payload, CACHE_TTL_MS / 1000)

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  })
})
