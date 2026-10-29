/**
 * Desktop Ideas: the opportunity set, as a ranked heterogeneous grid.
 *
 * ── What this is, and what it is not ─────────────────────────────────────
 *
 * It is the dashboard counterpart to mobile Explore, reading the SAME
 * candidates: `useDesktopExplore` composes them through the mobile adapters
 * and ranks them with `diversifyExplore`, and `lib/desktop-ideas/opportunity`
 * narrows that to the subset carrying an investment question. No desktop
 * recommendation engine exists, and none is created here.
 *
 * It is not mobile's UI at desktop width. Mobile reads a feed -- one column,
 * one card at a time, scrolled. A desk with a monitor is comparing, so this is
 * a grid: the strongest candidate takes the hero, the next take large and
 * medium, and the tail runs compact. Same truth, different arrangement, which
 * is the whole reason the candidate layer is shared and the presentation is
 * not.
 *
 * ── Every card answers three questions ───────────────────────────────────
 *
 *   Why this name?   the kind chip and the title the adapter wrote
 *   Why now?         the context line, at rest on the shelf
 *   What next?       the verbs, on hover, from the shared resolver
 *
 * ── Generated opportunities do not masquerade as ideas ───────────────────
 *
 * An idea somebody wrote and a name Tesseract thinks is worth exploring are
 * different objects and are marked as such: the kind chip names what raised
 * the candidate, and a generated one never borrows the vocabulary of an
 * authored idea. Both belong in the lens; only one of them is somebody's
 * stated intent.
 */
import { useCallback, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason, TileFigure,
  TileAction, GallerySkeleton, type TileSize,
} from '../desktop/DesktopTile'
import { TilePriceChart } from '../desktop/TilePriceChart'
import {
  useGalleryCloses, useTileCloses, useYearRanges,
  type TileClose, type YearRange,
} from '../../hooks/useTileCloses'
import { ExploreVisualBlock } from '../mobile/ExploreVisual'
import { VisualPager } from '../desktop/VisualPager'
import {
  exploreVisualFor, visualRestatesContext, visualRestatesMetric,
} from '../../lib/mobile/explore-visual'
import { useDesktopExplore } from '../../hooks/useDesktopExplore'
import type { RailCard } from '../../lib/dashboard/focus'
import { coverageExplorePrompts } from '../../lib/desktop-ideas/coverage-prompts'
import type { CoverageResearchCandidate } from '../../lib/research/coverage-research-gaps'
import {
  opportunitiesFrom, opportunitySize, withFeatureBudget, targetForOpportunity,
  OPPORTUNITY_LABEL, type Opportunity,
} from '../../lib/desktop-ideas/opportunity'
import { askAI, canDiscuss, discuss } from '../../lib/engagement'
import type { SemanticTone } from '../../lib/semantic-tone'

/**
 * Tone carries CONDITION, never the kind of candidate.
 *
 * A price move is not a problem and a missing thesis is not an emergency;
 * what earns ink is the adapter's own `positive === false`, which is the one
 * place a producer has said something is going against the desk.
 */
function toneFor(o: Opportunity): SemanticTone {
  if (o.item.positive === false) return 'review'
  return 'neutral'
}

/* One frozen empty set, so a lens that passes nothing does not hand the
   supplier a new object every render and re-rank the field. */
const EMPTY_IDS: ReadonlySet<string> = new Set()

