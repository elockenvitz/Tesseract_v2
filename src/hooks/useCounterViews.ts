/**
 * useCounterViews — query + mutation hooks for trade idea counter-views.
 *
 * A counter-view is a separate trade idea linked to another idea via
 * object_links with link_type = 'opposes'. This hook provides:
 * - Query: fetch counter-views for a trade idea
 * - Count: lightweight badge count
 * - Mutation: create a counter-view
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCounterViews,
  countCounterViews,
  createCounterView,
  type CreateCounterViewParams,
  type CounterViewSummary,
} from '../lib/services/counter-view-service'

/**
 * Fetch counter-views for a trade idea.
 */
export function useCounterViews(tradeIdeaId: string | undefined) {
  return useQuery({
    queryKey: ['counter-views', tradeIdeaId],
    queryFn: () => getCounterViews(tradeIdeaId!),
    enabled: !!tradeIdeaId,
    staleTime: 30_000,
  })
}

/**
 * Lightweight count of counter-views (for badges).
 */
export function useCounterViewCount(tradeIdeaId: string | undefined) {
  return useQuery({
    queryKey: ['counter-view-count', tradeIdeaId],
    queryFn: () => countCounterViews(tradeIdeaId!),
    enabled: !!tradeIdeaId,
    staleTime: 60_000,
  })
}

/**
 * Mutation to create a counter-view idea.
 */
export function useCreateCounterView() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: CreateCounterViewParams) => createCounterView(params),
    onSuccess: (_data, variables) => {
      // Invalidate counter-view queries for the original idea
      queryClient.invalidateQueries({ queryKey: ['counter-views', variables.originalIdeaId] })
      queryClient.invalidateQueries({ queryKey: ['counter-view-count', variables.originalIdeaId] })
      // Invalidate trade idea lists so the new idea appears
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue'] })
    },
  })
}

export type { CounterViewSummary, CreateCounterViewParams }
