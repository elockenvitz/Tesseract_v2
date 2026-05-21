/**
 * usePilotProgress — reads users.pilot_progress and exposes a
 * markPilotStage mutator. Drives pilot unlock behavior layered on top of
 * usePilotMode's static access config.
 *
 * Stage keys are plain strings so we can evolve without migrations.
 * Known stages today:
 *   - trade_book_unlocked      — first time the pilot ACTUALLY executes a
 *                                trade via Trade Lab in this org
 *                                (`pilot-tradelab:executed` event).
 *                                Stored per-org as
 *                                `trade_book_unlocked_at_<orgId>`.
 *   - outcomes_unlocked        — first time the pilot clicks "Open
 *                                Outcomes" on the Trade Book Get Started
 *                                banner (or the parallel View Outcomes
 *                                CTA). Stored per-org as
 *                                `outcomes_unlocked_at_<orgId>`.
 *   - graduated                — first time the user reaches Outcomes
 *                                in a given org. Stored per-org as
 *                                `graduated_at_<orgId>`.
 *
 * All three flags are per-org so an analyst testing across multiple
 * pilot clients (or restarting a single client's onboarding) doesn't
 * carry unlock state between orgs. Legacy global keys
 * (`trade_book_unlocked_at`, `outcomes_unlocked_at`, `graduated_at` with
 * no org suffix) are deliberately NOT read — old test state must be
 * cleared via the Reset Progress button on OpsPilotPanel.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { logPilotEvent } from '../lib/pilot/pilot-telemetry'

export type PilotStage =
  | 'trade_book_unlocked'
  | 'outcomes_unlocked'
  | 'graduated'

export interface PilotProgress {
  /** @deprecated user-level legacy keys, no longer read or written.
   *  Kept on the type so leftover values in pilot_progress JSONB don't
   *  trip up TypeScript. Clear via OpsPilotPanel Reset Progress button. */
  trade_book_unlocked_at?: string | null
  /** @deprecated user-level legacy key — see above. */
  outcomes_unlocked_at?: string | null
  /** @deprecated user-level legacy key — see above. */
  graduated_at?: string | null
  /** Per-org timestamps for each stage live as
   *  `<stage>_at_<orgId>` keys inside this same JSONB. The index
   *  signature below covers them. */
  [key: string]: string | null | undefined
}

const tradeBookUnlockedKey = (orgId: string | null) => `trade_book_unlocked_at_${orgId || 'no-org'}`
const outcomesUnlockedKey  = (orgId: string | null) => `outcomes_unlocked_at_${orgId || 'no-org'}`
const graduatedKey         = (orgId: string | null) => `graduated_at_${orgId || 'no-org'}`

const stageToKey = (stage: PilotStage, orgId: string | null): string => {
  switch (stage) {
    case 'trade_book_unlocked': return tradeBookUnlockedKey(orgId)
    case 'outcomes_unlocked':   return outcomesUnlockedKey(orgId)
    case 'graduated':           return graduatedKey(orgId)
  }
}

/** localStorage hint key — read synchronously on mount so a hard refresh
 *  doesn't flash the pilot dashboard for ~200ms before the real
 *  pilot_progress query resolves. Mirrors the `was_pilot_<userId>` cache
 *  in usePilotMode. */
const cachedGraduatedKey = (userId: string, orgId: string | null) =>
  `pilot_graduated_${userId}_${orgId || 'no-org'}`

const STAGE_TO_EVENT: Record<PilotStage, string> = {
  trade_book_unlocked: 'pilot_trade_book_unlocked',
  outcomes_unlocked: 'pilot_outcomes_unlocked',
  graduated: 'pilot_graduated',
}

