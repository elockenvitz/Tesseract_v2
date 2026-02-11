/**
 * SuggestionReviewPanel
 *
 * Slide-out panel for simulation owners to review pending suggestions.
 * Shows suggestions grouped by asset with accept/reject actions.
 */

import React, { useMemo } from 'react'
import { Check, X, MessageSquare, Clock, User } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import type { SimulationSuggestion } from '../../hooks/useSimulationSuggestions'
import type { AssetPrice, RoundingConfig, ActiveWeightConfig, BaselineHolding } from '../../types/trading'

interface SuggestionReviewPanelProps {
  suggestions: SimulationSuggestion[]
  onAccept: (params: {
    suggestionId: string
    currentPosition?: {
      shares: number
      weight: number
      cost_basis: number | null
      active_weight: number | null
    } | null
    price: AssetPrice
    portfolioTotalValue: number
    roundingConfig: RoundingConfig
    activeWeightConfig?: ActiveWeightConfig | null
    hasBenchmark: boolean
  }) => void
  onReject: (suggestionId: string, notes?: string) => void
  onClose: () => void
  baselineHoldings?: BaselineHolding[]
  priceMap?: Record<string, number>
  portfolioTotalValue?: number
  hasBenchmark?: boolean
  isAccepting?: boolean
}

interface GroupedSuggestion {
  assetId: string
  symbol: string
  name: string
  suggestions: SimulationSuggestion[]
}

export function SuggestionReviewPanel({
  suggestions,
  onAccept,
  onReject,
  onClose,
  baselineHoldings = [],
  priceMap = {},
  portfolioTotalValue = 0,
  hasBenchmark = false,
  isAccepting = false,
}: SuggestionReviewPanelProps) {
  const pendingSuggestions = useMemo(
    () => suggestions.filter(s => s.status === 'pending'),
    [suggestions]
  )

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedSuggestion>()
    for (const s of pendingSuggestions) {
      if (!map.has(s.asset_id)) {
        map.set(s.asset_id, {
          assetId: s.asset_id,
          symbol: s.asset?.symbol || 'Unknown',
          name: s.asset?.company_name || '',
          suggestions: [],
        })
      }
      map.get(s.asset_id)!.suggestions.push(s)
    }
    return Array.from(map.values())
  }, [pendingSuggestions])

  const recentResolved = useMemo(
    () => suggestions
      .filter(s => s.status !== 'pending')
      .slice(0, 5),
    [suggestions]
  )

  const handleAccept = (suggestion: SimulationSuggestion) => {
    const holding = baselineHoldings.find(h => h.asset_id === suggestion.asset_id)
    const currentPosition = holding ? {
      shares: holding.shares,
      weight: holding.weight,
      cost_basis: null,
      active_weight: null,
    } : null

    onAccept({
      suggestionId: suggestion.id,
      currentPosition,
      price: {
        asset_id: suggestion.asset_id,
        price: priceMap[suggestion.asset_id] || holding?.price || 100,
        timestamp: new Date().toISOString(),
        source: 'realtime' as const,
      },
      portfolioTotalValue,
      roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
      activeWeightConfig: null,
      hasBenchmark,
    })
  }

  const handleRejectAll = () => {
    for (const s of pendingSuggestions) {
      onReject(s.id)
    }
  }

  const handleAcceptAll = () => {
    for (const s of pendingSuggestions) {
      handleAccept(s)
    }
  }

  return (
    <div className="w-80 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            Suggestions
          </span>
          {pendingSuggestions.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
              {pendingSuggestions.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Batch actions */}
      {pendingSuggestions.length > 1 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={handleAcceptAll}
            disabled={isAccepting}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
          >
            Accept All
          </button>
          <button
            onClick={handleRejectAll}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            Reject All
          </button>
        </div>
      )}

      {/* Suggestion list */}
      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <MessageSquare className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">No pending suggestions</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {grouped.map(group => (
              <div key={group.assetId} className="px-4 py-3">
                {/* Asset header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                    {group.symbol}
                  </span>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {group.name}
                  </span>
                </div>

                {/* Individual suggestions */}
                <div className="space-y-2">
                  {group.suggestions.map(s => (
                    <div
                      key={s.id}
                      className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] font-mono font-medium text-gray-900 dark:text-white">
                          {s.sizing_input}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleAccept(s)}
                            disabled={isAccepting}
                            className="p-1 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
                            title="Accept suggestion"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onReject(s.id)}
                            className="p-1 rounded-md text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                            title="Reject suggestion"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
                        <User className="h-3 w-3" />
                        <span>{s.suggested_by_user?.full_name || s.suggested_by_user?.email || 'Unknown'}</span>
                        <Clock className="h-3 w-3 ml-1" />
                        <span>{formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</span>
                      </div>
                      {s.notes && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 italic">
                          "{s.notes}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recently resolved */}
        {recentResolved.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-800 mt-2">
            <div className="px-4 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Recent
              </span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
              {recentResolved.map(s => (
                <div key={s.id} className="px-4 py-2 flex items-center gap-2">
                  <span className={clsx(
                    'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded',
                    s.status === 'accepted' && 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
                    s.status === 'rejected' && 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
                    s.status === 'withdrawn' && 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
                  )}>
                    {s.status}
                  </span>
                  <span className="text-[12px] font-medium text-gray-600 dark:text-gray-300">
                    {s.asset?.symbol || 'Unknown'}
                  </span>
                  <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500">
                    {s.sizing_input}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
