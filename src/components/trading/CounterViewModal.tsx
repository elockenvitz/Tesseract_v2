/**
 * CounterViewModal — Create a counter-view for an existing trade idea.
 *
 * Opens a modal prefilled from the original idea's context (asset, portfolio,
 * urgency) with the action auto-set to the opposite direction.
 * Direction is determined by the original idea's action — buy↔sell, add↔trim —
 * which already encodes whether the asset is held (add/trim) or not (buy/sell).
 * Creates a new trade idea + opposes link via counter-view-service.
 */

import { useState, useEffect } from 'react'
import { X, ArrowLeftRight, TrendingUp, TrendingDown } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { useCreateCounterView } from '../../hooks/useCounterViews'
import { Button } from '../ui/Button'
import type { TradeAction } from '../../types/trading'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CounterViewModalProps {
  isOpen: boolean
  onClose: () => void
  /** The original idea being countered */
  originalIdea: {
    id: string
    action: string
    asset_id: string
    asset_symbol?: string
    asset_name?: string
    portfolio_id: string
    portfolio_name?: string
    urgency: string
    rationale?: string | null
    sharing_visibility?: string
  }
  onCreated?: (newIdeaId: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPPOSITE_ACTION: Record<string, TradeAction> = {
  buy: 'sell',
  sell: 'buy',
  add: 'trim',
  trim: 'add',
}

const ACTION_DISPLAY: Record<string, { label: string; color: string; bgColor: string; darkColor: string; darkBgColor: string; icon: typeof TrendingUp }> = {
  buy:  { label: 'Buy',  color: 'text-emerald-700', bgColor: 'bg-emerald-50',  darkColor: 'dark:text-emerald-400', darkBgColor: 'dark:bg-emerald-900/30', icon: TrendingUp },
  add:  { label: 'Add',  color: 'text-emerald-700', bgColor: 'bg-emerald-50',  darkColor: 'dark:text-emerald-400', darkBgColor: 'dark:bg-emerald-900/30', icon: TrendingUp },
  sell: { label: 'Sell', color: 'text-red-700',     bgColor: 'bg-red-50',      darkColor: 'dark:text-red-400',     darkBgColor: 'dark:bg-red-900/30',     icon: TrendingDown },
  trim: { label: 'Trim', color: 'text-red-700',     bgColor: 'bg-red-50',      darkColor: 'dark:text-red-400',     darkBgColor: 'dark:bg-red-900/30',     icon: TrendingDown },
}

const DIRECTION_LABEL: Record<string, string> = {
  buy: 'Not currently held — initiate new position',
  sell: 'Not currently held — opposing the buy',
  add: 'Currently held — increase position',
  trim: 'Currently held — reduce position',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CounterViewModal({
  isOpen,
  onClose,
  originalIdea,
  onCreated,
}: CounterViewModalProps) {
  const { user } = useAuth()
  const createMutation = useCreateCounterView()

  // Derive action from original — not user-selectable
  const counterAction = OPPOSITE_ACTION[originalIdea.action] || 'buy'

  // Form state
  const [urgency, setUrgency] = useState(originalIdea.urgency || 'medium')
  const [rationale, setRationale] = useState('')

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrgency(originalIdea.urgency || 'medium')
      setRationale('')
    }
  }, [isOpen, originalIdea.urgency])

  const counterCfg = ACTION_DISPLAY[counterAction] || ACTION_DISPLAY.buy
  const origCfg = ACTION_DISPLAY[originalIdea.action] || ACTION_DISPLAY.sell
  const CounterIcon = counterCfg.icon

  const handleSubmit = async () => {
    if (!user || !rationale.trim()) return

    try {
      const result = await createMutation.mutateAsync({
        originalIdeaId: originalIdea.id,
        portfolioId: originalIdea.portfolio_id,
        assetId: originalIdea.asset_id,
        action: counterAction,
        urgency,
        rationale: rationale.trim(),
        sharingVisibility: (originalIdea.sharing_visibility as 'private' | 'portfolio' | 'team' | 'public') || 'portfolio',
        context: {
          actorId: user.id,
          actorName: user.email || 'Unknown',
          actorEmail: user.email,
          actorRole: 'analyst',
          requestId: crypto.randomUUID(),
          uiSource: 'counter_view_modal',
        },
      })

      onCreated?.(result.id)
      onClose()
    } catch (err) {
      console.error('[CounterViewModal] Failed to create counter-view:', err)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-violet-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Create Counter-View
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Express an opposing directional thesis
              </p>
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
          {/* Original idea context */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
              Original Idea
            </div>
            <div className="flex items-center gap-2">
              <span className={clsx(
                'text-xs font-medium uppercase px-1.5 py-0.5 rounded',
                origCfg.color, origCfg.bgColor, origCfg.darkColor, origCfg.darkBgColor,
              )}>
                {originalIdea.action}
              </span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {originalIdea.asset_symbol || '?'}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {originalIdea.asset_name}
              </span>
            </div>
            {originalIdea.rationale && (
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                {originalIdea.rationale}
              </p>
            )}
            {originalIdea.portfolio_name && (
              <div className="mt-1.5 text-[10px] text-gray-400">
                Portfolio: {originalIdea.portfolio_name}
              </div>
            )}
          </div>

          {/* Counter direction — auto-derived, read-only */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
              Your Counter-View
            </div>

            <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-3">
              <div className={clsx(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-semibold uppercase',
                counterCfg.bgColor, counterCfg.color, counterCfg.darkBgColor, counterCfg.darkColor,
              )}>
                <CounterIcon className="h-3.5 w-3.5" />
                {counterCfg.label}
              </div>
              <div className="min-w-0">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {originalIdea.asset_symbol || '?'}
                </span>
                {originalIdea.asset_name && (
                  <span className="text-xs text-gray-400 ml-1.5 truncate">{originalIdea.asset_name}</span>
                )}
              </div>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 -mt-1.5 mb-3 px-1">
              {DIRECTION_LABEL[counterAction]}
            </p>

            {/* Urgency */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Urgency
              </label>
              <div className="inline-flex gap-1 p-0.5 bg-gray-100 dark:bg-gray-700 rounded-lg">
                {(['low', 'medium', 'high', 'urgent'] as const).map(u => (
                  <button
                    key={u}
                    onClick={() => setUrgency(u)}
                    className={clsx(
                      'px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors capitalize',
                      urgency === u
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            {/* Rationale (required) */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Thesis / Rationale <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rationale}
                onChange={e => setRationale(e.target.value)}
                placeholder="Why do you disagree with the original idea? What is your counter-thesis?"
                className="w-full h-24 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-400 focus:border-violet-400 resize-none placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Preview */}
          <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-900/20 rounded-lg border border-violet-200/60 dark:border-violet-800/40">
            <ArrowLeftRight className="h-4 w-4 text-violet-500 shrink-0" />
            <div className="text-xs text-violet-700 dark:text-violet-300">
              <span className={clsx('font-semibold uppercase', origCfg.color, origCfg.darkColor)}>{originalIdea.action}</span>
              {' '}
              <span className="text-violet-400">{'\u2192'}</span>
              {' '}
              <span className={clsx('font-semibold uppercase', counterCfg.color, counterCfg.darkColor)}>{counterAction}</span>
              {' '}
              <span className="font-medium">{originalIdea.asset_symbol}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={createMutation.isPending || !rationale.trim()}
            className="!bg-violet-600 hover:!bg-violet-700"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Counter-View'}
          </Button>
        </div>

        {/* Error */}
        {createMutation.isError && (
          <div className="px-4 pb-3 text-xs text-red-600">
            Failed to create counter-view. Please try again.
          </div>
        )}
      </div>
    </div>
  )
}
