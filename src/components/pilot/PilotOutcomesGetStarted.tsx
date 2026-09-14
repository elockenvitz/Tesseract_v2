/**
 * PilotOutcomesGetStarted — Get Started banner shown at the top of
 * Outcomes for a pilot user the first time they land here.
 *
 * Outcomes is pilot mission stage 5, "Close the loop". Finishing this
 * banner completes the stage (see the mark below), and with stages 1–4
 * done the mission graduates the pilot. It walks the user through:
 *
 *   1. Inspect the result — click your committed decision in the
 *      table to see Outcomes's analysis (price move, performance,
 *      thesis scoring) in the right pane.
 *   2. Review why the decision was made — open the "Why this
 *      decision was made" section in the right pane to revisit
 *      the original thesis, why-now, and recommendation.
 *   3. Check how the trade is performing — open the "How it's
 *      performing" section to see price move, P&L, and the
 *      decision-level scoring. Opening it graduates the user.
 *
 * Graduation now happens entirely on Outcomes — no navigation away
 * — so the user gets the graduation modal in context.
 *
 * State is keyed per user+org so each new pilot client starts fresh.
 * Window events the banner listens for:
 *   - 'pilot-outcomes:result-inspected'   (Step 1)
 *   - 'outcomes:section-opened' { sectionId: 'thesis' } (Step 2)
 *   - 'outcomes:section-opened' { sectionId: 'performance' } (Step 3)
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { PilotStepsBanner } from './PilotStepsBanner'
import { Trophy } from 'lucide-react'
import { logPilotEvent, type PilotEventType } from '../../lib/pilot/pilot-telemetry'
import { usePilotProgress } from '../../hooks/usePilotProgress'
import { tutorialOutcomeReviewedKey } from '../../lib/pilot/mission'

interface PilotOutcomesGetStartedProps {
  userId: string | undefined
  orgId?: string | null
}

const DISMISS = 'dismissed'
const STEP1 = 'inspected'
const STEP2 = 'next_action'
const STEP3 = 'research'

// Each step → its server telemetry event. Logging is gated through
// `setFlagWithTelemetry` below so the row lands exactly once per
// (user, org) — the readFlag check before each write is the
// idempotency guard.
const STEP_TO_EVENT: Record<string, PilotEventType> = {
  [STEP1]: 'pilot_outcomes_step_result_inspected',
  [STEP2]: 'pilot_outcomes_step_thesis_reviewed',
  [STEP3]: 'pilot_outcomes_step_performance_checked',
}
// Pending flag the global PilotGraduationModal reads. Setting this
// when graduation occurs lets the modal pop wherever the user lands
// after the step-3 navigation (since Outcomes itself unmounts when
// the user clicks "Update research" → asset tab opens).
const PENDING_GRAD = 'pending_graduation_modal'
const GRAD_DISMISS = 'graduation_dismissed'

function flagKey(userId: string, orgId: string | null | undefined, suffix: string) {
  return `pilot_outcomes_intro_${suffix}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { return localStorage.getItem(flagKey(userId, orgId, suffix)) === '1' } catch { return false }
}
function writeFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.setItem(flagKey(userId, orgId, suffix), '1') } catch { /* ignore */ }
}

// Internal store: dispatch our state-changed event after every flag
// write so any subscribed banner re-renders immediately. We dispatch
// from the same call site that writes the flag, eliminating the prior
// race where a setState in a listener could be missed during a busy
// render flush.
//
// Also fires a one-shot telemetry row the FIRST time a step flag
// flips false→true. The readFlag check makes this idempotent per
// (user, org) — repeating the underlying action (e.g. re-opening the
// thesis section) won't log a duplicate. Telemetry is fire-and-forget
// so it can't block the UI update.
function setFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  const wasAlreadySet = readFlag(userId, orgId, suffix)
  writeFlag(userId, orgId, suffix)
  try { window.dispatchEvent(new CustomEvent('pilot-outcomes:state-changed')) } catch { /* ignore */ }
  if (!wasAlreadySet) {
    const eventType = STEP_TO_EVENT[suffix]
    if (eventType) logPilotEvent({ eventType, organizationId: orgId ?? null })
  }
}

// Subscribe to localStorage flag changes from any source — same-tab
// custom events (most posts) AND cross-tab `storage` events (rare,
// e.g. user has Outcomes open in two windows).
const subscribe = (cb: () => void) => {
  window.addEventListener('pilot-outcomes:state-changed', cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener('pilot-outcomes:state-changed', cb)
    window.removeEventListener('storage', cb)
  }
}

