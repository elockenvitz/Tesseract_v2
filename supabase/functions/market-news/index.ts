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
 *   Yahoo Finance  search              no key — headlines and thumbnails
 *   Yahoo Finance  RSS headline feed   no key — the descriptions, see below
 *
 * ── Alpha Vantage was the fourth, and is retired ──────────────────────────
 *
 * It supplied NEWS_SENTIMENT, the only source of sentiment labels and
 * per-ticker relevance scores. Measured live on 2026-11-20, immediately after
 * the credential was rotated: the key is configured and the provider answers
 * 200, but with
 *
 *   "Information: ... This is a premium endpoint. You may subscribe to any of
 *    the premium plans ... to instantly unlock all premium endpoints"
 *
 * NEWS_SENTIMENT is not included in this subscription. It had contributed
 * ZERO articles across all 73 cached news payloads, and a fresh uncached
 * request confirmed count: 0. The `note` field below is what made that
 * visible; having made it visible, the honest next step is to stop asking.
 *
 * Removing it means `sentiment` and `relevanceScore` have no source at all,
 * so they are gone from `NewsItem` and ranking is recency-only. See the sort
 * at the bottom: it previously preferred relevance and would now have been
 * sorting every item by a field nothing sets.
 *
 * Rotating the key did not and could not fix this. It is a plan limit, not a
 * credential fault, so re-adding the source needs a paid plan first.
 *
 * Whichever are configured get used; the rest are skipped. With no keys at all
 * the function still returns Yahoo results, so the feed works out of the box
 * and improves as keys are added. A source that errors or times out is dropped
 * rather than failing the request — partial news beats no news, and one
 * provider having an outage should not empty the feed.
 *
 * The two Yahoo sources are not redundant. The JSON search endpoint returns
 * headlines and images but never a description; the RSS feed returns
 * descriptions but no image. Measured live, RSS carries a real summary on
 * 69 of 69 items, against 0 of 30 on a recent cached payload without it. They
 * merge by normalised headline into one story with both.
 *
 * Accepts POST JSON:
 *   { symbols: string[], limit?: number, lookbackDays?: number }
 *
 * Returns:
 *   { items: NewsItem[], sources: { name, ok, configured, count, note? }[] }
 *
 * `configured` is reported separately from `ok` because a source with no API
 * key returns an empty list without erroring, which is indistinguishable from
 * a working source on a quiet news day. Alpha Vantage sat dark that way and
 * nothing in the response said so. Finnhub can still sit dark the same way,
 * so the field stays.
 *
 * `note` is gone with Alpha Vantage. It existed because that provider answers
 * 200 with prose where the data should be; the remaining three either return
 * stories or throw, and `ok: false` already says which.
 *
 * `NewsItem` matches src/lib/financial-data/types.ts so the client can treat
 * these identically to any other provider's output.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
/*
 * `@2`, not `@2.39.0`. The pin was the difference between the functions whose
 * authorization gate works and the two whose gate rejected every signed-in
 * reader: 2.39.0's bundled auth client resolves a no-argument `getUser()`
 * through its own empty session store instead of the forwarded Authorization
 * header. `_shared/verified-user.ts` no longer depends on that behaviour -- it
 * passes the token explicitly -- but the pin bought nothing and every other
 * function in this project already tracks `@2`, so it goes.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requirePublishableKey } from '../_shared/publishable-key.ts'
import { authorizeVerifiedUser } from '../_shared/verified-user.ts'

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
  /**
   * Every ticker the story touches, most relevant first.
   *
   * Order is load-bearing and easy to destroy: merge() used to union two
   * sources' arrays, which mixed a passing mention into the front of the list.
   * A Reddit story that name-checked Google rendered a Google chart, because
   * the tile picked the first symbol the reader happened to cover.
   */
  symbols: string[]
  /**
   * The ticker the story is *about*, as distinct from the ones it mentions.
   * Finnhub and both Yahoo sources know it exactly — the story came back from
   * a per-symbol query. Preserved through merge so the tile never has to
   * guess.
   */
  primarySymbol?: string
  imageUrl?: string
  /*
   * `sentiment` and `relevanceScore` were here. Alpha Vantage was their only
   * source, and it is retired (see the header), so nothing can populate them.
   * Declaring optional fields no source sets would advertise a signal this
   * function does not have.
   */
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
          // This story came back from company-news?symbol=<symbol>, so the
          // subject is not in doubt.
          primarySymbol: symbol,
          imageUrl: a.image || undefined,
        })
      }
    } catch { /* skip this symbol */ }
  }
  return out
}

