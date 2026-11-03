/**
 * The browse gallery, and the tiles in it.
 *
 * ── Width was the point, and now there is all of it ──────────────────────
 *
 * The left rail failed because a 252px column could only hold a symbol, a pill
 * and a number, so the scan carried no investment content. The capped band
 * that replaced it was better but still rationed: 340px of vertical space
 * shared with a detail workspace underneath.
 *
 * The gallery now owns the surface while the reader is browsing. A tile can
 * show what a position weighs against the book, where spot sits relative to
 * the case written for it, or what the price did since a decision — the things
 * someone is actually comparing across when they ask which one to open.
 *
 * ── A tile answers four questions and stops ──────────────────────────────
 *
 * What is this, why does it matter, what kind of problem is it, and roughly
 * what would I do. Not the detail workspace compressed into a card: the reader
 * is choosing what to open, not reading it here.
 *
 * ── No call to action AT REST ────────────────────────────────────────────
 *
 * The original three-column landing pages each carried their own verb, so
 * every tile competed with the workspace for the same decision. Opening is
 * still the action, and the detail workspace still owns the verbs.
 *
 * This file used to enforce that by offering no footer slot at all. That did
 * not hold: Decisions added one anyway, with `<button>`s nested inside this
 * shell's own `<button>` -- invalid HTML, and unreachable by keyboard. A rule
 * a surface can break by accident is not a rule, it is a trap.
 *
 * So the constraint is now expressed where it belongs, in the resting state.
 * `TileShelf` shows the object's standing context at rest and reveals the
 * verbs only on hover or keyboard focus, in reserved height, so a gallery
 * still reads as a field of objects rather than a wall of buttons -- and the
 * verbs are real, accessible buttons when the reader reaches for them.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import type { SemanticTone } from '../../lib/semantic-tone'
import {
  CARD_SURFACE, CARD_EDGE, CARD_EDGE_CRITICAL, CARD_EDGE_SELECTED,
  CARD_HOVER, CARD_HOVER_CRITICAL, GALLERY_GROUND,
} from '../../lib/ui/surface'
/* One definition of "which rows am I drawing", shared with the lens charts:
   every bug this window has had was two pieces of code disagreeing about
   where it starts. */
import { windowOverCloses } from '../../lib/market-data/anchored-window'

/**
 * The editorial gallery.
 *
 * ── Why not equal rectangles ─────────────────────────────────────────────
 *
 * A grid of identical cards says every object matters equally. None of these
 * lenses believe that: three of them rank, and the fourth knows which records
 * actually remember something. A gallery that flattens its own model back to
 * uniform is throwing away the one thing it knows.
 *
 * ── Size means importance. Colour means condition. ───────────────────────
 *
 * These are separate axes and must stay separate. A 28% position with no
 * written case is HERO because of what it is worth, and amber because the work
 * is unfinished. A 2% genuine framework break is COMPACT and rose. Neither
 * axis may be derived from the other, and a tile is never promoted because it
 * happens to have a chart to draw.
 *
 * ── Reading order is semantic order ──────────────────────────────────────
 *
 * Tiles are emitted in rank order and placed by normal grid flow, never
 * `dense`. Dense backfills earlier gaps with later items, which would put rank
 * #7 above rank #4 the moment a row did not divide evenly -- the layout would
 * be quietly lying about priority. Spans are chosen so every row closes:
 *
 *   2xl (12 cols)  hero 6 x 2 rows | medium 3 | compact 3
 *   xl  (9 cols)   hero 5 x 2 rows | medium 4 | compact 3
 *   md  (6 cols)   hero 6 full     | medium 3 | compact 3
 *
 * At 2xl that yields exactly the intended composition: the hero holds the
 * upper-left two rows, two mediums sit beside it in row one, two more in row
 * two, and the compacts run on beneath.
 */

/**
 * How much room an object has earned. Never a severity.
 *
 * Four bands, not three. With only hero/medium/compact, ranks two through
 * eight rendered as one undifferentiated field of equal cards and the page
 * read as "one important thing, then a grid" -- which is not what any of these
 * lenses believe. `large` gives second place visible second place.
 */
export type TileSize = 'hero' | 'large' | 'medium' | 'compact'

/**
 * Flow discipline.
 *
 * `ranked` lets the hero occupy two rows, because rank #1 is always first and
 * a two-row block at the start of the grid leaves no hole.
 *
 * `chronological` cannot do that. A Decisions hero belongs wherever its date
 * puts it, and a mid-grid two-row block leaves gaps that normal flow never
 * backfills. So in that mode size drives composition and height inside an
 * equal column, and every tile keeps the same width. Chronology stays true and
 * the grid stays calm; the richer record still reads larger.
 */
/**
 * `packed` is a third mode, for a lens whose order is not a total priority.
 *
 * Explore ranks by INTERESTINGNESS, and `explore-compose` states plainly that
 * this is not a total order. A grid whose cells vary by content will not tile
 * evenly, and the alternative to closing the holes is a field of gaps that
 * read as cards which failed to render. Mobile's own packer already promotes
 * within a lookahead for the same reason.
 *
 * `ranked` and `chronological` must never use it: there, position is a claim.
 */
export type TileFlow = 'ranked' | 'chronological' | 'packed'

/*
  Every row closes, at every width, in emitted order.

    2xl (12)   hero 6x2 | large 6 | medium 3 | compact 3
               -> row 1  hero + large
                  row 2  hero + medium + medium
                  row 3+ four compacts

    xl (9)     hero 5x2 | large 4 | medium 4 | compact 3
    md (6)     hero full | large full | medium 3 | compact 3

  Normal flow, never dense: dense backfills earlier gaps with later items,
  which would put rank #7 above rank #4 the moment a row did not divide.
*/
const SPAN: Record<TileFlow, Record<TileSize, string>> = {
  /*
   * ── `row-span-2` removed from the hero ───────────────────────────────────
   *
   * It guaranteed the hero two rows of height regardless of what it had to
   * say, and the second row's height came from whatever stacked beside it --
   * so the widest tile on Portfolio, Research and Decisions was routinely
   * 200-300px taller than its own contents, with the gap sitting in the
   * middle of the card between the prose and the bottom-pinned visual.
   *
   * Prominence was the reason for it, and prominence survives: the hero is
   * still the first tile and still the widest by a whole column. Width is a
   * claim the content can actually fill; height was one it could not.
   */
  ranked: {
    hero: 'md:col-span-6 xl:col-span-5 2xl:col-span-6',
    large: 'md:col-span-6 xl:col-span-4 2xl:col-span-6',
    medium: 'md:col-span-3 xl:col-span-4 2xl:col-span-3',
    compact: 'md:col-span-3 xl:col-span-3 2xl:col-span-3',
  },
  /*
    Chronological decks can use the same spans, because their order is fixed
    and the newest record is always first -- so a two-row block at index 0
    leaves no hole. What they must never do is REORDER to make a nicer page.
  */
  chronological: {
    hero: 'md:col-span-6 xl:col-span-5 2xl:col-span-6',
    large: 'md:col-span-6 xl:col-span-4 2xl:col-span-6',
    medium: 'md:col-span-3 xl:col-span-3 2xl:col-span-3',
    compact: 'md:col-span-3 xl:col-span-3 2xl:col-span-3',
  },
  /*
    Packed uses the ranked spans -- the difference is `grid-auto-flow: row
    dense` in the gallery, not the widths. Every span here is a divisor of the
    track count at each breakpoint, so a row only goes short when a wide tile
    follows a narrow one (3 + 6, then a 6 that will not fit). Dense backfills
    that 3-wide hole with a later narrow tile instead of leaving it empty.
  */
  packed: {
    hero: 'md:col-span-6 xl:col-span-5 2xl:col-span-6',
    large: 'md:col-span-6 xl:col-span-4 2xl:col-span-6',
    medium: 'md:col-span-3 xl:col-span-4 2xl:col-span-3',
    compact: 'md:col-span-3 xl:col-span-3 2xl:col-span-3',
  },
}

/**
 * Columns from the REGION rather than the window.
 *
 * The four workspace lenses each own a whole tab, so the window's width IS
 * their width and `md:`/`xl:`/`2xl:` are right for them. Explore is not: the
 * same 1920px window shows it at full width and at ~40rem beside an open
 * asset workspace, and a media query cannot tell those apart -- it would go on
 * packing twelve tracks into a pane where a tile is 3rem wide.
 *
 * So a caller inside a resizable region asks for this instead, and the track
 * count comes from a container query. The spans are selected on `data-size`,
 * which `DesktopTile` has always emitted, rather than mirroring the Tailwind
 * span table in CSS -- a copy of that table is a thing to keep in step, and
 * the attribute is already the contract. See `.gallery-region` in index.css.
 *
 * The caller supplies the container: `container-type: inline-size` on the
 * scroll host, which is also the one element that is never remounted, so the
 * grid re-flows in place and the reader's scroll does not move.
 */
/**
 * The width at which the region stops being one column.
 *
 * The same 34rem the container query in `.gallery-region` uses, stated once
 * here and read by both -- a second number would drift from it and the tiles
 * would change scale at a width where the track count did not.
 */
export const GALLERY_TWO_TRACK_PX = 34 * 16

