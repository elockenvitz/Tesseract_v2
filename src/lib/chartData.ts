/**
 * Chart data fetching utilities for the charting system
 * Provides historical OHLC data for different timeframes.
 *
 * Historically fetched Yahoo Finance via public CORS proxies
 * (corsproxy.io / allorigins / codetabs). Those proxies have been
 * paywalled or rate-limited to uselessness, silently breaking every
 * chart in the app simultaneously. We now proxy Yahoo through the
 * `yahoo-chart-proxy` Supabase edge function which runs server-side
 * and has no CORS constraints.
 */
import { supabase } from './supabase'
import type { AdapterFailure, BarInterval, MarketDataProviderId } from './market-data/contracts'
import {
  applySplitAdjustment,
  detectSplitBasis,
  parseYahooSplits,
  type PriceBasis,
  type SplitEvent,
} from './market-data/price-adjustment'

export interface CandlestickData {
  time: string // YYYY-MM-DD format for daily, or unix timestamp
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface ChartDataRequest {
  symbol: string
  interval: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo'
  range: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max'
  /**
   * Which provider to read from. Defaults to `yahoo`, which every user has.
   *
   * A caller passes `eodhd` only when `useMarketDataEntitlement` reported the
   * server said yes. Naming it here grants nothing: the edge function
   * re-decides on every request and answers an unentitled caller with a 403.
   */
  provider?: MarketDataProviderId
}

/**
 * The adjustment basis a delivered series is on, and how that was decided.
 *
 * Carried beside the candles rather than looked up from the provider's name,
 * because a name is a guess and this is a measurement. See
 * `normaliseYahooSeries` below.
 */
export interface SeriesBasis {
  basis: PriceBasis
  /** The corporate actions inside the window, as the provider published them. */
  splits: SplitEvent[]
  /** Whether this code divided the prices, or the provider arrived adjusted. */
  adjustedHere: boolean
  /** One phrase naming what the conclusion rests on. */
  evidence: string
}

/**
 * What the Yahoo path does to a series before returning it.
 *
 * ── The finding that made this necessary ─────────────────────────────────
 *
 * Yahoo's `indicators.quote[0].close` is ALREADY split-adjusted. Measured
 * against the live endpoint on 2026-11-18: AAPL's daily closes run 23.06 on
 * 2014-06-06 to 23.42 on 2014-06-09, straight through a 7:1 split. The
 * provider table this code used to consult said `raw`, so the header stated
 * "raw prices · not split-adjusted" over an adjusted series. Both the label
 * and the reasoning behind it were wrong.
 *
 * So the basis is read off the series itself. When the window straddles a
 * split, the step in the closes answers the question outright. When it does
 * not, there is nothing to measure and the provider default stands -- and
 * that default is now a figure someone checked rather than assumed.
 *
 * If a window ever does arrive raw, it is adjusted here with the provider's
 * own published factors, and the basis then reports the series as delivered,
 * not as received.
 */
function normaliseYahooSeries(
  payload: unknown,
  candles: CandlestickData[],
): { candles: CandlestickData[]; basis: SeriesBasis } {
  const splits = parseYahooSplits(payload)
  const reading = detectSplitBasis(candles, splits)

  if (reading.basis === 'raw') {
    return {
      candles: applySplitAdjustment(candles, splits),
      basis: {
        basis: 'split_adjusted',
        splits,
        adjustedHere: true,
        evidence: `restated in current shares from the provider's own ratios (${reading.evidence})`,
      },
    }
  }

  if (reading.basis === 'split_adjusted') {
    return { candles, basis: { basis: 'split_adjusted', splits, adjustedHere: false, evidence: reading.evidence } }
  }

  /*
   * Nothing in the window to measure across. Yahoo's chart series is
   * split-adjusted -- verified above against the live endpoint across both
   * AAPL splits -- so that is what a window with no split in it is on too.
   *
   * This is the one place a provider's name still decides anything, and it
   * is bounded: any window that CAN be measured is measured, so the day
   * Yahoo changes what it sends, every long window says so.
   */
  return {
    candles,
    basis: {
      basis: 'split_adjusted',
      splits,
      adjustedHere: false,
      evidence: `no split in this window; Yahoo's chart series is split-adjusted (verified 2026-11-18)`,
    },
  }
}

/**
 * EODHD when its corporate actions are not available.
 *
 * `_shared/eodhd.ts` maps the RAW `close`, so without ratios the browser has
 * no way to restate the series and a split draws as a collapse. That is
 * reported as `raw` and flagged -- `adjustmentIsHazardous` makes the header
 * warn on it -- never silently relabelled, and never patched with a factor
 * inferred from the prices or borrowed from another feed.
 *
 * This is the state every EODHD chart is in until the `splits` operation
 * added in this change is DEPLOYED. Until then the behaviour is exactly
 * what it was.
 */
const EODHD_RAW_BASIS: SeriesBasis = {
  basis: 'raw',
  splits: [],
  adjustedHere: false,
  evidence: 'EODHD published no corporate actions for this window, so no adjustment could be applied',
}

/**
 * The basis for a series that never arrived.
 *
 * `unknown`, not a provider default: an empty or failed series has no basis,
 * and `adjustmentIsHazardous` flags `unknown` so nothing presents it as a
 * checked one.
 */
const UNKNOWN_BASIS: SeriesBasis = {
  basis: 'unknown',
  splits: [],
  adjustedHere: false,
  evidence: 'no series was delivered',
}

/**
 * The UI's interval in EODHD's vocabulary, or null when it has no such bar.
 *
 * EODHD offers 1m, 5m and 1h intraday and daily. It has no 15m and no 30m
 * bar, and no weekly or monthly intraday aggregate — so those return null and
 * the caller shows an unsupported state. Silently serving a 5m series for a
 * 15m request would mislabel the bar width on the axis.
 */
function eodhdIntervalFor(interval: ChartDataRequest['interval']): BarInterval | null {
  switch (interval) {
    case '1m': return '1m'
    case '5m': return '5m'
    case '1h': return '1h'
    case '1d': return '1d'
    // 15m, 30m, 1wk and 1mo have no EODHD equivalent.
    default: return null
  }
}

/** How far back a UI range reaches, in days. */
function rangeToDays(range: ChartDataRequest['range']): number {
  switch (range) {
    case '1d': return 4
    case '5d': return 9
    case '1mo': return 31
    case '3mo': return 92
    case '6mo': return 183
    case '1y': return 366
    case '2y': return 731
    case '5y': return 1826
    case 'max': return 365 * 25
  }
}

// Map our timeframes to Yahoo Finance parameters
const intervalMap: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '60m': '60m',
  '1h': '60m',
  '1d': '1d',
  '1wk': '1wk',
  '1mo': '1mo'
}

