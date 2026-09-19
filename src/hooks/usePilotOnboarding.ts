import { useCallback } from 'react'
import { usePilotMode } from './usePilotMode'
import { usePilotProgress } from './usePilotProgress'

/**
 * The two onboarding steps a product surface has to report.
 *
 * ── Why this exists rather than calling `usePilotProgress` directly ───────
 *
 * The surfaces that know these facts are the Ideas feed and the Ideas app
 * shell, and neither has any other reason to know what a pilot is. This is the
 * whole of what they import: two callbacks that are safe to call on every
 * render path, from a component that is not about onboarding.
 *
 * Everything that makes the write safe is already behind `mark`: it dedupes
 * per (stage, org) for the session, which is what stopped an earlier version
 * of this pattern writing ten thousand rows into `pilot_telemetry_events`. So
 * a caller may fire these as often as it likes.
 *
 * Gated on being a pilot, because a non-pilot has no onboarding to record and
 * writing the row anyway would put pilot state on every account in the org.
 *
 * The other two steps — a perspective and a coverage assignment — are rows the
 * user wrote, so nothing reports them. See `lib/pilot/onboarding.ts`.
 */
export function usePilotOnboarding() {
  const { effectiveIsPilot } = usePilotMode()
  const { mark } = usePilotProgress()

  /** The real attention feed rendered candidates and the reader saw them. */
  const markIdeasViewed = useCallback(() => {
    if (!effectiveIsPilot) return
    mark('ideas_viewed')
  }, [effectiveIsPilot, mark])

  /**
   * A candidate was opened into the shared workspace.
   *
   * Deliberately NOT "the Ideas app was opened". Mounting an application is
   * not working a signal, and a step that ticks on arrival teaches nothing —
   * that conflation is what made four of the twelve old steps completable
   * without doing anything.
   */
  const markSignalWorked = useCallback(() => {
    if (!effectiveIsPilot) return
    mark('signal_worked')
  }, [effectiveIsPilot, mark])

  return { markIdeasViewed, markSignalWorked }
}
