/**
 * useAcceptedTrades — React Query hooks for the Trade Book (accepted_trades).
 *
 * Pattern follows useIntentVariants.ts: surgical setQueryData, realtime, staleTime: 30s.
 */

import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import {
  getAcceptedTradesForPortfolio,
  createAcceptedTrade,
  updateAcceptedTradeSizing,
  revertAcceptedTrade,
  createCorrectionTrade,
  updateExecutionStatus,
  acceptFromInboxToAcceptedTrade,
  bulkPromoteFromSimulation,
  bulkPromoteWithBatch,
  createAdHocAcceptedTrade,
  addComment,
  getComments,
  getTradeBatchesForPortfolio,
  createTradeBatch,
} from '../lib/services/accepted-trade-service'
import type {
  AcceptedTradeWithJoins,
  AcceptedTradeComment,
  TradeBatch,
  ActionContext,
  ExecutionStatus,
  TradeAction,
  DecisionRequest,
} from '../types/trading'
import type { AcceptFromInboxToTradeBookParams, BulkPromoteParams, CreateCorrectionTradeInput } from '../lib/services/accepted-trade-service'

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useAcceptedTrades(portfolioId: string | undefined) {
  const queryClient = useQueryClient()

  // ---- Query ----
  const tradesQuery = useQuery<AcceptedTradeWithJoins[]>({
    queryKey: ['accepted-trades', portfolioId],
    queryFn: () => getAcceptedTradesForPortfolio(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 30_000,
  })

  // ---- Realtime ----
  useEffect(() => {
    if (!portfolioId) return

    const channel = supabase
      .channel(`accepted-trades-${portfolioId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'accepted_trades',
          filter: `portfolio_id=eq.${portfolioId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['accepted-trades', portfolioId] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [portfolioId, queryClient])

  // ---- Mutations ----

  const acceptFromInboxM = useMutation({
    mutationFn: (params: AcceptFromInboxToTradeBookParams) =>
      acceptFromInboxToAcceptedTrade(params),
    onSuccess: (newTrade) => {
      // Surgical insert
      queryClient.setQueryData<AcceptedTradeWithJoins[]>(
        ['accepted-trades', newTrade.portfolio_id],
        (old) => old ? [...old, newTrade] : [newTrade]
      )
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
    },
  })

  const bulkPromoteM = useMutation({
    mutationFn: (params: BulkPromoteParams) => bulkPromoteFromSimulation(params),
    onSuccess: (newTrades) => {
      if (newTrades.length === 0) return
      const pid = newTrades[0].portfolio_id
      queryClient.setQueryData<AcceptedTradeWithJoins[]>(
        ['accepted-trades', pid],
        (old) => old ? [...old, ...newTrades] : newTrades
      )
      queryClient.invalidateQueries({ queryKey: ['intent-variants'] })
    },
  })

  const createAdHocM = useMutation({
    mutationFn: (params: {
      portfolioId: string
      assetId: string
      action: TradeAction
      sizingInput?: string
      note?: string
      context: ActionContext
    }) => createAdHocAcceptedTrade(params),
    onSuccess: (newTrade) => {
      queryClient.setQueryData<AcceptedTradeWithJoins[]>(
        ['accepted-trades', newTrade.portfolio_id],
        (old) => old ? [...old, newTrade] : [newTrade]
      )
    },
  })

  const updateSizingM = useMutation({
    mutationFn: (params: {
      id: string
      updates: {
        sizing_input?: string
        action?: TradeAction
        target_weight?: number | null
        target_shares?: number | null
        delta_weight?: number | null
        delta_shares?: number | null
        notional_value?: number | null
      }
      context: ActionContext
    }) => updateAcceptedTradeSizing(params.id, params.updates, params.context),
    onSuccess: (updated) => {
      queryClient.setQueryData<AcceptedTradeWithJoins[]>(
        ['accepted-trades', updated.portfolio_id],
        (old) => old?.map(t => t.id === updated.id ? updated : t) ?? []
      )
    },
  })

  const updateExecutionStatusM = useMutation({
    mutationFn: (params: {
      id: string
      status: ExecutionStatus
      note: string | null
      context: ActionContext
    }) => updateExecutionStatus(params.id, params.status, params.note, params.context),
    onSuccess: (updated) => {
      queryClient.setQueryData<AcceptedTradeWithJoins[]>(
        ['accepted-trades', updated.portfolio_id],
        (old) => old?.map(t => t.id === updated.id ? updated : t) ?? []
      )
    },
  })

  const revertM = useMutation({
    mutationFn: (params: { id: string; reason: string; context: ActionContext }) =>
      revertAcceptedTrade(params.id, params.reason, params.context),
    onSuccess: (_data, variables) => {
      // Remove from cache
      queryClient.setQueryData<AcceptedTradeWithJoins[]>(
        ['accepted-trades', portfolioId],
        (old) => old?.filter(t => t.id !== variables.id) ?? []
      )
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
    },
  })

  const correctM = useMutation({
    mutationFn: (input: CreateCorrectionTradeInput) => createCorrectionTrade(input),
    onSuccess: (newTrade) => {
      // Append the correction to the cache. The original stays in place —
      // corrections are additive, not replacements.
      queryClient.setQueryData<AcceptedTradeWithJoins[]>(
        ['accepted-trades', portfolioId],
        (old) => (old ? [...old, newTrade] : [newTrade]),
      )
    },
  })

  const addCommentM = useMutation({
    mutationFn: (params: { tradeId: string; userId: string; content: string; commentType?: string }) =>
      addComment(params.tradeId, params.userId, {
        content: params.content,
        comment_type: params.commentType,
      }),
    onSuccess: (_data, params) => {
      // Refresh the per-trade comment thread so the newly-added note
      // appears immediately in TradeRationaleLog.
      queryClient.invalidateQueries({ queryKey: ['accepted-trade-comments', params.tradeId] })
    },
  })

  // ---- Batch mutations ----

  const bulkPromoteWithBatchM = useMutation({
    mutationFn: (params: {
      variantIds: string[]
      portfolioId: string
      batchName?: string
      context: ActionContext
    }) => bulkPromoteWithBatch(params),
    onSuccess: ({ trades: newTrades }) => {
      if (newTrades.length === 0) return
      const pid = newTrades[0].portfolio_id
      queryClient.setQueryData<AcceptedTradeWithJoins[]>(
        ['accepted-trades', pid],
        (old) => old ? [...old, ...newTrades] : newTrades
      )
      queryClient.invalidateQueries({ queryKey: ['intent-variants'] })
      queryClient.invalidateQueries({ queryKey: ['trade-batches', portfolioId] })
    },
  })

  return {
    trades: tradesQuery.data ?? [],
    isLoading: tradesQuery.isLoading,
    error: tradesQuery.error,

    acceptFromInbox: acceptFromInboxM.mutateAsync,
    acceptFromInboxM,
    bulkPromote: bulkPromoteM.mutateAsync,
    bulkPromoteM,
    bulkPromoteWithBatch: bulkPromoteWithBatchM.mutateAsync,
    bulkPromoteWithBatchM,
    createAdHoc: createAdHocM.mutateAsync,
    createAdHocM,
    updateSizing: updateSizingM.mutateAsync,
    updateSizingM,
    updateExecutionStatus: updateExecutionStatusM.mutateAsync,
    updateExecutionStatusM,
    revert: revertM.mutateAsync,
    revertM,
    correct: correctM.mutateAsync,
    correctM,
    addComment: addCommentM.mutateAsync,
    addCommentM,
  }
}

// ---------------------------------------------------------------------------
// Comments hook (per-trade)
// ---------------------------------------------------------------------------

export function useAcceptedTradeComments(tradeId: string | undefined) {
  return useQuery<AcceptedTradeComment[]>({
    queryKey: ['accepted-trade-comments', tradeId],
    queryFn: () => getComments(tradeId!),
    enabled: !!tradeId,
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// Trade Batches hook
// ---------------------------------------------------------------------------

// Batches are pure grouping/context objects. No review/approval workflow.
export function useTradeBatches(portfolioId: string | undefined) {
  const batchesQuery = useQuery<TradeBatch[]>({
    queryKey: ['trade-batches', portfolioId],
    queryFn: () => getTradeBatchesForPortfolio(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 30_000,
  })

  return {
    ...batchesQuery,
    batches: batchesQuery.data ?? [],
  }
}
