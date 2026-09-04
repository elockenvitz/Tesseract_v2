import { useEffect, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, Users } from 'lucide-react'

import { CATEGORY_DOT, CATEGORY_LABEL, FEED_CATEGORIES, type FeedCategory } from '../../lib/mobile/feed-categories'
import { composeExplore } from '../../lib/mobile/explore-compose'
import {
  exploreVisualFor, visualRestatesContext, visualRestatesMetric,
} from '../../lib/mobile/explore-visual'
import { ExploreVisualBlock } from './ExploreVisual'
import {
  layoutExplore, type ExploreCardHeight, type PackedExploreCard,
} from '../../lib/mobile/explore-layout'
import { exploreAge, explorePreview } from '../../lib/mobile/explore-preview'
import { exploreSparkPlan } from '../../lib/mobile/explore-spark'
import { resolveExploreItem } from '../../lib/mobile/explore-resolve'
import type { ExploreItem } from '../../lib/mobile/explore-item'


/**
 * Explore: what might be interesting, as opposed to what deserves attention.
 *
 * ── Why this is a different component and not a Curate mode ───────────────
 *
 * Curate is a mandatory-snap feed of one-viewport decision cards with exactly
 * one vertical scroll owner. That architecture is load-bearing for it and
 * actively wrong here: a discovery surface wants many things visible at once,
 * and snapping past one tile at a time is the opposite of scanning.
 *
 * So Explore does not reuse `SignalCardSection`, does not sit inside a snap
 * container, and does not mount `SignalCardView`. It is an ordinary vertical
 * page with a two-column mosaic. Sharing the shell would have meant one of the
 * two modes fighting a layout built for the other, and the gesture architecture
 * leaking between them is precisely what Phase 8.1 spent its time separating.
 *
 * ── What tiles deliberately do not have ───────────────────────────────────
 *
 * No VerdictBar, no action bar, no interactive `PriceContext`, no vertical
 * scroller, no portfolio disclosure. A tile that can be answered is a Curate
 * card in a smaller font; a tile with an interactive chart competes with the
 * grid for the same horizontal gesture. Previews preview. Tapping one reaches
 * the rich surface, which already exists.
 *
 * ── One card system, three decisions, three files ─────────────────────────
 *
 * `explore-compose` says what is on the page and in what order. `explore-layout`
 * says how big each card is and which cards share a row. `explore-preview` says
 * what each card's lines read. This file renders the result and decides none of
 * it — which is the difference between a deliberate card system and unrelated
 * components that happen to share a CSS grid.
 */

interface MobileExploreProps {
  candidates: ExploreItem[]
  /**
   * Renders one tile's price path, given its symbol.
   *
   * Injected rather than imported, and that is load-bearing: the real one
   * reaches Supabase through `useSymbolHistory`, and this component is
   * rendered by the gallery, which has no Supabase env and throws at module
   * load if anything reaches it. Importing it directly took the gallery down
   * and hung the layout suite.
   *
   * Optional, so the gallery simply renders no sparklines — which is the right
   * fallback for a fixture harness that has no price data either.
   *
   * Draws its OWN height. The height used to be a fixed box in the tile,
   * reserved whenever an item had a symbol — and a symbol is not history. Only
   * the thing that fetches can know whether there is a line, so it owns the
   * space: no line, no box.
   */
  renderSparkline?: (
    symbol: string,
    opts: {
      feature: boolean
      form: 'primary' | 'edge' | 'inline'
      since: string | null
      sinceLabel: string | null
      fallback?: React.ReactNode
    },
  ) => React.ReactNode
  category: FeedCategory | null
  onCategoryChange: (c: FeedCategory | null) => void
  onOpen: (item: ExploreItem, el: HTMLElement) => void
  /** The id of the item whose sheet is open, so its tile can stand aside. */
  expandedId?: string | null
  /** Product telemetry only. Never investment audit history. */
  onTelemetry?: (event: string, payload: Record<string, unknown>) => void
  now?: number
}

const TONE: Record<string, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-gray-700 dark:text-gray-200',
}

