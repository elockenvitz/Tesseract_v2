/**
 * Desktop Ideas — completing a decision.
 *
 * ── Where the business logic lives, and why none of it is here ────────────
 *
 * `updatePortfolioTrackDecision` in `lib/services/trade-lab-service.ts` is the
 * single production writer of a decision. It updates the portfolio track, sets
 * `decided_by` / `decided_at` from the actor, handles the deferral date, and
 * logs a `decision_*` trade event. All of that is business logic and none of it
 * is reimplemented here — this hook reads the tracks and calls that service.
 *
 * The old `TradeIdeaDetailModal` does exactly the same thing: it wraps the same
 * service in a React Query mutation and adds pickers. So Ideas is not taking
 * ownership of the rules, only offering a second place to invoke them. If the
 * rules change in the service, both surfaces change together.
 *
 * ── Decisions are portfolio-scoped ────────────────────────────────────────
 *
 * This is the fact that shapes the UI. A decision is not one answer per idea;
 * it is one answer per (trade_queue_item, portfolio) track in
 * `trade_idea_portfolios`. The same idea can be accepted for one book and
 * deferred for another, and a surface that offered a single Accept button
 * would be quietly deciding on the user's behalf for every other portfolio.
 */

import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { updatePortfolioTrackDecision } from '../lib/services/trade-lab-service'
import type { DecisionOutcome } from '../types/trading'

export interface PortfolioTrack {
  id: string
  portfolioId: string
  portfolioName: string
  decisionOutcome: DecisionOutcome | null
  decisionReason: string | null
  decidedAt: string | null
  deferredUntil: string | null
}

export function useIdeaDecision(ideaId: string | null) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: tracks = [], isLoading } = useQuery<PortfolioTrack[]>({
    queryKey: ['idea-decision-tracks', ideaId],
    enabled: !!ideaId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_idea_portfolios')
        .select('id, portfolio_id, decision_outcome, decision_reason, decided_at, deferred_until, portfolio:portfolio_id(id, name)')
        .eq('trade_queue_item_id', ideaId!)
      if (error) throw new Error(error.message)
      return (data ?? []).map((r: any): PortfolioTrack => ({
        id: r.id,
        portfolioId: r.portfolio_id,
        portfolioName: r.portfolio?.name ?? 'Portfolio',
        decisionOutcome: r.decision_outcome ?? null,
        decisionReason: r.decision_reason ?? null,
        decidedAt: r.decided_at ?? null,
        deferredUntil: r.deferred_until ?? null,
      }))
    },
  })

  const pending = useMemo(() => tracks.filter(t => !t.decisionOutcome), [tracks])

  const decide = useMutation({
    mutationFn: async (args: {
      portfolioId: string
      outcome: DecisionOutcome
      reason?: string
      deferredUntil?: string | null
    }) => {
      if (!ideaId) throw new Error('No idea selected')
      // The service owns the rules; this only supplies who is acting and why.
      return updatePortfolioTrackDecision(
        {
          trade_queue_item_id: ideaId,
          portfolio_id: args.portfolioId,
          decision_outcome: args.outcome,
          decision_reason: args.reason || null,
          deferred_until: args.outcome === 'deferred' ? (args.deferredUntil ?? null) : null,
        },
        {
          actorId: user?.id || '',
          actorRole: ((user as any)?.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
          actorName: [(user as any)?.first_name, (user as any)?.last_name].filter(Boolean).join(' ')
            || (user as any)?.email || '',
          actorEmail: (user as any)?.email || '',
          // Distinguishes an Ideas-workspace decision from a modal one in the
          // event log, without changing what the decision means.
          uiSource: 'ideas_workspace',
          requestId: crypto.randomUUID(),
        },
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['idea-decision-tracks', ideaId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['desktop-ideas'] })
      queryClient.invalidateQueries({ queryKey: ['attention'] })
    },
  })

  return {
    tracks,
    pending,
    /** True when this idea genuinely has a decision waiting to be made. */
    canDecide: pending.length > 0,
    isLoading,
    decide: decide.mutate,
    isDeciding: decide.isPending,
    error: decide.error as Error | null,
  }
}