const rangeMap: Record<string, string> = {
  '1d': '1d',
  '5d': '5d',
  '1mo': '1mo',
  '3mo': '3mo',
  '6mo': '6mo',
  '1y': '1y',
  '2y': '2y',
  '5y': '5y',
  'max': 'max'
}

// UI timeframe to data parameters mapping
export const timeframeToParams: Record<string, { interval: string; range: string }> = {
  '1D': { interval: '5m', range: '1d' },
  '1W': { interval: '15m', range: '5d' },
  '1M': { interval: '1d', range: '1mo' },
  '3M': { interval: '1d', range: '3mo' },
  '6M': { interval: '1d', range: '6mo' },
  '1Y': { interval: '1d', range: '1y' },
  '2Y': { interval: '1d', range: '2y' },
  '5Y': { interval: '1wk', range: '5y' },
  '10Y': { interval: '1wk', range: 'max' },
  'ALL': { interval: '1mo', range: 'max' }
}

// Map days to Yahoo Finance range parameter (for fallback)
function daysToRange(days: number): string | null {
  if (days <= 1) return '1d'
  if (days <= 5) return '5d'
  if (days <= 30) return '1mo'
  if (days <= 90) return '3mo'
  if (days <= 180) return '6mo'
  if (days <= 365) return '1y'
  if (days <= 730) return '2y'
  if (days <= 1825) return '5y'
  if (days <= 3650) return '10y'
  return 'max'
}