/**
 * The three rhythm variants, as floors rather than fixed heights.
 *
 * ── Why a floor and not a height ──────────────────────────────────────────
 *
 * A fixed height crops, and a preview that crops its own headline is worse than
 * one that runs a line long. A floor does the thing the grid actually needed:
 * it stops a card with two short lines from collapsing to 90px beside a
 * neighbour at 190px, which is what made the mosaic look like unrelated
 * components rather than a system. The clamps in `explore-preview` bound the
 * other end, so a row lands in a narrow band instead of anywhere at all.
 *
 * Both halves of a row are `h-full`, so they are always exactly equal to each
 * other; these numbers are about the rhythm BETWEEN rows.
 *
 * ── Why an inline style and not a class ───────────────────────────────────
 *
 * `index.css` gives every `button` on a coarse pointer a 44px minimum through
 * `button:not(.no-touch-target)`, which is a compound selector and therefore
 * outranks a single Tailwind utility. A `min-h-[164px]` class on this element
 * computes to 44px and does nothing — measured, after the first version of this
 * shipped with an aggregate card at 90px in a grid whose other rows were 200.
 *
 * An inline style beats both without `!important` and without opting the card
 * out of a global accessibility floor it comfortably clears anyway.
 */
const HEIGHT: Record<ExploreCardHeight, number> = {
  /**
   * Lowered, because the floor was padding cards rather than pacing them.
   *
   * 132 was chosen to stop a one-line card collapsing beside a 190px
   * neighbour. It does that, and on the cards that genuinely have one line —
   * a macro headline, a task, a story with no metric — it also bought 40px of
   * nothing, which the old bottom-pinned footer then opened as a hole in the
   * middle of the card. Measured on the fixture: eight tiles carried a gap
   * wider than their own headline.
   *
   * A floor's job is to stop a collapse, not to reach a target height. These
   * are set just above the two-line-plus-source case, and the row's `h-full`
   * still equalises the pair — so the rhythm survives and the padding does not.
   */
  compact: 112,
  'compact-chart': 168,
  /**
   * Full width, one compact card deep.
   *
   * A standard card lays its text and its evidence side by side instead of
   * stacking them, so the row it spans is the thing that gives it room — not
   * the height. Set at the compact floor plus a line: enough for a headline
   * that no longer has to wrap four times, a supporting clause and a compact
   * semantic object, and materially shorter than the 148 a feature gets.
   */
  standard: 128,
  feature: 148,
  /** One line and an action. See `exploreCardHeight`. */
  banner: 86,
}

