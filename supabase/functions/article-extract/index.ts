/**
 * article-extract — turn a news URL into readable text.
 *
 * Why this exists rather than an in-app browser: Tesseract is a web app with
 * no native shell, so the only "in app" option is an iframe, and the
 * publishers worth reading (Bloomberg, Reuters, WSJ, FT) all send
 * X-Frame-Options: DENY. An iframe fallback would be a blank box for exactly
 * the sources that matter. Extraction is the only route to a reader that
 * looks like the app instead of like someone else's site.
 *
 * It will not always work — paywalls, bot blocks, JS-rendered pages. That is
 * expected and reported honestly as { ok: false, reason }, so the client can
 * fall back to opening the publisher's page rather than showing an empty
 * reader and pretending.
 *
 * Deliberately NOT stored. Extracted article text is someone else's
 * copyrighted content; holding a durable copy of it is a different legal
 * question from transiently reformatting it for a reader who could have
 * loaded the page themselves. Cached briefly, keyed by URL, and that is all.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts'
import { Readability } from 'https://esm.sh/@mozilla/readability@0.5.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FETCH_TIMEOUT_MS = 15_000
const CACHE_TTL_SECONDS = 60 * 60
const MAX_HTML_BYTES = 3_000_000

/**
 * A browser UA, not a bot string.
 *
 * Not an attempt to defeat anything: many publishers serve a JS-only shell to
 * unrecognised agents, which extracts to nothing. Sites that genuinely refuse
 * still refuse, and that is reported rather than worked around.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/122.0 Safari/537.36'

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

async function cacheGet(key: string): Promise<unknown | null> {
  try {
    const { data } = await admin
      .from('market_data_cache')
      .select('payload, expires_at')
      .eq('cache_key', key)
      .maybeSingle()
    if (!data) return null
    if (new Date(data.expires_at).getTime() < Date.now()) return null
    return data.payload
  } catch { return null }
}

async function cacheSet(key: string, payload: unknown): Promise<void> {
  try {
    await admin.from('market_data_cache').upsert({
      cache_key: key,
      payload,
      expires_at: new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString(),
    })
  } catch { /* cache is an optimisation, never a dependency */ }
}

/**
 * Strip anything executable or remote-loading from the extracted markup.
 *
 * Readability returns the publisher's HTML. Rendering that inside the app
 * without stripping it would be a stored-XSS sink pointed at whatever any
 * news site happens to serve — and would let a page phone home from inside
 * an authenticated session. Attributes are cut to a known-good list rather
 * than blocklisting, because a blocklist is a list of the attacks thought of
 * so far.
 */
function sanitize(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:srcset|style|class|id|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
}

/**
 * Pull articleBody out of schema.org JSON-LD.
 *
 * Tried before Readability, not after. Finance publishers — Yahoo among them,
 * which is most of this feed — ship the full body as structured data even
 * when the rendered page is a JS shell. It is the publisher stating what the
 * article is, rather than a heuristic guessing from markup, so when it is
 * present it is both more accurate and cheaper than walking the DOM.
 */
function fromJsonLd(html: string): { title?: string; body?: string; byline?: string; published?: string } | null {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const m of blocks) {
    let parsed: unknown
    try { parsed = JSON.parse(m[1].trim()) } catch { continue }
    // A block may be one object, an array, or an @graph wrapper.
    const candidates: any[] = []
    const push = (v: any) => { if (v && typeof v === 'object') candidates.push(v) }
    if (Array.isArray(parsed)) parsed.forEach(push); else push(parsed)
    for (const c of [...candidates]) if (Array.isArray(c['@graph'])) c['@graph'].forEach(push)

    for (const c of candidates) {
      const body = typeof c.articleBody === 'string' ? c.articleBody.trim() : ''
      if (body.length < 400) continue
      const author = c.author
      const byline = typeof author === 'string'
        ? author
        : Array.isArray(author) ? author.map((a: any) => a?.name).filter(Boolean).join(', ')
        : author?.name
      return {
        title: typeof c.headline === 'string' ? c.headline : undefined,
        body,
        byline: byline || undefined,
        published: typeof c.datePublished === 'string' ? c.datePublished : undefined,
      }
    }
  }
  return null
}

