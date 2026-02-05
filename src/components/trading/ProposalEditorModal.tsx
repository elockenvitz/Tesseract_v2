import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Check, AlertTriangle, History, Clock, Scale, FileText, Briefcase } from 'lucide-react'
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
import type {
  TradeQueueItemWithDetails,
  TradeProposal,
  TradeProposalVersion,
  TradeSizingMode,
  BaselineHolding,
  SimulatedHolding,
  ActionContext,
} from '../../types/trading'

// Sizing mode options
type SimpleSizingMode = 'weight' | 'shares' | 'vs_benchmark'
const SIZING_MODE_OPTIONS: { value: SimpleSizingMode; label: string; unit: string; disabled?: boolean }[] = [
  { value: 'weight', label: 'Weight %', unit: '%' },
  { value: 'shares', label: 'Shares', unit: 'sh' },
  { value: 'vs_benchmark', label: '± Benchmark', unit: '%', disabled: true },
]

// Parse value to detect if it's a delta (starts with + or -)
const parseEditingValue = (value: string, baseMode: SimpleSizingMode): { mode: TradeSizingMode; numValue: number | null } => {
  if (baseMode === 'vs_benchmark') return { mode: 'delta_benchmark', numValue: null }
  if (!value || value.trim() === '') return { mode: baseMode === 'weight' ? 'weight' : 'shares', numValue: null }
  const trimmed = value.trim()
  const isDelta = trimmed.startsWith('+') || (trimmed.startsWith('-') && trimmed !== '-')
  const numValue = parseFloat(trimmed)
  if (isNaN(numValue)) return { mode: baseMode === 'weight' ? 'weight' : 'shares', numValue: null }

  if (isDelta) {
    return { mode: baseMode === 'weight' ? 'delta_weight' : 'delta_shares', numValue }
  }
  return { mode: baseMode === 'weight' ? 'weight' : 'shares', numValue }
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
  const [sizingMode, setSizingMode] = useState<SimpleSizingMode>('weight')
  const [sizingValue, setSizingValue] = useState('')
  const [notes, setNotes] = useState('')
  const [showHistory, setShowHistory] = useState(false)

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
      // Determine sizing mode from the proposal
      if (existingProposal.sizing_mode) {
        const mode = existingProposal.sizing_mode
        if (mode === 'weight' || mode === 'delta_weight') {
          setSizingMode('weight')
          if (existingProposal.weight != null) {
            setSizingValue(mode === 'delta_weight' ? `+${existingProposal.weight}` : existingProposal.weight.toString())
          }
        } else if (mode === 'shares' || mode === 'delta_shares') {
          setSizingMode('shares')
          if (existingProposal.shares != null) {
            setSizingValue(mode === 'delta_shares' ? `+${existingProposal.shares}` : existingProposal.shares.toString())
          }
        }
      } else if (existingProposal.weight != null) {
        setSizingMode('weight')
        setSizingValue(existingProposal.weight.toString())
      } else if (existingProposal.shares != null) {
        setSizingMode('shares')
        setSizingValue(existingProposal.shares.toString())
      }
      setNotes(existingProposal.notes || '')
    } else {
      // Reset to defaults
      setSizingMode('weight')
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
      console.log('🔄 Starting proposal save...', { tradeIdea: tradeIdea.id, sizingMode, sizingValue, portfolioId: selectedPortfolioId })
      if (!user) throw new Error('Not authenticated')
      if (!selectedPortfolioId) throw new Error('Please select a portfolio')

      const { mode, numValue } = parseEditingValue(sizingValue, sizingMode)

      // Resolve to absolute values if delta mode
      let resolvedWeight: number | null = null
      let resolvedShares: number | null = null

      if (mode === 'weight') {
        resolvedWeight = numValue
      } else if (mode === 'shares') {
        resolvedShares = numValue
      } else if (mode === 'delta_weight' && numValue !== null) {
        const current = currentHolding?.weight ?? baseline?.weight ?? 0
        resolvedWeight = current + numValue
      } else if (mode === 'delta_shares' && numValue !== null) {
        const current = currentHolding?.shares ?? baseline?.shares ?? 0
        resolvedShares = current + numValue
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
            input_mode: sizingMode,
            input_value: sizingValue,
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

  // Calculate preview for delta modes
  const preview = useMemo(() => {
    const { mode, numValue } = parseEditingValue(sizingValue, sizingMode)
    if (numValue === null) return null

    if (mode === 'delta_weight') {
      const current = currentHolding?.weight ?? baseline?.weight ?? 0
      return { type: 'weight' as const, from: current, to: current + numValue }
    }
    if (mode === 'delta_shares') {
      const current = currentHolding?.shares ?? baseline?.shares ?? 0
      return { type: 'shares' as const, from: current, to: current + numValue }
    }
    return null
  }, [sizingValue, sizingMode, baseline, currentHolding])

  if (!isOpen) return null

  const modeOption = SIZING_MODE_OPTIONS.find(o => o.value === sizingMode) || SIZING_MODE_OPTIONS[0]

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

          {/* Sizing inputs */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              Proposed Size
            </label>
            <div className="flex items-center gap-2">
              <select
                value={sizingMode}
                onChange={(e) => {
                  setSizingMode(e.target.value as SimpleSizingMode)
                  setSizingValue('') // Clear value when switching modes
                }}
                className="h-9 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
              >
                {SIZING_MODE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}{opt.disabled ? ' (N/A)' : ''}
                  </option>
                ))}
              </select>
              <div className="relative flex-1">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={sizingValue}
                  onChange={(e) => setSizingValue(e.target.value)}
                  placeholder={sizingMode === 'weight' ? 'e.g., 5 or +2' : 'e.g., 1000 or +500'}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500">
                  {modeOption.unit}
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Use + or - prefix for relative changes (e.g., "+2" to add 2%)
            </p>

            {/* Preview for delta modes */}
            {preview && (
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
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving...' : existingProposal ? 'Update Proposal' : 'Save Proposal'}
          </Button>
        </div>
      </div>
    </div>
  )
}
