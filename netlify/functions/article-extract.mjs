/**
 * article-extract — fetch a news URL and return readable text.
 *
 * This lives on Netlify rather than in supabase/functions/ for one reason:
 * network egress. The Supabase edge version could not reach Yahoo Finance at
 * all — every request failed with `TypeError: error sending request from
 * [2600:1f18:…]`, a connection-level refusal of Supabase's IPv6 datacenter
 * address before any HTTP response. Yahoo is ~7 of every 8 stories in the
 * feed, so that made the reader useless where it mattered most. Netlify runs
 * functions on entirely different infrastructure, which is the one lever
 * available without paying for a proxy or an extraction API.
 *
 * If Yahoo ever blocks this egress too, the honest fix is a paid extraction
 * API, not a third proxy hop. The client already handles `ok: false` by
 * sending the reader to the publisher, so a block degrades rather than breaks.
 *
 * Deliberately dependency-free. Readability needs a full DOM (jsdom, ~10MB
 * installed) for a marginal gain over structured data: finance publishers
 * ship schema.org articleBody, and where they do it is the publisher stating
 * what the article is rather than a heuristic guessing from markup.
 *
 * Nothing is stored. Article text is someone else's copyright — transiently
 * reformatting a page the reader could have opened themselves is a different
 * question from keeping a copy.
 */

const FETCH_TIMEOUT_MS = 12_000
const MAX_HTML_BYTES = 4_000_000
const MIN_ARTICLE_CHARS = 400
const WPM = 220

/** A browser UA. Publishers routinely serve a JS-only shell to unknown agents. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0 Safari/537.36'

const json = (body, status = 200) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Cache-Control': 'public, max-age=3600',
  },
  body: JSON.stringify(body),
})

const escapeHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

/**
 * Reject anything that is not a public web page.
 *
 * Without this the function is an open fetch proxy, and one that runs inside
 * the deploy's network. Private ranges and link-local are refused outright.
 */
function isPublicHttpUrl(u) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    if (/^(10|127|0)\./.test(h)) return false
    if (/^192\.168\./.test(h)) return false
    if (/^169\.254\./.test(h)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
  }
  if (h.includes(':')) return false // bare IPv6 literal
  return true
}

/** schema.org articleBody, the reliable path for finance publishers. */
function fromJsonLd(html) {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )
  for (const m of blocks) {
    let parsed
    try { parsed = JSON.parse(m[1].trim()) } catch { continue }

    // A block is one object, an array, or an @graph wrapper.
    const candidates = []
    const push = v => { if (v && typeof v === 'object') candidates.push(v) }
    if (Array.isArray(parsed)) parsed.forEach(push)
    else push(parsed)
    for (const c of [...candidates]) if (Array.isArray(c['@graph'])) c['@graph'].forEach(push)

    for (const c of candidates) {
      const body = typeof c.articleBody === 'string' ? c.articleBody.trim() : ''
      if (body.length < MIN_ARTICLE_CHARS) continue
      const a = c.author
      const byline = typeof a === 'string'
        ? a
        : Array.isArray(a) ? a.map(x => x?.name).filter(Boolean).join(', ') : a?.name
      return {
        title: typeof c.headline === 'string' ? c.headline : undefined,
        body,
        byline: byline || undefined,
        published: typeof c.datePublished === 'string' ? c.datePublished : undefined,
        image: typeof c.image === 'string' ? c.image : c.image?.url,
      }
    }
  }
  return null
}

/**
 * Fallback: the longest run of <p> tags on the page.
 *
 * Crude next to Readability, but it only runs when the publisher shipped no
 * structured data, and it is guarded by the same length floor — a page that
 * yields a nav bar and a cookie notice fails the floor and is reported as
 * unextractable rather than rendered as an article.
 */
function fromParagraphs(html) {
  const stripped = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(header|footer|nav|aside)[\s\S]*?<\/\1>/gi, '')
  const paras = [...stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    // Short blocks are captions, bylines, disclaimers and cookie text.
    .filter(t => t.length > 120)
  if (!paras.length) return null
  const body = paras.join('\n\n')
  return body.length >= MIN_ARTICLE_CHARS ? { body } : null
}

function titleFrom(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (og) return og[1]
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return t ? t[1].replace(/\s+/g, ' ').trim() : null
}

export const handler = async event => {
  if (event.httpMethod === 'OPTIONS') return json({ ok: true })
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const raw =
    event.queryStringParameters?.url ??
    (() => { try { return JSON.parse(event.body || '{}').url } catch { return undefined } })()

  if (!raw || typeof raw !== 'string') return json({ ok: false, reason: 'missing_url' })

  let target
  try { target = new URL(raw.trim()) } catch { return json({ ok: false, reason: 'invalid_url' }) }
  if (!isPublicHttpUrl(target)) return json({ ok: false, reason: 'blocked_host' })

  let html
  let finalUrl = target.toString()
  try {
    const res = await fetch(target.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    finalUrl = res.url || finalUrl
    if (!res.ok) {
      return json({
        ok: false,
        reason: res.status === 401 || res.status === 403 ? 'blocked' : 'fetch_failed',
        status: res.status,
      })
    }
    if (!(res.headers.get('content-type') ?? '').includes('html')) {
      return json({ ok: false, reason: 'not_html' })
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_HTML_BYTES) return json({ ok: false, reason: 'too_large' })
    html = new TextDecoder('utf-8').decode(buf)
  } catch (e) {
    // The message is returned on purpose. A bare "fetch_error" is
    // undiagnosable, and it is what hid the Yahoo block on the Supabase
    // version — every request failed silently and looked like bad extraction.
    return json({
      ok: false,
      reason: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'fetch_error',
      detail: `${e?.name}: ${e?.message}`.slice(0, 300),
    })
  }

  const ld = fromJsonLd(html)
  const fallback = ld?.body ? null : fromParagraphs(html)
  const body = ld?.body ?? fallback?.body

  if (!body || body.length < MIN_ARTICLE_CHARS) {
    // Short output is the signature of a paywall teaser or a JS shell.
    // Rendering 80 words as "the article" is worse than sending them to the
    // page, so this reports failure rather than shipping a stub.
    return json({ ok: false, reason: 'too_short', chars: body?.length ?? 0 })
  }

  const paragraphs = body
    .split(/\n{2,}|(?<=[.!?])\s{2,}/)
    .map(p => p.trim())
    .filter(Boolean)

  return json({
    ok: true,
    url: finalUrl,
    via: ld?.body ? 'json-ld' : 'paragraphs',
    title: ld?.title ?? titleFrom(html),
    byline: ld?.byline ?? null,
    siteName: target.hostname.replace(/^www\./, ''),
    publishedTime: ld?.published ?? null,
    leadImage: ld?.image ?? null,
    excerpt: body.slice(0, 220).trim() + (body.length > 220 ? '…' : ''),
    paragraphs: paragraphs.map(escapeHtml),
    chars: body.length,
    readingMinutes: Math.max(1, Math.round(body.split(/\s+/).length / WPM)),
  })
}
