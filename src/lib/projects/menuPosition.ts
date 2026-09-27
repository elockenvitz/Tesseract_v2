/**
 * Viewport clamping for the row menus on the Projects list.
 *
 * The status, priority and tag menus are `position: fixed` and are placed from
 * the anchor chip's `getBoundingClientRect()` — `left: rect.left`, `top:
 * rect.bottom + 4`. On a desktop that is always fine, because a menu opened
 * from a chip near the bottom of a tall window still has room under it.
 *
 * On a phone it is not. The status menu is five rows, and the phone layer
 * gives every button a 44px minimum, so it is ~220px tall against an 844px
 * screen whose list scrolls. Opened from a card in the lower third it runs off
 * the bottom, and a `fixed` element cannot be scrolled to — the action is
 * simply unreachable. The tag menu is 256px wide and, opened from a chip that
 * has wrapped to the right of its row, runs off the right edge the same way.
 *
 * Flip above the anchor when there is no room below and more room above;
 * otherwise sit against the bottom edge. Horizontally, pull back inside the
 * right edge but never past the left. This is the same rule `MyTasksView`
 * already applies to its project popover, stated once so the three menus that
 * do not have it can share it.
 */

/** Distance kept between a menu and the viewport edge. */
export const MENU_VIEWPORT_MARGIN = 8

/** Distance between the anchor and the menu. */
export const MENU_ANCHOR_GAP = 4

export interface MenuAnchor {
  left: number
  top: number
  bottom: number
}

export interface MenuViewport {
  width: number
  height: number
}

export interface MenuPlacement {
  left: number
  top: number
  /** Cap for the menu's own `max-height`, so a menu taller than the screen scrolls. */
  maxHeight: number
}

/**
 * Place a fixed menu of `width` × `height` against `anchor`, kept inside
 * `viewport`.
 *
 * `height` is the menu's natural height; the returned `maxHeight` is what is
 * actually available once placed, which is smaller only when neither side of
 * the anchor can hold the whole menu.
 */
export function clampMenuToViewport(
  anchor: MenuAnchor,
  size: { width: number; height: number },
  viewport: MenuViewport
): MenuPlacement {
  const margin = MENU_VIEWPORT_MARGIN
  const gap = MENU_ANCHOR_GAP

  // Horizontal: prefer the anchor's left edge, pull back off the right edge,
  // and never go past the left edge — a narrow viewport can want both.
  const maxLeft = viewport.width - size.width - margin
  const left = Math.max(margin, Math.min(anchor.left, maxLeft))

  const spaceBelow = viewport.height - (anchor.bottom + gap) - margin
  const spaceAbove = anchor.top - gap - margin

  if (size.height <= spaceBelow) {
    return { left, top: anchor.bottom + gap, maxHeight: spaceBelow }
  }

  // Not enough room below. Flip above only if above is genuinely roomier,
  // so a menu that fits neither way still opens downward where the user
  // is looking rather than jumping over the anchor for no gain.
  if (spaceAbove > spaceBelow) {
    const height = Math.min(size.height, spaceAbove)
    return {
      left,
      top: Math.max(margin, anchor.top - gap - height),
      maxHeight: Math.max(0, spaceAbove),
    }
  }

  return { left, top: anchor.bottom + gap, maxHeight: Math.max(0, spaceBelow) }
}

/** The placement as inline style, including the scroll cap. */
export function menuPositionStyle(
  anchor: MenuAnchor,
  size: { width: number; height: number },
  viewport: MenuViewport
): { left: string; top: string; maxHeight: string; overflowY: 'auto' } {
  const placement = clampMenuToViewport(anchor, size, viewport)
  return {
    left: `${placement.left}px`,
    top: `${placement.top}px`,
    maxHeight: `${placement.maxHeight}px`,
    overflowY: 'auto',
  }
}
