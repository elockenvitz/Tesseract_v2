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
  RESOLVED_DECISION_REQUEST_STATUSES,
} from '../lib/services/decision-request-service'
import { usePilotProgress } from './usePilotProgress'
import { operationalAfterPilot, judgeDecisionRequestRow } from '../lib/pilot/seed-visibility'
import {
  acceptFromInbox,
  rejectFromInbox,
  revertAcceptFromInbox,
  findAcceptedTradeForDecisionRequest,
} from '../lib/services/inbox-accept-pipeline'
import type { CreateDecisionRequestInput, UpdateDecisionRequestInput } from '../lib/services/decision-request-service'
import type { AcceptFromInboxParams, RejectFromInboxParams, RevertAcceptParams } from '../lib/services/inbox-accept-pipeline'
import type { DecisionRequest } from '../types/trading'

/**
 * Fetch ALL decision requests, optionally filtered by portfolio.
 * Used by Decision Inbox to bucket by status.
 *
 * After graduation an untouched seeded request is not a decision awaiting an
 * answer. The seeder plants one alongside its recommendation, and a graduated
 * reader's Inbox was still showing it as work. A request the reader actually
 * answered is theirs and stays -- judged by the service's own resolved-status
 * vocabulary, not a second copy of it.
 *
 * `submission_snapshot` is already in `DECISION_REQUEST_SELECT`, so unlike the
 * decision engine this boundary had the marker all along and simply never
 * consulted it.
 */
export function useAllDecisionRequests(portfolioId?: string) {
  const { hasGraduated: liveGraduated, cachedHasGraduated } = usePilotProgress()
  const hasGraduated = liveGraduated || cachedHasGraduated

  return useQuery<DecisionRequest[]>({
    // Graduation changes what this list contains, so it belongs in the key.
    queryKey: ['decision-requests', 'all', portfolioId || 'all', hasGraduated],
    queryFn: async () => {
      const rows = await getAllDecisionRequests(portfolioId || undefined)
      return operationalAfterPilot(
        rows.map(r => ({
          ...r,
          ...judgeDecisionRequestRow(r as never, RESOLVED_DECISION_REQUEST_STATUSES),
        })),
        { hasGraduated },
      ) as DecisionRequest[]
    },
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
 * Reject a decision request from the inbox. Iterative model: marks the DR
 * rejected, deactivates the linked proposal, updates the per-portfolio
 * track, and leaves the trade idea alive on the kanban so the analyst
 * can submit a revised recommendation.
 */
export function useRejectFromInbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: RejectFromInboxParams) => rejectFromInbox(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
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
