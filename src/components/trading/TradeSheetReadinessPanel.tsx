/**
 * Trade Sheet Readiness Panel (Trade Lab v3)
 *
 * Prominent display of Trade Sheet creation readiness.
 * Shows blockers (conflicts) and warnings clearly.
 */

import React, { useState } from 'react'
import { Check, AlertCircle, AlertTriangle, ArrowRight, FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { IntentVariant, SizingValidationError, TradeAction, TradeSheet } from '../../types/trading'

// =============================================================================
// TYPES
// =============================================================================

interface ConflictSummary {
  total: number
  conflicts: number
  warnings: number
  canCreateTradeSheet: boolean
}

interface TradeSheetReadinessPanelProps {
  variants: IntentVariant[]
  conflictSummary: ConflictSummary
  tradeSheets: TradeSheet[]
  onCreateTradeSheet: (name: string, description?: string) => Promise<void>
  onFixConflict?: (variantId: string, suggestedAction: TradeAction) => void
  isCreating?: boolean
  className?: string
}

// =============================================================================
// BLOCKER ITEM
// =============================================================================

interface BlockerItemProps {
  variant: IntentVariant
  onFix?: (suggestedAction: TradeAction) => void
}

function BlockerItem({ variant, onFix }: BlockerItemProps) {
  const conflict = variant.direction_conflict as SizingValidationError | null
  if (!conflict) return null

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/10 rounded-md">
      <div className="flex items-center gap-2 min-w-0">
        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {(variant as any).asset?.symbol || 'Unknown'}
          </div>
          <div className="text-xs text-red-600 dark:text-red-400 truncate">
            {conflict.message}
          </div>
        </div>
      </div>

      {onFix && (
        <button
          type="button"
          onClick={() => onFix(conflict.suggested_direction)}
          className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <ArrowRight className="w-3 h-3" />
          {conflict.suggested_direction.toUpperCase()}
        </button>
      )}
    </div>
  )
}

// =============================================================================
// WARNING ITEM
// =============================================================================

interface WarningItemProps {
  variant: IntentVariant
}

function WarningItem({ variant }: WarningItemProps) {
  if (!variant.below_lot_warning) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/10 rounded-md">
      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
          {(variant as any).asset?.symbol || 'Unknown'}
        </div>
        <div className="text-xs text-amber-600 dark:text-amber-400">
          Below minimum lot size
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// CREATE FORM
// =============================================================================

interface CreateFormProps {
  onSubmit: (name: string, description?: string) => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
}

function CreateForm({ onSubmit, onCancel, isSubmitting }: CreateFormProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await onSubmit(name.trim(), description.trim() || undefined)
    setName('')
    setDescription('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Sheet Name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Q1 Rebalance"
          className="text-sm"
          disabled={isSubmitting}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Description (optional)
        </label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Notes about this trade sheet..."
          className="text-sm"
          disabled={isSubmitting}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!name.trim() || isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </form>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TradeSheetReadinessPanel({
  variants,
  conflictSummary,
  tradeSheets,
  onCreateTradeSheet,
  onFixConflict,
  isCreating = false,
  className = '',
}: TradeSheetReadinessPanelProps) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showBlockers, setShowBlockers] = useState(true)

  const variantsWithConflicts = variants.filter(v => v.direction_conflict !== null)
  const variantsWithWarnings = variants.filter(v => v.below_lot_warning && !v.direction_conflict)

  const isReady = conflictSummary.canCreateTradeSheet && conflictSummary.total > 0
  const hasBlockers = conflictSummary.conflicts > 0
  const hasWarnings = conflictSummary.warnings > 0

  // Calculate totals
  const totalNotional = variants.reduce((sum, v) => {
    const computed = v.computed as any
    return sum + (computed?.notional_value || 0)
  }, 0)

  const formatNotional = (value: number) => {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
    return `$${value.toFixed(0)}`
  }

  const handleCreate = async (name: string, description?: string) => {
    await onCreateTradeSheet(name, description)
    setShowCreateForm(false)
  }

  if (conflictSummary.total === 0) {
    return (
      <div className={clsx('p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700', className)}>
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <FileText className="w-5 h-5" />
          <span className="text-sm">Add trades to create a Trade Sheet</span>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('rounded-lg border overflow-hidden', className,
      isReady
        ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
    )}>
      {/* Header */}
      <div className="p-4">
        {/* Status Badge */}
        <div className="flex items-center justify-between mb-3">
          {isReady ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30">
                <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-green-700 dark:text-green-400">
                  Ready to Commit
                </div>
                <div className="text-xs text-green-600 dark:text-green-500">
                  {conflictSummary.total} variant{conflictSummary.total !== 1 ? 's' : ''} • {formatNotional(totalNotional)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                  Not Ready
                </div>
                <div className="text-xs text-red-600 dark:text-red-500">
                  {conflictSummary.conflicts} conflict{conflictSummary.conflicts !== 1 ? 's' : ''} must be resolved
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center px-2 py-1.5 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {conflictSummary.total}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Variants</div>
          </div>
          <div className={clsx(
            'text-center px-2 py-1.5 rounded border',
            hasBlockers
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
          )}>
            <div className={clsx(
              'text-lg font-semibold',
              hasBlockers ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
            )}>
              {conflictSummary.conflicts}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Conflicts</div>
          </div>
          <div className={clsx(
            'text-center px-2 py-1.5 rounded border',
            hasWarnings && !hasBlockers
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
          )}>
            <div className={clsx(
              'text-lg font-semibold',
              hasWarnings && !hasBlockers ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'
            )}>
              {conflictSummary.warnings}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Warnings</div>
          </div>
        </div>

        {/* Create Button or Form */}
        {showCreateForm ? (
          <CreateForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreateForm(false)}
            isSubmitting={isCreating}
          />
        ) : (
          <Button
            variant={isReady ? 'primary' : 'secondary'}
            size="sm"
            className="w-full"
            disabled={!isReady || isCreating}
            onClick={() => setShowCreateForm(true)}
          >
            <FileText className="w-4 h-4 mr-2" />
            {isCreating ? 'Creating...' : 'Create Trade Sheet'}
          </Button>
        )}
      </div>

      {/* Blockers Section */}
      {hasBlockers && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setShowBlockers(!showBlockers)}
            className="w-full flex items-center justify-between px-4 py-2 bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span className="text-sm font-medium text-red-700 dark:text-red-400">
                Blockers ({variantsWithConflicts.length})
              </span>
            </div>
            {showBlockers ? (
              <ChevronUp className="w-4 h-4 text-red-600 dark:text-red-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-red-600 dark:text-red-400" />
            )}
          </button>

          {showBlockers && (
            <div className="p-3 space-y-2 bg-white dark:bg-gray-900">
              {variantsWithConflicts.map(variant => (
                <BlockerItem
                  key={variant.id}
                  variant={variant}
                  onFix={onFixConflict ? (action) => onFixConflict(variant.id, action) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Warnings Section */}
      {variantsWithWarnings.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/10">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Warnings ({variantsWithWarnings.length}) - won't block
              </span>
            </div>
          </div>
          <div className="p-3 space-y-2 bg-white dark:bg-gray-900">
            {variantsWithWarnings.slice(0, 3).map(variant => (
              <WarningItem key={variant.id} variant={variant} />
            ))}
            {variantsWithWarnings.length > 3 && (
              <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-1">
                +{variantsWithWarnings.length - 3} more warnings
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default TradeSheetReadinessPanel
