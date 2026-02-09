/**
 * Execution Readiness Panel (Trade Lab v3)
 *
 * Persistent right sidebar answering: "Can I create a Trade Sheet?"
 * Shows summary stats, readiness indicator, blockers, warnings,
 * and Create Trade Sheet CTA.
 */

import React, { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  Shield,
} from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import type {
  IntentVariant,
  SizingValidationError,
  TradeAction,
} from '../../types/trading'

// =============================================================================
// TYPES
// =============================================================================

interface ConflictSummary {
  total: number
  conflicts: number
  warnings: number
  canCreateTradeSheet: boolean
}

export interface ExecutionReadinessPanelProps {
  variants: IntentVariant[]
  conflictSummary: ConflictSummary
  totalNotional: number
  isCreatingSheet: boolean
  onFixConflict: (variantId: string, suggestedAction: TradeAction) => void
  onCreateTradeSheet: (name: string, description?: string) => Promise<void>
  onAddTrade: () => void
  className?: string
}

// =============================================================================
// HELPERS
// =============================================================================

function formatNotional(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

// =============================================================================
// BLOCKER ITEM
// =============================================================================

function BlockerItem({
  variant,
  onFix,
}: {
  variant: IntentVariant
  onFix: (suggestedAction: TradeAction) => void
}) {
  const conflict = variant.direction_conflict as SizingValidationError | null
  if (!conflict) return null

  const symbol = (variant as any).asset?.symbol || 'Unknown'

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <AlertCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400 flex-shrink-0" />
        <div className="min-w-0">
          <span className="text-xs font-medium text-gray-900 dark:text-white">{symbol}</span>
          <span className="text-[10px] text-red-600 dark:text-red-400 block truncate">
            {conflict.message}
          </span>
        </div>
      </div>
      <button
        onClick={() => onFix(conflict.suggested_direction)}
        className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
      >
        Fix
      </button>
    </div>
  )
}

// =============================================================================
// WARNING ITEM
// =============================================================================

