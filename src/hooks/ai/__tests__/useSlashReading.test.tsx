/**
 * The read behind a market-data Slash Command.
 *
 * The price and asset bindings are mocked, so what is under test is the
 * hook's own decisions, which is where this went wrong once already:
 *
 *   * `closeSeries` returns bars ASCENDING. The first draft of `/change`
 *     destructured `[newest, prior]` off the front and differenced the two
 *     OLDEST closes in the window -- a wrong number with correct provenance
 *     attached to it, which is the worst shape a defect can take here.
 *     `describe('the order of the bars')` exists for that alone.
 *   * an ambiguous ticker is REPORTED, never resolved to a candidate. `SQ`
 *     meaning two listings and the hook picking one would put another
 *     instrument's price in front of the reader, labelled with theirs.
 *   * a failed read says the read failed. It must never fall back to the
 *     model question the whole change removed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SecurityRef, SecurityResolution } from '../../../lib/market-data'

const resolveSymbol = vi.fn<(s: string) => Promise<SecurityResolution>>()
const latestClose = vi.fn()
const closeSeries = vi.fn()

vi.mock('../../../lib/market-data/supabase-asset-source', () => ({
  assetAccess: { resolveSymbol: (s: string) => resolveSymbol(s) },
}))
vi.mock('../../../lib/market-data/supabase-price-source', () => ({
  marketDataReader: {
    latestClose: (...a: unknown[]) => latestClose(...a),
    closeSeries: (...a: unknown[]) => closeSeries(...a),
  },
}))

const { useSlashReading } = await import('../useSlashReading')

const REF: SecurityRef = {
  assetId: 'a-1',
  recordedSymbol: 'LRCX',
  pricingSymbol: 'LRCX',
  mic: 'XNAS',
  currency: 'USD',
  isin: null,
  figi: null,
  securityClass: null,
  lifecycle: null,
}

const VERDICT = {
  state: 'fresh' as const,
  dataClass: 'daily_close' as const,
  basis: 'calendar' as const,
  ageMs: 0,
  ageDays: 0,
  observationAgeMs: 0,
  reason: null,
}

const SOURCE = { provider: 'yahoo', feed: 'chart_v8', via: 'cache' as const }

const bar = (date: string, close: number, volume: number | null = 1000) =>
  ({ date, open: null, high: null, low: null, close, volume })

function seriesResult(bars: ReturnType<typeof bar>[], display = 'LRCX') {
  const newest = bars[bars.length - 1]
  return {
    observed: newest
      ? {
          value: bars,
          source: SOURCE,
          observedAt: `${newest.date}T22:00:00.000Z`,
          effectiveAt: newest.date,
          adjustment: 'unknown' as const,
          currency: 'USD',
        }
      : null,
    verdict: VERDICT,
    displaySymbol: display,
  }
}

function closeResult(date: string, close: number, display = 'LRCX') {
  return {
    observed: {
      value: close,
      source: SOURCE,
      observedAt: `${date}T22:00:00.000Z`,
      effectiveAt: date,
      adjustment: 'unknown' as const,
      currency: 'USD',
    },
    verdict: VERDICT,
    label: 'Last close',
    displaySymbol: display,
  }
}

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
  >
    {children}
  </QueryClientProvider>
)

function read(id: string | null, symbol: string | null) {
  return renderHook(() => useSlashReading({ id, symbol }), { wrapper: wrap })
}

beforeEach(() => {
  resolveSymbol.mockReset()
  latestClose.mockReset()
  closeSeries.mockReset()
  resolveSymbol.mockResolvedValue({ status: 'resolved', ref: REF, viaFold: false })
})
afterEach(cleanup)

describe('what it does not read', () => {
  it('reads nothing at all without a command or a symbol', () => {
    expect(read(null, 'LRCX').result.current).toBeNull()
    expect(read('price', null).result.current).toBeNull()
    expect(resolveSymbol).not.toHaveBeenCalled()
  })

  it('reads nothing for a figure the store cannot answer', () => {
    /* `/pe.LRCX` must cost no query: the answer is a statement about what is
       stored, and it is known before any read. */
    for (const id of ['marketcap', 'pe', 'dividend']) {
      expect(read(id, 'LRCX').result.current, id).toBeNull()
    }
    expect(resolveSymbol).not.toHaveBeenCalled()
    expect(latestClose).not.toHaveBeenCalled()
  })

  it('reports loading before it reports anything else', () => {
    latestClose.mockResolvedValue(closeResult('2026-11-12', 712.34))
    const { result } = read('price', 'LRCX')
    expect(result.current).toEqual({ state: 'loading', id: 'price', symbol: 'LRCX' })
  })
})