export function usePilotProgress() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['pilot-progress', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<PilotProgress> => {
      const { data, error } = await supabase
        .from('users')
        .select('pilot_progress')
        .eq('id', user!.id)
        .maybeSingle()
      if (error) return {}
      return (data?.pilot_progress ?? {}) as PilotProgress
    },
  })

  const progress: PilotProgress = query.data ?? {}

  const markStage = useMutation({
    mutationFn: async (stage: PilotStage) => {
      if (!user?.id) return
      // All three stages are per-org (see file header).
      const key = stageToKey(stage, currentOrgId)
      // Already marked? Don't re-write.
      if (progress[key]) return

      const nextProgress: PilotProgress = { ...progress, [key]: new Date().toISOString() }
      const { error } = await supabase
        .from('users')
        .update({ pilot_progress: nextProgress })
        .eq('id', user.id)
      if (error) throw error
      logPilotEvent({ eventType: STAGE_TO_EVENT[stage] })
      return nextProgress
    },
    // Optimistic update: flip the unlock flag in cache immediately so
    // dependent gates (pilot access map → Outcomes 'preview' vs 'full',
    // dashboard CTA `locked: !hasUnlockedOutcomes`, etc.) reflect the
    // new state synchronously inside the same dispatchEvent tick that
    // fires the mutation. Without this, clicking "View Outcomes" from
    // Trade Book navigated to the Outcomes tab before the cache had
    // flipped — pilot access was still 'preview' for the first render,
    // so the user briefly saw the PilotOutcomesPreview "go to Trade
    // Lab" teaser before the DB write resolved and re-rendered the
    // full page. Note that this onMutate is SYNCHRONOUS by design (no
    // `await`) — an async onMutate yields a microtask, which is enough
    // time for a sibling dispatchEvent listener to render against the
    // pre-flip cache. Skipping cancelQueries is safe here because the
    // query has staleTime: 60_000, so a stale background fetch wiping
    // the optimistic flag is highly unlikely; the onSuccess setQueryData
    // is the authoritative reconcile.
    onMutate: (stage: PilotStage) => {
      if (!user?.id) return
      const key = stageToKey(stage, currentOrgId)
      if (progress[key]) return  // No-op — already marked
      const previous = queryClient.getQueryData<PilotProgress>(['pilot-progress', user.id])
      const optimistic: PilotProgress = { ...(previous ?? progress), [key]: new Date().toISOString() }
      queryClient.setQueryData(['pilot-progress', user.id], optimistic)
      return { previous }
    },
    onError: (_error, _stage, context) => {
      // Roll back the optimistic flip if the DB write fails.
      if (context?.previous !== undefined && user?.id) {
        queryClient.setQueryData(['pilot-progress', user.id], context.previous)
      }
    },
    onSuccess: (next) => {
      if (next) {
        queryClient.setQueryData(['pilot-progress', user?.id], next)
      }
      // Force usePilotMode to re-resolve access
      queryClient.invalidateQueries({ queryKey: ['pilot-progress', user?.id] })
    },
  })

  /** Stable callback — safe to pass into useEffect deps. */
  const mark = useCallback((stage: PilotStage) => {
    markStage.mutate(stage)
  }, [markStage])

  const hasGraduated = !!progress[graduatedKey(currentOrgId)]

  // Cached hint from the previous session: did the user graduate in the
  // currently selected org? Read synchronously on mount so the very first
  // render — before pilot_progress has loaded — knows the right answer.
  // Without this, post-graduation users see the pilot dashboard flash for
  // a beat on every hard refresh while the query is in flight.
  const cachedHasGraduated = useMemo<boolean>(() => {
    if (!user?.id) return false
    try {
      return localStorage.getItem(cachedGraduatedKey(user.id, currentOrgId)) === '1'
    } catch {
      return false
    }
  }, [user?.id, currentOrgId])

  // Keep the cache in sync with the real value once the query resolves so
  // the next cold refresh starts from the correct hint.
  useEffect(() => {
    if (query.isLoading || !user?.id) return
    try {
      localStorage.setItem(cachedGraduatedKey(user.id, currentOrgId), hasGraduated ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [query.isLoading, hasGraduated, user?.id, currentOrgId])

  return {
    progress,
    isLoading: query.isLoading,
    hasUnlockedTradeBook: !!progress[tradeBookUnlockedKey(currentOrgId)],
    hasUnlockedOutcomes: !!progress[outcomesUnlockedKey(currentOrgId)],
    /** Per-org: true only if the user has reached Outcomes in the
     *  CURRENT org. Each new pilot client starts as not-yet-graduated
     *  even for an analyst who's graduated in prior clients. */
    hasGraduated,
    /** Best-effort `hasGraduated` that falls back to a cached hint from
     *  the previous session while the real query is loading. Use this
     *  for UI gates that need to stay stable across a cold refresh. */
    cachedHasGraduated,
    mark,
  }
}
