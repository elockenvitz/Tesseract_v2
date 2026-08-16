import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserFinancialService } from '../../../financial-data/browser-client'
import { buildNewsCard } from '../news'
import { isQuoteFresh } from '../../suppression'
import type { CardResult, SignalCard } from '../../contract'

/**
 * The unavailable path, driven through the real quote client.
 *
 * A hand-constructed `null` would prove only that the builder handles a null
 * somebody typed into a test. What needed proving is that the quote layer
 * *produces* one — because until today it did not. `getQuote` was typed
 * `Promise<Quote | null>` and never returned null: on total provider failure
 * it returned a fabricated quote of zeros stamped `new Date().toISOString()`.
 *
 * That stamp is the part that mattered. A freshness guard cannot catch a lie
 * about freshness — the placeholder was always the newest quote in the system,
 * so `isQuoteFresh` passed on it every time, and the news builder read
 * `changePercent: 0` as a genuine flat tape. Both halves are asserted here.
 */

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

const NEWS = {
  id: 'n1',
  headline: 'Microsoft raises quarterly dividend and expands buyback authorisation',
  summary: 'The company lifted its payout by 10% and added $60bn to its repurchase programme.',
  url: 'https://example.com/story',
  source: 'Reuters',
  publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
  primarySymbol: 'MSFT',
  asset: { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' },
  heldIn: ['Core Equity'],
  maxWeightPct: 6.2,
}

describe('quote unavailable, end to end', () => {
  let service: BrowserFinancialService

  beforeEach(() => {
    service = new BrowserFinancialService()
    // Every provider down. This is the exact condition that used to mint a
    // placeholder — Yahoo refusing the request is not hypothetical here, it is
    // what happens from a Supabase edge IP today.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network refused')))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns null rather than a fabricated zero when every provider fails', async () => {
    const quote = await service.getQuote('MSFT')
    expect(quote).toBeNull()
  })

  it('does not return a quote that would pass a freshness check', async () => {
    // The regression in one line: the placeholder stamped itself `now`, so it
    // was always fresh, and every downstream guard was decorative.
    const quote = await service.getQuote('MSFT')
    expect(quote === null || !isQuoteFresh(quote.timestamp)).toBe(true)
  })

  it('produces a news card with no number, not a card claiming 0.0%', async () => {
    const quote = await service.getQuote('MSFT')
    const card = unwrap(buildNewsCard({
      ...NEWS,
      quote: quote
        ? { changePercent: quote.changePercent, asOf: quote.timestamp }
        : null,
    }))

    // The story survives; only the number is gone.
    expect(card.metric).toBeNull()
    expect(card.headline).toBe(NEWS.headline)
    expect(card.body).toContain('You hold it in 1 portfolio')
  })

  it('would have rendered +0.0% under the old behaviour', async () => {
    // Pinning what was fixed. This reconstructs exactly what
    // createPlaceholderQuote returned, and shows the builder had no way to
    // reject it: the value is displayable, the timestamp is fresh, and
    // changePercent of 0 is a legitimate flat tape on any real quote.
    const placeholder = { changePercent: 0, asOf: new Date().toISOString() }
    expect(isQuoteFresh(placeholder.asOf)).toBe(true)

    const card = unwrap(buildNewsCard({ ...NEWS, quote: placeholder }))
    expect(card.metric?.value).toBe('+0.0%')
    // ^ Not a bug in the builder. A flat tape is real and must render. The
    //   only defence is a quote layer that does not invent one, which is why
    //   the fix belongs in browser-client.ts and not in a suppression rule.
  })

  it('distinguishes an honestly-old quote from an invented one', () => {
    // Constructed, not driven through the client — and deliberately so. The
    // Yahoo path goes through a Supabase edge function rather than `fetch`, so
    // stubbing `fetch` cannot prime the cache and any "end to end" version of
    // this would pass without executing its own assertions. A guarded block
    // that silently skips is worse than an honest unit test.
    //
    // The claim under test is the distinction the placeholder destroyed:
    // expired cache carries the time the price was actually true, so its
    // staleness is visible and the builder drops the number by itself.
    const sixHoursOld = new Date(Date.now() - 6 * 3_600_000).toISOString()
    expect(isQuoteFresh(sixHoursOld)).toBe(false)

    const card = unwrap(buildNewsCard({
      ...NEWS, quote: { changePercent: 2.5, asOf: sixHoursOld },
    }))
    expect(card.metric).toBeNull()
  })
})
