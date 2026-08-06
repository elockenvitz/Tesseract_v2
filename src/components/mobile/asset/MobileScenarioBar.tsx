import { useMemo } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { useScenarios } from '../../../hooks/useScenarios'
import { useAnalystPriceTargets } from '../../../hooks/useAnalystPriceTargets'
import { useOutcomeAggregation } from '../../../hooks/useOutcomeAggregation'
import { financialDataService } from '../../../lib/financial-data/browser-client'

interface MobileScenarioBarProps {
  assetId: string
  symbol: string
}

/** Ordered as they are argued, not alphabetically. */
const ORDER = ['Bull', 'Base', 'Bear']

const TONE: Record<string, { dot: string; text: string; track: string }> = {
  Bull: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    track: 'bg-emerald-500',
  },
  Base: { dot: 'bg-gray-500', text: 'text-gray-700 dark:text-gray-300', track: 'bg-gray-400' },
  Bear: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', track: 'bg-red-500' },
}

/**
 * Bull, base and bear against the current price, on one scale.
 *
 * Not a chart. PriceTargetChart is a time series with draggable markers,
 * per-analyst annotations and a probability editor — it needs width and a
 * cursor, and at phone height the plot area collapses to a band too short to
 * read a price off.
 *
 * What a case actually has to answer on a phone is narrower: where are the
 * three cases, where are we now, and how far is the upside from the downside.
 * A single axis says that in one glance, and the numbers are stated rather
 * than left to be estimated from a pixel position.
 */
export function MobileScenarioBar({ assetId, symbol }: MobileScenarioBarProps) {
  const { scenarios, isLoading: scenariosLoading } = useScenarios({ assetId })
  const { priceTargets, isLoading: targetsLoading } = useAnalystPriceTargets({ assetId })
  const { aggregatedResults, hasData } = useOutcomeAggregation({ assetId, priceTargets, scenarios })

  const { data: quote } = useQuery({
    // Shares the key the chart panel and ticker badge already use, so the
    // price costs no extra request.
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
  const current = typeof price === 'number' && price > 0 ? price : null

  const cases = useMemo(
    () =>
      aggregatedResults
        .filter(r => r.isDefault && r.aggregatedPrice != null)
        .sort((a, b) => ORDER.indexOf(a.scenarioName) - ORDER.indexOf(b.scenarioName)),
    [aggregatedResults]
  )

  const scale = useMemo(() => {
    const values = cases.map(c => c.aggregatedPrice as number)
    if (current != null) values.push(current)
    if (!values.length) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    // A flat span would divide by zero; pad it so every marker still lands
    // somewhere sensible rather than stacking at one end.
    const pad = (max - min) * 0.12 || Math.max(max * 0.05, 1)
    return { lo: min - pad, hi: max + pad }
  }, [cases, current])

  if (scenariosLoading || targetsLoading) {
    return <div className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
  }

  // Nothing valued yet. An empty axis would imply the work was done and came
  // back blank.
  if (!hasData || !cases.length || !scale) return null

  const position = (value: number) => ((value - scale.lo) / (scale.hi - scale.lo)) * 100

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
      <div className="relative h-8 mb-3">
        <div className="absolute inset-x-0 top-3.5 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />

        {current != null && (
          <>
            <div
              className="absolute top-1 h-6 w-0.5 bg-gray-900 dark:bg-white"
              style={{ left: `${position(current)}%` }}
              aria-hidden
            />
            <span
              className="absolute top-0 -translate-x-1/2 text-[10px] font-semibold text-gray-900 dark:text-white whitespace-nowrap"
              style={{ left: `${position(current)}%` }}
            >
              now
            </span>
          </>
        )}

        {cases.map(c => {
          const tone = TONE[c.scenarioName] ?? TONE.Base
          return (
            <div
              key={c.scenarioId ?? c.scenarioName}
              className={clsx('absolute top-2.5 h-3 w-3 -translate-x-1/2 rounded-full ring-2 ring-white dark:ring-gray-900', tone.dot)}
              style={{ left: `${position(c.aggregatedPrice as number)}%` }}
              aria-hidden
            />
          )
        })}
      </div>

      <ul className="space-y-1.5">
        {cases.map(c => {
          const tone = TONE[c.scenarioName] ?? TONE.Base
          const value = c.aggregatedPrice as number
          const upside = current != null ? ((value - current) / current) * 100 : null
          return (
            <li key={c.scenarioId ?? c.scenarioName} className="flex items-baseline gap-2">
              <span className={clsx('h-2 w-2 rounded-full shrink-0', tone.dot)} aria-hidden />
              <span className={clsx('text-sm font-semibold w-12 shrink-0', tone.text)}>
                {c.scenarioName}
              </span>
              <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                ${value.toFixed(2)}
              </span>
              {upside != null && (
                <span
                  className={clsx(
                    'ml-auto text-xs font-semibold tabular-nums',
                    upside >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {upside >= 0 ? '+' : ''}
                  {upside.toFixed(0)}%
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {current != null && (
        <p className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-400">
          Current ${current.toFixed(2)}
        </p>
      )}
    </div>
  )
}