// Yahoo Finance intraday data limitations (approximate max days)
const intradayMaxDays: Record<string, number> = {
  '1m': 7,      // 1-minute data available for ~7 days
  '5m': 60,     // 5-minute data available for ~60 days
  '15m': 60,    // 15-minute data available for ~60 days
  '30m': 60,    // 30-minute data available for ~60 days
  '60m': 730,   // Hourly data available for ~2 years
  '1h': 730,
}

/**
 * Call the yahoo-chart-proxy edge function and return the raw Yahoo
 * response body (shape: `{ chart: { result: [...], error: ... } }`).
 * Returns null on any error — callers should treat null as "no data".
 */
async function fetchYahooChart(params: {
  symbol: string
  interval: string
  range?: string
  period1?: number
  period2?: number
}): Promise<any | null> {
  try {
    const { data, error } = await supabase.functions.invoke('yahoo-chart-proxy', {
      body: params,
    })
    if (error) {
      console.warn('[chartData] yahoo-chart-proxy error:', error.message || error)
      return null
    }
    if (data?.error) {
      console.warn('[chartData] yahoo-chart-proxy returned error:', data.error, data.detail)
      return null
    }
    return data
  } catch (e: any) {
    console.warn('[chartData] yahoo-chart-proxy invoke threw:', e?.message || e)
    return null
  }
}

/**
 * Parse a Yahoo chart JSON response into CandlestickData[]. Null values
 * from Yahoo (holidays, gaps) are skipped. Daily/weekly/monthly bars are
 * emitted as YYYY-MM-DD; intraday bars as unix-seconds strings, matching
 * what `lightweight-charts` expects.
 */
function parseYahooChart(
  data: any,
  interval: string,
): CandlestickData[] {
  const chart = data?.chart?.result?.[0]
  if (!chart) return []

  const timestamps: number[] = chart.timestamp || []
  const quote = chart.indicators?.quote?.[0]
  if (!quote) return []

  const opens = quote.open || []
  const highs = quote.high || []
  const lows = quote.low || []
  const closes = quote.close || []
  const volumes = quote.volume || []

  const dailyIntervals = new Set(['1d', '1wk', '1mo'])
  const result: CandlestickData[] = []

  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null || opens[i] == null || highs[i] == null || lows[i] == null) {
      continue
    }
    const timestamp = timestamps[i]
    const date = new Date(timestamp * 1000)

    const time = dailyIntervals.has(interval)
      ? date.toISOString().split('T')[0]
      : String(timestamp)

    result.push({
      time,
      open: opens[i],
      high: highs[i],
      low: lows[i],
      close: closes[i],
      volume: volumes[i] || 0,
    })
  }

  return result
}

/**
 * One Yahoo window, fetched, parsed and put on a stated basis.
 *
 * EVERY Yahoo candle path goes through here. That is the point: a preset
 * range and the history panned in behind it must be on the same basis, or
 * the series has a join in it that nothing on screen marks -- which is
 * worse than a short series, because it looks like a price move. The same
 * reasoning is already written down for the EODHD path in
 * `fetchEodhdWindowResult`.
 */
async function yahooSeries(params: {
  symbol: string
  interval: string
  range?: string
  period1?: number
  period2?: number
}): Promise<{ candles: CandlestickData[]; basis: SeriesBasis }> {
  const payload = await fetchYahooChart(params)
  if (!payload) return { candles: [], basis: UNKNOWN_BASIS }
  return normaliseYahooSeries(payload, parseYahooChart(payload, params.interval))
}

