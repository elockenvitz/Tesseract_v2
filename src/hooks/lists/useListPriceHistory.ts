import { useMemo } from 'react'

import { usePriceHistory } from '../mobile/usePriceHistory'
import { useTickerAliases, tradedSymbol } from '../mobile/useTickerAliases'
import type { PricePoint } from '../../components/signals/PriceContext'
import {
  windowReturn, returnPath, localDomain, latestClose, closeAgeDays,
  WINDOW_DAYS, type WindowReturn, type LatestClose,
} from '../../lib/lists/price-metrics'

/**
 * Cached daily closes for the names in a List, in one batched read.
 *
 * ── Why this exists, and why it is thin ───────────────────────────────────
 *
 * The collapsed row used to draw its sparkline from `useSparklines`, which
 * calls the `yahoo-chart-proxy` edge function. In the running application that
 * function answers 502 on every call and the live quote provider is refused by
 * the page's own CSP, so the Market column had no data path at all: no trend,
 * and a `changePercent` of zero that the cell rendered as `+0.0%` on every row.
 *
 * `price_history_cache` is already in the database, already backfilled nightly,
 * and already read by the inspector's chart. This points the collapsed row at
 * the same table, so the row and the panel below it draw from one series.
 *
 * It is deliberately a thin wrapper rather than a new reader. `usePriceHistory`
 * already pages around the 1,000-row PostgREST cap with a deterministic
 * (date, symbol) ordering, drops zero closes, and returns ascending series —
 * all of which took two bugs to get right. Re-implementing it for Lists would
 * be re-acquiring those bugs.
 *
 * ── The two things Lists has to add ───────────────────────────────────────
 *
 * ALIASES. The cache is keyed by what an instrument trades as now; a list
 * shows what the holdings file called it. Block is `SQ` on the row and `XYZ`
 * in the cache, so asking under the display ticker returns an empty series
 * that is indistinguishable from a name with no history — a mistake
 * `useSymbolHistory` documents having made and reported as missing data. The
 * mapping is applied here and the result is keyed back to the DISPLAY symbol,
 * so no caller has to know about it.
 *
 * COVERAGE. The feed caps at 24 names because it is an endless scroller. A
 * list is a bounded working set the reader assembled, so the budget is spent
 * on covering it instead.
 */

/**
 * Six months plus a real margin, which is the longest window the row quotes.
 *
 * The row shows 1M and 6M. A 6M return is refused unless the series actually
 * spans 186 calendar days (`windowReturn`, minus a week of slack), and 130
 * trading days is only ~182 — close enough to the floor that a few market
 * holidays would silently turn the whole 6M column into "no history". 145
 * gives ~203 days, which clears it. Asking for the full ~260 would raise the
 * request count to draw exactly the same two figures.
 */
const POINTS = 145

/**
 * Names per list that carry a series.
 *
 * 48 × 130 ≈ 6,240 rows ≈ 7 pages, cached for an hour. Past this the trend
 * cell renders empty rather than wrong — see `covered` below, which the column
 * uses to tell "no history on file" apart from "beyond this list's budget".
 */
const MAX_SYMBOLS = 48

/** Everything the Market column may say about one row, already decided. */
export interface RowMarket {
  points: PricePoint[] | null
  /** The 1M and 6M moves, or the reason there is no number. */
  m1: WindowReturn
  m6: WindowReturn
  /** 1-month path in percentage-return space. */
  path: number[]
  /** 6-month path, for Monitor's Trend column. */
  path6: number[]
  /** This security's own vertical range over `path6`. See `localDomain`. */
  domain: { lo: number; hi: number }
  lastClose: LatestClose | null
  ageDays: number | null
  /** False when the symbol fell outside the fetch budget — not "no data". */
  covered: boolean
}

export interface ListPriceHistory {
  /** Ascending daily closes for a DISPLAY symbol, or null. */
  historyFor: (symbol?: string | null) => PricePoint[] | null
  marketFor: (symbol?: string | null) => RowMarket
  isLoading: boolean
}

const SPARK_DAYS = WINDOW_DAYS['1M']

const EMPTY_MARKET: RowMarket = {
  points: null,
  m1: { pct: null, refused: 'no-series', slice: [] },
  m6: { pct: null, refused: 'no-series', slice: [] },
  path: [],
  path6: [],
  domain: { lo: -3, hi: 3 },
  lastClose: null,
  ageDays: null,
  covered: false,
}

export function useListPriceHistory(
  symbols: (string | null | undefined)[],
  options?: { enabled?: boolean },
): ListPriceHistory {
  const { data: aliases } = useTickerAliases()

  // Display symbol → traded symbol, in list order and de-duplicated.
  const mapped = useMemo(() => {
    const pairs: Array<{ display: string; traded: string }> = []
    const seen = new Set<string>()
    for (const s of symbols) {
      const display = (s ?? '').trim().toUpperCase()
      if (!display || seen.has(display)) continue
      seen.add(display)
      const traded = (tradedSymbol(display, aliases) || display).toUpperCase()
      pairs.push({ display, traded })
    }
    return pairs
  }, [symbols, aliases])

  /*
   * Budgeted in LIST order, not alphabetically.
   *
   * The batched reader sorts its symbol set to keep the query key stable,
   * which is right for the key and wrong for deciding who gets dropped: an
   * alphabetical cut would hand the budget to the As and starve whatever the
   * reader happened to put at the top of their list.
   */
  const budgeted = mapped.slice(0, MAX_SYMBOLS)
  const tradedList = budgeted.map(p => p.traded)

  const { data, isLoading } = usePriceHistory(tradedList, {
    enabled: (options?.enabled ?? true) && tradedList.length > 0,
    points: POINTS,
    maxSymbols: MAX_SYMBOLS,
  })

  return useMemo(() => {
    const markets = new Map<string, RowMarket>()

    for (const { display, traded } of budgeted) {
      const points = data?.get(traded) ?? null
      const path = points ? returnPath(points, SPARK_DAYS) : []
      const path6 = points ? returnPath(points, WINDOW_DAYS['6M']) : []
      const last = latestClose(points)
      markets.set(display, {
        points,
        m1: windowReturn(points, '1M'),
        m6: windowReturn(points, '6M'),
        path,
        path6,
        /* Per security, over the window the Trend column actually draws.
           A domain shared across rows was comparable and unreadable: one
           +180% name set the scale and flattened everything else to a
           pixel. The comparable measures are the 1M and 6M numbers in the
           two columns beside it; the line's job is the shape. */
        domain: localDomain(path6),
        lastClose: last,
        ageDays: closeAgeDays(last?.date),
        covered: true,
      })
    }

    const key = (s?: string | null) => (s ?? '').trim().toUpperCase()

    return {
      historyFor: (s) => markets.get(key(s))?.points ?? null,
      marketFor: (s) => markets.get(key(s)) ?? EMPTY_MARKET,
      isLoading,
    }
  }, [data, isLoading, budgeted])
}
