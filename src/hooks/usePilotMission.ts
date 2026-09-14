import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { usePilotMode } from './usePilotMode'
import { usePilotProgress } from './usePilotProgress'
import {
  missionState,
  pipelineBasicsFromProgress,
  tradeBookBasicsKey,
  tutorialOutcomeReviewedKey,
  type MissionState,
} from '../lib/pilot/mission'
import { logPilotEvent } from '../lib/pilot/pilot-telemetry'

/**
 * The pilot mission, read once and shared.
 *
 * ── Why one hook ──────────────────────────────────────────────────────────
 *
 * Desktop and mobile show the same five steps at different sizes, and the
 * previous generation of this had them each deciding completion for
 * themselves — which is how a checklist ends up disagreeing with the rule that
 * retires it. There is one reading of the facts and one model over them; the
 * surfaces differ only in how much of it they draw.
 *
 * ── What is read ──────────────────────────────────────────────────────────
 *
 * One stage per app, each done when that app's Getting Started is finished
 * (see `missionState`):
 *
 *   1 the idea      `trade_queue_items` — does the tutorial idea still exist
 *   2 Pipeline      the three Pipeline basics marks in `pilot_progress`
 *   3 Trade Lab     an `accepted_trades` row the pilot committed in this org —
 *                   executing is Trade Lab basics' last step
 *   4 Trade Book    `tradebook_basics_completed_at_<org>`, written as Trade
 *                   Book basics finishes
 *   5 Outcomes      `tutorial_outcome_reviewed_at_<org>`, written as Outcomes'
 *                   "Finish the loop" finishes
 *
 * ── RLS posture ───────────────────────────────────────────────────────────
 *
 * No policy is widened and no new table is introduced. The reads are on tables
 * the product already reads through the same client: the idea by the id the
 * reader created, and the reader's own accepted trades in the current org. A
 * pilot who cannot see the idea gets `ideaExists: false` and the mission
 * recovers to step one.
 */
export interface PilotMission extends MissionState {
  isLoading: boolean
  /**
   * The ideas whose decisions count for Close the loop: the tutorial idea when
   * it was decided, and every idea the pilot executed a trade on in this org.
   * Outcomes marks step 5 once it has loaded any of them.
   */
  decisionIdeaIds: string[]
  /** The decision Close the loop sends the reader to review. */
  reviewIdeaId: string | null
  /** Record the tutorial idea at creation. Write-once per org. */
  setTutorialIdea: (ideaId: string) => void
  /** Stage 5: Outcomes' "Finish the loop" finished. */
  markOutcomeReviewed: () => void
}

interface MissionFacts {
  ideaExists: boolean
  ideaStage: string | null
  /** Stage 3: the pilot executed a trade in this org. */
  hasExecutedTrade: boolean
  /** Whether the tutorial idea itself was decided. */
  tutorialDecided?: boolean
  /** Ideas the pilot executed a trade on in this org, newest first. */
  executedIdeaIds?: string[]
}