class ChartDataService {
  private cache: Map<string, { data: CandlestickData[]; basis: SeriesBasis; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 60 * 1000 // 1 minute cache for chart data

  /**
   * Candles, plus why there are none.
   *
   * The reason is returned rather than swallowed because "no data available
   * for this symbol" is four different situations and only one of them is
   * the user's problem. An entitled account whose EODHD request was rate
   * limited, or asked for a bar size EODHD does not publish, or hit an
   * unpublished window, should be told which — not quietly shown an empty
   * chart that reads as "this security has no history".
   */
  async getChartDataResult(
    request: ChartDataRequest,
  ): Promise<{
    candles: CandlestickData[]
    failure?: AdapterFailure
    provider: MarketDataProviderId
    basis: SeriesBasis
  }> {
    /*
     * The provider is part of the cache key.
     *
     * This cache is a module-level `Map` shared by every chart in the tab and
     * it outlives a sign-out, so a key of symbol+interval+range alone would
     * hand an incoming unentitled session the previous user's EODHD candles —
     * no request made, nothing in any log to show it happened. The provider in
     * the key is what makes that impossible, and `clearCache` on sign-out is
     * the belt to this braces.
     */
    const provider = request.provider ?? 'yahoo'
    const cacheKey = `${provider}-${request.symbol}-${request.interval}-${request.range}`

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      // The basis is cached WITH the candles. Recomputing it on a hit, or
      // defaulting it, would let a cached series be described by a basis
      // that was not measured from it.
      return { candles: cached.data, provider, basis: cached.basis }
    }

    try {
      /*
       * No cross-provider fallback, ever.
       *
       * Once the server has said this session may use EODHD, an EODHD
       * failure is reported as a failure. Substituting Yahoo candles would
       * change the adjustment basis and the currency of the series without
       * anything on screen marking the swap, and the provenance badge beside
       * it would then be describing a feed that did not supply the data.
       *
       * The cached-on-error branch below is NOT a fallback: the cache key
       * contains the provider, so it can only return this same provider's
       * own earlier answer.
       */
      if (provider === 'eodhd') {
        const result = await this.fetchFromEodhdResult(request)
        if (result.candles.length > 0) {
          this.cache.set(cacheKey, { data: result.candles, basis: result.basis, timestamp: Date.now() })
        }
        return { ...result, provider }
      }

      const { candles, basis } = await this.fetchFromYahooFinance(request)
      if (candles.length > 0) {
        this.cache.set(cacheKey, { data: candles, basis, timestamp: Date.now() })
      }
      return { candles, provider, basis }
    } catch (error) {
      console.error('Failed to fetch chart data:', error)
      // This provider's own stale answer, never another provider's.
      if (cached) return { candles: cached.data, provider, basis: cached.basis }
      return {
        candles: [],
        provider,
        basis: UNKNOWN_BASIS,
        failure: { kind: 'unavailable', detail: 'The chart data request did not complete.' },
      }
    }
  }

  /** Candles only. Kept so the six existing callers are unchanged. */
  async getChartData(request: ChartDataRequest): Promise<CandlestickData[]> {
    return (await this.getChartDataResult(request)).candles
  }

  /**
   * EODHD candles for the same request shape.
   *
   * Maps the UI's interval/range pair onto the provider's inclusive date
   * window, and narrows the window to the documented per-interval cap before
   * asking rather than letting the provider refuse it.
   */
  private async fetchFromEodhdResult(
    request: ChartDataRequest,
  ): Promise<{ candles: CandlestickData[]; failure?: AdapterFailure; basis: SeriesBasis }> {
    const to = new Date()
    const from = new Date(to.getTime() - rangeToDays(request.range) * 86_400_000)
    return this.fetchEodhdWindowResult(request.symbol, request.interval, from, to)
  }

