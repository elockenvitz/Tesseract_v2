/**
 * A source that returns nothing must say why.
 *
 * ── Two layers of the same silence ────────────────────────────────────────
 *
 * `market-news` fans out to four providers and reports each one's outcome.
 * The report has been wrong twice, the same way both times: an empty list
 * reported as health.
 *
 * The FIRST layer was already fixed. A source with no API key returned `[]`
 * without erroring, so `ok: true, count: 0` described it identically to a
 * working source on a quiet news day. `configured` was added to separate
 * those.
 *
 * The SECOND layer is this file. A source can be configured, `ok: true`, and
 * still return nothing because the PROVIDER refused. Alpha Vantage is the one
 * that does this: it never answers with an HTTP error. It answers 200 with a
 * different SHAPE -- no `feed` key, and prose in `Information`, `Note` or
 * `Error Message` instead. So
 *
 *     const feed = Array.isArray(data?.feed) ? data.feed : []
 *
 * silently flattens "your key is invalid" and "you have used today's 25
 * requests" into the same empty array a slow news day produces.
 *
 * ── Why it is worth a gate ────────────────────────────────────────────────
 *
 * Measured live against production on 2026-11-02: every other source returned
 * stories (finnhub 20, yahoo 14, yahoo-rss 31) while Alpha Vantage reported
 * `ok: true, configured: true, count: 0`. It is the ONLY source carrying
 * sentiment and per-ticker relevance scores, and `market-news` sorts on
 * relevance where a provider supplies it. So with Alpha Vantage dark the whole
 * feed quietly degrades to ranking on recency alone, and nothing in the
 * response said a word about it.
 *
 * The function cannot be imported -- it calls `serve()` and `Deno.env.get` at
 * module scope -- so these are source reads. That is the same method the
 * sibling `news-symbol-budget` suite uses and for the same reason.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../../')
const FN = 'supabase/functions/market-news/index.ts'

const fn = () => {
  const p = resolve(ROOT, FN)
  if (!existsSync(p)) throw new Error(`${FN} is missing; nothing below has evidence behind it`)
  return readFileSync(p, 'utf8')
}

/**
 * The same source with comments removed.
 *
 * Needed for any assertion that something is ABSENT: the function's own
 * comments quote the old broken line to explain why it is gone, and the first
 * version of the case below failed on that quotation rather than on code.
 */
const code = () =>
  fn()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')

describe('Alpha Vantage answering 200 with a complaint', () => {
  it('is read rather than discarded', () => {
    const s = fn()
    expect(s).toContain('function alphaVantageComplaint(')
  })

  it('covers all three fields the provider actually uses', () => {
    // `Information` is the rate-limit and plan message, `Note` the older
    // throttle wording, `Error Message` a rejected key or parameter. Missing
    // any one of them reinstates the silence for that case only, which is the
    // hardest version of this bug to notice.
    const s = fn()
    for (const field of ['Information', 'Note', 'Error Message']) {
      expect(s, field).toContain(`'${field}'`)
    }
  })

  it('never treats a complaint as data', () => {
    // The old line. If it comes back, a response with no `feed` is an empty
    // news day again.
    expect(code()).not.toContain('Array.isArray(data?.feed) ? data.feed : []')
  })

  it('reports a response that is neither data nor a complaint', () => {
    // A fourth shape nobody has seen yet still must not read as "no news".
    const s = fn()
    expect(s).toContain('if (!Array.isArray(data?.feed))')
    expect(s).toContain('no `feed` array and no explanation')
  })

  it('reports an unset key as a reason, not as an empty news day', () => {
    const s = fn()
    expect(s).toContain("out.note = 'ALPHAVANTAGE_API_KEY is not set'")
  })

  it('reports a thrown request instead of swallowing it', () => {
    // `fromAlphaVantage` ended in a bare `catch { return [] }`.
    const s = code()
    const at = s.indexOf('async function fromAlphaVantage(')
    expect(at).toBeGreaterThan(-1)
    const bodyText = s.slice(at, s.indexOf('function rssTag(', at))
    expect(bodyText).not.toMatch(/\}\s*catch\s*\{\s*return \[\]\s*\}/)
    expect(bodyText).toContain('the request failed:')
  })
})

describe('the note reaches the caller', () => {
  it('is carried per request, not at module scope', () => {
    // An isolate serves many requests. A module-level note would describe a
    // previous caller's failure, which is worse than no note at all.
    const s = fn()
    expect(s).toContain('interface SourceNote')
    expect(s).toMatch(/const alphaVantage: SourceNote = \{\}/)
    expect(s).toMatch(/fromAlphaVantage\(symbols, alphaVantage\)/)
    // No `let` holding a note outside the handler.
    expect(s).not.toMatch(/^let\s+\w*[Nn]ote\b/m)
  })

  it('appears on the source entry in the response', () => {
    expect(fn()).toMatch(/name === 'alphavantage' && alphaVantage\.note \? \{ note: alphaVantage\.note \}/)
  })

  it('is declared on the client type, so a reader can surface it', () => {
    const hook = readFileSync(resolve(ROOT, 'src/hooks/useMarketNews.ts'), 'utf8')
    expect(hook).toContain('note?: string')
    expect(hook).toContain('configured?: boolean')
  })
})
