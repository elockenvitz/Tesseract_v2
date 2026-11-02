import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { DesktopTile, GALLERY_TWO_TRACK_PX } from '../DesktopTile'

/**
 * A tile in a one-column rail draws at the rail's scale, not its rank's.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `size` governed two different things: how many tracks the cell spans, and
 * how large the tile draws itself inside that cell. In a wide mosaic they are
 * the same thing. Below 34rem the region resolves to ONE track, so every
 * tile is the same width whatever its rank -- and a hero went on drawing a
 * 30px ticker, `p-4` padding, a 34px shelf and a 112px plot, all chosen for a
 * 915px card, inside a 376px one.
 *
 * MEASURED in the Dashboard's browse column at 1920, 114 tiles at 376px wide:
 * the tallest ran 356px, nearly square. After: 280px, and nothing above it.
 * The wide field is untouched -- same 108 tiles at 451/915px, median 265,
 * max 356, exactly as before.
 *
 * ── Why the width half is source-pinned ──────────────────────────────────
 *
 * The decision is made by a `ResizeObserver` reading the grid's own width,
 * which jsdom cannot produce: every box there measures 0, so a render test
 * would observe `narrow === false` and pass against a component that never
 * collapsed anything. What CAN be rendered is the consequence -- a tile told
 * to draw small while spanning large -- and that is the case below.
 */

const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

describe('span by rank, draw by width', () => {
  it('spans as its rank asks while drawing at the scale it is given', () => {
    render(
      <DesktopTile size="hero" scale="compact" onOpen={() => {}} eyebrow={<span>Decisions</span>} context={<span>a book</span>}>
        <span>body</span>
      </DesktopTile>,
    )
    const tile = screen.getByTestId('desktop-tile')
    /*
     * The span contract is untouched. `.gallery-region` selects its
     * `grid-column` off this attribute, and the skeleton emits the same one,
     * so changing it to the drawn scale would move the tile in the wide
     * field as well -- which is the opposite of the point.
     */
    expect(tile).toHaveAttribute('data-size', 'hero')

    // And the frame is the compact one: a hero's `p-4` around a rail card is
    // the padding half of what the reader called too large.
    const body = tile.querySelector('.flex.min-w-0.flex-1.flex-col')!
    expect(body.className).toMatch(/\bp-3\b/)
    expect(body.className).not.toMatch(/\bp-4\b/)

    // The shelf follows the drawn scale too, or a compact card carries a
    // hero's 34px footer.
    expect(screen.getByTestId('tile-shelf').className).toMatch(/h-\[26px\]/)
  })

  it('draws at its rank when no scale is given, which is every other caller', () => {
    render(
      <DesktopTile size="hero" onOpen={() => {}} eyebrow={<span>Decisions</span>} context={<span>a book</span>}>
        <span>body</span>
      </DesktopTile>,
    )
    const tile = screen.getByTestId('desktop-tile')
    expect(tile).toHaveAttribute('data-size', 'hero')
    expect(tile.querySelector('.flex.min-w-0.flex-1.flex-col')!.className).toMatch(/\bp-4\b/)
    expect(screen.getByTestId('tile-shelf').className).toMatch(/h-\[34px\]/)
  })
})

describe('the rail knows when it is one column', () => {
  /**
   * THE case for the constant existing at all.
   *
   * The track count is a container query in CSS and the tile's scale is a
   * JavaScript number, so the same threshold is read in two languages. Two
   * literals would drift, and the failure would be silent and strange: tiles
   * changing scale at a width where the column count did not change, or the
   * reverse.
   */
  it('changes scale at the same width the grid changes track count', () => {
    expect(GALLERY_TWO_TRACK_PX).toBe(544)
    const css = src('index.css')
    // The query the span table lives under, stated in rem.
    expect(css).toMatch(/@container \(min-width: 34rem\)/)
    expect(GALLERY_TWO_TRACK_PX).toBe(34 * 16)
  })

  it('asks the grid itself, not the window', () => {
    const f = src('components/desktop/DesktopTile.tsx')
    /*
     * A media query cannot answer this. The same 1920px window shows this
     * field at full width and at ~26rem beside an open workspace, which is
     * the whole reason the track count is a container query -- and a `window`
     * read here would make the tiles disagree with their own grid.
     */
    expect(f).toMatch(/new ResizeObserver/)
    expect(f).toMatch(/ro\.observe\(el\)/)
    expect(f).toMatch(/w < GALLERY_TWO_TRACK_PX/)
    expect(f).not.toMatch(/window\.innerWidth[^\n]*GALLERY_TWO_TRACK_PX/)
  })

  /** Outside a region the grid is window-sized and is never one narrow column. */
  it('observes nothing on a gallery that is not region-sized', () => {
    const f = src('components/desktop/DesktopTile.tsx')
    expect(f).toMatch(/if \(!region \|\| !el \|\| typeof ResizeObserver === 'undefined'\) return/)
  })
})

describe('the opportunity tile takes the rail scale', () => {
  const f = () => src('components/ideas-v2/OpportunityGrid.tsx')

  it('collapses the drawn scale and leaves the rank alone', () => {
    expect(f()).toMatch(/const narrow = useGalleryNarrow\(\)/)
    expect(f()).toMatch(/const scale: TileSize = narrow \? 'compact' : size/)
    // The span still goes out as the rank.
    expect(f()).toMatch(/\n      size=\{size\}/)
    expect(f()).toMatch(/\n      scale=\{scale\}/)
  })

  it('sizes the picture and the ticker off the drawn scale', () => {
    /*
     * The two things a hero does that cost the most height in a narrow rail:
     * a 112px plot and a 30px display ticker. Both read `scale` now. The
     * chart is the one that cannot be fixed in CSS -- it is a number passed
     * to a component.
     */
    expect(f()).toMatch(/const chartHeight = scale === 'hero' \? 112 : big \? 98 : 92/)
    expect(f()).toMatch(/const big = scale === 'hero' \|\| scale === 'large'/)
    expect(f()).toMatch(/name=\{item\.companyName \?\? null\}\n        size=\{scale\}/)
    // And the old spelling is gone rather than merely shadowed.
    expect(f()).not.toMatch(/const chartHeight = size ===/)
  })
})
