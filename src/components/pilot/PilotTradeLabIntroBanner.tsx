/**
 * PilotTradeLabIntroBanner — top-of-page onboarding strip for pilots
 * landing in Trade Lab. Walks them through the three concrete moves
 * to commit a trade:
 *   1. Click / expand the recommendation card to review the details
 *   2. Add the recommendation and size the trade
 *   3. Execute
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

export function PilotTradeLabIntroBanner({ userId, orgId }: PilotTradeLabIntroBannerProps) {
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
      steps={[
        {
          n: 1,
          title: 'Review and add the recommendation',
          hint: 'Check the box on the recommendation card on the left to import it into the holdings table.',
          done: step1,
        },
        {
          n: 2,
          title: 'Pick your trade',
          hint: 'Check the box on the trade row in the table below.',
          done: step2,
        },
        {
          n: 3,
          title: 'Execute',
          hint: 'Click Execute Trade to commit it to the Trade Book.',
          done: step3,
        },
      ]}
    />
  )
}

