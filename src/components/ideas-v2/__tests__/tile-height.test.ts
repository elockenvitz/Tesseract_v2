import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A tile is a preview, not a panel.
 *
 * ── The defect, measured ──────────────────────────────────────────────────
 *
 * Explore at 1920, over 108 tiles: heights ran 134 to 418px with a median of
 * 265. The top of that range was reported as cards that are "way too
 * big/tall", the named example a 915x418 hero -- 2.2:1, and taller than two
 * of the rows beneath it put together.
 *
 * `items-stretch` multiplies it. The grid row sizes to its tallest member, so
 * ONE 418px card made the two 451px-wide cards beside it 418px as well: three
 * oversized tiles for one oversized card.
 *
 * ── Why the height comes out of the PICTURE ───────────────────────────────
 *
 * A `max-height` on the grid cell was the obvious fix and it was tried first.
 * It brought the range down -- 418 to 332 -- and clipped real text on 39 of
 * the 108 tiles: "14.2% in Large Cap Growth" lost 65px, and a dozen caption
 * lines lost 10 to 18px each. The picture cannot absorb the reduction,
 * because by then it is already at its `minHeight` floor and the caption sits
 * below it. A card that hides its own caption is worse than a tall card.
 *
 * The chart is the one part of a tile built to be given less room: it
 * measures its own box in `fill` mode, so a shorter plot is a shorter plot
 * and not a cropped one. Measured after: 418 -> 356 max, p90 303, and the
 * only elements still reporting overflow are the carousel's OFF-SCREEN panel
 * (26 of them, identical to the baseline before any change) and a 5px axis
 * label on two 139px tiles that carry no chart at all.
 *
 * ── What these cases are for ──────────────────────────────────────────────
 *
 * They are source reads, because the numbers are the subject. jsdom performs
 * no layout -- every `getBoundingClientRect` reads 0 and Container Queries
 * are unimplemented -- so a rendering case here could asserts nothing about
 * height. The live measurements above are the evidence; these keep the
 * numbers from drifting back.
 */

const ROOT = resolve(__dirname, '../../../../')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const GRID = 'src/components/ideas-v2/OpportunityGrid.tsx'
const TILE = 'src/components/desktop/DesktopTile.tsx'
const CSS = 'src/index.css'

describe('a wide tile spends less of its height on the picture', () => {
  /** THE case. The two numbers that came down, read off the source. */
  it('draws a shorter plot on hero and wide tiles', () => {
    const line = read(GRID).match(/const chartHeight = [^\n]+/)?.[0]
    expect(line).toBeTruthy()
    const nums = (line!.match(/\d+/g) ?? []).map(Number)
    expect(nums).toHaveLength(3)
    const [hero, big, narrow] = nums
    // The heights that produced a 418px hero.
    expect(hero).toBeLessThan(150)
    expect(big).toBeLessThan(120)
    // And a floor: a plot shorter than the narrow tile's has stopped being a
    // chart. 92px is what a narrow tile has always drawn legibly.
    expect(hero).toBeGreaterThanOrEqual(narrow)
    expect(big).toBeGreaterThanOrEqual(narrow)
    expect(narrow).toBe(92)
  })

  /**
   * The frame comes down with the picture, or the room the chart gave back
   * is spent on white space instead.
   */
  it('trims the hero frame rather than banking the space', () => {
    const tile = read(TILE)
    const at = tile.indexOf("size === 'hero' ?")
    expect(at).toBeGreaterThan(-1)
    const rule = tile.slice(at, at + 160)
    expect(rule).not.toMatch(/'gap-4 p-5'/)
    expect(rule).toMatch(/'gap-3 p-4'/)
    /*
     * Non-vacuity: the other three sizes must be untouched. A rule that had
     * flattened every size to one value would satisfy the two checks above
     * and would be a different change from the one measured.
     */
    expect(rule).toMatch(/'gap-2 p-4'/)
    expect(rule).toMatch(/'gap-1\.5 p-3'/)
  })
})

/**
 * The picture box is floored whenever it holds a chart.
 *
 * ── The defect, measured ──────────────────────────────────────────────────
 *
 * The floor read `panels.length > 1`, which is true only when a tile has an
 * archetype AND a chart. A tile whose ONLY panel is the chart therefore got
 * no floor -- and the chart is the one panel with a fixed intrinsic height,
 * so it rendered at full size inside whatever `flex-1` left and was clipped
 * by the panel's own `overflow-hidden`.
 *
 * At 1920 over the whole field: 27 tiles drew a chart taller than its box,
 * and on the worst the cut was 93px out of a 93px chart -- the picture was
 * not short, it was entirely invisible. Every one was a Research card, the
 * category with no archetype of its own. After: 0 cut.
 */
describe('a chart is given room for the height it actually draws', () => {
  it('floors the box on the chart being present, not on the panel count', () => {
    const grid = read(GRID)
    const line = grid.match(/style=\{\{ minHeight: [^\n]+/)?.[0]
    expect(line).toBeTruthy()
    expect(line).toMatch(/panels\.some\(p => p\.key === 'price'\)/)
    // The condition that left a chart-only tile unfloored.
    expect(line).not.toMatch(/panels\.length > 1/)
  })

  /**
   * Non-vacuity: a floor of `undefined`, or one applied unconditionally,
   * would both satisfy a check that only looked at the condition. The value
   * has to still be the carousel's own box, which is what keeps paging from
   * resizing the card.
   */
  it('still floors it at the panel box, so paging cannot resize the card', () => {
    const grid = read(GRID)
    expect(grid).toMatch(/const panelBox = chartHeight \+ 22/)
    const line = grid.match(/style=\{\{ minHeight: [^\n]+/)?.[0]
    expect(line).toContain('? panelBox :')
    // And a tile with no chart still gets none: an archetype is `fill` and
    // has no fixed height to protect.
    expect(line).toContain(': undefined')
  })
})

describe('the cell is not capped, because capping cut the words', () => {
  /**
   * The counter-case, and the reason it exists: `max-height` on the gallery
   * cell is the fix a reader of this code will reach for next. It clipped 14
   * tiles' real text when it was tried.
   */
  it('puts no max-height on a gallery cell', () => {
    const css = read(CSS)
    const region = css.slice(css.indexOf('.gallery-region {'))
    const upTo = region.slice(0, region.indexOf('Desktop feed tile'))
    /*
     * Anchored to the start of a line, because the comment left behind
     * QUOTES the declaration it is warning against -- and a check that
     * matched the warning would fail on the very note that explains it.
     */
    expect(upTo).not.toMatch(/^\s*max-height:\s*\d/m)
  })

  it('leaves the reason behind, so the next attempt knows the cost', () => {
    const css = read(CSS)
    // Rewritten, not deleted: the measurement that rules the approach out.
    expect(css).toContain('A CEILING WAS TRIED HERE AND CUT THE WORDS')
    expect(css).toContain('39 of the 108')
  })
})
