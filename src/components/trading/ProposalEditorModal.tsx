import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Check, AlertTriangle, History, Clock, Scale, FileText, Briefcase, AlertCircle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { clsx } from 'clsx'
import {
  getUserProposalForTradeIdea,
  upsertProposal,
  getProposalVersions,
} from '../../lib/services/trade-lab-service'
import { moveTradeIdea } from '../../lib/services/trade-idea-service'
import {
  parseSizingInput,
  toSizingSpec,
  formatSizingDisplay,
} from '../../lib/trade-lab/sizing-parser'
import {
  normalizeSizing,
  detectDirectionConflict,
  type NormalizationContext,
} from '../../lib/trade-lab/normalize-sizing'
import { ConflictBadgeV3, ConflictExplanation, SizingHelpText } from './VariantStatusBadges'
import type {
  TradeQueueItemWithDetails,
  TradeProposal,
  TradeProposalVersion,
  TradeSizingMode,
  BaselineHolding,
  SimulatedHolding,
  ActionContext,
  RoundingConfig,
  AssetPrice,
  SizingValidationError,
} from '../../types/trading'

// =============================================================================
// V3 SIZING INTEGRATION
// =============================================================================

/**
 * Parse sizing input using v3 parser with direction conflict detection.
 * Returns both the parsed result and conflict status.
 */
function parseSizingWithConflictCheck(
  sizingInput: string,
  action: string,
  currentPosition: { shares: number; weight: number } | null,
  portfolioTotalValue: number,
  price: number,
  hasBenchmark: boolean
): {
  isValid: boolean
  error?: string
  framework?: string
  value?: number
  directionConflict: SizingValidationError | null  // v3: Full error object, not boolean
  computed?: {
    targetShares: number
    targetWeight: number
    deltaShares: number
    deltaWeight: number
  }
} {
  // Parse using v3 parser
  const parseResult = parseSizingInput(sizingInput, { has_benchmark: hasBenchmark })

  if (!parseResult.is_valid) {
    return {
      isValid: false,
      error: parseResult.error,
      directionConflict: null,  // v3: null = no conflict
    }
  }

  const sizingSpec = toSizingSpec(sizingInput, parseResult)
  if (!sizingSpec) {
    return {
      isValid: false,
      error: 'Failed to parse sizing',
      directionConflict: null,  // v3: null = no conflict
    }
  }

  // Create mock price for normalization
  const mockPrice: AssetPrice = {
    asset_id: 'temp',
    price: price > 0 ? price : 100, // Fallback for calculation
    timestamp: new Date().toISOString(),
    source: 'realtime',
  }

  // Default rounding config (no rounding for proposals)
  const roundingConfig: RoundingConfig = {
    lot_size: 1,
    min_lot_behavior: 'round',
    round_direction: 'nearest',
  }

  // Normalize to get computed values
  const normCtx: NormalizationContext = {
    action: action as any,
    sizing_input: sizingInput,
    current_position: currentPosition ? {
      shares: currentPosition.shares,
      weight: currentPosition.weight,
      cost_basis: null,
      active_weight: null,
    } : null,
    portfolio_total_value: portfolioTotalValue,
    price: mockPrice,
    rounding_config: roundingConfig,
    active_weight_config: null,
    has_benchmark: hasBenchmark,
  }

  const normResult = normalizeSizing(normCtx)

  return {
    isValid: normResult.is_valid,
    error: normResult.error,
    framework: sizingSpec.framework,
    value: sizingSpec.value,
    directionConflict: normResult.direction_conflict,
    computed: normResult.computed ? {
      targetShares: normResult.computed.target_shares,
      targetWeight: normResult.computed.target_weight,
      deltaShares: normResult.computed.delta_shares,
      deltaWeight: normResult.computed.delta_weight,
    } : undefined,
  }
}

// Legacy mapping for backwards compatibility with existing code
function mapFrameworkToLegacyMode(framework: string | undefined): TradeSizingMode {
  switch (framework) {
    case 'weight_target': return 'weight'
    case 'weight_delta': return 'delta_weight'
    case 'shares_target': return 'shares'
    case 'shares_delta': return 'delta_shares'
    case 'active_target':
    case 'active_delta': return 'delta_benchmark'
    default: return 'weight'
  }
}

interface PortfolioOption {
  id: string
  name: string
}

interface ProposalEditorModalProps {
  isOpen: boolean
  onClose: () => void
  tradeIdea: TradeQueueItemWithDetails
  baseline?: BaselineHolding
  currentHolding?: SimulatedHolding
  labId?: string | null
  portfolioId?: string  // Pre-selected portfolio (use this when context is clear)
  availablePortfolios?: PortfolioOption[]  // Available portfolios for dropdown
  onSaved?: (proposal: TradeProposal) => void
}

