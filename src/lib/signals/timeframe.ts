/**
 * Parse a price-target horizon into months.
 *
 * This exists because the previous parser matched a format the product does not
 * produce. It was `/^(\d+)\s*([MY])$/i` — "12M", "3Y" — while every one of the
 * 30 rows in `analyst_price_targets` stores the long form:
 *
 *   "12 months" x21   "6 months" x7   "3 months" x1   "11 months" x1
 *
 * Zero matched. `timeframeMonths` therefore returned null for every target, the
 * stale-target branch it guards never ran, and "outdated case" signals never
 * rendered once in the life of that code. Not degraded — absent, silently, in
 * exactly the way the conviction cards were absent.
 *
 * Both forms are accepted now, because the short form may exist in older rows
 * or arrive from an importer, and a parser that rejects half the corpus is how
 * this happened in the first place.
 */

/** "12 months", "12M", "3 years", "3Y", "18 mos" -> months. */
export function timeframeMonths(tf: string | null | undefined): number | null {
  if (!tf) return null
  const s = tf.trim().toLowerCase()
  if (!s) return null

  // Number, optional space, then a unit that starts with m or y. Anchored at
  // both ends so "12 monthly reviews" is rejected rather than silently read as
  // 12 months.
  const m = /^(\d+(?:\.\d+)?)\s*(m|mo|mos|month|months|y|yr|yrs|year|years)$/.exec(s)
  if (!m) return null

  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null

  return m[2].startsWith('y') ? Math.round(n * 12) : Math.round(n)
}
