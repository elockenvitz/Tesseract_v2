import { useCallback, useMemo } from 'react'
import { usePilotMode } from './usePilotMode'
import { usePilotProgress } from './usePilotProgress'
import { useDecisionRequestsForIdea } from './useDecisionRequests'
import type { PilotStep } from '../components/pilot/PilotStepsBanner'
import { PIPELINE_BASICS_CTA_SOURCE, requestOpenTradeLab } from '../lib/trade-lab/open-trade-lab'

/** Decision request statuses that are still waiting — the card Decision Inbox shows. */
const WAITING = new Set(['pending', 'under_review', 'needs_discussion'])

/**
 * The Idea Pipeline Get Started banner, for whichever shell is rendering it.
 *
 * ── Why this is a hook and not three lines in each page ──────────────────
 *
 * Desktop renders `TradeQueuePage` and a phone renders `MobilePipeline`, which
 * is why the banner was missing on mobile entirely: it lived inline in the
 * desktop page, so the phone's pipeline had never seen it. Copying the steps
 * across would have made two definitions of one lesson, and the first copy
 * edit would have made them disagree.
 *
 * So the steps, their completion and the visibility rule are here, and each
 * shell decides only where to put the result.
 *
 * ── What stays with the pages ────────────────────────────────────────────
 *
 * The step MARKERS do. Completing a step is something a surface does — a drag
 * on the board, opening the inbox drawer — and those actions differ between
 * the two shells. This reads the flags and writes one: step 3's own CTA, which
 * is itself the action, marks when — and only when — the Trade Lab navigation
 * it asked for actually happened.
 *
 * Reading `usePilotProgress` from both shells costs nothing: it is one React
 * Query entry, and only one of the two pages is mounted at a time anyway.
 */
export interface PilotPipelineBanner {
  /** Whether this reader should see it at all. */
  show: boolean
  /**
   * What it calls itself.
   *
   * "Get started" is what the five-step pilot MISSION on the home screen calls
   * itself, and this is not that: three gestures local to this board. They do
   * feed one mission step — stage 2, "Develop the thesis", is complete when all
   * three are (see `missionState`) — but this is the lesson, not the mission.
   * Two modules with one name, one tap apart, is a reader being asked to guess
   * which of them they are looking at.
   */
  label: string
  /** The three steps, with live completion. */
  steps: PilotStep[]
}

export function usePilotPipelineBanner(): PilotPipelineBanner {
  const pilotMode = usePilotMode()
  const {
    hasDismissedPipelineBanner,
    hasCompletedPipelineStepMoved,
    hasCompletedPipelineStepInbox,
    hasCompletedPipelineStepTradeLab,
    tutorialIdeaId,
    mark,
  } = usePilotProgress()

  /*
   * Step 3's direct route to Trade Lab, once the reader is on step 3.
   *
   * The same hand-off as the Trade Lab link on the tutorial idea's card in
   * Decision Inbox: the `openTradeLab` event, with that card's portfolio — the
   * decision request's `portfolio_id`, preferring the one still waiting — and
   * the tutorial idea id alongside. Only fetched once it can be shown.
   */
  const onStep3 = pilotMode.effectiveIsPilot
    && hasCompletedPipelineStepMoved
    && hasCompletedPipelineStepInbox
    && !hasCompletedPipelineStepTradeLab
    && !!tutorialIdeaId
  const { data: requests } = useDecisionRequestsForIdea(onStep3 ? tutorialIdeaId ?? undefined : undefined)
  const portfolioId = useMemo(() => {
    const list = requests ?? []
    return (list.find(r => WAITING.has(r.status)) ?? list[0])?.portfolio_id
  }, [requests])

  const openTradeLab = useCallback(() => {
    if (!tutorialIdeaId) return
    const navigated = requestOpenTradeLab({
      portfolioId,
      tradeQueueItemId: tutorialIdeaId,
      source: PIPELINE_BASICS_CTA_SOURCE,
    })
    if (navigated) mark('pipeline_step_tradelab')
  }, [portfolioId, tutorialIdeaId, mark])

  /*
   * Derived synchronously from the flags rather than settled in an effect, so
   * the first render after `pilot_progress` hydrates already excludes a
   * finished banner instead of flashing it for a frame.
   */
  const allStepsDone =
    hasCompletedPipelineStepMoved
    && hasCompletedPipelineStepInbox
    && hasCompletedPipelineStepTradeLab

  return {
    show: pilotMode.effectiveIsPilot && !hasDismissedPipelineBanner && !allStepsDone,
    label: 'Pipeline basics',
    steps: [
      {
        n: 1,
        // Named by what it accomplishes, not by how a mouse does it: a phone
        // completes this step from a stage sheet, with nothing to drag.
        title: 'Move an idea to the next stage',
        hint: 'Move ideas forward through the stages as they mature.',
        done: hasCompletedPipelineStepMoved,
      },
      {
        n: 2,
        title: 'Open the Decision Inbox',
        /* "Click it" named a mouse on a step both shells now have. The drawer
           is the same component in both, so the hint says where it is and
           stops there. */
        hint: 'The bottom drawer is where recommendations wait for your decision.',
        done: hasCompletedPipelineStepInbox,
      },
      {
        n: 3,
        title: 'Open Trade Lab',
        hint: 'Click the portfolio name on the recommendation card to jump into Trade Lab.',
        done: hasCompletedPipelineStepTradeLab,
        // Offered once the card's portfolio is known, so the hand-off carries the
        // same context the Decision Inbox link does rather than a bare Trade Lab.
        ...(onStep3 && portfolioId ? { action: { label: 'Open Trade Lab', onClick: openTradeLab } } : {}),
      },
    ],
  }
}
