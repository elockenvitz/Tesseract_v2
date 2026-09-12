import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'
import { usePilotMode } from './usePilotMode'
import { usePilotProgress } from './usePilotProgress'
import { missionState, tutorialOutcomeReviewedKey, type MissionState } from '../lib/pilot/mission'
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
 * Four of the five steps are durable product truth about ONE idea, so they are
 * read against the stored tutorial id and nothing else:
 *
 *   the row        `trade_queue_items` — does it still exist, and at what stage
 *   the simulation `simulation_trades.trade_queue_item_id` — a trade that was
 *                  actually simulated, not merely a lab link, because a link
 *                  proves an idea was pulled in and not that anything was run
 *   the decision   `accepted_trades.trade_queue_item_id`, or a decided outcome
 *                  on the idea itself, which covers defer and reject
 *
 * The fifth is a mark, because reading Outcomes writes nothing.
 *
 * ── RLS posture ───────────────────────────────────────────────────────────
 *
 * No policy is widened and no new table is introduced. All three reads are
 * `head: true` counts on tables the product already reads through the same
 * client, filtered to one id the reader already had to be able to see in order
 * to create. A pilot who cannot see the row gets `ideaExists: false` and the
 * mission recovers to step one, which is the correct behaviour for a genuinely
 * missing idea as well.
 */
export interface PilotMission extends MissionState {
  isLoading: boolean
  /** Record the tutorial idea at creation. Write-once per org. */
  setTutorialIdea: (ideaId: string) => void
  /** The one step that has to be reported rather than derived. */
  markOutcomeReviewed: () => void
}

interface MissionFacts {
  ideaExists: boolean
  ideaStage: string | null
  hasSimulationTrade: boolean
  hasDecision: boolean
}

export function usePilotMission(): PilotMission {
  const queryClient = useQueryClient()
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
      const [ideaRes, simRes, acceptedRes] = await Promise.all([
        supabase.from('trade_queue_items').select('id, stage, outcome').eq('id', id).maybeSingle(),
        supabase.from('simulation_trades').select('id', { count: 'exact', head: true }).eq('trade_queue_item_id', id),
        supabase.from('accepted_trades').select('id', { count: 'exact', head: true }).eq('trade_queue_item_id', id),
      ])
      const idea = ideaRes.data as { stage?: string | null; outcome?: string | null } | null
      /*
       * A decision is a decision whichever way it went. `accepted_trades` only
       * exists for an accepted one, so a deferred or rejected idea would read
       * as undecided if that were the only test — and refusing a trade is
       * exactly as much of a decision as taking it.
       */
      const decided = !!idea?.outcome && ['accepted', 'rejected', 'deferred'].includes(idea.outcome)
      return {
        ideaExists: !!idea,
        ideaStage: idea?.stage ?? null,
        hasSimulationTrade: (simRes.count ?? 0) > 0,
        hasDecision: decided || (acceptedRes.count ?? 0) > 0,
      }
    },
  })

  const state = missionState({
    tutorialIdeaId,
    ideaExists: facts?.ideaExists ?? false,
    ideaStage: facts?.ideaStage ?? null,
    hasSimulationTrade: facts?.hasSimulationTrade ?? false,
    hasDecision: facts?.hasDecision ?? false,
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
       * These are not guesses. The row was created a moment ago by this
       * reader, so it exists; nothing can have simulated or decided a trade on
       * an id that did not exist until now; and a fresh capture has not been
       * advanced, which a null stage says. The query keeps `staleTime: 0`, so
       * the authoritative read still runs immediately and overwrites all four.
       */
      queryClient.setQueryData<MissionFacts>(['pilot-mission', currentOrgId, id], prev => prev ?? {
        ideaExists: true,
        ideaStage: null,
        hasSimulationTrade: false,
        hasDecision: false,
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

  return {
    ...state,
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