export function OpportunityGrid({
  onOpen,
  excludeAssetIds,
  coverageCandidates,
  extraMissing,
}: {
  /**
   * The shell owns navigation; this hands back the item that was chosen and
   * the population it came out of.
   *
   * The rail is supplied here because only this component knows the peer set:
   * it composes and ranks the candidates, and the deck needs the WHOLE
   * population in the field's own order so a card re-enters the rail when the
   * reader rotates away from it.
   */
  onOpen: (o: Opportunity, rail: RailCard[]) => void
  /**
   * Every asset a real idea already concerns, so a prompt never suggests
   * starting work that exists.
   *
   * Supplied by the lens rather than read here, because it must include ideas
   * the FIELD does not show -- a graduated pilot's seeded demo rows are hidden
   * and still count. Only the workspace knows that set.
   */
  excludeAssetIds?: ReadonlySet<string>
  /** Told, not discovered: the lens owns the coverage query. */
  coverageCandidates?: readonly CoverageResearchCandidate[]
  /**
   * Producers the caller knows are not answering.
   *
   * Named beside this grid's own gaps rather than swallowed. A failed coverage
   * scan costs the prompts that top up a thin field; it does not empty the
   * lens, and it must not be reported as though it had -- but it must be
   * reported.
   */
  extraMissing?: readonly string[]
}) {
  /*
   * Coverage prompts, composed with the producers rather than after them.
   *
   * `coverageExplorePrompts` applies the same `selectCoverageWork` with the
   * same caps and the same exclusion set the authored field used, so every
   * safety rule survives the change of shape -- and `useDesktopExplore` admits
   * them to `base`, so `diversifyExplore` ranks them against everything else
   * instead of appending a second section.
   */
  const extra = useCallback(
    (realCount: number) => coverageExplorePrompts(coverageCandidates ?? [], {
      realCount,
      ideaAssetIds: excludeAssetIds ?? EMPTY_IDS,
    }),
    [coverageCandidates, excludeAssetIds],
  )

  const { items, isLoading, missing: ownMissing } = useDesktopExplore({ extra })

  /* This grid's gaps and the caller's, in one list. A producer with no data is
     a gap to report, wherever it was noticed. */
  const missing = useMemo(
    () => [...ownMissing, ...(extraMissing ?? [])],
    [ownMissing, extraMissing],
  )

  const opportunities = useMemo(() => opportunitiesFrom(items), [items])

  /* Sized by each candidate's own content, then trimmed by the page's emphasis
     budget -- so wide cards fall where the content is rather than all at the
     top, and the page still cannot spend emphasis until it means nothing. */
  const sizes = useMemo(
    () => withFeatureBudget(opportunities.map(opportunitySize)),
    [opportunities],
  )

  /* Every tile's price in ONE batched read, rather than one request per tile
     resolving on its own schedule and reflowing its card when it lands. */
  const closes = useGalleryCloses(useMemo(
    () => opportunities.map(o => o.item.symbol),
    [opportunities],
  ))

  /* The trailing year, for the scenario cards ONLY.
   *
   * A year is twice the sparklines' window and the chunk size is
   * `floor(1000 / days)` by construction, so asking the whole field for one
   * would take it from ~12 requests to ~28. Measured on the live field, 5 of
   * 56 tiles draw a range -- which is three requests. */
  const yearRanges = useYearRanges(useMemo(
    () => opportunities
      .filter(o => exploreVisualFor(o.item)?.kind === 'scenario_range')
      .map(o => o.item.symbol),
    [opportunities],
  ))

  /*
   * The peer population for the deck's rail, in the field's own order.
   *
   * Every value is a fact the producer already set. `reason` is the kind chip
   * rather than the headline, because the rail's job is to say what SORT of
   * thing each neighbour is -- ten clamped headlines are ten paragraphs, which
   * is the problem the rail's own notes describe.
   */
  const rail = useMemo<RailCard[]>(() => opportunities
    .filter(o => !!o.item.assetId)
    .map(o => ({
      id: o.item.assetId!,
      workspaceLens: 'research' as const,
      objectType: 'asset' as const,
      symbol: o.item.symbol ?? null,
      reason: OPPORTUNITY_LABEL[o.kind],
      tone: o.item.positive === false ? ('review' as const) : ('neutral' as const),
      figure: o.item.metric?.value ?? null,
      figureLabel: o.item.metric?.label ?? null,
      detail: o.item.title ?? null,
    })), [opportunities])

  /*
   * ── The skeleton sizes by INDEX, never by content ─────────────────────────
   *
   * This branch used to call `opportunitySize` with a hand-built stand-in:
   *
   *     opportunitySize({ composed: { emphasis: 'standard' } } as Opportunity, i)
   *
   * `Opportunity` requires `item`, and that literal has none. `opportunitySize`
   * returns 'hero' for index 0 without looking, then reads `o.item` for every
   * index after it — so the first placeholder rendered and the second threw
   * `Cannot read properties of undefined (reading 'subtype')`, taking the whole
   * app to its error boundary. The `as Opportunity` cast is what let it compile:
   * it asserted a contract the literal did not meet. (Reached from the Asset
   * Page: a History event drilling through to its idea mounts this grid cold,
   * so the skeleton always ran.)
   *
   * The stand-in could never have worked, because a skeleton has no content to
   * size by. `exploreCardSize` reads the ITEM; the one field the literal did
   * supply, `composed.emphasis`, is never consulted by it.
   *
   * So size by the only thing a placeholder actually knows — its index. That is
   * `GallerySkeleton`'s own default (`sizeByRank`), and it is what the two
   * sibling workspaces already do: Decisions passes `sizeByRecency`, Research
   * passes nothing at all. No stand-in object, nothing to go undefined.
   *
   * `flow="packed"` matches the loaded grid below, which also packs. The
   * skeleton defaulted to 'ranked' and therefore laid its placeholders out on a
   * different span table than the grid replacing them — a re-layout on load,
   * which is the one thing this skeleton exists to avoid.
   */
  /*
   * ── Wait for the WHOLE field, not the first producer ──────────────────────
   *
   * This read `isLoading && opportunities.length === 0`, and the second clause
   * cancelled the first.
   *
   * `useDesktopCandidates` already latches `isLoading` true until all four
   * producers have finished their first attempt, for exactly this reason — its
   * own note calls a shuffling feed "the hitch". But the post half resolves
   * first, so `opportunities.length` was 54 while `isLoading` was still true,
   * the skeleton left early, and the partial field painted as though it were
   * the whole field.
   *
   * It then reshuffled three more times — measured on a cold load at 1920x889,
   * tile count 54 -> 64 -> 69 -> 90 over 4.9s, CLS 0.4233 (the "poor"
   * threshold is 0.25). The worst single shift was 0.282, and its sources show
   * why it is so violent: `opportunity-tile y772->263 h117->524`. A tile moved
   * 509px up the page and grew from 117px to 524px, because `opportunitySize`
   * sizes by CONTENT and `withFeatureBudget` then allocates emphasis across
   * the whole population. Grow that population and a compact becomes a hero.
   * Nothing loaded inside the tile; the page simply re-decided what mattered,
   * three times, under the reader's cursor.
   *
   * Honouring the latch alone costs the ~1.8s the slowest producer takes, and
   * the skeleton is already the real grid's span table, so that wait is a
   * steady page rather than a moving one. Research and Decisions have always
   * done it this way (`if (isLoading)`, no escape hatch) and both measure
   * CLS <= 0.0057.
   *
   * Safe against a producer that never returns: `isFetched` is true after
   * success OR error, so a failing optional producer cannot hold this shut —
   * it reports itself through `missing` instead.
   */
  /*
   * One gate over both reads, not a field that assembles in two phases.
   *
   * The candidates and the closes arrive on different schedules, and the
   * closes are what turn a tile from one panel into two -- which changes its
   * height and moves every tile below it. Painting early is only a kindness
   * if what is painted then stays put, and it did not: measured at 1920x889
   * over 56 tiles, the grid reflowed for seconds after it appeared.
   *
   * `closes.pending` is bounded: false the moment the query resolves OR
   * fails, and false immediately when there is nothing to fetch, so a
   * market-data outage cannot hold the field shut.
   */
  if (isLoading || closes.pending) {
    return (
      <GallerySkeleton
        title="Ideas"
        flow="packed"
        /*
         * This lens's own measured heights, at 1920x889 over 90 tiles:
         * the wide tiles (span 6 — hero and large) ran 436-524px with a
         * median of 461, and the narrow ones (span 3 — medium and compact)
         * were 202px almost exactly. The shared default claims 232/232/172/132,
         * so the first skeleton row was ~230px short and every row under it
         * started in the wrong place.
         *
         * Medians, not maxima: the aim is the least total movement, and
         * reserving 524 for every wide tile would overshoot most of them by
         * as much as the old numbers undershot.
         */
        heights={{
          hero: 'h-[460px]',
          large: 'h-[460px]',
          medium: 'h-[202px]',
          compact: 'h-[202px]',
        }}
      />
    )
  }

  /*
   * The field decides its own empty state.
   *
   * It used to be decided a level up, on a list of authored ideas this grid
   * does not read -- so a reader with no written ideas was told the lens was
   * empty while a full opportunity set sat here unrendered. The only list that
   * can answer "is there anything to show" is the one being shown.
   */
  if (opportunities.length === 0) {
    return (
      <DesktopGallery
        title="Ideas"
        note={
          <p className="max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
            Nothing to explore yet. Ideas appear as positions move, research
            lands, and names on your coverage go unexamined.
            {missing.length > 0 && ` Not yet reaching desktop: ${missing.join(', ')}.`}
          </p>
        }
      >
        {null}
      </DesktopGallery>
    )
  }

  return (
    <DesktopGallery
      title="Ideas"
      count={opportunities.length}
      /*
        Dense packing, allowed HERE and nowhere else.

        `diversifyExplore` ranks by interestingness, which is an ordering of
        emphasis rather than a promise that #7 matters less than #4 -- mobile's
        own packer already promotes within a lookahead for exactly this reason.
        So backfilling a short row with a later narrow card costs no meaning,
        and it closes the holes a 6-wide leaves when it cannot fit the tail of
        a row. Decisions, Portfolio and Research stay `ranked`: their order is
        a real ranking and reordering it would lie.
      */
      flow="packed"
      /* The note takes Research and Portfolio's measure and type. It was 11px
         grey-500 against their 12px grey-600 at a 74ch measure, so three
         lenses sharing one shell had three different sub-headings. */
      note={
        <p className="max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
          Where the next idea might come from — ranked, and mixed on purpose.
          {/* Named, not filled. A producer with no data is a gap to report
              rather than a hole to plug with a substitute. */}
          {missing.length > 0 && ` Not yet reaching desktop: ${missing.join(', ')}.`}
        </p>
      }
    >
      {opportunities.map((o, i) => (
        <OpportunityTile
          key={o.item.id}
          o={o}
          size={sizes[i]}
          closes={o.item.symbol ? closes.map.get(o.item.symbol) ?? [] : []}
          year={o.item.symbol ? yearRanges.get(o.item.symbol) ?? null : null}
          onOpen={() => onOpen(o, rail)}
        />
      ))}
    </DesktopGallery>
  )
}

