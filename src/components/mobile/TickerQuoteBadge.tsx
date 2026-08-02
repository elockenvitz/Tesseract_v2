import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { financialDataService } from '../../lib/financial-data/browser-client'

interface TickerQuoteBadgeProps {
  symbol: string
  companyName?: string | null
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
export function TickerQuoteBadge({ symbol, companyName, className }: TickerQuoteBadgeProps) {
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

  return (
    <div className={clsx('flex flex-col items-end min-w-0 text-right', className)}>
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-sm font-bold text-gray-900 dark:text-white">{symbol}</span>
        {price != null && (
          <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
            ${price.toFixed(2)}
          </span>
        )}
        {changePercent != null && (
          <span
            className={clsx(
              'text-xs font-semibold tabular-nums',
              isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            )}
          >
            {isPositive ? '+' : ''}
            {changePercent.toFixed(2)}%
          </span>
        )}
      </div>
      {companyName && (
        <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[11rem]">
          {companyName}
        </span>
      )}
    </div>
  )
}
