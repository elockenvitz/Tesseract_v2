/**
 * Today's price history must arrive whole.
 *
 * ── The failure this exists to stop ──────────────────────────────────────
 *
 * PostgREST answers at most 1000 rows. This hook asked for every surfaced
 * name's history in one `.in('symbol', symbols)` query ordered by date
 * ASCENDING, so past five names the response hit the cap and the rows it
 * dropped were the newest ones.
 *
 * Measured against production on 2026-10-27: five symbols x 258 closes =
 * 1290 rows available, 1000 returned, last visible close 2026-07-10 against
 * a real last close of 2026-10-01. Nothing errored. `spot` was simply the
 * price from twelve weeks earlier, and every figure derived from it was
 * computed to that date:
 *
 *   symbol   Today printed   the truth
 *   AAPL     +21.8%          +27.6%
 *   AMZN      +8.4%           +9.7%
 *   NKE      -19.0%          -35.8%
 *   TSLA      +7.1%           -7.0%     <- wrong sign
 *   WMT       +6.4%           -2.6%     <- wrong sign
 *
 * A user clicked a tile saying TSLA was up 7% and landed on an asset page
 * saying it was down 7%, because that page queries one symbol at a time and
 * never hit the cap.
 *
 * So the property under test is not "the numbers are right" -- that is the
 * database's answer, not this hook's. It is the two structural facts that
 * make a right answer possible: no request can reach the cap, and if one
 * ever does the hook says so instead of returning a shortened window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Every `.in('symbol', [...])` group this hook asked for, in order. */
let asked: string[][]
/** How many rows the mocked table returns per request. */
let rowsPerRequest: number

/** The slice of the query builder this hook actually calls, and no more. */
interface Builder {
  select: () => Builder
  gte: () => Builder
  in: (col: string, group: string[]) => Builder
  order: () => Promise<{ data: { symbol: string; date: string; close: number }[]; error: null }>
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder: Builder = {
        select: () => builder,
        gte: () => builder,
        order: () => Promise.resolve({
          data: Array.from({ length: rowsPerRequest }, (_, i) => ({
            symbol: asked[asked.length - 1][0],
            date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
            close: 100 + i,
          })),
          error: null,
        }),
        in: (_col: string, group: string[]) => { asked.push(group); return builder },
      }
      return builder
    },
  },
}))

const { fetchHistory, CHUNK, ROW_CAP, HISTORY_DAYS } = await import('../useTodayEnrichment')

beforeEach(() => { asked = []; rowsPerRequest = 10 })

describe('Today asks for price history in windows that cannot be truncated', () => {
  it('is sized so a close on every calendar day still fits under the cap', () => {
    /*
     * The arithmetic the whole fix rests on. Raising HISTORY_DAYS without
     * re-deriving CHUNK is exactly how this regresses, and it regresses
     * silently -- which is why it is asserted rather than commented.
     */
    expect(CHUNK * HISTORY_DAYS).toBeLessThan(ROW_CAP)
  })

  it('never puts more than CHUNK symbols in one request', async () => {
    await fetchHistory(['AAPL', 'AMZN', 'NKE', 'TSLA', 'WMT', 'TGT'], '2025-09-23')
    expect(asked.length).toBeGreaterThan(1)
    for (const group of asked) expect(group.length).toBeLessThanOrEqual(CHUNK)
  })

  it('asks for every symbol exactly once', async () => {
    const symbols = ['AAPL', 'AMZN', 'NKE', 'TSLA', 'WMT', 'TGT']
    await fetchHistory(symbols, '2025-09-23')
    expect(asked.flat().sort()).toEqual([...symbols].sort())
  })

  it('refuses a full page instead of returning a shortened window', async () => {
    // The silent failure, made loud. A response AT the cap is a response
    // missing its most recent rows, and a chart drawn from it states a price
    // move that ended weeks ago.
    rowsPerRequest = ROW_CAP
    await expect(fetchHistory(['AAPL', 'AMZN'], '2025-09-23')).rejects.toThrow(/truncated/)
  })

  it('returns every row it was given', async () => {
    rowsPerRequest = 7
    const rows = await fetchHistory(['AAPL', 'AMZN', 'NKE', 'TSLA'], '2025-09-23')
    expect(rows).toHaveLength(7 * asked.length)
  })
})
