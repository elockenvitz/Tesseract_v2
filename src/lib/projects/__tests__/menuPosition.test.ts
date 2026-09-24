import { describe, it, expect } from 'vitest'
import {
  clampMenuToViewport,
  menuPositionStyle,
  MENU_VIEWPORT_MARGIN,
  MENU_ANCHOR_GAP,
} from '../menuPosition'

/** iPhone 12/13/14 logical viewport — the size this pass targets. */
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

/** The Projects list status menu: four rows at the phone's 44px minimum. */
const STATUS_MENU = { width: 140, height: 4 * 44 + 8 }
/** The tag menu, which is the wide one. */
const TAG_MENU = { width: 256, height: 280 }

function anchorAt(left: number, top: number, height = 28) {
  return { left, top, bottom: top + height }
}

describe('clampMenuToViewport', () => {
  describe('vertical placement', () => {
    it('opens below the anchor when there is room', () => {
      const placement = clampMenuToViewport(anchorAt(16, 120), STATUS_MENU, PHONE)
      expect(placement.top).toBe(120 + 28 + MENU_ANCHOR_GAP)
    })

    it('flips above the anchor when the menu would run off the bottom', () => {
      // A card near the bottom of the phone: 184px of menu cannot fit in the
      // ~60px left below it, and this is the case that made the status change
      // unreachable — a fixed menu off the bottom edge cannot be scrolled to.
      const anchor = anchorAt(16, 760)
      const below = clampMenuToViewport(anchor, STATUS_MENU, PHONE)

      expect(below.top).toBeLessThan(anchor.top)
      expect(below.top).toBeGreaterThanOrEqual(MENU_VIEWPORT_MARGIN)
      expect(below.top + STATUS_MENU.height).toBeLessThanOrEqual(anchor.top)
    })

    it('keeps the whole menu on screen wherever the anchor sits', () => {
      // Sweep the anchor down the viewport; no placement may leave the screen.
      for (let top = 0; top <= PHONE.height - 28; top += 17) {
        const placement = clampMenuToViewport(anchorAt(16, top), STATUS_MENU, PHONE)
        const height = Math.min(STATUS_MENU.height, placement.maxHeight)

        expect(placement.top).toBeGreaterThanOrEqual(0)
        expect(placement.top + height).toBeLessThanOrEqual(PHONE.height)
      }
    })

    it('caps max-height so a menu taller than the viewport scrolls instead of clipping', () => {
      const tall = { width: 140, height: 2000 }
      const placement = clampMenuToViewport(anchorAt(16, 400), tall, PHONE)

      expect(placement.maxHeight).toBeLessThan(tall.height)
      expect(placement.maxHeight).toBeGreaterThan(0)
      expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(PHONE.height)
    })

    it('stays below rather than flipping when neither side fits, so the menu opens where the user is looking', () => {
      // Anchor mid-screen, menu taller than either gap: below is roomier here.
      const placement = clampMenuToViewport(anchorAt(16, 300), { width: 140, height: 900 }, PHONE)
      expect(placement.top).toBe(300 + 28 + MENU_ANCHOR_GAP)
    })
  })

  describe('horizontal placement', () => {
    it('uses the anchor left edge when the menu fits', () => {
      expect(clampMenuToViewport(anchorAt(16, 120), TAG_MENU, PHONE).left).toBe(16)
    })

    it('pulls a wide menu back inside the right edge', () => {
      // A tag chip that has wrapped to the right of its row: 256px from x=300
      // ends at 556 on a 390px screen.
      const placement = clampMenuToViewport(anchorAt(300, 120), TAG_MENU, PHONE)

      expect(placement.left).toBeLessThan(300)
      expect(placement.left + TAG_MENU.width).toBeLessThanOrEqual(PHONE.width)
    })

    it('never places the menu past the left edge, even when it cannot fit at all', () => {
      const wider = { width: 600, height: 120 }
      const placement = clampMenuToViewport(anchorAt(300, 120), wider, PHONE)

      expect(placement.left).toBeGreaterThanOrEqual(0)
      expect(placement.left).toBe(MENU_VIEWPORT_MARGIN)
    })
  })

  describe('desktop is unchanged', () => {
    it('places menus exactly at the anchor, as the unclamped code did', () => {
      // Every desktop case this pass touched must land on the old values:
      // left = rect.left, top = rect.bottom + 4.
      for (const anchor of [anchorAt(24, 100), anchorAt(640, 300), anchorAt(1100, 500)]) {
        for (const menu of [STATUS_MENU, TAG_MENU]) {
          const placement = clampMenuToViewport(anchor, menu, DESKTOP)
          expect(placement.left).toBe(anchor.left)
          expect(placement.top).toBe(anchor.bottom + MENU_ANCHOR_GAP)
        }
      }
    })
  })
})

describe('menuPositionStyle', () => {
  it('returns pixel strings and a scroll cap for direct use as an inline style', () => {
    const style = menuPositionStyle(anchorAt(16, 120), STATUS_MENU, PHONE)

    expect(style.left).toBe('16px')
    expect(style.top).toBe('152px')
    expect(style.overflowY).toBe('auto')
    expect(style.maxHeight).toMatch(/^\d+px$/)
  })
})
