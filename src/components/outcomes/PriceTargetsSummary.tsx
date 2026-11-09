import { useMemo } from 'react'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus, Users, Loader2 } from 'lucide-react'
import { useScenarios } from '../../hooks/useScenarios'
import { useAnalystPriceTargets } from '../../hooks/useAnalystPriceTargets'
import { useOutcomeAggregation } from '../../hooks/useOutcomeAggregation'
import { useTargetOutcomes } from '../../hooks/useTargetOutcomes'
import {
  scenarioFreshness, isStale, FRESHNESS_LABEL, type TargetFreshness,
} from '../../lib/outcomes/target-freshness'

/**
 * `target_date` is a DATE, so '2026-08-30' parses as UTC midnight. Rendering
 * that straight through `toLocaleDateString` shows the 29th to anyone west of
 * Greenwich — an off-by-one on the very field this panel exists to be honest
 * about. Pinning it to local midnight keeps the stored day the displayed day.
 */
function formatTargetDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * One line under each scenario, saying whether the number still stands.
 *
 * It is a line of text rather than a badge on purpose: a target card already
 * carries a scenario chip, a price, an upside figure and an analyst count, and
 * the fix for "this looks current when it is not" is not a fifth ornament. The
 * stale states are the only ones that take colour.
 */
function FreshnessLine({ freshness }: { freshness: TargetFreshness }) {
  const stale = isStale(freshness.state)
  const label = FRESHNESS_LABEL[freshness.state]

  /* A current target says when it runs out; a lapsed one says when it did. */
  const date = freshness.asOf ? formatTargetDate(freshness.asOf) : null
  const text = freshness.state === 'current' && date ? `Current · to ${date}`
    : date ? `${label} · ${date}`
    : label

  return (
    <div
      className={clsx(
        'mt-1.5 text-[11px] leading-tight',
        stale
          ? 'font-medium text-amber-700 dark:text-amber-500'
          : 'text-gray-500 dark:text-gray-400',
      )}
      title={freshness.basis === 'outcome'
        ? 'From the evaluated target outcome'
        : freshness.basis === 'target-date'
          ? "From the target's own date; not yet evaluated"
          : freshness.basis === 'rolling'
            ? 'Rolling target — no fixed horizon'
            : 'No horizon recorded for this target'}
    >
      {text}
    </div>
  )
}

interface PriceTargetsSummaryProps {
  assetId: string
  currentPrice?: number
  className?: string
  /** Hide the "Price Targets" title row — for surfaces where the containing
   *  panel already identifies the content (e.g. the expansion carousel). */
  hideHeader?: boolean
}

/**
 * Compact price targets summary showing Bull/Base/Bear aggregated values.
 * Returns null if no price target data exists.
 * Designed for the aggregated "Our View" in AssetTab.
 */
export function PriceTargetsSummary({ assetId, currentPrice, className, hideHeader }: PriceTargetsSummaryProps) {
  // Fetch scenarios
  const { scenarios, isLoading: scenariosLoading } = useScenarios({ assetId })

  // Fetch all price targets for this asset
  const { priceTargets, isLoading: targetsLoading } = useAnalystPriceTargets({ assetId })

  // Aggregation hook
  const { aggregatedResults, hasData } = useOutcomeAggregation({
    assetId,
    priceTargets,
    scenarios
  })

  /*
   * The evaluated outcomes for this asset, joined per scenario below on
   * `price_target_id`. Reusing the existing hook rather than adding a query:
   * the Asset Page already fetches this table for History and Overview, which
   * is how those two surfaces knew these targets had expired while this one
   * did not.
   */
  const { outcomes, isLoading: outcomesLoading } = useTargetOutcomes({ assetId })

  const isLoading = scenariosLoading || targetsLoading || outcomesLoading

  // Filter to only default scenarios (Bull, Base, Bear) with data
  const defaultResults = useMemo(() => {
    return aggregatedResults
      .filter(r => r.isDefault && r.aggregatedPrice !== null)
      .sort((a, b) => {
        const order = ['Bull', 'Base', 'Bear']
        return order.indexOf(a.scenarioName) - order.indexOf(b.scenarioName)
      })
  }, [aggregatedResults])

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4 dark:border-gray-700 dark:bg-gray-800', className)}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  // Return null if no price target data
  if (!hasData || defaultResults.length === 0) {
    return null
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800', className)}>
      {!hideHeader && (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2 dark:text-white">
            <TrendingUp className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            Price Targets
          </h4>
        </div>
      )}

      <div className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {defaultResults.map(result => {
            const upside = currentPrice && result.aggregatedPrice
              ? ((result.aggregatedPrice - currentPrice) / currentPrice) * 100
              : null

            /* Joined on price_target_id — see `target-freshness` for why not
               on price or scenario. */
            const freshness = scenarioFreshness(result.targets, outcomes)
            const stale = isStale(freshness.state)

            return (
              <div
                key={result.scenarioId}
                className="text-center p-3 bg-gray-50 rounded-lg dark:bg-gray-900"
                style={{
                  /* The scenario colour is a live signal. A lapsed target keeps
                     its identity but stops advertising it. */
                  borderTop: `3px solid ${result.scenarioColor || '#6b7280'}`,
                  opacity: stale ? 0.72 : undefined,
                }}
              >
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center justify-center gap-1.5 dark:text-gray-400">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: result.scenarioColor || '#6b7280' }}
                  />
                  {result.scenarioName}
                </div>

                <div className={clsx(
                  'text-xl font-bold mb-1',
                  stale
                    ? 'text-gray-500 dark:text-gray-400'
                    : 'text-gray-900 dark:text-white',
                )}>
                  ${result.aggregatedPrice!.toFixed(2)}
                </div>

                {upside !== null && (
                  <div className={clsx(
                    'text-xs font-medium flex items-center justify-center gap-0.5 mb-2',
                    /* Upside to a target that no longer stands is not a live
                       signal, so it does not get the live colours. */
                    stale ? 'text-gray-500 dark:text-gray-400' :
                    upside > 0 ? 'text-green-600' :
                    upside < 0 ? 'text-red-600' :
                    'text-gray-500 dark:text-gray-400'
                  )}>
                    {upside > 0 ? <TrendingUp className="w-3 h-3" /> :
                     upside < 0 ? <TrendingDown className="w-3 h-3" /> :
                     <Minus className="w-3 h-3" />}
                    {upside > 0 ? '+' : ''}{upside.toFixed(1)}%
                  </div>
                )}

                <div className="flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <Users className="w-3 h-3" />
                  <span>{result.analystCount} analyst{result.analystCount !== 1 ? 's' : ''}</span>
                </div>

                <FreshnessLine freshness={freshness} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
