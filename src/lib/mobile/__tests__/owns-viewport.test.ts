/**
 * The shell hands the phone viewport to a surface only when the surface says so.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 *
 * `Layout` wraps every non-full-width tab in `overflow-auto px-3 py-4`. For a
 * page that is already `h-full`, paints its own background and runs its own
 * scroller, that wrapper costs 24px of width and 32px of height on the
 * smallest screens, puts an inert second scrollport around the page's real
 * one, and insets a full-bleed background away from the edges it was drawn to
 * reach.
 *
 * The opt-out is `ownsViewportOnMobile` in the registry. It is declared per
 * surface and NOT inferred from what a page's root happens to look like,
 * because a heuristic on "has a background colour" would silently start and
 * stop applying as unrelated styling changed.
 *
 * Two directions are asserted, and the second is the one that actually bites:
 * a surface that leans on the shell's `px-3` must never carry the flag, or its
 * content runs into the screen edge.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { MOBILE_SURFACES, getMobileSurface, ownsMobileViewport, isDesktopOnly } from '../mobile-surfaces'

/** Surfaces whose page is `h-full`, self-scrolling, self-padding, self-coloured. */
const OWNS = ['files', 'charting', 'asset-allocation', 'allocation-period']

/**
 * Surfaces that rely on the shell for their horizontal padding. Their page
 * roots carry no `px-*` of their own, so the flag would push text to the bezel.
 */
const RELIES_ON_SHELL_PADDING = ['notes-list', 'notebook', 'list', 'user', 'theme', 'portfolios-list']

describe('ownsViewportOnMobile', () => {
  it('is set on exactly the surfaces that manage their own viewport', () => {
    const actual = MOBILE_SURFACES.filter(s => s.ownsViewportOnMobile).map(s => s.type).sort()
    expect(actual).toEqual([...OWNS].sort())
  })

  it('never applies to a surface that borrows the shell padding', () => {
    for (const type of RELIES_ON_SHELL_PADDING) {
      expect(getMobileSurface(type), `${type} is not registered`).toBeDefined()
      expect(ownsMobileViewport(type), `${type} must not own the viewport`).toBe(false)
    }
  })

  it('never applies to a surface a phone cannot open', () => {
    for (const s of MOBILE_SURFACES) {
      if (!s.ownsViewportOnMobile) continue
      expect(isDesktopOnly(s.type), `${s.type} owns the viewport but is desktop-only`).toBe(false)
    }
  })

  it('reads false for an unregistered type rather than throwing', () => {
    expect(ownsMobileViewport('no-such-tab')).toBe(false)
    expect(ownsMobileViewport(undefined)).toBe(false)
  })

  /**
   * Types that render the SAME component must agree, or one route gets the
   * padded wrapper and its sibling does not — the identical page, two layouts.
   */
  it('agrees across types that render one component', () => {
    // `model-file` renders the owning asset, so it must agree with `asset` —
    // it used to render FilesPage and agreed with `files` instead.
    for (const [a, b] of [['asset', 'model-file'], ['asset-allocation', 'allocation-period']]) {
      expect(ownsMobileViewport(a), `${a} vs ${b}`).toBe(ownsMobileViewport(b))
    }
  })

  /**
   * The flag is only meaningful if Layout still reads it. This is the seam a
   * refactor is most likely to drop silently, because nothing else imports it.
   */
  it('is still consulted by the shell', () => {
    const layout = readFileSync(resolve(__dirname, '../../../components/layout/Layout.tsx'), 'utf8')
    expect(layout).toContain('ownsMobileViewport')
    // Phone only: desktop must keep the standard wrapper.
    expect(layout).toMatch(/ownsViewport\s*=\s*!!activeTab && isMobile && ownsMobileViewport/)
  })

  /**
   * `note` reaches the same end through its own branch and is deliberately not
   * folded in: it keeps `px-3` because the editor's `max-sm:-mx-3` reclaims it,
   * so the two have to agree. Folding it in here would silently drop that.
   */
  it('leaves the note tab on its own contract', () => {
    expect(ownsMobileViewport('note')).toBe(false)
    const layout = readFileSync(resolve(__dirname, '../../../components/layout/Layout.tsx'), 'utf8')
    expect(layout).toContain('isMobileNote')
  })
})