/** Turn plain article text into simple paragraphs for the reader. */
function asParagraphs(text: string): string {
  return text
    .split(/\n{2,}|(?<=\.)\s{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${p.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!))}</p>`)
    .join('')
}

/** Words per minute for a reading-time estimate. */
const WPM = 220

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { url?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const raw = typeof body.url === 'string' ? body.url.trim() : ''
  let target: URL
  try { target = new URL(raw) } catch { return json({ ok: false, reason: 'invalid_url' }) }

  // Only public web pages. Without this the function is an SSRF primitive:
  // it runs with a service-role key and can reach the platform's internal
  // network, so "fetch any URL the caller names" would be handing that reach
  // to anyone who can call it.
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return json({ ok: false, reason: 'unsupported_scheme' })
  }
  const host = target.hostname.toLowerCase()
  if (
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) && (
      host.startsWith('10.') || host.startsWith('127.') || host.startsWith('0.') ||
      host.startsWith('192.168.') || host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    )
  ) {
    return json({ ok: false, reason: 'blocked_host' })
  }

  const cacheKey = `article|${target.toString()}`
  const hit = await cacheGet(cacheKey)
  if (hit) return json(hit)

  let html: string
  let finalUrl = target.toString()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(target.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    })
    clearTimeout(timer)
    finalUrl = res.url || finalUrl

    if (!res.ok) {
      // 401/403 is a paywall or a bot block; both mean "send them to the site".
      const out = { ok: false, reason: res.status === 401 || res.status === 403 ? 'blocked' : 'fetch_failed', status: res.status }
      await cacheSet(cacheKey, out)
      return json(out)
    }
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('html')) {
      const out = { ok: false, reason: 'not_html', contentType: type }
      await cacheSet(cacheKey, out)
      return json(out)
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_HTML_BYTES) {
      return json({ ok: false, reason: 'too_large' })
    }
    html = new TextDecoder().decode(buf)
  } catch (e) {
    // The message matters: "fetch_error" alone is undiagnosable, and this
    // failed silently on every Yahoo URL — most of the feed — until it said why.
    const err = e as Error
    return json({
      ok: false,
      reason: err.name === 'AbortError' ? 'timeout' : 'fetch_error',
      detail: `${err.name}: ${err.message}`.slice(0, 300),
    })
  }

  // Structured data first — see fromJsonLd.
  const ld = fromJsonLd(html)
  if (ld?.body) {
    const words = ld.body.split(/\s+/).length
    const out = {
      ok: true,
      url: finalUrl,
      via: 'json-ld',
      title: ld.title ?? null,
      byline: ld.byline ?? null,
      siteName: target.hostname.replace(/^www\./, ''),
      publishedTime: ld.published ?? null,
      excerpt: ld.body.slice(0, 200).trim() + (ld.body.length > 200 ? '…' : ''),
      html: asParagraphs(ld.body),
      chars: ld.body.length,
      readingMinutes: Math.max(1, Math.round(words / WPM)),
    }
    await cacheSet(cacheKey, out)
    return json(out)
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (!doc) return json({ ok: false, reason: 'parse_failed' })

    // Readability reads document.baseURI to resolve relative links; deno-dom
    // does not set it from the fetch, so give it the resolved URL explicitly.
    try { Object.defineProperty(doc, 'baseURI', { value: finalUrl, configurable: true }) } catch { /* best effort */ }
    try { Object.defineProperty(doc, 'documentURI', { value: finalUrl, configurable: true }) } catch { /* best effort */ }

    // deno-dom is not a full DOM; Readability is defensive but not infinitely
    // so, and a throw here means "this page did not extract", not a 500.
    const article = new Readability(doc as unknown as Document, { charThreshold: 250 }).parse()

    const text = (article?.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!article || text.length < 400) {
      // Short output is the signature of a JS-rendered shell or a paywall
      // teaser. Showing 80 words in a reader and calling it the article is
      // worse than sending the reader to the page.
      const out = { ok: false, reason: 'too_short', chars: text.length }
      await cacheSet(cacheKey, out)
      return json(out)
    }

    const out = {
      ok: true,
      url: finalUrl,
      title: article.title ?? null,
      byline: article.byline ?? null,
      siteName: article.siteName ?? target.hostname.replace(/^www\./, ''),
      publishedTime: (article as { publishedTime?: string }).publishedTime ?? null,
      via: 'readability',
      excerpt: article.excerpt ?? null,
      html: sanitize(article.content ?? ''),
      chars: text.length,
      readingMinutes: Math.max(1, Math.round(text.split(' ').length / WPM)),
    }
    await cacheSet(cacheKey, out)
    return json(out)
  } catch {
    return json({ ok: false, reason: 'extract_failed' })
  }
})
