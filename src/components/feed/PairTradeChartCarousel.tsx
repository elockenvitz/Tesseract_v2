import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { ReelsChartPanel } from './ReelsChartPanel'
import { CarouselControls } from '../mobile/CarouselControls'
import { TickerQuoteBadge } from '../mobile/TickerQuoteBadge'
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
 * Legs are changed with the arrows or the dots, not by swiping. Swiping and
 * inspecting the price are the same gesture — press and drag horizontally —
 * so a swipe-paged carousel makes it impossible to read a price history
 * without changing chart. Explicit controls give the drag back to the chart,
 * which is the more valuable of the two.
 *
 * Two further things matter for this to feel right:
 *
 * - Only the visible chart and its immediate neighbours are mounted. Each
 *   panel is a Recharts instance with its own quote request, so rendering four
 *   at once made the first swipe stall while they all laid out — the main
 *   cause of the swipe feeling heavy.
 * - The chart area declares `touch-action: pan-y`, so a horizontal drag there
 *   belongs to the chart's crosshair and never scrolls anything, while a
 *   vertical drag still pages the feed.
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

  const [active, setActive] = useState(0)
  const clamped = Math.min(active, Math.max(0, legs.length - 1))

  if (!legs.length) {
    return (
      <div className="w-full h-full flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <p className="text-sm text-gray-400">No charts available for these legs</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        {legs.map((leg, i) => {
          const isActive = i === clamped
          // Neighbours stay mounted so switching legs is instant, but only the
          // active one is visible or reachable.
          if (Math.abs(i - clamped) > NEIGHBOUR_WINDOW) return null
          return (
            <div
              key={leg.key}
              aria-hidden={!isActive}
              className={clsx(
                'absolute inset-0',
                isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
            >
              <div className="h-full flex flex-col min-h-0">
                {/* Which leg, and what it is doing. Without the quote the two
                    charts were indistinguishable — a line with no ticker. */}
                <div className="flex-shrink-0 flex items-start justify-between gap-2 px-0.5 pb-1">
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide shrink-0',
                      leg.side === 'long'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    )}
                  >
                    {leg.side === 'long' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {leg.action}
                  </span>
                  <TickerQuoteBadge symbol={leg.symbol} companyName={leg.companyName} className="min-w-0" />
                </div>

                {/* Horizontal drag is the crosshair's; vertical still pages the feed. */}
                <div className="flex-1 min-h-0" style={{ touchAction: 'pan-y' }}>
                  <ReelsChartPanel symbol={leg.symbol} companyName={leg.companyName} hideHeader />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <CarouselControls
        className="flex-shrink-0 pt-1.5"
        count={legs.length}
        index={clamped}
        onChange={setActive}
        dotLabel={i => `Show ${legs[i].action} ${legs[i].symbol}`}
        label={`${legs[clamped]?.symbol} — chart ${clamped + 1} of ${legs.length}`}
      />

    </div>
  )
}