function Tile({
  card, onOpen, renderSparkline, now, filtered, hidden,
}: {
  card: PackedExploreCard
  /** The element is handed over so the caller can measure the transition. */
  onOpen: (i: ExploreItem, el: HTMLElement) => void
  /** True while this tile's sheet is open — see the `visibility` note below. */
  hidden?: boolean
  renderSparkline?: (
    symbol: string,
    opts: {
      feature: boolean
      form: 'primary' | 'edge' | 'inline'
      since: string | null
      sinceLabel: string | null
      fallback?: React.ReactNode
    },
  ) => React.ReactNode
  now: number
  /**
   * Whether the page is narrowed to one category.
   *
   * The card drops the two marks that only distinguish it FROM other
   * categories — the dot and the kind word — when the chip above already says
   * what every tile on screen is. Filtered News was five identical rectangles
   * each captioned NEWS under a grey dot, which is a legend for a set of one.
   */
  filtered: boolean
}) {
  const { entry, size, span, height } = card
  const { item } = entry
  const feature = size === 'feature'
  const when = exploreAge(item.occurredAt, now)
  const preview = explorePreview(item, size)

  /**
   * The weight, unless something above has already said it.
   *
   * Two guards, because the number can be pre-empted from either direction: the
   * metric may BE the weight, and the supporting line may name it in prose.
   * `explore-preview` has already removed a supporting line that only restated
   * the metric, so what reaches here is whatever survived that — and this
   * checks it again rather than assuming, since a context of "8.1% of Core
   * Equity" beside a metric of "$420" is not a restatement and still contains
   * the weight.
   */
  const weightPct = item.portfolio?.weightPct
  const weightText = weightPct != null ? `${weightPct.toFixed(1)}%` : null

  /** §11: a line where price is context for the finding, and nowhere else. */
  /**
   * The card's picture, chosen by what the item IS.
   *
   * This was `exploreChartEligible(item) && item.symbol` — a sparkline whenever
   * a ticker existed — which is why a missing-thesis card, a missing-target
   * card, a conviction mismatch, a scenario breach and a news story all drew
   * the same line. The archetype now comes from `exploreVisualFor`, and the
   * sparkline is one of ten rather than the default for anything nameable.
   */
  const visual = exploreVisualFor(item)

  /**
   * Whether this card gets a price line, and where it sits.
   *
   * The archetype has already decided the card's picture; this asks the much
   * narrower second question — see `explore-spark`. A card whose archetype
   * drew something never reaches an `edge` or `inline` plan, so two pictures
   * can never stack.
   */
  const spark = exploreSparkPlan(item, now)
  const sparkNode = spark.form !== 'none' && item.symbol && renderSparkline
    ? renderSparkline(item.symbol, {
        feature,
        form: spark.form,
        since: spark.since,
        sinceLabel: spark.sinceLabel,
        /**
         * The picture this line is replacing, where it is replacing one.
         * Rendered only if the cache has no series for the name — see
         * `TileSparkline.fallback`.
         */
        fallback: visual.kind === 'last_look'
          ? <ExploreVisualBlock visual={visual} now={now} />
          : undefined,
      })
    : null

  /** The archetype's own slot. `price_trend` renders the planned line. */
  const chart = visual.kind === 'price_trend' ? sparkNode : null

  /**
   * A stale-research card draws its real path INSTEAD of the schematic rail.
   *
   * The plan prefers the price path there (see `explore-spark`), so the rail
   * must not also render — two pictures of one window. It is handed to the
   * chart as a fallback instead, so a name with no cached closes keeps the
   * picture it has today and nothing is lost.
   */
  const sparkReplacesArchetype = spark.form === 'edge' && visual.kind === 'last_look'

  /**
   * What this card's tap actually does, asked of the one thing that knows.
   *
   * ── Why the tile resolves rather than infers ────────────────────────────
   *
   * The footer's "See all" was written as `item.subtype === 'aggregate'`, which
   * is a second copy of a rule that lives in `resolveExploreItem`. Two copies
   * of a routing rule is how Explore acquired its dead cards in the first
   * place: the grid learned that only aggregates filter, the resolver did not,
   * and the tiles in between stopped doing anything at all.
   *
   * So the card asks the resolver what will happen and labels itself from the
   * answer. There is no arrangement of this file in which the promise on the
   * card and the behaviour behind it disagree.
   */
  /**
   * The metric, unless the picture beneath it is already that number.
   *
   * `explore-preview` strips a supporting clause that restates the metric; it
   * cannot see the archetype, so the loudest duplication on the page survived
   * it — "22% BELOW BEAR" over a bar captioned "-22% below your lowest case",
   * "8.1% OF CORE EQUITY" over an exposure bar reading "8.1% of Core Equity".
   * The picture wins, because it carries the number AND the shape of it.
   */
  const metric = preview.metric && visualRestatesMetric(visual, preview.metric.value)
    ? undefined
    : preview.metric

  /**
   * And the supporting clause, on the cards whose picture IS that sentence.
   *
   * A position with no research reads "1.1% of Growth" as its clause and draws
   * an exposure bar captioned "1.1% of Growth". `explore-preview`'s rule
   * compares the clause against the metric, and this card has none — so the one
   * line it had to spare went on saying the picture out loud.
   */
  const secondary = visualRestatesContext(visual, preview.secondary)
    ? undefined
    : preview.secondary

  /**
   * A card with no picture is a KIND of card, not a card that is missing one.
   *
   * Eleven of twenty-two tiles draw nothing, because the rows behind them
   * genuinely carry nothing to draw — a headline somebody else wrote, a task
   * with a due date, a colleague's note. Given the same treatment as a card
   * whose chart happens to be absent, they read as failures to load.
   *
   * So they get the space the picture would have had, spent on the words: a
   * larger claim, and room for the supporting line to actually support it.
   * That is the whole of the "editorial" treatment — no ornament, no gradient,
   * no icon, nothing invented. Only the two things a text card has.
   */
  const textOnly = visual.kind === 'none'

  const action = resolveExploreItem(item)
  const hint = action.do === 'filter' ? 'See all' : action.do === 'article' ? 'Read' : null
  /**
   * A card that cannot answer is not drawn as a card that can.
   *
   * No adapter produces this today — it is the guard that keeps the invariant
   * true rather than a fix for a live defect. The alternative, a tile that
   * looks tappable and swallows the tap, is the exact failure this pass exists
   * to remove, and it should be impossible by construction rather than by
   * everybody remembering.
   */
  const inert = action.do === 'unsupported'

  /**
   * Three guards, because the weight can be pre-empted from three directions.
   *
   * The metric may BE the weight, the supporting line may name it in prose, and
   * — the one this was missing — the PICTURE may already be it. An `exposure`
   * bar's whole content is "3.2% of Vision Fund" at 17px, and printing "3.2%
   * weight" in the footer under it is the same number twice on a tile a hundred
   * and thirty pixels tall. The crowding card managed all three at once.
   */
  /**
   * The weight, unless something above has already said it.
   *
   * Four guards now, because the number can be pre-empted from four
   * directions: the metric may BE the weight, the supporting line may name it,
   * the picture may be an exposure bar whose whole content is it, and — the one
   * this was still missing — a COMPARISON bar whose first row is the position's
   * own weight. The AMZN card printed "14.2%" inside the bar and "14.2% weight"
   * in the footer forty pixels below it.
   *
   * `visualRestatesMetric` is the same test pass 1 built for the metric line,
   * pointed at the weight instead, so one rule covers every archetype that
   * prints a number rather than a list of the archetypes that do.
   */
  const showWeight = weightText != null
    && visual.kind !== 'exposure'
    && !visualRestatesMetric(visual, weightText)
    && !(secondary ?? '').includes(weightText)
    && !(metric?.value ?? '').includes(weightText)

  return (
    <button
      type="button"
      data-explore-tile={item.id}
      data-category={item.category}
      data-subtype={item.subtype}
      data-emphasis={entry.emphasis}
      data-explore-span={span}
      data-explore-height={height}
      data-symbol={item.symbol ?? ''}
      data-explore-inert={inert ? 'true' : undefined}
      disabled={inert}
      /**
       * Hidden, not unmounted, while its sheet is in flight.
       *
       * `visibility` rather than `display`: collapsing the grid cell would
       * move every row below it and the sheet would return to a rect that no
       * longer exists. Rather than opacity, which still paints — two copies of
       * one card is the duplicate flash the transition exists to avoid.
       */
      style={{ minHeight: HEIGHT[height], visibility: hidden ? 'hidden' : undefined }}
      onClick={e => onOpen(item, e.currentTarget)}
      className={clsx(
        // No internal scroller, ever. Content that does not fit is clamped and
        // the tap reaches the full version — recreating Phase 8.1's nested
        // scroll problem in a smaller grid would be the same defect, cheaper to
        // miss.
        //
        // `h-full` so a tile fills its grid cell: the grid is `auto-rows-min`,
        // so a row is as tall as its tallest member, and a shorter tile beside
        // it drew its border at its own content height and left a band of page
        // showing underneath.
        //
        // ONE space distributor, and it is the `flex-1` on the text group. This
        // was `justify-between` — which spreads slack between EVERY child —
        // over a sparkline and a footer that each also carried `mt-auto`, so a
        // tile with a short headline opened three separate gaps instead of one
        // band of breathing room.
        'group relative flex h-full w-full flex-col overflow-hidden rounded-xl border p-3 text-left',
        'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900',
        // §15: the whole card is the target, and it says so under a thumb. No
        // `Open` button — a preview with a call to action is a decision card.
        // The press feedback belongs only to a card that answers. A dead card
        // that still dips under the thumb is the most misleading state of all.
        !inert && 'transition-transform duration-100 active:scale-[0.985] active:border-gray-300',
        !inert && 'active:bg-gray-50 dark:active:border-gray-600 dark:active:bg-gray-800/60',
        inert && 'cursor-default opacity-70',
        // §19: a visible ring for keyboard and switch users, which `active:`
        // alone never gave them.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
        'dark:focus-visible:ring-offset-gray-950',
        // `col-span-full`, not `col-span-2`. In the single-column layout a
        // two-column span creates an IMPLICIT second column, which collapsed
        // the explicit one to 0px and left every tile row 18px wide — measured
        // at 320px, where the page then scrolled horizontally. Spanning "all
        // columns, however many there are" is what was meant either way.
        span === 'full' && 'col-span-full',
      )}
    >
      {/* ── Header: what it is, and when ──────────────────────────────────
          `min-w-0` on the row and `truncate` on the flexible child. Without
          both, a long ticker or source name sets the row's minimum width and
          the tile pushes past the column — which at 320px is a horizontally
          scrolling page rather than a clipped label. */}
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        {!filtered && (
          <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', CATEGORY_DOT[item.category])} aria-hidden />
        )}
        {/* The name first, because on a research desk it is what the eye goes
            to. `shrink-0`: a ticker is five characters and truncating it makes
            the card about nothing at all — the kind word beside it is the one
            that gives way when the cell is narrow. */}
        {item.symbol && (
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
            {item.symbol}
          </span>
        )}
        {/* And what sort of thing it is, in one word, on EVERY card.
            This slot used to hold the category and only when there was no
            ticker — so the cards that make up most of the page said nothing
            about their own kind except through a 6px dot. See
            `ExplorePreview.kind`. */}
        {/* Kept when the page is filtered only where it is still carrying
            something: an aggregate, which a category filter does not imply, and
            a card with no ticker, whose header would otherwise be an age
            floating alone against an empty row. */}
        {(!filtered || item.subtype === 'aggregate' || !item.symbol) && (
          <span
            data-explore-kind
            className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-gray-400"
          >
            {preview.kind}
          </span>
        )}
        {/* Secondary by design. Age is the last thing a reader needs from a
            preview and the first thing that competes with the ticker for the
            eye if it is given any weight at all. */}
        {when && (
          <span data-explore-age className="ml-auto shrink-0 text-[10px] font-medium tabular-nums text-gray-400">
            {when}
          </span>
        )}
      </div>

      {/* ── The claim, the number, the support ────────────────────────────
          Stacked from the top with the slack pooled below them, rather than
          centred: centring floated a two-line card's text into the middle of
          its cell, so the first line of every card in a row started at a
          different height and the grid lost its baseline. One band of slack, at
          the bottom, above the pinned group. */}
      {/* Content flows from the top and the slack falls to the BOTTOM.
          This was `flex-1`, which pooled every spare pixel into one band
          between the text and a bottom-pinned footer — so a card with a short
          headline opened a hole in its own middle, and a reader cannot tell a
          hole from a card that failed to load. On the fixture that was eight
          tiles, worst of all the two aggregates, which are full-width and had
          ~90px of nothing under a single line of text.
          Space below the last line reads as breathing room; the same space
          above it reads as a bug. */}
      <div className="flex min-h-0 flex-col">
        <p
          data-explore-headline
          className={clsx(
            // Bumped a point and a weight step. The claim is what a discovery
            // surface is for; it was set two points below the number that
            // supports it.
            'mt-1.5 font-bold tracking-[-0.01em] text-gray-900 dark:text-white',
            // §12: a feature earns a stronger voice, not just more room. One
            // step of size and a tighter leading is the whole difference —
            // anything more and the wide card reads as a Curate card that
            // wandered in, which is the mode boundary this page exists to hold.
            feature
              ? 'text-[17px] leading-[1.25]'
              // A text-only card spends the picture's space on the claim, and
              // the single-column layout at 320px has the width to carry it.
              // Both are deterministic CSS — no measurement, no reflow.
              : textOnly
                ? 'text-[15px] leading-[1.3] min-[340px]:text-[14px]'
                : 'text-[14px] leading-[1.3]',
            preview.headlineClamp === 2 ? 'line-clamp-2' : 'line-clamp-3',
          )}
        >
          {preview.headline}
        </p>

        {/* One number. Never invented to fill the slot — an item with nothing
            worth counting renders no metric line at all. */}
        {metric && (
          <p
            data-explore-metric
            className={clsx(
              // A step down from 17/20. The number was the loudest thing on
              // every card that had one — bold, coloured, four points above the
              // claim — so the eye landed on it first and the page read as a
              // scoreboard. It is the evidence for the headline, not the
              // headline, and it now sits just under it.
              'mt-1.5 truncate font-bold tabular-nums leading-none',
              feature ? 'text-[17px]' : 'text-[15px]',
              TONE[metric.direction ?? 'neutral'],
            )}
          >
            {metric.value}
            {metric.label && (
              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {metric.label}
              </span>
            )}
            {/* The line as punctuation on the number it corroborates —
                `+9.2% TODAY ~~~●`. Only where the plan asked for `inline`,
                which today is a story that states a market reaction. */}
            {spark.form === 'inline' && sparkNode}
          </p>
        )}

        {/* Where the underlying object stands — unless the rail below already
            shows it.
            ── The busiest tile on the page ────────────────────────────────
            The TGT proposal carried ten marks: eyebrow, ticker, age, headline,
            state, context, BUY chip, four-segment rail, active-stage label,
            author. Two of them said the same thing twice over — the state line
            read "BUY · DISCUSSING" above a chip reading BUY and a rail whose
            active segment is labelled DECIDING.
            The rail wins, because it shows the stage AND the ones either side
            of it, which a text line cannot. Explore is for discovery; the full
            proposal is what the tap reaches. */}
        {preview.state && visual.kind !== 'workflow' && (
          <p
            data-explore-state
            className="mt-1.5 truncate text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            {preview.state}
          </p>
        )}

        {/* At most one supporting clause, and never one that repeats the
            metric — `explore-preview` has already removed the restatement, so
            "14.2% POSITION" is followed by "Large Cap Growth" rather than by
            "14.2% in Large Cap Growth". */}
        {/* A summary says what it opens, right where it says what it counts.
            Its headline is one short line and its action is the whole of the
            rest of the card, so the two belong on the same baseline — floated
            to the bottom-right of a full-width tile they were separated by the
            emptiest band on the page. */}
        {item.subtype === 'aggregate' && hint && (
          <span
            data-explore-hint={hint.toLowerCase().replace(/\s+/g, '-')}
            className="mt-2 flex w-fit items-center gap-0.5 text-[11px] font-bold text-primary-600 dark:text-primary-400"
          >
            {hint} <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        )}

        {secondary && (
          <p
            data-explore-context
            className={clsx(
              'mt-1.5 text-[11px] leading-[1.4] text-gray-500 dark:text-gray-400',
              // The one line a text card has to make its case gets a third
              // line to do it in. A card with a picture keeps two, so the
              // picture is not pushed off its own baseline.
              textOnly ? 'line-clamp-3 text-[12px]' : 'line-clamp-2',
            )}
          >
            {secondary}
          </p>
        )}
      </div>

      {/* ── The bottom of the card: chart and attribution, pinned ─────────
          Charts land on a consistent baseline across a row this way, and this
          group is the tile's only claim on its slack. */}
      <div className="mt-2 shrink-0">
        {/* No reserved box. This used to be a fixed `h-12` around the chart,
            rendered whenever the item had a SYMBOL — but only 132 of the held
            names have price history, and the renderer draws nothing without it.
            So an item whose symbol had no history reserved 48px and filled it
            with nothing: an empty band, indistinguishable from a bug.
            A sparkline, not a chart: no press-and-hold, no scrub, no pointer
            handlers at all, so it cannot capture the drag the mosaic needs. */}
        {/* One block, whichever archetype it is. `none` renders nothing at all
            rather than an empty box — a clean text card beats a meaningless
            chart, and several types are better off as typography. */}
        {!sparkReplacesArchetype && (
          <ExploreVisualBlock visual={visual} sparkline={chart} now={now} />
        )}

        {/* ── The story's picture is gone, and nothing replaces it ────────
            It was an 80px `object-cover` crop of whatever the provider
            supplied: the same shape on every story, cropped past the point of
            being readable, and answering no question a reader has. Two
            different stories about the same name looked different only in
            their stock photography, which is the opposite of what Explore's
            visual language is for.

            Nothing takes the space, deliberately. The obvious candidate is the
            tape, and `explore-visual` excludes news from it on purpose and
            with a better argument than any I could make here: "a price line
            under them asserts the price explains them". A story's own
            substance is its headline and its source, so the space goes back to
            the grid — the tile is shorter, the mosaic is denser, and the words
            get to be the card. */}

        {/* The lower-edge line, for a card whose archetype drew nothing.
            These are the tiles the brief is about — the ones that resolved to
            metadata, a headline, grey copy and no picture at all. The plan
            only reaches `edge` when there is no other picture, so this can
            never sit under one. */}
        {spark.form === 'edge' && sparkNode}

        <div className="flex min-w-0 items-center gap-1.5 pt-2">
          {/* §7: the publisher is part of how a story is read, not a footnote
              on it — a headline with no visible source is a rumour. Sitting in
              the pinned group, it cannot be pushed off by a long headline
              however many lines the clamp allows. Rendered a shade stronger
              than the rest of this row for news, where it is the card's second
              most important fact after the headline itself. */}
          {preview.source && (
            <span
              data-explore-source
              className={clsx(
                'flex min-w-0 flex-1 items-center gap-1 text-[10px]',
                item.subtype === 'news'
                  ? 'font-semibold text-gray-500 dark:text-gray-400'
                  : 'font-medium text-gray-400',
              )}
            >
              {item.source?.kind === 'person' && <Users className="h-3 w-3 shrink-0" />}
              <span className="truncate">{preview.source}</span>
            </span>
          )}
          {/* Named, because a bare percentage under a price chart reads as a
              return. On a tile whose chart is a year of closes and whose metric
              may be "TODAY", an unlabelled `6.3%` is a third number in a third
              unit with nothing to say which. */}
          {showWeight && (
            <span
              data-explore-weight
              className="ml-auto shrink-0 text-[10px] font-semibold text-gray-400"
            >
              <span className="tabular-nums">{weightText}</span> weight
            </span>
          )}
          {/* What the tap does, where it is not the default.
              Read off the SAME resolver that carries the tap out, so the
              promise on the card and the behaviour behind it cannot drift —
              they are one function call apart. Focusing is the default and gets
              no label: every card opens, and printing "Open" twenty times is
              chrome. The two that leave the default get a word, because
              narrowing the grid and leaving for a publisher are both things a
              reader would want to know before spending the tap. */}
          {/* An aggregate carries its own affordance beside its headline —
              see below. Repeating it here floated it to the far corner of a
              full-width card with an empty band between the two. */}
          {hint && item.subtype !== 'aggregate' && (
            <span
              data-explore-hint={hint.toLowerCase().replace(/\s+/g, '-')}
              className="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-primary-600 dark:text-primary-400"
            >
              {hint} <ArrowUpRight className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function MobileExplore({
  candidates, category, onCategoryChange, onOpen, onTelemetry, renderSparkline,
  expandedId = null, now = Date.now(),
}: MobileExploreProps) {
  /**
   * Explore's own scroll position, kept across mode switches.
   *
   * Deliberately NOT shared with Curate. The two modes are different places and
   * a reader returning to Explore expects the mosaic where they left it, not
   * Curate's snap offset translated into a page offset — which is what one
   * shared value would give them.
   */
  const scrollRef = useRef<HTMLDivElement>(null)
  const savedTop = useRef(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = savedTop.current
    const onScroll = () => { savedTop.current = el.scrollTop }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  /**
   * The filter row's own scroll, so the selected chip is always reachable.
   *
   * §13: the bar scrolls, and a chip selected from a sheet — or restored with
   * the mode — could sit past the right edge with nothing to say the page was
   * filtered at all. Bringing it into view on change costs nothing and removes
   * the one state where the bar lies about what it is showing.
   *
   * ── Why this moves `scrollLeft` instead of calling `scrollIntoView` ───────
   *
   * `scrollIntoView` scrolls EVERY scrollable ancestor, not just the one the
   * element sits in, and `block: 'nearest'` does not opt out of that — it only
   * says how far to go once an ancestor has been judged to need scrolling. An
   * ancestor that has the bar entirely off-screen needs scrolling by that
   * definition, so this effect, which runs on mount, scrolled the whole page
   * down to the filter bar the moment Explore rendered. On the gallery page —
   * where Explore sits below the Curate feed — that dragged the feed off the
   * top of the screen and every gesture test landed on the ranking panel
   * instead of a card. In the app it is the same bug with less room to show
   * itself: the surface jumps to its filter row on entry.
   *
   * Moving the bar's own `scrollLeft` reaches exactly the scroller this is
   * about and cannot touch an ancestor. Measured from the two boxes rather
   * than `offsetLeft`, which is relative to the nearest positioned ancestor
   * and not necessarily the bar.
   */
  const filterRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bar = filterRef.current
    if (!bar) return
    const chip = bar.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!chip) return
    // jsdom has no layout, so every rect reads zero and neither branch is
    // taken — a purely cosmetic scroll must not take the component down in
    // the environment its content is tested in.
    const barBox = bar.getBoundingClientRect()
    const chipBox = chip.getBoundingClientRect()
    if (chipBox.left < barBox.left) bar.scrollLeft += chipBox.left - barBox.left
    else if (chipBox.right > barBox.right) bar.scrollLeft += chipBox.right - barBox.right
  }, [category])

  // Recomposed only when the inputs actually change. The composition is pure
  // and the page can hold sixty tiles, so doing this per render would be the
  // most expensive thing on the surface.
  const composed = useMemo(
    () => composeExplore(candidates, { now, category }),
    [candidates, category, now],
  )

  /**
   * Size and packing, from the composed page.
   *
   * Separate `useMemo` from the composition because they answer separate
   * questions and change on separate inputs — see `explore-layout`.
   */
  const cards = useMemo(() => layoutExplore(composed), [composed])

  const openedRef = useRef(false)
  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true
    onTelemetry?.('explore_opened', { items: composed.length })
  }, [composed.length, onTelemetry])

  const chip = (active: boolean) => clsx(
    // Content-driven width, one line, and a real tap target height.
    'h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-bold no-touch-target',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
    active
      // §13: the active chip stays visually dominant. Full contrast against a
      // muted rest, rather than two shades of grey.
      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Explore's taxonomy ───────────────────────────────────────────
          The canonical categories, from the shared module. Explore does not get
          its own words for the same objects — that divergence is exactly what
          Phase 8.1 collapsed.

          §14: this is a level BELOW the mode nav above it, and it should read
          that way. The border under the row is the divider between the two, and
          the row is tighter than the mode nav so the hierarchy is legible
          without a second rule. */}
      <div className="relative shrink-0">
        <div
          ref={filterRef}
          data-explore-filters
          className={clsx(
            'flex gap-1.5 overflow-x-auto overscroll-x-contain border-b border-gray-200 dark:border-gray-800',
            // Right padding beyond the gap, so the last chip is not flush
            // against the fade and the bar has somewhere to end.
            'px-3 py-2 pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          <button
            type="button"
            data-explore-category="all"
            aria-pressed={category === null}
            onClick={() => { onCategoryChange(null); onTelemetry?.('explore_category', { category: 'all' }) }}
            className={chip(category === null)}
          >
            All
          </button>
          {FEED_CATEGORIES.map(c => (
            <button
              key={c.key}
              type="button"
              data-explore-category={c.key}
              aria-pressed={category === c.key}
              onClick={() => { onCategoryChange(c.key); onTelemetry?.('explore_category', { category: c.key }) }}
              className={chip(category === c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {/* The affordance, made deliberate. A chip half-cut at the right edge
            does say the bar scrolls, and it also looks like a clipping bug; a
            short fade says the same thing on purpose. `pointer-events-none` so
            it never eats a tap meant for the chip beneath it, and it stops
            short of the border so the divider stays unbroken. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 bottom-px w-8 bg-gradient-to-l from-white to-transparent dark:from-gray-900"
        />
      </div>

      {/* An ordinary vertical page. No snap, no one-per-viewport, no nested
          scrollers below this element — the mosaic is the scroll owner and
          every tile is a fixed block inside it. */}
      <div
        ref={scrollRef}
        id="explore-scroll"
        data-explore-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
      >
        {cards.length === 0 ? (
          /**
           * Two empty states, because they are two different situations.
           *
           * One line covered both: "Nothing to explore in this category yet."
           * On an unfiltered page that sentence names a category the reader did
           * not choose, and in neither case does it say what would fill the
           * grid or offer the way out. A filtered dead end with no visible exit
           * is the one state where a discovery surface can trap somebody.
           */
          <div className="px-6 py-16 text-center" data-explore-empty={category ?? 'all'}>
            <p className="text-[14px] font-semibold text-gray-500 dark:text-gray-400">
              {category ? `No ${CATEGORY_LABEL[category].toLowerCase()} to explore yet` : 'Nothing to explore yet'}
            </p>
            <p className="mx-auto mt-1.5 max-w-[38ch] text-[12px] leading-[1.5] text-gray-400">
              {category
                ? 'Other categories may have something. Explore draws on the same material as Curate.'
                : 'Explore fills up as your team posts, your positions move and stories break on the names you follow.'}
            </p>
            {category && (
              <button
                type="button"
                data-explore-empty-clear
                onClick={() => onCategoryChange(null)}
                className="mt-4 h-9 rounded-full bg-gray-900 px-4 text-[12px] font-bold text-white dark:bg-white dark:text-gray-900"
              >
                Show everything
              </button>
            )}
          </div>
        ) : (
          // Two columns at phone widths, one only when the viewport genuinely
          // cannot carry two. `auto-rows-min` keeps rows at their content
          // height; `packExplore` has already guaranteed that no full-width
          // card lands on an odd column offset, which is what left half a row
          // of page showing beside the last compact card in a run.
          <div className="grid auto-rows-min grid-cols-1 gap-2.5 min-[340px]:grid-cols-2">
            {cards.map(card => (
              <Tile
                key={card.entry.item.id}
                card={card}
                now={now}
                filtered={category !== null}
                hidden={expandedId === card.entry.item.id}
                renderSparkline={renderSparkline}
                onOpen={(item, el) => {
                  onTelemetry?.('explore_item_opened', {
                    category: item.category, subtype: item.subtype,
                    symbol: item.symbol ?? null, item_id: item.id,
                  })
                  /**
                   * Only an AGGREGATE filters. Everything else opens.
                   *
                   * ── The conflation this fixes ─────────────────────────────
                   *
                   * `destination` was doing two jobs: deciding what a tap
                   * opens, and deciding where the explicit "Open AAPL" action
                   * goes. They are not the same question, and the adapters
                   * fall back to `{ kind: 'filter' }` whenever an item has no
                   * asset id — which is routine for a macro story, an
                   * unattributed template, an insight on a name that did not
                   * resolve.
                   *
                   * So tapping those tiles filtered Explore instead of opening
                   * them, even though each has a perfectly good Level-2 card.
                   * Reported as tiles that "just filter instead of bringing up
                   * the full tile".
                   *
                   * An aggregate is the one thing with genuinely no single
                   * card behind it — "5 new ideas" is a count, and narrowing
                   * to those five IS opening it. That behaviour is kept, and
                   * it is now keyed on what the item IS rather than on a
                   * fallback in its destination.
                   */
                  if (item.subtype === 'aggregate' && item.destination.kind === 'filter') {
                    onCategoryChange(item.destination.category)
                    return
                  }
                  onOpen(item, el)
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
