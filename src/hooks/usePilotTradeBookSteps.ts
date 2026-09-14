import { useCallback, useEffect, useState } from 'react'
import { logPilotEvent, type PilotEventType } from '../lib/pilot/pilot-telemetry'
import { TRADE_BOOK_STEP_EVENTS, type TradeBookStepKey } from '../lib/pilot/trade-book-steps'

/**
 * Trade Book basics progress, for any component that shows it.
 *
 * Lifted out of `PilotTradeBookGetStarted` so the step banner and the phone's
 * next-steps card read the same state. Storage and events are unchanged:
 * per-(user, org) localStorage flags, completed by the window events the real
 * actions fire, each logged to telemetry the first time only.
 *
 * Safe to mount twice. Every mounted copy listens and sets its own state; only
 * the first to see a step writes the flag and logs it. (The old banner-only
 * version returned early when the flag was already written, which is right for
 * one listener and would leave a second copy showing a step as not done.)
 */
const STORAGE_SUFFIX: Record<TradeBookStepKey, string> = {
  reviewed: 'reviewed',
  rationale: 'rationale',
  outcomes: 'outcomes',
}
const DISMISS = 'dismissed'

const STEP_TO_TELEMETRY: Record<TradeBookStepKey, PilotEventType> = {
  reviewed: 'pilot_tradebook_step_trade_reviewed',
  rationale: 'pilot_tradebook_step_rationale_added',
  outcomes: 'pilot_tradebook_step_opened_outcomes',
}

function flagKey(userId: string, orgId: string | null | undefined, suffix: string) {
  return `pilot_tradebook_intro_${suffix}_${userId || 'anon'}_${orgId || 'no-org'}`
}
function readFlag(userId: string | undefined, orgId: string | null | undefined, suffix: string) {
  if (!userId) return false
  try { return localStorage.getItem(flagKey(userId, orgId, suffix)) === '1' } catch { return false }
}
function writeFlag(userId: string, orgId: string | null | undefined, suffix: string) {
  try { localStorage.setItem(flagKey(userId, orgId, suffix), '1') } catch { /* ignore */ }
}

const readAll = (userId: string | undefined, orgId: string | null | undefined) => ({
  reviewed: readFlag(userId, orgId, STORAGE_SUFFIX.reviewed),
  rationale: readFlag(userId, orgId, STORAGE_SUFFIX.rationale),
  outcomes: readFlag(userId, orgId, STORAGE_SUFFIX.outcomes),
})

export interface PilotTradeBookSteps {
  done: Record<TradeBookStepKey, boolean>
  completedCount: number
  dismissed: boolean
  /** Step 3's action: record it, tell the page, then go. */
  openOutcomes: (navigate: () => void) => void
}

export function usePilotTradeBookSteps(userId: string | undefined, orgId: string | null | undefined): PilotTradeBookSteps {
  const [done, setDone] = useState(() => readAll(userId, orgId))
  const [dismissed, setDismissed] = useState(() => readFlag(userId, orgId, DISMISS))

  useEffect(() => {
    setDone(readAll(userId, orgId))
    setDismissed(readFlag(userId, orgId, DISMISS))
  }, [userId, orgId])

  const markStep = useCallback((key: TradeBookStepKey) => {
    if (!userId) return
    const suffix = STORAGE_SUFFIX[key]
    if (!readFlag(userId, orgId, suffix)) {
      writeFlag(userId, orgId, suffix)
      logPilotEvent({ eventType: STEP_TO_TELEMETRY[key], organizationId: orgId ?? null })
    }
    setDone(prev => (prev[key] ? prev : { ...prev, [key]: true }))
  }, [userId, orgId])

  useEffect(() => {
    // Deferred so an event fired during another component's render does not
    // set state inside that render.
    const keys = Object.keys(TRADE_BOOK_STEP_EVENTS) as TradeBookStepKey[]
    const handlers = keys.map(key => {
      const handler = () => queueMicrotask(() => markStep(key))
      window.addEventListener(TRADE_BOOK_STEP_EVENTS[key], handler)
      return [key, handler] as const
    })
    return () => {
      for (const [key, handler] of handlers) window.removeEventListener(TRADE_BOOK_STEP_EVENTS[key], handler)
    }
  }, [markStep])

  // Retire once all three are done.
  useEffect(() => {
    if (!dismissed && done.reviewed && done.rationale && done.outcomes && userId) {
      writeFlag(userId, orgId, DISMISS)
      setDismissed(true)
    }
  }, [dismissed, done, userId, orgId])

  const openOutcomes = useCallback((navigate: () => void) => {
    markStep('outcomes')
    try { window.dispatchEvent(new CustomEvent(TRADE_BOOK_STEP_EVENTS.outcomes)) } catch { /* ignore */ }
    navigate()
  }, [markStep])

  return {
    done,
    completedCount: Number(done.reviewed) + Number(done.rationale) + Number(done.outcomes),
    dismissed,
    openOutcomes,
  }
}