describe('the ticker is resolved, not matched', () => {
  it('asks the cache under the PRICING symbol, and shows the recorded one', async () => {
    /*
     * `price_history_cache` is keyed by what an instrument trades as today;
     * a card says what the holdings file said. Block is SQ on the card and
     * XYZ in the cache, and every surface that asked under the display
     * ticker drew no chart and was reported as missing data.
     */
    const renamed: SecurityRef = { ...REF, recordedSymbol: 'SQ', pricingSymbol: 'XYZ' }
    resolveSymbol.mockResolvedValue({ status: 'resolved', ref: renamed, viaFold: true })
    latestClose.mockResolvedValue(closeResult('2026-11-12', 61.5, 'SQ'))

    const { result } = read('price', 'SQ')
    await waitFor(() => expect(result.current?.state).toBe('ok'))
    expect(latestClose).toHaveBeenCalledWith(renamed)
    expect(result.current?.symbol).toBe('SQ')
  })

  it('reports an ambiguous ticker instead of picking one', async () => {
    /* THE case. Picking a candidate would put another instrument's price in
       front of the reader with full provenance attached to it. */
    resolveSymbol.mockResolvedValue({
      status: 'ambiguous',
      candidates: [REF, { ...REF, assetId: 'a-2', mic: 'XLON' }],
      reason: 'two listings',
    })

    const { result } = read('price', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('empty'))
    expect(result.current?.detail).toMatch(/more than one/i)
    expect(result.current?.detail).toContain('XNAS')
    expect(result.current?.detail).toContain('XLON')
    expect(latestClose).not.toHaveBeenCalled()
  })

  it('says the instrument is not in the universe when it is not', async () => {
    resolveSymbol.mockResolvedValue({ status: 'not_found' })
    const { result } = read('price', 'ZZZZ')
    await waitFor(() => expect(result.current?.state).toBe('empty'))
    expect(result.current?.detail).toContain('ZZZZ')
    expect(latestClose).not.toHaveBeenCalled()
  })
})

describe('the close', () => {
  it('returns the figure with the readers own label and provenance', async () => {
    latestClose.mockResolvedValue(closeResult('2026-11-12', 712.34))
    const { result } = read('price', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('ok'))
    expect(result.current?.observed?.value).toBe(712.34)
    expect(result.current?.observed?.effectiveAt).toBe('2026-11-12')
    /* Produced beside the number by the reader, never retyped here. */
    expect(result.current?.label).toBe('Last close')
  })

  it('says nothing is stored rather than returning a zero', async () => {
    latestClose.mockResolvedValue({
      observed: null, verdict: VERDICT, label: 'No price', displaySymbol: 'LRCX',
    })
    const { result } = read('price', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('empty'))
    expect(result.current?.observed ?? null).toBeNull()
  })
})

describe('the order of the bars', () => {
  /*
   * `fetchBars` sorts ASCENDING, because that is how a chart draws. Reading
   * the two most recent closes therefore means the LAST two. This suite is
   * the one that catches a front-of-array read, and the numbers are chosen
   * so a wrong read produces a plausible percentage rather than a crash.
   */
  const WEEK = [
    bar('2026-11-09', 600),
    bar('2026-11-10', 620),
    bar('2026-11-11', 700),
    bar('2026-11-12', 712.34),
  ]

  it('differences the two MOST RECENT closes', async () => {
    closeSeries.mockResolvedValue(seriesResult(WEEK))
    const { result } = read('change', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('ok'))
    expect(result.current?.observed?.value).toBe(712.34)
    expect(result.current?.previous).toEqual({ close: 700, date: '2026-11-11' })
    /* The two oldest would be 600 and 620: a +3.33% that looks like a real
       move. That is why this asserts the closes and not just the sign. */
    expect(result.current?.previous?.close).not.toBe(600)
  })

  it('dates the figure to the newest bar', async () => {
    closeSeries.mockResolvedValue(seriesResult(WEEK))
    const { result } = read('change', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('ok'))
    expect(result.current?.observed?.effectiveAt).toBe('2026-11-12')
  })

  it('takes volume off the newest bar too', async () => {
    closeSeries.mockResolvedValue(seriesResult([bar('2026-11-11', 700, 111), bar('2026-11-12', 712.34, 4821900)]))
    latestClose.mockResolvedValue(closeResult('2026-11-12', 712.34))
    const { result } = read('volume', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('ok'))
    expect(result.current?.observed?.value).toBe(4821900)
  })

  it('refuses a change with only one stored close', async () => {
    closeSeries.mockResolvedValue(seriesResult([bar('2026-11-12', 712.34)]))
    const { result } = read('change', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('empty'))
    expect(result.current?.detail).toMatch(/nothing to compare/i)
  })

  it('says so when no volume is stored for the session', async () => {
    latestClose.mockResolvedValue(closeResult('2026-11-12', 712.34))
    closeSeries.mockResolvedValue(seriesResult([bar('2026-11-12', 712.34, null)]))
    const { result } = read('volume', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('empty'))
    expect(result.current?.detail).toMatch(/no volume/i)
    expect(result.current?.detail).toContain('2026-11-12')
  })
})

describe('when the read fails', () => {
  it('says the read failed, and offers no question in its place', async () => {
    /*
     * The regression that matters most. A failed lookup silently becoming
     * "What is the current price of LRCX?" is exactly the behaviour this
     * change removed, and it would look like a feature working.
     */
    resolveSymbol.mockRejectedValue(new Error('PGRST301'))
    const { result } = read('price', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('error'))
    expect(result.current?.detail).toMatch(/lookup failed/i)
    expect(JSON.stringify(result.current)).not.toMatch(/\?/)
  })

  it('does not guess why', async () => {
    /* A read that threw says nothing about whether the figure exists, so
       `empty` would be a claim the error does not support. */
    latestClose.mockRejectedValue(new Error('boom'))
    const { result } = read('price', 'LRCX')
    await waitFor(() => expect(result.current?.state).toBe('error'))
    expect(result.current?.detail).not.toMatch(/not stored|no instrument|universe/i)
  })
})
