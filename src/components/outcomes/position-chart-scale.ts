/**
 * Y-domains for the Outcomes position chart.
 *
 * The principle: reference data should enrich the chart, not ruin the scale
 * of the thing the reader is trying to inspect. Price should read as price,
 * position as position; they share time, not units.
 *
 * Two defects motivated pulling this out of the renderer.
 *
 * The price domain included the average entry unconditionally. A position
 * whose price history runs $500–$700 but whose average entry is $100 got a
 * domain of roughly $60–$760, compressing the history the reader opened the
 * chart to look at into under a third of the pane. The entry price is
 * context; it was setting the scale.
 *
 * The position domain forced zero into itself. A holding of a constant
 * 10,000 shares therefore spanned 0–10,000 and, drawn as a filled area from
 * the axis baseline, became a solid block — mathematically true and visually
 * useless. Zero is not meaningful for shares or weight, both of which are
 * always non-negative. It *is* meaningful for active weight, where the sign
 * is the entire point, so that one keeps its zero.
 *
 * Nothing here alters a value. The average entry, the prices and the
 * position history are reported as they are; only the window onto them
 * changes, and an average entry left outside that window is announced rather
 * than silently dropped.
 */

import type { OverlayField } from './position-chart-model'

// ── Price ───────────────────────────────────────────────────────────────

/**
 * How far outside the visible price range the average entry may sit and
 * still be drawn in scale, as a multiple of that range's span.
 *
 * At 0.5 an entry may sit half the visible span beyond either end — enough
 * that a normal cost basis near the current range still draws its line, and
 * tight enough that an entry several multiples away cannot flatten the
 * history. Deterministic and symmetric: no asset is special-cased.
 */
export const ENTRY_SPAN_TOLERANCE = 0.5

/**
 * A floor on that allowance, as a fraction of the top of the range, so a
 * nearly flat price history does not make the tolerance vanish and report a
 * cent-away entry as off-scale.
 */
export const ENTRY_MIN_TOLERANCE_RATIO = 0.02

/** Padding above and below the data, as a fraction of the domain span. */
export const PRICE_PADDING_RATIO = 0.1

/**
 * Where the average entry ended up relative to the drawn price domain.
 * `in-range` draws the dashed line; `above`/`below` mean the caller should
 * show an edge indicator instead. `none` means there is no entry price.
 */
export type EntryPlacement = 'none' | 'in-range' | 'above' | 'below'

export interface PriceScale {
  domain: [number, number]
  ticks: number[]
  tick: (v: number) => string
  entryPlacement: EntryPlacement
}

function niceStep(raw: number) {
  if (!(raw > 0)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

/**
 * The price domain for one horizon.
 *
 * `prices` must already be cropped to the selected range — 3M must not
 * inherit a scale from All — and the average entry is admitted only when it
 * is near enough to that range to cost nothing.
 */
export function priceScale(prices: number[], avgEntry: number | null = null): PriceScale | null {
  const finite = prices.filter(v => Number.isFinite(v))
  if (finite.length === 0) return null

  const lo = Math.min(...finite)
  const hi = Math.max(...finite)
  const span = hi - lo

  // Measured off the price history alone, so the entry cannot widen the very
  // allowance that decides whether the entry is admitted.
  const allowance = Math.max(span * ENTRY_SPAN_TOLERANCE, Math.abs(hi) * ENTRY_MIN_TOLERANCE_RATIO)

  let entryPlacement: EntryPlacement = 'none'
  let domLo = lo
  let domHi = hi

  if (avgEntry != null && Number.isFinite(avgEntry)) {
    if (avgEntry < lo - allowance) {
      entryPlacement = 'below'
    } else if (avgEntry > hi + allowance) {
      entryPlacement = 'above'
    } else {
      entryPlacement = 'in-range'
      domLo = Math.min(domLo, avgEntry)
      domHi = Math.max(domHi, avgEntry)
    }
  }

  const domSpan = domHi - domLo
  const pad = domSpan > 0 ? domSpan * PRICE_PADDING_RATIO : Math.max(Math.abs(domHi) * 0.02, 0.5)
  const domain: [number, number] = [domLo - pad, domHi + pad]

  const step = niceStep((domain[1] - domain[0]) / 3.5)
  const edge = (domain[1] - domain[0]) * 0.06
  const ticks: number[] = []
  for (let t = Math.ceil(domain[0] / step) * step; t <= domain[1]; t += step) {
    if (t - domain[0] >= edge && domain[1] - t >= edge) ticks.push(Number(t.toFixed(6)))
  }
  const decimals = step < 1 ? 2 : 0

  return { domain, ticks, tick: (v: number) => `$${v.toFixed(decimals)}`, entryPlacement }
}

// ── Position metric ─────────────────────────────────────────────────────

/** Share of the plot height the position metric may rise to. */
export const METRIC_BAND = 0.34

/**
 * Below this spread, relative to the level itself, a position history counts
 * as flat. A holding untouched for the whole horizon is the common case, and
 * filling it from a distant baseline says nothing; the caller draws a line
 * instead of an area.
 */
export const METRIC_FLAT_RATIO = 0.005

/** Local window around a flat series, as a fraction of its level. */
export const METRIC_FLAT_WINDOW_RATIO = 0.1

export interface MetricScale {
  domain: [number, number]
  ticks: number[]
  /** True when the series barely moves — draw it as a line, not an area. */
  flat: boolean
}

/**
 * Zero belongs in the domain only where its sign carries meaning.
 *
 * Shares and weight are non-negative quantities; anchoring them at zero says
 * nothing and costs the whole pane. Active weight is a signed deviation from
 * the benchmark, so the zero crossing is the reading.
 */
function anchorsZero(metric: OverlayField): boolean {
  return metric === 'active_weight'
}

export function metricScale(values: number[], metric: OverlayField): MetricScale | null {
  const finite = values.filter(v => Number.isFinite(v))
  if (finite.length === 0) return null

  const lo = Math.min(...finite)
  const hi = Math.max(...finite)
  const spread = hi - lo
  const level = Math.max(Math.abs(hi), Math.abs(lo))
  const flat = spread <= level * METRIC_FLAT_RATIO

  const anchorZero = anchorsZero(metric)
  let baseLo = anchorZero ? Math.min(0, lo) : lo
  let baseHi = anchorZero ? Math.max(0, hi) : hi

  if (flat && !anchorZero) {
    // Give a motionless series a window of its own rather than a baseline
    // far below it, so the level reads as a level.
    const window = level > 0 ? level * METRIC_FLAT_WINDOW_RATIO : 1
    baseLo = lo - window
    baseHi = hi + window
  }

  let bandSpan = baseHi - baseLo
  if (bandSpan <= 0) bandSpan = Math.max(level, 1)

  // Inflate the top so the series occupies the lower METRIC_BAND of the
  // plot, leaving the rest to price.
  const domain: [number, number] = [baseLo, baseLo + bandSpan / METRIC_BAND]

  const ticks = flat
    ? [hi]
    : Array.from(new Set(anchorZero && lo < 0 && hi > 0 ? [lo, 0, hi] : [lo, hi]))

  return { domain, ticks, flat }
}
