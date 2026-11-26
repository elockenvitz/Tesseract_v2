/**
 * Keeping a vertically panned chart in sight of its own data.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * A drag on the plot pans BOTH axes: `dx` moves time, `dy` moves the price
 * window. The time axis is self-limiting, because panning past the data just
 * shows empty chart and the bars are still one drag away. The price axis is
 * not. Nothing bounded it, so a single ordinary drag could take the window
 * from 300..550 to 950..1200 with every bar sitting below 400 -- a blank
 * chart, with no indication of which way the data went.
 *
 * That matters more than it sounds, because a reader dragging sideways to
 * walk back through history rarely drags exactly sideways. Every such drag
 * quietly skewed the vertical framing, and the only way back was a reset
 * button they had no reason to look for.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * The price window may be panned until the data is nearly out of frame, and
 * no further: some fraction of the window must always be showing data. The
 * window is SHIFTED back, never resized, because a pan is not a zoom -- a
 * clamp that changed the range would silently rescale the chart under a
 * gesture that promised only to move it.
 */

/** The least of the window that must still be looking at data. */
export const MIN_VISIBLE_FRACTION = 0.2

export interface PriceWindow {
  min: number
  max: number
}

/**
 * Pull a panned price window back until it overlaps the data again.
 *
 * `data` is the price extent of what is on screen horizontally. When it is
 * empty or degenerate there is nothing to stay in sight of, so the window is
 * returned untouched -- clamping against a zero-height band would pin the
 * chart to a single price.
 */
export function clampPriceWindow(next: PriceWindow, data: PriceWindow): PriceWindow {
  const height = next.max - next.min
  if (!Number.isFinite(height) || height <= 0) return next
  if (!Number.isFinite(data.min) || !Number.isFinite(data.max)) return next
  if (data.max <= data.min) return next

  const margin = height * MIN_VISIBLE_FRACTION

  /* Drifted UP: the window sits above the data, so its floor may not rise
     past the point where only `margin` of it still covers the top bar. */
  if (next.min > data.max - margin) {
    const shift = next.min - (data.max - margin)
    return { min: next.min - shift, max: next.max - shift }
  }

  /* Drifted DOWN: the mirror image, measured from the lowest bar. */
  if (next.max < data.min + margin) {
    const shift = data.min + margin - next.max
    return { min: next.min + shift, max: next.max + shift }
  }

  return next
}