/* Exported for `tile-carousel`, which renders it directly. The grid above it
   needs `useDesktopExplore` and the whole candidate pipeline to produce one
   tile, and the property under test -- that only one picture is mounted at a
   time -- is the tile's, not the field's. */
export function OpportunityTile({
  o, size, onOpen, closes: closesIn, year = null,
}: {
  o: Opportunity
  size: TileSize
  onOpen: () => void
  /** This symbol's closes from the field's one batched read. */
  closes?: TileClose[]
  /** Its trailing-year extremes, where the field fetched them. Scenario
   *  cards draw them; every other archetype ignores the prop. */
  year?: YearRange | null
}) {
  const item = o.item
  const big = size === 'hero' || size === 'large'

  /*
   * The three verbs the authored field had, restored on the shared shelf.
   *
   * They went missing when the old grid was removed: `IdeaCard` built its own
   * hover tray and called `askAI` / `discuss` through `targetFor`, and that
   * builder takes an `IdeaRow` a candidate cannot produce. `targetForOpportunity`
   * is the same seam for the other object, binding to the ASSET so a thread
   * raised here lands where a thread raised from the idea it becomes lands.
   *
   * Asked of the seam rather than assumed, exactly as `discussable` did: a
   * candidate the adapter could not resolve to an asset gets Open alone rather
   * than two buttons that would open nothing.
   */
  const target = useMemo(() => targetForOpportunity(o), [o])
  const canTalk = !!target && canDiscuss(target)

  /*
   * The situational object, from the shared resolver. One per card: mobile's
   * vocabulary already decides which single picture a candidate's facts
   * support, and `none` is a real answer it is allowed to give.
   */
  const visual = useMemo(() => exploreVisualFor(item as never), [item])

  /*
   * The price is ambient context, not the situational object -- so it may sit
   * alongside whatever the resolver chose. Same rule the other three lenses
   * settled on, and the same shared chart, so one name's price reads the same
   * everywhere on the dashboard.
   */
  /*
   * Handed down from the field, never fetched here.
   *
   * This called `useTileCloses(item.symbol)` -- one query PER TILE. Measured
   * at 1920x889 with 56 tiles that is 56 round trips, each asking for a
   * whole symbol's history, each resolving on its own schedule, and each
   * arrival turning its tile from one panel into two and so changing its
   * HEIGHT. The reader watched the grid reassemble under the cursor.
   *
   * `tile-carousel` renders this component directly, so the prop is
   * optional and falls back to the single-symbol hook: the test exercises
   * one tile, where there is no batch to belong to.
   */
  const solo = useTileCloses(closesIn ? null : item.symbol)
  const closes = closesIn ?? solo.data
  const hasCloses = (closes?.length ?? 0) >= 2

  /*
   * ── When the tape IS the finding, it is not ambient ──────────────────────
   *
   * `exploreVisualFor` returns `price_trend` only for the types whose claim
   * is the trajectory -- a target reached, an unusual move, an earnings
   * print. `ExploreVisualBlock` renders that kind by handing back whatever
   * sparkline the CALLER injected, and this caller injects none: the price
   * lives in its own panel here, drawn by the shared desktop chart.
   *
   * So the two rules disagreed and the tile lost both ways. The archetype
   * panel resolved to null, and `drawsPrice` was gated on `big` AND on the
   * kind NOT being `price_trend` -- which is exactly backwards, since
   * `price_trend` is the one kind that has asked for a chart by name.
   * Measured live at 1920x889: 2 of 90 tiles -- "AMZN passed its target" and
   * "AAPL passed its target" -- rendered an empty 0px box where their only
   * picture should have been.
   *
   * One rule now: the chart is drawn when the resolver asked for it, or when
   * a wide tile has the room to carry it as context beside the finding.
   */
  const priceIsTheFinding = visual?.kind === 'price_trend'
  /*
   * Every tile with a price can show it. Measured at 1920x889 over 56 tiles:
   * `|| big` meant FOUR of them had a second panel, so on 52 cards the
   * carousel did not exist and the price was unreachable without opening the
   * card. The gate was tile WIDTH, which is a layout fact, standing in for
   * "is there anything else worth seeing", which is a data fact -- and the
   * data was already fetched.
   *
   * A narrow tile gets a shorter plot (92px, below), not no plot.
   */
  const drawsPrice = hasCloses
  /* A compact tile asked for the tape still gets a readable plot and not a
     third of its own height: 150/120 were chosen for the wide tiles that
     carry the chart as a SECOND panel. */
  const chartHeight = size === 'hero' ? 150 : big ? 120 : 92
  /* The carousel's box, sized to the taller panel. The chart is it: the
     archetypes are a bar and two labels and none of them reaches 120px. The
     ladder, the plot and the caption are what `height` covers, plus the
     ~22px the horizon chips sit in above the plot. */
  const panelBox = chartHeight + 22

  /*
   * ── Not saying the same thing twice ──────────────────────────────────────
   *
   * Measured on this lens at 1920x889, 90 tiles: 38 of them printed some
   * string twice. 26 were a whole sentence, 13 a figure. Three causes, and
   * mobile had already solved two of them.
   *
   * `visualRestatesMetric` and `visualRestatesContext` are `explore-visual`'s
   * own tests, used by `MobileExplore` and `ExploreDetail` since the
   * archetypes landed. This grid was written without them, so AMZN printed
   * "+38%" in the eyebrow over a scenario bar captioned "+38% above your
   * range", and AAPL "+29%" over a last-look bar reading "+29% today". The
   * picture wins, as it does on mobile: it carries the number AND the shape
   * of it.
   *
   * The third was this file's own. `context` fell back to `item.title`, which
   * is the sentence `TileReason` prints two lines above it — so every
   * candidate whose producer supplies no separate context said its one
   * sentence twice, which is where 26 of the 38 came from. A tile with
   * nothing further to add now adds nothing.
   */
  /*
   * ── Two pictures, one at a time ──────────────────────────────────────────
   *
   * A wide tile could draw its archetype AND a price chart, stacked. On
   * AMZN that was a scenario bar, then a horizon ladder, then a 150px plot,
   * then a caption -- 524px of tile, and the reader has to scroll a grid of
   * ninety to get past one card. Measured: 4 of 90 tiles stacked two.
   *
   * Neither picture is droppable. The archetype is the finding ("the market
   * escaped your range") and the price is the evidence under it, and the
   * horizon ladder on the chart is the fast way to judge whether a move is
   * news -- so the fix is to page between them rather than to pick one. Same
   * resolution mobile reached for the pair-trade charts, and the same dots.
   *
   * The archetype leads because it is why the candidate was raised; the price
   * is ambient context a reader asks for second.
   */
  const panels = useMemo(() => {
    /* `label` is the spoken one ("the finding"), `tab` the word printed on
       the segment. A segment reading "the finding" is a sentence fragment in
       a control; "Finding" is a name. */
    const out: { key: string; label: string; tab: string; node: React.ReactNode }[] = []
    /* `price_trend` is excluded here, not absent: the resolver DID choose a
       picture for those cards, and it is the chart below rather than one of
       the bar archetypes. Pushing it here would push a null. */
    if (visual && visual.kind !== 'none' && !priceIsTheFinding) {
      out.push({
        key: visual.kind,
        label: 'the finding',
        tab: 'Finding',
        /* `tile`, because this is not a phone cell. The primitives were drawn
           against 178px and the gallery renders them at 421px narrow and
           881px wide, where a fixed-height track becomes a hairline and a
           two-ended label row becomes two captions in opposite corners. */
        /* `fill`: the grid stretches this tile to its row, the box above is
           `flex-1`, and the picture is the last link in that chain. Without
           it the archetype sits at its minimum in the middle of a box it was
           given room to grow into. */
        node: <ExploreVisualBlock visual={visual} now={Date.now()} density="tile" fill year={year} />,
      })
    }
    if (drawsPrice) {
      out.push({
        key: 'price',
        /* Named for the job it is doing on THIS card, because the dot's
           label is read aloud: on a card about a target being passed the
           chart is the finding, not the context beside it. */
        label: priceIsTheFinding ? 'the finding' : 'the price',
        tab: 'Price',
        node: <TilePriceChart points={closes!} fill height={chartHeight} />,
      })
    }
    return out
  }, [visual, drawsPrice, priceIsTheFinding, closes, chartHeight, year])

  const [panel, setPanel] = useState(0)
  /* Clamped rather than reset: `closes` arriving or failing changes the panel
     COUNT after the tile has painted, and an index past the end would blank
     the picture. Derived, so there is no effect to miss. */
  const shown = Math.min(panel, panels.length - 1)

  /* Suppressed only while the panel that states it is the one on screen. The
     carousel makes the picture conditional, and a rule written when the
     picture was always there would take AMZN's "+38%" off the eyebrow and
     then page away the bar that was carrying it, leaving the number nowhere. */
  const findingShown = panels[shown]?.key !== 'price'
  const metric = item.metric?.value
    && !(findingShown && visualRestatesMetric(visual, item.metric.value))
    ? item.metric
    : null
  const context = item.context && !visualRestatesContext(visual, item.context)
    ? item.context
    : null

  return (
    <DesktopTile
      testId="opportunity-tile"
      dataAttrs={{ 'data-kind': o.kind, 'data-subtype': item.subtype }}
      tone={toneFor(o)}
      size={size}
      onOpen={onOpen}
      eyebrow={<>
        {/* What raised this, in the shared vocabulary. A generated opportunity
            says so here rather than dressing itself as an authored idea. */}
        <TileState tone={toneFor(o)}>{OPPORTUNITY_LABEL[o.kind]}</TileState>
        {metric?.value && (
          <TileFigure strong={metric.direction === 'bad'}>
            {metric.value}
          </TileFigure>
        )}
      </>}
      context={context ? <span data-testid="opportunity-why">{context}</span> : undefined}
      actions={<>
        <TileAction label="Open" onClick={onOpen} primary testId="opportunity-open" />
        {target && (
          <TileAction label="Ask AI" onClick={() => askAI(target)} testId="opportunity-ai" />
        )}
        {canTalk && (
          <TileAction label="Discuss" onClick={() => discuss(target!)} testId="opportunity-discuss" />
        )}
      </>}
    >
      <TileIdentity
        symbol={item.symbol ?? null}
        name={item.companyName ?? null}
        size={size}
      />

      {/* The adapter's own sentence. Never re-derived here: the producer knows
          why it raised the candidate and this lens does not. */}
      <TileReason>{item.title}</TileReason>

      {panels.length > 0 && (
        /* `flex-1` and `min-h-0`: the picture is what takes a row's spare
           height. The grid stretches tiles to the tallest in the row again,
           and this is the element that wants the difference -- everything
           above it (identity, the reason sentence) is as tall as its text and
           the pager below is fixed. Without `min-h-0` a flex child refuses to
           shrink past its content and the tile would overflow its row. */
        <div className={clsx('flex min-h-0 min-w-0 flex-1 flex-col', big ? 'mt-3' : 'mt-2')}>
          {/*
            One panel's worth of room, whichever panel is showing.

            The box is sized to the TALLEST panel rather than the current one,
            because a tile is as tall as its contents now -- so a panel change
            that changed the height would move every tile below it in the
            column. Paging a carousel is a read, and a read must not relayout
            the page. The cost is some empty room under the shorter panel,
            which is the right way round: the alternative is the grid jumping
            under the reader's cursor.
          */}
          <div
            /*
             * Centred, and a flex container rather than a block.
             *
             * The box is sized to the TALLEST panel, and every archetype but
             * the chart is a bar and two labels. On AMZN that was 64px of
             * picture in a 172px box, top-aligned -- 108px of void, 63% of
             * the box, under a hairline. Centring spends the difference
             * evenly instead of dumping it all below.
             *
             * This also retires the `flow-root` that used to be here. That
             * was containing the archetype's own `mt-2`, which collapsed
             * through a parent with no padding and made the finding panel sit
             * 8px lower than the price panel. At `tile` density the archetype
             * has no root margin at all -- the container's `mt-2`/`mt-3`
             * above is the gap -- so there is nothing left to collapse, and a
             * flex parent would not collapse it anyway.
             */
            /* A FLOOR, not a height.
             *
             * `panelBox` still sizes the box to the tallest panel, so paging
             * the carousel never relayouts the page -- that part was right
             * and the reason is above. But it was an exact `height`, and an
             * exact height cannot grow, so a tile stretched to a tall
             * neighbour put the difference under the picture instead of in
             * it. As `minHeight` on a `flex-1` box the floor still holds and
             * the ceiling is gone. */
            /* ── The panel is POSITIONED, so paging cannot resize anything ──
             *
             * `minHeight` floored the box but nothing capped it, and the
             * cap is the half that matters: the chart panel's caption and
             * horizon chips are intrinsically taller than the axis panel,
             * and every link in the chain above is content-sized -- the box
             * feeds the wrapper, the wrapper the column, the column the
             * tile, and `gridAutoRows: minmax(88px, auto)` sizes the ROW to
             * its tallest member. So paging to Price grew the card AND
             * every card beside it.
             *
             * Measured by paging all 45 carousels: the card grew 39px on
             * four, 5px on three more, and the page grew with it each time.
             * A read must not relayout the field under the cursor.
             *
             * `overflow-hidden` did not fix it, and the reason is worth
             * keeping: clipping governs painting, not intrinsic sizing. The
             * child still contributed its height to the measurement.
             *
             * Taking the panel out of flow does fix it. The box's own
             * intrinsic height is then `minHeight` and nothing else --
             * identical for every panel -- while `flex-1` still lets the
             * row hand it more. Both panels already fill a box they are
             * given: the chart measures its own in `fill` mode and the axis
             * is a flex column over a 30px floor. */
            className="relative flex min-h-0 min-w-0 flex-1 flex-col"
            style={{ minHeight: panels.length > 1 ? panelBox : undefined }}
            data-testid="opportunity-visual"
            data-panel={panels[shown].key}
          >
            <div className="absolute inset-0 flex min-h-0 flex-col justify-center overflow-hidden">
              {panels[shown].node}
            </div>
          </div>

          {/*
            Today's pager, not mobile's dots.

            The dots were two 4px circles under the picture -- the same
            component the phone's pair-trade charts page with, which is right
            on a surface you swipe. On a desktop field of fifty-six cards a
            reader cannot tell they are there, let alone that they are
            pressable, and the carousel went unused. The shared control names
            each panel and shows arrows either side.

            `portalClick` already lets a <button> through without reading it
            as "open this tile", so the segments do not open the card.
          */}
          {/* `ml-auto`: Today's sits at the RIGHT end of the row under its
              picture (`ml-auto` beside the "See the full chart" portal), and
              this one sat at the left end of its own row. Same control, same
              gesture, two places to look for it. The column's cross axis is
              horizontal, so an auto left margin pushes it to the end. */}
          <VisualPager
            className="mt-1.5 ml-auto"
            labels={panels.map(p => p.tab)}
            keys={panels.map(p => p.key)}
            index={shown}
            onChange={setPanel}
            describe={i => `Show ${panels[i].label}`}
          />
        </div>
      )}
    </DesktopTile>
  )
}