  /**
   * One EODHD window fetch, used by every candle path.
   *
   * All three public methods route through this so a chart cannot end up with
   * its preset range from one provider and its panned-in history from
   * another — a series whose adjustment basis changes partway along is worse
   * than a short series, because nothing on screen says where the join is.
   */
  private async fetchEodhdWindowResult(
    symbol: string,
    uiInterval: ChartDataRequest['interval'] | string,
    from: Date,
    to: Date,
  ): Promise<{ candles: CandlestickData[]; failure?: AdapterFailure; basis: SeriesBasis }> {
    const { eodhdBars } = await import('./market-data/eodhd-client')
    const { toCandles, INTRADAY_MAX_SPAN_DAYS } = await import('./market-data/eodhd-series')
    const { resolveEodhdSymbol } = await import('./market-data/eodhd-symbol')
    const { resamplePlanFor, resampleCandles } = await import('./market-data/resample')

    /*
     * EODHD publishes 1m, 5m, 1h and 1d. For 15m, 30m, 1wk and 1mo we ask for
     * the base size and combine the bars ourselves.
     *
     * Routing the entitled account to EODHD without this broke seven of the
     * fifteen Charting frequencies and four of the ten timeframe presets,
     * because `eodhdIntervalFor` correctly refused sizes the provider has no
     * endpoint for. Refusing was right; stopping there was incomplete.
     *
     * This is not the substitution the adapter still refuses. A weekly bar is
     * its daily bars combined, so the figures remain EODHD's own and the
     * delivery badge stays accurate. Drawing 5m bars under a 15m label, or
     * quietly serving Yahoo instead, would both misstate what is on screen.
     */
    const plan = resamplePlanFor(uiInterval as string)
    const requestedInterval = plan
      ? plan.base
      : eodhdIntervalFor(uiInterval as ChartDataRequest['interval'])

    const interval = requestedInterval
    if (!interval) {
      // No EODHD bar of this size and no base to build it from. Refused
      // rather than substituted, and named so the UI can say which it was.
      return {
        candles: [],
        basis: UNKNOWN_BASIS,
        failure: {
          kind: 'not_supported',
          detail: `EODHD publishes no ${uiInterval} bar. Choose another interval.`,
        },
      }
    }

    // Narrow to the documented per-interval cap before asking, so an
    // over-wide window comes back as a shorter series rather than a refusal.
    const cap = INTRADAY_MAX_SPAN_DAYS[interval]
    let start = from
    if (cap) {
      const days = (to.getTime() - from.getTime()) / 86_400_000
      if (days > cap) start = new Date(to.getTime() - cap * 86_400_000)
    }

    // `AAPL` is not an EODHD symbol. Resolved through the provider's own
    // search, never built from `assets.exchange`.
    const resolved = await resolveEodhdSymbol(symbol)
    if (!resolved.ok) return { candles: [], basis: UNKNOWN_BASIS, failure: resolved.failure }

    const res = await eodhdBars({
      symbol: resolved.symbol,
      from: start.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      interval,
    })
    if (!res.ok) return { candles: [], basis: UNKNOWN_BASIS, failure: res.failure }

    const rawCandles = toCandles((res.data.value ?? []) as never[])
    if (rawCandles.length === 0) {
      // The symbol resolved and the window is empty. Distinct from an
      // unknown instrument, and the two read identically on a blank chart.
      return {
        candles: rawCandles,
        basis: UNKNOWN_BASIS,
        failure: {
          kind: 'no_data',
          detail: `EODHD published no ${interval} bars for ${resolved.symbol} in this window.`,
        },
      }
    }

    /*
     * ── Adjusted BEFORE resampling, which is not interchangeable ─────────
     *
     * EODHD publishes no weekly or monthly bar, so those are built here from
     * daily ones. Adjusting afterwards cannot work: the monthly bucket that
     * contains an ex-date would be assembled from a 645 open and a 93 close,
     * and dividing that finished bar by any factor leaves the collapse
     * inside it. Adjusting the daily bars first means the bucket is built
     * from figures that are already on one basis.
     */
    const { basis, splits } = await this.eodhdBasisFor(resolved.symbol, start, to)
    const baseCandles = splits.length > 0 ? applySplitAdjustment(rawCandles, splits) : rawCandles

    // Combined only when a base was substituted for an unpublished size.
    const candles = plan ? resampleCandles(baseCandles, plan.target) : baseCandles
    if (candles.length === 0) {
      /*
       * Base bars arrived but none survived bucketing. That means every
       * timestamp was unparseable, which is a provider-shape problem rather
       * than an empty window, so it must not be reported as "no data".
       */
      return {
        candles,
        basis,
        failure: {
          kind: 'unavailable',
          detail: `EODHD ${interval} bars for ${resolved.symbol} carried no usable timestamps.`,
        },
      }
    }
    return { candles, basis }
  }

