/**
 * useDecisionReview — read + write for the structured Decision Quality
 * evaluation captured on the Outcomes detail panel.
 *
 * Persists to `decision_reviews` (one row per decision_id). The
 * decision_id here matches AccountabilityRow.decision_id, which is
 * polymorphic across trade_queue_items / decision_requests / trade
 * events — we treat it as a plain string identifier and rely on the
 * UNIQUE constraint on the column to enforce one review per decision.
 *
 * A "completed review" is defined by the presence of a non-null
 * decision_quality field (i.e. the PM has at minimum made a quality
 * call). The Outcomes verdict engine reads this to promote a row from
 * `evaluate` → `resolved`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export type DecisionQuality = 'good' | 'mixed' | 'bad' | 'unrated'
export type ThesisOutcome = 'yes' | 'partial' | 'no' | 'unknown'
export type SizingQuality = 'too_small' | 'appropriate' | 'too_large' | 'unknown'

export interface DecisionReview {
  id: string
  decision_id: string
  decision_quality: DecisionQuality | null
  thesis_played_out: ThesisOutcome | null
  sizing_quality: SizingQuality | null
  process_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export type DecisionReviewPatch = {
  decision_quality?: DecisionQuality | null
  thesis_played_out?: ThesisOutcome | null
  sizing_quality?: SizingQuality | null
  process_note?: string | null
}

/** A review is "complete" once a quality call has been made. The other
 *  fields are useful but not strictly required. */
export function isReviewComplete(review: DecisionReview | null | undefined): boolean {
  return !!review?.decision_quality && review.decision_quality !== 'unrated'
}

export function useDecisionReview(decisionId: string | null | undefined) {
  return useQuery({
    queryKey: ['decision-review', decisionId],
    enabled: !!decisionId,
    queryFn: async (): Promise<DecisionReview | null> => {
      if (!decisionId) return null
      const { data, error } = await supabase
        .from('decision_reviews')
        .select('*')
        .eq('decision_id', decisionId)
        .maybeSingle()
      if (error) throw error
      return (data as DecisionReview | null) ?? null
    },
    staleTime: 30_000,
  })
}

/** Bulk-fetch reviews for a list of decision ids. Used by the row badge
 *  pipeline so the verdict engine can promote evaluated rows to
 *  `resolved` without firing a per-row request. */
export function useDecisionReviewsByIds(decisionIds: string[] | null | undefined) {
  const ids = (decisionIds || []).filter(Boolean)
  return useQuery({
    queryKey: ['decision-reviews-by-ids', ids.sort().join('|')],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Map<string, DecisionReview>> => {
      if (ids.length === 0) return new Map()
      const { data, error } = await supabase
        .from('decision_reviews')
        .select('*')
        .in('decision_id', ids)
      if (error) throw error
      const map = new Map<string, DecisionReview>()
      for (const r of (data || []) as DecisionReview[]) {
        map.set(r.decision_id, r)
      }
      return map
    },
    staleTime: 30_000,
  })
}

export function useUpsertDecisionReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      decisionId: string
      userId: string
      patch: DecisionReviewPatch
    }) => {
      const { decisionId, userId, patch } = args
      const payload = {
        decision_id: decisionId,
        decision_quality: patch.decision_quality ?? null,
        thesis_played_out: patch.thesis_played_out ?? null,
        sizing_quality: patch.sizing_quality ?? null,
        process_note: patch.process_note ?? null,
        reviewed_by: userId,
        reviewed_at: patch.decision_quality ? new Date().toISOString() : null,
      }
      const { data, error } = await supabase
        .from('decision_reviews')
        .upsert(payload, { onConflict: 'decision_id' })
        .select()
        .single()
      if (error) throw error
      return data as DecisionReview
    },
    onSuccess: (review) => {
      qc.invalidateQueries({ queryKey: ['decision-review', review.decision_id] })
      qc.invalidateQueries({ queryKey: ['decision-reviews-by-ids'] })
      // Outcomes table re-renders verdicts off the accountability rows,
      // so nudge it too — the engine reads decision_reviews to promote
      // `evaluate` → `resolved`.
      qc.invalidateQueries({ queryKey: ['decision-accountability'] })
    },
  })
}
