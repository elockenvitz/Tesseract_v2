/**
 * useSimulationSuggestions Hook
 *
 * Manages simulation suggestions (suggest access level).
 * Handles query, mutations, realtime subscription, and derived state.
 */

import { useCallback, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useToast } from '../components/common/Toast'
import { supabase } from '../lib/supabase'
import {
  createSuggestion,
  getSuggestionsForSimulation,
  acceptSuggestion,
  rejectSuggestion,
  withdrawSuggestion,
  type SimulationSuggestion,
  type AcceptSuggestionParams,
} from '../lib/services/suggestion-service'
import type { ActionContext, AssetPrice, RoundingConfig, ActiveWeightConfig } from '../types/trading'

// ============================================================
// Types
// ============================================================

interface UseSimulationSuggestionsOptions {
  simulationId?: string | null
  shareId?: string | null
  portfolioId?: string | null
  labId?: string | null
  enabled?: boolean
}

// ============================================================
// Helper
// ============================================================

function buildActionContext(user: any): ActionContext {
  return {
    actorId: user?.id || '',
    actorName:
      [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
      user?.email ||
      '',
    actorEmail: user?.email,
    actorRole: (user?.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
    requestId: crypto.randomUUID(),
    uiSource: 'suggestion_review',
  }
}

// ============================================================
// Main Hook
// ============================================================

export function useSimulationSuggestions(options: UseSimulationSuggestionsOptions) {
  const { simulationId, shareId, portfolioId, labId, enabled = true } = options
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  // ==========================================================================
  // Query
  // ==========================================================================

  const queryKey = ['simulation-suggestions', simulationId]

  const suggestionsQuery = useQuery({
    queryKey,
    queryFn: () =>
      simulationId
        ? getSuggestionsForSimulation(simulationId)
        : Promise.resolve([]),
    enabled: enabled && !!simulationId,
  })

  const suggestions = suggestionsQuery.data ?? []

  // ==========================================================================
  // Derived state
  // ==========================================================================

  const pendingSuggestions = useMemo(
    () => suggestions.filter(s => s.status === 'pending'),
    [suggestions]
  )

  const pendingCount = pendingSuggestions.length

  const pendingSuggestionsByAsset = useMemo(() => {
    const map = new Map<string, SimulationSuggestion[]>()
    for (const s of pendingSuggestions) {
      const list = map.get(s.asset_id) || []
      list.push(s)
      map.set(s.asset_id, list)
    }
    return map
  }, [pendingSuggestions])

  // ==========================================================================
  // Realtime subscription
  // ==========================================================================

  useEffect(() => {
    if (!simulationId || !enabled) return

    const channel = supabase
      .channel(`suggestions-${simulationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'simulation_suggestions',
          filter: `simulation_id=eq.${simulationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [simulationId, enabled, queryClient]) // eslint-disable-line react-hooks/exhaustive-deps

  // ==========================================================================
  // Mutations
  // ==========================================================================

  const createSuggestionM = useMutation({
    mutationFn: (params: { assetId: string; sizingInput: string; notes?: string }) => {
      if (!simulationId || !shareId || !portfolioId || !user?.id) {
        throw new Error('Missing context for creating suggestion')
      }
      return createSuggestion({
        simulationId,
        assetId: params.assetId,
        shareId,
        portfolioId,
        sizingInput: params.sizingInput,
        notes: params.notes,
        suggestedBy: user.id,
      })
    },
    onSuccess: (newSuggestion) => {
      // Surgical cache update
      queryClient.setQueryData<SimulationSuggestion[]>(queryKey, (old) =>
        old ? [newSuggestion, ...old] : [newSuggestion]
      )
      toast.success('Suggestion submitted')
    },
    onError: (err: Error) => {
      toast.error(`Failed to submit suggestion: ${err.message}`)
    },
  })

  const acceptSuggestionM = useMutation({
    mutationFn: (params: {
      suggestionId: string
      currentPosition?: AcceptSuggestionParams['currentPosition']
      price: AssetPrice
      portfolioTotalValue: number
      roundingConfig: RoundingConfig
      activeWeightConfig?: ActiveWeightConfig | null
      hasBenchmark: boolean
    }) => {
      if (!labId || !portfolioId || !user?.id) {
        throw new Error('Missing context for accepting suggestion')
      }
      return acceptSuggestion({
        suggestionId: params.suggestionId,
        actorId: user.id,
        labId,
        portfolioId,
        currentPosition: params.currentPosition,
        price: params.price,
        portfolioTotalValue: params.portfolioTotalValue,
        roundingConfig: params.roundingConfig,
        activeWeightConfig: params.activeWeightConfig,
        hasBenchmark: params.hasBenchmark,
        context: buildActionContext(user),
      })
    },
    onSuccess: (updated) => {
      // Update suggestion in cache
      queryClient.setQueryData<SimulationSuggestion[]>(queryKey, (old) =>
        old?.map(s => s.id === updated.id ? updated : s) ?? []
      )
      // Invalidate variants and simulation to reflect the new variant
      if (labId) {
        queryClient.invalidateQueries({ queryKey: ['intent-variants', labId] })
      }
      if (simulationId) {
        queryClient.invalidateQueries({ queryKey: ['simulation', simulationId] })
      }
      toast.success('Suggestion accepted — variant created')
    },
    onError: (err: Error) => {
      toast.error(`Failed to accept suggestion: ${err.message}`)
    },
  })

  const rejectSuggestionM = useMutation({
    mutationFn: (params: { suggestionId: string; notes?: string }) => {
      if (!user?.id) throw new Error('Not authenticated')
      return rejectSuggestion(params.suggestionId, user.id, params.notes)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<SimulationSuggestion[]>(queryKey, (old) =>
        old?.map(s => s.id === updated.id ? updated : s) ?? []
      )
      toast.success('Suggestion rejected')
    },
    onError: (err: Error) => {
      toast.error(`Failed to reject suggestion: ${err.message}`)
    },
  })

  const withdrawSuggestionM = useMutation({
    mutationFn: (suggestionId: string) => {
      if (!user?.id) throw new Error('Not authenticated')
      return withdrawSuggestion(suggestionId, user.id)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<SimulationSuggestion[]>(queryKey, (old) =>
        old?.map(s => s.id === updated.id ? updated : s) ?? []
      )
      toast.success('Suggestion withdrawn')
    },
    onError: (err: Error) => {
      toast.error(`Failed to withdraw suggestion: ${err.message}`)
    },
  })

  // ==========================================================================
  // Callbacks
  // ==========================================================================

  const submitSuggestion = useCallback(
    (assetId: string, sizingInput: string, notes?: string) => {
      createSuggestionM.mutate({ assetId, sizingInput, notes })
    },
    [createSuggestionM]
  )

  const handleAccept = useCallback(
    (params: Parameters<typeof acceptSuggestionM.mutate>[0]) => {
      acceptSuggestionM.mutate(params)
    },
    [acceptSuggestionM]
  )

  const handleReject = useCallback(
    (suggestionId: string, notes?: string) => {
      rejectSuggestionM.mutate({ suggestionId, notes })
    },
    [rejectSuggestionM]
  )

  const handleWithdraw = useCallback(
    (suggestionId: string) => {
      withdrawSuggestionM.mutate(suggestionId)
    },
    [withdrawSuggestionM]
  )

  return {
    suggestions,
    pendingCount,
    pendingSuggestionsByAsset,
    isLoading: suggestionsQuery.isLoading,
    submitSuggestion,
    acceptSuggestion: handleAccept,
    rejectSuggestion: handleReject,
    withdrawSuggestion: handleWithdraw,
    isSubmitting: createSuggestionM.isPending,
    isAccepting: acceptSuggestionM.isPending,
  }
}

export type { SimulationSuggestion }
