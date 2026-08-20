import { useEffect, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, Users } from 'lucide-react'

import { FEED_CATEGORIES, type FeedCategory } from '../../lib/mobile/feed-categories'
import { composeExplore } from '../../lib/mobile/explore-compose'
import type { ComposedExploreItem, ExploreItem } from '../../lib/mobile/explore-item'
import { Sparkline } from '../signals/Sparkline'

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
  /** Closes by symbol, for sparklines. Absent series simply render no chart. */
  series?: Map<string, { date: string; close: number }[]>
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
  entry, series, onOpen, now,
}: {
  entry: ComposedExploreItem
  series?: { date: string; close: number }[]
  onOpen: (i: ExploreItem) => void
  now: number
}) {
  const { item, emphasis } = entry
  const feature = emphasis === 'feature'
  const when = ago(item.occurredAt, now)

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
        'flex w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-3 text-left',
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

      {/* Two lines at tile width, three when featured. Clamped rather than
          truncated at a character count, so it degrades with the font. */}
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
      {series && series.length > 1 && (
        <div className={clsx('mt-2 shrink-0', feature ? 'h-10' : 'h-7')} data-explore-spark>
          <Sparkline points={series.map(p => p.close)} />
        </div>
      )}

      {item.context && (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-[1.4] text-gray-500 dark:text-gray-400">
          {item.context}
        </p>
      )}

      <div className="mt-auto flex min-w-0 items-center gap-1.5 pt-2">
        {item.source && (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[10px] font-medium text-gray-400">
            {item.source.kind === 'person' && <Users className="h-3 w-3 shrink-0" />}
            <span className="truncate">{item.source.label}</span>
          </span>
        )}
        {item.portfolio?.weightPct != null && (
          <span className="shrink-0 text-[10px] font-semibold tabular-nums text-gray-400">
            {item.portfolio.weightPct.toFixed(1)}%
          </span>
        )}
        {item.subtype === 'aggregate' && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-primary-600 dark:text-primary-400">
            See all <ArrowUpRight className="h-3 w-3" />
          </span>
        )}
      </div>
    </button>
  )
}

export function MobileExplore({
  candidates, series, category, onCategoryChange, onOpen, onTelemetry, now = Date.now(),
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
                series={entry.item.symbol ? series?.get(entry.item.symbol.toUpperCase()) : undefined}
                now={now}
                onOpen={item => {
                  onTelemetry?.('explore_item_opened', {
                    category: item.category, subtype: item.subtype,
                    symbol: item.symbol ?? null, item_id: item.id,
                  })
                  // A `filter` destination is handled HERE rather than by the
                  // caller, because this component owns the category state. It
                  // lived in the dashboard first, which meant the aggregate's
                  // whole reason for existing — that it is not a dead end —
                  // could not be exercised anywhere the dashboard was absent.
                  if (item.destination.kind === 'filter') {
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
