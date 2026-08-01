import type { CSSProperties } from 'react'

/**
 * Viewport-safe positioning for popovers, dropdowns and context menus.
 *
 * The pattern this replaces is scattered across ~30 components:
 *
 *     left: Math.min(x, window.innerWidth - 320)
 *
 * On a 390px-wide phone that evaluates to `min(x, 70)`, and for any popover
 * wider than the viewport it goes negative — the panel hangs off the left edge
 * and drags the page into horizontal scroll. These helpers clamp on both axes
 * and fall back to a full-width sheet when the preferred width simply does not
 * fit.
 */

export interface PopoverPlacementInput {
  /** Anchor point in viewport coordinates (e.g. from getBoundingClientRect). */
  x: number
  y: number
  /** Preferred width in px. */
  width: number
  /** Estimated height in px. Enables vertical flipping when known. */
  height?: number
  /** Minimum gap from the viewport edge. */
  margin?: number
  /** Gap between the anchor and the panel when flipping vertically. */
  offset?: number
}

export interface PopoverPlacement {
  left: number
  top: number
  /** Apply as `maxWidth` — narrower than `width` when the viewport is small. */
  maxWidth: number
  /** Apply as `maxHeight` so long menus scroll instead of overflowing. */
  maxHeight: number
  /** True when the panel was flipped above the anchor. */
  flipped: boolean
}

const DEFAULT_MARGIN = 8
const DEFAULT_OFFSET = 4

export function placePopover({
  x,
  y,
  width,
  height,
  margin = DEFAULT_MARGIN,
  offset = DEFAULT_OFFSET,
}: PopoverPlacementInput): PopoverPlacement {
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight =
    typeof window === 'undefined'
      ? 768
      : window.visualViewport?.height ?? window.innerHeight

  const available = Math.max(0, viewportWidth - margin * 2)
  // Never promise more width than exists — this is the case the old
  // `innerWidth - 320` arithmetic got wrong.
  const maxWidth = Math.min(width, available)

  // Clamp low bound last so a too-wide panel pins to the left margin rather
  // than to a negative offset.
  const left = Math.max(margin, Math.min(x, viewportWidth - maxWidth - margin))

  let top = y
  let flipped = false
  let maxHeight = Math.max(0, viewportHeight - y - margin)

  if (height != null) {
    const spaceBelow = viewportHeight - y - margin
    const spaceAbove = y - margin

    if (height > spaceBelow && spaceAbove > spaceBelow) {
      flipped = true
      top = Math.max(margin, y - height - offset)
      maxHeight = Math.max(0, y - offset - margin)
    } else {
      maxHeight = Math.max(0, spaceBelow)
    }
  }

  top = Math.max(margin, Math.min(top, viewportHeight - margin))

  return { left, top, maxWidth, maxHeight, flipped }
}

/**
 * True when a popover of this width cannot sit comfortably in the viewport and
 * should be presented as a bottom sheet instead of an anchored panel.
 */
export function shouldUseSheet(width: number, margin = DEFAULT_MARGIN): boolean {
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  return width > viewportWidth - margin * 2
}

/** Convenience for the common `style={{ ... }}` spread on an absolute panel. */
export function popoverStyle(input: PopoverPlacementInput): CSSProperties {
  const { left, top, maxWidth, maxHeight } = placePopover(input)
  return { left, top, maxWidth, maxHeight, overflowY: 'auto' }
}
