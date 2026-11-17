import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { AdapterFailure, MarketDataProviderId } from '../lib/market-data/contracts'
import { useMarketDataEntitlement } from '../lib/market-data/provider-routing'
import { eodhdBars, eodhdLatest } from '../lib/market-data/eodhd-client'
import { resolveEodhdSymbol } from '../lib/market-data/eodhd-symbol'
import {
  toSeriesPoints,
  windowForTimeframe,
  type EodhdIntradayBar,
  type EodhdPriceBar,
} from '../lib/market-data/eodhd-series'

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
  /**
   * Which provider actually answered.
   *
   * Present so a surface can label what it drew. It is a RESULT, not a
   * request: the routing decision is the server's, and this reports what came
   * back rather than what was asked for.
   */
  provider?: MarketDataProviderId
  /** `delayed` / `eod` / `realtime`, where the provider stated it. */
  delivery?: string
  /** The instant of the newest bar actually drawn, ISO 8601. */
  lastBarAt?: string
  /**
   * How precisely `lastBarAt` is known. `session_date` means only the trading
   * date is known and the instant within it is a lower bound.
   */
  lastBarPrecision?: 'instant' | 'session_date'
  /** Raw versus adjusted basis, where the provider stated it. */
  adjustment?: string
  /**
   * Set when the provider declined rather than returned bars.
   *
   * Carried instead of thrown so a chart can distinguish an empty window from
   * an unknown instrument from an unsupported interval, and say which.
   */
  failure?: AdapterFailure
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

/**
 * Merge the live price into the series, or refuse to.
 *
 * Extracted so both providers merge by identical rules. When this lived
 * inside the Yahoo branch, adding a second provider would have meant a second
 * copy of the sanity guard — and a second copy is how one of them ends up
 * without it.
 */
function stitchLive(args: {
  points: PricePoint[]
  live: number | null
  liveTime: number
  bucketMs: number
}): { points: PricePoint[]; stitched: boolean; stitchRejected?: PriceHistory['stitchRejected'] } {
  const { points, live, liveTime, bucketMs } = args
  const lastPoint = points[points.length - 1]
  if (live == null || !lastPoint) return { points, stitched: false }

  const deviation = Math.abs(live - lastPoint.value) / (lastPoint.value || 1)
  if (deviation > MAX_STITCH_DEVIATION) {
    return { points, stitched: false, stitchRejected: { last: lastPoint.value, live, deviation } }
  }
  if (live === lastPoint.value) return { points, stitched: false }

  if (liveTime - lastPoint.timestamp < bucketMs) {
    // Same bar — update it in place rather than adding a second one.
    points[points.length - 1] = {
      timestamp: lastPoint.timestamp,
      value: live,
      date: lastPoint.date,
    }
  } else {
    points.push({ timestamp: liveTime, value: live, date: new Date(liveTime) })
  }
  return { points, stitched: true }
}

/**
 * EODHD history for one symbol and timeframe.
 *
 * Reads bars, then the delayed quote, and stitches by the same rules as the
 * Yahoo path. A declined bars request is RETURNED as a failure with an empty
 * series rather than thrown, so the chart can say which of the four reasons
 * it was — an unpublished window reads very differently from an unknown
 * ticker, and before `no_data` existed they read identically.
 *
 * There is no fallback to Yahoo here. Silently swapping provider would change
 * data quality without telling anyone, which is the thing a provenance trail
 * exists to prevent.
 */
