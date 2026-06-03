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

import { useCallback, useEffect, useMemo, useRef } from 'react'
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
  // Idea Pipeline Get Started banner — previously stored in localStorage,
  // which meant completing the steps on one hostname (localhost) didn't
  // carry over to another (Netlify deploy preview, another browser, etc.).
  | 'pipeline_banner_dismissed'
  | 'pipeline_step_moved'
  | 'pipeline_step_inbox'
  | 'pipeline_step_tradelab'
  // Post-graduation Get Started banner — surfaces only AFTER the user
  // has completed the Pipeline → Trade Lab → Trade Book → Outcomes loop
  // (i.e., `graduated_at_<orgId>` is set). Each step ticks off when the
  // user OPENS the corresponding UI; auto-retires when all three are done.
  | 'post_grad_step_app_launcher'
  | 'post_grad_step_feedback'
  | 'post_grad_step_recommend'

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
const pipelineBannerDismissedKey = (orgId: string | null) => `pipeline_banner_dismissed_at_${orgId || 'no-org'}`
const pipelineStepMovedKey       = (orgId: string | null) => `pipeline_step_moved_at_${orgId || 'no-org'}`
const pipelineStepInboxKey       = (orgId: string | null) => `pipeline_step_inbox_at_${orgId || 'no-org'}`
const pipelineStepTradeLabKey    = (orgId: string | null) => `pipeline_step_tradelab_at_${orgId || 'no-org'}`
const postGradAppLauncherKey     = (orgId: string | null) => `post_grad_step_app_launcher_at_${orgId || 'no-org'}`
const postGradFeedbackKey        = (orgId: string | null) => `post_grad_step_feedback_at_${orgId || 'no-org'}`
const postGradRecommendKey       = (orgId: string | null) => `post_grad_step_recommend_at_${orgId || 'no-org'}`

