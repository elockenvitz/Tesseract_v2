/**
 * The last year's trading range, from a close series.
 *
 * Shared because two different cards now show it and they must agree. A ladder
 * card that computed the high one way and a builder card that computed it
 * another would put two different "52w" figures on the same name in the same
 * feed, which is worse than showing neither.
 *
 * Null rather than a partial answer: with fewer than two closes in the window
 * there is no range, and a single point rendered as "52w $200–$200" asserts a
 * year of flat trading that nobody measured.
 */
export interface Range52w {
  low: number
  high: number
}

export function range52wFrom(
  series: { date: string; close: number }[] | null | undefined,
  now: number = Date.now(),
): Range52w | null {
  if (!series || series.length < 2) return null
  const cutoff = now - 365 * 86_400_000
  const closes = series
    .filter(pt => new Date(pt.date).getTime() >= cutoff)
    .map(pt => pt.close)
    .filter(v => Number.isFinite(v) && v > 0)
  if (closes.length < 2) return null
  return { low: Math.min(...closes), high: Math.max(...closes) }
}
