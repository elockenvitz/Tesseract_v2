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

/**
 * How a horizon is expressed, matching the desktop editor and the
 * timeframe_type / is_rolling columns on analyst_price_targets.
 *
 *  preset  — a fixed window from today ("12M"), expiring when it elapses.
 *  rolling — the same window, but continuously re-based so it never expires.
 *  date    — a specific calendar date, e.g. an expected catalyst.
 *
 * Mobile previously offered only 'preset' and hard-coded timeframeType, so a
 * rolling target set on desktop was silently rewritten to a fixed one the next
 * time it was edited on a phone.
 */
type HorizonMode = 'preset' | 'rolling' | 'date'

const HORIZON_MODES: { key: HorizonMode; label: string }[] = [
  { key: 'preset', label: 'Fixed' },
  { key: 'rolling', label: 'Rolling' },
  { key: 'date', label: 'Date' },
]

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
  /** How the horizon is expressed. Mirrors analyst_price_targets.timeframe_type. */
  const [horizonMode, setHorizonMode] = useState<HorizonMode>('preset')
  /** Set when horizonMode is 'date'. */
  const [targetDate, setTargetDate] = useState('')
  /** Probability this scenario plays out, 0-100. Optional. */
  const [probability, setProbability] = useState('')

  // Firm view is a summary of everyone's targets, so it is read-only. Setting a
  // target from it would have no unambiguous author.
  const isFirmView = viewFilter === 'aggregated'
  const canEdit = !!user && viewFilter === user.id

  const rows = useMemo(() => {
    // Every scenario, not just the defaults. Filtering to is_default dropped
    // custom cases — an "Uber Bull" with a target set against it simply never
    // appeared, and the fallback only fired when an asset had NO defaults at
    // all, which is never once ensure_default_scenarios has run.
    return [...(scenarios ?? [])].sort((a, b) => {
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

  const begin = (scenarioId: string, existing?: any) => {
    setPrice(existing ? String(existing.price) : '')
    setHorizon(existing?.timeframe || '12M')
    setHorizonMode(
      existing?.is_rolling ? 'rolling' : existing?.timeframe_type === 'date' ? 'date' : 'preset'
    )
    setTargetDate(existing?.target_date ? String(existing.target_date).slice(0, 10) : '')
    setProbability(existing?.probability != null ? String(existing.probability) : '')
    setEditing(scenarioId)
  }

  const commit = (scenarioId: string) => {
    const value = parseFloat(price)
    // A blank or unparseable price cancels. Saving 0 would publish a target
    // nobody holds.
    if (Number.isFinite(value) && value > 0) {
      const prob = parseFloat(probability)
      savePriceTarget.mutate({
        scenarioId,
        price: value,
        // A date horizon stores the date; the label still carries the preset so
        // lists that only read `timeframe` stay readable.
        timeframe: horizonMode === 'date' ? (targetDate || horizon) : horizon,
        timeframeType: horizonMode === 'date' ? 'date' : 'preset',
        targetDate: horizonMode === 'date' && targetDate ? targetDate : undefined,
        isRolling: horizonMode === 'rolling',
        probability: Number.isFinite(prob) && prob > 0 ? prob : undefined,
      })
    }
    setEditing(null)
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map(scenario => {
        const all = targetsFor(scenario.id)
        const mine = all.find(t => t.user_id === user?.id)
        // On the firm view the headline is the average across analysts, which
        // is what the chart already draws. Showing only the reader's own target
        // there labelled it as the firm's position.
        const shown = isFirmView
          ? (all.length
              ? {
                  price: all.reduce((s, t) => s + Number(t.price), 0) / all.length,
                  timeframe: `${all.length} analyst${all.length === 1 ? '' : 's'}`,
                }
              : undefined)
          : all.find(t => t.user_id === viewFilter)
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

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => begin(scenario.id, mine)}
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
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400 mr-0.5 w-14 shrink-0">Horizon</span>
                  {HORIZON_MODES.map(m => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setHorizonMode(m.key)}
                      className={clsx(
                        'flex-1 h-7 rounded-md text-[11px] font-semibold border no-touch-target',
                        horizonMode === m.key
                          ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                          : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {horizonMode === 'date' ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-400 mr-0.5 w-14 shrink-0">By</span>
                    <input
                      type="date"
                      value={targetDate}
                      onChange={e => setTargetDate(e.target.value)}
                      className="flex-1 min-w-0 h-8 px-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[12px] text-gray-900 dark:text-gray-100"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-400 mr-0.5 w-14 shrink-0">
                      {horizonMode === 'rolling' ? 'Rolling' : 'Window'}
                    </span>
                    {HORIZONS.map(h => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setHorizon(h)}
                        className={clsx(
                          'flex-1 h-7 rounded-md text-[11px] font-semibold border no-touch-target',
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

                {/* Probability is what turns three prices into a distribution.
                    Without it the scenarios are just three numbers and no
                    expected value can be computed. */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400 mr-0.5 w-14 shrink-0">Odds</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    value={probability}
                    onChange={e => setProbability(e.target.value)}
                    placeholder="optional"
                    className="flex-1 min-w-0 h-8 px-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[12px] tabular-nums text-gray-900 dark:text-gray-100"
                  />
                  <span className="text-[11px] text-gray-400">%</span>
                </div>
              </div>
            )}

            {/* Every analyst holding this scenario, the reader included — the
                firm view is the summary of all of them, so leaving your own
                target out of the list made the average look wrong. */}
            {isFirmView && all.length > 0 && !isEditing && (
              <ul className="mt-1.5 pl-[1.375rem] space-y-0.5">
                {all.map(t => (
                  <li key={t.id} className="flex items-baseline gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="truncate max-w-[7rem]">
                      {t.user_id === user?.id ? 'You' : (t.user?.full_name ?? 'Colleague')}
                    </span>
                    <span className="tabular-nums font-medium text-gray-700 dark:text-gray-300">
                      ${Number(t.price).toFixed(2)}
                    </span>
                    <span>{t.timeframe || '—'}</span>
                    {t.probability != null && (
                      <span className="ml-auto tabular-nums">{Number(t.probability).toFixed(0)}%</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}

      <RiskReward
        rows={rows}
        priceTargets={priceTargets ?? []}
        currentPrice={currentPrice}
        viewFilter={viewFilter}
        userId={user?.id}
      />
    </div>
  )
}

/**
 * The probability distribution across scenarios, and what it implies.
 *
 * Three prices without weights are not a view — Bull $200 / Base $150 / Bear
 * $100 says nothing until you know which one the author actually expects. The
 * desktop page exposes this through ProbabilityDistributionModal; the phone had
 * no equivalent at all, so probabilities entered on desktop were invisible here
 * and the risk/reward the case implies could not be read.
 *
 * Expected value is probability-weighted and shown only when the weights are
 * close to complete. A partial distribution produces a number that looks
 * authoritative and is not, so below the threshold it says what is missing
 * instead of printing a figure.
 */
function RiskReward({
  rows,
  priceTargets,
  currentPrice,
  viewFilter,
  userId,
}: {
  rows: { id: string; name: string; color: string | null }[]
  priceTargets: any[]
  currentPrice: number | null
  viewFilter: 'aggregated' | string
  userId?: string
}) {
  const dist = useMemo(() => {
    return rows
      .map(scenario => {
        const forScenario = priceTargets.filter(t => t.scenario_id === scenario.id)
        // On the firm view every analyst's weights are averaged, matching how
        // the price itself is aggregated one row above.
        const relevant =
          viewFilter === 'aggregated'
            ? forScenario
            : forScenario.filter(t => t.user_id === viewFilter)
        if (!relevant.length) return null

        const withProb = relevant.filter(t => t.probability != null)
        return {
          id: scenario.id,
          name: scenario.name,
          color: scenario.color || '#6b7280',
          price: relevant.reduce((s, t) => s + Number(t.price), 0) / relevant.length,
          probability: withProb.length
            ? withProb.reduce((s, t) => s + Number(t.probability), 0) / withProb.length
            : null,
        }
      })
      .filter(Boolean) as {
        id: string; name: string; color: string; price: number; probability: number | null
      }[]
  }, [rows, priceTargets, viewFilter])

  if (dist.length === 0) return null

  const weighted = dist.filter(d => d.probability != null)
  const totalProb = weighted.reduce((s, d) => s + (d.probability ?? 0), 0)
  // Within 5 points of 100 is close enough to weight honestly; rounding across
  // three analysts rarely lands exactly on the nose.
  const complete = weighted.length === dist.length && Math.abs(totalProb - 100) <= 5
  const ev = complete
    ? weighted.reduce((s, d) => s + d.price * ((d.probability ?? 0) / 100), 0) / (totalProb / 100)
    : null
  const evUpside =
    ev != null && currentPrice != null && currentPrice > 0
      ? ((ev - currentPrice) / currentPrice) * 100
      : null

  const owner = viewFilter === 'aggregated' ? 'Firm' : viewFilter === userId ? 'Your' : "Analyst's"

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline gap-2 mb-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Risk / reward
        </h4>
        {ev != null ? (
          <span className="ml-auto text-xs font-semibold tabular-nums text-gray-900 dark:text-white">
            {owner} EV ${ev.toFixed(2)}
            {evUpside != null && (
              <span className={clsx('ml-1', evUpside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {evUpside >= 0 ? '+' : ''}{evUpside.toFixed(0)}%
              </span>
            )}
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-gray-400">
            {weighted.length === 0
              ? 'no probabilities set'
              : `weights total ${totalProb.toFixed(0)}%`}
          </span>
        )}
      </div>

      {/* A stacked bar rather than three separate meters: the scenarios are
          mutually exclusive and should visibly compete for the same 100%. */}
      <div className="flex h-2 w-full rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
        {weighted.map(d => (
          <span
            key={d.id}
            className="block h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${totalProb > 0 ? ((d.probability ?? 0) / totalProb) * 100 : 0}%`,
              backgroundColor: d.color,
            }}
            aria-hidden
          />
        ))}
      </div>

      <ul className="mt-2 space-y-1">
        {dist.map(d => {
          const upside =
            currentPrice != null && currentPrice > 0
              ? ((d.price - currentPrice) / currentPrice) * 100
              : null
          return (
            <li key={d.id} className="flex items-center gap-2 text-[11px]">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} aria-hidden />
              <span className="w-16 shrink-0 truncate text-gray-600 dark:text-gray-300">{d.name}</span>
              <span className="tabular-nums font-medium text-gray-900 dark:text-white">
                ${d.price.toFixed(2)}
              </span>
              {upside != null && (
                <span
                  className={clsx(
                    'tabular-nums',
                    upside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {upside >= 0 ? '+' : ''}{upside.toFixed(0)}%
                </span>
              )}
              <span className="ml-auto tabular-nums text-gray-500 dark:text-gray-400">
                {d.probability != null ? `${d.probability.toFixed(0)}%` : '—'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
