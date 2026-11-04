import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import {
  DesktopTile, TileClaim, TileIdentity, TileStats, GALLERY_TWO_TRACK_PX,
} from '../DesktopTile'

/**
 * A tile in a one-column rail draws at the rail's scale, not its rank's.
 *
 * ── The defect this suite was written for ────────────────────────────────
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
 *
 * That behaviour is unchanged and is still the subject. What changed is where
 * the decision is made.
 *
 * ── Why these cases were rewritten rather than kept ──────────────────────
 *
 * The collapse was a second `TileSize` handed to every tile through React
 * context, and the old cases pinned exactly that: a `scale` prop on
 * `DesktopTile`, `const scale: TileSize = narrow ? 'compact' : size` in
 * `OpportunityGrid`, and `size={scale}` at each internal.
 *
 * It was too expensive. MEASURED on Explore at 1920 with 145 tiles, opening
 * and closing the asset workspace: 289 of ~543 DOM mutations per transition
 * were tiles rewriting those classes -- `text-[30px]` to `text-[17px]`,
 * `line-clamp-3 text-[17px]` to `line-clamp-2 text-[15px]` -- with long tasks
 * of 68, 73, 68 and 98ms against a 16ms frame, on a field where about six
 * tiles are on screen. Pinning the signal off while LEAVING the re-render in
 * place took every long task to zero, which is what ruled React out: the cost
 * was the writes and the style invalidation they cause.
 *
 * So the rung moved to `index.css`, under the same container the track count
 * uses, where the browser restyles the tiles it has rendered and skips the
 * `content-visibility: auto` ones. The cases below pin the two halves that
 * can now drift apart: the HOOKS the CSS selects on, and the VALUES it steps
 * down to.
 *
 * ── Why the width half is still source-pinned ────────────────────────────
 *
 * jsdom has no layout and no container queries: every box measures 0, a
 * `ResizeObserver` never fires, and `@container` is never evaluated. A render
 * test would therefore observe the wide rung and pass against a stylesheet
 * with none of this in it.
 */

const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')
const CSS = src('index.css')
const css = () => CSS
/**
 * The `@container not (min-width: 34rem)` block, on its own.
 *
 * Read once at module load and brace-matched over the cached string. Re-read
 * per character it takes 20s and the suite times out, which is the one way a
 * source-pinned case can fail without telling you anything.
 */
const RUNG = (() => {
  const at = CSS.indexOf('@container not (min-width: 34rem)')
  if (at < 0) return ''
  const open = CSS.indexOf('{', at)
  let depth = 0
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(open, i)
  }
  return ''
})()
const rung = () => {
  expect(RUNG, 'no @container not (min-width: 34rem) block in index.css').not.toBe('')
  return RUNG
}

