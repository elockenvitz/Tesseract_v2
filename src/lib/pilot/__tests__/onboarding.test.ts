/**
 * The four steps, and the one rule that decides completion.
 *
 * The defects being pinned are specific: a step whose truth was per-browser, a
 * step that could be ticked without doing anything, and a completion rule that
 * watched a different list from the one on screen.
 */

import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_STEPS, hasPerspective, isOnboardingComplete, onboardingStageKey, onboardingStatus,
} from '../onboarding'

const ORG = 'org-1'
const marked = (...steps: string[]) =>
  Object.fromEntries(steps.map(s => [`${s}_at_${ORG}`, '2026-09-01T00:00:00Z']))

const status = (over: Partial<Parameters<typeof onboardingStatus>[0]> = {}) =>
  onboardingStatus({ progress: {}, orgId: ORG, activity: {}, hasCoverage: false, ...over })

describe('the four steps', () => {
  it('names exactly the four', () => {
    expect([...ONBOARDING_STEPS]).toEqual([
      'ideas_viewed', 'signal_worked', 'perspective_added', 'coverage_set',
    ])
  })

  it('starts a new pilot at none of them', () => {
    const s = status()
    expect(s.completedCount).toBe(0)
    expect(s.total).toBe(4)
    expect(s.complete).toBe(false)
  })
})

describe('the two marked steps', () => {
  it('reads them from the per-org key in pilot_progress', () => {
    const s = status({ progress: marked('ideas_viewed') })
    expect(s.ideas_viewed).toBe(true)
    expect(s.signal_worked).toBe(false)
  })

  /**
   * Per org, so a mark earned in one workspace does not pre-tick the step in
   * another the same user joins later.
   */
  it('does not carry a mark across organisations', () => {
    const s = onboardingStatus({
      progress: marked('ideas_viewed'), orgId: 'org-2', activity: {}, hasCoverage: false,
    })
    expect(s.ideas_viewed).toBe(false)
  })

  it('spells the key the same way the writer does', () => {
    expect(onboardingStageKey('signal_worked', ORG)).toBe('signal_worked_at_org-1')
    expect(onboardingStageKey('signal_worked', null)).toBe('signal_worked_at_no-org')
  })
})

describe('perspective_added', () => {
  /** Any one of the five durable artifacts is a view put on the record. */
  it.each(['hasContribution', 'hasNote', 'hasRating', 'hasThought', 'hasPrompt'] as const)(
    'is complete from %s alone',
    key => {
      expect(status({ activity: { [key]: true } }).perspective_added).toBe(true)
    },
  )

  /**
   * No stored boolean. The rows prove it, and a flag beside them could only
   * ever disagree — which is the failure `pilot_progress` already documents.
   */
  it('ignores anything in pilot_progress claiming otherwise', () => {
    const s = status({ progress: marked('perspective_added'), activity: {} })
    expect(s.perspective_added).toBe(false)
  })

  it('is not implied by a theme or a list', () => {
    expect(hasPerspective({} as never)).toBe(false)
    expect(hasPerspective(null)).toBe(false)
  })
})

describe('coverage_set', () => {
  it('comes from real coverage, not a flag', () => {
    expect(status({ hasCoverage: true }).coverage_set).toBe(true)
    expect(status({ progress: marked('coverage_set'), hasCoverage: false }).coverage_set).toBe(false)
  })
})

describe('completion', () => {
  it('is all four, and nothing else', () => {
    const s = status({
      progress: marked('ideas_viewed', 'signal_worked'),
      activity: { hasNote: true },
      hasCoverage: true,
    })
    expect(s.completedCount).toBe(4)
    expect(isOnboardingComplete(s)).toBe(true)
  })

  /**
   * The mismatch this replaces: the old rule watched seven durable flags and
   * ignored every step that ticks on a mark, so the checklist could retire
   * itself while still showing incomplete boxes.
   */
  it('is false while a marked step is outstanding, however much is written', () => {
    const s = status({
      progress: marked('ideas_viewed'),
      activity: { hasNote: true, hasRating: true, hasContribution: true, hasThought: true, hasPrompt: true },
      hasCoverage: true,
    })
    expect(s.signal_worked).toBe(false)
    expect(s.complete).toBe(false)
    expect(s.completedCount).toBe(3)
  })

  it('survives absent progress and absent activity', () => {
    const s = onboardingStatus({ progress: null, orgId: null, activity: null, hasCoverage: false })
    expect(s.completedCount).toBe(0)
    expect(s.complete).toBe(false)
  })
})
