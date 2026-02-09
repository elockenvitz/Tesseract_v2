/**
 * Trade Sheet Panel
 *
 * UI for viewing conflict summary and creating Trade Sheets in Trade Lab v3.
 * Shows:
 * - Variant count with conflict/warning badges
 * - "Create Trade Sheet" button (disabled when conflicts exist)
 * - List of created trade sheets
 */

import React, { useState } from 'react'
import { FileText, AlertCircle, AlertTriangle, Check, Clock, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import type { TradeSheet, IntentVariant, SizingValidationError } from '../../types/trading'
import { ConflictSummaryBar, VariantStatusBadgesV3 } from './VariantStatusBadges'

// =============================================================================
// TYPES
// =============================================================================

interface ConflictSummary {
  total: number
  conflicts: number
  warnings: number
  canCreateTradeSheet: boolean
}

interface TradeSheetPanelProps {
  variants: IntentVariant[]
  conflictSummary: ConflictSummary
  tradeSheets: TradeSheet[]
  onCreateTradeSheet: (name: string, description?: string) => Promise<void>
  onFixConflict?: (variantId: string, suggestedAction: string) => void
  isCreating?: boolean
  className?: string
}

// =============================================================================
// VARIANT LIST ITEM
// =============================================================================

interface VariantListItemProps {
  variant: IntentVariant
  onFixConflict?: (variantId: string, suggestedAction: string) => void
}

function VariantListItem({ variant, onFixConflict }: VariantListItemProps) {
  const hasConflict = variant.direction_conflict !== null

  return (
    <div
      className={clsx(
        'flex items-center justify-between px-3 py-2 rounded-lg border',
        hasConflict
          ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
      )}
    >
      <div className="flex items-center gap-2">
        <span className={clsx(
          'px-1.5 py-0.5 text-xs font-medium rounded',
          variant.action === 'buy' || variant.action === 'add'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        )}>
          {variant.action.toUpperCase()}
        </span>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {variant.sizing_input}
        </span>
        {variant.computed && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ({variant.computed.delta_shares > 0 ? '+' : ''}{variant.computed.delta_shares.toLocaleString()} sh)
          </span>
        )}
      </div>

      <VariantStatusBadgesV3
        conflict={variant.direction_conflict}
        belowLotWarning={variant.below_lot_warning}
        onFixAction={onFixConflict ? (action) => onFixConflict(variant.id, action) : undefined}
      />
    </div>
  )
}

// =============================================================================
// CREATE TRADE SHEET FORM
// =============================================================================

interface CreateSheetFormProps {
  onSubmit: (name: string, description?: string) => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
  disabled: boolean
  disabledReason?: string
}

function CreateSheetForm({ onSubmit, onCancel, isSubmitting, disabled, disabledReason }: CreateSheetFormProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || disabled) return
    await onSubmit(name.trim(), description.trim() || undefined)
    setName('')
    setDescription('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
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
      {disabled && disabledReason && (
        <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3 h-3" />
          <span>{disabledReason}</span>
        </div>
      )}
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
          disabled={!name.trim() || disabled || isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create Sheet'}
        </Button>
      </div>
    </form>
  )
}

// =============================================================================
// TRADE SHEET LIST
// =============================================================================

interface SheetListItemProps {
  sheet: TradeSheet
}

function SheetListItem({ sheet }: SheetListItemProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-gray-400" />
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {sheet.name}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {sheet.total_trades} trades · ${sheet.total_notional.toLocaleString()}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
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
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TradeSheetPanel({
  variants,
  conflictSummary,
  tradeSheets,
  onCreateTradeSheet,
  onFixConflict,
  isCreating = false,
  className = '',
}: TradeSheetPanelProps) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showVariants, setShowVariants] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const variantsWithConflicts = variants.filter(v => v.direction_conflict !== null)

  const handleCreate = async (name: string, description?: string) => {
    await onCreateTradeSheet(name, description)
    setShowCreateForm(false)
  }

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Summary Bar */}
      <ConflictSummaryBar
        total={conflictSummary.total}
        conflicts={conflictSummary.conflicts}
        warnings={conflictSummary.warnings}
        canCreateTradeSheet={conflictSummary.canCreateTradeSheet}
        onCreateTradeSheet={() => setShowCreateForm(true)}
        isCreating={isCreating}
      />

      {/* Create Form */}
      {showCreateForm && (
        <CreateSheetForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreateForm(false)}
          isSubmitting={isCreating}
          disabled={!conflictSummary.canCreateTradeSheet}
          disabledReason={
            conflictSummary.conflicts > 0
              ? 'Resolve all conflicts before creating Trade Sheet'
              : conflictSummary.total === 0
              ? 'Add variants to create Trade Sheet'
              : undefined
          }
        />
      )}

      {/* Conflicts Section */}
      {variantsWithConflicts.length > 0 && (
        <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowVariants(!showVariants)}
            className="w-full flex items-center justify-between px-3 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span className="text-sm font-medium text-red-700 dark:text-red-400">
                {variantsWithConflicts.length} Conflict{variantsWithConflicts.length !== 1 ? 's' : ''} to Resolve
              </span>
            </div>
            {showVariants ? (
              <ChevronUp className="w-4 h-4 text-red-600 dark:text-red-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-red-600 dark:text-red-400" />
            )}
          </button>
          {showVariants && (
            <div className="p-3 space-y-2 bg-white dark:bg-gray-900">
              {variantsWithConflicts.map(variant => (
                <VariantListItem
                  key={variant.id}
                  variant={variant}
                  onFixConflict={onFixConflict}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trade Sheets History */}
      {tradeSheets.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Trade Sheet History ({tradeSheets.length})
              </span>
            </div>
            {showHistory ? (
              <ChevronUp className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            )}
          </button>
          {showHistory && (
            <div className="p-3 space-y-2 bg-white dark:bg-gray-900">
              {tradeSheets.map(sheet => (
                <SheetListItem key={sheet.id} sheet={sheet} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TradeSheetPanel