describe('the tile hands the rung something to select on', () => {
  /**
   * Every class the stylesheet reaches for, with the wide value it steps down
   * from. Both halves are the subject: a hook with no Tailwind value beside it
   * means the wide field lost its own ladder, and a value with no hook means
   * the rail can no longer reach it.
   */
  const HOOKS: ReadonlyArray<readonly [string, RegExp]> = [
    ['tile-frame', /\bp-4\b/],
    ['tile-display', /text-\[30px\]/],
    ['tile-beside', /text-\[13px\]/],
    ['tile-claim', /line-clamp-3 text-\[17px\]/],
    ['tile-figure', /text-\[19px\]/],
    ['tile-stats', /gap-x-5/],
    ['tile-shelf', /h-\[34px\]/],
    ['tile-actions', /px-4 pb-5 pt-3/],
  ]

  it.each(HOOKS)('a hero emits %s, carrying its wide value', (hook, wide) => {
    /* The internals are the CALLER's to compose, so a bare tile renders only
       the frame, the shelf and the actions. Composed here the way Explore
       composes it, which is the surface the rung was measured on. */
    render(
      <DesktopTile
        size="hero"
        onOpen={() => {}}
        eyebrow={<span>Decisions</span>}
        context={<span>a book</span>}
        actions={<button type="button">Ask</button>}
      >
        <TileIdentity symbol="AAPL" name="Apple Inc" size="hero" />
        <TileClaim size="hero">Trading below every case the desk wrote</TileClaim>
        <TileStats size="hero" stats={[{ value: '14.2%', key: 'to target' }]} />
      </DesktopTile>,
    )
    const tile = screen.getByTestId('desktop-tile')
    /* The span contract is untouched. `.gallery-region` selects `grid-column`
       off this attribute, and the rung selects off `.desktop-tile`, so the
       rail can draw small without the tile moving in the wide field. */
    expect(tile).toHaveAttribute('data-size', 'hero')
    expect(tile.className).toMatch(/\bdesktop-tile\b/)

    const el = tile.querySelector(`.${hook}`)
    expect(el, `no .${hook} in a hero tile`).not.toBeNull()
    expect(el!.className).toMatch(wide)
  })

  it('names every one of those hooks in the rung', () => {
    for (const [hook] of HOOKS) {
      expect(rung(), `the rung does not reach .${hook}`).toContain(`.${hook}`)
    }
  })

  it('reaches the opportunity tile body, which lives in the field not the frame', () => {
    /* `tile-body` is the gap above the picture and is emitted by
       `OpportunityGrid`, not by the tile, so no render here can see it. */
    expect(src('components/ideas-v2/OpportunityGrid.tsx')).toMatch(/'tile-body flex min-h-0/)
    expect(rung()).toContain('.tile-body')
  })
})

describe('the rung steps down to the compact rung the tables already name', () => {
  /**
   * Two languages, one ladder. The wide values are Tailwind classes in
   * `DesktopTile.tsx` and the step down is CSS, so the compact rung is
   * written twice and could drift -- silently, since nothing renders both.
   */
  const COMPACT: ReadonlyArray<readonly [string, string]> = [
    ['.tile-display', 'font-size: 17px'],
    ['.tile-beside', 'font-size: 11px'],
    ['.tile-claim', 'font-size: 15px'],
    ['.tile-figure', 'font-size: 15px'],
    ['.tile-claim', '-webkit-line-clamp: 2'],
    ['.tile-frame', 'padding: 0.75rem'],
    ['.tile-frame', 'gap: 0.375rem'],
    ['.tile-shelf', 'height: 26px'],
  ]

  it.each(COMPACT)('%s steps to %s', (hook, decl) => {
    const block = rung().slice(rung().indexOf(hook))
    expect(block.slice(0, block.indexOf('}'))).toContain(decl)
  })

  it('takes those values from the tile\'s own compact rung', () => {
    const f = src('components/desktop/DesktopTile.tsx')
    /* If any of these move in the component, the rung above is stale and the
       rail starts drawing a size the wide field no longer has. */
    expect(f).toMatch(/compact: 'text-\[17px\]'/)   // TILE_DISPLAY
    expect(f).toMatch(/compact: 'text-\[11px\]'/)   // TILE_BESIDE
    expect(f).toMatch(/compact: 'h-\[26px\]'/)      // SHELF_H
    expect(f).toMatch(/'line-clamp-2 text-\[15px\]/) // TileClaim's bottom rung
    expect(f).toMatch(/: 'gap-1\.5 p-3'/)            // the frame's bottom rung
  })
})

describe('the rung is scoped and specific enough to win', () => {
  it('is the exact complement of the two-track query, on the same container', () => {
    /* `not (min-width: ...)` rather than a `max-width`: a `max-width: 34rem`
       would ALSO match at exactly 34rem, where the span table has already
       gone to six tracks, so one width would get a one-column rung in a
       two-column grid. */
    expect(css()).toMatch(/@container not \(min-width: 34rem\)/)
    expect(css()).toMatch(/@container \(min-width: 34rem\)/)
    /* Two OTHER surfaces in this file do use `max-width: 34rem`, and they are
       why the distinction is worth stating: at exactly 34rem they are inside
       their own query AND inside the min-width one. Harmless there, fatal
       here, where the two queries decide the same ladder. */
    expect(rung()).not.toMatch(/max-width/)
  })

  it('selects three classes, so it outranks the utilities it overrides', () => {
    /* A Tailwind utility is one class (0,1,0). Every selector here is
       `.gallery-region > .desktop-tile .tile-*` (0,3,0) and wins without
       `!important`. Weakened to a bare `.tile-*` the utility wins instead and
       the rail silently stops collapsing. */
    for (const sel of rung().match(/\.tile-[a-z]+(?=\s*[,{])/g) ?? []) {
      const line = rung().slice(0, rung().indexOf(sel) + sel.length)
      const own = line.slice(line.lastIndexOf('}') + 1)
      expect(own, `${sel} is not scoped to a region tile`).toContain('.gallery-region > .desktop-tile')
    }
  })

  it('only applies inside a region gallery', () => {
    /* Outside a region the grid is window-sized and is never one narrow
       column, and the tile is the full width of its own panel. A rung that
       escaped `.gallery-region` would shrink every tile in a narrow panel on
       four other lenses. */
    expect(rung()).not.toMatch(/\{\s*\.tile-/)
    expect((rung().match(/\.gallery-region > \.desktop-tile/g) ?? []).length)
      .toBeGreaterThanOrEqual(9)
  })
})

describe('the rail knows when it is one column', () => {
  /**
   * THE case for the constant existing at all.
   *
   * The track count and the type rung are container queries in CSS; the plot
   * height is still a JavaScript number. Two literals would drift, and the
   * failure would be silent and strange: a plot changing height at a width
   * where nothing else did, or the reverse.
   */
  it('changes the plot height at the same width the grid changes track count', () => {
    expect(GALLERY_TWO_TRACK_PX).toBe(544)
    expect(GALLERY_TWO_TRACK_PX).toBe(34 * 16)
    expect(css()).toMatch(/@container \(min-width: 34rem\)/)
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

describe('the opportunity tile no longer re-typesets itself in React', () => {
  const f = () => src('components/ideas-v2/OpportunityGrid.tsx')

  it('passes the rank to every internal, so nothing rewrites on a width change', () => {
    /* These four were `size={scale}` and were 289 of the ~543 mutations. */
    expect(f()).toMatch(/\n {6}size=\{size\}/)
    expect(f()).toMatch(/name=\{item\.companyName \?\? null\}\n {8}size=\{size\}/)
    expect(f()).toMatch(/<TileClaim size=\{size\}>/)
    expect(f()).toMatch(/<TileStats\n {10}size=\{size\}/)
    // Gone rather than merely unused: a `scale` prop would invite it back.
    expect(f()).not.toMatch(/scale=\{/)
    expect(src('components/desktop/DesktopTile.tsx')).not.toMatch(/scale\?: TileSize\n {2}onOpen/)
  })

  it('keeps the width signal for the plot, which is a number and not a class', () => {
    /*
     * `height` goes into an SVG, so CSS cannot reach it, and this is the one
     * reason the component still reads the context. It is one inline style
     * per tile instead of five class rewrites.
     */
    expect(f()).toMatch(/const narrow = useGalleryNarrow\(\)/)
    expect(f()).toMatch(/const chartHeight = !narrow && size === 'hero' \? 112 : big \? 98 : 92/)
    expect(f()).toMatch(/const big = !narrow && drawsBig/)
    // The frame gap reads the RANK, because the rung takes it down in CSS.
    expect(f()).toMatch(/'tile-body flex min-h-0 min-w-0 flex-1 flex-col', drawsBig \? 'mt-3' : 'mt-2'/)
  })
})
