/**
 * The standalone Trades list on a phone.
 *
 * The desktop surface is a twelve-column table — Symbol, Action, Tgt Wt, Δ Wt,
 * Δ Shrs, Notional, State, Next action, Source, Batch, Actions — pinned to a
 * 720px minimum with two frozen columns. At 390px that is a sideways drag with
 * the ticker nailed to the left edge, and the execution-status control, which
 * is the one writable thing on the row, sits in the last column. It was
 * technically present and practically unreachable.
 *
 * A row here answers what a trader scans for, in the order they ask it: which
 * name and which direction, how big, what it does to the weight, how many
 * shares, and where it stands. Everything else — source, batch, next action,
 * the rationale — is in the detail, exactly as on desktop.
 *
 * The numbers come from the same `AcceptedTradeWithJoins` the table reads and
 * are formatted by the same helpers in `lib/trade-book/format`, so a trade
 * cannot read one way here and another way in the table. In particular the
 * notional sign is derived from `action`, because `notional_value` is stored
 * as an unsigned magnitude.
 */

import { clsx } from 'clsx'
import { ChevronRight } from 'lucide-react'
import type { AcceptedTradeWithJoins, ExecutionStatus, TradeAction } from '../../types/trading'
import {
  signedNotional, fmtSignedNotional, fmtSignedNotionalFull,
  fmtTargetWeight, fmtDeltaWeight, fmtDeltaShares, directionalToneClass,
} from '../../lib/trade-book/format'
import { ExecutionStatusDropdown } from './ExecutionStatusDropdown'

/** Matches the table's action colours so one trade reads the same on both. */
const ACTION_TONE: Record<string, string> = {
  buy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  add: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  sell: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  trim: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export interface MobileTradeRowsProps {
  trades: AcceptedTradeWithJoins[]
  selectedTradeId: string | null
  onSelect: (tradeId: string) => void
  /** The lifecycle pill already computed by the caller, so the phase rules
   *  are not re-derived here. */
  renderState?: (trade: AcceptedTradeWithJoins) => React.ReactNode
  /**
   * Execution status write. Passed only when the caller has decided the user
   * may write — the same three gates the table applies (non-paper holdings,
   * permission, and a phase where a transition means anything). Omitted means
   * the status is shown read-only, never that it is hidden.
   */
  onUpdateExecutionStatus?: (tradeId: string, status: ExecutionStatus) => void
  canUpdateExecution?: boolean
  /** Phases where a transition is meaningless; the status still shows. */
  isTerminalPhase?: (trade: AcceptedTradeWithJoins) => boolean
}

export function MobileTradeRows({
  trades,
  selectedTradeId,
  onSelect,
  renderState,
  onUpdateExecutionStatus,
  canUpdateExecution = false,
  isTerminalPhase,
}: MobileTradeRowsProps) {
  if (trades.length === 0) {
    return (
      <p data-slot="trades-empty" className="px-4 py-12 text-center text-sm text-gray-400">
        No trades match these filters.
      </p>
    )
  }

  return (
    <ul
      data-slot="mobile-trade-rows"
      className="divide-y divide-gray-100 dark:divide-gray-800"
    >
      {trades.map(trade => {
        const signed = signedNotional(trade.notional_value, trade.action)
        const writable = canUpdateExecution
          && !!onUpdateExecutionStatus
          && !(isTerminalPhase?.(trade) ?? false)

        return (
          <li key={trade.id} data-slot="mobile-trade-row" data-trade-id={trade.id}>
            <button
              type="button"
              onClick={() => onSelect(trade.id)}
              className={clsx(
                'w-full px-3 py-2.5 text-left active:bg-gray-50 dark:active:bg-gray-800',
                selectedTradeId === trade.id && 'bg-primary-50/60 dark:bg-primary-950/20',
              )}
            >
              {/* Identity and size on one line: which trade, how big. */}
              <span className="flex items-baseline gap-2">
                <span className="text-[15px] font-bold text-gray-900 dark:text-white">
                  {trade.asset?.symbol || 'Unknown'}
                </span>
                <span
                  className={clsx(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                    ACTION_TONE[trade.action] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                  )}
                >
                  {trade.action}
                </span>
                <span
                  className={clsx(
                    'ml-auto shrink-0 text-[15px] font-semibold tabular-nums',
                    directionalToneClass(signed),
                  )}
                  title={fmtSignedNotionalFull(signed)}
                >
                  {fmtSignedNotional(signed)}
                </span>
              </span>

              <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                {trade.asset?.company_name}
              </span>

              {/* What it does to the book. Target weight is where the position
                  lands; the delta is what this trade moved. */}
              <span className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px] tabular-nums">
                <span className="text-gray-500 dark:text-gray-400">
                  Tgt <span className="font-medium text-gray-700 dark:text-gray-300">{fmtTargetWeight(trade.target_weight)}</span>
                </span>
                <span className={directionalToneClass(trade.delta_weight)}>
                  {fmtDeltaWeight(trade.delta_weight)}
                </span>
                <span className={directionalToneClass(trade.delta_shares)}>
                  {fmtDeltaShares(trade.delta_shares)} sh
                </span>
              </span>
            </button>

            {/* Status sits outside the row button: when it is writable it is
                a control of its own, and a button cannot nest a button. */}
            <div className="flex items-center gap-2 px-3 pb-2.5">
              {writable ? (
                <div onClick={e => e.stopPropagation()}>
                  <ExecutionStatusDropdown
                    status={trade.execution_status}
                    onChange={status => onUpdateExecutionStatus!(trade.id, status)}
                  />
                </div>
              ) : (
                renderState?.(trade)
              )}
              <button
                type="button"
                onClick={() => onSelect(trade.id)}
                aria-label={`Open ${trade.asset?.symbol || 'trade'} detail`}
                className="no-touch-target tap-pad ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-400"
              >
                Detail
                <ChevronRight aria-hidden className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Exported for the detail summary, which names the same action the same way. */
export function actionToneClass(action: TradeAction | string): string {
  return ACTION_TONE[action] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}
