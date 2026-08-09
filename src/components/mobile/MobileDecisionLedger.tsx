import { clsx } from 'clsx'
import { AlertTriangle, ChevronRight, Clock, Target } from 'lucide-react'
import type { AccountabilityRow } from '../../types/decision-accountability'

interface MobileDecisionLedgerProps {
  rows: AccountabilityRow[]
  selectedId: string | null
  onSelect: (row: AccountabilityRow) => void
}

const EXECUTION_LABEL: Record<string, string> = {
  executed: 'Executed',
  pending: 'Pending',
  possible_match: 'Likely match',
  unmatched: 'Never executed',
  skipped: 'Skipped',
}

const EXECUTION_TONE: Record<string, string> = {
  executed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  pending: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  possible_match: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  unmatched: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  skipped: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

/**
 * The decision ledger on a phone.
 *
 * The desktop row is a twelve-column CSS grid of fixed pixel tracks totalling
 * over a thousand — asset, direction, stage, dates, owner, approver, execution
 * state, decision price, current price, move, delay cost. It does not compress;
 * at 390px the tracks simply overflow their container.
 *
 * A decision is read here as a sentence rather than a spreadsheet row: what was
 * decided, whether it happened, and what the name has done since. Those three
 * become the card, and everything else stays in the detail view — which is
 * where the desktop puts it too, in the right-hand pane.
 *
 * The move is stated as a directional figure, matching the page's metric
 * honesty note: it is (current − decision) / decision signed by the direction
 * of the trade, a directional proxy rather than attributed P&L, so it is
 * labelled "since decision" rather than "return".
 */
export function MobileDecisionLedger({ rows, selectedId, onSelect }: MobileDecisionLedgerProps) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-gray-400">
        <Target className="h-8 w-8 opacity-50" />
        <p className="text-sm text-center">No decisions match these filters.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map(row => {
        const move = row.move_since_decision_pct
        const positive = (move ?? 0) >= 0
        const unmatchedAndOld =
          row.execution_status === 'unmatched' && (row.days_since_decision ?? 0) > 30

        return (
          <button
            key={row.decision_id}
            type="button"
            onClick={() => onSelect(row)}
            className={clsx(
              'w-full text-left px-3 py-3 active:bg-gray-50 dark:active:bg-gray-800',
              selectedId === row.decision_id && 'bg-primary-50 dark:bg-primary-900/20',
              unmatchedAndOld && selectedId !== row.decision_id && 'bg-red-50/40 dark:bg-red-900/10'
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide',
                  row.direction === 'increase'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : row.direction === 'decrease'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                )}
              >
                {row.direction === 'increase' ? 'Buy' : row.direction === 'decrease' ? 'Sell' : '—'}
              </span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">
                {row.asset_symbol ?? '—'}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
                {row.asset_name}
              </span>

              {move != null && (
                <span
                  className={clsx(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {positive ? '+' : ''}
                  {move.toFixed(1)}%
                </span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span
                className={clsx(
                  'px-1.5 py-0.5 rounded font-medium',
                  EXECUTION_TONE[row.execution_status] ?? EXECUTION_TONE.skipped
                )}
              >
                {EXECUTION_LABEL[row.execution_status] ?? row.execution_status}
              </span>

              {unmatchedAndOld && (
                <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  {row.days_since_decision}d
                </span>
              )}

              {row.days_since_decision != null && !unmatchedAndOld && (
                <span className="inline-flex items-center gap-1 text-gray-400">
                  <Clock className="h-3 w-3" />
                  {row.days_since_decision}d ago
                </span>
              )}

              {row.portfolio_name && (
                <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">
                  {row.portfolio_name}
                </span>
              )}

              {/* The move is meaningless without knowing what it is measured
                  from, and a row with no decision-time snapshot has nothing to
                  measure from at all. Saying so beats an empty column. */}
              {!row.has_decision_price && (
                <span className="ml-auto text-gray-400">no decision price</span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
