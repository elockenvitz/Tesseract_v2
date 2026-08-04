import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { financialDataService } from '../../lib/financial-data/browser-client'

interface TickerQuoteBadgeProps {
  symbol: string
  companyName?: string | null
  /** Suppress the ticker when the title beside it already names the asset. */
  showSymbol?: boolean
  /** `lead` gives the quote the row to itself — used where the tile has no
   *  title to sit beside, so the price is the most useful thing there. */
  variant?: 'badge' | 'lead'
  className?: string
}

/**
 * Ticker, name and live price for the top-right of a feed tile.
 *
 * This information used to live inside ReelsChartPanel's own header, which
 * meant every tile carried two header rows — a nearly empty one at the top of
 * the card and a second one above the chart. Hoisting it here fills the space
 * that was empty and lets the chart reclaim the row it was giving up.
 *
 * Shares React Query's cache key with the chart panel (`reels-chart-quote`),
 * so displaying the price here costs no additional request.
 */
export function TickerQuoteBadge({ symbol, companyName, showSymbol = true, variant = 'badge', className }: TickerQuoteBadgeProps) {
  const { data: quote } = useQuery({
    queryKey: ['reels-chart-quote', symbol],
    queryFn: async () => {
      try {
        return await financialDataService.getQuote(symbol)
      } catch {
        return null
      }
    },
    staleTime: 60_000,
  })

  const price = (quote as any)?.price as number | undefined
  const changePercent = (quote as any)?.changePercent as number | undefined
  const isPositive = (changePercent ?? 0) >= 0

  const lead = variant === 'lead'

  return (
    <div
      className={clsx(
        'flex flex-col min-w-0',
        lead ? 'items-start text-left' : 'items-end text-right',
        className
      )}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        {showSymbol && (
          <span className={clsx('font-bold text-gray-900 dark:text-white', lead ? 'text-2xl' : 'text-sm')}>
            {symbol}
          </span>
        )}
        {price != null && (
          <span className={clsx('font-semibold tabular-nums text-gray-900 dark:text-white', lead ? 'text-xl' : 'text-sm')}>
            ${price.toFixed(2)}
          </span>
        )}
        {changePercent != null && (
          <span
            className={clsx(
              'font-semibold tabular-nums',
              lead ? 'text-base' : 'text-xs',
              isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            )}
          >
            {isPositive ? '+' : ''}
            {changePercent.toFixed(2)}%
          </span>
        )}
      </div>
      {companyName && (
        <span className={clsx('text-gray-500 dark:text-gray-400 truncate', lead ? 'text-sm max-w-full' : 'text-[11px] max-w-[11rem]')}>
          {companyName}
        </span>
      )}
    </div>
  )
}
