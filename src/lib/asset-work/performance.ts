import type { PricePoint } from '../../components/signals/PriceContext'
import { ytdReturn, windowReturn, latestClose } from '../lists/price-metrics'

/**
 * What the Work surface may say about how a name has performed.
 *
 * ── Why this is a layer over `lists/price-metrics` ──────────────────────
 *
 * That module owns the arithmetic and, more importantly, the refusals: a
 * window longer than the series, a gap that makes two closes
 * incomparable, and the rule that a close is not a quote. None of that is
 * restated here. What is added is the part a working surface needs and a
 * list row does not — a period the reader can CHANGE, the two observation
 * dates behind each figure, and a sentence for every refusal, so a missing
 * number is explained in the cell rather than left as a dash.
 *
 * ── What these figures are, exactly ─────────────────────────────────────
 *
 * PRICE return, from `price_history_cache` closes. Not total return: the
 * cache stores no dividend adjustment and no adjustment flag, so there is
 * nothing to verify an adjusted series against, and a price return
 * labelled as total return would understate every dividend payer. The
 * surface says which it is; this module refuses to let it say the other.
 *
 * There is no benchmark here either. A relative return needs a second
 * series, and this organization's cache holds none — verified, not
 * assumed. Relative performance is therefore absent rather than
 * approximated.
 */

/* One definition, declared where the requirement's own horizon is read.
   Two identical unions would drift the moment a fourth period is added. */
export type { PeriodKey } from './requirement-guidance'
import type { PeriodKey } from './requirement-guidance'

export const PERIODS: PeriodKey[] = ['YTD', '1M', '3M']

export interface Observation {
  date: string
  close: number
}

export interface PeriodReturn {
  key: PeriodKey
  /** Null whenever the series cannot support the period. */
  pct: number | null
  /** A sentence naming what is missing. Null when `pct` is a number. */
  unavailable: string | null
  /** The two closes the figure is measured between. Null when refused. */
  from: Observation | null
  to: Observation | null
}

export interface PerformanceReading {
  /** The newest close held, whatever the periods say. */
  latest: Observation | null
  /** How many whole days old that close is. */
  latestAgeDays: number | null
  periods: Record<PeriodKey, PeriodReturn>
  /** The span the cache actually holds, for a reader judging the rest. */
  coverage: { from: string; to: string; observations: number } | null
}

const DAY = 86_400_000
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)
const asObservation = (p: PricePoint | null): Observation | null =>
  p ? { date: p.date, close: p.close } : null

/** A month name a reader can check against a calendar, not a relative age. */
function stamp(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function ytdPeriod(points: PricePoint[], now: number): PeriodReturn {
  const r = ytdReturn(points, now)
  if (r.pct !== null) {
    return { key: 'YTD', pct: r.pct, unavailable: null, from: asObservation(r.baseline), to: asObservation(r.latest) }
  }
  const unavailable =
    r.refused === 'no-baseline'
      ? `No close held before Jan 1, ${r.year}, so there is no year-start price to measure from`
      : r.refused === 'stale-series'
        ? `The newest close held predates ${r.year}`
        : r.refused === 'not-comparable'
          ? 'A gap in the series makes the year-start and latest closes incomparable'
          : 'No price history held for this name'
  return { key: 'YTD', pct: null, unavailable, from: null, to: null }
}

function windowPeriod(points: PricePoint[], key: '1M' | '3M'): PeriodReturn {
  const r = windowReturn(points, key)
  if (r.pct !== null) {
    return { key, pct: r.pct, unavailable: null, from: asObservation(r.from), to: asObservation(r.to) }
  }
  const unavailable =
    r.refused === 'short-lookback'
      ? `The series held is shorter than ${key === '1M' ? 'a month' : 'three months'}`
      : r.refused === 'not-comparable'
        ? 'A gap in the series makes the two closes incomparable'
        : 'No price history held for this name'
  return { key, pct: null, unavailable, from: null, to: null }
}

export function readPerformance(
  points: PricePoint[] | null | undefined,
  now: number = Date.now(),
): PerformanceReading {
  const series = points ?? []
  const last = latestClose(series)
  const sorted = [...series]
    .filter(p => p && Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => dayOf(a.date) - dayOf(b.date))

  return {
    latest: last ? { date: last.date, close: last.close } : null,
    latestAgeDays: last ? Math.max(0, Math.floor((now - dayOf(last.date)) / DAY)) : null,
    coverage: sorted.length
      ? { from: sorted[0].date, to: sorted[sorted.length - 1].date, observations: sorted.length }
      : null,
    periods: {
      YTD: ytdPeriod(series, now),
      '1M': windowPeriod(series, '1M'),
      '3M': windowPeriod(series, '3M'),
    },
  }
}

/**
 * How a figure is stamped: the two dates it was measured between.
 *
 * Kept here rather than in the component so that the number and its
 * provenance are produced by one module. A return printed without the two
 * closes behind it is not checkable, and the previous surface printed
 * exactly that.
 */
export function describeBasis(p: PeriodReturn): string | null {
  if (!p.from || !p.to) return null
  return `${stamp(p.from.date)} → ${stamp(p.to.date)}`
}