async function fetchEodhdHistory(
  symbol: string,
  timeframe: PriceTimeframe,
): Promise<PriceHistory> {
  const empty: PriceHistory = {
    points: [],
    currentPrice: null,
    previousClose: null,
    windowChange: null,
    windowChangePercent: null,
    stitched: false,
    provider: 'eodhd',
  }

  /*
   * `AAPL` is not an EODHD symbol; `AAPL.US` is. The suffix comes from the
   * provider's own search, never from `assets.exchange`, which is free text
   * in which three spellings of one venue already appear. See
   * `eodhd-symbol.ts` for why a derived suffix is the dangerous option.
   */
  const resolved = await resolveEodhdSymbol(symbol)
  if (!resolved.ok) return { ...empty, failure: resolved.failure }
  const providerSymbol = resolved.symbol

  const window = windowForTimeframe(timeframe)
  const bars = await eodhdBars({
    symbol: providerSymbol,
    from: window.from,
    to: window.to,
    interval: window.interval,
  })

  if (!bars.ok) return { ...empty, failure: bars.failure }

  const envelope = bars.data
  const rows = (envelope.value ?? []) as Array<EodhdPriceBar | EodhdIntradayBar>
  const points = toSeriesPoints(rows)
  if (points.length === 0) {
    return {
      ...empty,
      failure: {
        kind: 'no_data',
        detail: `EODHD returned no usable bars for ${providerSymbol} in this window.`,
      },
    }
  }

  // The quote is a nice-to-have on top of real bars. If it fails, the chart
  // still shows the bars rather than nothing.
  let live: number | null = null
  let liveTime = Date.now()
  const quote = await eodhdLatest(providerSymbol)
  if (quote.ok && typeof quote.data.value === 'number') {
    live = quote.data.value
    const at = quote.data.effectiveAt ? Date.parse(quote.data.effectiveAt) : Number.NaN
    if (Number.isFinite(at)) liveTime = at
  }

  const bucketMs = window.interval === '1d' ? 24 * 60 * 60_000 : 5 * 60_000
  const merged = stitchLive({ points, live, liveTime, bucketMs })

  const first = merged.points[0]?.value ?? null
  const last = merged.points[merged.points.length - 1]?.value ?? null
  const windowChange = first != null && last != null ? last - first : null

  return {
    points: merged.points,
    currentPrice: last,
    // EODHD's bars carry no previous-close field, and deriving one from the
    // second-to-last bar would be a different figure wearing the same name.
    previousClose: null,
    windowChange,
    windowChangePercent: windowChange != null && first ? (windowChange / first) * 100 : null,
    stitched: merged.stitched,
    stitchRejected: merged.stitchRejected,
    provider: 'eodhd',
    delivery: envelope.source?.delivery,
    lastBarAt: envelope.effectiveAt,
    lastBarPrecision: envelope.effectiveAtPrecision,
    adjustment: envelope.adjustment,
  }
}

export function usePriceHistory(
  symbol: string | null | undefined,
  timeframe: PriceTimeframe,
  options?: { enabled?: boolean; provider?: MarketDataProviderId }
) {
  const spec = SPEC[timeframe]
  const entitlement = useMarketDataEntitlement()

  /*
   * An explicit `options.provider` is for the owner-only diagnostic and for
   * tests. It cannot widen access: naming `eodhd` here only selects a code
   * path, and the edge function still refuses an unentitled caller with a
   * 403, which arrives as a `not_supported` failure.
   */
  const provider: MarketDataProviderId = options?.provider ?? entitlement.provider

  return useQuery<PriceHistory>({
    /*
     * The provider is IN the key.
     *
     * Without it, a user who signs out and a different user who signs in to
     * the same tab share one cache entry, and the second one would be served
     * the first one's EODHD-derived series. That is a licensing leak achieved
     * purely by caching, so the key carries the provider and the entitlement
     * query carries the user id.
     */
    queryKey: ['price-history', provider, symbol, timeframe],
    /*
     * Wait for the entitlement answer rather than fetching from Yahoo and
     * then refetching from EODHD a moment later. The answer is cached for
     * five minutes, so only the first chart of a session waits for it.
     */
    enabled: (options?.enabled ?? true) && !!symbol && !entitlement.isLoading,
    staleTime: STALE_MS[timeframe],
    gcTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      if (provider === 'eodhd') return fetchEodhdHistory(symbol as string, timeframe)
      return fetchYahooHistory(symbol as string, spec)
    },
  })
}

/**
 * The Yahoo path, unchanged in behaviour.
 *
 * Lifted out of the hook's `queryFn` so the two providers sit side by side
 * instead of one being nested inside the other. The body below is the same
 * code, with the stitch step now calling the shared helper.
 */
async function fetchYahooHistory(
  symbol: string,
  spec: { interval: string; range: string },
): Promise<PriceHistory> {
  {
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
      const merged = stitchLive({
        points,
        live,
        liveTime,
        bucketMs: BUCKET_MS[spec.interval] ?? 24 * 60 * 60_000,
      })

      const first = merged.points[0]?.value ?? null
      const last = merged.points[merged.points.length - 1]?.value ?? null
      const windowChange = first != null && last != null ? last - first : null

      return {
        points: merged.points,
        // Deliberately the series' own last value, so the number rendered and
        // the end of the drawn line are the same figure by construction. When
        // the live price was rejected this reports what is actually plotted.
        currentPrice: last,
        previousClose: typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : null,
        windowChange,
        windowChangePercent:
          windowChange != null && first ? (windowChange / first) * 100 : null,
        stitched: merged.stitched,
        stitchRejected: merged.stitchRejected,
        provider: 'yahoo',
      }
  }
}
