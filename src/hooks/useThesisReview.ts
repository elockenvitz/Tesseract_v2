/**
 * Recording that a thesis was reviewed and still holds.
 *
 * The only durable trace of a review used to be an edit to the thesis itself,
 * which meant "I read this and nothing has changed" could not be said at all.
 * This writes one `memory_events` row and nothing else: no thesis edit, no
 * copy of the thesis text, no new table.
 *
 * RLS posture: `memory_events` INSERT is policy-gated on org membership AND
 * `actor_id = auth.uid()`, so this cannot attribute a conclusion to anyone
 * else. Nothing is widened here.
 */
import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { latestReviewByAsset } from '../lib/memory/thesis-review'

/** What the reader concluded. Only the outcome is stored -- the semantic
 *  snapshot, not prose. `holds` is the one this pass produces. */
export type ThesisReviewOutcome = 'holds' | 'changed' | 'needs_work'

export const THESIS_REVIEWS_KEY = ['memory', 'thesis-reviews'] as const

/**
 * Newest `thesis.reviewed` per asset for the current org.
 *
 * One query for the whole surface rather than one per subject: the Research
 * scan already works that way, and a per-tile read would cost a query per
 * card to answer a question about a date.
 */
export function useThesisReviews() {
  const { currentOrgId } = useOrganization()

  const { data } = useQuery({
    queryKey: [...THESIS_REVIEWS_KEY, currentOrgId],
    enabled: !!currentOrgId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memory_events')
        .select('subject_id, occurred_at')
        .eq('organization_id', currentOrgId!)
        .eq('event_type', 'thesis.reviewed')
        .eq('subject_type', 'asset')
        .order('occurred_at', { ascending: false })
      if (error) throw new Error(error.message)
      return latestReviewByAsset((data ?? []) as { subject_id: string; occurred_at: string }[])
    },
  })

  return data ?? new Map<string, string>()
}

/**
 * Record a review.
 *
 * `dedupe_key` is one client-generated request id per submit, not a per-day
 * key: two genuine reviews of the same thesis in one afternoon are two
 * events, and a calendar-day key would silently swallow the second. The
 * partial unique index on (organization_id, dedupe_key) makes a retry of the
 * SAME submit -- a double click, a flaky network, a remount -- land once.
 */
export function useRecordThesisReview(assetId: string | null | undefined) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()
  // Held across retries so a resubmit of the same intent dedupes server-side
  // rather than relying on the button being disabled.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

  const mutation = useMutation({
    mutationFn: async (outcome: ThesisReviewOutcome) => {
      if (!assetId || !currentOrgId || !user?.id) throw new Error('Missing asset, org or user')
      const { error } = await supabase.from('memory_events').insert({
        organization_id: currentOrgId,
        actor_id: user.id,
        event_type: 'thesis.reviewed',
        subject_type: 'asset',
        subject_id: assetId,
        provenance: 'ui:research',
        // The conclusion, and nothing else. No thesis text, no prose.
        payload: { outcome },
        dedupe_key: `thesis.reviewed:${requestId}`,
      } as never)
      // A duplicate is the idempotency working, not a failure: the reader
      // pressed twice and one review was recorded.
      if (error && !/duplicate key|unique constraint/i.test(error.message)) {
        throw new Error(error.message)
      }
      return outcome
    },
    onSuccess: () => {
      // A new submit is a new intent, so it gets its own id.
      setRequestId(crypto.randomUUID())
      queryClient.invalidateQueries({ queryKey: THESIS_REVIEWS_KEY })
    },
  })

  const record = useCallback((outcome: ThesisReviewOutcome) => {
    // Both the guard and the disabled button, for the reason the capture form
    // needed both: a keyboard path can reach a handler a disabled button cannot.
    if (mutation.isPending) return
    mutation.mutate(outcome)
  }, [mutation])

  return { record, isPending: mutation.isPending, isDone: mutation.isSuccess, error: mutation.error }
}
