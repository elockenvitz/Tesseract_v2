/**
 * Keep `trade_review` obligations in step with the lifecycle rule.
 *
 * ── Where this runs, and why it is not a new scheduler ───────────────────
 *
 * Trade Book already sweeps: `markStaleAcceptedTrades(portfolioId)` runs once
 * per portfolio mount and writes `staleness_flagged_at` -- a durable change to
 * the very field the predicate reads. This rides the same sync point rather
 * than introducing a second one. It is page-local, which is a real limitation
 * and is stated plainly: an obligation for a portfolio nobody opens is not
 * raised until somebody does. A background sweep is the fix for that, and is
 * deliberately not invented here.
 *
 * RLS posture: unchanged. Reads `memory_obligations` under its existing
 * org-member SELECT policy, and writes only through the two RPCs, which are
 * the sole path to obligation state.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  TRADE_REVIEW_KIND,
  planTradeReviewObligations,
  type ReviewableTrade,
} from '../lib/memory/trade-review-obligation'
import { useOpenObligations, OPEN_OBLIGATIONS_KEY } from './useOpenObligations'

export const TRADE_REVIEW_OBLIGATIONS_KEY = ['memory', 'obligations', TRADE_REVIEW_KIND] as const

/** What a consumer needs from an open obligation: enough to voice it and to
 *  clear it. Never the whole row. */
export interface OpenObligation {
  id: string
  owner_id: string | null
  raised_at: string
  due_at: string | null
}

/**
 * Open `trade_review` obligations in this org, by the trade they concern.
 *
 * Delegates to `useOpenObligations` rather than issuing its own query. It
 * had one, and so did each decision-engine call site would have — three
 * queries for one question is how "open obligation" comes to mean three
 * slightly different things on three surfaces. React Query dedupes the
 * fetch, so the Trade Book sync and the engine share a single round trip.
 */
export function useOpenTradeReviewObligations() {
  const { data } = useOpenObligations(TRADE_REVIEW_KIND)

  return useMemo(() => {
    const out = new Map<string, OpenObligation>()
    for (const r of data ?? []) {
      out.set(r.subject_id, {
        id: r.id,
        owner_id: r.owner_id,
        raised_at: r.raised_at,
        due_at: r.due_at,
      })
    }
    return out
  }, [data])
}

/**
 * Raise what the rule now says is owed, clear what it no longer does.
 *
 * Runs after the trades for a portfolio have loaded. Raising is idempotent at
 * the database, so a re-run changes nothing; the local skip is only to save
 * round trips.
 */
export function useSyncTradeReviewObligations(trades: readonly ReviewableTrade[] | undefined) {
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()
  const open = useOpenTradeReviewObligations()
  // One sync per (org, trade-set) so a re-render does not re-issue the RPCs.
  const lastRunRef = useRef<string>('')

  useEffect(() => {
    if (!currentOrgId || !trades || trades.length === 0) return

    const plan = planTradeReviewObligations(trades, new Set(open.keys()))
    if (plan.raise.length === 0 && plan.clearSubjectIds.length === 0) return

    const signature = `${currentOrgId}:${plan.raise.map(t => t.id).sort().join(',')}` +
      `|${plan.clearSubjectIds.slice().sort().join(',')}`
    if (lastRunRef.current === signature) return
    lastRunRef.current = signature

    void (async () => {
      for (const t of plan.raise) {
        const { error } = await supabase.rpc('raise_memory_obligation' as never, {
          p_org_id: currentOrgId,
          p_kind: TRADE_REVIEW_KIND,
          p_subject_type: 'trade',
          p_subject_id: t.id,
          // Existing semantics: the PM who committed it owns reconciling it.
          p_owner_id: t.accepted_by ?? null,
          // The only deadline this model actually has. Null where none was set.
          p_due_at: t.execution_expected_by ?? null,
          p_source_type: 'accepted_trades',
          p_source_id: t.id,
          p_provenance: 'job:trade-book-lifecycle',
        } as never)
        if (error) console.warn('[TradeReview] raise failed', error)
      }

      for (const subjectId of plan.clearSubjectIds) {
        const obligation = open.get(subjectId)
        if (!obligation) continue
        const { error } = await supabase.rpc('clear_memory_obligation' as never, {
          p_obligation_id: obligation.id,
          p_provenance: 'job:trade-book-lifecycle',
        } as never)
        if (error) console.warn('[TradeReview] clear failed', error)
      }

      // Invalidate the shared key, so the decision engine sees what this
      // sync just raised rather than its own 60s-stale copy.
      queryClient.invalidateQueries({ queryKey: OPEN_OBLIGATIONS_KEY })
    })()
  }, [currentOrgId, trades, open, queryClient])
}
