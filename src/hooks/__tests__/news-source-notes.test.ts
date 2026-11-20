/**
 * Alpha Vantage is retired from market-news, and must stay retired.
 *
 * ── What this file used to be ─────────────────────────────────────────────
 *
 * It asserted the `note` contract: Alpha Vantage never answers with an HTTP
 * error, it answers 200 with prose in `Information`, `Note` or `Error
 * Message` instead of a `feed`, so an invalid key, an exhausted quota and a
 * quiet news day all arrived as the same empty array. `note` carried the
 * provider's own words out to the caller.
 *
 * ── Why it is now the opposite assertion ──────────────────────────────────
 *
 * The diagnostic worked, and what it reported was fatal to the integration.
 * Measured live on 2026-11-20, with a freshly rotated credential and against
 * an uncached request:
 *
 *     finnhub        configured true  ok true  count 10
 *     alphavantage   configured true  ok true  count  0
 *                    note: "Information: ... This is a premium endpoint. You
 *                    may subscribe to any of the premium plans ... to
 *                    instantly unlock all premium endpoints"
 *     yahoo          configured true  ok true  count  8
 *     yahoo-rss      configured true  ok true  count 18
 *
 * NEWS_SENTIMENT is not in this subscription. Across all 73 cached news
 * payloads the source had contributed zero articles. The key was set and
 * valid enough to be recognised; the PLAN is the limit, so rotating the
 * credential did not and could not change this.
 *
 * So the source is gone, and with it the only producer of `sentiment` and
 * `relevanceScore` anywhere in the system.
 *
 * ── What is asserted ──────────────────────────────────────────────────────
 *
 * Absence, mostly, which is the durable half of a retirement: no provider
 * URL, no credential read, no health row claiming a source that is not
 * called. Alongside it, the three remaining sources and a recency-only sort,
 * so a test suite that passes by having deleted everything would fail.
 *
 * The function cannot be imported -- it calls `serve()` and `Deno.env.get` at
 * module scope -- so these are source reads, the same method the sibling
 * `news-symbol-budget` suite uses and for the same reason. They are written
 * as absence or as whole-identifier presence rather than as pinned
 * expressions, so ordinary refactoring does not red them.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const fn = () =>
  readFileSync(path.join(process.cwd(), 'supabase/functions/market-news/index.ts'), 'utf8')

/** Source with every block comment stripped, so prose about the retirement
 *  cannot satisfy an assertion about code. */
const code = () =>
  fn()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

describe('no Alpha Vantage anywhere in the fan-out', () => {
  it('never reads the credential', () => {
    expect(code()).not.toContain('ALPHAVANTAGE_API_KEY')
  })

  it('never builds a provider URL', () => {
    expect(code()).not.toContain('alphavantage.co')
    expect(code()).not.toContain('NEWS_SENTIMENT')
  })

  it('has no fetch function or complaint reader left', () => {
    const c = code()
    expect(c).not.toContain('fromAlphaVantage')
    expect(c).not.toContain('alphaVantageComplaint')
  })

  it('does not report it as a source', () => {
    // A health row for a provider that is never called is the misleading
    // indicator this retirement removes.
    expect(code()).not.toContain("'alphavantage'")
  })

  it('threads no SourceNote, which existed only for this provider', () => {
    expect(code()).not.toContain('SourceNote')
  })
})

describe('the three remaining sources survive', () => {
  // Without these, deleting the whole file would pass the suite above.
  it('still fans out to Finnhub and both Yahoo sources', () => {
    const c = code()
    expect(c).toContain('fromFinnhub')
    expect(c).toContain('fromYahoo')
    expect(c).toContain('fromYahooRss')
  })

  it('still names exactly those three in the health report', () => {
    expect(code()).toContain("const names = ['finnhub', 'yahoo', 'yahoo-rss']")
  })

  it('still reports Finnhub configuration separately from success', () => {
    // The first layer of the original defect: an unset key must stay
    // distinguishable from a quiet news day.
    const c = code()
    expect(c).toContain('FINNHUB_API_KEY')
    expect(c).toContain('configured')
  })

  it('still authorizes a verified user before calling any provider', () => {
    const c = code()
    expect(c).toContain('authorizeVerifiedUser')
    expect(c).toContain('requirePublishableKey')
  })
})

describe('ranking claims only what it has', () => {
  it('sorts on publishedAt and nothing else', () => {
    expect(code()).toContain(
      '.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())',
    )
  })

  it('does not rank on a relevance score no source supplies', () => {
    expect(code()).not.toContain('relevanceScore')
  })

  it('does not carry a sentiment field no source supplies', () => {
    expect(code()).not.toContain('sentiment')
  })
})
