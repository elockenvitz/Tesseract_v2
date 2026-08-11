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
  /**
   * Same field the old ChartDataAdapter emitted. Several charts key their
   * X axis on `date` rather than `timestamp`, so keeping it makes swapping
   * them onto real data a one-line change instead of an axis rewrite —
   * and stops a silently blank axis being the cost of fixing the prices.
   */
  date: Date
  /** Bar volume where the provider supplied it — volume charts need it. */
  volume?: number
}

export interface PriceHistory {
  points: PricePoint[]
  /**
   * The live figure — and, after stitching, exactly the value of the last
   * point in `points`. Render the readout from this rather than a separate
   * quote fetch, or the number and the end of the line will disagree.
   */
  currentPrice: number | null
  previousClose: number | null
  /** Change across the *visible window*, which is what the chart is showing. */
  windowChange: number | null
  windowChangePercent: number | null
  /** True when the live price was merged into the series. */
  stitched: boolean
  /**
   * Set when a live price was available but refused as implausible — see the
   * sanity guard in the stitch step. Surfaced rather than swallowed so a bad
   * upstream quote is diagnosable instead of just looking like a flat chart.
   */
  stitchRejected?: { last: number; live: number; deviation: number }
}

/**
 * Bar width per interval. Used to decide whether the live price belongs to the
 * bar already at the end of the series or starts a new one.
 */
const BUCKET_MS: Record<string, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1wk': 7 * 24 * 60 * 60_000,
  '1mo': 31 * 24 * 60 * 60_000,
}

/**
 * A live price this far from the last close is treated as bad data rather than
 * a real move — wrong currency, a stale symbol mapping, a provider glitch.
 * Drawing it would produce exactly the "weird price activity" this guards
 * against: a vertical spike at the right edge of an otherwise sane series.
 */
const MAX_STITCH_DEVIATION = 0.2

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

/**
 * Nearest supported timeframe for a day count.
 *
 * Most chart surfaces were written against `generateHistoricalData(symbol,
 * quote, days)` and think in days. Rather than rewrite each one's timeframe
 * model, they map through here — so the swap to real data is a one-line change
 * per component and their existing controls keep working.
 */
export function timeframeForDays(days: number): PriceTimeframe {
  if (days <= 1) return '1D'
  if (days <= 5) return '5D'
  if (days <= 31) return '1M'
  if (days <= 92) return '3M'
  if (days <= 183) return '6M'
  if (days <= 366) return '1Y'
  if (days <= 1826) return '5Y'
  return 'MAX'
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
      const volumes: unknown[] = result?.indicators?.quote?.[0]?.volume ?? []

      // Yahoo pads gaps (holidays, halts) with nulls. Dropping the pair keeps
      // the series honest — interpolating would invent prices, which is the
      // whole thing this hook exists to stop.
      const points: PricePoint[] = []
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i]
        if (typeof c === 'number' && Number.isFinite(c)) {
          const ms = timestamps[i] * 1000
          const v = volumes[i]
          points.push({
            timestamp: ms,
            value: c,
            date: new Date(ms),
            volume: typeof v === 'number' && Number.isFinite(v) ? v : undefined,
          })
        }
      }

      const meta = result?.meta ?? {}
      const live = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null
      const liveTime = typeof meta.regularMarketTime === 'number' ? meta.regularMarketTime * 1000 : Date.now()

      // ── Stitch the live price onto the series ───────────────────────────
      //
      // Two failure modes this prevents.
      //
      // Appending blindly: a daily bar is stamped at the session *open* but
      // already carries the latest price, so adding a point at "now" puts two
      // points on the same day — a visible kink at the right edge that is an
      // artefact of the merge rather than anything the security did.
      //
      // Not merging at all: the last completed intraday bar can trail the live
      // price by a whole bar, so a readout sourced separately would disagree
      // with where the line ends. Since the readout now reads from this same
      // object, they cannot drift apart.
      let stitched = false
      let stitchRejected: PriceHistory['stitchRejected']
      const lastPoint = points[points.length - 1]

      if (live != null && lastPoint) {
        const deviation = Math.abs(live - lastPoint.value) / (lastPoint.value || 1)
        if (deviation > MAX_STITCH_DEVIATION) {
          stitchRejected = { last: lastPoint.value, live, deviation }
        } else if (live !== lastPoint.value) {
          const bucket = BUCKET_MS[spec.interval] ?? 24 * 60 * 60_000
          if (liveTime - lastPoint.timestamp < bucket) {
            // Same bar — update it in place rather than adding a second one.
            points[points.length - 1] = { timestamp: lastPoint.timestamp, value: live, date: lastPoint.date }
          } else {
            points.push({ timestamp: liveTime, value: live, date: new Date(liveTime) })
          }
          stitched = true
        }
      }

      const first = points[0]?.value ?? null
      const last = points[points.length - 1]?.value ?? null
      const windowChange = first != null && last != null ? last - first : null

      return {
        points,
        // Deliberately the series' own last value, so the number rendered and
        // the end of the drawn line are the same figure by construction. When
        // the live price was rejected this reports what is actually plotted.
        currentPrice: last,
        previousClose: typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : null,
        windowChange,
        windowChangePercent:
          windowChange != null && first ? (windowChange / first) * 100 : null,
        stitched,
        stitchRejected,
      }
    },
  })
}
