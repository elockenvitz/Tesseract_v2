/**
 * useDecisionRequests — React Query hooks for the decision_requests table.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createDecisionRequest,
  getAllDecisionRequests,
  getNeedsDecisionRequests,
  getDecisionRequestsForIdea,
  updateDecisionRequest,
  deleteDecisionRequest,
} from '../lib/services/decision-request-service'
import {
  acceptFromInbox,
  revertAcceptFromInbox,
  findAcceptedTradeForDecisionRequest,
} from '../lib/services/inbox-accept-pipeline'
import type { CreateDecisionRequestInput, UpdateDecisionRequestInput } from '../lib/services/decision-request-service'
import type { AcceptFromInboxParams, RevertAcceptParams } from '../lib/services/inbox-accept-pipeline'
import type { DecisionRequest } from '../types/trading'

/**
 * Fetch ALL decision requests, optionally filtered by portfolio.
 * Used by Decision Inbox to bucket by status.
 */
export function useAllDecisionRequests(portfolioId?: string) {
  return useQuery<DecisionRequest[]>({
    queryKey: ['decision-requests', 'all', portfolioId || 'all'],
    queryFn: () => getAllDecisionRequests(portfolioId || undefined),
    staleTime: 30_000,
  })
}

/**
 * Fetch only requests that need PM action (pending, under_review, needs_discussion).
 */
export function useNeedsDecisionRequests(portfolioId?: string) {
  return useQuery<DecisionRequest[]>({
    queryKey: ['decision-requests', 'needs-decision', portfolioId || 'all'],
    queryFn: () => getNeedsDecisionRequests(portfolioId || undefined),
    staleTime: 30_000,
  })
}

/**
 * Fetch decision requests for a specific trade idea.
 */
export function useDecisionRequestsForIdea(tradeQueueItemId: string | undefined) {
  return useQuery<DecisionRequest[]>({
    queryKey: ['decision-requests', 'idea', tradeQueueItemId],
    queryFn: () => getDecisionRequestsForIdea(tradeQueueItemId!),
    enabled: !!tradeQueueItemId,
    staleTime: 30_000,
  })
}

/**
 * Create a decision request.
 */
export function useCreateDecisionRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateDecisionRequestInput) => createDecisionRequest(input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
      queryClient.invalidateQueries({ queryKey: ['decision-requests', 'idea', variables.tradeQueueItemId] })
    },
  })
}

/**
 * Update a decision request (accept/reject/defer/withdraw etc).
 */
export function useUpdateDecisionRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ requestId, input }: { requestId: string; input: UpdateDecisionRequestInput }) =>
      updateDecisionRequest(requestId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
    },
  })
}

/**
 * Delete a decision request.
 */
export function useDeleteDecisionRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (requestId: string) => deleteDecisionRequest(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
    },
  })
}

/**
 * Accept a decision request from the inbox — creates an accepted_trade on the Trade Book.
 */
export function useAcceptFromInbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: AcceptFromInboxParams) => acceptFromInbox(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
      queryClient.invalidateQueries({ queryKey: ['accepted-trades'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals'] })
    },
  })
}

/**
 * Revert an accepted decision — reverts the accepted_trade and moves request back to pending.
 */
export function useRevertDecisionAccept() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: RevertAcceptParams) => revertAcceptFromInbox(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
      queryClient.invalidateQueries({ queryKey: ['accepted-trades'] })
    },
  })
}

export { findAcceptedTradeForDecisionRequest }