export function ProposalEditorModal({
  isOpen,
  onClose,
  tradeIdea,
  baseline,
  currentHolding,
  labId,
  portfolioId: preselectedPortfolioId,
  availablePortfolios = [],
  onSaved,
}: ProposalEditorModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Form state
  const [sizingValue, setSizingValue] = useState('')
  const [notes, setNotes] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showSizingHelp, setShowSizingHelp] = useState(false)

  // V3: Direction conflict detection state (null = no conflict, object = conflict details)
  const [directionConflict, setDirectionConflict] = useState<SizingValidationError | null>(null)
  const [sizingError, setSizingError] = useState<string | null>(null)

  // Portfolio selection state
  // Priority: preselected > first available > trade idea's portfolio
  const defaultPortfolioId = preselectedPortfolioId ||
    (availablePortfolios.length > 0 ? availablePortfolios[0].id : tradeIdea.portfolio_id || '')
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>(defaultPortfolioId)

  // Reset portfolio selection when modal opens
  useEffect(() => {
    if (isOpen) {
      const newDefault = preselectedPortfolioId ||
        (availablePortfolios.length > 0 ? availablePortfolios[0].id : tradeIdea.portfolio_id || '')
      setSelectedPortfolioId(newDefault)
    }
  }, [isOpen, preselectedPortfolioId, availablePortfolios, tradeIdea.portfolio_id])

  // Show portfolio selector if multiple portfolios available and not pre-selected
  const showPortfolioSelector = !preselectedPortfolioId && availablePortfolios.length > 1

  // Fetch user's current proposal for the selected portfolio
  const { data: existingProposal, isLoading: loadingProposal } = useQuery({
    queryKey: ['proposal', tradeIdea.id, user?.id, selectedPortfolioId],
    queryFn: () => getUserProposalForTradeIdea(tradeIdea.id, user!.id, selectedPortfolioId),
    enabled: isOpen && !!user?.id && !!selectedPortfolioId,
  })

  // Fetch proposal version history
  const { data: versionHistory } = useQuery({
    queryKey: ['proposal-versions', existingProposal?.id],
    queryFn: () => getProposalVersions(existingProposal!.id),
    enabled: isOpen && !!existingProposal?.id && showHistory,
  })

  // Initialize form from existing proposal
  useEffect(() => {
    if (existingProposal) {
      // V3: Try to load the raw input value from sizing_context first
      const context = existingProposal.sizing_context as Record<string, unknown> | null
      if (context?.input_value) {
        setSizingValue(context.input_value as string)
      } else {
        // Fallback: reconstruct from legacy mode/value
        const mode = existingProposal.sizing_mode
        if (mode === 'weight' || mode === 'delta_weight') {
          if (existingProposal.weight != null) {
            setSizingValue(mode === 'delta_weight' ? `+${existingProposal.weight}` : existingProposal.weight.toString())
          }
        } else if (mode === 'shares' || mode === 'delta_shares') {
          if (existingProposal.shares != null) {
            setSizingValue(mode === 'delta_shares' ? `#+${existingProposal.shares}` : `#${existingProposal.shares}`)
          }
        } else if (existingProposal.weight != null) {
          setSizingValue(existingProposal.weight.toString())
        } else if (existingProposal.shares != null) {
          setSizingValue(`#${existingProposal.shares}`)
        }
      }
      setNotes(existingProposal.notes || '')
    } else {
      // Reset to defaults
      setSizingValue('')
      setNotes('')
    }
  }, [existingProposal])

  // Build action context
  const buildContext = (): ActionContext => ({
    actorId: user!.id,
    actorName: user?.email || 'Unknown',
    actorEmail: user?.email,
    actorRole: 'analyst',
    requestId: crypto.randomUUID(),
  })

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      console.log('🔄 Starting proposal save...', { tradeIdea: tradeIdea.id, sizingValue, portfolioId: selectedPortfolioId })
      if (!user) throw new Error('Not authenticated')
      if (!selectedPortfolioId) throw new Error('Please select a portfolio')

      // V3: Block save if there's a direction conflict
      if (directionConflict !== null) {
        throw new Error('Cannot save proposal with direction conflict. The sizing contradicts the trade action.')
      }

      if (!sizingValidation.isValid) {
        throw new Error(sizingValidation.error || 'Invalid sizing input')
      }

      // Use v3 computed values
      const mode = mapFrameworkToLegacyMode(sizingValidation.framework)
      let resolvedWeight: number | null = null
      let resolvedShares: number | null = null

      if (sizingValidation.computed) {
        // Use target values from normalization
        if (mode === 'weight' || mode === 'delta_weight' || mode === 'delta_benchmark') {
          resolvedWeight = sizingValidation.computed.targetWeight
        } else {
          resolvedShares = sizingValidation.computed.targetShares
        }
      }

      const context = buildContext()

      // Save the proposal
      const proposal = await upsertProposal(
        {
          trade_queue_item_id: tradeIdea.id,
          portfolio_id: selectedPortfolioId,
          lab_id: labId,
          weight: resolvedWeight,
          shares: resolvedShares,
          sizing_mode: mode,
          sizing_context: {
            baseline_weight: baseline?.weight,
            baseline_shares: baseline?.shares,
            input_value: sizingValue,
            v3_framework: sizingValidation.framework,
            v3_direction_conflict: directionConflict !== null,  // Boolean for storage
          },
          notes: notes || null,
        },
        context
      )

      // Auto-advance: Only move to 'deciding' if:
      // 1. Trade is currently in 'modeling' stage (or legacy 'simulating')
      // 2. User is the owner (created_by) or assignee (assigned_to)
      const isOwner = tradeIdea.created_by === user.id
      const isAssignee = tradeIdea.assigned_to === user.id
      const isInModelingStage = tradeIdea.stage === 'modeling' || tradeIdea.stage === 'simulating' as any
      const shouldAutoAdvance = isInModelingStage && (isOwner || isAssignee)

      console.log('🔍 Auto-advance check:', {
        stage: tradeIdea.stage,
        isInModelingStage,
        isOwner,
        isAssignee,
        created_by: tradeIdea.created_by,
        assigned_to: tradeIdea.assigned_to,
        userId: user.id,
        shouldAutoAdvance
      })

      if (shouldAutoAdvance) {
        console.log('🚀 Auto-advancing from modeling to deciding (owner/assignee proposal)')
        await moveTradeIdea({
          tradeId: tradeIdea.id,
          target: { stage: 'deciding' },
          context: { ...context, requestId: crypto.randomUUID() },
          note: 'Auto-advanced to deciding after owner/assignee proposal submitted',
        })
      } else {
        console.log('⏭️ Skipping auto-advance:', !isInModelingStage ? 'not in modeling stage' : 'user is not owner/assignee')
      }

      return proposal
    },
    onSuccess: (proposal) => {
      console.log('✅ Proposal saved successfully:', proposal)
      queryClient.invalidateQueries({ queryKey: ['proposal', tradeIdea.id] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-ideas'] }) // SimulationPage uses this key
      onSaved?.(proposal)
      onClose()
    },
    onError: (error) => {
      console.error('❌ Failed to save proposal:', error)
      alert(`Failed to save proposal: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  // V3: Validate sizing and detect direction conflicts
  const sizingValidation = useMemo(() => {
    if (!sizingValue.trim()) {
      return { isValid: false, directionConflict: null as SizingValidationError | null, computed: undefined }
    }

    // Get current position from baseline or holding
    const currentPosition = baseline || currentHolding ? {
      shares: currentHolding?.shares ?? baseline?.shares ?? 0,
      weight: currentHolding?.weight ?? baseline?.weight ?? 0,
    } : null

    // Estimate portfolio value (fallback to 1M if unknown)
    const portfolioValue = 1_000_000 // TODO: Pass actual portfolio value
    const price = baseline?.price ?? currentHolding?.price ?? 100

    // Check if portfolio has benchmark configured
    const hasBenchmark = false // TODO: Check portfolio.benchmark

    return parseSizingWithConflictCheck(
      sizingValue,
      tradeIdea.action,
      currentPosition,
      portfolioValue,
      price,
      hasBenchmark
    )
  }, [sizingValue, tradeIdea.action, baseline, currentHolding])

  // Update conflict state when validation changes
  useEffect(() => {
    setDirectionConflict(sizingValidation.directionConflict)
    setSizingError(sizingValidation.error ?? null)
  }, [sizingValidation])

  // Calculate preview for display
  const preview = useMemo(() => {
    if (!sizingValidation.computed) return null

    const { deltaWeight, deltaShares, targetWeight, targetShares } = sizingValidation.computed
    const currentWeight = currentHolding?.weight ?? baseline?.weight ?? 0
    const currentShares = currentHolding?.shares ?? baseline?.shares ?? 0

    // Determine if showing weight or shares based on the framework
    const framework = sizingValidation.framework || ''
    if (framework.includes('shares')) {
      return { type: 'shares' as const, from: currentShares, to: targetShares }
    }
    return { type: 'weight' as const, from: currentWeight, to: targetWeight }
  }, [sizingValidation, baseline, currentHolding])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {tradeIdea.stage === 'deciding' ? 'Submit Sizing Proposal' : 'Your Proposal'}
              </h2>
              {tradeIdea.stage === 'deciding' && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Awaiting team proposals for PM review
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Portfolio selector - show when multiple portfolios available */}
          {showPortfolioSelector && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Portfolio
              </label>
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-gray-400" />
                <select
                  value={selectedPortfolioId}
                  onChange={(e) => setSelectedPortfolioId(e.target.value)}
                  className="flex-1 h-9 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
                >
                  {availablePortfolios.map(portfolio => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Select portfolio for this sizing proposal
              </p>
            </div>
          )}

          {/* Show single portfolio context when pre-selected */}
          {preselectedPortfolioId && availablePortfolios.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
              <Briefcase className="h-3.5 w-3.5" />
              <span>Portfolio: <span className="font-medium text-gray-700 dark:text-gray-300">{availablePortfolios.find(p => p.id === preselectedPortfolioId)?.name || 'Unknown'}</span></span>
            </div>
          )}

          {/* Trade idea summary */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className={clsx(
                "text-xs font-medium uppercase px-1.5 py-0.5 rounded",
                tradeIdea.action === 'buy' || tradeIdea.action === 'add'
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              )}>
                {tradeIdea.action}
              </span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {tradeIdea.assets?.symbol}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {tradeIdea.assets?.company_name}
              </span>
            </div>
            {baseline && (
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Current position: {baseline.shares.toLocaleString()} shares ({baseline.weight.toFixed(2)}%)
              </div>
            )}
            {!baseline && (
              <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 italic">
                New position (not currently held)
              </div>
            )}
          </div>

          {/* Sizing inputs - V3 unified input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Proposed Size
              </label>
              <button
                type="button"
                onClick={() => setShowSizingHelp(!showSizingHelp)}
                className="text-xs text-primary-500 hover:text-primary-600 dark:text-primary-400"
              >
                {showSizingHelp ? 'Hide syntax help' : 'Syntax help'}
              </button>
            </div>

            {/* Sizing help text - V3 syntax */}
            {showSizingHelp && (
              <SizingHelpText hasBenchmark={false} className="mb-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg" />
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type="text"
                  value={sizingValue}
                  onChange={(e) => setSizingValue(e.target.value)}
                  placeholder="e.g., 5, +2, -0.5, #1000, #+500"
                  className={clsx(
                    directionConflict !== null && 'border-red-500 focus:border-red-500 focus:ring-red-500'
                  )}
                />
              </div>
              {/* V3: Show conflict badge inline with one-click fix */}
              <ConflictBadgeV3 conflict={directionConflict} />
            </div>

            {/* V3: Sizing syntax hint */}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Weight: 5, +2, -0.5 | Shares: #1000, #+500, #-200
            </p>

            {/* V3: Show parsing error */}
            {sizingError && directionConflict === null && (
              <p className="mt-1 text-xs text-red-500">{sizingError}</p>
            )}

            {/* V3: Direction conflict explanation */}
            {directionConflict !== null && (
              <ConflictExplanation
                action={tradeIdea.action}
                sizingInput={sizingValue}
                className="mt-2"
              />
            )}

            {/* Preview for computed values */}
            {preview && directionConflict === null && (
              <div className="mt-2 text-sm text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 rounded px-2 py-1">
                {preview.type === 'weight' ? (
                  <span>{preview.from.toFixed(2)}% → {preview.to.toFixed(2)}%</span>
                ) : (
                  <span>{preview.from.toLocaleString()} → {preview.to.toLocaleString()} shares</span>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about your sizing rationale..."
              className="w-full h-20 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-400 focus:border-primary-400 resize-none"
            />
          </div>

          {/* Version history toggle */}
          {existingProposal && (
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              <History className="h-3.5 w-3.5" />
              {showHistory ? 'Hide history' : 'View history'}
            </button>
          )}

          {/* Version history */}
          {showHistory && versionHistory && versionHistory.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Previous Versions
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {versionHistory.map((version) => (
                  <div
                    key={version.id}
                    className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded p-2"
                  >
                    <div className="flex items-center justify-between">
                      <span>v{version.version_number}</span>
                      <span className="text-gray-400 dark:text-gray-500">
                        {new Date(version.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mt-1">
                      {version.weight != null && `${version.weight}%`}
                      {version.weight != null && version.shares != null && ' · '}
                      {version.shares != null && `${version.shares.toLocaleString()} shares`}
                    </div>
                    {version.notes && (
                      <div className="mt-1 text-gray-400 dark:text-gray-500 truncate">
                        {version.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || directionConflict !== null || !sizingValidation.isValid}
            title={
              directionConflict !== null
                ? 'Resolve the direction conflict before saving'
                : !sizingValidation.isValid
                ? 'Enter valid sizing'
                : undefined
            }
          >
            {saveMutation.isPending ? 'Saving...' : existingProposal ? 'Update Proposal' : 'Save Proposal'}
          </Button>
        </div>
      </div>
    </div>
  )
}