export function usePilotMission(): PilotMission {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const { effectiveIsPilot } = usePilotMode()
  const { progress, tutorialIdeaId, setTutorialIdea, mark, hasGraduated, isLoading: progressLoading } = usePilotProgress()

  const { data: facts, isLoading: factsLoading } = useQuery({
    queryKey: ['pilot-mission', currentOrgId, tutorialIdeaId],
    // Nothing to ask about until an idea has been chosen, and nothing to ask
    // at all for a reader who is not a pilot.
    enabled: !!tutorialIdeaId && effectiveIsPilot,
    staleTime: 0,
    queryFn: async (): Promise<MissionFacts> => {
      const id = tutorialIdeaId!
      const [ideaRes, acceptedRes, executedRes] = await Promise.all([
        supabase.from('trade_queue_items').select('id, stage, outcome').eq('id', id).maybeSingle(),
        supabase.from('accepted_trades').select('id', { count: 'exact', head: true }).eq('trade_queue_item_id', id),
        /*
         * Any trade this pilot executed in this org — Trade Lab basics' last
         * step, and so stage 3.
         *
         * Pilots may add any idea to Trade Lab — a recommendation, a seeded
         * idea, their own — size it and execute it. Scoped to the org through
         * the portfolio, as every accepted-trade read is.
         */
        user?.id && currentOrgId
          ? supabase
              .from('accepted_trades')
              .select('trade_queue_item_id, portfolios!inner(organization_id)')
              .eq('portfolios.organization_id', currentOrgId)
              .eq('accepted_by', user.id)
              .order('created_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] as Array<{ trade_queue_item_id: string | null }> }),
      ])
      const idea = ideaRes.data as { stage?: string | null; outcome?: string | null } | null
      /*
       * A decision is a decision whichever way it went. `accepted_trades` only
       * exists for an accepted one, so a deferred or rejected idea would read
       * as undecided if that were the only test — and refusing a trade is
       * exactly as much of a decision as taking it.
       */
      const decided = !!idea?.outcome && ['accepted', 'rejected', 'deferred'].includes(idea.outcome)
      const tutorialAccepted = (acceptedRes.count ?? 0) > 0
      const executedIdeaIds = Array.from(new Set(
        ((executedRes.data ?? []) as Array<{ trade_queue_item_id: string | null }>)
          .map(r => r.trade_queue_item_id)
          .filter((v): v is string => !!v),
      ))
      return {
        ideaExists: !!idea,
        ideaStage: idea?.stage ?? null,
        hasExecutedTrade: tutorialAccepted || executedIdeaIds.length > 0,
        tutorialDecided: decided || tutorialAccepted,
        executedIdeaIds,
      }
    },
  })

  const state = missionState({
    tutorialIdeaId,
    ideaExists: facts?.ideaExists ?? false,
    ideaStage: facts?.ideaStage ?? null,
    hasExecutedTrade: facts?.hasExecutedTrade ?? false,
    // Server-backed marks, so each stage survives a refresh and a second device.
    pipelineBasics: pipelineBasicsFromProgress(progress, currentOrgId),
    tradeBookBasicsAt: (progress[tradeBookBasicsKey(currentOrgId)] as string | undefined) ?? null,
    outcomeReviewedAt: (progress[tutorialOutcomeReviewedKey(currentOrgId)] as string | undefined) ?? null,
  })

  /*
   * The bridge from the mission to the gate that already exists.
   *
   * `graduated` is what `usePilotMode` reads to widen pilot access, and it is
   * deliberately still the only definition — the mission does not become a
   * second one. It simply became the thing that decides when to set it: five
   * real steps on one idea, rather than "arrived at Outcomes having clicked a
   * banner", which is what the old chain could be satisfied by.
   *
   * One direction only. Nothing here reads `graduated` back into the mission,
   * so an already-graduated pilot is not sent round the tutorial again — their
   * access stays wide and the module simply shows what it shows.
   */
  useEffect(() => {
    if (!effectiveIsPilot || progressLoading) return
    if (!state.complete || hasGraduated) return
    mark('graduated')
  }, [effectiveIsPilot, progressLoading, state.complete, hasGraduated, mark])

  const markOutcomeReviewed = useCallback(() => {
    if (!effectiveIsPilot) return
    mark('tutorial_outcome_reviewed')
  }, [effectiveIsPilot, mark])

  /*
   * Adopt the idea the capture flow just created.
   *
   * The capture form announces every new trade idea and this decides whether
   * it matters — so the capture surface stays free of pilot logic, and the
   * write is idempotent and write-once per org, which is what stops a second
   * idea silently replacing the tutorial and resetting four steps.
   */
  useEffect(() => {
    const onCreated = (e: Event) => {
      const id = (e as CustomEvent<{ tradeIdeaId?: string }>).detail?.tradeIdeaId
      if (!id || !effectiveIsPilot) return
      /*
       * Seed the facts for the idea that was just created, so adopting it does
       * not blank the module.
       *
       * Adoption changes the query key, and a new key has no data — so
       * `isLoading` went true and the whole Getting Started module unmounted
       * until three reads came back. A pilot who had just captured their first
       * idea watched the thing tracking their progress disappear and return.
       * That was the hitch.
       *
       * The row was created a moment ago by this reader, so it exists, and a
       * fresh capture has not been advanced, which a null stage says. Executed
       * trades are seeded as none; the query keeps `staleTime: 0`, so the
       * authoritative read runs immediately and overwrites all of it.
       */
      queryClient.setQueryData<MissionFacts>(['pilot-mission', currentOrgId, id], prev => prev ?? {
        ideaExists: true,
        ideaStage: null,
        hasExecutedTrade: false,
      })
      void setTutorialIdea(id)
    }
    window.addEventListener('pilot-mission:trade-idea-created', onCreated)
    return () => window.removeEventListener('pilot-mission:trade-idea-created', onCreated)
  }, [effectiveIsPilot, setTutorialIdea, queryClient, currentOrgId])

  const recordIdea = useCallback((ideaId: string) => {
    if (!effectiveIsPilot) return
    void setTutorialIdea(ideaId)
  }, [effectiveIsPilot, setTutorialIdea])

  // The tutorial idea first when it was decided, then what the pilot executed.
  const decisionIdeaIds = Array.from(new Set([
    ...(facts?.tutorialDecided && tutorialIdeaId ? [tutorialIdeaId] : []),
    ...(facts?.executedIdeaIds ?? []),
  ]))

  return {
    ...state,
    decisionIdeaIds,
    reviewIdeaId: decisionIdeaIds[0] ?? state.tutorialIdeaId,
    // An id with no facts yet is still loading, not a mission with nothing in
    // it — otherwise a refresh shows 0 of 5 for a beat to somebody on step 4.
    isLoading: progressLoading || (!!tutorialIdeaId && factsLoading),
    setTutorialIdea: recordIdea,
    markOutcomeReviewed,
  }
}

/**
 * Completion telemetry, fired on the first transition only.
 *
 * Separate from the hook so a component that merely READS the mission does not
 * log anything. The step ids double as the event suffix, so a sixth step would
 * arrive with an event rather than needing one remembered.
 */
export function logMissionStep(step: string, organizationId: string | null) {
  logPilotEvent({ eventType: `pilot_mission_${step}`, organizationId })
}
