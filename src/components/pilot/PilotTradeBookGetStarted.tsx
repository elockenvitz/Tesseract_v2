/**
 * PilotTradeBookGetStarted — the "Trade Book basics" step banner, shown at
 * the top of the Trade Book once a pilot has a committed trade visible.
 *
 * Trade Book is where stage 5 of the pilot starts and Outcomes is where it
 * finishes; these three local steps walk the pilot between them:
 *   1. Review the trade — open a trade in the batch
 *   2. Add your rationale — "Why this decision?" or a trade-specific note
 *   3. Open Outcomes — unlocks Outcomes (`outcomes_unlocked_at_<orgId>`).
 *      It does NOT graduate the pilot: `graduated_at_<orgId>` is written
 *      only by usePilotMission once all five mission steps are done,
 *      Close the loop included.
 *
 * Copy lives in `lib/pilot/trade-book-steps` and progress in
 * `usePilotTradeBookSteps`, shared with the phone's next-steps card so the two
 * can never disagree. Completion events and storage are unchanged:
 *   - 'pilot-tradebook:trade-reviewed'  (Step 1)
 *   - 'pilot-tradebook:rationale-added' (Step 2)
 *   - 'pilot-tradebook:opened-outcomes' (Step 3)
 *
 * State is keyed per user+org so each new pilot client starts fresh.
 */

import { PilotStepsBanner } from './PilotStepsBanner'
import { usePilotTradeBookSteps } from '../../hooks/usePilotTradeBookSteps'
import { TRADE_BOOK_STEPS } from '../../lib/pilot/trade-book-steps'

interface PilotTradeBookGetStartedProps {
  userId: string | undefined
  orgId?: string | null
  onOpenOutcomes: () => void
}

export function PilotTradeBookGetStarted({ userId, orgId, onOpenOutcomes }: PilotTradeBookGetStartedProps) {
  const { done, dismissed, openOutcomes } = usePilotTradeBookSteps(userId, orgId)

  if (dismissed) return null

  /* The banner still has no dismiss control, because each step gates the path
     into the next surface, and it still auto-retires once all three are done. */
  return (
    <PilotStepsBanner
      /* Local product teaching for this surface, like Pipeline basics and
         Trade Lab basics — not the global five-step pilot mission, which is
         what "Get started" names. Unlabelled it read as a second one. */
      label="Trade Book basics"
      steps={TRADE_BOOK_STEPS.map(step => ({
        n: step.n,
        title: step.title,
        hint: step.hint,
        done: done[step.key],
        ...(step.key === 'outcomes' ? { onClick: () => openOutcomes(onOpenOutcomes) } : {}),
      }))}
    />
  )
}
