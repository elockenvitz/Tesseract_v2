import { useMemo, useState } from 'react'
import { Check, Pencil, Plus, X } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import {
  useAnalystEstimates,
  useEstimateMetrics,
  type AnalystEstimate,
} from '../../../hooks/useAnalystEstimates'

interface MobileEstimatesFieldProps {
  assetId: string
  title: string
  viewFilter?: 'aggregated' | string
}

/**
 * Financial estimates on a phone.
 *
 * The desktop view is a metric-by-period grid. A grid is the wrong shape at
 * 390px — it either scrolls sideways, which hides the column headings that
 * give each number meaning, or shrinks the type past reading. This pivots to
 * one card per metric with its periods listed inside, so every number stays
 * beside the label and year that identify it.
 *
 * Editing is per cell and numeric-only. An estimate is a single figure, so the
 * cheapest correct control is a number field that commits on confirm — no
 * form, no draft state, nothing to lose track of on a small screen.
 */
export function MobileEstimatesField({
  assetId,
  title,
  viewFilter = 'aggregated',
}: MobileEstimatesFieldProps) {
  const { user } = useAuth()
  const { estimates, isLoading, saveEstimate } = useAnalystEstimates({ assetId })
  const { metrics } = useEstimateMetrics()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [newMetric, setNewMetric] = useState('')
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()))
  const [newValue, setNewValue] = useState('')

  const isOwnView = viewFilter === 'aggregated' || viewFilter === user?.id

  const visible = useMemo(() => {
    if (viewFilter === 'aggregated') return estimates
    return estimates.filter(e => e.user_id === viewFilter)
  }, [estimates, viewFilter])

  // Grouped by metric, then ordered by period, because a reader compares one
  // metric across years far more often than many metrics within a year.
  const byMetric = useMemo(() => {
    const groups = new Map<string, { label: string; format: string; rows: AnalystEstimate[] }>()
    for (const e of visible) {
      const key = e.metric_key
      if (!groups.has(key)) {
        groups.set(key, {
          label: e.metric?.label ?? key,
          format: e.metric?.format ?? 'number',
          rows: [],
        })
      }
      groups.get(key)!.rows.push(e)
    }
    for (const g of groups.values()) {
      g.rows.sort(
        (a, b) => a.fiscal_year - b.fiscal_year || (a.fiscal_quarter ?? 0) - (b.fiscal_quarter ?? 0)
      )
    }
    return [...groups.entries()]
  }, [visible])

  if (isLoading) {
    return <div className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
  }

  const commit = (estimate: AnalystEstimate) => {
    const value = parseFloat(draft)
    // A blank or unparseable entry means "I did not mean to change this",
    // not zero — writing 0 would silently overwrite a real estimate.
    if (Number.isFinite(value)) {
      saveEstimate.mutate({
        metricKey: estimate.metric_key,
        periodType: estimate.period_type,
        fiscalYear: estimate.fiscal_year,
        fiscalQuarter: estimate.fiscal_quarter,
        value,
        currency: estimate.currency,
      })
    }
    setEditing(null)
  }

  const addEstimate = () => {
    const value = parseFloat(newValue)
    const year = parseInt(newYear, 10)
    const metricKey = newMetric || (metrics ?? [])[0]?.key
    if (metricKey && Number.isFinite(value) && Number.isFinite(year)) {
      saveEstimate.mutate({
        metricKey,
        periodType: 'annual',
        fiscalYear: year,
        fiscalQuarter: null,
        value,
      })
    }
    setAdding(false)
    setNewValue('')
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <h3 className="flex-1 min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {title}
        </h3>
        {isOwnView && !adding && (metrics ?? []).length > 0 && (
          <button
            type="button"
            onClick={() => {
              setNewMetric((metrics ?? [])[0]?.key ?? '')
              setAdding(true)
            }}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-primary-600 dark:text-primary-400 active:bg-primary-50 dark:active:bg-primary-900/30 no-touch-target"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>

      {/* Adding a figure needs the metric list, not just the rows that already
          exist. Without this the field could only edit estimates made
          elsewhere, which is no use on an asset nobody has modelled yet. */}
      {adding && (
        <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-2">
            <select
              value={newMetric}
              onChange={e => setNewMetric(e.target.value)}
              className="flex-1 min-w-0 h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
            >
              {(metrics ?? []).map(m => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              inputMode="numeric"
              value={newYear}
              onChange={e => setNewYear(e.target.value)}
              aria-label="Fiscal year"
              className="w-20 shrink-0 h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm tabular-nums text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder="Value"
              className="flex-1 min-w-0 h-9 px-2 rounded-lg border border-primary-500 bg-white dark:bg-gray-800 text-sm tabular-nums text-gray-900 dark:text-gray-100 focus:outline-none"
            />
            <button
              type="button"
              onClick={addEstimate}
              disabled={saveEstimate.isPending}
              className="h-9 px-3 shrink-0 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-50 no-touch-target"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-gray-500 no-touch-target"
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {byMetric.length === 0 ? (
        <p className="px-3 py-2.5 text-sm text-gray-400">
          {isOwnView ? 'No estimates yet — add one above.' : 'No estimates from this analyst.'}
        </p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {byMetric.map(([key, group]) => (
            <div key={key} className="px-3 py-2.5">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {group.label}
              </h4>
              <ul className="space-y-1">
                {group.rows.map(row => {
                  const mine = row.user_id === user?.id
                  const period = row.fiscal_quarter
                    ? `${row.fiscal_year} Q${row.fiscal_quarter}`
                    : `FY${row.fiscal_year}`
                  return (
                    <li key={row.id} className="flex items-center gap-2 min-h-[32px]">
                      <span className="w-16 shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">
                        {period}
                      </span>

                      {editing === row.id ? (
                        <>
                          <input
                            type="number"
                            inputMode="decimal"
                            autoFocus
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            className="flex-1 min-w-0 h-9 px-2 rounded-lg border border-primary-500 bg-white dark:bg-gray-800 text-sm tabular-nums text-gray-900 dark:text-gray-100 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => commit(row)}
                            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-primary-600 text-white no-touch-target"
                            aria-label="Save estimate"
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
                          <span className="flex-1 min-w-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                            {formatValue(row.value, group.format, row.currency)}
                          </span>
                          {viewFilter === 'aggregated' && !mine && (
                            <span className="shrink-0 text-[11px] text-gray-400 truncate max-w-[6rem]">
                              {row.user?.full_name ?? 'Colleague'}
                            </span>
                          )}
                          {mine && isOwnView && (
                            <button
                              type="button"
                              onClick={() => {
                                setDraft(String(row.value))
                                setEditing(row.id)
                              }}
                              className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-primary-600 dark:text-primary-400 no-touch-target"
                              aria-label={`Edit ${group.label} ${period}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Mirrors the metric's declared format so a phone reads the same as desktop. */
function formatValue(value: number, format: string, currency: string): string {
  switch (format) {
    case 'currency':
      return `${currency === 'USD' ? '$' : ''}${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'ratio':
      return `${value.toFixed(2)}x`
    default:
      return value.toLocaleString()
  }
}
