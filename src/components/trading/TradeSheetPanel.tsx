/**
 * Trade Sheet Panel
 *
 * Displays created Trade Sheets for the current simulation.
 * Click a trade sheet to expand and see the individual trades.
 * Trade sheet creation happens from the Simulation tab's summary panel.
 */

import React, { useState } from 'react'
import { FileText, Inbox, ChevronDown, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import type { TradeSheet, IntentVariant } from '../../types/trading'

// =============================================================================
// TYPES
// =============================================================================

interface TradeSheetPanelProps {
  tradeSheets: TradeSheet[]
  /** Map of asset_id → symbol for resolving variant asset names */
  assetSymbolMap?: Record<string, string>
  className?: string
}

const ACTION_COLORS: Record<string, string> = {
  buy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  add: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  sell: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  trim: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// =============================================================================
// TRADE ROW (inside expanded sheet)
// =============================================================================

function TradeRow({ variant, symbol }: { variant: IntentVariant; symbol: string }) {
  const c = variant.computed
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
        {symbol}
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

// =============================================================================
// TRADE SHEET LIST ITEM (expandable)
// =============================================================================

function SheetListItem({
  sheet,
  assetSymbolMap,
}: {
  sheet: TradeSheet
  assetSymbolMap: Record<string, string>
}) {
  const [expanded, setExpanded] = useState(false)
  const variants = sheet.variants_snapshot || []

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Header — clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {sheet.name}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {sheet.total_trades} trade{sheet.total_trades !== 1 ? 's' : ''} · ${sheet.total_notional.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span className={clsx(
            'px-2 py-0.5 text-xs font-medium rounded',
            sheet.status === 'executed' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
            sheet.status === 'approved' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
            sheet.status === 'pending_approval' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
            sheet.status === 'draft' && 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
            sheet.status === 'cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
          )}>
            {sheet.status.replace('_', ' ')}
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
                <TradeRow
                  key={v.id}
                  variant={v}
                  symbol={assetSymbolMap[v.asset_id] || 'Unknown'}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 dark:border-gray-700">
                <td colSpan={3} className="py-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                  Total
                </td>
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

// =============================================================================
// MAIN COMPONENT
// =============================================================================

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
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No trade sheets yet
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Create a trade sheet from the Simulation tab
          </p>
        </div>
      ) : (
        tradeSheets.map(sheet => (
          <SheetListItem
            key={sheet.id}
            sheet={sheet}
            assetSymbolMap={assetSymbolMap}
          />
        ))
      )}
    </div>
  )
}

export default TradeSheetPanel
