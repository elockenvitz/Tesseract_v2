/**
 * PilotTradeLabIntroBanner — top-of-page onboarding strip for pilots
 * landing in Trade Lab. Walks them through the three concrete moves
 * to commit a trade:
 *   1. Add the tutorial idea to the simulation
 *   2. Size the trade — set its weight or shares
 *   3. Execute
 *
 * Step 1 fires only for the captured tutorial idea. It used to fire for
 * anything added, and the copy pointed at the seeded recommendation — a
 * different trade_queue_item from the one the global mission follows, so a
 * pilot could complete this banner and leave the mission stuck on "Test the
 * trade". One object carries the whole journey.
 *
 * Step 1 fires only from a real add. Expanding a card or opening its detail
 * modal used to fire it too, which ticked the step off for someone who had
 * only looked — the banner then said "done" about work that had not happened.
 *
 * Steps tick off as the user does them — same progress pattern as the
 * Idea Pipeline banner. Each step listens for a window event:
 *   - 'pilot-tradelab:rec-reviewed'  (Step 1)
 *   - 'pilot-tradelab:rec-sized'     (Step 2)
 *   - 'pilot-tradelab:executed'      (Step 3)
 *
 * The banner auto-retires once all three are done. Users can also
 * manually dismiss via the X. State is keyed per user+org so each
 * new pilot client gets a fresh banner with all three steps unchecked.
 */

import { useCallback, useEffect, useState } from 'react'
import { PilotStepsBanner } from './PilotStepsBanner'
import { logPilotEvent, type PilotEventType } from '../../lib/pilot/pilot-telemetry'

interface PilotTradeLabIntroBannerProps {
  /**
   * Which step is being taught, or null when nothing is.
   *
   * The banner used to carry its own recommendations button, which put a
   * second large control for the same action one line above the one in the
   * toolbar. The reader had two things to choose between for one job.
   *
   * So the tutorial explains and the app control acts: this reports which
   * step is current, the surface points at its own control for as long as the
   * step needs it, and there is one place to press.
   */
  onCurrentStepChange?: (step: 1 | 2 | 3 | null) => void
  userId: string
  /** Active org id, used to scope the banner state per pilot client. */
  orgId?: string | null
}

const STEP1 = 'rec_reviewed'
const STEP2 = 'rec_sized'
const STEP3 = 'executed'
const DISMISS = 'dismissed'

// Map each step suffix to its telemetry event so we can fire one event
// per first-time completion. The mapping is colocated with the suffix
// constants so adding a new step doesn't drift across files.
const STEP_TO_EVENT: Record<string, PilotEventType> = {
  [STEP1]: 'pilot_tradelab_step_rec_reviewed',
  [STEP2]: 'pilot_tradelab_step_rec_sized',
  [STEP3]: 'pilot_tradelab_step_executed',
}

