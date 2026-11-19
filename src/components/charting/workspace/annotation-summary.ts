/**
 * What a drawn mark actually says, in numbers.
 *
 * ── Why this is worth having ──────────────────────────────────────────────
 *
 * A trend line drawn by hand is a claim: from this price on this date to that
 * price on that date. Until now the only statement of that claim was its
 * position on a canvas, so two analysts looking at the same chart could not
 * agree on where it started, and nobody could check it against anything.
 * Reading the anchors back as figures is what turns a drawing into something
 * a second person can verify.
 *
 * ── The rules it will not break ───────────────────────────────────────────
 *
 * Prices are printed with `formatMoney` and NO currency argument, which
 * yields a bare number. That is deliberate and it is the honest option: the
 * chart surface does not carry the instrument's quoting currency, and a
 * pence-quoted London listing rendered as `$2,847.50` is wrong by a factor of
 * a hundred and wrong about the country. The same mistake was already made
 * once here -- every horizontal line used to be labelled `$${price}` -- and
 * the fix was to stop asserting a currency nobody had supplied. When the
 * surface learns its currency, `formatMoney` takes a second argument and
 * every figure below is correct at once.
 *
 * A percentage change is shown only between two PRICES on the same
 * instrument, never across a comparison overlay and never between a price and
 * an index level.
 */
import { formatMoney } from '../../../lib/market-data/currency'
import type { Annotation } from '../engine/annotations'

export interface SummaryRow {
  label: string
  value: string
}

/** A chart time, as the engine stores it: unix SECONDS, not milliseconds. */
function formatChartTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  const d = new Date(seconds * 1000)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

/** Whole days between two chart times, rounded, always non-negative. */
export function spanInDays(fromSeconds: number, toSeconds: number): number {
  return Math.round(Math.abs(toSeconds - fromSeconds) / 86_400)
}

/**
 * The move a two-point mark describes.
 *
 * Returns null when the start price is zero or either end is not a number,
 * rather than printing `Infinity%` or `NaN%` -- a mark anchored off the
 * series can produce both, and a fabricated percentage on a chart is exactly
 * the kind of figure that gets copied into a note.
 */
export function priceMove(from: number, to: number): { absolute: number; percent: number } | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null
  return { absolute: to - from, percent: ((to - from) / Math.abs(from)) * 100 }
}

function signed(value: number): string {
  const body = formatMoney(Math.abs(value))
  return value < 0 ? `-${body}` : `+${body}`
}

/**
 * The rows the inspector shows for a mark.
 *
 * Exhaustive over the annotation union by construction: the switch returns
 * for every member and the fallthrough returns an empty list rather than
 * guessing, so a new annotation type shows nothing until someone decides what
 * it should say -- which is better than showing another type's fields under
 * its name.
 */
export function describeAnnotation(a: Annotation): SummaryRow[] {
  switch (a.type) {
    case 'horizontal-line':
      return [{ label: 'Price', value: formatMoney(a.price ?? NaN) }]

    case 'vertical-line':
      return [{ label: 'Date', value: formatChartTime(a.time ?? NaN) }]

    case 'text':
      return [
        { label: 'Date', value: formatChartTime(a.time) },
        { label: 'Price', value: formatMoney(a.price) },
        { label: 'Note', value: a.text || '(empty)' },
      ]

    case 'trend-line':
    case 'ray':
    case 'arrow':
    case 'rectangle':
    case 'ellipse':
    case 'fibonacci': {
      const startTime = (a as { startTime?: number }).startTime ?? NaN
      const endTime = (a as { endTime?: number }).endTime ?? NaN
      const startPrice = (a as { startPrice?: number }).startPrice ?? NaN
      const endPrice = (a as { endPrice?: number }).endPrice ?? NaN
      const move = priceMove(startPrice, endPrice)

      const rows: SummaryRow[] = [
        { label: 'From', value: `${formatChartTime(startTime)} · ${formatMoney(startPrice)}` },
        { label: 'To', value: `${formatChartTime(endTime)} · ${formatMoney(endPrice)}` },
      ]
      if (move) {
        rows.push({
          label: 'Change',
          value: `${signed(move.absolute)} (${move.percent >= 0 ? '+' : ''}${move.percent.toFixed(2)}%)`,
        })
      }
      if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
        const days = spanInDays(startTime, endTime)
        rows.push({ label: 'Span', value: `${days} ${days === 1 ? 'day' : 'days'}` })
      }
      if (a.type === 'fibonacci') {
        rows.push({ label: 'Levels', value: a.levels.map(l => `${(l * 100).toFixed(1)}%`).join('  ') })
      }
      return rows
    }

    default:
      return []
  }
}
