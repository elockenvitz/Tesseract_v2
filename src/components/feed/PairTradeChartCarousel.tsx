import { useRef, useState } from 'react'
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
  symbol: string
  companyName?: string
}

/**
 * Horizontally swipeable charts for a pair trade's legs.
 *
 * A pair trade is a relationship between two positions, so showing one chart
 * misrepresents it. Stacking both vertically is not an option on a phone —
 * each would be too short to read.
 *
 * Uses CSS scroll-snap on the x-axis, matching the vertical snap the feed
 * already uses: native momentum and inertia, no touch-event bookkeeping, and
 * no risk of the indicator drifting out of sync with what is on screen since
 * position is read from scroll rather than tracked separately.
 *
 * Horizontal scrolling here is deliberate and contained, so it opts in via
 * its own scroll container rather than being caught by the global
 * `overflow-x: clip` that stops the page itself panning sideways.
 */
export function PairTradeChartCarousel({ longLegs, shortLegs }: PairTradeChartCarouselProps) {
  const legs: CarouselLeg[] = [
    ...longLegs.map(l => ({
      key: `long-${l.id}`,
      side: 'long' as const,
      symbol: l.asset.symbol,
      companyName: l.asset.company_name,
    })),
    ...shortLegs.map(l => ({
      key: `short-${l.id}`,
      side: 'short' as const,
      symbol: l.asset.symbol,
      companyName: l.asset.company_name,
    })),
  ]

  const scrollerRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  if (!legs.length) return null

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    // Derive the index from scroll position rather than tracking it on swipe —
    // the two cannot disagree this way.
    const index = Math.round(el.scrollLeft / el.clientWidth)
    if (index !== active) setActive(index)
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain scrollbar-hide"
      >
        {legs.map(leg => (
          <div key={leg.key} className="w-full flex-shrink-0 snap-start snap-always relative">
            <span
              className={clsx(
                'absolute top-1 left-1 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide',
                leg.side === 'long'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              )}
            >
              {leg.side === 'long' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {leg.side}
            </span>
            <ReelsChartPanel symbol={leg.symbol} companyName={leg.companyName} />
          </div>
        ))}
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
          <span className="sr-only">
            Chart {active + 1} of {legs.length}
          </span>
        </div>
      )}
    </div>
  )
}
