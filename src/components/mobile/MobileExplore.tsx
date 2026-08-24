import { useEffect, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, Users } from 'lucide-react'

import { FEED_CATEGORIES, type FeedCategory } from '../../lib/mobile/feed-categories'
import { composeExplore } from '../../lib/mobile/explore-compose'
import type { ComposedExploreItem, ExploreItem } from '../../lib/mobile/explore-item'


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
   */
  /**
   * Draw a tile's price path, INCLUDING its own height.
   *
   * The height used to be a fixed box in the tile, reserved whenever an item
   * had a symbol — and a symbol is not history. Only the thing that fetches
   * can know whether there is a line, so it owns the space: no line, no box.
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

const CATEGORY_DOT: Record<FeedCategory, string> = {
  decisions: 'bg-rose-500',
  research: 'bg-sky-500',
  ideas: 'bg-violet-500',
  workflow: 'bg-amber-500',
  news: 'bg-gray-400',
}

/** Short relative time. Absent timestamps render nothing rather than "just now". */
function ago(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const mins = Math.max(0, Math.round((now - t) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.round(days / 30)}mo`
}

function Tile({
  entry, onOpen, renderSparkline, now,
}: {
  entry: ComposedExploreItem
  onOpen: (i: ExploreItem) => void
  /**
   * Draw a tile's price path, INCLUDING its own height.
   *
   * The height used to be a fixed box in the tile, reserved whenever an item
   * had a symbol — and a symbol is not history. Only the thing that fetches
   * can know whether there is a line, so it owns the space: no line, no box.
   */
  renderSparkline?: (symbol: string, opts: { feature: boolean }) => React.ReactNode
  now: number
}) {
  const { item, emphasis } = entry
  const feature = emphasis === 'feature'
  const when = ago(item.occurredAt, now)

  /**
   * The weight, unless the context line has already said it.
   *
   * Several adapters write a context of exactly "4.8% of Core Equity", so
   * labelling the footer figure produced the same number twice on one tile in
   * two different phrasings. The context is the richer of the two — it names
   * the book — so it wins and the footer stays quiet.
   */
  const weightPct = item.portfolio?.weightPct
  const showWeight = weightPct != null
    && !(item.context ?? '').includes(`${weightPct.toFixed(1)}%`)

  return (
    <button
      type="button"
      data-explore-tile={item.id}
      data-category={item.category}
      data-subtype={item.subtype}
      data-emphasis={emphasis}
      data-symbol={item.symbol ?? ''}
      onClick={() => onOpen(item)}
      className={clsx(
        // No internal scroller, ever. Content that does not fit is clamped and
        // the tap reaches the full version — recreating Phase 8.1's nested
        // scroll problem in a smaller grid would be the same defect, cheaper to
        // miss.
        // `h-full` so a tile fills its grid cell.
        //
        // The grid is `auto-rows-min`, so a row is as tall as its tallest
        // member — and a shorter tile beside it drew its border at its own
        // content height, leaving a band of page showing underneath. Reported
        // as odd empty space. The gap was always inside the row; the tile just
        // was not claiming it. Filling the cell turns that space into part of
        // the tile, which is what it looked like it should have been.
        // ONE space distributor, and it is the `mt-auto` on the bottom group.
        //
        // This was `justify-between` — which spreads slack between EVERY child
        // — over a sparkline and a footer that each also carried `mt-auto`.
        // Three claims on the same free space, so a tile with a short headline
        // opened gaps between the title and the metric, the metric and the
        // chart, and the chart and the footer: slack scattered through the tile
        // in three places instead of pooled in one. That is the empty space.
        //
        // Now the text stacks from the top, the bottom group is pinned to the
        // floor, and all the slack sits in a single band between them, which
        // reads as breathing room rather than as holes.
        'flex h-full w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-3 text-left',
        'active:scale-[0.985] active:opacity-90 transition-transform',
        'dark:border-gray-700 dark:bg-gray-900',
        // `col-span-full`, not `col-span-2`. In the single-column layout a
        // two-column span creates an IMPLICIT second column, which collapsed
        // the explicit one to 0px and left every tile row 18px wide — measured
        // at 320px, where the page then scrolled horizontally. Spanning "all
        // columns, however many there are" is what was meant either way.
        feature && 'col-span-full',
      )}
    >
      {/* `min-w-0` on the row and `truncate` on the flexible child.
          Without both, a long ticker or source name sets the row's minimum
          width and the tile pushes past the column — which at 320px is a
          horizontally scrolling page rather than a clipped label. */}
      <div className="flex min-w-0 items-center gap-1.5">
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
        {when && <span className="ml-auto shrink-0 text-[10px] font-medium text-gray-400">{when}</span>}
      </div>

      {/* The text, centred in whatever room is left.
          ── Why centred rather than stacked at the top ────────────────────
          A row is as tall as its tallest tile and every tile fills its cell, so
          a tile with three short lines and no chart has real slack no matter
          how the children are arranged. Pinned to the top it pooled at the
          bottom — measured at 104px on a two-line tile, which reads as a hole
          under the text rather than as space around it.
          Split above and below, the same slack reads as padding. It cannot be
          removed: the content genuinely is shorter, and the alternative is
          letting the tile end early and show the page through the row, which is
          the empty space this layout started from. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center">
      <p className={clsx(
        'mt-1.5 text-[13px] font-semibold leading-[1.35] text-gray-900 dark:text-white',
        feature ? 'line-clamp-2' : 'line-clamp-3',
      )}>
        {item.title}
      </p>

      {item.metric && (
        <p className={clsx('mt-1.5 truncate text-[17px] font-bold tabular-nums leading-none', TONE[item.metric.direction ?? 'neutral'])}>
          {item.metric.value}
          {item.metric.label && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {item.metric.label}
            </span>
          )}
        </p>
      )}

      {/* A sparkline, not a chart. No press-and-hold, no scrub, no pointer
          handlers at all — so it cannot capture the drag the mosaic needs, and
          twenty of them cost twenty paths rather than twenty interactive
          components. Absent history renders nothing at all. */}
      {/* Fetched per tile, so each draws when its own data lands rather than
          when the slowest of twenty does — and shares its cache with the
          Curate cards, so a name already read for a card is instant here.
          Taller than it was: a month of movement in 28px flattens everything
          but the extremes, and every name looked like the same gentle slope. */}
      {/* Prose before the picture. It read after the chart, which put a
          sentence below a line that was already pinned to the tile's floor and
          left the void between them. */}
      {/* The context line, or the company's name when there is no context.
          ── Why the fallback ────────────────────────────────────────────────
          The tiles that look emptiest are the ones with no metric, no context
          and no price history — a headline alone in a full-height cell. Eight
          of the adapters already carry `companyName` and nothing rendered it,
          so the tile was holding a fact about the subject and showing blank
          space instead.
          It is also the more useful line on exactly those tiles: they are the
          ones whose headline is short enough to leave the reader wondering
          which company `TSM` is. Second to a real context, never instead of
          one — a company name where an actual finding exists would be filler. */}
      {(item.context || item.companyName) && (
        <p
          data-explore-context
          className="mt-1.5 line-clamp-2 text-[11px] leading-[1.4] text-gray-500 dark:text-gray-400"
        >
          {item.context || item.companyName}
        </p>
      )}

      </div>

      {/* The bottom of the tile: chart and attribution, together, pinned.
          Charts land on a consistent baseline across a row this way, and the
          single `mt-auto` here is the tile's only claim on its slack. */}
      <div className="shrink-0">
        {/* No reserved box. This used to be a fixed `h-12` around the chart,
            rendered whenever the item had a SYMBOL — but only 132 of the held
            names have price history, and `TileSparkline` draws nothing without
            it. So an item whose symbol had no history reserved 48px and filled
            it with nothing: an empty band, in the middle of the tile,
            indistinguishable from a bug.
            The height belongs to the thing that knows whether there is a line,
            so it moved inside. A tile with no history is simply shorter. */}
        {item.symbol && renderSparkline && (
          <div data-explore-spark>{renderSparkline(item.symbol, { feature })}</div>
        )}

        <div className="flex min-w-0 items-center gap-1.5 pt-2">
        {item.source && (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[10px] font-medium text-gray-400">
            {item.source.kind === 'person' && <Users className="h-3 w-3 shrink-0" />}
            <span className="truncate">{item.source.label}</span>
          </span>
        )}
        {/* Named, because a bare percentage under a price chart reads as a
            return. On a tile whose chart is a year of closes and whose metric
            may be "TODAY", an unlabelled `6.3%` is a third number in a third
            unit with nothing to say which.
            One word, not the book's name. "8.1% of Core Equity" is accurate and
            it pushed the source line out — the first version of this shipped
            with "Sarah Chen" truncated to "Sarah …" to make room for a book
            name the context line usually gives anyway. */}
        {showWeight && (
          <span
            data-explore-weight
            className="shrink-0 text-[10px] font-semibold text-gray-400"
          >
            <span className="tabular-nums">{item.portfolio!.weightPct!.toFixed(1)}%</span> weight
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

  // Recomposed only when the inputs actually change. The composition is pure
  // and the page can hold sixty tiles, so doing this per render would be the
  // most expensive thing on the surface.
  const composed = useMemo(
    () => composeExplore(candidates, { now, category }),
    [candidates, category, now],
  )

  const openedRef = useRef(false)
  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true
    onTelemetry?.('explore_opened', { items: composed.length })
  }, [composed.length, onTelemetry])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The canonical taxonomy, from the shared module. Explore does not get
          its own words for the same objects — that divergence is exactly what
          Phase 8.1 collapsed. */}
      <div
        data-explore-filters
        className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-gray-200 px-3 py-2 [scrollbar-width:none] dark:border-gray-800"
      >
        <button
          type="button"
          data-explore-category="all"
          aria-pressed={category === null}
          onClick={() => { onCategoryChange(null); onTelemetry?.('explore_category', { category: 'all' }) }}
          className={clsx(
            'h-8 shrink-0 rounded-full px-3 text-[12px] font-bold no-touch-target',
            category === null
              ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
          )}
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
            className={clsx(
              'h-8 shrink-0 rounded-full px-3 text-[12px] font-bold no-touch-target',
              category === c.key
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
            )}
          >
            {c.label}
          </button>
        ))}
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
        {composed.length === 0 ? (
          <p className="px-2 py-16 text-center text-[13px] text-gray-400">
            Nothing to explore in this category yet.
          </p>
        ) : (
          // Two columns at phone widths, one only when the viewport genuinely
          // cannot carry two. `auto-rows-min` keeps tiles at their content
          // height so a tall tile does not stretch its neighbour.
          <div className="grid grid-cols-1 auto-rows-min gap-2.5 min-[340px]:grid-cols-2">
            {composed.map(entry => (
              <Tile
                key={entry.item.id}
                entry={entry}
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
