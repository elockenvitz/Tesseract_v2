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
import { useCallback, useMemo, useState } from 'react'
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { latestConclusionByAsset, latestReviewByAsset } from '../lib/memory/thesis-review'

/**
 * What the reader concluded. Only the outcome is stored -- the semantic
 * snapshot, not prose.
 *
 *   holds       the case still stands as written
 *   changed     the case is no longer what this document says
 *   needs_work  the document is not good enough to judge either way
 *
 * `changed` and `needs_work` are conclusions ABOUT the document, not edits to
 * it. Saying one records a fact and leaves the thesis exactly as it was; only
 * a person rewriting it changes what it says.
 */
export type ThesisReviewOutcome = 'holds' | 'changed' | 'needs_work'

/** The three, in the order the interface offers them. */
export const THESIS_REVIEW_OUTCOMES: readonly ThesisReviewOutcome[] =
  ['holds', 'changed', 'needs_work'] as const

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
        // `payload` is read now because the outcome decides whether a review
        // counts as the case still being current. Every row is fetched, not
        // just the holds -- filtering at the database would make a future
        // consumer of `changed` re-query for rows this already has.
        .select('subject_id, occurred_at, payload')
        .eq('organization_id', currentOrgId!)
        .eq('event_type', 'thesis.reviewed')
        .eq('subject_type', 'asset')
        .order('occurred_at', { ascending: false })
      if (error) throw new Error(error.message)
      return latestReviewByAsset(
        (data ?? []) as { subject_id: string; occurred_at: string; payload?: unknown }[],
      )
    },
  })

  return data ?? new Map<string, string>()
}

/** One instance, so a consumer's memo does not see a new array each render.
 *  Declared before its use: a module const read from a hook is a TDZ error
 *  waiting to happen. */
const EMPTY_CONCERNS: ReadonlyArray<{
  id: string; subject_id: string; occurred_at: string
  outcome: string; organization_id: string | null; actor_id: string | null
}> = []

/**
 * Every recorded conclusion about a thesis, newest first, with its event id.
 *
 * ── Why `holds` is included ──────────────────────────────────────────────
 *
 * It used to be filtered out here, which was wrong in a way that only shows
 * up over time: a reader who marks a thesis `changed` on Monday and `holds`
 * on Friday has changed their mind, and a consumer that never sees the Friday
 * row cannot know that. Filtering at the query made the later, better
 * conclusion invisible and left the earlier alarm standing forever.
 *
 * So this returns all of them and the CONSUMER decides which one speaks. The
 * sibling `useThesisReviews` still answers the narrower question -- "is this
 * case current" -- and deliberately counts only `holds`.
 *
 * Every row is returned rather than the newest per asset: the "latest wins"
 * rule belongs to the producer that needs it, and a future surface showing a
 * review history needs the rest.
 *
 * RLS posture: unchanged. `memory_events` SELECT is already policy-gated on
 * org membership; this is the same table and the same policy, filtered to one
 * event type.
 */
export function useThesisReviewConclusions() {
  const { currentOrgId } = useOrganization()

  const { data } = useQuery({
    queryKey: [...THESIS_REVIEWS_KEY, 'conclusions', currentOrgId],
    enabled: !!currentOrgId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memory_events')
        // `actor_id` so a surface can say "you marked this" rather than
        // "somebody did": a reader correcting an accidental press needs to
        // know whose conclusion they are about to overwrite.
        .select('id, subject_id, occurred_at, payload, organization_id, actor_id')
        .eq('organization_id', currentOrgId!)
        .eq('event_type', 'thesis.reviewed')
        .eq('subject_type', 'asset')
        .order('occurred_at', { ascending: false })
      if (error) throw new Error(error.message)

      const rows = (data ?? []) as {
        id: string; subject_id: string; occurred_at: string
        payload?: { outcome?: string } | null
        organization_id?: string | null; actor_id?: string | null
      }[]

      // Only rows that actually recorded a conclusion. Which conclusions
      // COUNT is the producer's business, not this query's -- dropping
      // `holds` here would hide a reader changing their mind back.
      return rows
        .filter(r => !!r.payload?.outcome)
        .map(r => ({
          id: r.id,
          subject_id: r.subject_id,
          occurred_at: r.occurred_at,
          outcome: r.payload!.outcome!,
          organization_id: r.organization_id ?? null,
          actor_id: r.actor_id ?? null,
        }))
    },
  })

  return data ?? EMPTY_CONCERNS
}

/**
 * The conclusion standing on one asset right now, for showing back.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The review bar used to render three identical unanswered buttons on every
 * mount, and a transient "Recorded" that vanished with the component. So an
 * accidental press was invisible by the next page load, and the reader had no
 * way to see -- let alone correct -- what was on the record. The conclusion is
 * durable; the only thing missing was reading it back.
 *
 * Built on the existing conclusions query, not a new one. That query already
 * fetches every row for the org and is already cached under the shared key, so
 * a per-asset read would cost a round trip to answer a question the client can
 * already answer. `isLoading` is surfaced because a bar that renders "nobody
 * has answered" while the answer is in flight is the same lie in a smaller
 * window.
 */
export function useCurrentThesisConclusion(assetId: string | null | undefined) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const rows = useThesisReviewConclusions()
  const isLoading = useIsFetching({ queryKey: [...THESIS_REVIEWS_KEY, 'conclusions', currentOrgId] }) > 0

  const current = useMemo(() => {
    if (!assetId) return null
    const forAsset = rows.filter(r => r.subject_id === assetId)
    if (!forAsset.length) return null
    const latest = latestConclusionByAsset(forAsset).get(assetId) ?? null
    if (!latest) return null
    return { ...latest, byMe: !!user?.id && latest.actorId === user.id }
  }, [rows, assetId, user?.id])

  return { current, isLoading: isLoading && !current }
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