/*
 * `fromAlphaVantage`, `alphaVantageComplaint` and the `SourceNote` interface
 * were here.
 *
 * `alphaVantageComplaint` existed because Alpha Vantage never returns an HTTP
 * error -- it answers 200 with prose where the data should be, so an invalid
 * key, an exhausted quota and a quiet news day all arrived as the same empty
 * list. Reading that prose into `note` is what finally made the source's
 * silence legible, and what it said, on 2026-11-20 with a freshly rotated
 * key, was that NEWS_SENTIMENT is a premium endpoint this plan does not
 * include.
 *
 * So the diagnostic did its job and the source is retired. `SourceNote` goes
 * with it: it was only ever threaded through for this one provider, because
 * it is the only one that fails by explaining itself rather than by throwing.
 *
 * Re-adding this needs a paid Alpha Vantage plan first, not a new key.
 */

/** Pull one XML tag's text out of an RSS <item> block. */
function rssTag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  if (!m) return ''
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')          // descriptions carry markup
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Yahoo's RSS feed, purely for the prose.
 *
 * The JSON search endpoint below returns headlines and thumbnails but no
 * description, and Finnhub's `summary` is usually empty — measured over the
 * cached payloads, one batch of 30 stories had a summary on *none* of them.
 * The result was a feed of photographs with no text, which is not a news feed.
 *
 * These items merge into the others by normalised headline, so in practice
 * this contributes the missing summary to a story another source already
 * found, rather than adding rows of its own.
 */
