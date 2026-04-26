/**
 * PilotOutcomesGetStarted — Get Started banner shown at the top of
 * Outcomes for a pilot user the first time they land here.
 *
 * Reaching Outcomes is the graduation moment — pilot gating drops
 * away and the rest of Tesseract becomes available. This banner
 * acknowledges the milestone and walks the user through the loop:
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
import { X, ArrowRight, Check, Trophy } from 'lucide-react'
import { clsx } from 'clsx'

interface PilotOutcomesGetStartedProps {
  userId: string | undefined
  orgId?: string | null
}

const DISMISS = 'dismissed'
const STEP1 = 'inspected'
const STEP2 = 'next_action'
const STEP3 = 'research'
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
function setFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  writeFlag(userId, orgId, suffix)
  try { window.dispatchEvent(new CustomEvent('pilot-outcomes:state-changed')) } catch { /* ignore */ }
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

  const dismiss = () => {
    if (userId) setFlag(userId, orgId, DISMISS)
  }

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

  return (
    <div className="flex-shrink-0 bg-gradient-to-r from-emerald-50 via-teal-50 to-primary-50 dark:from-emerald-950/40 dark:via-teal-950/20 dark:to-primary-950/30 border-b border-emerald-200 dark:border-emerald-800/60">
      <div className="px-6 py-3 flex items-start gap-4">
        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-semibold shrink-0 mt-0.5">
          <Trophy className="h-4 w-4" />
          <span className="text-[12px] uppercase tracking-wider whitespace-nowrap">Finish the loop</span>
        </div>
        <div className="flex items-start gap-x-4 text-gray-700 dark:text-gray-300 min-w-0 flex-wrap">
          <Step
            n={1}
            title="Inspect the result"
            hint="Click your decision in the table to see how Outcomes scored the thesis."
            done={step1}
          />
          <ArrowRight className="h-3.5 w-3.5 text-emerald-400 dark:text-emerald-500 shrink-0 mt-[3px]" />
          <button
            type="button"
            onClick={handleReviewThesis}
            className="flex items-start gap-2 min-w-0 cursor-pointer hover:opacity-90 transition-opacity"
          >
            <Step
              n={2}
              title="Review why the decision was made"
              hint="Open the “Why this decision was made” section in the right pane to revisit the thesis."
              done={step2}
            />
          </button>
          <ArrowRight className="h-3.5 w-3.5 text-emerald-400 dark:text-emerald-500 shrink-0 mt-[3px]" />
          <button
            type="button"
            onClick={handleCheckPerformance}
            className="flex items-start gap-2 min-w-0 cursor-pointer hover:opacity-90 transition-opacity"
          >
            <Step
              n={3}
              title="Check how the trade is performing"
              hint="Open the “How it's performing” section to see the price move, P&L, and decision scoring."
              done={step3}
            />
          </button>
        </div>
        <button
          onClick={dismiss}
          className="ml-auto -my-1 p-1.5 rounded text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100/60 dark:text-emerald-400 dark:hover:text-emerald-200 dark:hover:bg-emerald-900/30 transition-colors shrink-0"
          title="Dismiss"
          aria-label="Dismiss Outcomes intro"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function Step({ n, title, hint, done }: { n: number; title: string; hint: string; done: boolean }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span
        className={clsx(
          "shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums shadow-sm",
          done ? "bg-emerald-500 text-white" : "bg-emerald-600 text-white",
        )}
      >
        {done ? <Check className="h-3 w-3" /> : n}
      </span>
      <div className="min-w-0 text-left">
        <div
          className={clsx(
            "text-[12px] font-semibold leading-tight whitespace-nowrap",
            done ? "text-emerald-700 dark:text-emerald-300 line-through opacity-70" : "text-gray-900 dark:text-white",
          )}
        >
          {title}
        </div>
        <div
          className={clsx(
            "text-[11px] leading-snug whitespace-nowrap",
            done ? "text-emerald-600/60 dark:text-emerald-400/60" : "text-gray-600 dark:text-gray-400",
          )}
        >
          {hint}
        </div>
      </div>
    </div>
  )
}
