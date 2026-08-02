import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { ReelsChartPanel } from './ReelsChartPanel'
import type { PairTradeLeg } from '../../hooks/ideas/types'

interface PairTradeChartCarouselProps {
  longLegs: PairTradeLeg[]
  shortLegs: PairTradeLeg[]
}

interface CarouselLeg {
  key: string
  side: 'long' | 'short'
  /** The instruction, in the words used everywhere else: BUY / SELL / ADD / TRIM. */
  action: string
  symbol: string
  companyName?: string
}

/** Charts kept mounted either side of the visible one. */
const NEIGHBOUR_WINDOW = 1

/**
 * Horizontally swipeable charts for a pair trade's legs.
 *
 * A pair is a relationship between positions, so one chart misrepresents it,
 * and stacking legs vertically leaves each too short to read on a phone.
 *
 * Two things matter for this to feel right:
 *
 * - Only the visible chart and its immediate neighbours are mounted. Each
 *   panel is a Recharts instance with its own quote request, so rendering four
 *   at once made the first swipe stall while they all laid out — the main
 *   cause of the swipe feeling heavy.
 * - The active index is derived from scroll position inside a rAF, so it
 *   cannot disagree with what is on screen and does not re-render per event.
 *
 * `touch-action` is deliberately left alone. Pinning it to `pan-x` would make
 * the carousel swipe crisper, but the chart is half the tile and a vertical
 * drag there would then do nothing — paging the feed from the chart area
 * matters more. The browser's own axis locking handles the rest.
 */
export function PairTradeChartCarousel({ longLegs, shortLegs }: PairTradeChartCarouselProps) {
  const legs: CarouselLeg[] = useMemo(() => {
    const build = (list: PairTradeLeg[], side: 'long' | 'short') =>
      (list ?? [])
        // A leg whose asset join came back empty has no symbol to chart.
        // Reading through it unguarded is what crashed the card on swipe.
        .filter(l => l?.asset?.symbol)
        .map(l => ({
          key: `${side}-${l.id}`,
          side,
          action: (l.action || (side === 'long' ? 'buy' : 'sell')).toUpperCase(),
          symbol: l.asset.symbol,
          companyName: l.asset.company_name,
        }))
    return [...build(longLegs, 'long'), ...build(shortLegs, 'short')]
  }, [longLegs, shortLegs])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const frame = useRef<number | null>(null)
  const [active, setActive] = useState(0)

  const onScroll = useCallback(() => {
    if (frame.current != null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const el = scrollerRef.current
      if (!el || el.clientWidth === 0) return
      const index = Math.round(el.scrollLeft / el.clientWidth)
      setActive(prev => (prev === index ? prev : index))
    })
  }, [])

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current)
  }, [])

  if (!legs.length) {
    return (
      <div className="w-full h-full flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <p className="text-sm text-gray-400">No charts available for these legs</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain scrollbar-hide"
      >
        {legs.map((leg, i) => {
          const near = Math.abs(i - active) <= NEIGHBOUR_WINDOW
          return (
            <div key={leg.key} className="w-full h-full flex-shrink-0 snap-start snap-always relative">
              <span
                className={clsx(
                  'absolute top-1 left-1 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide',
                  leg.side === 'long'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                )}
              >
                {leg.side === 'long' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {leg.action} {leg.symbol}
              </span>

              {near ? (
                <ReelsChartPanel symbol={leg.symbol} companyName={leg.companyName} hideHeader />
              ) : (
                // Placeholder keeps the scroll width correct so snap points and
                // the derived index stay accurate while the chart is unmounted.
                <div className="w-full h-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" />
              )}
            </div>
          )
        })}
      </div>

      {legs.length > 1 && (
        <div className="flex-shrink-0 flex items-center justify-center gap-1.5 pt-1.5">
          {legs.map((leg, i) => (
            <span
              key={leg.key}
              aria-hidden="true"
              className={clsx(
                'h-1.5 rounded-full transition-all',
                i === active ? 'w-4 bg-gray-500 dark:bg-gray-300' : 'w-1.5 bg-gray-300 dark:bg-gray-600'
              )}
            />
          ))}
          <span className="sr-only" role="status">
            {legs[active]?.symbol} — chart {active + 1} of {legs.length}
          </span>
        </div>
      )}
    </div>
  )
}