function useFlag(userId: string | undefined, orgId: string | null | undefined, suffix: string): boolean {
  const getSnapshot = useCallback(
    () => (userId ? readFlag(userId, orgId, suffix) : false),
    [userId, orgId, suffix],
  )
  // SSR snapshot is always false — these flags are user/browser scoped
  // and have no meaning during server render.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function PilotOutcomesGetStarted({
  userId,
  orgId,
}: PilotOutcomesGetStartedProps) {
  // Flags are read straight from localStorage on every render via
  // useSyncExternalStore — the source of truth is the disk, not React
  // state. Any writeFlag elsewhere immediately re-renders the banner
  // because `setFlag` dispatches `pilot-outcomes:state-changed`.
  const dismissed = useFlag(userId, orgId, DISMISS)
  const step1 = useFlag(userId, orgId, STEP1)
  const step2 = useFlag(userId, orgId, STEP2)
  const step3 = useFlag(userId, orgId, STEP3)

  // Step listeners just write the corresponding flag — the
  // useSyncExternalStore subscription handles re-rendering. No
  // setState/setter wiring needed.
  //
  // Steps 2 and 3 both key off `outcomes:section-opened` — Step 2
  // when the "Why this decision was made" section opens
  // (sectionId='thesis'), Step 3 when "How it's performing" opens
  // (sectionId='performance'). One listener handles both.
  useEffect(() => {
    if (!userId) return
    const onStep1 = () => setFlag(userId, orgId, STEP1)
    const onSectionOpened = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.sectionId === 'thesis') {
        setFlag(userId, orgId, STEP2)
      } else if (detail?.sectionId === 'performance') {
        setFlag(userId, orgId, STEP3)
      }
    }
    window.addEventListener('pilot-outcomes:result-inspected', onStep1)
    window.addEventListener('outcomes:section-opened', onSectionOpened as EventListener)
    return () => {
      window.removeEventListener('pilot-outcomes:result-inspected', onStep1)
      window.removeEventListener('outcomes:section-opened', onSectionOpened as EventListener)
    }
  }, [userId, orgId])

  // Once all three are done, retire the 3-step strip AND set the
  // pending-graduation flag so the global PilotGraduationModal (mounted
  // at the Dashboard level) pops the celebration. The modal lives
  // outside this component so it survives the navigation that step 3
  // typically triggers (Update Research opens the asset tab and
  // unmounts Outcomes).
  //
  // The trigger does NOT depend on `!dismissed` — a user who manually
  // X'd the banner still earns graduation when they finish the loop.
  // PENDING_GRAD is the gate that prevents double-firing within a
  // session; GRAD_DISMISS is the gate that prevents re-celebrating
  // someone who already saw it.
  // "Finish the loop" finished is pilot mission stage 5 — the last one. The
  // steps are browser-local, so this writes the one server-backed mark the
  // roadmap reads; the mission then graduates the pilot. Idempotent per
  // (stage, org), and written for a pilot who finished before this existed.
  const { progress, mark } = usePilotProgress()
  const stageMarked = !!progress[tutorialOutcomeReviewedKey(orgId ?? null)]
  useEffect(() => {
    if (!userId || !step1 || !step2 || !step3 || stageMarked) return
    mark('tutorial_outcome_reviewed')
  }, [userId, step1, step2, step3, stageMarked, mark])

  useEffect(() => {
    if (!userId || !step1 || !step2 || !step3) return
    if (readFlag(userId, orgId, GRAD_DISMISS)) return
    if (!readFlag(userId, orgId, PENDING_GRAD)) {
      writeFlag(userId, orgId, PENDING_GRAD)
      try { window.dispatchEvent(new CustomEvent('pilot-graduation:trigger')) } catch { /* ignore */ }
    }
    if (!dismissed) setFlag(userId, orgId, DISMISS)
  }, [dismissed, step1, step2, step3, userId, orgId])

  if (dismissed) return null


  // Step 2 click — scroll the right pane to the "Why this decision
  // was made" section. The actual step completion fires when the
  // section opens (StorySection broadcasts outcomes:section-opened).
  const handleReviewThesis = () => {
    try {
      window.dispatchEvent(new CustomEvent('outcomes:open-section', {
        detail: { sectionId: 'thesis' },
      }))
    } catch { /* ignore */ }
  }

  // Step 3 click — open the "How it's performing" section. The section's
  // own open broadcast (sectionId='performance') ticks step 3.
  const handleCheckPerformance = () => {
    try {
      window.dispatchEvent(new CustomEvent('outcomes:open-section', {
        detail: { sectionId: 'performance' },
      }))
    } catch { /* ignore */ }
  }

  /* The shell is shared; the identity is not. Outcomes is the terminal stage
     of the loop and still says "Finish the loop" in its own colour. No dismiss
     control, and it auto-retires once all steps complete. */
  return (
    <PilotStepsBanner
      label="Finish the loop"
      tone="emerald"
      icon={Trophy}
      steps={[
        {
          n: 1,
          title: 'Inspect the result',
          hint: 'Click your decision in the table to see how Outcomes scored the thesis.',
          done: step1,
        },
        {
          n: 2,
          title: 'Review why the decision was made',
          hint: 'Open the \u201cWhy this decision was made\u201d section in the right pane to revisit the thesis.',
          done: step2,
          onClick: handleReviewThesis,
        },
        {
          n: 3,
          title: 'Check how the trade is performing',
          hint: 'Open the \u201cHow it\u2019s performing\u201d section to see the price move, P&L, and decision scoring.',
          done: step3,
          onClick: handleCheckPerformance,
        },
      ]}
    />
  )
}

