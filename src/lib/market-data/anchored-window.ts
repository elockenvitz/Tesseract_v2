/**
 * Slice a price series at an anchor, reporting honestly whether it got there.
 *
 * ── Why this is a lib and not a component's helper ────────────────────────
 *
 * It began inside `research-v2/ResearchVisual`. Decisions imported it from
 * there -- a lens reaching into another lens -- and then the shared tile shell
 * needed it too, which would have made `components/desktop` depend on
 * `components/research-v2`. At that point a small sparkline re-derived the
 * window inline instead, and reproduced, within the hour, the exact bug this
 * function had just been fixed for: a window whose closes all POST-DATE the
 * anchor is not a since-the-anchor window, and captioning it as one is how a
 * line covering two days came to claim it measured a fill from ten days back.
 *
 * So it lives here, where a lens, the shell and a lib may all read it without
 * depending on each other. One definition of "which rows am I drawing" is the
 * entire point: every bug this function has had was two pieces of code
 * disagreeing about where the window starts.
 */

export interface AnchoredWindow {
  series: number[]
  changePct: number
  /**
   * The window genuinely begins AT the anchor -- the series covers it, and
   * there are at least two closes from it onward. False means there is still
   * a line worth drawing, but no since-the-anchor claim may be made about it.
   */
  reachesAnchor: boolean
  days: number
  /** ISO date of the window's first close -- its x-axis origin. */
  from: string
  /** ISO date of the window's last close -- its x-axis end. */
  to: string
}

export function anchoredWindow(
  history: { date: string; close: number }[] | undefined,
  anchorISO: string | null | undefined,
): AnchoredWindow | null {
  if (!history || history.length < 2) return null

  const anchor = anchorISO ? Date.parse(anchorISO) : NaN
  const hasAnchor = Number.isFinite(anchor)
  const first = Date.parse(history[0].date)
  /*
   * The series must START at or before the anchor. A history that begins
   * AFTER it does not cover the anchor at all, however many closes it holds
   * -- which is the case that fooled the sparkline: every close sat after the
   * fill, `findIndex` happily returned 0, and a two-day line was captioned as
   * the move since a ten-day-old fill.
   */
  const reachesAnchor = hasAnchor && Number.isFinite(first) && first <= anchor

  /*
   * ── `findIndex` returning -1 is not "start at zero" ──────────────────────
   *
   * `Math.max(0, -1)` is 0, so when NO close sits at or after the anchor the
   * slice silently became the whole history while `reachesAnchor` stayed
   * true. The caller then captioned a year-long line "364d since filled"
   * about a fill from yesterday -- a full-history window wearing a
   * since-anchor claim, which is exactly what this function exists to
   * prevent.
   *
   * A thesis reviewed today hits the same path, so this was wrong for
   * Research too, not only for the decision tile that surfaced it.
   */
  const anchorIdx = reachesAnchor
    ? history.findIndex(p => Date.parse(p.date) >= anchor)
    : -1
  /** There IS a window measured from the anchor. */
  const anchored = anchorIdx >= 0
  const startIndex = anchored ? anchorIdx : 0

  const slice = history.slice(startIndex)
  if (slice.length < 2 || !(slice[0].close > 0)) return null

  return {
    series: slice.map(p => p.close),
    changePct: ((slice[slice.length - 1].close - slice[0].close) / slice[0].close) * 100,
    reachesAnchor: anchored,
    days: Math.round(
      (Date.parse(slice[slice.length - 1].date) - Date.parse(slice[0].date)) / 86_400_000,
    ),
    /*
     * The dates the window actually spans, so a chart can label its own axis
     * without re-deriving the slice. A caller that recomputed which rows it
     * is drawing to find its first and last date would be a second copy of
     * the anchoring rule above.
     */
    from: slice[0].date,
    to: slice[slice.length - 1].date,
  }
}

/** Dated closes, in the shape the tile charts hold them. */
export interface DatedClose {
  date: Date
  value: number
}

/** `anchoredWindow` over the `{ date: Date, value }` shape tiles use. */
export function windowOverCloses(
  points: readonly DatedClose[] | undefined,
  anchorISO: string | null | undefined,
): AnchoredWindow | null {
  if (!points || points.length < 2) return null
  return anchoredWindow(
    points.map(p => ({ date: p.date.toISOString(), close: p.value })),
    anchorISO,
  )
}
