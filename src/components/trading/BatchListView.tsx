/**
 * BatchListView — Batch grouping view for the Trade Book.
 *
 * Batches are pure grouping/context objects — they represent trades that were
 * committed together. They do not gate execution or imply review/approval workflow.
 * Trade Book is post-decision and immediately actionable.
 */

import React, { useMemo } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import {
  Layers,
  Inbox,
  FlaskConical,
  Plus,
  ArrowRight,
  DollarSign,
  BarChart3,
  CalendarDays,
  XCircle,
} from 'lucide-react'
import { clsx } from 'clsx'
import type {
  TradeBatch,
  AcceptedTradeWithJoins,
} from '../../types/trading'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_CONFIG: Record<string, { icon: React.ElementType; label: string }> = {
  inbox: { icon: Inbox, label: 'Decision Inbox' },
  simulation: { icon: FlaskConical, label: 'Simulation' },
  adhoc: { icon: Plus, label: 'Ad-hoc' },
  mixed: { icon: Layers, label: 'Mixed' },
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BatchListViewProps {
  batches: TradeBatch[]
  trades: AcceptedTradeWithJoins[]
  selectedBatchId: string | null
  onSelectBatch: (batchId: string | null) => void
  onViewBatchTrades: (batchId: string) => void
}

// ---------------------------------------------------------------------------
// Stat pill
// ---------------------------------------------------------------------------

function StatPill({ icon: Icon, label, value }: {
  icon: React.ElementType
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-700 dark:text-gray-200">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Batch Detail (selected batch summary)
// ---------------------------------------------------------------------------

function BatchDetail({
  batch,
  tradeCount,
  totalNotional,
  onViewTrades,
  onClose,
}: {
  batch: TradeBatch
  tradeCount: number
  totalNotional: number
  onViewTrades: () => void
  onClose: () => void
}) {
  const source = SOURCE_CONFIG[batch.source_type] || SOURCE_CONFIG.mixed

  return (
    <div className="border-b-2 border-blue-200 dark:border-blue-800/50 bg-blue-50/30 dark:bg-blue-950/10 px-6 py-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
            <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
              {batch.name || 'Untitled Batch'}
            </h3>
            {batch.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{batch.description}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-5 mb-4">
        <StatPill icon={BarChart3} label="Trades" value={tradeCount} />
        {totalNotional !== 0 && (
          <StatPill icon={DollarSign} label="Notional" value={`$${Math.abs(totalNotional).toLocaleString()}`} />
        )}
        <StatPill icon={source.icon} label="Source" value={source.label} />
        <StatPill icon={CalendarDays} label="Created" value={format(new Date(batch.created_at), 'MMM d, yyyy')} />
      </div>

      {/* View Trades */}
      <button
        onClick={onViewTrades}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        View Trades
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Batch Card
// ---------------------------------------------------------------------------

function BatchCard({
  batch,
  stats,
  isSelected,
  onSelect,
  onViewTrades,
}: {
  batch: TradeBatch
  stats: { count: number; notional: number }
  isSelected: boolean
  onSelect: () => void
  onViewTrades: () => void
}) {
  const source = SOURCE_CONFIG[batch.source_type] || SOURCE_CONFIG.mixed
  const SourceIcon = source.icon

  return (
    <div
      className={clsx(
        'rounded-lg border transition-all cursor-pointer',
        isSelected
          ? 'ring-2 ring-blue-300 dark:ring-blue-700 border-blue-200 dark:border-blue-800/50 bg-white dark:bg-gray-800/80 shadow-sm'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600'
      )}
      onClick={onSelect}
    >
      {/* Top accent */}
      <div className="h-1 rounded-t-lg bg-blue-100 dark:bg-blue-900/30" />

      <div className="px-4 py-3.5">
        {/* Name */}
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {batch.name || 'Untitled Batch'}
            </span>
          </div>
          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex-shrink-0">
            {stats.count} trade{stats.count !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-[12px]">
          {stats.notional !== 0 && (
            <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
              <DollarSign className="w-3 h-3 text-gray-400" />
              <span className="font-medium">${Math.abs(stats.notional).toLocaleString()}</span>
            </span>
          )}
          <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <SourceIcon className="w-3 h-3" />
            {source.label}
          </span>
          <span className="text-gray-400 dark:text-gray-500 ml-auto">
            {formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })}
          </span>
        </div>

        {/* Quick action when selected */}
        {isSelected && (
          <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/50">
            <button
              onClick={(e) => { e.stopPropagation(); onViewTrades() }}
              className="flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
            >
              View trades in this batch
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export function BatchListView({
  batches,
  trades,
  selectedBatchId,
  onSelectBatch,
  onViewBatchTrades,
}: BatchListViewProps) {
  const batchStats = useMemo(() => {
    const map = new Map<string, { count: number; notional: number }>()
    for (const t of trades) {
      if (!t.batch_id) continue
      const prev = map.get(t.batch_id) || { count: 0, notional: 0 }
      map.set(t.batch_id, {
        count: prev.count + 1,
        notional: prev.notional + (t.notional_value ?? 0),
      })
    }
    return map
  }, [trades])

  const selectedBatch = batches.find(b => b.id === selectedBatchId) || null

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <Layers className="w-7 h-7 text-gray-400" />
        </div>
        <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">No batches yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 max-w-sm leading-relaxed">
          Batches group trades that were committed together.
          Promote trades from the Trade Lab simulation to create your first batch.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Detail panel */}
      {selectedBatch && (
        <BatchDetail
          batch={selectedBatch}
          tradeCount={batchStats.get(selectedBatch.id)?.count ?? 0}
          totalNotional={batchStats.get(selectedBatch.id)?.notional ?? 0}
          onViewTrades={() => onViewBatchTrades(selectedBatch.id)}
          onClose={() => onSelectBatch(null)}
        />
      )}

      {/* Batch cards */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="grid gap-3">
          {batches.map(batch => (
            <BatchCard
              key={batch.id}
              batch={batch}
              stats={batchStats.get(batch.id) || { count: 0, notional: 0 }}
              isSelected={selectedBatchId === batch.id}
              onSelect={() => onSelectBatch(selectedBatchId === batch.id ? null : batch.id)}
              onViewTrades={() => onViewBatchTrades(batch.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
