/**
 * The arithmetic behind "which point is under the finger".
 *
 * ── Why this is not inline in the chart ───────────────────────────────────
 *
 * It is three lines, and three lines written twice is how a chart ends up
 * highlighting a different point from the one it reads out. The failure is
 * invisible in review — both copies look right — and it only shows up as "the
 * dot is on the wrong day", which is indistinguishable from bad data.
 *
 * So the mapping lives here, once, as a pure function a unit test can drive
 * over the cases a browser makes awkward: a zero-width box, a pointer outside
 * the plot, a single-point series.
 */

export interface PlotBox {
  left: number
  width: number
}

/**
 * The index of the point nearest a client-x position.
 *
 * `null` when there is nothing to map onto — a box with no width (an unmounted
 * or display:none plot, and every element in jsdom) or a series too short to
 * have a second point. Returning null rather than 0 matters: a chart that
 * silently snaps to the first close on a zero-width box would read out a price
 * from a year ago as if it were the one under the finger.
 *
 * Clamped to the series, so a pointer that has been dragged past either edge
 * holds the end point instead of running off into a negative index.
 */
export function indexAtClientX(clientX: number, box: PlotBox, count: number): number | null {
  if (!Number.isFinite(clientX)) return null
  if (!(box.width > 0)) return null
  if (count < 2) return null
  const frac = Math.min(Math.max((clientX - box.left) / box.width, 0), 1)
  return Math.round(frac * (count - 1))
}

/**
 * Keep a label inside the plot it annotates.
 *
 * A read-out pinned at the x it describes is half outside the box at either
 * end, and a plot that clips (every one of ours does — the line and the fill
 * run to the edges) turns that into a label cut in half, which reads as a
 * rendering fault rather than as a value at the edge of the window.
 */
export function clampPercent(pct: number, min: number, max: number): number {
  if (!Number.isFinite(pct)) return min
  return Math.min(Math.max(pct, min), max)
}

/**
 * How to offset a marker sitting at `pct` across its plot.
 *
 * Centred in the middle, tucked fully inside at the extremes. The default
 * read-out of a price chart is the LAST close, at 100%, and a centred dot
 * there is half outside the plot — so this is the common case, not the edge
 * case.
 */
export function edgeAlignedTranslate(pct: number): string {
  if (pct > 97) return '-100%'
  if (pct < 3) return '0'
  return '-50%'
}
