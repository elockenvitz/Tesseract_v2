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
 * Since 20261115120000_decision_review_typed_subject the DATABASE resolves
 * that polymorphic id into `subject_type` plus one typed foreign key
 * (trade_queue_item_id / decision_request_id / portfolio_trade_event_id) in a
 * BEFORE-write trigger, discarding anything this module sends for those
 * columns. `decision_id` remains the write key and the upsert conflict target;
 * the typed columns are what a reader should join on.
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

/** What a review is about, as the DATABASE resolved it — not as a caller
 *  claimed. `unknown` is a legacy row whose `decision_id` matches no canonical
 *  record; six such rows exist in production and are invisible under RLS. */
export type ReviewSubjectType = 'idea' | 'decision' | 'trade' | 'unknown'

export interface DecisionReview {
  id: string
  decision_id: string
  /** Absent until 20261115120000 is applied, so every read treats it as
   *  optional and falls back to the caller's own inference. */
  subject_type?: ReviewSubjectType
  trade_queue_item_id?: string | null
  decision_request_id?: string | null
  portfolio_trade_event_id?: string | null
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

/**
 * Does this patch say anything, and so complete the review?
 *
 * This is what stamps `reviewed_at`, and it is deliberately NOT
 * `isReviewComplete`. That predicate asks for `decision_quality`, which the
 * Outcomes UI no longer collects -- it "remains in the schema for future
 * system-derived use but is no longer exposed as a user input". Gating the
 * timestamp on it meant no review recorded through the UI could ever be
 * stamped.
 *
 * `getReviewState` already treats the existence of a review row as
 * 'reviewed'. This matches that: any substantive answer -- a thesis verdict,
 * a note, or a quality call if one is ever supplied again -- completes it.
 *
 * An empty or whitespace-only patch does not. That is the draft case: a row
 * created before anything has been answered, which must stay distinguishable
 * from a review somebody actually wrote.
 *
 * `unknown` ("Too early") counts. Choosing it IS an answer -- the reviewer
 * looked and judged that it is too soon to call -- and it is a value the
 * segmented control writes deliberately, not an absence.
 */
export function hasReviewContent(patch: DecisionReviewPatch): boolean {
  if (patch.decision_quality != null && patch.decision_quality !== 'unrated') return true
  if (patch.thesis_played_out != null) return true
  if (patch.sizing_quality != null) return true
  if (patch.process_note != null && patch.process_note.trim() !== '') return true
  return false
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
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
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
      /** Which table `decisionId` belongs to. `AccountabilityRow.decision_id`
       *  is polymorphic and (source, category) is what disambiguates it:
       *  discretionary → portfolio_trade_events, acted → trade_queue_items,
       *  passed → decision_requests. The caller knows; this does not guess.
       *
       *  Now a FALLBACK only: the trigger resolves the same question from the
       *  data and its answer wins for both the review row and the event. This
       *  is used when the server has no answer — before the migration is
       *  applied, or for an id that resolves to nothing. */
      subjectType?: 'idea' | 'decision' | 'trade'
      organizationId?: string | null
      /** Where the reviewed decision sits, for the event's `related` map.
       *
       *  Measured on production 2026-11-15: both `decision.reviewed` rows
       *  carry `related = {}`. Every other lifecycle event carries pointers --
       *  `execution.recorded` names the asset, the portfolio, the trade, the
       *  request and the idea -- so the Spine's record of what the desk
       *  CONCLUDED is the one kind of event reachable from nothing but its own
       *  subject_id. Asking "what have we learned about this name" of the
       *  event log returns nothing, while the same question of
       *  `decision_reviews` answers fine. */
      assetId?: string | null
      portfolioId?: string | null
    }) => {
      const { decisionId, userId, patch } = args
      /*
       * `organization_id` is deliberately ABSENT here and must stay absent.
       *
       * The column exists (20261009120000) and carries this table's tenant
       * boundary, but it is derived SERVER-SIDE by the
       * `decision_reviews_owner` trigger from the decision being reviewed.
       * A client-supplied value is discarded — and were it trusted, the fix
       * would not work: a caller could stamp their own org onto a row keyed
       * by another tenant's `decision_id`, which is exactly the squat the
       * migration closes.
       *
       * The INSERT policy independently requires `can_review_decision`, so a
       * review for a decision outside the caller's organisation is refused
       * rather than silently created and orphaned.
       */
      const payload = {
        decision_id: decisionId,
        decision_quality: patch.decision_quality ?? null,
        thesis_played_out: patch.thesis_played_out ?? null,
        sizing_quality: patch.sizing_quality ?? null,
        process_note: patch.process_note ?? null,
        reviewed_by: userId,
        /*
         * ── A completed review must carry when it was completed ───────────
         *
         * This was `patch.decision_quality ? now : null`, which stopped being
         * reachable when the UI retired that field. `decision_quality` and
         * `sizing_quality` "remain in the schema for future system-derived
         * use but are no longer exposed as user inputs"
         * (DecisionAccountabilityPage), so nothing a reviewer can type sets
         * them -- and the ternary therefore wrote NULL every time.
         *
         * Measured in the QA org, 2026-11-20: a review recorded through the
         * UI, displayed as REVIEWED and surviving a reload, had
         * `reviewed_at = NULL`. The Outcomes row said the decision had been
         * reviewed; the record could not say when.
         *
         * Worse, the old expression is an UPSERT payload, so it did not
         * merely fail to set the timestamp -- it actively overwrote an
         * existing one with NULL on every later edit.
         *
         * `getReviewState` already treats the EXISTENCE of a review row as
         * 'reviewed'. This aligns the timestamp with that same meaning: any
         * substantive answer completes the review. An empty patch -- the
         * draft case, where a row is created before anything is answered --
         * still leaves it null, which is what distinguishes a draft from a
         * completed review.
         */
        reviewed_at: hasReviewContent(patch) ? new Date().toISOString() : null,
      }
      const { data, error } = await supabase
        .from('decision_reviews')
        .upsert(payload, { onConflict: 'decision_id' })
        .select()
        .single()
      if (error) throw error
      const review = data as DecisionReview

      /*
       * The conclusion, remembered as of this version.
       *
       * `decision_reviews` stays authoritative for the full review and can be
       * edited; the event is immutable and records what was concluded at this
       * moment. So the payload carries the normalised verdict fields only --
       * re-reading the source later gives the conclusion as it stands NOW,
       * which is a different question.
       *
       * `process_note` is deliberately absent. It is prose, it has an
       * authoritative home, and it can be corrected there.
       *
       * Idempotency is the review VERSION: id + updated_at. Saving the same
       * version twice (a retry, a double submit) lands once; a later edit is a
       * genuinely new conclusion and gets its own event. Not calendar-day
       * granularity, which would swallow a same-afternoon correction.
       */
      /*
       * Prefer the subject kind the DATABASE resolved over the one this call
       * inferred.
       *
       * `args.subjectType` is derived in the UI from (source, category). It is
       * right today, but it is an inference, and the event and the review row
       * must not be able to disagree about what was reviewed. The trigger
       * resolves `decision_id` against the three canonical tables, so its
       * answer is the one backed by data.
       *
       * Two fallbacks, both deliberate. Before the migration is applied
       * `subject_type` is simply absent, and `unknown` is not a value
       * `memory_events.subject_type` permits — its CHECK allows asset / idea /
       * decision / trade / batch / portfolio / obligation. In neither case
       * should the event be lost, so the caller's inference stands.
       */
      const resolvedSubjectType =
        review.subject_type && review.subject_type !== 'unknown'
          ? review.subject_type
          : (args.subjectType ?? 'decision')

      if (args.organizationId) {
        const { error: evErr } = await supabase.from('memory_events').insert({
          organization_id: args.organizationId,
          actor_id: userId,
          event_type: 'decision.reviewed',
          subject_type: resolvedSubjectType,
          subject_id: decisionId,
          source_type: 'decision_reviews',
          source_id: review.id,
          /*
           * Pointers, so the conclusion is reachable from the asset and the
           * portfolio rather than only from its own subject_id.
           *
           * The typed ids come from the SERVER-resolved review row, not from
           * the caller: the trigger decided which canonical table
           * `decision_id` names, so exactly one of the three is set and it
           * cannot contradict `subject_type`. Before the migration is applied
           * all three are absent and `related` falls back to the asset and
           * the portfolio alone, which is still strictly more than the `{}`
           * both production rows carry.
           *
           * Nulls are stripped so an absent pointer is omitted rather than
           * recorded as a known absence.
           */
          related: Object.fromEntries(
            Object.entries({
              asset_id: args.assetId ?? null,
              portfolio_id: args.portfolioId ?? null,
              trade_queue_item_id: review.trade_queue_item_id ?? null,
              decision_request_id: review.decision_request_id ?? null,
              portfolio_trade_event_id: review.portfolio_trade_event_id ?? null,
            }).filter(([, v]) => v != null),
          ),
          provenance: 'ui:outcomes',
          payload: {
            thesis_played_out: review.thesis_played_out,
            decision_quality: review.decision_quality,
            sizing_quality: review.sizing_quality,
          },
          dedupe_key: `decision.reviewed:${review.id}:${review.updated_at}`,
        } as never)
        // A duplicate is the idempotency working: the same version was already
        // recorded. Anything else must not silently lose the memory, but must
        // not lose the authoritative review either -- it is already written.
        if (evErr && !/duplicate key|unique constraint/i.test(evErr.message)) {
          console.warn('[DecisionReview] review saved; memory event failed', evErr)
        }
      }

      return review
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
