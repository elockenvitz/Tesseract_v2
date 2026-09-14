/**
 * PilotTradeBookGetStarted — multi-step Get Started banner shown at the
 * top of the Trade Book once a pilot user has at least one committed
 * trade visible. Same horizontal step-pill style as the Trade Lab and
 * Idea Pipeline Get Started banners — amber gradient strip, three
 * numbered pills with title+hint, arrows between, X to dismiss.
 *
 * Steps:
 *   1. Review the recorded decision — click a trade row to expand it
 *   2. Capture rationale — write a why-now note on that trade
 *   3. Open Outcomes — unlocks Outcomes (`outcomes_unlocked_at_<orgId>`).
 *      It does NOT graduate the pilot: `graduated_at_<orgId>` is written
 *      only by usePilotMission once all five mission steps are done,
 *      Close the loop included.
 *
 * Window events listened for:
 *   - 'pilot-tradebook:trade-reviewed'  (Step 1)
 *   - 'pilot-tradebook:rationale-added' (Step 2)
 *   - 'pilot-tradebook:opened-outcomes' (Step 3)
 *
 * State is keyed per user+org so each new pilot client starts fresh.
 */

import { useCallback, useEffect, useState } from 'react'
import { PilotStepsBanner } from './PilotStepsBanner'
import { logPilotEvent, type PilotEventType } from '../../lib/pilot/pilot-telemetry'

interface PilotTradeBookGetStartedProps {
  userId: string | undefined
  orgId?: string | null
  onOpenOutcomes: () => void
}

const DISMISS = 'dismissed'
const STEP1 = 'reviewed'
const STEP2 = 'rationale'
const STEP3 = 'outcomes'

const STEP_TO_EVENT: Record<string, PilotEventType> = {
  [STEP1]: 'pilot_tradebook_step_trade_reviewed',
  [STEP2]: 'pilot_tradebook_step_rationale_added',
  [STEP3]: 'pilot_tradebook_step_opened_outcomes',
}

function flagKey(userId: string, orgId: string | null | undefined, suffix: string) {
  return `pilot_tradebook_intro_${suffix}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { return localStorage.getItem(flagKey(userId, orgId, suffix)) === '1' } catch { return false }
}
function writeFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.setItem(flagKey(userId, orgId, suffix), '1') } catch { /* ignore */ }
}

export function PilotTradeBookGetStarted({ userId, orgId, onOpenOutcomes }: PilotTradeBookGetStartedProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => userId ? readFlag(userId, orgId, DISMISS) : false)
  const [step1, setStep1] = useState<boolean>(() => userId ? readFlag(userId, orgId, STEP1) : false)
  const [step2, setStep2] = useState<boolean>(() => userId ? readFlag(userId, orgId, STEP2) : false)
  const [step3, setStep3] = useState<boolean>(() => userId ? readFlag(userId, orgId, STEP3) : false)

  useEffect(() => {
    if (!userId) return
    setDismissed(readFlag(userId, orgId, DISMISS))
    setStep1(readFlag(userId, orgId, STEP1))
    setStep2(readFlag(userId, orgId, STEP2))
    setStep3(readFlag(userId, orgId, STEP3))
  }, [userId, orgId])

  // First-time-only — see PilotTradeLabIntroBanner.markStep for the
  // same idempotency pattern. Without the readFlag gate, every Trade
  // Book button click that fires the matching window event would log
  // a duplicate step-completion row in pilot_telemetry_events.
  const markStep = useCallback((suffix: string, setter: (v: boolean) => void) => {
    if (!userId) return
    if (readFlag(userId, orgId, suffix)) return
    writeFlag(userId, orgId, suffix)
    setter(true)
    const eventType = STEP_TO_EVENT[suffix]
    if (eventType) logPilotEvent({ eventType, organizationId: orgId ?? null })
  }, [userId, orgId])

  useEffect(() => {
    // See PilotTradeLabIntroBanner for why we queueMicrotask the
    // listener bodies — keeps render-time event dispatchers from
    // triggering setState in this banner during another component's
    // render.
    const defer = (fn: () => void) => () => queueMicrotask(fn)
    const onStep1 = defer(() => markStep(STEP1, setStep1))
    const onStep2 = defer(() => markStep(STEP2, setStep2))
    const onStep3 = defer(() => markStep(STEP3, setStep3))
    window.addEventListener('pilot-tradebook:trade-reviewed', onStep1)
    window.addEventListener('pilot-tradebook:rationale-added', onStep2)
    window.addEventListener('pilot-tradebook:opened-outcomes', onStep3)
    return () => {
      window.removeEventListener('pilot-tradebook:trade-reviewed', onStep1)
      window.removeEventListener('pilot-tradebook:rationale-added', onStep2)
      window.removeEventListener('pilot-tradebook:opened-outcomes', onStep3)
    }
  }, [markStep])

  // Auto-dismiss when all three are done.
  useEffect(() => {
    if (!dismissed && step1 && step2 && step3 && userId) {
      writeFlag(userId, orgId, DISMISS)
      setDismissed(true)
    }
  }, [dismissed, step1, step2, step3, userId, orgId])

  if (dismissed) return null


  const handleOpenOutcomes = () => {
    markStep(STEP3, setStep3)
    try { window.dispatchEvent(new CustomEvent('pilot-tradebook:opened-outcomes')) } catch { /* ignore */ }
    onOpenOutcomes()
  }

  /* Steps and semantics unchanged; only the shell is shared now. The banner
     still has no dismiss control, because each step gates the path into the
     next surface, and it still auto-retires once all three are done. */
  return (
    <PilotStepsBanner
      /* Local product teaching for this surface, like Pipeline basics and
         Trade Lab basics — not the global five-step pilot mission, which is
         what "Get started" names. Unlabelled it read as a second one. */
      label="Trade Book basics"
      steps={[
        {
          n: 1,
          title: 'Review the recorded decision',
          /* "Click any trade row" described a desktop table. The phone shows
             the batch's trades as cards, and tapping one opens the same
             audit the desktop row expands to. */
          hint: 'Tap a trade in the batch to open its audit — price, sizing and rationale.',
          done: step1,
        },
        {
          n: 2,
          title: 'Capture your rationale',
          /* Two real write paths satisfy this: the batch's Decision
             rationale, and a rationale note on a single trade. The batch one
             is the primary explanation, so the hint names that first. */
          hint: 'Write the Decision rationale on the batch, or a note on one trade.',
          done: step2,
        },
        {
          n: 3,
          title: 'Open Outcomes',
          hint: 'See how the decision is performing and unlock the rest of Tesseract.',
          done: step3,
          onClick: handleOpenOutcomes,
        },
      ]}
    />
  )
}

