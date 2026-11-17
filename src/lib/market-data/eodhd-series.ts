/**
 * EODHD bars, in the shapes the existing charts already consume.
 *
 * Nothing here fetches. It maps the edge function's envelopes onto
 * `CandlestickData` (the charting engine) and `PricePoint` (the price-history
 * hook), so neither chart has to learn a second data model and neither has to
 * be rewritten to display a different provider.
 *
 * ── What this file refuses to do ──────────────────────────────────────────
 *
 *  - It never synthesises a bar. If the provider published nothing for a
 *    window, the result is empty and the caller says so on screen.
 *  - It never carries a price without its unit. A GBX figure arrives in
 *    pence; converting it is an explicit call, and the converted figure
 *    travels with the ISO 4217 code it is now denominated in.
 *  - It never treats a missing window as a missing instrument. The four
 *    failure kinds stay four.
 */
import type {
  AdapterFailure,
  BarInterval,
  MarketDataProviderId,
  ReferenceRecord,
} from './contracts'
import { type CurrencyUnit, toMajorUnits } from './freshness'
import type { PriceTimeframe } from '../../hooks/usePriceHistory'

/* ─────────────────────────────── wire shapes ───────────────────────────── */

export interface EodhdPriceBar {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
}

export interface EodhdIntradayBar extends EodhdPriceBar {
  /** The instant the bar OPENS, ISO 8601 UTC. */
  openedAt: string
}

export interface EodhdEnvelope<T> {
  value: T
  source: { provider: string; feed?: string; via: string; delivery?: string }
  observedAt: string
  effectiveAt?: string
  effectiveAtPrecision?: 'instant' | 'session_date'
  adjustment?: 'raw' | 'split_adjusted' | 'split_and_dividend_adjusted' | 'unknown'
  currency?: string
  currencyUnit?: CurrencyUnit
}

export type EodhdResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: AdapterFailure }

/* ──────────────────────────── chart data shapes ─────────────────────────── */

/** Mirrors `CandlestickData` in `src/lib/chartData.ts`. */
export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

/** Mirrors `PricePoint` in `src/hooks/usePriceHistory.ts`. */
export interface SeriesPoint {
  timestamp: number
  value: number
  date: Date
  volume?: number
}

/* ───────────────────────── timeframe -> request window ─────────────────── */

/**
 * What a UI timeframe means as an EODHD request.
 *
 * The existing charts think in timeframes ("1M", "1Y") and Yahoo ranges.
 * EODHD takes an explicit inclusive date window and its own interval, so the
 * translation lives here rather than being open-coded at three call sites.
 *
 * `days` is how far back to ask. `interval` is OUR vocabulary; the server maps
 * it to the provider's and refuses the ones EODHD has no bar for.
 */
export interface EodhdWindow {
  from: string
  to: string
  interval: BarInterval
  days: number
}

const TIMEFRAME_PLAN: Record<PriceTimeframe, { days: number; interval: BarInterval }> = {
  // Intraday timeframes. EODHD has no 15m bar, so a week of 5m is the
  // closest honest answer rather than a silently different bar size.
  '1D': { days: 4, interval: '5m' },
  '5D': { days: 9, interval: '5m' },
  // Everything else is daily. A daily bar is what the provider publishes and
  // what every one of these ranges is actually drawn from.
  '1M': { days: 31, interval: '1d' },
  '3M': { days: 92, interval: '1d' },
  '6M': { days: 183, interval: '1d' },
  '1Y': { days: 366, interval: '1d' },
  '5Y': { days: 1826, interval: '1d' },
  MAX: { days: 365 * 25, interval: '1d' },
}

/**
 * EODHD's documented per-interval window caps, in days.
 *
 * Duplicated from `supabase/functions/_shared/eodhd.ts` because that file
 * cannot be imported into the bundle. The server enforces them; this copy
 * exists so a request is narrowed BEFORE being sent rather than refused after,
 * and `__tests__/eodhd-series.test.ts` asserts the two agree.
 */