async function fromYahooRss(symbols: string[]): Promise<NewsItem[]> {
  const out: NewsItem[] = []
  for (const symbol of symbols) {
    try {
      const res = await fetch(
        `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Tesseract/1.0)' } },
      )
      if (!res.ok) throw new Error(`${res.status}`)
      const xml = await res.text()
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const block = m[1]
        const headline = rssTag(block, 'title')
        const url = rssTag(block, 'link')
        if (!headline || !url) continue
        const summary = rssTag(block, 'description')
        const pub = rssTag(block, 'pubDate')
        const at = pub ? new Date(pub) : new Date()
        out.push({
          id: `yrss:${url}`,
          headline,
          // Yahoo sometimes echoes the headline as the description; that is
          // not a summary, it is the same sentence twice.
          summary: summary && summary !== headline ? summary : undefined,
          url,
          publishedAt: (isNaN(at.getTime()) ? new Date() : at).toISOString(),
          source: 'Yahoo Finance',
          symbols: [symbol],
          // Queried per symbol, so the subject is exact.
          primarySymbol: symbol,
        })
      }
    } catch { /* skip this symbol */ }
  }
  return out
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
          // Queried per symbol, so the subject is exact.
          primarySymbol: symbol,
          imageUrl: a.thumbnail?.resolutions?.[0]?.url || undefined,
        })
      }
    } catch { /* skip this symbol */ }
  }
  return out
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Normalised headline, for cross-source duplicate detection.
 *
 * Truncating to 80 characters is what makes this fuzzy enough to match the
 * same story across providers, and it is also how unrelated stories collide:
 * wire copy and "Stocks moving today" headlines share long prefixes. A false
 * match used to union two stories' tickers, so a collision could staple one
 * company's ticker onto another company's story.
 */
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
    // Two records with the same normalised headline but different URLs are
    // usually two different stories that merely start alike, not one story
    // from two providers. Unioning their tickers is how a passing mention
    // becomes a headline ticker, so leave them alone and keep the first.
    if (existing.url !== item.url) continue

    /*
     * Keep the first record. This used to prefer whichever copy carried
     * `relevanceScore` or `sentiment`, which only ever meant "prefer the
     * Alpha Vantage copy". With that source retired no record can carry
     * either field, so the preference could never fire and the two branches
     * were the same branch.
     *
     * The fields below are still merged, so a later copy can still
     * contribute a summary or an image the first one lacked. That is what
     * actually matters here: Yahoo RSS exists purely to supply the prose
     * that the JSON search endpoint omits.
     */
    const merged = { ...existing }

    // The subject survives the merge. Every remaining source queries per
    // symbol, so each one's `primarySymbol` is exact; keep the first.
    const primary = existing.primarySymbol ?? item.primarySymbol
    merged.primarySymbol = primary

    // Subject first, then everything either source mentioned. Without the
    // reorder the union's order is just whichever provider answered first,
    // which is what put GOOGL at the front of a Reddit story.
    const rest = [...existing.symbols, ...item.symbols].filter(sym => sym !== primary)
    merged.symbols = Array.from(new Set(primary ? [primary, ...rest] : rest))

    merged.summary = merged.summary || existing.summary || item.summary
    merged.imageUrl = merged.imageUrl || existing.imageUrl || item.imageUrl
    byKey.set(key, merged)
  }
  return [...byKey.values()]
}

/**
 * Re-attribute a story from its own text rather than from which query found it.
 *
 * Every provider here is asked "news for SYMBOL", so a story comes back tagged
 * with whatever was queried. That answers *why we found it*, not *what it is
 * about* — "Tiger Global cuts stake in big tech, buys into SpaceX" arrives
 * tagged MSFT because Microsoft is one of the big-tech holdings, and the tile
 * then draws a Microsoft chart on a story about Tiger Global.
 *
 * So: read the headline and summary, and only claim a ticker the story
 * actually mentions. A story that names none of them is left unattributed —
 * a macro or fund story with no chart is honest, and better than a confident
 * chart of a company that appears nowhere in the text.
 */

interface AssetName {
  symbol: string
  name?: string | null
}

/** `(NASDAQ: AAPL)`, `(NYSE:BRK.B)`, `$AAPL`, `NASDAQ:AAPL`. */
const EXPLICIT_TICKER =
  /(?:\((?:NASDAQ|NYSE|AMEX|OTC|TSX|LSE)\s*:\s*([A-Z][A-Z0-9.\-]{0,9})\)|(?:NASDAQ|NYSE|AMEX|OTC)\s*:\s*([A-Z][A-Z0-9.\-]{0,9})|\$([A-Z]{1,5})\b)/g

/**
 * Company words that identify nobody.
 *
 * Matching a bare "Corp" or "Inc" against a headline would attribute every
 * story to whichever company happened to be first in the list.
 */
const NAME_NOISE = new Set([
  'inc', 'inc.', 'corp', 'corp.', 'corporation', 'co', 'co.', 'company',
  'ltd', 'ltd.', 'limited', 'plc', 'holdings', 'group', 'the', 'and',
  'technologies', 'technology', 'systems', 'international', 'industries',
])

/** The distinguishing part of a company name — "Apple" from "Apple Inc.". */
function nameStem(name: string): string | null {
  const first = name
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w && !NAME_NOISE.has(w.toLowerCase()))[0]
  if (!first || first.length < 3) return null
  return first
}

function mentions(haystack: string, needle: string): boolean {
  // Word-boundary match so "Reddit" does not hit inside "Reddit-like" noise
  // and, more importantly, so a two-letter ticker does not match inside an
  // ordinary word.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'i').test(haystack)
}

interface Attribution {
  /** Tickers the story actually mentions, most confident first. */
  symbols: string[]
  /** The one it is most about, or undefined when the text names nobody. */
  primarySymbol?: string
}

/**
 * @param text     headline + summary
 * @param queried  the symbols this story came back under
 * @param universe symbol → company name, for name matching
 */
function attributeFromText(
  text: string,
  queried: string[],
  universe: AssetName[],
): Attribution {
  const hay = text || ''
  const scored = new Map<string, number>()
  const bump = (sym: string, by: number) => {
    if (!sym) return
    scored.set(sym.toUpperCase(), Math.max(scored.get(sym.toUpperCase()) ?? 0, by))
  }

  // 1. Explicit exchange-qualified tickers are unambiguous — the publisher
  //    is telling us who the story is about.
  for (const m of hay.matchAll(EXPLICIT_TICKER)) {
    bump(m[1] ?? m[2] ?? m[3] ?? '', 100)
  }

  // 2. A company from the universe named in the text.
  for (const a of universe) {
    if (!a.symbol) continue
    const stem = a.name ? nameStem(a.name) : null
    if (stem && mentions(hay, stem)) bump(a.symbol, 80)
    // A bare ticker in prose is weaker evidence than a company name: plenty of
    // three-letter tickers are also ordinary words.
    else if (a.symbol.length >= 3 && mentions(hay, a.symbol)) bump(a.symbol, 60)
  }

  const ranked = [...scored.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([sym]) => sym)

  if (ranked.length) {
    // Queried symbols the text also mentions stay, in rank order; ones it does
    // not mention are dropped rather than trailing along as chips.
    return { symbols: ranked.slice(0, 6), primarySymbol: ranked[0] }
  }

  // Nothing named. Keep the queried symbols as provenance so the story is
  // still reachable, but claim no subject — the tile shows no chart rather
  // than the wrong one.
  return { symbols: queried.slice(0, 6), primarySymbol: undefined }
}


serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  /*
   * A real signed-in user, before any external API call or cache write. The
   * gateway admits the publishable key that ships in the browser bundle, so
   * without this an anonymous caller runs up a paid provider bill and writes
   * the shared cache. See `_shared/verified-user.ts` for why the token is
   * passed explicitly and why a key-configuration failure is a 503.
   */
  const authHeader = req.headers.get('Authorization')
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    requirePublishableKey((n) => Deno.env.get(n)),
    { auth: { persistSession: false }, global: { headers: { Authorization: authHeader ?? '' } } },
  )
  const authz = await authorizeVerifiedUser(authHeader, userClient)
  if (!authz.ok) {
    return new Response(
      JSON.stringify(authz.status === 503 ? { error: authz.error, reason: authz.reason } : { error: authz.error }),
      { status: authz.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
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
    withTimeout(fromYahoo(symbols), SOURCE_TIMEOUT_MS),
    withTimeout(fromYahooRss(symbols), SOURCE_TIMEOUT_MS),
  ])
  const names = ['finnhub', 'yahoo', 'yahoo-rss']
  const lists = settled.map(s => (s.status === 'fulfilled' ? s.value : []))

  // A source with no API key returns an empty array without ever making a
  // request, which `ok: true, count: 0` reports as a healthy source with no
  // news. Reporting configuration separately from success makes an unset key
  // visible instead of indistinguishable from a quiet news day. Finnhub is
  // the only remaining source that can sit dark this way; the Yahoo pair need
  // no key, so they are honestly always configured.
  const configured: Record<string, boolean> = {
    finnhub: !!Deno.env.get('FINNHUB_API_KEY'),
    yahoo: true,
    'yahoo-rss': true,
  }

  /**
   * Company names for the queried symbols, so attribution can match "SpaceX"
   * or "Microsoft" in a headline and not only a bare ticker. One query; the
   * function already holds an admin client for the cache.
   */
  let universe: { symbol: string; name?: string | null }[] = symbols.map(s => ({ symbol: s }))
  try {
    const { data } = await admin
      .from('assets')
      .select('symbol, company_name')
      .in('symbol', symbols)
    if (Array.isArray(data) && data.length) {
      universe = (data as any[]).map(a => ({ symbol: a.symbol, name: a.company_name }))
    }
  } catch { /* fall back to ticker-only matching */ }

  const items = merge(lists)
    .filter(i => new Date(i.publishedAt).getTime() >= from.getTime())
    // Re-attribute from the story's own words. Every source here is asked
    // "news for SYMBOL", so what comes back is tagged with whatever was
    // queried — which answers why we found it, not what it is about. "Tiger
    // Global cuts stake in big tech, buys into SpaceX" arrived tagged MSFT
    // because Microsoft is one of the holdings, and the tile drew a Microsoft
    // chart on a story about a fund. A story naming nobody now carries no
    // subject at all, so the tile shows no chart rather than a confident wrong
    // one.
    .map(i => {
      const attribution = attributeFromText(
        `${i.headline} ${i.summary ?? ''}`,
        i.symbols,
        universe,
      )
      return { ...i, symbols: attribution.symbols, primarySymbol: attribution.primarySymbol }
    })
    /*
     * Newest first, and that is the whole ranking.
     *
     * This used to prefer `relevanceScore` and fall back to recency. Alpha
     * Vantage was the only source that ever set that field, so with it
     * retired the relevance comparison read `0` against `0` on every pair and
     * fell through to recency anyway -- a ranking that described a signal the
     * function no longer receives.
     *
     * Saying "recency" plainly is the honest version. If relevance ranking is
     * wanted back, it needs a source that actually supplies a score, which
     * means a paid Alpha Vantage plan or a different provider.
     */
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit)

  const payload = {
    items,
    sources: names.map((name, i) => ({
      name,
      ok: settled[i].status === 'fulfilled',
      configured: configured[name] ?? true,
      count: lists[i].length,
      // `note` was here, for the one provider that answered 200 with a
      // complaint instead of data. The three that remain either return stories
      // or throw, and `ok: false` already says which, so there is nothing left
      // for a note to carry.
    })),
  }

  await cacheSet(cacheKey, payload, CACHE_TTL_MS / 1000)

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  })
})
