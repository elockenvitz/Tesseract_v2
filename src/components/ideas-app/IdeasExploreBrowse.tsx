import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Compass, X } from 'lucide-react'
import { GALLERY_GROUND } from '../../lib/ui/surface'
import { DesktopGallery, GallerySkeleton, type TileSize } from '../desktop/DesktopTile'
import { OpportunityTile } from '../ideas-v2/OpportunityGrid'
import type { TileClose, YearRange } from '../../hooks/useTileCloses'
import {
  opportunityKind, opportunitySize, withFeatureBudget, withRunRhythm, type Opportunity,
} from '../../lib/desktop-ideas/opportunity'
import { MAX_FEATURES } from '../../lib/mobile/explore-layout'
import { exploreVisualFor } from '../../lib/mobile/explore-visual'
import { CATEGORY_LABEL } from '../../lib/mobile/feed-categories'
import { useGalleryCloses, useYearRanges } from '../../hooks/useTileCloses'
import { useDesktopExplore } from '../../hooks/useDesktopExplore'
import type { ExploreOpen } from '../../lib/desktop-ideas/explore-open'
import type { ComposedExploreItem, ExploreItem } from '../../lib/mobile/explore-item'

/**
 * Explore, on desktop.
 *
 * ── Why this is not the feed in a grid ────────────────────────────────────
 *
 * `explore-compose` draws the line: Curate ranks by CONSEQUENCE, Explore ranks
 * by INTERESTINGNESS, and interestingness is not a total order. The
 * fourth-most-consequential scenario gap is not the fourth-most-interesting
 * thing on a desk — it is the fourth time the reader has been told the same
 * sort of news. `diversifyExplore` therefore scores, dedupes and then repels
 * neighbours of the same sort, which no re-sorting of the feed produces.
 *
 * ── It draws the lens tile, and that reverses a decision ──────────────────
 *
 * This surface used to render a tile of its own: one picture, a title, a
 * figure, a line of context, in a three-column grid of equal cells. The header
 * it replaces argued for that in as many words — "a preview is a preview" —
 * and the hierarchy it protected was `preview → investigate → richer object`.
 *
 * The argument was sound and the outcome was not. Explore and the Ideas lens
 * read the SAME candidates, through the same adapters, ranked by the same
 * ranker, and drew them two different ways: one as a flat shelf of previews,
 * the other as the dashboard's heterogeneous field of objects with a price
 * chart you can page to, hover verbs, and room allocated by what a candidate
 * has to show. A reader moving between the two tabs met two products, and the
 * richer one was not the one whose job is discovery.
 *
 * So the restraint moves from the TILE to the CONTENT, which is where it was
 * always doing the work. The adapters have not changed and nothing new is
 * derived here: a candidate with one sentence still shows one sentence, and
 * `opportunitySize` gives it a compact cell for exactly that reason. What it
 * gains is the picture it could already draw, the price it had already
 * fetched, and verbs it can be used from. `OpportunityTile` is that tile,
 * rendered directly rather than reimplemented, because a second tile for one
 * candidate shape is a second answer to how a candidate looks.
 *
 * ── What stays Explore's own ──────────────────────────────────────────────
 *
 * The candidate SET: this field admits every one, including the news stories
 * and the aggregate rows that `isIdeaWorthy` keeps out of the Ideas lens,
 * because breadth is the whole premise of the surface.
 *
 * The ROUTE grammar: `resolveExploreItem` already answers what a tile does —
 * focus, article, filter, navigate, or an honest "unsupported" for a kind
 * nobody has taught it about. Its own header explains why it reads the
 * DESTINATION rather than switching on type. Desktop does not get a second
 * grammar, so the resolver names each tile's verb and decides which tiles are
 * not controls at all.
 *
 * The CATEGORY state, deliberately separate from the Ideas type lens and from
 * Curate. Mobile keeps `exploreCategory` apart from `feedFilter` for the same
 * reason, and its note says folding them would make Explore look like a sixth
 * category.
 *
 * ── Columns from the region ───────────────────────────────────────────────
 *
 * `region` on the gallery, not the window breakpoints the four workspace
 * lenses use. The same 1920px window shows this field at full width and at
 * ~40rem beside an open asset workspace, and only the region's own width can
 * say how many columns fit. See `.gallery-region`.
 */

/** Explore's own verb for each thing the resolver can answer. */
/** How many tiles the emphasis budget is spent over before it resets. */
const FEATURE_WINDOW = 12
/** The longest run of identical cells before one is given a step more room. */
const MAX_RUN = 7

