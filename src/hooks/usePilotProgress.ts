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
 *   - graduated                — the pilot mission is complete in this
 *                                org, Close the loop included. Written
 *                                only by usePilotMission — reaching
 *                                Outcomes is not enough. Stored per-org
 *                                as `graduated_at_<orgId>`.
 *
 * All three flags are per-org so an analyst testing across multiple
 * pilot clients (or restarting a single client's onboarding) doesn't
 * carry unlock state between orgs. Legacy global keys
 * (`trade_book_unlocked_at`, `outcomes_unlocked_at`, `graduated_at` with
 * no org suffix) are deliberately NOT read — old test state must be
 * cleared via the Reset Progress button on OpsPilotPanel.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { logPilotEvent } from '../lib/pilot/pilot-telemetry'
import { onboardingStageKey } from '../lib/pilot/onboarding'
import {
  tutorialIdeaKey,
  tutorialOutcomeReviewedKey,
  tradeBookBasicsKey,
  pipelineStepMovedKey,
  pipelineStepInboxKey,
  pipelineStepTradeLabKey,
} from '../lib/pilot/mission'

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
  /*
   * The two onboarding steps that leave no artifact of their own.
   *
   * Reading a feed and opening a candidate into the workspace write nothing to
   * the database, so they need a mark — and it is server-backed and per-org for
   * the reason the old "View idea feed" step was not: a localStorage flag does
   * not follow the user to a second browser, and its completion event was
   * fired by a page that has since been deleted, which left the step
   * permanently impossible to earn honestly.
   *
   * The other two onboarding steps are deliberately absent from this union.
   * A perspective and a coverage assignment are rows, and a boolean beside a
   * row can only ever disagree with it. See `lib/pilot/onboarding.ts`.
   */
  | 'ideas_viewed'
  | 'signal_worked'
  /*
   * Pilot MISSION stages 4 and 5: Trade Book basics finished, and Outcomes'
   * "Finish the loop" finished. Their steps are reading and opening things,
   * which write nothing else, so each app's Getting Started writes one of these
   * as it finishes. See `lib/pilot/mission.ts`.
   */
  | 'tradebook_basics_completed'
  | 'tutorial_outcome_reviewed'
  /*
   * The graduation celebration was acknowledged.
   *
   * Server-backed for the same reason `graduated` is. It used to be a
   * `graduation_dismissed` localStorage flag, which meant a pilot who cleared
   * site data got congratulated a second time and a pilot who graduated on one
   * machine got congratulated again on the next. It marks an acknowledgement,
   * never graduation itself — `graduated` remains the only answer to whether
   * the pilot finished.
   */
  | 'graduation_celebrated'

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
const graduationCelebratedKey = (orgId: string | null) => `graduation_celebrated_at_${orgId || 'no-org'}`
const pipelineBannerDismissedKey = (orgId: string | null) => `pipeline_banner_dismissed_at_${orgId || 'no-org'}`
// The three Pipeline basics keys come from `lib/pilot/mission`, which reads them
// to decide mission stage 2 — one spelling for the writer and the reader.
const postGradAppLauncherKey     = (orgId: string | null) => `post_grad_step_app_launcher_at_${orgId || 'no-org'}`
const postGradFeedbackKey        = (orgId: string | null) => `post_grad_step_feedback_at_${orgId || 'no-org'}`
const postGradRecommendKey       = (orgId: string | null) => `post_grad_step_recommend_at_${orgId || 'no-org'}`

const stageToKey = (stage: PilotStage, orgId: string | null): string => {
  switch (stage) {
    case 'trade_book_unlocked':        return tradeBookUnlockedKey(orgId)
    case 'outcomes_unlocked':          return outcomesUnlockedKey(orgId)
    case 'graduated':                  return graduatedKey(orgId)
    case 'graduation_celebrated':      return graduationCelebratedKey(orgId)
    case 'pipeline_banner_dismissed':  return pipelineBannerDismissedKey(orgId)
    case 'pipeline_step_moved':        return pipelineStepMovedKey(orgId)
    case 'pipeline_step_inbox':        return pipelineStepInboxKey(orgId)
    case 'pipeline_step_tradelab':     return pipelineStepTradeLabKey(orgId)
    case 'post_grad_step_app_launcher': return postGradAppLauncherKey(orgId)
    case 'post_grad_step_feedback':     return postGradFeedbackKey(orgId)
    case 'post_grad_step_recommend':    return postGradRecommendKey(orgId)
    // One key builder, shared with the pure onboarding model, so the writer
    // and the reader cannot spell the same step differently.
    case 'ideas_viewed':               return onboardingStageKey('ideas_viewed', orgId)
    case 'signal_worked':              return onboardingStageKey('signal_worked', orgId)
    case 'tradebook_basics_completed': return tradeBookBasicsKey(orgId)
    case 'tutorial_outcome_reviewed':  return tutorialOutcomeReviewedKey(orgId)
  }
}

/** localStorage hint key — read synchronously on mount so a hard refresh
 *  doesn't flash the pilot dashboard for ~200ms before the real
 *  pilot_progress query resolves. Mirrors the `was_pilot_<userId>` cache
 *  in usePilotMode. */
const cachedGraduatedKey = (userId: string, orgId: string | null) =>
  `pilot_graduated_${userId}_${orgId || 'no-org'}`

/*
 * `pilot_progress` is one JSONB column, and every writer here writes the WHOLE
 * column. That is only safe if two writers can never be in flight at once with
 * two different pictures of what the column contains — and until now they
 * could, because each of the five components holding this hook had its own
 * in-flight ref and its own render-time snapshot.
 *
 * The concrete loss: "Open Outcomes" marks `tradebook_basics_completed` and,
 * in the same tick, a dispatched event marks `outcomes_unlocked`, from two
 * different hook instances. Each built the full object from its own snapshot
 * containing only its own new key. Whichever round trip landed second erased
 * the other key — mission stage 4 reverting, or Outcomes re-locking under a
 * reader who was already standing on it. The same shape wiped `graduated_at`
 * when `tutorial_outcome_reviewed` resolved after the graduation write.
 *
 * So both pieces of state below hang off the QueryClient rather than off the
 * hook, which is the lifetime that actually matches: one per app, shared by
 * every component, gone when the app is.
 *
 *   inFlight — dedupe a burst across components, not just within one.
 *   chain    — one write at a time, in order. Each write reads the freshest
 *              progress when it RUNS rather than when it was queued, so a write
 *              queued behind another carries that one's key forward instead of
 *              writing it back out of existence.
 *
 * This closes the races inside a tab. Two tabs, or two devices, still race —
 * that needs a `pilot_progress || jsonb_build_object(...)` merge server-side,
 * which is a schema change and deliberately out of scope here.
 */
interface ProgressWriteState {
  inFlight: Set<string>
  chain: Promise<unknown>
}
const progressWrites = new WeakMap<QueryClient, ProgressWriteState>()

function writeStateFor(client: QueryClient): ProgressWriteState {
  let state = progressWrites.get(client)
  if (!state) {
    state = { inFlight: new Set(), chain: Promise.resolve() }
    progressWrites.set(client, state)
  }
  return state
}

function enqueueProgressWrite<T>(client: QueryClient, run: () => Promise<T>): Promise<T> {
  const state = writeStateFor(client)
  // Chain on settle, not on success — one failed write must not stall the rest.
  const next = state.chain.then(run, run)
  state.chain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

const STAGE_TO_EVENT: Record<PilotStage, string> = {
  trade_book_unlocked: 'pilot_trade_book_unlocked',
  outcomes_unlocked: 'pilot_outcomes_unlocked',
  graduated: 'pilot_graduated',
  graduation_celebrated: 'pilot_graduation_celebrated',
  pipeline_banner_dismissed: 'pilot_pipeline_banner_dismissed',
  // Event names below preserve the pre-server-migration TradeQueuePage telemetry.
  pipeline_step_moved: 'pilot_pipeline_step_idea_dragged',
  pipeline_step_inbox: 'pilot_pipeline_step_inbox_opened',
  pipeline_step_tradelab: 'pilot_pipeline_step_tradelab_opened',
  post_grad_step_app_launcher: 'pilot_post_grad_step_app_launcher',
  post_grad_step_feedback:     'pilot_post_grad_step_feedback',
  post_grad_step_recommend:    'pilot_post_grad_step_recommend',
  ideas_viewed:                'pilot_onboarding_ideas_viewed',
  signal_worked:               'pilot_onboarding_signal_worked',
  tradebook_basics_completed:  'pilot_mission_tradebook_basics_completed',
  tutorial_outcome_reviewed:   'pilot_mission_outcome_reviewed',
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

  /*
   * `readLatestProgress` used to live here: the freshest LOCAL picture of the
   * column, assembled from the cache over the auth snapshot, used as the base
   * for a whole-column write.
   *
   * Deleted rather than left unused. "Freshest local" is still only as fresh
   * as this session, which is the whole defect — a backgrounded tab's picture
   * is unbounded in age — and a helper that hands a writer a base document is
   * an invitation to write the whole column again. There is no base any more:
   * `mark_pilot_progress` merges one key server-side.
   */

  /**
   * Record ONE key, server-side, atomically.
   *
   * This used to write the whole column from `nextProgress` — the caller's
   * picture of it — and that is what lost production data. Serialising the
   * writes inside a tab was never enough, because the picture is per-session:
   * `pilot-progress` has `staleTime: 60_000` and the app sets
   * `refetchOnWindowFocus: false`, so a backgrounded tab holds its snapshot
   * indefinitely and its next mark writes that snapshot back over everything
   * recorded anywhere else since. Quick Quest lost six marks that way on
   * 2026-10-05, to a write an hour stale.
   *
   * `mark_pilot_progress` merges one key in one statement, so there is no
   * window and no snapshot involved. It is set-once, so a duplicate
   * concurrent mark keeps the first value rather than replacing it.
   *
   * The cache is REPLACED with what the function returned, not merged into:
   * the returned document is the authoritative row, and merging the local
   * picture on top of it would put back the very keys this is meant to stop
   * resurrecting.
   */
  const userId = user?.id
  const commitProgressKey = useCallback(
    async (key: string, value: string): Promise<PilotProgress | null> => {
      if (!userId) return null
      /*
       * Cast because `Database` is generated from the live schema and this
       * function does not exist there until the migration is applied — until
       * then `rpc()` types its own argument as `undefined`. Narrow and local:
       * the key and value are both `string` above, and the return is read back
       * as `PilotProgress` below. Drop the cast once types are regenerated.
       */
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string, args: { p_key: string; p_value: string },
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'mark_pilot_progress', { p_key: key, p_value: value },
      )
      if (error) throw error
      const merged = (data ?? null) as PilotProgress | null
      if (merged) {
        queryClient.setQueryData<PilotProgress>(['pilot-progress', userId], merged)
      }
      return merged
    },
    [userId, queryClient],
  )

  const markStage = useMutation({
    mutationFn: async (stage: PilotStage) => {
      if (!user?.id) return
      // All three stages are per-org (see file header).
      const key = stageToKey(stage, currentOrgId)
      // Burst dedup, now across components — see the module comment above.
      // Once we've kicked off a DB write for a (user, stage, org) triple in
      // this session, every subsequent mutate() for it bails before issuing
      // another request. This is what stops a burst of useEffect re-fires (the
      // original cause of the 10K-row pileup in pilot_telemetry_events).
      const guard = `${user.id}:${key}`
      const { inFlight } = writeStateFor(queryClient)
      if (inFlight.has(guard)) return
      // Closure-captured `progress` is the snapshot at this render,
      // BEFORE onMutate ran. If the key was already set then, this
      // call is a re-fire of an already-completed mark — skip. We can't
      // ask the cache instead: onMutate has already flipped the key there.
      if (progress[key]) return
      inFlight.add(guard)

      return enqueueProgressWrite(queryClient, async () => {
        /*
         * One key, merged server-side. No base, no snapshot.
         *
         * This used to build the whole column from `readLatestProgress()` and
         * write it back, which is what erased marks made in other sessions.
         * The queue is kept — it still stops a burst of sibling writes racing
         * each other's telemetry and cache updates — but correctness no
         * longer depends on it, because the merge is atomic in one statement.
         *
         * The timestamp proposed here is only a proposal: if the key already
         * exists the function keeps the value it has, so the first mark's
         * timestamp is the one that stands.
         */
        try {
          await commitProgressKey(key, new Date().toISOString())
        } catch (err) {
          // Allow retry on failure — keeping the guard locked here would
          // leave the user stuck if the first attempt errored.
          inFlight.delete(guard)
          throw err
        }
        // Return the writer's stage so onSuccess can log telemetry exactly
        // once per real first-time unlock. (mutationFn used to call
        // logPilotEvent directly, which fired for every duplicate burst
        // call because the idempotency guard above was bypassed by stale
        // closures — see the dup-burst comment.)
        return { stage }
      })
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
      queryClient.setQueryData<PilotProgress>(['pilot-progress', user.id], (old) => ({
        ...(old ?? progress),
        [key]: new Date().toISOString(),
      }))
      // Hand the key, not a snapshot of the whole object, to onError: rolling
      // back by restoring a `previous` blob would undo any sibling key written
      // between the flip and the failure.
      return { rollbackKey: key }
    },
    onError: (error, stage, context) => {
      // Roll back the optimistic flip if the DB write fails — this key only.
      if (context?.rollbackKey && user?.id) {
        queryClient.setQueryData<PilotProgress>(['pilot-progress', user.id], (old) => {
          if (!old) return old
          const rest = { ...old }
          delete rest[context.rollbackKey]
          return rest
        })
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
      // The cache is set inside `commitProgressKey`, to the document the
      // function RETURNED — the authoritative row, not a local reconstruction
      // of it. Replacing the whole object here was the second half of the
      // clobber: a writer whose picture predated a sibling's key wrote that
      // picture back over the cache even when the row itself was fine.
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

  /**
   * Stable callback — safe to pass into useEffect deps, and now actually true.
   *
   * It used to close over `markStage`, which useMutation recreates every
   * render, so every effect listing `mark` in its deps re-ran on every render —
   * four self-heal effects across usePilotMode, PilotOutcomesPreview,
   * PilotTradeBookPreview and PilotOutcomesGetStarted. They are all ref-bounded
   * so nothing fired twice, but they were re-evaluating continuously. Reading
   * `mutate` through a ref keeps the identity fixed for the life of the hook.
   */
  const mutateRef = useRef(markStage.mutate)
  mutateRef.current = markStage.mutate
  const mark = useCallback((stage: PilotStage) => {
    mutateRef.current(stage)
  }, [])

  /**
   * The one pilot key that stores a VALUE rather than a timestamp.
   *
   * `mark` writes `new Date().toISOString()` and dedupes on "already set",
   * which is exactly right for a stage and exactly wrong for an id: the
   * tutorial idea is an identity, and reusing the timestamp writer would store
   * a date where a `trade_queue_items.id` belongs.
   *
   * Write-once per org, deliberately. The mission is one idea carried the
   * whole way, so a second idea created later must not quietly become the
   * tutorial and reset four steps of progress. If the row is gone the mission
   * recovers by returning to step one — see `missionState` — rather than by
   * silently adopting a replacement.
   */
  const setTutorialIdea = useCallback(async (ideaId: string) => {
    if (!user?.id || !ideaId) return
    const key = tutorialIdeaKey(currentOrgId)
    if (progress[key]) return
    const guard = `${user.id}:${key}`
    const { inFlight } = writeStateFor(queryClient)
    if (inFlight.has(guard)) return
    inFlight.add(guard)

    /*
     * Optimistic, for exactly the reason `markStage` above is.
     *
     * The mission module reads this id to decide whether step one is done and
     * which idea the remaining four are about. Writing the cache only AFTER
     * the round trip meant a pilot who had just captured their first idea
     * watched the module still say nothing had happened, for as long as the
     * update took. The commit below is authoritative and the catch rolls back
     * this key, so nothing is claimed that does not end up true.
     */
    queryClient.setQueryData<PilotProgress>(['pilot-progress', user.id], (old) => ({
      ...(old ?? progress),
      [key]: ideaId,
    }))

    try {
      /*
       * Same atomic merge as the stage marks, through the same queue.
       *
       * This wrote the whole column too, so it could erase a sibling mark —
       * and being the mission ANCHOR, losing it resets four steps at once.
       * `mark_pilot_progress` is set-once, which is exactly the write-once
       * semantics this needed and was enforcing client-side with
       * `if (progress[key]) return` over a snapshot that could be stale.
       *
       * Anchor BEHAVIOUR is unchanged on purpose: a second idea still does
       * not become the tutorial, and a missing row still sends the mission
       * back to step one. Only the durability of the write changes here.
       */
      await enqueueProgressWrite(queryClient, async () => {
        await commitProgressKey(key, ideaId)
      })
      logPilotEvent({ eventType: 'pilot_mission_idea_created', organizationId: currentOrgId })
    } catch (err) {
      inFlight.delete(guard)
      queryClient.setQueryData<PilotProgress>(['pilot-progress', user.id], (old) => {
        if (!old) return old
        const rest = { ...old }
        delete rest[key]
        return rest
      })
      Sentry.captureException(err)
    }
  }, [user?.id, currentOrgId, progress, queryClient, commitProgressKey])

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
    setTutorialIdea,
    /** The tutorial idea for this org, if one has been chosen. */
    tutorialIdeaId: (progress[tutorialIdeaKey(currentOrgId)] as string | undefined) ?? null,
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
    /** Per-org: true only once the pilot mission is complete in the
     *  CURRENT org. Each new pilot client starts as not-yet-graduated
     *  even for an analyst who's graduated in prior clients. */
    hasGraduated,
    /** The graduation celebration has been acknowledged in this org. Durable,
     *  so it does not re-pop on a second device or after clearing site data. */
    hasCelebratedGraduation: !!progress[graduationCelebratedKey(currentOrgId)],
    /** Best-effort `hasGraduated` that falls back to a cached hint from
     *  the previous session while the real query is loading. Use this
     *  for UI gates that need to stay stable across a cold refresh. */
    cachedHasGraduated,
    mark,
  }
}