function flagKey(userId: string, orgId: string | null | undefined, suffix: string) {
  return `pilot_tradelab_intro_${suffix}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { return localStorage.getItem(flagKey(userId, orgId, suffix)) === '1' } catch { return false }
}
function writeFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.setItem(flagKey(userId, orgId, suffix), '1') } catch { /* ignore */ }
}

export function PilotTradeLabIntroBanner({ userId, orgId, onCurrentStepChange }: PilotTradeLabIntroBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => readFlag(userId, orgId, DISMISS))
  const [step1, setStep1] = useState<boolean>(() => readFlag(userId, orgId, STEP1))
  const [step2, setStep2] = useState<boolean>(() => readFlag(userId, orgId, STEP2))
  const [step3, setStep3] = useState<boolean>(() => readFlag(userId, orgId, STEP3))

  // Reload from localStorage when user/org changes — picks up the
  // right state when the analyst switches between pilot clients.
  useEffect(() => {
    setDismissed(readFlag(userId, orgId, DISMISS))
    setStep1(readFlag(userId, orgId, STEP1))
    setStep2(readFlag(userId, orgId, STEP2))
    setStep3(readFlag(userId, orgId, STEP3))
  }, [userId, orgId])

  // First-time-only — `readFlag` gate makes the telemetry event fire
  // once per (user, org) even when the underlying source event
  // (rec-reviewed, rec-sized, executed) repeats across renders.
  const markStep = useCallback((suffix: string, setter: (v: boolean) => void) => {
    if (readFlag(userId, orgId, suffix)) return
    writeFlag(userId, orgId, suffix)
    setter(true)
    const eventType = STEP_TO_EVENT[suffix]
    if (eventType) logPilotEvent({ eventType, organizationId: orgId ?? null })
  }, [userId, orgId])

  // Listen for the three step events. Each only fires when this
  // banner instance is alive — events dispatched while the user
  // isn't on the lab page just no-op (the matching localStorage
  // flag stays false), which is fine because the banner's whole
  // job is on-page coaching.
  useEffect(() => {
    // Defer the setState via queueMicrotask. Window events dispatch
    // synchronously, so a dispatch that happens during a parent
    // component's render (e.g., HoldingsSimulationTable kicks an
    // event from a state-update callback) would otherwise call our
    // setState during their render and trip React's "Cannot update
    // a component while rendering a different component" warning.
    // queueMicrotask runs after the current render flushes.
    const defer = (fn: () => void) => () => queueMicrotask(fn)
    const onStep1 = defer(() => markStep(STEP1, setStep1))
    const onStep2 = defer(() => markStep(STEP2, setStep2))
    const onStep3 = defer(() => markStep(STEP3, setStep3))
    window.addEventListener('pilot-tradelab:rec-reviewed', onStep1)
    window.addEventListener('pilot-tradelab:rec-sized', onStep2)
    window.addEventListener('pilot-tradelab:executed', onStep3)
    return () => {
      window.removeEventListener('pilot-tradelab:rec-reviewed', onStep1)
      window.removeEventListener('pilot-tradelab:rec-sized', onStep2)
      window.removeEventListener('pilot-tradelab:executed', onStep3)
    }
  }, [markStep])

  /*
   * Tell the surface which step is being taught, so it can point at its own
   * control instead of this module growing one. Null once the banner has
   * nothing left to say, which is what takes the emphasis away again.
   */
  useEffect(() => {
    if (!onCurrentStepChange) return
    const step = dismissed ? null : !step1 ? 1 : !step2 ? 2 : !step3 ? 3 : null
    onCurrentStepChange(step)
    return () => onCurrentStepChange(null)
  }, [onCurrentStepChange, dismissed, step1, step2, step3])

  // Auto-dismiss when all three actions are done.
  useEffect(() => {
    if (!dismissed && step1 && step2 && step3) {
      writeFlag(userId, orgId, DISMISS)
      setDismissed(true)
    }
  }, [dismissed, step1, step2, step3, userId, orgId])

  if (dismissed) return null


  /* Steps and semantics unchanged. No dismiss control, and it auto-retires
     once all three are done, exactly as before. */
  return (
    <PilotStepsBanner
      /* Local product teaching, like Pipeline basics — not the global
         five-step pilot mission, which is what "Get started" names. */
      label="Trade Lab basics"
      steps={[
        {
          n: 1,
          /* "Review a recommendation" described an action that did not
             complete the step. The step completes when a recommendation is
             added to the simulation, so the title says that — reading one and
             closing it again leaves the step open, as it always did in the
             data even while the copy implied otherwise. */
          /* Your idea, not a recommendation.
             The mission follows the one trade_queue_item the pilot captured,
             and every later step reads against it. Teaching "add a
             recommendation" here pointed at seeded demo content — a different
             item — so a pilot could finish this tutorial and still be told to
             test a trade, with nothing on the screen able to satisfy it.
             Recommendations remain addable; they just do not graduate anyone. */
          title: 'Add your idea to the simulation',
          /* One line, naming the control rather than a side of a desktop
             screen. It carried a button too, which is what put two large
             controls for one action on top of each other. */
          hint: 'Open Ideas & recommendations, find the idea you captured, and tap Add to simulation.',
          done: step1,
        },
        {
          n: 2,
          /* "Pick your trade" described a desktop checkbox — and one a phone
             never renders, so the step could not be completed there at all.
             The act between adding a trade and committing it is deciding how
             big it is, which is what the step now names and what its
             predicate now watches. */
          title: 'Size the trade',
          hint: 'Tap the trade row and set its weight or shares.',
          done: step2,
        },
        {
          n: 3,
          title: 'Execute the simulated trade',
          /* "Click Execute Trade" named a desktop button. The phone's control
             is a bar under the table and says how many trades it will
             commit, so the hint names the act and where it lives. */
          hint: 'Tap Execute at the bottom of the table to commit it to the Trade Book.',
          done: step3,
        },
      ]}
    />
  )
}

