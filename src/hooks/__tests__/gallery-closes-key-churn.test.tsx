/**
 * A gallery whose symbol list grows must not go back to its skeleton.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `useGalleryCloses` keys its query on the JOINED SYMBOL LIST, and that list
 * is not stable during a load: it is derived from the surface's own source
 * query, so it grows as those rows arrive. Measured on a cold Dashboard load
 * (release candidate, Chrome, localhost production build) the SAME gallery
 * created five keys:
 *
 *     gallery-closes   9 symbols   -> observers 0
 *     gallery-closes  12 symbols   -> observers 0
 *     gallery-closes  56 symbols   -> observers 0
 *     gallery-closes  65 symbols   -> observers 0
 *     gallery-closes  66 symbols   -> observers 1   <- the only one still read
 *
 * Four complete results, fetched and then discarded.
 *
 * The network cost is largely absorbed by the burst coalescer, so this is
 * not mainly a request-count defect -- it is a RENDERING one. Every growth
 * step is a cache miss, so `status` returns to 'pending', the hook's
 * `pending` flag goes true, and every tile that had drawn a sparkline loses
 * it and redraws. That is the grid reassembling under the cursor, which is
 * the exact symptom the one-batched-read in `useGalleryCloses` was written
 * to remove -- reintroduced one level up, by the key rather than by the
 * request.
 *
 * ── Why keeping the previous result is SAFE here, not merely nicer ────────
 *
 * Each key is a superset of the one before, because the list only grows as
 * more rows arrive. A symbol's closes are the same closes under either key,
 * so the retained map can be incomplete but never WRONG. The inverse case is
 * pinned below: a symbol absent from the previous map must not be invented.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const env = vi.hoisted(() => ({
  /** Every symbol list the hook actually asked the network for. */
  asked: [] as string[][],
  /** Resolve manually so a growth step can be observed MID-FLIGHT. */
  gate: null as null | (() => void),
}))

vi.mock('../../lib/market-data/daily-closes', async importOriginal => {
  const actual = await importOriginal<
    typeof import('../../lib/market-data/daily-closes')
  >()
  return {
    ...actual,
    fetchDailyCloses: async (symbols: readonly string[]) => {
      env.asked.push([...symbols])
      if (env.gate) await new Promise<void>(res => { env.gate = res })
      /* One close per symbol, value derived from the symbol so a wrong
         association is visible rather than merely absent. */
      return symbols.map(s => ({
        symbol: s,
        date: '2026-11-18',
        close: s.length * 10,
      }))
    },
    fetchYearRange: async () => new Map(),
  }
})

import { useGalleryCloses } from '../useTileCloses'

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

const freshClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })

beforeEach(() => {
  env.asked = []
  env.gate = null
})

describe('a growing gallery keeps what it already drew', () => {
  it('does not return to pending when the symbol list grows', async () => {
    const client = freshClient()
    const { result, rerender } = renderHook(
      ({ symbols }: { symbols: string[] }) => useGalleryCloses(symbols),
      { wrapper: wrapper(client), initialProps: { symbols: ['AAPL', 'MSFT'] } },
    )

    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.map.get('AAPL')).toHaveLength(1)

    /* The source query resolves more rows: the list grows, so the KEY
       changes. This is the moment the gallery used to blank. */
    rerender({ symbols: ['AAPL', 'MSFT', 'NVDA', 'TSLA'] })

    expect(result.current.pending).toBe(false)
    expect(result.current.map.get('AAPL')).toHaveLength(1)

    await waitFor(() =>
      expect(result.current.map.get('NVDA')).toHaveLength(1),
    )
  })

  it('keeps the earlier sparklines visible while the superset is in flight', async () => {
    const client = freshClient()
    const { result, rerender } = renderHook(
      ({ symbols }: { symbols: string[] }) => useGalleryCloses(symbols),
      { wrapper: wrapper(client), initialProps: { symbols: ['AAPL'] } },
    )
    await waitFor(() => expect(result.current.map.get('AAPL')).toHaveLength(1))

    /* Hold the next fetch open, so what follows is strictly the mid-flight
       state rather than a race that happens to have resolved. */
    env.gate = () => {}
    rerender({ symbols: ['AAPL', 'MSFT'] })

    expect(result.current.pending).toBe(false)
    expect(result.current.map.get('AAPL')).toHaveLength(1)
  })

  it('does not invent a symbol the previous result never held', async () => {
    const client = freshClient()
    const { result, rerender } = renderHook(
      ({ symbols }: { symbols: string[] }) => useGalleryCloses(symbols),
      { wrapper: wrapper(client), initialProps: { symbols: ['AAPL'] } },
    )
    await waitFor(() => expect(result.current.map.get('AAPL')).toHaveLength(1))

    env.gate = () => {}
    rerender({ symbols: ['AAPL', 'MSFT'] })

    /* Retained data may be INCOMPLETE. It must never be fabricated: MSFT
       has not been answered for yet. */
    expect(result.current.map.get('MSFT')).toBeUndefined()
  })

  it('still reports pending on a first load, with nothing to keep', async () => {
    const client = freshClient()
    env.gate = () => {}
    const { result } = renderHook(() => useGalleryCloses(['AAPL']), {
      wrapper: wrapper(client),
    })

    /* No previous result exists, so the skeleton is correct here and the
       fix must not suppress it. */
    expect(result.current.pending).toBe(true)
    expect(result.current.map.size).toBe(0)
  })

  it('reports not-pending for an empty symbol list', () => {
    const client = freshClient()
    const { result } = renderHook(() => useGalleryCloses([]), {
      wrapper: wrapper(client),
    })
    expect(result.current.pending).toBe(false)
    expect(env.asked).toHaveLength(0)
  })
})
