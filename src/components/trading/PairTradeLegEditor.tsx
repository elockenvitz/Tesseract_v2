/**
 * PairTradeLegEditor
 *
 * Editable pair trade legs section with section-level Save/Cancel.
 * Supports adding, removing, and reordering legs.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import {
  Pencil,
  Plus,
  X,
  Check,
  Loader2,
  Search,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import {
  addPairTradeLeg,
  removePairTradeLeg,
} from '../../lib/services/trade-idea-service'

interface TradeLeg {
  id: string
  asset_id: string
  assets?: {
    id: string
    symbol: string
    company_name: string
  }
  action: 'buy' | 'sell'
  pair_leg_type: 'long' | 'short' | null
  proposed_weight?: number | null
  proposed_shares?: number | null
  target_price?: number | null
  stop_loss?: number | null
  take_profit?: number | null
}

interface PairTradeLegEditorProps {
  legs: TradeLeg[]
  pairId: string
  portfolioId: string
  userId: string
  isOwner: boolean
  onLegsChanged?: () => void
}

export function PairTradeLegEditor({
  legs,
  pairId,
  portfolioId,
  userId,
  isOwner,
  onLegsChanged,
}: PairTradeLegEditorProps) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [addingLegType, setAddingLegType] = useState<'long' | 'short' | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<{ id: string; symbol: string; company_name: string } | null>(null)
  const [removingLegId, setRemovingLegId] = useState<string | null>(null)
  const [assetSearch, setAssetSearch] = useState('')
  const [showSearchResults, setShowSearchResults] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Asset search query
  const { data: searchResults } = useQuery({
    queryKey: ['asset-search', assetSearch],
    queryFn: async () => {
      if (!assetSearch || assetSearch.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${assetSearch}%,company_name.ilike.%${assetSearch}%`)
        .order('symbol')
        .limit(10)
      if (error) return []
      return data || []
    },
    enabled: assetSearch.length >= 1 && addingLegType !== null,
    staleTime: 30000,
  })

  // Focus search input when adding leg
  useEffect(() => {
    if (addingLegType && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [addingLegType])

  // Filter legs by type
  const longLegs = legs.filter((leg) =>
    leg.pair_leg_type === 'long' || (leg.pair_leg_type === null && leg.action === 'buy')
  )
  const shortLegs = legs.filter((leg) =>
    leg.pair_leg_type === 'short' || (leg.pair_leg_type === null && leg.action === 'sell')
  )

  // Add leg mutation with optimistic updates
  const addLegMutation = useMutation({
    mutationFn: async (params: { assetId: string; legType: 'long' | 'short'; asset: { id: string; symbol: string; company_name: string } }) => {
      return addPairTradeLeg({
        pairId,
        portfolioId,
        assetId: params.assetId,
        action: params.legType === 'long' ? 'buy' : 'sell',
        pairLegType: params.legType,
        userId,
        rationale: legs[0]?.rationale || undefined,
        urgency: (legs[0] as any)?.urgency || 'medium',
        stage: (legs[0] as any)?.stage || 'idea',
      })
    },
    onMutate: async (params) => {
      // Clear form immediately - this is the key to feeling snappy
      setAddingLegType(null)
      setSelectedAsset(null)
      setAssetSearch('')
      setShowSearchResults(false)

      // Cancel refetches to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['trade-detail', pairId] })

      const previousData = queryClient.getQueryData(['trade-detail', pairId])

      // Optimistic update
      queryClient.setQueryData(['trade-detail', pairId], (old: any) => {
        if (!old) return old
        const optimisticLeg = {
          id: `temp-${Date.now()}`,
          asset_id: params.assetId,
          assets: params.asset,
          action: params.legType === 'long' ? 'buy' : 'sell',
          pair_leg_type: params.legType,
          proposed_weight: null,
          proposed_shares: null,
        }
        const existingLegs = old.legs || old.pairLegs || []
        return { ...old, legs: [...existingLegs, optimisticLeg], pairLegs: [...existingLegs, optimisticLeg] }
      })

      return { previousData }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['trade-detail', pairId], context.previousData)
      }
    },
    onSuccess: (newLeg) => {
      // Replace optimistic leg with real one smoothly
      queryClient.setQueryData(['trade-detail', pairId], (old: any) => {
        if (!old) return old
        const existingLegs = (old.legs || old.pairLegs || []).filter((l: any) => !l.id.startsWith('temp-'))
        const realLeg = {
          id: newLeg.id,
          asset_id: newLeg.asset_id,
          assets: newLeg.assets,
          action: newLeg.action,
          pair_leg_type: newLeg.pair_leg_type,
          proposed_weight: newLeg.proposed_weight,
          proposed_shares: newLeg.proposed_shares,
        }
        return { ...old, legs: [...existingLegs, realLeg], pairLegs: [...existingLegs, realLeg] }
      })
      onLegsChanged?.()
      // Background sync other views after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
        queryClient.invalidateQueries({ queryKey: ['pair-trades'] })
      }, 500)
    },
  })

  // Remove leg mutation with optimistic updates
  const removeLegMutation = useMutation({
    mutationFn: async (legId: string) => {
      return removePairTradeLeg(legId, userId)
    },
    onMutate: async (legId) => {
      setRemovingLegId(null)

      await queryClient.cancelQueries({ queryKey: ['trade-detail', pairId] })

      const previousData = queryClient.getQueryData(['trade-detail', pairId])

      // Optimistic remove
      queryClient.setQueryData(['trade-detail', pairId], (old: any) => {
        if (!old) return old
        const existingLegs = old.legs || old.pairLegs || []
        const filteredLegs = existingLegs.filter((leg: any) => leg.id !== legId)
        return { ...old, legs: filteredLegs, pairLegs: filteredLegs }
      })

      return { previousData }
    },
    onError: (_error, _legId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['trade-detail', pairId], context.previousData)
      }
    },
    onSuccess: () => {
      onLegsChanged?.()
      // Background sync other views after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
        queryClient.invalidateQueries({ queryKey: ['pair-trades'] })
      }, 500)
    },
  })

  const handleAddLeg = useCallback(() => {
    if (!selectedAsset || !addingLegType) return
    addLegMutation.mutate({
      assetId: selectedAsset.id,
      legType: addingLegType,
      asset: selectedAsset,
    })
  }, [selectedAsset, addingLegType, addLegMutation])

  const handleRemoveLeg = useCallback((legId: string) => {
    setRemovingLegId(legId)
    removeLegMutation.mutate(legId)
  }, [removeLegMutation])

  const handleCancelAdd = useCallback(() => {
    setAddingLegType(null)
    setSelectedAsset(null)
    setAssetSearch('')
    setShowSearchResults(false)
  }, [])

  const handleDoneEditing = useCallback(() => {
    setIsEditing(false)
    setAddingLegType(null)
    setSelectedAsset(null)
  }, [])

  const renderLegCard = (leg: TradeLeg, isLong: boolean) => {
    const isRemoving = removingLegId === leg.id
    const isPending = leg.id.startsWith('temp-')
    return (
      <div
        key={leg.id}
        className={clsx(
          "rounded-lg p-3 border",
          isLong
            ? "bg-green-50/50 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40"
            : "bg-red-50/50 dark:bg-red-900/10 border-red-200/60 dark:border-red-800/40",
          isRemoving && "opacity-50",
          isPending && "opacity-80"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-semibold text-gray-900 dark:text-white">
                {leg.assets?.symbol}
              </span>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 block mb-2 truncate">
              {leg.assets?.company_name}
            </span>
            <div className="flex flex-wrap gap-3 text-xs">
              {leg.proposed_weight != null && (
                <div>
                  <span className="text-gray-400">Weight: </span>
                  <span className={clsx(
                    "font-medium",
                    isLong ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  )}>
                    {isLong ? '+' : '-'}{Math.abs(leg.proposed_weight).toFixed(2)}%
                  </span>
                </div>
              )}
              {leg.proposed_shares != null && (
                <div>
                  <span className="text-gray-400">Shares: </span>
                  <span className={clsx(
                    "font-medium",
                    isLong ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  )}>
                    {isLong ? '+' : '-'}{Math.abs(leg.proposed_shares).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Remove button - only in edit mode, hidden for pending legs */}
          {isEditing && isOwner && !isPending && (
            <button
              onClick={() => handleRemoveLeg(leg.id)}
              disabled={isRemoving || removeLegMutation.isPending}
              className={clsx(
                "p-1 rounded transition-colors flex-shrink-0",
                "text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20",
                (isRemoving || removeLegMutation.isPending) && "opacity-50 cursor-not-allowed"
              )}
              title="Remove leg"
            >
              {isRemoving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderAddLegForm = (legType: 'long' | 'short') => {
    if (addingLegType !== legType) return null
    const isLong = legType === 'long'

    return (
      <div className={clsx(
        "rounded-lg p-3 border-2 border-dashed",
        isLong
          ? "border-green-300 dark:border-green-700 bg-green-50/30 dark:bg-green-900/5"
          : "border-red-300 dark:border-red-700 bg-red-50/30 dark:bg-red-900/5"
      )}>
        <div className="space-y-2">
          {selectedAsset ? (
            <div className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600">
              <div>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {selectedAsset.symbol}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                  {selectedAsset.company_name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedAsset(null)
                  setAssetSearch('')
                }}
                className="text-xs text-primary-600 hover:text-primary-700"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search asset..."
                value={assetSearch}
                onChange={(e) => {
                  setAssetSearch(e.target.value)
                  setShowSearchResults(true)
                }}
                onFocus={() => setShowSearchResults(true)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {showSearchResults && searchResults && searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {searchResults.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        setSelectedAsset(asset)
                        setShowSearchResults(false)
                        setAssetSearch('')
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        {asset.symbol}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        {asset.company_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancelAdd}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Cancel
            </button>
            <button
              onClick={handleAddLeg}
              disabled={!selectedAsset || addLegMutation.isPending}
              className={clsx(
                "px-2 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1",
                isLong
                  ? "bg-green-600 text-white hover:bg-green-700 disabled:bg-green-400"
                  : "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400",
                (!selectedAsset || addLegMutation.isPending) && "opacity-50 cursor-not-allowed"
              )}
            >
              {addLegMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Add
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
      {/* Section header with edit toggle */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Trade Legs</h3>
        {isOwner && (
          <div className="flex items-center gap-2">
            {isEditing ? (
              <button
                onClick={handleDoneEditing}
                className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium flex items-center gap-1"
              >
                <Check className="h-3.5 w-3.5" />
                Done
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                title="Edit legs"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Two column layout for legs */}
      <div className="grid grid-cols-2 gap-3">
        {/* Buy legs column */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-green-600 dark:text-green-400 uppercase mb-2">
            Buy
          </div>
          {longLegs.map((leg) => renderLegCard(leg, true))}
          {longLegs.length === 0 && !isEditing && (
            <p className="text-xs text-gray-400 italic p-2">No buy legs</p>
          )}
          {renderAddLegForm('long')}
          {/* Add buy leg button */}
          {isEditing && addingLegType !== 'long' && (
            <button
              onClick={() => setAddingLegType('long')}
              className="w-full p-2 border-2 border-dashed border-green-200 dark:border-green-800 rounded-lg text-xs text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors flex items-center justify-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Buy
            </button>
          )}
        </div>

        {/* Sell legs column */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-red-600 dark:text-red-400 uppercase mb-2">
            Sell
          </div>
          {shortLegs.map((leg) => renderLegCard(leg, false))}
          {shortLegs.length === 0 && !isEditing && (
            <p className="text-xs text-gray-400 italic p-2">No sell legs</p>
          )}
          {renderAddLegForm('short')}
          {/* Add sell leg button */}
          {isEditing && addingLegType !== 'short' && (
            <button
              onClick={() => setAddingLegType('short')}
              className="w-full p-2 border-2 border-dashed border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center justify-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Sell
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default PairTradeLegEditor