export const INTRADAY_MAX_SPAN_DAYS: Partial<Record<BarInterval, number>> = {
  '1m': 120,
  '5m': 600,
  '1h': 7200,
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The window to ask EODHD for, already inside the provider's limits.
 *
 * `1D` asks for four days, not one. A Monday morning request for "today" over
 * a one-day window returns an empty list, because the window ends before any
 * bar exists; four days always contains a prior session, so the chart shows
 * the most recent real bars instead of nothing. The caller is responsible for
 * labelling what it drew, which is why the series keeps its timestamps.
 */
export function windowForTimeframe(timeframe: PriceTimeframe, now = new Date()): EodhdWindow {
  const plan = TIMEFRAME_PLAN[timeframe] ?? TIMEFRAME_PLAN['1M']
  const cap = INTRADAY_MAX_SPAN_DAYS[plan.interval]
  const days = cap ? Math.min(plan.days, cap) : plan.days

  const to = new Date(now)
  const from = new Date(now.getTime() - days * 86_400_000)
  return { from: iso(from), to: iso(to), interval: plan.interval, days }
}

/* ──────────────────────────────── mapping ──────────────────────────────── */

const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null

const isIntraday = (b: EodhdPriceBar): b is EodhdIntradayBar =>
  typeof (b as EodhdIntradayBar).openedAt === 'string'

/**
 * Bars to candles.
 *
 * A candle needs four prices. EODHD can return a null open, high or low on a
 * thin bar, and `lightweight-charts` will happily draw a candle from the
 * resulting NaN — so an incomplete bar is DROPPED rather than patched from
 * its close. Patching would invent a doji that never traded.
 */
export function toCandles(bars: readonly EodhdPriceBar[]): Candle[] {
  const out: Candle[] = []
  for (const bar of bars) {
    const close = finite(bar.close)
    const open = finite(bar.open)
    const high = finite(bar.high)
    const low = finite(bar.low)
    if (close === null || open === null || high === null || low === null) continue

    // Daily bars are dated; intraday bars carry an instant, which the chart
    // library wants as unix seconds.
    const time = isIntraday(bar)
      ? String(Math.floor(Date.parse(bar.openedAt) / 1000))
      : bar.date

    if (!time || time === 'NaN') continue

    const volume = finite(bar.volume)
    out.push({ time, open, high, low, close, volume: volume ?? 0 })
  }
  return out
}

/**
 * Bars to a close series.
 *
 * Only the close is required here, so a bar with a null open still
 * contributes — the omitted fields were never going to be drawn.
 */
export function toSeriesPoints(bars: readonly EodhdPriceBar[]): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (const bar of bars) {
    const close = finite(bar.close)
    if (close === null) continue

    const ms = isIntraday(bar)
      ? Date.parse(bar.openedAt)
      // A daily bar is a trading DATE. Midnight UTC is the same lower bound
      // the server stamps on the series; see `effectiveAtPrecision`.
      : Date.parse(`${bar.date}T00:00:00.000Z`)

    if (!Number.isFinite(ms)) continue
    const volume = finite(bar.volume)
    out.push({
      timestamp: ms,
      value: close,
      date: new Date(ms),
      volume: volume ?? undefined,
    })
  }
  return out
}

/* ────────────────────────────── presentation ───────────────────────────── */

export type DeliveryLabel = 'Live' | 'Delayed' | 'EOD' | 'Unavailable' | 'Unknown'

export function deliveryLabel(delivery: string | undefined): DeliveryLabel {
  switch (delivery) {
    case 'realtime': return 'Live'
    case 'delayed': return 'Delayed'
    case 'eod': return 'EOD'
    case 'unavailable': return 'Unavailable'
    default: return 'Unknown'
  }
}

/**
 * What a failure should say to a person.
 *
 * Four kinds, four sentences. They were one sentence when `no_data` did not
 * exist, and "AAPL is not a known symbol" during an open session is how we
 * found out that mattered.
 */
export function failureMessage(failure: AdapterFailure): string {
  switch (failure.kind) {
    case 'unknown_symbol':
      return `${failure.symbol} is not a symbol this provider knows.`
    case 'no_data':
      return 'No bars published for this period yet.'
    case 'not_supported':
      return 'This provider does not offer that data for this instrument.'
    case 'rate_limited':
      return 'Provider rate limit reached. Try again shortly.'
    case 'unavailable':
      return 'Market data is temporarily unavailable.'
  }
}

/**
 * A price ready to show, with the unit it is actually denominated in.
 *
 * Reference data is the ONLY source of a unit, because the quote endpoint
 * states none. Given a GBX instrument this converts pence to pounds and
 * returns `GBP`; given no reference it returns the number with NO currency
 * rather than guessing one, so a caller renders a bare figure instead of a
 * confidently wrong `£`.
 */
export function displayPrice(
  value: number,
  reference?: Pick<ReferenceRecord, 'currency' | 'currencyUnit'> | null,
): { value: number; currency?: string; converted: boolean } {
  if (!reference) return { value, converted: false }
  const major = toMajorUnits(value, reference.currencyUnit, reference.currency)
  return {
    value: major.value,
    currency: major.currency,
    converted: !!reference.currencyUnit,
  }
}

/** Whether two priced things may be compared or summed without conversion. */
export function sameUnit(
  a: Pick<ReferenceRecord, 'currency' | 'currencyUnit'> | null | undefined,
  b: Pick<ReferenceRecord, 'currency' | 'currencyUnit'> | null | undefined,
): boolean {
  if (!a || !b) return false
  const unitOf = (x: Pick<ReferenceRecord, 'currency' | 'currencyUnit'>) =>
    x.currencyUnit ? x.currencyUnit.code : x.currency
  const ua = unitOf(a)
  const ub = unitOf(b)
  return !!ua && !!ub && ua === ub
}

/** The provider name to show beside a figure. Never a vendor's own spelling. */
export function providerLabel(provider: MarketDataProviderId): string {
  return provider === 'eodhd' ? 'EODHD' : 'Yahoo'
}
