/**
 * What the Work column says, and why that order.
 *
 * Pinned because the ordering is the product decision, and the failure mode is
 * silent and specific: a name carrying a live BUY awaiting a recommendation
 * reported "Thin evidence" — true, and the least important true thing about it.
 * A reader scanning for what needs doing was shown a filing problem instead of
 * a decision.
 *
 * Nothing here is mocked. `workStateFor` is pure and the labels come from the
 * product's own vocabulary, so the assertions are against the real strings a
 * reader sees.
 */
import { describe, it, expect } from 'vitest'
import { workStateFor, stageLabel, WORK_TIER_RANK } from '../work-state'
import { FINAL_STAGE } from '../../ideas/stage-model'

describe('a live idea outranks every research fact', () => {
  it('puts an idea awaiting a decision at the top, with hygiene underneath', () => {
    const w = workStateFor({ direction: 'buy', stage: FINAL_STAGE }, 'thin', 0)
    expect(w.tier).toBe('decision')
    expect(w.label).toBe('BUY · Recommendation ready')
    // The exact regression: the filing state survives, demoted.
    expect(w.secondary).toBe('Thin evidence')
  })

  it('ranks an in-flight idea below a decision but above unread research', () => {
    const idea = workStateFor({ direction: 'sell', stage: 'researching' }, null, 0)
    expect(idea.tier).toBe('idea')
    expect(idea.label).toBe('SELL · Researching')
    expect(WORK_TIER_RANK.decision).toBeGreaterThan(WORK_TIER_RANK.idea)
    expect(WORK_TIER_RANK.idea).toBeGreaterThan(WORK_TIER_RANK.evidence)
  })

  it('says unreviewed research under an idea, because the case may be out of date', () => {
    const w = workStateFor({ direction: 'buy', stage: 'deciding' }, 'evidence-since-review', 3)
    expect(w.tier).toBe('idea')
    expect(w.label).toBe('BUY · Deciding')
    // Not "Thin evidence" — what matters is that the thing being decided has
    // unanswered research against it.
    expect(w.secondary).toBe('3 new research')
  })

  it('does not repeat a healthy research state as a footnote', () => {
    expect(workStateFor({ direction: 'buy', stage: 'deciding' }, 'current', 0).secondary).toBeNull()
  })

  it('handles an idea with no direction recorded', () => {
    expect(workStateFor({ stage: 'researching' }, null, 0).label).toBe('Researching')
  })
})

describe('without an idea, research state speaks', () => {
  it('leads with unreviewed evidence and carries its count', () => {
    const w = workStateFor(null, 'evidence-since-review', 4)
    expect(w.tier).toBe('evidence')
    expect(w.label).toBe('New research')
    expect(w.count).toBe(4)
  })

  it('treats a review clock and a price move as the same tier', () => {
    expect(workStateFor(null, 'stale', 0).tier).toBe('review')
    expect(workStateFor(null, 'moved-since-review', 0).tier).toBe('review')
  })

  it('treats a missing or thin case as a gap, below a review', () => {
    for (const s of ['no-thesis', 'incomplete-thesis', 'thin'] as const) {
      expect(workStateFor(null, s, 0).tier).toBe('gap')
    }
    expect(WORK_TIER_RANK.review).toBeGreaterThan(WORK_TIER_RANK.gap)
  })

  it('says nothing at all for a name the scan has never seen', () => {
    const w = workStateFor(null, null, 0)
    expect(w.tier).toBe('clear')
    expect(w.label).toBe('')
  })

  it('names a current case without ranking it', () => {
    const w = workStateFor(null, 'current', 0)
    expect(w.tier).toBe('clear')
    expect(w.label).toBe('Current')
    expect(WORK_TIER_RANK.clear).toBe(0)
  })
})

describe('stage labels', () => {
  it('uses desk words for the stages a live idea can hold', () => {
    expect(stageLabel(FINAL_STAGE)).toBe('Recommendation ready')
    expect(stageLabel('thesis_forming')).toBe('Thesis forming')
  })

  it('falls back to the raw stage rather than hiding one it has not seen', () => {
    // The production enum still carries legacy values; an unmapped one must
    // still read as something rather than vanishing.
    expect(stageLabel('some_future_stage')).toBe('some future stage')
    expect(stageLabel(null)).toBe('Idea')
  })
})