/**
 * ── One column means one scale ───────────────────────────────────────────
 *
 * `sizeByRank` grades the field: hero, large, medium, compact. That grading
 * is about EMPHASIS in a wide mosaic, where a hero is half a row and a
 * compact is a quarter of one, and it is how a reader sees which few findings
 * lead.
 *
 * Below 34rem the region is a single track, so every tile is the same width
 * whatever its rank -- and the grading stops meaning emphasis and starts
 * meaning nothing but extra height. MEASURED in the Dashboard's browse column
 * at 1920, 114 tiles at 376px wide: the tallest was a 356px hero, nearly
 * square, with a 30px ticker and a 112px plot that were both chosen for a
 * 915px card. The reader's words for it were that the cards are still too
 * large.
 *
 * So a tile asks whether it is in a one-column region and draws at the
 * compact scale if it is. The RANK is untouched -- order still carries the
 * emphasis, which is the half of the grading that still works in a list.
 */
const GalleryNarrowContext = createContext(false)

/** True inside a region currently resolving to one column. */
export function useGalleryNarrow(): boolean {
  return useContext(GalleryNarrowContext)
}

export function DesktopGallery({
  title, action, note, flow = 'ranked', region = false, children,
}: {
  title: React.ReactNode
  /** Size the grid off the containing region instead of the window. */
  region?: boolean
  /**
   * Accepted and not drawn.
   *
   * The tally beside the heading restated a field the reader can see, and on a
   * lens whose job is to say which FEW things matter, the total is the least
   * useful number on the page. The prop stays so callers need not all change
   * at once, and so a future summary line has somewhere to read it from.
   */
  count?: number
  /** A filter or selector for the whole gallery. */
  action?: React.ReactNode
  /** One quiet line beneath the heading: a summary, a caveat. */
  note?: React.ReactNode
  flow?: TileFlow
  children: React.ReactNode
}) {
  /*
   * Measured on the grid itself, and only in region mode.
   *
   * A window media query cannot answer this -- the same 1920px window shows
   * this field at full width and at ~26rem beside an open workspace, which is
   * the reason the track count is a container query in the first place. CSS
   * answers it for the tracks; the tiles' own scale is a JavaScript number
   * (`chartHeight`), so it needs the measurement too, taken ONCE for the field
   * rather than per tile.
   *
   * Outside region mode the grid is sized off the window by Tailwind and is
   * never one narrow column, so there is nothing to ask and no observer.
   */
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = gridRef.current
    if (!region || !el || typeof ResizeObserver === 'undefined') return
    const read = (w: number) => setNarrow(w > 0 && w < GALLERY_TWO_TRACK_PX)
    read(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(entries => {
      for (const e of entries) read(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [region])

  return (
    <div data-testid="desktop-gallery" data-flow={flow} data-narrow={narrow ? 'true' : undefined} className="px-6 pb-10 pt-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-tight">{title}</h1>
        {/*
          No count beside the heading.

          It restated something the reader can see -- the field is right there
          -- and on a lens whose whole job is to say which few things matter,
          a tally of how many there are in total is the least useful number on
          the page. `count` stays in the props so callers need not all change
          at once; it simply is not drawn.
        */}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {note && <div className="mt-1.5">{note}</div>}
      {/*
        Rows size to their content.

        This was `minmax(168px, auto)`, which is a FLOOR: a compact tile
        carrying a ticker and one figure got 168px and left about a hundred of
        them blank, and a hero spanning two rows was guaranteed 336px whether
        or not it had 336px to say. Measured across Portfolio, Research and
        Decisions that was the single largest quantity of white on each page,
        and no amount of restyling the contents fixes a card that is taller
        than its contents by construction.

        A small floor survives so a nearly-empty tile is still a tile rather
        than a sliver, and `row-span-2` still works: a hero taller than two
        content rows grows them, which is what grid does.
      */}
      {/*
        ── And tiles size to their content too ──────────────────────────────

        The note above cut the row FLOOR from 168px to 88px, which was half the
        problem. The other half is that a grid item defaults to
        `align-self: stretch`, so a row is as tall as its tallest member and
        every other tile in it is inflated to match — the floor was never what
        was making those cards tall, a rich neighbour was.

        Measured on Ideas at 1920x889, the first row: AMZN carries a price
        chart and is 524px. Beside it, AAPL held 342px of void (65% of the
        tile) and LLY 338px (64%), because three lines of text were stretched
        to a neighbour's height. CEG ran 228px empty, 50%.

        ── Why the stretch is back ───────────────────────────────────────────

        `items-start` was the fix for a while: each tile as tall as what it
        has to say, row bottoms ragged. It traded void INSIDE the card for
        void BETWEEN the cards, and measured at 1920x889 the second was no
        smaller -- the first Ideas row ran AMZN 418px beside LLY 303px and
        AAPL 303px, so 115px of page ground sat under each short tile and the
        row read as a broken shelf.

        Neither was ever the real problem. The problem was that nothing in the
        card wanted the extra height, so wherever it went it was dead. Now the
        picture takes it: the visual box is `flex-1` over a floor rather than
        a fixed height (`OpportunityGrid`), the range axis grows its band and
        marker into whatever it is given, and clamped prose shows the lines
        that fit instead of a fixed count.

        So rows are flush again and the slack is spent, not moved. Nothing
        here demands a height: the shell is `flex flex-col` with no `h-full`,
        which ADAPTS to the row.
      */}
      <div
        ref={gridRef}
        className={clsx(
          'mt-4 grid items-stretch gap-3',
          region
            ? 'gallery-region'
            : 'grid-cols-1 md:grid-cols-6 xl:grid-cols-9 2xl:grid-cols-12',
        )}
        style={{
          gridAutoRows: 'minmax(88px, auto)',
          /*
             ── When a lens may close its own holes ────────────────────────

             `row` everywhere by default, and the reason is at the top of this
             file: dense backfills earlier gaps with later items, so rank #7
             lands above rank #4 the moment a row does not divide evenly, and
             the layout quietly lies about priority.

             `pack` is for a lens whose order is NOT a total priority. Explore
             ranks by interestingness, which `explore-compose` says in as many
             words is not a total order -- the fourth-most-interesting thing is
             not meaningfully behind the third -- and mobile's own packer
             already promotes a card within a lookahead window to avoid
             stranding a hole. A lens that cannot make that claim leaves this
             alone.
          */
          gridAutoFlow: flow === 'packed' ? 'row dense' : 'row',
        }}
      >
        <GalleryNarrowContext.Provider value={narrow}>
          {children}
        </GalleryNarrowContext.Provider>
      </div>
    </div>
  )
}

/**
 * The gallery's own loading state.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Every lens had hand-rolled a skeleton, and every one of them described a
 * DIFFERENT page from the one that replaced it: a `md:grid-cols-2
 * xl:grid-cols-3` grid of equal `h-56` cards handing over to a twelve-column
 * mosaic of four different tile sizes. The handover was therefore a layout
 * change rather than a fade -- the last and largest jump of a cold load,
 * arriving exactly when the reader had started looking.
 *
 * So the skeleton is built from the same `SPAN` map, the same grid and the
 * same size functions the real gallery uses. If the mosaic changes, this
 * changes with it, because it is reading the same source rather than
 * imitating it.
 *
 * Heights are per SIZE, not one global number: a hero and a compact do not
 * occupy the same room, and a skeleton that pretends they do is the same
 * mistake in a different place. They are honest approximations of a typical
 * tile at that size -- the grid's `minmax(88px, auto)` still governs, so a
 * real tile that wants more room takes it.
 */
const SKELETON_HEIGHT: Record<TileSize, string> = {
  hero: 'h-[232px]',
  large: 'h-[232px]',
  medium: 'h-[172px]',
  compact: 'h-[132px]',
}

export function GallerySkeleton({
  title, count = 6, flow = 'ranked', sizeAt, heights, region = false,
}: {
  title: React.ReactNode
  /** As `DesktopGallery`'s: the placeholders must lay out on the same tracks
   *  the real grid will use, or the field re-flows the moment it loads. */
  region?: boolean
  /** How many placeholders. Default six: two rows of the usual mosaic. */
  count?: number
  flow?: TileFlow
  /** Which size each index takes. Defaults to the ranked rule, so a lens that
   *  ranks gets its real shape without having to say so. */
  sizeAt?: (index: number, total: number) => TileSize
  /**
   * Per-size heights for THIS lens, over the shared defaults.
   *
   * The shared map cannot be right for every lens, because the lenses' tiles
   * are genuinely different heights — measured at 1920x889, the widest tile
   * renders 461px on Ideas, 452px on Research and 233px on Decisions. One
   * number for all three is wrong twice, and `SKELETON_HEIGHT` was calibrated
   * near the shortest of them, so it under-reserved room almost everywhere.
   *
   * That only becomes visible as layout shift where there are enough tiles to
   * fill the viewport: Decisions has 26 and the mismatch sits below the fold,
   * Ideas has 90 and it does not. So this is an override a lens opts into with
   * measurements, not a new default anybody inherits.
   */
  heights?: Partial<Record<TileSize, string>>
}) {
  const size = sizeAt ?? sizeByRank
  const heightOf = (s: TileSize) => heights?.[s] ?? SKELETON_HEIGHT[s]
  /*
    The header below is the real gallery's, to the pixel.

    It was not: `pt-6` against the gallery's `pt-5`, a 21px heading against
    its 19px, and no note at all where the gallery always renders one. So the
    skeleton's grid began at y=72 and the real grid at y=101, and all ninety
    tiles dropped 29px the moment the data landed -- residual shift left over
    after the tile HEIGHTS were matched, from the one band above them that
    was never measured.
  */
  return (
    /* The same ground the loaded gallery stands on, from `lib/ui/surface`.
       Stated rather than inherited: a field that declares no background takes
       whatever shell it is mounted in, which is how three lenses ended up on
       a ground nobody chose. */
    <div className={clsx(
      'h-full overflow-y-auto px-6 pb-10 pt-5',
      GALLERY_GROUND,
      /* The scroll host is the container, here as in the loaded gallery. */
      region && 'gallery-host',
    )}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-tight">{title}</h1>
        <span className="h-4 w-8 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
      </div>
      {/*
        The note's room, two lines of it.

        Every lens writes a sentence here and the sentence wraps to two lines
        at the `74ch` measure each of them uses, so two is the case to reserve.
        A lens whose note runs to one line costs the reader 18px of lift,
        which is the better way to be wrong than 36px of drop -- and far
        better than the 36 this was short by when it reserved nothing.
      */}
      <div className="mt-1 max-w-[74ch] space-y-1 py-[2px]" aria-hidden>
        <span className="block h-3 w-full animate-pulse rounded bg-gray-200 dark:bg-white/10" />
        <span className="block h-3 w-2/5 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
      </div>
      <div
        /* `items-stretch` to match the real gallery below. It changes nothing
           on its own -- every placeholder carries an explicit `h-[Npx]`, which
           overrides stretch already -- but the two grids are meant to be the
           same geometry, and a difference here is how they drift. */
        className={clsx(
          'mt-4 grid items-stretch gap-3',
          region
            ? 'gallery-region'
            : 'grid-cols-1 md:grid-cols-6 xl:grid-cols-9 2xl:grid-cols-12',
        )}
        style={{ gridAutoRows: 'minmax(88px, auto)', gridAutoFlow: 'row' }}
      >
        {Array.from({ length: count }, (_, i) => {
          const s = size(i, count)
          return (
            <div
              key={i}
              /* The span rule in region mode selects on this, exactly as it
                 does on a real tile. */
              data-size={s}
              className={clsx(
                SPAN[flow][s],
                heightOf(s),
                'animate-pulse rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-[#141a25]',
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Rank to size, for the three lenses that rank.
 *
 * The top of the list gets the room, and richness never demotes it: a sparse
 * rank #1 is still HERO, and states its case with a number and typography
 * rather than a fabricated chart. Cutoffs scale with the population so a book
 * of four positions does not render three heroes.
 */
export function sizeByRank(index: number, total: number): TileSize {
  if (total <= 2) return index === 0 ? 'hero' : 'large'
  if (index === 0) return 'hero'
  if (index === 1) return 'large'
  // Two mediums fill the row beside the hero's second line; everything after
  // that is a scanning unit. A page of forty does not get ten mediums.
  if (index <= 3) return 'medium'
  return 'compact'
}

/**
 * Rank, with room to breathe further down the page.
 *
 * ── The shape this fixes ─────────────────────────────────────────────────
 *
 * `sizeByRank` grades monotonically: hero, large, medium, medium, then compact
 * for everything after. On a long field that is a page which starts big and
 * flattens into an unbroken run of small cards -- reported as "gradually
 * larger" at the top and nothing worth looking at below the fold.
 *
 * ── Why a rhythm is not a lie about rank ─────────────────────────────────
 *
 * Emission order is untouched: this changes how much room a position gets, not
 * which position an item holds. Past the leading band the ranker's own scores
 * are close together -- the fourteenth most interesting subject is not
 * meaningfully behind the thirteenth -- so granting one of them a larger cell
 * claims no more than "there is room to show this one properly".
 *
 * What it must not do is promote on CONTENT, which would let a tile grow
 * because it happens to have a chart. The interval is positional and fixed, so
 * it cannot be gamed by what an item carries.
 *
 * `every` is the cadence: one larger cell per that many compact ones. Seven
 * puts roughly one per two rows at desktop widths, which breaks the run
 * without turning the tail into a second leading band.
 */
export function sizeByRankWithRhythm(
  index: number, total: number, every = 7,
): TileSize {
  const base = sizeByRank(index, total)
  if (base !== 'compact') return base
  // Offset so the first larger cell lands a full row into the tail rather
  // than immediately after the leading band, where it would read as part of it.
  return (index - 4) % every === every - 1 ? 'medium' : 'compact'
}

/**
 * Chronological decks: newest carries the most weight, history gets denser.
 *
 * This is NOT a ranking. The order is the order; what changes is how much room
 * each record gets, which is the same thing a newspaper does with today's front
 * page and last week's briefs. Nothing is reordered to make a nicer layout.
 */
export function sizeByRecency(index: number): TileSize {
  if (index === 0) return 'hero'
  if (index === 1) return 'large'
  if (index <= 3) return 'medium'
  return 'compact'
}

/**
 * One tile.
 *
 * A real `<button>`, so it focuses, takes Enter and Space, and announces
 * itself — never a div wearing an onClick.
 *
 * There is no persistent selected ring. Stage 2A needed one to tie a tile to
 * the workspace beneath it; nothing sits beneath it now, and the moment a tile
 * is opened the gallery is gone. Hover and focus are what a reader needs here.
 *
 * `eyebrow` carries the issue and any trailing figure; `children` is the body.
 * Deliberately no footer slot — a call to action here would rebuild the
 * duplicate-verb problem this model exists to avoid.
 */
export function DesktopTile({
  onOpen, eyebrow, tone = 'neutral', size = 'compact', scale, flow = 'ranked',
  testId, dataAttrs, context, actions, inert = false, selected = false, children,
}: {
  /**
   * How large to DRAW, where that differs from how many tracks to span.
   *
   * They are the same thing in a wide mosaic and defaults to `size` for every
   * caller that has not thought about it. They come apart in a one-column
   * region, where every cell is the same width whatever its rank, and a
   * hero's padding, shelf and display type are all sized for a card twice as
   * wide as the one it is in. See `useGalleryNarrow`.
   */
  scale?: TileSize
  onOpen: () => void
  /**
   * This tile has nothing to open, and must not look as though it does.
   *
   * Four lenses rank objects that always resolve somewhere, so none of them
   * passes this. Explore does: `ExploreOpen` carries a `none` case whose own
   * doctrine is that a preview with nothing behind it is still worth READING
   * and must not offer a press -- a surface that takes a click and does
   * nothing is worse than one that never invited it.
   *
   * So the affordances go and the content stays: no pointer, no tab stop, no
   * Enter, no hover. Not `aria-disabled`, which would announce a control that
   * has been turned off; this was never a control.
   */
  inert?: boolean
  /**
   * This tile's object is the one in the workspace beside the field.
   *
   * The header above records that the persistent ring was REMOVED, and the
   * reason it gives is precise: nothing sits beneath these galleries any more,
   * and opening a tile replaces the field. That holds for the four workspace
   * lenses and it does not hold on the Dashboard, where Explore keeps its
   * field in the left column with the asset workspace open beside it -- so
   * which tile the pane belongs to is a real question a reader asks, and the
   * tile is the only place that can answer it.
   *
   * Opt-in, so no lens acquires a ring it has no use for.
   */
  selected?: boolean
  eyebrow: React.ReactNode
  /**
   * The object's standing context, shown at rest on the shelf. Omit to get no
   * shelf at all -- a tile with no actions keeps the original anatomy exactly.
   */
  context?: React.ReactNode
  /**
   * The verbs, revealed on hover and on keyboard focus. Rendered into a rail
   * of RESERVED height, so revealing them moves nothing.
   */
  actions?: React.ReactNode
  /** How much room this object earned. Importance, never severity. */
  size?: TileSize
  flow?: TileFlow
  /**
   * How loud this tile is allowed to be.
   *
   * Only the eyebrow band and, at `critical`, the border carry it -- never the
   * body ground, which would make the text harder to read to say something the
   * badge already says. `neutral` is the default and most tiles keep it: a
   * gallery where everything is coloured says nothing.
   */
  tone?: SemanticTone
  testId?: string
  dataAttrs?: Record<string, string | undefined>
  children: React.ReactNode
}) {
  /*
   * A group, not a button -- and that reverses this file's original decision.
   *
   * The shell was a real `<button>`, which is why the header below says there
   * is no footer slot: a tile that IS a button cannot contain one, because a
   * nested `<button>` is invalid HTML and unreachable by keyboard. Decisions
   * had already broken that rule in practice (its `TileAction` buttons sit
   * inside this element today), so the constraint was being violated rather
   * than honoured.
   *
   * Today and Ideas each independently arrived at the same answer: a
   * `role="group"` with a portal click that ignores anything interactive
   * underneath it. This adopts that contract rather than inventing a third.
   * `tabIndex={0}` plus an Enter/Space handler keeps the whole tile reachable
   * and openable from the keyboard, which is what the button gave us free.
   */
  const portalClick = (e: React.MouseEvent<HTMLElement>) => {
    if (inert) return
    const t = e.target as HTMLElement
    if (t.closest('button,a,input,select,textarea,[role="button"],[data-no-portal]')) return
    // A drag that selected text is a read, not a decision to leave.
    if (window.getSelection()?.toString()) return
    onOpen()
  }

  /* Span by rank, draw by width. Identical unless a caller says otherwise. */
  const drawAt = scale ?? size

  return (
    <div
      role="group"
      tabIndex={inert ? undefined : 0}
      data-testid={testId ?? 'desktop-tile'}
      data-tone={tone}
      data-size={size}
      data-inert={inert ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      onClick={portalClick}
      onKeyDown={(e) => {
        if (inert) return
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
      }}
      {...Object.fromEntries(Object.entries(dataAttrs ?? {}).filter(([, v]) => v != null))}
      /*
        One card, everywhere, and now it is the FEED's card.

        ── What changed and why ─────────────────────────────────────────────

        This used to read: a drop shadow under every tile makes a field read
        as a stack of floating panels rather than one instrument, and a large
        radius reads friendly where this surface is meant to read precise, so
        Ideas dropped both and the other four lenses followed. A hairline and
        the page's own grey ground did the work.

        The grey ground is gone -- removed on request, because the Dashboard's
        three sections disagreed about it: the feed was white and Explore and
        Portfolio were not. With the mat gone the card's own edge has to carry
        the separation, which is what the border weight and the one step of
        elevation below are doing. Not ornament; the page's job, moved onto
        the card.

        The values are `lib/ui/surface`'s, which are the feed card's, so the
        convergence now includes the one surface that was outside it.
      */
      className={clsx(
        SPAN[flow][size],
        /*
          `group` is what the shelf's cross-fade hangs off.

          No `h-full`. It was `height: 100%`, and an explicit height overrides
          alignment — so it silently defeated the `items-start` on the grid: a
          tile still resolved to the full height of a row whose tallest member
          was somebody else. On Ideas that made AAPL 524px to hold three lines
          of text, 342px of it void, because AMZN beside it had a price chart.

          Without it the tile is as tall as its own contents, which is what
          `items-start` was asking for. Nothing needed the fill: this element
          is `flex flex-col`, so it ADAPTS to a height rather than requiring
          one, and its single `flex-1` child is the body, which then takes its
          content height instead of a neighbour's.
        */
        /* `relative`: the action overlay is positioned against the CARD, not
           against the shelf it used to live in. See `TileActions`. */
        'group relative flex min-w-0 flex-col overflow-hidden text-left',
        CARD_SURFACE,
        !inert && 'cursor-pointer',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        /*
          The card's edge is a real line, and now it is the only separation
          there is: the page is white, so a weak border leaves the field
          reading as one undivided sheet -- which is the "white-washed"
          report the grey mat was introduced to answer.

          An inert tile takes the edge without the hover, because a card that
          lights up under the cursor is claiming a press it cannot take.
        */
        tone === 'critical' ? CARD_EDGE_CRITICAL : CARD_EDGE,
        !inert && (tone === 'critical' ? CARD_HOVER_CRITICAL : CARD_HOVER),
        /* Last, so it beats the tone border above rather than racing it. */
        selected && CARD_EDGE_SELECTED,
      )}
    >
      {/*
        The eyebrow is a line ON the card, not a header above it.

        It was already untinted, but it was still a separate row with its own
        rule under it and its own padding -- which reads as a header band
        whatever colour it is, and is what made these lenses look like a queue
        of filed records beside Ideas' field of objects. Ideas puts the same
        words on the same ground as the ticker, directly above it, with
        nothing between them.

        The tint survives for `critical` only, where being loud is the point.
      */}
      <div className={clsx(
        'flex min-w-0 flex-1 flex-col',
        tone === 'critical' && 'bg-rose-50/60 dark:bg-rose-950/20',
        /*
         * The hero's own padding and row gap, trimmed with the picture.
         *
         * `p-5` and `gap-4` put 40px of padding and up to 48px of gaps into a
         * card measured at 915x418 -- the one reported as "way too big". The
         * height is coming out of the picture (see `chartHeight` in
         * `OpportunityGrid`); leaving the frame at its old size would spend
         * what the picture gave back on white space instead.
         *
         * Only the hero moves. `large`, `medium` and `compact` were already
         * at `p-4`/`p-3` and are not what the reader was looking at.
         */
        /*
         * `drawAt`, not `size`: in a one-column region the rank still picks
         * the span but every cell is the same width, so a hero's frame there
         * is a hero's frame around a compact card. See `scale` above.
         */
        drawAt === 'hero' ? 'gap-3 p-4' : drawAt === 'large' ? 'gap-3 p-4'
          : drawAt === 'medium' ? 'gap-2 p-4' : 'gap-1.5 p-3',
      )}>
        <div className="flex flex-wrap items-center gap-1.5">
          {eyebrow}
        </div>
        {children}
        {context && <TileShelf size={drawAt} context={context} />}
      </div>
      {actions && <TileActions size={drawAt}>{actions}</TileActions>}
    </div>
  )
}

/** Reserved height for the one visual a tile is allowed, by size.
 *  `compact` gets none: an axis with no room for a label is decoration. */
const VISUAL_H: Record<TileSize, string | null> = {
  hero: 'h-16',      // 64px
  large: 'h-12',     // 48px
  medium: 'h-9',     // 36px
  compact: null,
}

/**
 * The one visual region, at a height the tile has already paid for.
 *
 * `TileVisual` (above) pins its child to the bottom but lets it be any height,
 * so a gallery's rows settled to whatever each object happened to draw and the
 * field had no baseline. This reserves the height instead: the slot is the
 * same on every tile of a size, whether the object inside draws or not, so
 * revealing the shelf or swapping the object moves nothing.
 *
 * Returns null at `compact` and for a missing child, so callers can hand it
 * whatever they have without branching on size themselves.
 */
export function TileVisualSlot({ size, children }: { size: TileSize; children: React.ReactNode }) {
  const h = VISUAL_H[size]
  if (!h || !children) return null
  return (
    <div
      data-testid="tile-visual-slot"
      data-size={size}
      // `data-no-portal`: a scrub across the object is a read, not a decision
      // to leave the gallery.
      data-no-portal
      className={clsx('mt-auto flex shrink-0 flex-col justify-end overflow-hidden pt-1', h)}
    >
      {children}
    </div>
  )
}

/** Reserved height for the shelf, by size. Tall enough for a real button and
 *  its focus ring, and no taller. */
const SHELF_H: Record<TileSize, string> = {
  hero: 'h-[34px]',
  large: 'h-[34px]',
  medium: 'h-[30px]',
  compact: 'h-[26px]',
}

/**
 * The canonical desktop action shelf, generalised from Ideas' card footer.
 *
 * Two layers in one rail of fixed height, cross-fading on hover and on
 * keyboard focus anywhere inside the tile. At rest the reader sees the
 * object's standing context; reaching for it reveals the verbs. Because the
 * height is reserved and both layers are absolutely positioned, nothing
 * reflows either way -- which is the whole point, and the reason Ideas' rail
 * works where the older `group-hover:opacity` reveals on the legacy dashboard
 * widgets pushed their cards around.
 *
 * A focus reveal is not a nicety: without it the actions are reachable by
 * Tab but invisible while focused. It keys on `:focus-visible`, never
 * `:focus-within` -- the latter also matches a button focused by a mouse
 * click, and a clicked button holds focus, so it left the shelf open on
 * every tile whose controls had been used.
 */
/**
 * Exported for Ideas, which is not built on `DesktopTile` and had its own.
 *
 * Its version was an opaque tray that grew UPWARD out of a 34px rail and
 * closed over the analysis -- because its action layer was 47px of why-now
 * plus buttons and would not fit the rail it was given. That is a real
 * trade-off honestly made, but it means hovering a card hides the thing the
 * reader was reading, which is what "cramped on hover" describes.
 *
 * This reserves the height instead and cross-fades opacity only, so nothing
 * moves and nothing is covered. Ideas fits it by putting only the verbs in
 * the action layer -- the why-now line is standing information and belongs in
 * the resting one.
 */
export function TileShelf({
  size, context,
}: { size: TileSize; context?: React.ReactNode }) {
  if (!context) return null
  return (
    <div
      data-testid="tile-shelf"
      className={clsx(
        'relative mt-auto shrink-0 border-t border-gray-200 pt-1.5 dark:border-white/10',
        SHELF_H[size],
      )}
    >
      {/* No longer cross-fades. The verbs moved to the top-right corner (see
          `TileActions`), so the two layers no longer occupy the same strip
          and there is nothing to swap: the standing context stays readable
          while the reader reaches for an action, which is strictly more
          information than trading one for the other. */}
      <div
        data-testid="tile-shelf-context"
        className={clsx(
          'pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 truncate',
          'text-[10px] text-gray-500 dark:text-gray-400',
        )}
      >
        {context}
      </div>
    </div>
  )
}

/**
 * The verbs, in the corner Today puts them in.
 *
 * ── Why they moved ───────────────────────────────────────────────────────
 *
 * They were the second layer of the shelf: bottom of the card, left-aligned,
 * cross-fading with the standing context. Today's have always been top-RIGHT,
 * right-aligned, over a scrim. Measured on the same screen -- Today's at
 * (top 1, right 1), Ideas' at (top 375, left 21) on a 418px card -- so the
 * same gesture on two lenses put the buttons at opposite corners, and the
 * reader has to look for them twice.
 *
 * Today is the reference because it is the lens people land on.
 *
 * The scrim is what makes this legal over content: a short white-to-nothing
 * gradient, so a verb never sits on top of a ticker it cannot be read
 * against. And the reveal is opacity ONLY, keyed on hover and
 * `:focus-visible` -- never `:focus-within`, which also matches a button
 * focused by a mouse click and pinned the row open on every tile whose
 * controls had been used.
 */
export function TileActions({ size, children }: { size: TileSize; children: React.ReactNode }) {
  return (
    <div
      data-testid="tile-shelf-actions"
      className={clsx(
        'pointer-events-none absolute right-0 top-0 z-10 flex flex-wrap items-center justify-end gap-1.5',
        size === 'hero' ? 'px-4 pb-5 pt-3' : size === 'compact' ? 'px-2 pb-4 pt-2' : 'px-3 pb-5 pt-2.5',
        'bg-gradient-to-b from-white via-white via-70% to-transparent dark:from-[#161d2a] dark:via-[#161d2a]',
        'opacity-0 transition-opacity duration-150',
        'group-hover:pointer-events-auto group-hover:opacity-100',
        'group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100',
      )}
    >
      {children}
    </div>
  )
}

/**
 * A verb on the shelf.
 *
 * `stopPropagation` so pressing it is not also read as opening the tile, and
 * `relative` so it sits above the resting layer it fades in over. Lives here
 * rather than in each workspace so four lenses stop hand-rolling it -- which
 * is how Decisions ended up with nested buttons inside a button.
 */
export function TileAction({
  label, onClick, primary, testId,
}: { label: string; onClick: () => void; primary?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={clsx(
        'relative rounded-md px-2 py-[3px] text-[11px] font-semibold transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        primary
          ? 'bg-blue-700 text-white hover:bg-blue-800'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10',
      )}
    >
      {label}
    </button>
  )
}

/**
 * The tile's state badge. One per tile, always first in the eyebrow.
 *
 * Exists so four workspaces stop hand-rolling the same rounded-full span with
 * the same four class strings and drifting apart by a pixel each time.
 */
export function TileState({ tone, children }: { tone: SemanticTone; children: React.ReactNode }) {
  return (
    <span className={clsx(
      // The Ideas label rhythm: 10px bold with wide tracking was borrowed
      // from the phone, where a label sits alone on a large tile. Ten of
      // those on one desktop field reads as shouting.
      'text-[10px] font-medium uppercase tracking-[0.08em]',
      STATE_INK[tone],
    )}>
      {children}
    </span>
  )
}

/** Condition, as ink on the label. The lightest treatment that still reads. */
const STATE_INK: Record<SemanticTone, string> = {
  critical: 'text-rose-700 dark:text-rose-400',
  review: 'text-amber-700 dark:text-amber-500',
  info: 'text-blue-700 dark:text-blue-400',
  neutral: 'text-gray-500',
}

/* ------------------------------------------------------------ tile pieces */

/** Object identity: the symbol, and the name where it fits. */
/**
 * One display ladder for the tile, and one scale for what sits beside it.
 *
 * There were two. `TileIdentity` stepped its ticker 30/24/20/17 and
 * `TileHeroNumber` stepped its figure 30/25/19/15 -- the same role, "the thing
 * this tile is about", disagreeing by a pixel or two at every step below hero.
 * A reader never sees them side by side as a comparison, which is exactly why
 * it survived: it reads as a gallery that is slightly out of tune rather than
 * as a bug anybody can point at. The field carried eleven distinct type sizes.
 *
 * The identity ladder won because ninety tiles wear it and five wear the
 * other. `beside` is a company name or a unit -- the small thing on the
 * baseline of the big thing -- and both now set it the same way.
 */
const TILE_DISPLAY: Record<TileSize, string> = {
  hero: 'text-[30px]',
  large: 'text-[24px]',
  medium: 'text-[20px]',
  compact: 'text-[17px]',
}

const TILE_BESIDE: Record<TileSize, string> = {
  hero: 'text-[13px]',
  large: 'text-[13px]',
  medium: 'text-[11px]',
  compact: 'text-[11px]',
}

export function TileIdentity({
  symbol, name, size = 'compact', subject = null,
}: {
  symbol: string | null
  name?: string | null
  size?: TileSize
  /**
   * What the card is about when it is about no ticker.
   *
   * ── The dash ────────────────────────────────────────────────────────────
   *
   * This slot used to render `symbol ?? '—'`, so a card with no ticker drew a
   * bare em dash at the tile's largest type, in black, where a name goes.
   * Measured live: every one of the six Ideas prompts on the field led with it
   * -- a 20px dash above "What are the biggest risks to your portfolio right
   * now?" -- and it was reported as the cards "showing as dashed".
   *
   * A placeholder in the most prominent position on a card is worse than an
   * empty position: it occupies the line a reader scans first and says
   * nothing. It is also an em dash in a user-visible string, which this
   * product does not use anywhere.
   *
   * ── What goes there instead ─────────────────────────────────────────────
   *
   * Whatever the card IS about, supplied by the caller because only the
   * caller knows -- a book's name for a portfolio card, the kind of post for a
   * prompt or a thought. Nothing is invented here: with no symbol and no
   * subject the row does not render at all, and the card's own headline
   * becomes its lead, which is what it should have been all along.
   */
  subject?: string | null
}) {
  const lead = symbol ?? subject
  // No lead, no row. See `subject`: an empty position beats a placeholder.
  if (!lead && !name) return null
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      {lead && (
        <span className={clsx(
          /*
           * ── The ticker had no ink of its own ──────────────────────────────
           *
           * This set weight, leading and tracking and no colour, so the
           * largest word on every tile INHERITED whatever the card passed
           * down. Measured on the live field: `rgb(0, 0, 0)`, pure black,
           * while every other ink on the same card is `gray-900` (#111827)
           * for the claim, `gray-700` for the body and `gray-500` for the
           * name beside it. So the one element a reader fixes on first was
           * the only one outside the palette, and 14 points darker than the
           * text under it.
           *
           * Nobody chose that; it is what no declaration resolves to. Stating
           * it puts the ticker on the same ramp as the sentence beneath it,
           * which is the whole of the difference between a card that reads as
           * typeset and one that reads as default.
           *
           * ── And 900 was a weight above the one that was wanted ───────────
           *
           * `font-black` at 30px in pure black is heavier than anything else
           * in the product. 800 keeps the ticker unmistakably the lead
           * without it being the loudest ink on a page of twelve cards.
           */
          'font-extrabold leading-none tracking-[-0.035em] text-gray-900 dark:text-gray-50',
          // A subject is words, not a ticker: it wraps and it is not shouted
          // at a ticker's weight. `truncate` keeps a long book name on a line.
          symbol ? null : 'min-w-0 truncate font-semibold',
          TILE_DISPLAY[size],
        )}>{lead}</span>
      )}
      {name && (
        <span className={clsx(
          'min-w-0 truncate font-medium text-gray-500',
          TILE_BESIDE[size],
        )}>{name}</span>
      )}
    </div>
  )
}

/**
 * The one number that IS the finding.
 *
 * For tiles whose most important fact is a quantity: what a position is worth
 * to a book, how much arrived, how long since anyone looked. Set at a size that
 * reads across the gallery, because burying it in 11px metadata is how a page
 * of investment facts ends up looking like a list of labels.
 *
 * This is what earns a hero its space when there is no honest chart to draw.
 */
export function TileHeroNumber({
  figure, unit, label, tone = 'neutral', scale = 'hero',
}: {
  figure: React.ReactNode
  unit?: string
  label: React.ReactNode
  tone?: SemanticTone
  /**
   * How much room the figure has.
   *
   * Added because Portfolio was saying the same fact four different ways: this
   * primitive on hero and large, a hand-rolled span on medium, and a
   * `TileMeta` row on compact -- three type scales and two label wordings, so
   * one fact read as three across a scanned gallery. Below `large` the label
   * sits inline, because a stacked caption under a 15px figure costs more
   * height than the card has.
   */
  scale?: TileSize
}) {
  const stacked = scale === 'hero' || scale === 'large'
  /* The tile's one display ladder -- see `TILE_DISPLAY`. This used to run its
     own, a pixel or two off at every step below hero. */
  /* The tile's one display ladder -- see `TILE_DISPLAY`. This used to run its
     own, a pixel or two off at every step below hero. */
  const figureSize = TILE_DISPLAY[scale]
  const unitSize = TILE_BESIDE[scale]
  const labelSize = stacked ? 'text-[12px]' : 'text-[10px]'

  return (
    <div className={stacked ? undefined : 'flex min-w-0 flex-wrap items-baseline gap-x-1.5'}>
      {/*
        Subordinate to the ticker, and inked.

        This was 44px in amber, which made it the largest and loudest thing on
        the page -- larger than the object it describes. Ideas' system file
        names that exactly: "a 26px +8% is a consumer app's hero stat", and a
        card that leads with a percentage instead of a name is a statistic
        rather than an investment object.

        The tone survives for a genuine break, where the number IS the
        finding. `review` does not qualify: a thesis due for review is a fact
        about the calendar, and painting its weight amber says the position is
        wrong when nobody has claimed that.
      */}
      <div className="flex items-baseline gap-1">
        <span className={clsx(
          'font-mono font-semibold leading-[0.95] tabular-nums tracking-[-0.03em]',
          figureSize,
          tone === 'critical'
            ? 'text-rose-700 dark:text-rose-400'
            : 'text-gray-900 dark:text-gray-100',
        )}>
          {figure}
        </span>
        {unit && <span className={clsx('font-semibold text-gray-500', unitSize)}>{unit}</span>}
      </div>
      <div className={clsx(
        'leading-snug text-gray-600 dark:text-gray-400',
        labelSize,
        stacked && 'mt-1',
      )}>
        {label}
      </div>
    </div>
  )
}

/** Why it matters. Two lines at most — the workspace carries the rest. */
export function TileReason({ children }: { children: React.ReactNode }) {
  return (
    <p className="line-clamp-2 text-[11px] leading-snug text-gray-700 dark:text-gray-300">
      {children}
    </p>
  )
}

/**
 * The claim itself, set as the centre of the tile.
 *
 * `TileReason` is a caption -- one system-generated sentence explaining why an
 * object surfaced. This is different: it is what a person actually wrote, and
 * on a tile whose whole content is a belief it should be the largest thing
 * there, ahead of every pill and count around it.
 */
export function TileClaim({
  children, size = 'compact',
}: { children: React.ReactNode; size?: TileSize }) {
  return (
    <p className={clsx(
      'text-gray-900 dark:text-gray-100',
      /*
       * ── The clamp was written for a thesis and is used by a finding ──────
       *
       * This ladder allowed 5 lines at hero and 4 at large. At 17px/1.5 that
       * is 127px of a single sentence, and the primitive had no callers when
       * it was written, so nothing had ever tested it.
       *
       * Its first real caller is Explore's finding sentence, which is one
       * clause -- "Not held, and trading below every case the desk wrote" --
       * except where the adapter hands over a news headline, and those run
       * long: "Stock Market Today, Nov. 2: CoreWeave Slides on Debt Concerns
       * After CrowdStrike Partnership" is four lines at 15px in a span-4
       * cell.
       *
       * Measured on the live field when this replaced the 11px caption: large
       * tiles went p50 291 -> 346 and the field's tallest tile 356 -> 392.
       * 356 is not an arbitrary number -- it is where the heights landed
       * after the "way too big/tall" report, and the note above `.gallery-
       * region` records what buying it back cost. Giving a headline a fifth
       * line is not worth 36px on every card in its row, because the row
       * stretches to its tallest member.
       *
       * So the SIZE stays -- that was the whole point, the sentence was
       * whispered at 11px -- and the line budget comes down one step at each
       * rank. A sentence longer than that is the workspace's to show, one
       * press away, which is what every other clamp on this tile assumes.
       *
       * Leading drops to 1.45 with it: 1.5 is a reading measure for a
       * paragraph and this is three lines in a card.
       */
      /*
       * ── And the ladder's BOTTOM rung is the one that matters ────────────
       *
       * The step above raised the claim off an 11px caption. Measured on the
       * live field straight after, it had barely moved: 90 of 145 tiles are
       * `compact` and compact's rung is 12px, so 62% of the field changed by
       * ONE PIXEL. 40 more went to 13. Only the 18 large-and-up tiles got a
       * size a reader would notice, and the reader's words for the result
       * were that nothing looked different. They were right.
       *
       * The ladder was wrong for this because of what it was drawn for: a
       * long written thesis inside a small card, where 12px buys lines. A
       * finding is one clause and there is no trade to make -- at the width
       * these cells actually are, 15px fits it.
       *
       * The widths, measured in the 12-track field at 1920: a compact cell is
       * ~430px and a medium ~430px, which is wider than the phone this type
       * scale is cautious for. In the narrow rail every cell is 376px, and
       * 15px is what the prototype sets its own full-width tiles at. Neither
       * is tight.
       *
       * So the rungs compress: 17 for the one featured tile and 15 for
       * everything else, which is the prototype's own ladder rather than a
       * four-step descent to a caption. `compact` keeps the two-line clamp,
       * so it buys the size with ~6px of height and not with a third line.
       */
      size === 'hero' ? 'line-clamp-3 text-[17px] leading-[1.4]'
        : size === 'large' ? 'line-clamp-3 text-[16px] leading-[1.4]'
        : size === 'medium' ? 'line-clamp-3 text-[15px] leading-[1.4]'
        : 'line-clamp-2 text-[15px] leading-[1.4]',
    )}>
      {children}
    </p>
  )
}

/**
 * The figures that frame the finding, on one row, each under its own key.
 *
 * ── Why a row and not a pill ──────────────────────────────────────────────
 *
 * A finding is rarely one number. "Trading below every case" is three facts
 * standing together -- where it is, where the floor was, and the distance
 * between them -- and a reader checks the third against the first two. Put
 * one of them in the eyebrow as a pill and the other two nowhere, and the
 * tile states a conclusion the reader cannot audit.
 *
 * So: the figures sit together, below the claim they support, large enough to
 * read across a field, each with the small uppercase key that says what it
 * counts.
 *
 * ── The key was already there and already discarded ───────────────────────
 *
 * `ExploreItem.metric` has been `{ value, label, direction }` for as long as
 * it has existed. The tile rendered `metric.value` in a `TileFigure` on the
 * eyebrow and dropped `metric.label` on the floor, so a field of figures
 * carried no units: "14.2", "288", "+34%" with nothing saying of what, since
 * the eyebrow beside them was spent on the lens that raised the card. This
 * renders the pair.
 *
 * ── Takes a list, fed one ─────────────────────────────────────────────────
 *
 * The shape is plural because the finding is, and because the adapters are
 * where the other figures have to come from -- a bear case, a book weight, a
 * horizon. Today every caller has exactly one to give and passes one. Nothing
 * here invents a second: an absent figure is absent, and a tile with one fact
 * draws one fact rather than padding the row out to look fuller than the
 * record is.
 */
export function TileStats({
  stats, size = 'compact',
}: {
  stats: readonly { value: React.ReactNode; key: React.ReactNode; tone?: SemanticTone }[]
  size?: TileSize
}) {
  if (stats.length === 0) return null
  const big = size === 'hero' || size === 'large'
  return (
    <div
      data-testid="tile-stats"
      /* `gap-x-5` at the top of the ladder and `gap-x-4` below: the figures
         have to read as separate facts rather than one long number, and
         tabular digits sit tighter than the eye expects. Wraps, because three
         figures and a long key do not fit a compact cell on one line and the
         alternative is a horizontal scrollbar inside a card. */
      className={clsx('flex min-w-0 flex-wrap', big ? 'gap-x-5 gap-y-2' : 'gap-x-4 gap-y-1.5')}
    >
      {stats.map((s, i) => (
        <div key={i} className="min-w-0">
          <div className={clsx(
            /* Mono and tabular, which is the one place this product's figures
               have always been set -- the horizon chips and the axis labels
               already are. A proportional digit in a column of digits is what
               made "14.2 %" read with a space in it. */
            'font-mono font-bold leading-[1.15] tabular-nums tracking-[-0.02em]',
            big ? 'text-[19px]' : size === 'medium' ? 'text-[17px]' : 'text-[15px]',
            s.tone === 'critical'
              ? 'text-rose-700 dark:text-rose-400'
              : s.tone === 'info'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-gray-900 dark:text-gray-50',
          )}>
            {s.value}
          </div>
          <div className="mt-0.5 text-[9.5px] font-bold uppercase leading-tight tracking-[0.09em] text-gray-400 dark:text-gray-500">
            {s.key}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Someone's recorded words, quoted as words.
 *
 * Only ever for text a human wrote. A machine-generated string set in quotes
 * would claim an author it does not have -- the distinction Decisions V1
 * established, carried onto the tile.
 */
export function TileQuote({
  children, size = 'compact',
}: { children: React.ReactNode; size?: TileSize }) {
  return (
    <blockquote className={clsx(
      'border-l-[2.5px] border-gray-400 italic text-gray-900 dark:border-white/25 dark:text-gray-100',
      size === 'hero' ? 'line-clamp-6 pl-4 text-[17px] leading-[1.5]'
        : size === 'large' ? 'line-clamp-5 pl-3.5 text-[15px] leading-[1.5]'
        : size === 'medium' ? 'line-clamp-4 pl-3 text-[13px] leading-[1.5]'
        : 'line-clamp-3 pl-2.5 text-[12px] leading-[1.45]',
    )}>
      {children}
    </blockquote>
  )
}

/**
 * One figure large enough to read across the gallery, with what it counts.
 *
 * For tiles whose most useful fact is a quantity rather than a sentence -- how
 * much arrived, how long since anyone looked. The figure carries tone only
 * where the quantity itself is the problem.
 */
export function TileLead({
  figure, unit, label, tone = 'neutral',
}: {
  figure: React.ReactNode
  unit?: string
  label: React.ReactNode
  tone?: SemanticTone
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      {/* Tone only for a genuine break, exactly as `TileHeroNumber` does it.
          `review` is a fact about the calendar; colouring the quantity amber
          claims the quantity is wrong, which nobody has said. */}
      <span className={clsx(
        'font-mono text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
        tone === 'critical'
          ? 'text-rose-700 dark:text-rose-400'
          : 'text-gray-900 dark:text-gray-100',
      )}>
        {figure}
      </span>
      {unit && <span className="text-[11px] font-semibold text-gray-500">{unit}</span>}
      <span className="min-w-0 text-[11px] leading-tight text-gray-600 dark:text-gray-400">{label}</span>
    </div>
  )
}

/**
 * Which parts of a structure exist, and which do not.
 *
 * A presence strip, never a completion score: "3 of 5 sections" invites a
 * reader to finish a form, when the question is whether the case makes its
 * argument. Names the missing parts so the absence is specific.
 */
export function TileSections({ present, all }: { present: readonly string[]; all: readonly string[] }) {
  const have = new Set(present)
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1">
      {all.map(name => (
        <span
          key={name}
          className={clsx(
            'text-[10px] font-bold uppercase tracking-widest',
            have.has(name)
              ? 'text-gray-700 dark:text-gray-300'
              : 'text-gray-300 line-through decoration-1 dark:text-gray-600',
          )}
        >
          {name}
        </span>
      ))}
    </div>
  )
}

/** Muted context beneath the reason: a book, an actor, a date. */
export function TileMeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[10px] text-gray-500">
      {children}
    </div>
  )
}

/** Right-aligned figure in the eyebrow: a weight, an age, a value. */
export function TileFigure({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span
      /* Addressable because a lens may suppress it when the picture below
         already states the number, and "is the figure on the eyebrow" is
         otherwise indistinguishable from "is that string anywhere on the
         tile" -- which it is, on the picture, which is the whole point. */
      data-testid="tile-figure"
      className={clsx(
        'ml-auto shrink-0 font-mono text-[10px] tabular-nums',
        strong ? 'font-semibold text-gray-800 dark:text-gray-200' : 'text-gray-500',
      )}
    >
      {children}
    </span>
  )
}

/**
 * A compact visual, only where the data earns one.
 *
 * Kept short so a tile stays a tile. A surface that has nothing honest to draw
 * renders nothing here rather than a decorative sparkline.
 */
export function TileVisual({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto pt-1">{children}</div>
}

/**
 * A magnitude bar, scaled against the largest in view.
 *
 * Against the field rather than against 100, because a book of forty names
 * would otherwise draw forty indistinguishable slivers. The number is always
 * printed beside it: the bar is for comparison, the figure is the fact.
 */
export function TileBar({
  pct, max, label, tone = 'neutral', population,
}: {
  pct: number
  max?: number
  label: string
  tone?: 'neutral' | 'attention' | 'critical'
  /**
   * Every peer's weight, so the bar can draw a distribution instead of a
   * meter. Optional: without it this falls back to the single mark.
   */
  population?: number[]
}) {
  const ceiling = Math.max(max ?? 0, pct, 1)

  /*
   * ── Why this stopped being a progress bar ────────────────────────────────
   *
   * It filled to `pct / max`, where `max` is the largest position among the
   * peers on screen. For that largest position -- which is exactly the one a
   * reader is most likely to be looking at -- the bar is 100% full, every
   * time, and says nothing. Ideas had the identical defect and it was fixed
   * the same way: draw the population, and ink the one you are on.
   *
   * The shape carries three answers the bar could not: how big this stake is,
   * how big it is RELATIVE TO the rest, and whether the set is concentrated
   * or flat. A 7.4% top position among peers that decay to 0.3% is a
   * different fact from a 7.4% top position among peers that all sit above
   * 6%, and the bar drew both identically.
   *
   * Rounded pill fills go with it. A fat rounded bar is the most
   * consumer-looking mark a desk tool can carry, and it was reading as
   * progress toward a limit this product does not have -- there is no policy
   * or constraint table anywhere in the schema for it to be a fraction of.
   */
  /*
   * A distribution needs a population to be a distribution.
   *
   * With four members `flex-1` gives each bar a quarter of the tile and the
   * chart becomes four fat blocks -- less legible than the bar it replaced,
   * and claiming a shape that four numbers do not have. Below the threshold
   * this falls back to the single mark, which is an honest way to show one
   * value against one comparator.
   */
  /*
   * Ten, not eight. At eight the bars are an eighth of the tile each and the
   * chart reads as a row of blocks rather than a distribution; the fallback
   * single mark is the honest drawing of a small set.
   */
  const bars = (population?.length ?? 0) >= 10
    ? [...population!].sort((a, b) => b - a)
    : null
  // Ties are real (two 1.2% stakes), so the inked bar is the FIRST unclaimed
  // match rather than every bar of the same height.
  const mine = bars ? bars.findIndex(w => w === pct) : -1

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">{label}</span>
        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{pct.toFixed(1)}%</span>
      </div>

      {bars ? (
        // 56px, not 34: at 34 a 0.4% stake against a 7.4% ceiling was a single
        // pixel, which is a distribution nobody can read the bottom half of.
        <div className="mt-1.5 flex h-[56px] w-full items-end gap-px" data-testid="tile-population">
          {bars.map((w, i) => (
            <div
              key={i}
              data-mine={i === mine || undefined}
              className={clsx(
                // No width cap: the population threshold above already keeps
                // small sets out, and capping left a 22-name book clustered
                // in the first quarter of its own tile.
                'min-w-0 flex-1 rounded-t-[1px]',
                i === mine
                  ? tone === 'critical' ? 'bg-rose-600 dark:bg-rose-400'
                    : tone === 'attention' ? 'bg-amber-600 dark:bg-amber-400'
                    : 'bg-slate-900 dark:bg-white'
                  : 'bg-slate-300/90 dark:bg-white/20',
              )}
              // A floor of 2%: a tail position is still a position, and a bar
              // of zero height reads as a set that ends early.
              style={{ height: `${Math.max(2, (w / ceiling) * 100)}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="mt-1.5 h-[3px] w-full bg-gray-200 dark:bg-white/10">
          <div
            className={clsx(
              'h-full',
              tone === 'critical' ? 'bg-rose-600' : tone === 'attention' ? 'bg-amber-600' : 'bg-slate-900 dark:bg-white',
            )}
            style={{ width: `${Math.min(100, (pct / ceiling) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Spot against a two-or-more-rung ladder, at tile scale.
 *
 * The same claim the workspace's full scale makes, reduced to the one thing
 * worth seeing at a glance: whether spot sits inside the range the case
 * defined, or outside it. Renders nothing without a real range.
 */
export function TileScale({
  low, high, spot, outside,
}: { low: number; high: number; spot: number; outside: boolean }) {
  /*
   * The ladder reads, as it does on Ideas.
   *
   * A ladder IS a price axis: every x on it is a price, and "what would a 12%
   * drawdown put me at, and is that still inside what we underwrote" is the
   * question the picture exists to answer. Ideas' `RangeChart` was made
   * scrubbable for exactly that reason and this is the tile-sized version of
   * the same object, so it gets the same contract -- one piece of local
   * state, and the caption swapping in place so nothing moves.
   */
  const band = useRef<HTMLDivElement | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  if (!(high > low) || !(spot > 0)) return null
  const min = Math.min(low, spot), max = Math.max(high, spot)
  const pad = (max - min) * 0.1 || max * 0.05
  const lo = min - pad, hi = max + pad
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
          {scrub == null ? 'Spot vs case' : (
            <span className="font-mono tracking-normal normal-case text-gray-600 dark:text-gray-300">
              {scrub.toFixed(2)}{' '}
              {scrub < low ? 'below the case' : scrub > high ? 'above the case' : 'inside the case'}
            </span>
          )}
        </span>
        <span className={clsx(
          'ml-auto font-mono text-[10px] font-semibold',
          outside ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500',
        )}>
          {outside ? 'outside' : 'inside'}
        </span>
      </div>
      {/*
        The tile-scale version of the Ideas ladder, in the same language.

        It was a 4px rounded pill with a rounded marker riding it. Ideas'
        `RangeChart` draws the underwritten span as a band running bear to
        bull -- the left edge is the desk's downside case and the right its
        upside, so the gradient states the direction of the range rather than
        decorating it -- and marks today with a square-ended rule. Same claim,
        same drawing, one twelfth the height.
      */}
      <div
        ref={band}
        data-testid="tile-scale"
        className="relative mt-1 h-[14px] cursor-crosshair"
        onPointerMove={e => {
          if (e.pointerType !== 'mouse' || !band.current) return
          const r = band.current.getBoundingClientRect()
          // A zero-width rect is real -- measured before layout, or inside a
          // collapsed container -- and dividing by it printed "NaN".
          if (r.width <= 0) return
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          setScrub(lo + f * (hi - lo))
        }}
        onPointerLeave={() => setScrub(null)}
      >
        <div
          className="absolute inset-y-0 bg-gradient-to-r from-rose-500/[0.16] via-slate-400/[0.10] to-emerald-500/[0.16] dark:from-rose-400/[0.18] dark:via-white/[0.07] dark:to-emerald-400/[0.18]"
          style={{ left: `${at(low)}%`, width: `${Math.max(0, at(high) - at(low))}%` }}
        />
        <i className={clsx(
          'absolute inset-y-[-2px] w-[2px]',
          outside ? 'bg-rose-600' : 'bg-blue-600',
        )} style={{ left: `${at(spot)}%` }} />
        {scrub != null && (
          <span
            className="pointer-events-none absolute inset-y-[-3px] w-px bg-slate-900 dark:bg-white"
            style={{ left: `${at(scrub)}%` }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Today's price against a stated target, and the distance between them.
 *
 * Typographic rather than drawn: two prices and a percentage is the whole
 * fact, and a two-point chart would add pixels without adding information.
 * The distance is never graded -- a 40% gap to target is a statement about the
 * desk's own view, not about whether the idea is working.
 */
export function TileGap({ spot, target, label }: { spot: number; target: number; label: string }) {
  if (!(spot > 0) || !(target > 0)) return null
  const gap = ((target - spot) / spot) * 100
  return (
    <div>
      <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
      <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
        <span className="text-[13px] font-semibold">{spot.toFixed(2)}</span>
        <span className="text-[11px] text-gray-400">&rarr;</span>
        <span className="text-[13px] font-semibold">{target.toFixed(2)}</span>
        <span className="ml-auto text-[11px] font-semibold text-gray-600 dark:text-gray-400">
          {gap >= 0 ? '+' : ''}{gap.toFixed(0)}%
        </span>
      </div>
    </div>
  )
}

/**
 * A price path at small-tile scale, scrubbable, graded by direction.
 *
 * ── Why the small sizes get one at all ───────────────────────────────────
 *
 * Only Ideas drew a price below `large`. Research, Portfolio and Decisions
 * put a visual on hero and large and nothing underneath, and Today has no
 * price anywhere -- so a gallery scrolled into a run of tiles that were text
 * over text over text, each one repeating the same share-of-book percentage
 * the one above it had. "No variety among smaller cards" is the accurate
 * description of that, and the fix is not more captions: it is the one object
 * that differs per name.
 *
 * ── Why it is graded, when `TileSpark` was not ───────────────────────────
 *
 * The component this replaces drew a single slate ink on purpose, so a price
 * path could not be read as a verdict on a decision. That argument holds for
 * the DECISION and not for the PRICE: up and down are facts about the line, a
 * desk reads them instantly, and the ungraded version was read as "no signal"
 * rather than as neutrality. The percentage keeps its sign and the caption
 * keeps saying what it measures; the hue says only which way the price went.
 *
 * ── Axes at this size ────────────────────────────────────────────────────
 *
 * A 26px band cannot carry gridlines, so the axis is the high and low of the
 * window, printed once at the right where they cost no vertical room, and the
 * scrubbed value replaces them while a pointer is down the line. That is what
 * makes the amplitude readable -- the thing a bare sparkline withholds.
 */
export function TileSparkline({
  points, anchorISO = null, label, height = 26, compact = false,
}: {
  /** Dated closes, oldest first. Fewer than two and nothing renders. */
  points: { date: Date; value: number }[]
  /** Where the window starts, when the tile has a date worth measuring from. */
  anchorISO?: string | null
  /** What the line is of -- "Since the fill", "90 days". */
  label: string
  height?: number
  /** Drops the axis figures, for the smallest tiles. */
  compact?: boolean
}) {
  const [at, setAt] = useState<number | null>(null)

  /*
   * The shared slicer, not a local one.
   *
   * This computed its own window at first -- `findIndex(p => p >= anchor)`,
   * fall back to the whole series -- and reproduced the exact bug
   * `anchoredWindow` had just been fixed for. When every close POST-dates the
   * anchor, `findIndex` returns 0, so a two-day line read as "since the fill"
   * about a fill from ten days back. The series has to START at or before the
   * anchor to cover it, and that rule now has one home.
   */
  const w = windowOverCloses(points, anchorISO) ?? windowOverCloses(points, null)
  if (!w) return null
  const reaches = w.reachesAnchor
  const values = w.series
  /* The dates behind the window, for the axis. `from`/`to` come back with it
     rather than being re-derived here, for the same reason. */
  const series = points.slice(points.length - values.length)
  const W = 200
  const H = height
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = (max - min) || 1
  const x = (i: number) => (i * W) / (values.length - 1)
  const y = (v: number) => 2 + (H - 4) * (1 - (v - min) / span)
  const d = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L')

  const change = ((values[values.length - 1] - values[0]) / values[0]) * 100
  const up = change >= 0
  const stroke = up ? 'stroke-emerald-600 dark:stroke-emerald-400' : 'stroke-rose-600 dark:stroke-rose-400'
  const fill = up ? 'fill-emerald-500' : 'fill-rose-500'
  const ink = up ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'

  const cursor = at == null ? null : Math.max(0, Math.min(values.length - 1, at))
  const shown = cursor == null ? change : ((values[cursor] - values[0]) / values[0]) * 100
  const money = (v: number) => v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)

  return (
    <div data-testid="tile-sparkline" data-reaches={reaches ? 'true' : 'false'} data-no-portal>
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[9px] font-semibold uppercase tracking-widest text-gray-500">
          {reaches ? label : 'Price history'}
        </span>
        <span className={clsx('ml-auto shrink-0 font-mono text-[11px] font-semibold tabular-nums', ink)}>
          {shown >= 0 ? '+' : ''}{shown.toFixed(1)}%
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          className="mt-0.5 w-full cursor-crosshair" style={{ height: H }}
          role="img"
          aria-label={`${label}, ${money(values[0])} to ${money(values[values.length - 1])}, ${change.toFixed(1)} percent`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            if (r.width <= 0) return
            setAt(Math.round(((e.clientX - r.left) / r.width) * (values.length - 1)))
          }}
          onPointerLeave={() => setAt(null)}
        >
          <path d={`M${d} L${W},${H} L0,${H} Z`} className={clsx(fill, 'opacity-[0.10]')} />
          <path d={`M${d}`} fill="none" strokeWidth={1.4} strokeLinejoin="round" className={stroke} />
          {cursor != null && (
            <line x1={x(cursor)} y1={0} x2={x(cursor)} y2={H} strokeWidth={1}
                  className="stroke-gray-400 opacity-60 dark:stroke-gray-500" />
          )}
        </svg>
        {/* The end of the line, round because it is HTML: the SVG above is
            stretched on one axis, which turns a circle into an ellipse. */}
        <span
          className={clsx(
            'pointer-events-none absolute right-0 h-[5px] w-[5px] -translate-y-1/2 translate-x-1/2 rounded-full',
            up ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-rose-600 dark:bg-rose-400',
          )}
          style={{ top: `${(y(values[values.length - 1]) / H) * 100}%` }}
          aria-hidden
        />
      </div>

      {/* The amplitude, which a bare sparkline withholds. Replaced by the
          scrubbed price while a pointer is on the line. */}
      {!compact && (
        <div className="mt-0.5 flex justify-between font-mono text-[8px] leading-none text-gray-400 dark:text-gray-500">
          {cursor == null ? (
            <>
              <span>{shortDay(series[0].date)}</span>
              <span>{money(min)} – {money(max)}</span>
            </>
          ) : (
            <>
              <span>{shortDay(series[cursor].date)}</span>
              <span className="text-gray-600 dark:text-gray-300">{money(values[cursor])}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Month and day, the only precision an axis this size can carry. */
function shortDay(d: Date) {
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * The case's age, and the evidence that arrived after it.
 *
 * ── Why this is shared, and why it is a timeline ─────────────────────────
 *
 * Written for Research, which asks where the case needs work. A price path
 * answers a different lens's question, and that scan deliberately never loads
 * one -- it reads timestamps and counts, and pulling a series per tile would
 * move megabytes to draw a line nobody came there for.
 *
 * It lives here because Portfolio asks the same question in different words:
 * "where this book and the written framework disagree" IS "how long has this
 * case been standing, and how much has landed since". Both lenses already
 * hold `thesisUpdatedAt`, the newest evidence date and the count between
 * them, and both were drawing three sentences of prose above eighty pixels
 * of nothing.
 *
 * What it does hold is exactly the shape of the problem: the date the case
 * was last written, the date the newest evidence landed, and how many items
 * arrived in between. That was three separate sentences of prose on a card
 * with three hundred pixels of nothing under them. As a line it is one
 * glance: how long the case has been standing, and how much of the window
 * since has produced work nobody has folded in.
 *
 * Same vocabulary as every other visual on the desktop -- an open ring for
 * where we started, a solid mark for the latest print, a shaded span for the
 * distance between them, and the window named underneath.
 */
export function TileTimeline({
  writtenAt, newestAt, count, startLabel = 'Case written',
}: {
  writtenAt: string | null; newestAt: string | null; count: number
  /** What the start date is, where a caller knows it is not a first write (e.g. "Case updated"). */
  startLabel?: string
}) {
  const track = useRef<HTMLDivElement | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const written = writtenAt ? new Date(writtenAt).getTime() : null
  if (!written || Number.isNaN(written)) return null
  const now = Date.now()
  const span = now - written
  // A case written today has no window to draw yet, and a zero-width span
  // would put both marks on top of each other at 0%.
  if (span < 86_400_000) return null

  /*
   * The track reads: pointing at it says which date that is and how long ago.
   *
   * "How long has this case been standing" is the question the line draws,
   * and the two labelled ends only answer it at the ends. Every x between
   * them is a date, exactly as every x on a ladder is a price.
   */
  const newest = newestAt ? new Date(newestAt).getTime() : null
  const at = newest && newest > written && newest <= now
    ? ((newest - written) / span) * 100
    : null
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

  return (
    <div>
      <div className="flex items-baseline justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>{startLabel}</span>
        <span className="font-mono tracking-normal normal-case text-gray-500">
          {pick != null
            ? `${day(pick)} · ${Math.max(0, Math.round((now - pick) / 86_400_000))}d ago`
            : count > 0 ? `${count} new since` : 'nothing new since'}
        </span>
      </div>

      <div
        ref={track}
        data-testid="tile-timeline"
        className="relative mt-2 h-[22px] w-full cursor-crosshair"
        onPointerMove={e => {
          if (e.pointerType !== 'mouse' || !track.current) return
          const r = track.current.getBoundingClientRect()
          if (r.width <= 0) return
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          setPick(written + f * span)
        }}
        onPointerLeave={() => setPick(null)}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200 dark:bg-white/10" />
        {pick != null && (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-slate-900 dark:bg-white"
            style={{ left: `${((pick - written) / span) * 100}%` }}
          />
        )}
        {/* The stretch that produced work the case has not answered. */}
        {at != null && count > 0 && (
          <div
            className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-amber-500/80 dark:bg-amber-400/70"
            style={{ left: 0, width: `${at}%` }}
          />
        )}
        {/* Where the case was written. */}
        <span
          className="absolute left-0 top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-slate-500 bg-white dark:border-slate-400 dark:bg-[#141a25]"
        />
        {/* The newest thing nobody has folded in. */}
        {at != null && (
          <span
            className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-600 ring-[2.5px] ring-white dark:bg-amber-400 dark:ring-[#141a25]"
            style={{ left: `${at}%` }}
          />
        )}
        {/* Today. A rule, because it is a boundary rather than an event. */}
        <span className="absolute right-0 top-1/2 h-[14px] w-[2px] -translate-y-1/2 bg-slate-400 dark:bg-slate-500" />
      </div>

      <div className="mt-1 flex items-baseline justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span className="font-mono tracking-normal normal-case">{day(written)}</span>
        {at != null && (
          <span className="font-mono tracking-normal normal-case text-amber-700 dark:text-amber-500">
            newest {day(newest!)}
          </span>
        )}
        <span className="font-mono tracking-normal normal-case">today</span>
      </div>
    </div>
  )
}
