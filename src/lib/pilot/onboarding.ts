/**
 * What a pilot has to have done, reduced to four things.
 *
 * ── Why four, and why these ───────────────────────────────────────────────
 *
 * The checklist this replaces had twelve peers — launcher, feed, asset, rating,
 * note, theme, thought, prompt, list, feedback, referral — spanning first-run
 * and post-graduation, with no sequence between them. Twelve equal boxes is a
 * feature inventory, not an onboarding: a reader could be "5 of 12" having
 * opened five tabs, and the banner retired itself on a seven-flag rule that
 * ignored four of the boxes it was still showing.
 *
 * These four are the loop the product is actually for. See something worth
 * attention, work one of them, write down a view, and say which names are
 * yours. Each is a different verb and each unlocks the next one's usefulness.
 *
 * ── Where truth lives, and why it differs per step ────────────────────────
 *
 * Two of them leave a durable artifact and two do not, so they are sourced
 * differently on purpose:
 *
 *   perspective_added  rows the user wrote. No flag, because the artifact IS
 *                      the state — the argument `FirstSessionCoveragePrompt`
 *                      already makes for coverage, applied again.
 *   coverage_set       coverage rows, for the same reason.
 *   ideas_viewed       nothing is written when somebody reads a feed, so it
 *                      needs a mark. Server-backed in `users.pilot_progress`,
 *                      per org — NOT localStorage, which is what made the old
 *                      "View idea feed" step fail to follow a user to a second
 *                      browser and impossible to complete once the page that
 *                      fired its event was deleted.
 *   signal_worked      likewise a mark, and deliberately not the same one:
 *                      opening the Ideas app is not working a signal.
 *
 * Pure: no React, no Supabase, no clock. The caller supplies what it read.
 */

export const ONBOARDING_STEPS = [
  'ideas_viewed',
  'signal_worked',
  'perspective_added',
  'coverage_set',
] as const

export type OnboardingStep = typeof ONBOARDING_STEPS[number]

/**
 * The durable rows that prove a perspective was added.
 *
 * Exactly the flags the existing progress query already computes. Nothing new
 * is stored: if a contribution, note, rating, thought or prompt exists, the
 * user has put a view on the record, and a boolean beside those rows could
 * only ever disagree with them.
 */
export interface PilotActivity {
  hasContribution?: boolean
  hasNote?: boolean
  hasRating?: boolean
  hasThought?: boolean
  hasPrompt?: boolean
}

export interface OnboardingInput {
  /** `users.pilot_progress`, as read. Keys are `<stage>_at_<orgId>`. */
  progress: Record<string, string | null | undefined> | null | undefined
  orgId: string | null
  activity: PilotActivity | null | undefined
  /** Real coverage rows, not a flag. */
  hasCoverage: boolean
}

export interface OnboardingStatus {
  ideas_viewed: boolean
  signal_worked: boolean
  perspective_added: boolean
  coverage_set: boolean
  /** All four. See `isOnboardingComplete`. */
  complete: boolean
  completedCount: number
  total: number
}

/** The per-org key a marked step occupies inside `pilot_progress`. */
export function onboardingStageKey(step: OnboardingStep, orgId: string | null): string {
  return `${step}_at_${orgId || 'no-org'}`
}

export function hasPerspective(activity: PilotActivity | null | undefined): boolean {
  if (!activity) return false
  return !!(activity.hasContribution || activity.hasNote || activity.hasRating
    || activity.hasThought || activity.hasPrompt)
}

export function onboardingStatus(input: OnboardingInput): OnboardingStatus {
  const p = input.progress ?? {}
  const steps = {
    ideas_viewed: !!p[onboardingStageKey('ideas_viewed', input.orgId)],
    signal_worked: !!p[onboardingStageKey('signal_worked', input.orgId)],
    perspective_added: hasPerspective(input.activity),
    coverage_set: !!input.hasCoverage,
  }
  const completedCount = ONBOARDING_STEPS.filter(s => steps[s]).length
  return {
    ...steps,
    completedCount,
    total: ONBOARDING_STEPS.length,
    complete: completedCount === ONBOARDING_STEPS.length,
  }
}

/**
 * Onboarding is finished when the four VISIBLE steps are.
 *
 * The rule it replaces watched seven durable flags and ignored the four steps
 * the reader could see, so the checklist could retire itself while still
 * displaying incomplete boxes. What is shown and what counts are now the same
 * list, which is the only version of this that a reader can trust.
 *
 * Deliberately NOT the same thing as `usePilotProgress`'s `graduated`, which
 * records reaching Outcomes and feeds access gating. That stays as it is.
 */
export function isOnboardingComplete(status: OnboardingStatus): boolean {
  return status.complete
}
