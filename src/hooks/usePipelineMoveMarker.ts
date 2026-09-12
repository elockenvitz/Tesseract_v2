import { useCallback } from 'react'
import { usePilotMode } from './usePilotMode'
import { usePilotProgress } from './usePilotProgress'

/**
 * "You moved an idea through the pipeline" — recorded once, wherever it happened.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * The first Pipeline step was marked inline in `TradeQueuePage.handleDrop`,
 * which is the desktop board's drag handler. A phone renders `MobilePipeline`
 * and changes stage through a sheet, not a drag, so a pilot who advanced the
 * tutorial idea on mobile did the lesson and never got credit for it: the
 * banner's step 1 stayed open forever and the banner never retired.
 *
 * Both shells already commit the move through the same mutations in
 * `useTradeIdeaService`, so that — not either board — is where the step is
 * earned. Putting the marker there is what makes the two shells agree by
 * construction rather than by remembering to copy a line.
 *
 * ── Why it is a hook and not a line inside the service ───────────────────
 *
 * So the trade data layer imports one purpose-named thing instead of the pilot
 * onboarding stack. Everything about WHO counts and WHEN it is already done
 * stays on this side of that import.
 *
 * ── Timing ───────────────────────────────────────────────────────────────
 *
 * The desktop version fired the moment the drop handler ran, before the write
 * was known to have succeeded — so a move that the server rejected still
 * completed the step. Callers invoke this from `onSuccess`, so the step now
 * records a transition that actually happened.
 *
 * Direction is deliberately not judged. A drag backwards down the board
 * completed the step before this change, and still does; the lesson is that
 * stages move, not which way.
 *
 * RLS posture: unchanged. The write goes through `usePilotProgress.mark`,
 * which updates the caller's own `users.pilot_progress` row under the existing
 * self-update policy. No new table or query path.
 */
export function usePipelineMoveMarker(): () => void {
  const { effectiveIsPilot } = usePilotMode()
  const { hasCompletedPipelineStepMoved, mark } = usePilotProgress()

  return useCallback(() => {
    if (!effectiveIsPilot) return
    // Already earned: `mark` is idempotent, but a move is a common action and
    // there is no reason to spend a write on every one of them.
    if (hasCompletedPipelineStepMoved) return
    mark('pipeline_step_moved')
  }, [effectiveIsPilot, hasCompletedPipelineStepMoved, mark])
}
