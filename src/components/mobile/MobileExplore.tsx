import { useEffect, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, Users } from 'lucide-react'

import { CATEGORY_DOT, FEED_CATEGORIES, type FeedCategory } from '../../lib/mobile/feed-categories'
import { composeExplore } from '../../lib/mobile/explore-compose'
import {
  exploreChartEligible, layoutExplore, type ExploreCardHeight, type PackedExploreCard,
} from '../../lib/mobile/explore-layout'
import { exploreAge, explorePreview } from '../../lib/mobile/explore-preview'
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
  renderSparkline?: (symbol: string, opts: { feature: boolean }) => React.ReactNode
  category: FeedCategory | null
  onCategoryChange: (c: FeedCategory | null) => void
  onOpen: (item: ExploreItem) => void
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
  compact: 132,
  'compact-chart': 176,
  feature: 164,
}

function Tile({
  card, onOpen, renderSparkline, now,
}: {
  card: PackedExploreCard
  onOpen: (i: ExploreItem) => void
  renderSparkline?: (symbol: string, opts: { feature: boolean }) => React.ReactNode
  now: number
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
  const showWeight = weightText != null
    && !(preview.secondary ?? '').includes(weightText)
    && !(preview.metric?.value ?? '').includes(weightText)

  /** §11: a line where price is context for the finding, and nowhere else. */
  const chart = exploreChartEligible(item) && item.symbol && renderSparkline
    ? renderSparkline(item.symbol, { feature })
    : null

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
      onClick={() => onOpen(item)}
      style={{ minHeight: HEIGHT[height] }}
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
        'transition-transform duration-100 active:scale-[0.985] active:border-gray-300',
        'active:bg-gray-50 dark:active:border-gray-600 dark:active:bg-gray-800/60',
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
        <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', CATEGORY_DOT[item.category])} aria-hidden />
        {item.symbol ? (
          <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
            {item.symbol}
          </span>
        ) : (
          <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wide text-gray-400">
            {item.category}
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
      <div className="flex min-h-0 flex-1 flex-col">
        <p
          data-explore-headline
          className={clsx(
            'mt-1.5 font-semibold text-gray-900 dark:text-white',
            // §12: a feature earns a stronger voice, not just more room. One
            // step of size and a tighter leading is the whole difference —
            // anything more and the wide card reads as a Curate card that
            // wandered in, which is the mode boundary this page exists to hold.
            feature ? 'text-[15px] leading-[1.3]' : 'text-[13px] leading-[1.35]',
            preview.headlineClamp === 2 ? 'line-clamp-2' : 'line-clamp-3',
          )}
        >
          {preview.headline}
        </p>

        {/* One number. Never invented to fill the slot — an item with nothing
            worth counting renders no metric line at all. */}
        {preview.metric && (
          <p
            data-explore-metric
            className={clsx(
              'mt-1.5 truncate font-bold tabular-nums leading-none',
              feature ? 'text-[20px]' : 'text-[17px]',
              TONE[preview.metric.direction ?? 'neutral'],
            )}
          >
            {preview.metric.value}
            {preview.metric.label && (
              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {preview.metric.label}
              </span>
            )}
          </p>
        )}

        {/* Where the underlying object stands. Present on proposals, absent on
            everything else — see `ExploreItem.state`. */}
        {preview.state && (
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
        {preview.secondary && (
          <p
            data-explore-context
            className="mt-1.5 line-clamp-2 text-[11px] leading-[1.4] text-gray-500 dark:text-gray-400"
          >
            {preview.secondary}
          </p>
        )}
      </div>

      {/* ── The bottom of the card: chart and attribution, pinned ─────────
          Charts land on a consistent baseline across a row this way, and this
          group is the tile's only claim on its slack. */}
      <div className="shrink-0">
        {/* No reserved box. This used to be a fixed `h-12` around the chart,
            rendered whenever the item had a SYMBOL — but only 132 of the held
            names have price history, and the renderer draws nothing without it.
            So an item whose symbol had no history reserved 48px and filled it
            with nothing: an empty band, indistinguishable from a bug.
            A sparkline, not a chart: no press-and-hold, no scrub, no pointer
            handlers at all, so it cannot capture the drag the mosaic needs. */}
        {chart && <div data-explore-spark>{chart}</div>}

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
          {item.subtype === 'aggregate' && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-primary-600 dark:text-primary-400">
              See all <ArrowUpRight className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function MobileExplore({
  candidates, category, onCategoryChange, onOpen, onTelemetry, renderSparkline, now = Date.now(),
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
   */
  const filterRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bar = filterRef.current
    if (!bar) return
    const chip = bar.querySelector<HTMLElement>('[aria-pressed="true"]')
    // Feature-detected: jsdom has no layout and therefore no `scrollIntoView`,
    // and a purely cosmetic scroll must not take the component down in the
    // environment its content is tested in.
    if (typeof chip?.scrollIntoView !== 'function') return
    // `nearest` on both axes: `center` would scroll the PAGE to bring the bar
    // itself into view, which is a different thing from scrolling the bar.
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest' })
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
          <p className="px-2 py-16 text-center text-[13px] text-gray-400">
            Nothing to explore in this category yet.
          </p>
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
                renderSparkline={renderSparkline}
                onOpen={item => {
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
                  onOpen(item)
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
