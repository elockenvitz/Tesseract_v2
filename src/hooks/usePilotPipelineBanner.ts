import { usePilotMode } from './usePilotMode'
import { usePilotProgress } from './usePilotProgress'
import type { PilotStep } from '../components/pilot/PilotStepsBanner'

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
 * the two shells. This reads the flags; it does not write them.
 *
 * Reading `usePilotProgress` from both shells costs nothing: it is one React
 * Query entry, and only one of the two pages is mounted at a time anyway.
 */
export interface PilotPipelineBanner {
  /** Whether this reader should see it at all. */
  show: boolean
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
  } = usePilotProgress()

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
      },
    ],
  }
}
