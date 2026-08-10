import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Real price history for a symbol, by timeframe.
 *
 * Exists because `ChartDataAdapter.generateHistoricalData` — which most chart
 * surfaces still call — is a seeded random walk anchored to the current quote,
 * and `generateIntradayData` is a plain `Math.random()` walk. They draw a
 * plausible-looking line that has never had anything to do with the security.
 *
 * In a finance product that is a correctness problem, not a cosmetic one: a
 * line beside a real price reads as real price history, and a reader cannot
 * tell the difference. It gets worse with a scrub readout on top, which turns
 * an ambiguous squiggle into a precise claim — "$412.30 on 14 March" — about
 * a number nobody ever traded at.
 *
 * Routed through `yahoo-chart-proxy` for the same reason `useSparklines` is:
 * Yahoo's endpoint blocks browser origins.
 */

export type PriceTimeframe = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'MAX'

export interface PricePoint {
  timestamp: number
  value: number
}

export interface PriceHistory {
  points: PricePoint[]
  /** Yahoo's live figure for the symbol, when the response carried one. */
  currentPrice: number | null
  previousClose: number | null
  /** Change across the *visible window*, which is what the chart is showing. */
  windowChange: number | null
  windowChangePercent: number | null
}

/**
 * Interval/range per timeframe. Yahoo rejects mismatched pairs (a 5-minute
 * interval over five years, say), so these are fixed rather than derived.
 */
const SPEC: Record<PriceTimeframe, { interval: string; range: string }> = {
  '1D':  { interval: '5m',  range: '1d' },
  '5D':  { interval: '15m', range: '5d' },
  '1M':  { interval: '1d',  range: '1mo' },
  '3M':  { interval: '1d',  range: '3mo' },
  '6M':  { interval: '1d',  range: '6mo' },
  '1Y':  { interval: '1d',  range: '1y' },
  '5Y':  { interval: '1wk', range: '5y' },
  'MAX': { interval: '1mo', range: 'max' },
}

/** Intraday moves; daily series do not. Keeps the query quiet on long ranges. */
const STALE_MS: Record<PriceTimeframe, number> = {
  '1D': 60_000, '5D': 5 * 60_000,
  '1M': 30 * 60_000, '3M': 30 * 60_000, '6M': 60 * 60_000,
  '1Y': 60 * 60_000, '5Y': 6 * 60 * 60_000, 'MAX': 24 * 60 * 60_000,
}

export function usePriceHistory(
  symbol: string | null | undefined,
  timeframe: PriceTimeframe,
  options?: { enabled?: boolean }
) {
  const spec = SPEC[timeframe]

  return useQuery<PriceHistory>({
    queryKey: ['price-history', symbol, timeframe],
    enabled: (options?.enabled ?? true) && !!symbol,
    staleTime: STALE_MS[timeframe],
    gcTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('yahoo-chart-proxy', {
        body: { symbol, interval: spec.interval, range: spec.range },
      })
      if (error) throw error

      const result = (data as any)?.chart?.result?.[0]
      const timestamps: number[] = result?.timestamp ?? []
      const closes: unknown[] = result?.indicators?.quote?.[0]?.close ?? []

      // Yahoo pads gaps (holidays, halts) with nulls. Dropping the pair keeps
      // the series honest — interpolating would invent prices, which is the
      // whole thing this hook exists to stop.
      const points: PricePoint[] = []
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i]
        if (typeof c === 'number' && Number.isFinite(c)) {
          points.push({ timestamp: timestamps[i] * 1000, value: c })
        }
      }

      const meta = result?.meta ?? {}
      const first = points[0]?.value ?? null
      const last = points[points.length - 1]?.value ?? null
      const windowChange = first != null && last != null ? last - first : null

      return {
        points,
        currentPrice: typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : last,
        previousClose: typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : null,
        windowChange,
        windowChangePercent:
          windowChange != null && first ? (windowChange / first) * 100 : null,
      }
    },
  })
}
