import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The gallery does not lay out the tiles nobody can see.
 *
 * ── The defect, measured ──────────────────────────────────────────────────
 *
 * Opening a tile takes the gallery region from `w-full` to `max-w-[26rem]`
 * and from 12 grid tracks to 1. Pressing "Back to ..." takes it back. Either
 * way every tile is a new width, so the browser re-runs each tile's internal
 * flex, text measurement and chart sizing. On this book that is 151 tiles in
 * one uninterruptible task.
 *
 * Measured live at 1920 with a 151-tile Explore gallery, as `longtask`
 * entries around the press:
 *
 *   before   open 64 + 62ms     back 63 + 62ms
 *   after    open 72ms          back 66ms  (one task, not two)
 *
 * A frame is 16ms. The reported symptom was that pressing back out of the
 * asset workspace felt "a little hitchy", and the second ~62ms task was the
 * tile layout: it is gone. What remains is the React cost of unmounting the
 * workspace, independently measured at ~60ms for a selection change with the
 * pane already mounted, so there is no tile-layout component left in it.
 *
 * ── Why this and not windowing ────────────────────────────────────────────
 *
 * Windowing the gallery means owning scroll position, measurement and the
 * grid's row packing in JS. `content-visibility: auto` is the browser doing
 * the same thing with none of that surface, and it is cheap HERE
 * specifically because every tile is already `position: relative` with
 * `overflow: hidden` (see `DesktopTile`), so the `contain: layout style
 * paint` it implies grants nothing a tile had not already promised. That
 * precondition is the whole reason it is safe, which is why it is asserted
 * below rather than left as a remark.
 *
 * ── Why `auto 300px` and not a bare length ────────────────────────────────
 *
 * The `auto` keyword is the load-bearing half: the browser stores each
 * tile's real height once it has been on screen and uses that from then on.
 * Measured: the region's scrollHeight read 12213px before the change, 13184
 * immediately after (the first guess, 8% high), and exactly 12213 again
 * after one pass down the scroller. Without `auto` that 8% never corrects,
 * and the scrollbar stays wrong for the life of the page.
 *
 * ── What these cases are for ──────────────────────────────────────────────
 *
 * Source reads, like the sibling cases in `tile-height.test.ts`, and for the
 * same reason: jsdom performs no layout, so a rendering case could assert
 * nothing about any of this. The live measurements above are the evidence.
 * These keep the mechanism from being quietly removed, and keep the `auto`
 * keyword from being quietly dropped -- which would look like a tidy-up and
 * would reintroduce a drifting scrollbar with no symptom at review time.
 */
const ROOT = resolve(__dirname, '../../../../')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const CSS = 'src/index.css'
const TILE = 'src/components/desktop/DesktopTile.tsx'

/** The `.gallery-region > [data-size]` rule body, which is where this lives. */
function cellRule(css: string): string {
  const at = css.indexOf('.gallery-region > [data-size] {')
  expect(at).toBeGreaterThan(-1)
  const body = css.slice(at)
  return body.slice(0, body.indexOf('\n  }') + 4)
}

describe('off-screen gallery tiles skip layout', () => {
  it('declares content-visibility: auto on the gallery cell', () => {
    expect(cellRule(read(CSS))).toMatch(/^\s*content-visibility:\s*auto;/m)
  })

  it('keeps the auto keyword on contain-intrinsic-size', () => {
    /*
     * `contain-intrinsic-size: 300px` would pass a check that only looked
     * for the property, and would permanently misreport the scroll height.
     * The keyword is the part that matters, so the keyword is what is
     * asserted.
     */
    expect(cellRule(read(CSS))).toMatch(/^\s*contain-intrinsic-size:\s*auto\s+\d+px;/m)
  })

  it('states the measurement that justifies it', () => {
    // Rewritten, not deleted, if the numbers change: the next reader needs
    // to know what the change bought, or it reads as an optimisation on
    // faith.
    const css = read(CSS)
    expect(css).toContain('A frame is 16ms')
    expect(css).toContain('151')
  })
})

describe('the precondition that makes the containment free', () => {
  /**
   * `content-visibility` implies `contain: layout style paint`. Paint
   * containment clips anything drawing outside the box. On these tiles that
   * is a no-op because they already clip themselves -- but only while they
   * do, so this is a real coupling and not a stylistic preference.
   *
   * Checked live over 40 tiles: one reported a descendant outside its box,
   * and it is the focus ring, which is `outline` and unaffected by paint
   * containment.
   */
  it('still renders every tile as a self-clipping box', () => {
    const tile = read(TILE)
    expect(tile).toContain('overflow-hidden')
    expect(tile).toContain('relative')
  })

  it('records the coupling where someone reusing the rule would read it', () => {
    expect(read(CSS)).toContain('Do not copy')
  })
})