const VERB: Record<Exclude<ExploreOpen['do'], 'none'>, string> = {
  /* The workspace, the same place a feed card lands. */
  work: 'Open',
  /* A story, in the reader. Named differently because it IS different: a
     candidate whose destination is an article is not a name to work on. */
  article: 'Read',
  /* The one answer Explore owns. Narrowing the grid never leaves the surface,
     so the verb says what happens rather than borrowing "Open". */
  filter: 'Show these',
  /* A tab. The shell opens it; Explore does not try to embed it. */
  navigate: 'Open',
}

/**
 * A candidate, as the shared tile takes one.
 *
 * `Opportunity` is `{ composed, item, kind }` and `opportunityKind` is pure on
 * the item, so this is a restatement rather than a conversion. It deliberately
 * does NOT go through `opportunitiesFrom`: that narrows to the candidates
 * carrying an investment question and then spends a picture budget, both of
 * which are the Ideas lens deciding what belongs in a field of ideas. Explore
 * shows the field.
 */
function asOpportunity(composed: ComposedExploreItem): Opportunity {
  return { composed, item: composed.item, kind: opportunityKind(composed.item) }
}

export function IdeasExploreBrowse({ resolve, onOpen, selectedKey = null }: {
  /**
   * What a tile would do, asked at RENDER time as well as on click.
   *
   * Rendering needs the answer too: a preview with nothing behind it must not
   * be drawn as a control, and the verb printed on the one that does have
   * something behind it depends on where it goes. Asking the same function in
   * both places is what keeps the appearance and the behaviour from
   * disagreeing.
   */
  resolve: (item: ExploreItem) => ExploreOpen
  /** Everything Explore does not own itself. The shell carries it out. */
  onOpen: (open: Exclude<ExploreOpen, { do: 'filter' }>) => void
  /** Which tile the open workspace belongs to. */
  selectedKey?: string | null
}) {
  const [category, setCategory] = useState<string | null>(null)
  const { items, isLoading, missing } = useDesktopExplore()

  const shown = useMemo(
    () => (category ? items.filter(c => c.item.category === category) : items)
      .map(asOpportunity),
    [items, category],
  )

  /*
   * Sized by each candidate's own content, then trimmed by the page's emphasis
   * budget — the Ideas lens's rule, used rather than restated.
   *
   * It is also not a second rule for what leads. `composed.emphasis`, which
   * the old tile read, is itself set from `exploreCardSize` in
   * `explore-layout`, and `opportunitySize` reads that same function. One
   * decision, two spellings of it; this takes the one that also distinguishes
   * medium from compact.
   */
  /**
   * ── Explore is a FIELD, not a page ───────────────────────────────────────
   *
   * Both arguments below exist because of that, and neither is a taste
   * setting. Measured at 90 tiles before them: 75 `medium`, and past about
   * rank thirty an unbroken run of them, four to a row to the bottom.
   *
   * `FEATURE_WINDOW` makes the emphasis budget a rate instead of a total.
   * Spent once, it went entirely inside the first nine tiles and demoted
   * every feature after -- a budget shaped for a screenful, applied to a
   * scroll. Twelve is a window of about three rows at full width.
   *
   * `MAX_RUN` then breaks whatever wall survives that, which on a thin corpus
   * is most of the field: the material genuinely is repetitive, and the
   * layout's job is to stay readable rather than to pretend otherwise. Seven
   * is just under two rows of `medium`, so a run is broken before it reads as
   * a wall and not so often that the break stops meaning anything.
   *
   * Order is untouched by either. See `withFeatureBudget` and
   * `withRunRhythm`.
   */
  const sizes = useMemo(
    () => withRunRhythm(
      withFeatureBudget(shown.map(opportunitySize), MAX_FEATURES, FEATURE_WINDOW),
      MAX_RUN,
      /* A tile the resolver drew no picture for has nothing to put in the
         extra height, so the rhythm skips it and breaks the run on the next
         cell instead. The resolver's OWN answer decides this -- not a guess
         about the item -- so a producer that starts supplying a picture
         becomes promotable with no change here. */
      i => exploreVisualFor(shown[i].item as never)?.kind !== 'none',
    ),
    [shown],
  )

  /* Every tile's price in ONE batched read. The per-tile alternative is one
     request per card, each resolving on its own schedule and reflowing its
     card when it lands — measured on the Ideas field at 56 tiles. */
  const closes = useGalleryCloses(useMemo(() => shown.map(o => o.item.symbol), [shown]))

  /* The trailing year, for the scenario cards only: a year is twice the
     sparkline window, so asking the whole field for one multiplies the
     requests for a figure a handful of tiles draw. */
  const yearRanges = useYearRanges(useMemo(
    () => shown
      .filter(o => exploreVisualFor(o.item)?.kind === 'scenario_range')
      .map(o => o.item.symbol),
    [shown],
  ))

  /*
   * One gate over both reads, as the Ideas field does it.
   *
   * `useDesktopCandidates` already latches `isLoading` until every producer
   * has finished its first attempt, and the closes are what turn a tile from
   * one panel into two — which changes its height and moves every tile below
   * it. Painting early is only a kindness if what is painted then stays put.
   *
   * `closes.pending` is bounded: false the moment the query resolves OR
   * fails, and false immediately when there is nothing to fetch, so a
   * market-data outage cannot hold this shut.
   */
  if (isLoading || closes.pending) {
    return <GallerySkeleton title="Explore" flow="packed" region count={9} />
  }

  return (
    /*
     * The scroll host is the container query's subject, and it is also the one
     * element whose scrollTop must survive the workspace opening. Both follow
     * from the same fact: this element is never unmounted or replaced — only
     * its width changes — so the grid re-flows and the scroll does not move.
     */
    <div className={clsx('gallery-host h-full overflow-y-auto', GALLERY_GROUND)}>
      <DesktopGallery
        title="Explore"
        region
        /*
          Dense packing, which this lens is allowed and Decisions, Portfolio
          and Research are not. `diversifyExplore` ranks by interestingness,
          which is an ordering of emphasis rather than a promise that #7
          matters less than #4 — mobile's own packer already promotes within a
          lookahead for exactly that reason. So backfilling a short row with a
          later narrow card costs no meaning.
        */
        flow="packed"
        action={category ? (
          <button
            onClick={() => setCategory(null)}
            className="flex items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
            {CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL] ?? category}
          </button>
        ) : undefined}
        note={
          <p className="max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
            What is here that might be worth a look — mixed on purpose.
            {/* Named, not filled. A producer with no data is a gap to report
                rather than a hole to plug with a substitute. */}
            {missing.length > 0 && ` Not yet reaching desktop: ${missing.join(', ')}.`}
          </p>
        }
      >
        {shown.length === 0 ? (
          <div className="col-span-full py-16 text-center">
            <Compass className="mx-auto h-6 w-6 text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Nothing to explore here yet.
            </p>
          </div>
        ) : shown.map((o, i) => {
          const open = resolve(o.item)
          return (
            <ExploreTile
              key={o.item.id}
              o={o}
              size={sizes[i]}
              open={open}
              closes={o.item.symbol ? closes.map.get(o.item.symbol) ?? [] : []}
              year={o.item.symbol ? yearRanges.get(o.item.symbol) ?? null : null}
              selectedKey={selectedKey}
              onFilter={setCategory}
              onOpen={onOpen}
            />
          )
        })}
      </DesktopGallery>
    </div>
  )
}

