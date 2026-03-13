/**
 * Trade Journal Hooks
 *
 * React Query hooks for the portfolio Trade Journal system.
 * Provides data fetching, mutations, and summary queries.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import {
  getTradeEvents,
  createTradeEvent,
  updateTradeEventStatus,
  deleteTradeEvent,
  saveRationale,
  getTradeJournalSummary,
  getPendingRationaleCount,
} from '../lib/services/trade-event-service'
import type {
  TradeEventWithDetails,
  CreateTradeEventParams,
  SaveRationaleParams,
  TradeJournalSummary,
  TradeEventStatus,
} from '../types/trade-journal'

// ============================================================
// Query Keys
// ============================================================

const journalKeys = {
  all: ['trade-journal'] as const,
  events: (portfolioId: string) => [...journalKeys.all, 'events', portfolioId] as const,
  summary: (portfolioId: string) => [...journalKeys.all, 'summary', portfolioId] as const,
  pending: (portfolioId: string) => [...journalKeys.all, 'pending', portfolioId] as const,
  rationales: (eventId: string) => [...journalKeys.all, 'rationales', eventId] as const,
}

// ============================================================
// useTradeJournalEvents
// ============================================================

interface UseTradeJournalEventsOptions {
  portfolioId: string
  enabled?: boolean
  status?: TradeEventStatus[]
  dateFrom?: string
  dateTo?: string
  limit?: number
}

export function useTradeJournalEvents(options: UseTradeJournalEventsOptions) {
  const { portfolioId, enabled = true, status, dateFrom, dateTo, limit } = options

  return useQuery({
    queryKey: [...journalKeys.events(portfolioId), { status, dateFrom, dateTo }],
    queryFn: () => getTradeEvents(portfolioId, { status, dateFrom, dateTo, limit }),
    enabled: !!portfolioId && enabled,
    staleTime: 30_000,
  })
}

// ============================================================
// useTradeJournalSummary
// ============================================================

export function useTradeJournalSummary(portfolioId: string, enabled = true) {
  return useQuery({
    queryKey: journalKeys.summary(portfolioId),
    queryFn: () => getTradeJournalSummary(portfolioId),
    enabled: !!portfolioId && enabled,
    staleTime: 60_000,
  })
}

// ============================================================
// usePendingRationaleCount
// ============================================================

export function usePendingRationaleCount(portfolioId: string, enabled = true) {
  return useQuery({
    queryKey: journalKeys.pending(portfolioId),
    queryFn: () => getPendingRationaleCount(portfolioId),
    enabled: !!portfolioId && enabled,
    staleTime: 60_000,
  })
}

// ============================================================
// useCreateTradeEvent
// ============================================================

export function useCreateTradeEvent(portfolioId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateTradeEventParams) => {
      const { data: { user } } = await supabase.auth.getUser()
      return createTradeEvent(params, user?.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: journalKeys.events(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.summary(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.pending(portfolioId) })
    },
  })
}

// ============================================================
// useUpdateTradeEventStatus
// ============================================================

export function useUpdateTradeEventStatus(portfolioId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ eventId, status }: { eventId: string; status: TradeEventStatus }) => {
      const { data: { user } } = await supabase.auth.getUser()
      return updateTradeEventStatus(eventId, status, user?.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: journalKeys.events(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.summary(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.pending(portfolioId) })
    },
  })
}

// ============================================================
// useDeleteTradeEvent
// ============================================================

export function useDeleteTradeEvent(portfolioId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (eventId: string) => deleteTradeEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: journalKeys.events(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.summary(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.pending(portfolioId) })
    },
  })
}

// ============================================================
// useSaveRationale
// ============================================================

export function useSaveRationale(portfolioId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: SaveRationaleParams) => {
      const { data: { user } } = await supabase.auth.getUser()
      return saveRationale(params, user?.id)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: journalKeys.events(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.summary(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.pending(portfolioId) })
      queryClient.invalidateQueries({ queryKey: journalKeys.rationales(variables.trade_event_id) })
    },
  })
}