const stageToKey = (stage: PilotStage, orgId: string | null): string => {
  switch (stage) {
    case 'trade_book_unlocked':        return tradeBookUnlockedKey(orgId)
    case 'outcomes_unlocked':          return outcomesUnlockedKey(orgId)
    case 'graduated':                  return graduatedKey(orgId)
    case 'pipeline_banner_dismissed':  return pipelineBannerDismissedKey(orgId)
    case 'pipeline_step_moved':        return pipelineStepMovedKey(orgId)
    case 'pipeline_step_inbox':        return pipelineStepInboxKey(orgId)
    case 'pipeline_step_tradelab':     return pipelineStepTradeLabKey(orgId)
    case 'post_grad_step_app_launcher': return postGradAppLauncherKey(orgId)
    case 'post_grad_step_feedback':     return postGradFeedbackKey(orgId)
    case 'post_grad_step_recommend':    return postGradRecommendKey(orgId)
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
  pipeline_banner_dismissed: 'pilot_pipeline_banner_dismissed',
  // Event names below preserve the pre-server-migration TradeQueuePage telemetry.
  pipeline_step_moved: 'pilot_pipeline_step_idea_dragged',
  pipeline_step_inbox: 'pilot_pipeline_step_inbox_opened',
  pipeline_step_tradelab: 'pilot_pipeline_step_tradelab_opened',
  post_grad_step_app_launcher: 'pilot_post_grad_step_app_launcher',
  post_grad_step_feedback:     'pilot_post_grad_step_feedback',
  post_grad_step_recommend:    'pilot_post_grad_step_recommend',
}

export function usePilotProgress() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  // The auth-user-cache (populated synchronously by useAuth via
  // getCachedUser()) already embeds the full users row, including the
  // pilot_progress JSONB column. Earlier commits on this branch built
  // a parallel `pilot_progress_<userId>` localStorage cache for the
  // same data — a redundant layer that frequently sat empty on the
  // first session under a new build, defeating every readiness gate
  // downstream. Read pilot_progress straight off `user` instead:
  // it's always there as long as the user is authenticated.
  const userPilotProgress = (user as any)?.pilot_progress as PilotProgress | undefined

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

  // Effective progress: merge the auth cache snapshot UNDER the live
  // query result, so the query takes precedence per-key but anything
  // it's missing falls back to the cache. We deliberately spread
  // rather than `query.data ?? userPilotProgress`, because the
  // queryFn returns `{}` on any error/RLS hiccup — and `{}` is
  // truthy, which would shadow the auth-cache value entirely and
  // drop us back into the same flicker. Spreading means even a
  // briefly-empty query response doesn't wipe known unlock flags.
  const progress: PilotProgress = {
    ...(userPilotProgress ?? {}),
    ...(query.data ?? {}),
  }

  // Per-stage write tracker. Once we've kicked off a DB write for a
  // (stage, org) pair in this session, every subsequent mutate() for
  // the same key bails before issuing another network request — this
  // is what dedupes a burst of useEffect re-fires (the original cause
  // of the 10K-row pileup in pilot_telemetry_events). The set is
  // checked synchronously, so even concurrent in-flight calls in the
  // same microtask coordinate correctly.
  //
  // We can't dedupe by reading the cache anymore, because `onMutate`
  // below sets the cache optimistically BEFORE this mutationFn runs.
  // The previous version checked `queryClient.getQueryData(...)` here
  // and so always bailed — onMutate flipped the cache, mutationFn saw
  // the key, returned without writing, and the DB never got the
  // unlock timestamp. That manifested downstream as per-org pilot
  // flags vanishing on the next hard refresh (graduated_at_<orgId>,
  // trade_book_unlocked_at_<orgId>, etc.).
  const writeInFlightRef = useRef<Set<string>>(new Set())

  const markStage = useMutation({
    mutationFn: async (stage: PilotStage) => {
      if (!user?.id) return
      // All three stages are per-org (see file header).
      const key = stageToKey(stage, currentOrgId)
      // Burst dedup — see writeInFlightRef comment above.
      if (writeInFlightRef.current.has(key)) return
      // Closure-captured `progress` is the snapshot at this render,
      // BEFORE onMutate ran. If the key was already set then, this
      // call is a re-fire of an already-completed mark — skip.
      if (progress[key]) return
      writeInFlightRef.current.add(key)

      const nextProgress: PilotProgress = { ...progress, [key]: new Date().toISOString() }
      try {
        const { error } = await supabase
          .from('users')
          .update({ pilot_progress: nextProgress })
          .eq('id', user.id)
        if (error) throw error
      } catch (err) {
        // Allow retry on failure — keeping the ref locked here would
        // leave the user stuck if the first attempt errored.
        writeInFlightRef.current.delete(key)
        throw err
      }
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
    /** True when we have any source of truth for the unlock flags —
     *  either the query has resolved (query.data is defined, even as
     *  {}), or the synchronous snapshot from the auth user cache is
     *  present. The latter is the common case for any authenticated
     *  user: useAuth hydrates `user.pilot_progress` from
     *  localStorage on the very first render, so we have data to
     *  read from before the React Query fetch even starts. */
    hasReadyProgress:
      !!user?.id && (query.data !== undefined || userPilotProgress !== undefined),
    hasUnlockedTradeBook: !!progress[tradeBookUnlockedKey(currentOrgId)],
    hasUnlockedOutcomes: !!progress[outcomesUnlockedKey(currentOrgId)],
    // Idea Pipeline Get Started banner — per-(user, org).
    hasDismissedPipelineBanner: !!progress[pipelineBannerDismissedKey(currentOrgId)],
    hasCompletedPipelineStepMoved:    !!progress[pipelineStepMovedKey(currentOrgId)],
    hasCompletedPipelineStepInbox:    !!progress[pipelineStepInboxKey(currentOrgId)],
    hasCompletedPipelineStepTradeLab: !!progress[pipelineStepTradeLabKey(currentOrgId)],
    // Post-graduation Get Started — per-(user, org).
    hasCompletedPostGradAppLauncher: !!progress[postGradAppLauncherKey(currentOrgId)],
    hasCompletedPostGradFeedback:    !!progress[postGradFeedbackKey(currentOrgId)],
    hasCompletedPostGradRecommend:   !!progress[postGradRecommendKey(currentOrgId)],
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