function ExploreTile({
  o, size, open, closes, year, selectedKey, onFilter, onOpen,
}: {
  o: Opportunity
  size: TileSize
  open: ExploreOpen
  closes: TileClose[]
  year: YearRange | null
  selectedKey: string | null
  onFilter: (category: string) => void
  onOpen: (open: Exclude<ExploreOpen, { do: 'filter' }>) => void
}) {
  const selected = open.do === 'work' && selectedKey != null && open.selection.key === selectedKey

  return (
    <OpportunityTile
      o={o}
      size={size}
      closes={closes}
      year={year}
      /*
       * Explore's chip is the CATEGORY, not what raised the candidate.
       *
       * Not a cosmetic preference: the category is the facet this field
       * narrows on, so a chip naming anything else would label a thing the
       * reader cannot then ask for. `CATEGORY_LABEL` is the taxonomy's own
       * word, shared with Curate and with mobile.
       */
      label={CATEGORY_LABEL[o.item.category] ?? o.item.category}
      /*
       * A tile that cannot answer is not a control.
       *
       * Every tile used to be a `<button>`, including the ones whose action
       * was `unsupported` and the ones whose focus has nothing behind it — so
       * the surface offered a press, took it, and did nothing. The preview is
       * still worth reading, which is why it stays and only its interactivity
       * goes. `ExploreOpen` states this in the type: "Nothing to open. Said
       * out loud, and the tile must not look actionable."
       */
      inert={open.do === 'none'}
      primaryLabel={open.do === 'none' ? undefined : VERB[open.do]}
      /* Which tile the open workspace belongs to. The shared tile dropped its
         persistent ring because nothing sits beneath the four workspace
         galleries; something sits BESIDE this one. */
      selected={selected}
      onOpen={() => {
        // `filter` is the only answer this surface owns — narrowing the grid
        // never leaves Explore. Everything else is the shell's, which is what
        // stops Explore growing a second detail system beside the workspace.
        if (open.do === 'filter') { onFilter(open.category); return }
        if (open.do === 'none') return
        onOpen(open)
      }}
    />
  )
}