function WarningItem({ variant }: { variant: IntentVariant }) {
  if (!variant.below_lot_warning) return null

  const symbol = (variant as any).asset?.symbol || 'Unknown'

  return (
    <div className="flex items-center gap-1.5 py-1">
      <AlertTriangle className="w-3 h-3 text-amber-500 dark:text-amber-400 flex-shrink-0" />
      <span className="text-[10px] text-amber-700 dark:text-amber-400">{symbol}</span>
      <span className="text-[10px] text-gray-400">— below lot size</span>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ExecutionReadinessPanel({
  variants,
  conflictSummary,
  totalNotional,
  isCreatingSheet,
  onFixConflict,
  onCreateTradeSheet,
  onAddTrade,
  className = '',
}: ExecutionReadinessPanelProps) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [sheetName, setSheetName] = useState('')
  const [sheetDescription, setSheetDescription] = useState('')
  const [showBlockers, setShowBlockers] = useState(true)
  const [showWarnings, setShowWarnings] = useState(false)

  const isEmpty = conflictSummary.total === 0
  const isReady = conflictSummary.canCreateTradeSheet && conflictSummary.total > 0
  const hasBlockers = conflictSummary.conflicts > 0
  const hasWarnings = conflictSummary.warnings > 0

  const variantsWithConflicts = variants.filter(v => v.direction_conflict !== null)
  const variantsWithWarnings = variants.filter(v => v.below_lot_warning && !v.direction_conflict)

  const handleCreate = async () => {
    if (!sheetName.trim()) return
    await onCreateTradeSheet(sheetName.trim(), sheetDescription.trim() || undefined)
    setSheetName('')
    setSheetDescription('')
    setShowCreateForm(false)
  }

  return (
    <div className={clsx(
      'w-64 flex-shrink-0 border-l border-gray-200 dark:border-gray-700',
      'bg-white dark:bg-gray-800 flex flex-col overflow-y-auto',
      className
    )}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Execution
        </div>
      </div>

      {/* Stats section */}
      <div className="px-4 py-4 space-y-3 flex-1">
        {/* Variant count — large */}
        <div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums leading-none">
            {conflictSummary.total}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            trade{conflictSummary.total !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Total notional */}
        {totalNotional > 0 && (
          <div>
            <div className="text-lg font-semibold text-gray-700 dark:text-gray-300 tabular-nums leading-tight">
              {formatNotional(totalNotional)}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">total notional</div>
          </div>
        )}

        {/* Conflict count */}
        {hasBlockers && (
          <button
            onClick={() => setShowBlockers(!showBlockers)}
            className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 font-medium hover:underline"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {conflictSummary.conflicts} conflict{conflictSummary.conflicts !== 1 ? 's' : ''}
            {showBlockers ? (
              <ChevronUp className="w-3 h-3 ml-auto" />
            ) : (
              <ChevronDown className="w-3 h-3 ml-auto" />
            )}
          </button>
        )}

        {/* Expanded blocker list */}
        {hasBlockers && showBlockers && (
          <div className="space-y-0.5 pl-1 border-l-2 border-red-200 dark:border-red-800">
            {variantsWithConflicts.map(variant => (
              <BlockerItem
                key={variant.id}
                variant={variant}
                onFix={(action) => onFixConflict(variant.id, action)}
              />
            ))}
          </div>
        )}

        {/* Warning count */}
        {hasWarnings && (
          <button
            onClick={() => setShowWarnings(!showWarnings)}
            className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {conflictSummary.warnings} warning{conflictSummary.warnings !== 1 ? 's' : ''}
            {showWarnings ? (
              <ChevronUp className="w-3 h-3 ml-auto" />
            ) : (
              <ChevronDown className="w-3 h-3 ml-auto" />
            )}
          </button>
        )}

        {/* Expanded warning list */}
        {hasWarnings && showWarnings && (
          <div className="space-y-0.5 pl-1 border-l-2 border-amber-200 dark:border-amber-800">
            {variantsWithWarnings.slice(0, 5).map(variant => (
              <WarningItem key={variant.id} variant={variant} />
            ))}
            {variantsWithWarnings.length > 5 && (
              <div className="text-[10px] text-gray-400 py-0.5">
                +{variantsWithWarnings.length - 5} more
              </div>
            )}
          </div>
        )}
      </div>

      {/* Readiness + Actions — anchored to bottom */}
      <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-700/50 space-y-3">
        {/* Readiness indicator */}
        {isEmpty ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            Add trades to begin shaping your portfolio.
          </p>
        ) : isReady ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">READY</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              All trades are conflict-free.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">NOT READY</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
              {hasBlockers
                ? 'Resolve conflicts to proceed.'
                : 'Size all trades to proceed.'}
            </p>
          </div>
        )}

        {/* Create Trade Sheet */}
        {showCreateForm ? (
          <div className="space-y-2">
            <input
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="Sheet name"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            />
            <input
              type="text"
              value={sheetDescription}
              onChange={(e) => setSheetDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowCreateForm(false)} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!sheetName.trim() || isCreatingSheet}
                loading={isCreatingSheet}
                onClick={handleCreate}
                className="flex-1"
              >
                Create
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant={isReady ? 'primary' : 'secondary'}
            size="sm"
            disabled={!isReady || isCreatingSheet}
            loading={isCreatingSheet}
            onClick={() => setShowCreateForm(true)}
            className="w-full"
          >
            <FileText className="w-4 h-4 mr-1.5" />
            Create Trade Sheet
          </Button>
        )}

        {/* Add trade */}
        <button
          onClick={onAddTrade}
          className="w-full text-xs text-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors py-1"
        >
          + Add trade
        </button>
      </div>
    </div>
  )
}

export default ExecutionReadinessPanel
