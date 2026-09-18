/**
 * The horizon ladder a price chart offers.
 *
 * ── One list, so two charts cannot disagree about what "3M" means ─────────
 *
 * This began in `components/signals/PriceContext` -- the mobile price chart --
 * already exported for reuse, with the note that another caller should be able
 * to offer the same ladder without declaring a second list. Taking it at its
 * word from the desktop tiles would have meant `components/decisions-v2`
 * importing from `components/signals`, which is the lens-reaching-into-lens
 * layering that has already caused one duplicated-logic bug in this area.
 *
 * So the list lives here and both read it. A chip labelled 3M must select the
 * same 91 days wherever it appears; a reader comparing a decision's chart to
 * the same name on a phone is entitled to that.
 */

export type RangeKey = '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'

export const PRICE_RANGES: { key: RangeKey; days: number | null }[] = [
  { key: '5D', days: 5 },
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  /**
   * No YTD.
   *
   * It is the least distinct chip on the ladder -- for most of the year it
   * selects a window somewhere between 1M and 1Y that one of those already
   * covers -- and it was costing the row enough width that `ALL` clipped at
   * the right edge. A control that cannot be read is worth less than one that
   * is merely redundant, so the redundant one goes.
   */
  { key: '1Y', days: 365 },
  { key: '5Y', days: 1825 },
  { key: 'ALL', days: null },
]

/**
 * The ranges a series can actually fill, so a chip never selects a window the
 * data cannot support.
 *
 * A name with nine months of closes offered 1Y, 5Y and ALL as three separate
 * chips that all drew the identical line -- which reads as a broken control
 * rather than as a short history. `ALL` is always offered, because "everything
 * we hold" is a meaningful choice whatever its length.
 */
export function rangesFor(spanDays: number): { key: RangeKey; days: number | null }[] {
  return PRICE_RANGES.filter(r => r.days == null || r.days <= spanDays)
}
