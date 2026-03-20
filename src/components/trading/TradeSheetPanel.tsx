/**
 * Trade Sheet Panel
 *
 * Displays created Trade Sheets for the current simulation.
 * Draft sheets can be committed, which auto-resolves matching recommendations.
 */

import React, { useState } from 'react'
import { FileText, Inbox, ChevronDown, ChevronRight, CheckCircle2, Send, FileCheck } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { commitTradeSheet } from '../../lib/services/trade-sheet-reconciliation-service'
import type { TradeSheet, IntentVariant } from '../../types/trading'

interface TradeSheetPanelProps {
  tradeSheets: TradeSheet[]
  assetSymbolMap?: Record<string, string>
  className?: string
}

const ACTION_COLORS: Record<string, string> = {
  buy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  add: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  sell: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  trim: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  committed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  sent_to_desk: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  executed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  committed: 'Committed',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  sent_to_desk: 'Sent to Desk',
  executed: 'Executed',
  cancelled: 'Cancelled',
}

function TradeRow({ variant, symbol }: { variant: IntentVariant; symbol: string }) {
  const c = variant.computed
  const hasProposal = !!(variant as any).proposal_id
  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <td className="py-1.5 pr-3">
        <span className={clsx(
          'inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded',
          ACTION_COLORS[variant.action] || 'bg-gray-100 text-gray-600'
        )}>
          {variant.action}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-[13px] font-medium text-gray-900 dark:text-white">
        <span className="flex items-center gap-1.5">
          {symbol}
          {hasProposal && (
            <FileCheck className="h-3 w-3 text-teal-500 dark:text-teal-400" title="From analyst recommendation" />
          )}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-[13px] font-mono text-gray-600 dark:text-gray-300">
        {variant.sizing_input}
      </td>
      <td className="py-1.5 pr-3 text-[13px] font-mono text-right text-gray-600 dark:text-gray-300">
        {c ? `${c.delta_shares > 0 ? '+' : ''}${c.delta_shares.toLocaleString()}` : '—'}
      </td>
      <td className="py-1.5 pr-3 text-[13px] font-mono text-right text-gray-600 dark:text-gray-300">
        {c ? `${c.delta_weight > 0 ? '+' : ''}${c.delta_weight.toFixed(2)}%` : '—'}
      </td>
      <td className="py-1.5 text-[13px] font-mono text-right text-gray-600 dark:text-gray-300">
        {c ? `$${Math.abs(c.notional_value).toLocaleString()}` : '—'}
      </td>
    </tr>
  )
}

function SheetListItem({
  sheet,
  assetSymbolMap,
}: {
  sheet: TradeSheet
  assetSymbolMap: Record<string, string>
}) {
  const [expanded, setExpanded] = useState(false)
  const variants = sheet.variants_snapshot || []
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const commitMutation = useMutation({
    mutationFn: () => commitTradeSheet(sheet.id, user!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-sheets'] })
    },
  })

  // Count variants from recommendations
  const recCount = variants.filter((v: any) => v.proposal_id).length
  const isDraft = sheet.status === 'draft'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          }
          <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {sheet.name}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              {sheet.total_trades} trade{sheet.total_trades !== 1 ? 's' : ''} · ${sheet.total_notional.toLocaleString()}
              {recCount > 0 && (
                <span className="text-teal-600 dark:text-teal-400 flex items-center gap-0.5">
                  · <FileCheck className="h-3 w-3" /> {recCount} from recs
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span className={clsx('px-2 py-0.5 text-xs font-medium rounded', STATUS_STYLES[sheet.status] || STATUS_STYLES.draft)}>
            {STATUS_LABELS[sheet.status] || sheet.status}
          </span>
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(sheet.created_at), { addSuffix: true })}
          </span>
        </div>
      </button>

      {/* Expanded trade details */}
      {expanded && variants.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50/50 dark:bg-gray-900/30">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                <th className="text-left py-1 pr-3">Action</th>
                <th className="text-left py-1 pr-3">Symbol</th>
                <th className="text-left py-1 pr-3">Sizing</th>
                <th className="text-right py-1 pr-3">Shares</th>
                <th className="text-right py-1 pr-3">Weight</th>
                <th className="text-right py-1">Notional</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v: IntentVariant) => (
                <TradeRow key={v.id} variant={v} symbol={assetSymbolMap[v.asset_id] || 'Unknown'} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 dark:border-gray-700">
                <td colSpan={3} className="py-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400">Total</td>
                <td className="py-1.5 text-[13px] font-mono font-semibold text-right text-gray-700 dark:text-gray-200">
                  {variants.reduce((sum: number, v: IntentVariant) => sum + (v.computed?.delta_shares ?? 0), 0).toLocaleString()}
                </td>
                <td className="py-1.5 text-[13px] font-mono font-semibold text-right text-gray-700 dark:text-gray-200">
                  {variants.reduce((sum: number, v: IntentVariant) => sum + (v.computed?.delta_weight ?? 0), 0).toFixed(2)}%
                </td>
                <td className="py-1.5 text-[13px] font-mono font-semibold text-right text-gray-700 dark:text-gray-200">
                  ${Math.abs(variants.reduce((sum: number, v: IntentVariant) => sum + (v.computed?.notional_value ?? 0), 0)).toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Commit action for draft sheets */}
          {isDraft && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Finalize this snapshot ({variants.length} trade{variants.length !== 1 ? 's' : ''})
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); commitMutation.mutate() }}
                disabled={commitMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {commitMutation.isPending ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Commit Trade Sheet
              </button>
            </div>
          )}

          {/* Committed confirmation */}
          {sheet.status === 'committed' && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-blue-600 dark:text-blue-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Committed {sheet.committed_at ? formatDistanceToNow(new Date(sheet.committed_at), { addSuffix: true }) : ''}</span>
            </div>
          )}
        </div>
      )}

      {expanded && variants.length === 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-4 text-center text-xs text-gray-400">
          No trade details available
        </div>
      )}
    </div>
  )
}

export function TradeSheetPanel({
  tradeSheets,
  assetSymbolMap = {},
  className = '',
}: TradeSheetPanelProps) {
  return (
    <div className={clsx('space-y-2', className)}>
      {tradeSheets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No trade sheets yet</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Create a trade sheet from the Simulation tab</p>
        </div>
      ) : (
        tradeSheets.map(sheet => (
          <SheetListItem key={sheet.id} sheet={sheet} assetSymbolMap={assetSymbolMap} />
        ))
      )}
    </div>
  )
}

export default TradeSheetPanel