  /**
   * EODHD's corporate actions for a window, and the basis they permit.
   *
   * ── Why the window runs to today, not to the window's own end ────────
   *
   * A split AFTER the drawn window still changes what its prices mean. A
   * 2013 window of AAPL shows prices near 500 because one share then is 28
   * shares now; nothing inside that window is discontinuous, so asking only
   * for splits inside it would return none and leave the series quoted in
   * shares that no longer exist. The factors that matter are every split
   * between the oldest bar and now.
   *
   * ── Why a failure here is not an error ───────────────────────────────
   *
   * The `splits` operation is new. A deployment running the previous
   * function answers "Unknown op", and an entitlement or rate-limit refusal
   * can happen at any time. Each of those means "no factors available", and
   * the honest response to that is the series exactly as published, badged
   * raw -- which is what the chart did before this existed. It is never a
   * reason to blank the chart, and never a reason to infer a factor.
   */
  private async eodhdBasisFor(
    resolvedSymbol: string,
    from: Date,
    to: Date,
  ): Promise<{ basis: SeriesBasis; splits: SplitEvent[] }> {
    const { eodhdSplits } = await import('./market-data/eodhd-client')

    // To TODAY, not to `to`. See above.
    const today = new Date(Math.max(to.getTime(), Date.now()))
    const res = await eodhdSplits({
      symbol: resolvedSymbol,
      from: from.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
    })

    if (!res.ok) return { basis: EODHD_RAW_BASIS, splits: [] }

    const splits: SplitEvent[] = (res.data.value ?? [])
      .filter(s => Number.isFinite(s.numerator) && Number.isFinite(s.denominator)
        && s.numerator > 0 && s.denominator > 0 && s.numerator !== s.denominator)
      .map(s => ({
        date: s.date,
        factor: s.numerator / s.denominator,
        ratio: `${s.numerator}:${s.denominator}`,
      }))

    return {
      basis: {
        basis: 'split_adjusted',
        splits,
        adjustedHere: splits.length > 0,
        evidence: splits.length > 0
          ? `restated in current shares from ${splits.length} published ratio(s): `
            + splits.map(s => `${s.ratio} on ${s.date}`).join(', ')
          : 'EODHD published no split for this instrument in or after this window',
      },
      splits,
    }
  }

  private async fetchFromYahooFinance(
    request: ChartDataRequest,
  ): Promise<{ candles: CandlestickData[]; basis: SeriesBasis }> {
    const interval = intervalMap[request.interval] || '1d'
    const range = rangeMap[request.range] || '1mo'

    return yahooSeries({ symbol: request.symbol, interval, range })
  }

  clearCache() {
    this.cache.clear()
  }

  // Fetch historical data by specific time period (for loading more data when panning)
  async getHistoricalData(
    symbol: string,
    interval: string,
    endTime: number, // Unix timestamp in seconds
    durationSeconds: number, // How far back to fetch
    provider: MarketDataProviderId = 'yahoo'
  ): Promise<CandlestickData[]> {
    const period1 = Math.floor(endTime - durationSeconds)
    const period2 = Math.floor(endTime)

    if (provider === 'eodhd') {
      // Panning in more history. A failure here leaves the series as it is
      // rather than appending another provider's bars to it.
      return (await this.fetchEodhdWindowResult(
        symbol,
        interval,
        new Date(period1 * 1000),
        new Date(period2 * 1000),
      )).candles
    }

    const intervalParam = intervalMap[interval] || '1d'

    // Through `yahooSeries` so panned-in history is on the same basis as the
    // series it is being prepended to.
    return (await yahooSeries({ symbol, interval: intervalParam, period1, period2 })).candles
  }

