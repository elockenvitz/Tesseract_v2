/**
 * InlineProposalForm
 *
 * Compact inline form for creating or editing a proposal within the right pane.
 * Uses the shared v3 sizing parser + conflict detection.
 */

import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, HelpCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { upsertProposal } from '../../lib/services/trade-lab-service'
import { moveTradeIdea } from '../../lib/services/trade-idea-service'
import { parseSizingWithConflictCheck, mapFrameworkToLegacyMode } from '../../lib/trade-lab/proposal-sizing'
import { ConflictBadgeV3, ConflictExplanation, SizingHelpText } from '../trading/VariantStatusBadges'
import { useToast } from '../common/Toast'
import type {
  TradeQueueItemWithDetails,
  TradeProposal,
  ActionContext,
  SizingValidationError,
} from '../../types/trading'

interface InlineProposalFormProps {
  tradeIdea: TradeQueueItemWithDetails
  existingProposal?: TradeProposal | null
  portfolioId: string
  onSaved: () => void
  onCancel: () => void
}

export function InlineProposalForm({
  tradeIdea,
  existingProposal,
  portfolioId,
  onSaved,
  onCancel,
}: InlineProposalFormProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { success } = useToast()

  const [sizingValue, setSizingValue] = useState('')
  const [notes, setNotes] = useState('')
  const [showSizingHelp, setShowSizingHelp] = useState(false)

  // Pre-fill from existing proposal
  useEffect(() => {
    if (existingProposal) {
      const ctx = existingProposal.sizing_context as Record<string, unknown> | null
      if (ctx?.input_value) {
        setSizingValue(ctx.input_value as string)
      } else if (existingProposal.weight != null) {
        setSizingValue(existingProposal.weight.toString())
      } else if (existingProposal.shares != null) {
        setSizingValue(`#${existingProposal.shares}`)
      }
      setNotes(existingProposal.notes || '')
    }
  }, [existingProposal])

  // Validate sizing
  const sizingValidation = useMemo(() => {
    if (!sizingValue.trim()) {
      return { isValid: false, directionConflict: null as SizingValidationError | null, computed: undefined }
    }
    return parseSizingWithConflictCheck(
      sizingValue,
      tradeIdea.action,
      null, // No baseline in quick context
      1_000_000, // Fallback portfolio value
      100, // Fallback price
      false
    )
  }, [sizingValue, tradeIdea.action])

  const directionConflict = sizingValidation.directionConflict

  const buildContext = (): ActionContext => ({
    actorId: user!.id,
    actorName: user?.email || 'Unknown',
    actorEmail: user?.email,
    actorRole: 'analyst',
    requestId: crypto.randomUUID(),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated')
      if (!portfolioId) throw new Error('No portfolio selected')
      if (directionConflict !== null) {
        throw new Error('Cannot save proposal with direction conflict.')
      }
      if (!sizingValidation.isValid) {
        throw new Error(sizingValidation.error || 'Invalid sizing input')
      }
      if (!notes.trim()) {
        throw new Error('Rationale is required')
      }

      const mode = mapFrameworkToLegacyMode(sizingValidation.framework)
      let resolvedWeight: number | null = null
      let resolvedShares: number | null = null

      if (sizingValidation.computed) {
        if (mode === 'weight' || mode === 'delta_weight' || mode === 'delta_benchmark') {
          resolvedWeight = sizingValidation.computed.targetWeight
        } else {
          resolvedShares = sizingValidation.computed.targetShares
        }
      }

      const context = buildContext()

      const proposal = await upsertProposal(
        {
          trade_queue_item_id: tradeIdea.id,
          portfolio_id: portfolioId,
          weight: resolvedWeight,
          shares: resolvedShares,
          sizing_mode: mode,
          sizing_context: {
            input_value: sizingValue,
            v3_framework: sizingValidation.framework,
            v3_direction_conflict: directionConflict !== null,
          },
          notes: notes.trim() || null,
        },
        context,
        existingProposal?.id ?? null
      )

      // Auto-advance if owner/assignee and in modeling stage
      const isOwner = tradeIdea.created_by === user.id
      const isAssignee = tradeIdea.assigned_to === user.id
      const isInModelingStage = tradeIdea.stage === 'modeling' || tradeIdea.stage === 'simulating' as any
      if (isInModelingStage && (isOwner || isAssignee)) {
        moveTradeIdea({
          tradeId: tradeIdea.id,
          target: { stage: 'deciding' },
          context: { ...context, requestId: crypto.randomUUID() },
          note: 'Auto-advanced to deciding after proposal submitted',
        }).catch(e => console.warn('Auto-advance failed:', e))
      }

      return proposal
    },
    onSuccess: () => {
      success(existingProposal ? 'Proposal updated' : 'Proposal submitted')
      queryClient.invalidateQueries({ queryKey: ['proposals-for-idea', tradeIdea.id] })
      queryClient.invalidateQueries({ queryKey: ['proposal', tradeIdea.id] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas'] })
      onSaved()
    },
    onError: (error) => {
      console.error('Failed to save proposal:', error)
    },
  })

  const canSubmit = sizingValidation.isValid && directionConflict === null && notes.trim().length > 0 && !saveMutation.isPending

  return (
    <div className="space-y-3">
      {/* Sizing input */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Proposed Size
          </label>
          <button
            type="button"
            onClick={() => setShowSizingHelp(!showSizingHelp)}
            className="text-[11px] text-primary-500 hover:text-primary-600 dark:text-primary-400 flex items-center gap-0.5"
          >
            <HelpCircle className="h-3 w-3" />
            {showSizingHelp ? 'Hide' : 'Syntax'}
          </button>
        </div>

        {showSizingHelp && (
          <SizingHelpText hasBenchmark={false} className="mb-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-[11px]" />
        )}

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={sizingValue}
            onChange={e => setSizingValue(e.target.value)}
            placeholder="e.g., 5, +2, #1000"
            className={clsx(
              'flex-1 h-8 px-2.5 text-sm rounded-lg border bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-400 focus:border-transparent',
              directionConflict !== null
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300 dark:border-gray-600'
            )}
          />
          <ConflictBadgeV3 conflict={directionConflict} />
        </div>

        {sizingValidation.error && directionConflict === null && (
          <p className="mt-1 text-[11px] text-red-500">{sizingValidation.error}</p>
        )}

        {directionConflict !== null && (
          <ConflictExplanation
            action={tradeIdea.action}
            sizingInput={sizingValue}
            className="mt-1.5"
          />
        )}
      </div>

      {/* Notes / rationale */}
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
          Rationale <span className="text-red-400">*</span>
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Why this sizing? What's your conviction?"
          className="w-full h-16 px-2.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-400 focus:border-transparent resize-none"
        />
      </div>

      {/* Error */}
      {saveMutation.isError && (
        <div className="flex items-center gap-1.5 text-xs text-red-500">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save'}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!canSubmit}
          className={clsx(
            'flex-1 h-8 text-sm font-medium rounded-lg transition-colors',
            canSubmit
              ? 'bg-primary-600 hover:bg-primary-700 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
          )}
        >
          {saveMutation.isPending ? 'Saving...' : existingProposal ? 'Update' : 'Submit Proposal'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
