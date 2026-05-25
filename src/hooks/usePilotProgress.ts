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
import * as Sentry from '@sentry/react'
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

  // Synchronous cache of the user's pilot_progress JSONB. Without this,
  // a hard refresh leaves `hasUnlockedTradeBook` / `hasUnlockedOutcomes`
  // undefined for the ~100-300ms it takes the query to resolve. During
  // that window the System Loop computes its active stage from the
  // missing data — so a user who's actually on Review briefly sees the
  // strip highlight Decide, and the Trade Book tab briefly renders the
  // locked preview before swapping to the unlocked page. Hydrating
  // from localStorage on the first render closes the gap.
  const cachedProgress = useMemo<PilotProgress | null>(() => {
    if (!user?.id) return null
    try {
      const raw = localStorage.getItem(`pilot_progress_${user.id}`)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return (typeof parsed === 'object' && parsed !== null) ? (parsed as PilotProgress) : null
    } catch {
      return null
    }
  }, [user?.id])

  const query = useQuery({
    queryKey: ['pilot-progress', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    // initialData hydrates the first render synchronously from the
    // localStorage snapshot. `initialDataUpdatedAt: 0` marks it as
    // already stale so React Query still fires a background refetch
    // on mount to reconcile with the server — but the UI doesn't flash
    // through "undefined → real" during that fetch.
    initialData: cachedProgress ?? undefined,
    initialDataUpdatedAt: 0,
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

  // Persist the freshest progress JSONB to localStorage so the next
  // hard refresh hydrates with the same state instead of waiting on
  // the network round-trip. Keyed per-user; the JSONB itself already
  // encodes the per-org stage keys, so no extra org dimension needed.
  useEffect(() => {
    if (!user?.id || !query.data) return
    try {
      localStorage.setItem(`pilot_progress_${user.id}`, JSON.stringify(query.data))
    } catch {
      /* ignore */
    }
  }, [user?.id, query.data])

  const markStage = useMutation({
    mutationFn: async (stage: PilotStage) => {
      if (!user?.id) return
      // All three stages are per-org (see file header).
      const key = stageToKey(stage, currentOrgId)
      // Re-read the LATEST cached progress at mutate time rather than
      // closing over the render-time `progress` const. Without this,
      // a burst of useEffect re-fires (DecisionAccountabilityPage's
      // graduation effect, the sequential-gate listeners) all see an
      // empty `progress` closure from the same render and each one
      // independently writes + logs, producing the 10K-row pileup we
      // saw in pilot_telemetry_events. Pulling from the cache means
      // the second call in the burst sees the just-written timestamp
      // and bails before doing a DB write.
      const latest = queryClient.getQueryData<PilotProgress>(['pilot-progress', user.id]) ?? progress
      if (latest[key]) return

      const nextProgress: PilotProgress = { ...latest, [key]: new Date().toISOString() }
      const { error } = await supabase
        .from('users')
        .update({ pilot_progress: nextProgress })
        .eq('id', user.id)
      if (error) throw error
      // Return the writer's stage so onSuccess can log telemetry exactly
      // once per real first-time unlock. (mutationFn used to call
      // logPilotEvent directly, which fired for every duplicate burst
      // call because the idempotency guard above was bypassed by stale
      // closures — see the dup-burst comment.)
      return { nextProgress, stage }
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
    onError: (error, stage, context) => {
      // Roll back the optimistic flip if the DB write fails.
      if (context?.previous !== undefined && user?.id) {
        queryClient.setQueryData(['pilot-progress', user.id], context.previous)
      }
      // Surface the failure to Sentry — Daniel hit a case where his
      // accepted_trade landed but trade_book_unlocked never marked,
      // and we had no record of *why* (silent rollback). Future
      // failures land in Sentry tagged with the stage + org so we can
      // tell whether it was a network blip, RLS rejection, or a real
      // mutation bug.
      Sentry.withScope((scope) => {
        scope.setTag('pilot_stage', stage)
        scope.setTag('organization_id', currentOrgId ?? 'none')
        scope.setContext('pilot_progress', { stage, currentOrgId, userId: user?.id })
        Sentry.captureException(error)
      })
    },
    onSuccess: (result) => {
      if (result?.nextProgress) {
        queryClient.setQueryData(['pilot-progress', user?.id], result.nextProgress)
      }
      if (result?.stage) {
        // Telemetry is logged here (not in mutationFn) so it only fires
        // when mutationFn actually wrote to the DB — duplicate-burst
        // calls return early from mutationFn with `undefined` and skip
        // this. Also passes `organizationId` so per-org segmentation
        // works (every row was previously NULL on this column).
        logPilotEvent({
          eventType: STAGE_TO_EVENT[result.stage],
          organizationId: currentOrgId,
        })
      }
      // No invalidate here. The setQueryData above already writes the
      // authoritative server response into the cache, so a refetch
      // would just round-trip the same data. The invalidate that used
      // to live here forced a refetch that briefly contradicted the
      // just-applied optimistic flip, and the resulting state churn
      // re-fired the trade_book_unlocked self-heal effect — producing
      // the visible locked⇄unlocked flicker on the Trade Book tab
      // right after execute. The self-heal now lives inside the
      // preview components (PilotTradeBookPreview /
      // PilotOutcomesPreview) so it can't fire after access has
      // already flipped to 'full'.
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