  /**
   * A custom window, with the reason when it comes back empty.
   *
   * The Charting page's frequency picker reaches the provider through here —
   * choosing "Weekly" or "15 Min" sets `timeFrame: 'CUSTOM'` and an
   * `apiInterval` — so this is the path that has to explain itself. Before,
   * every failure arrived as a bare empty array and the chart said "No data
   * available for this symbol" whatever had actually gone wrong.
   */
  async getCustomRangeDataResult(
    symbol: string,
    startDate: Date,
    endDate: Date,
    interval: string,
    provider: MarketDataProviderId = 'yahoo'
  ): Promise<{ candles: CandlestickData[]; failure?: AdapterFailure; basis: SeriesBasis }> {
    if (provider === 'eodhd') {
      return this.fetchEodhdWindowResult(symbol, interval, startDate, endDate)
    }

    /*
     * The frequency picker reaches the provider through here, so this path
     * needs its own measured basis rather than inheriting the preset path's.
     * A window the user chose is exactly the one most likely to straddle a
     * split -- and most likely to be read as a trend.
     */
    const intervalParam = intervalMap[interval] || '1d'
    const window = this.yahooWindowFor(startDate, endDate, intervalParam)
    const ranged = window.range
      ? await yahooSeries({ symbol, interval: intervalParam, range: window.range })
      : { candles: [], basis: UNKNOWN_BASIS }
    if (ranged.candles.length > 0) return ranged

    return yahooSeries({ symbol, interval: intervalParam, period1: window.period1, period2: window.period2 })
  }

  /**
   * A date window narrowed to what Yahoo publishes for the bar size, as both
   * a range preset and an exact period pair.
   *
   * Pulled out of `getCustomRangeData` so the basis-carrying path above and
   * the candles-only one below cannot drift apart on which window they ask
   * for -- two paths computing the same window separately is how one of them
   * ends up asking for a different series than the caller believes.
   */
  private yahooWindowFor(
    startDate: Date,
    endDate: Date,
    intervalParam: string,
  ): { range: string | null; period1: number; period2: number } {
    let days = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

    const maxDays = intradayMaxDays[intervalParam]
    let adjustedStartDate = startDate
    if (maxDays && days > maxDays) {
      adjustedStartDate = new Date(endDate.getTime() - maxDays * 24 * 60 * 60 * 1000)
      days = maxDays
    }

    return {
      range: daysToRange(days),
      period1: Math.floor(adjustedStartDate.getTime() / 1000),
      period2: Math.floor(endDate.getTime() / 1000),
    }
  }

  // Fetch data for a custom date range
  async getCustomRangeData(
    symbol: string,
    startDate: Date,
    endDate: Date,
    interval: string,
    provider: MarketDataProviderId = 'yahoo'
  ): Promise<CandlestickData[]> {
    if (provider === 'eodhd') {
      return (await this.fetchEodhdWindowResult(symbol, interval, startDate, endDate)).candles
    }

    const intervalParam = intervalMap[interval] || '1d'
    const { range, period1, period2 } = this.yahooWindowFor(startDate, endDate, intervalParam)

    // Try range-based first (more reliable for standard ranges), then
    // fall back to period-based for exact date windows.
    if (range) {
      const ranged = await yahooSeries({ symbol, interval: intervalParam, range })
      if (ranged.candles.length > 0) return ranged.candles
    }

    return (await yahooSeries({ symbol, interval: intervalParam, period1, period2 })).candles
  }
}

export const chartDataService = new ChartDataService()
