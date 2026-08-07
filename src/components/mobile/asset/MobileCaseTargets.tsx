import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Check, Pencil, X } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useScenarios } from '../../../hooks/useScenarios'
import { useAnalystPriceTargets } from '../../../hooks/useAnalystPriceTargets'

interface MobileCaseTargetsProps {
  assetId: string
  currentPrice: number | null
  viewFilter?: 'aggregated' | string
}

/** Horizons offered when setting a target. Mirrors the desktop presets. */
const HORIZONS = ['3M', '6M', '12M', '18M', '24M'] as const

const ORDER = ['Bull', 'Base', 'Bear']

/**
 * The bull, base and bear cases, with their prices and horizons.
 *
 * Each scenario is one row: the reader's own target if they have set one, and
 * the others' beneath. A target without its horizon is not an opinion anyone
 * can act on — "$140" means something different over three months than over
 * two years — so the horizon is shown next to the price rather than hidden in
 * a tooltip.
 *
 * Editing sets price and horizon together for the same reason. Offering the
 * price alone would let a target be saved with no time attached.
 */
export function MobileCaseTargets({
  assetId,
  currentPrice,
  viewFilter = 'aggregated',
}: MobileCaseTargetsProps) {
  const { user } = useAuth()
  const { scenarios, isLoading: scenariosLoading } = useScenarios({ assetId })
  const { priceTargets, isLoading, savePriceTarget } = useAnalystPriceTargets({ assetId })

  const [editing, setEditing] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [horizon, setHorizon] = useState<string>('12M')

  const isOwnView = viewFilter === 'aggregated' || viewFilter === user?.id

  const rows = useMemo(() => {
    const defaults = (scenarios ?? []).filter(s => s.is_default)
    // Fall back to whatever scenarios exist, so an organisation using custom
    // ones is not shown an empty panel.
    const list = defaults.length ? defaults : (scenarios ?? [])
    return [...list].sort((a, b) => {
      const ai = ORDER.indexOf(a.name)
      const bi = ORDER.indexOf(b.name)
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }, [scenarios])

  if (scenariosLoading || isLoading) {
    return <div className="h-32 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
  }

  if (!rows.length) {
    return (
      <p className="px-1 py-3 text-sm text-gray-400">
        No scenarios defined for this asset yet.
      </p>
    )
  }

  const targetsFor = (scenarioId: string) =>
    (priceTargets ?? []).filter(t => t.scenario_id === scenarioId)

  const begin = (scenarioId: string, existing?: { price: number; timeframe: string | null }) => {
    setPrice(existing ? String(existing.price) : '')
    setHorizon(existing?.timeframe || '12M')
    setEditing(scenarioId)
  }

  const commit = (scenarioId: string) => {
    const value = parseFloat(price)
    // A blank or unparseable price cancels. Saving 0 would publish a target
    // nobody holds.
    if (Number.isFinite(value) && value > 0) {
      savePriceTarget.mutate({
        scenarioId,
        price: value,
        timeframe: horizon,
        timeframeType: 'preset',
      })
    }
    setEditing(null)
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map(scenario => {
        const all = targetsFor(scenario.id)
        const mine = all.find(t => t.user_id === user?.id)
        const others = all.filter(t => t.user_id !== user?.id)
        const shown = viewFilter === 'aggregated' ? mine : all.find(t => t.user_id === viewFilter)
        const isEditing = editing === scenario.id

        return (
          <div key={scenario.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: scenario.color || '#6b7280' }}
                aria-hidden
              />
              <span className="text-sm font-semibold text-gray-900 dark:text-white w-12 shrink-0">
                {scenario.name}
              </span>

              {isEditing ? (
                <>
                  <input
                    type="number"
                    inputMode="decimal"
                    autoFocus
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                    placeholder="Price"
                    className="flex-1 min-w-0 h-9 px-2 rounded-lg border border-primary-500 bg-white dark:bg-gray-800 text-sm tabular-nums text-gray-900 dark:text-gray-100 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commit(scenario.id)}
                    disabled={savePriceTarget.isPending}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-primary-600 text-white disabled:opacity-50 no-touch-target"
                    aria-label="Save target"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-gray-500 no-touch-target"
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  {shown ? (
                    <>
                      <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                        ${Number(shown.price).toFixed(2)}
                      </span>
                      {/* The horizon is part of the claim, not decoration. */}
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {shown.timeframe || 'no horizon'}
                      </span>
                      {currentPrice != null && currentPrice > 0 && (
                        <span
                          className={clsx(
                            'ml-auto text-xs font-semibold tabular-nums',
                            Number(shown.price) >= currentPrice
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          )}
                        >
                          {Number(shown.price) >= currentPrice ? '+' : ''}
                          {(((Number(shown.price) - currentPrice) / currentPrice) * 100).toFixed(0)}%
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-gray-400">Not set</span>
                  )}

                  {isOwnView && (
                    <button
                      type="button"
                      onClick={() =>
                        begin(
                          scenario.id,
                          mine ? { price: Number(mine.price), timeframe: mine.timeframe } : undefined
                        )
                      }
                      className="ml-1 h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-primary-600 dark:text-primary-400 no-touch-target"
                      aria-label={`${mine ? 'Edit' : 'Set'} ${scenario.name} target`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>

            {isEditing && (
              <div className="mt-2 flex items-center gap-1">
                <span className="text-[11px] text-gray-400 mr-0.5">Horizon</span>
                {HORIZONS.map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHorizon(h)}
                    className={clsx(
                      'px-2 h-7 rounded-md text-[11px] font-semibold border no-touch-target',
                      horizon === h
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
                    )}
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}

            {viewFilter === 'aggregated' && others.length > 0 && !isEditing && (
              <ul className="mt-1.5 pl-[1.375rem] space-y-0.5">
                {others.map(t => (
                  <li key={t.id} className="flex items-baseline gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="truncate max-w-[7rem]">
                      {t.user?.full_name ?? 'Colleague'}
                    </span>
                    <span className="tabular-nums font-medium text-gray-700 dark:text-gray-300">
                      ${Number(t.price).toFixed(2)}
                    </span>
                    <span>{t.timeframe || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
