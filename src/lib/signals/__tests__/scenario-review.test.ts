import { describe, it, expect } from 'vitest'

import {
  SCENARIO_REVIEW_CHOICES,
  scenarioReviewOptions,
  SCENARIO_NOTE_MAX,
} from '../scenario-review'
import { policyForJudgment } from '../judgment-policy'

/**
 * The UI flow was replaced; the vocabulary was not.
 *
 * `scenario_thesis_intact`, `scenario_thesis_weaker`, `scenario_cases_outdated`
 * and `scenario_needs_review` are already written against real judgments in
 * `audit_events`, are classified in `judgment-policy` with distinct quiet
 * windows, and are what any downstream analysis reads. Copy is copy; a semantic
 * key that stops being comparable to last quarter's is a record of nothing.
 *
 * These are the guard on that promise. If a rewording ever changes a key or a
 * disposition, this fails rather than silently orphaning every answer anyone
 * has given.
 */

describe('the four keys, unchanged', () => {
  it('are exactly the four the feed has been writing', () => {
    expect(SCENARIO_REVIEW_CHOICES.map(c => c.key)).toEqual([
      'scenario_thesis_intact',
      'scenario_thesis_weaker',
      'scenario_cases_outdated',
      'scenario_needs_review',
    ])
  })

  it('keep the dispositions the suppression window is computed from', () => {
    expect(Object.fromEntries(SCENARIO_REVIEW_CHOICES.map(c => [c.key, c.disposition])))
      .toEqual({
        scenario_thesis_intact: 'settled',
        scenario_thesis_weaker: 'flagged',
        scenario_cases_outdated: 'flagged',
        scenario_needs_review: 'flagged',
      })
  })

  /**
   * The disposition is a feed mechanism; the KEY carries the meaning, and the
   * policy is where that meaning is written down. Three answers share
   * `flagged` and mean three different things about the position.
   */
  it('are each classified, with the quiet window the answer earns', () => {
    const policy = Object.fromEntries(
      SCENARIO_REVIEW_CHOICES.map(c => [c.key, policyForJudgment(c.key)]),
    )
    expect(policy.scenario_thesis_intact).toMatchObject({ category: 'confirmed', quietDays: 30 })
    expect(policy.scenario_thesis_weaker).toMatchObject({ category: 'action_needed', quietDays: 7 })
    expect(policy.scenario_cases_outdated).toMatchObject({ category: 'action_needed', quietDays: 7 })
    expect(policy.scenario_needs_review).toMatchObject({ category: 'needs_review', quietDays: 3 })
    // None of them closes the issue. The price is still outside the ladder.
    for (const p of Object.values(policy)) expect(p.resolves).toBe(false)
    // And none is a complaint about the feed.
    for (const p of Object.values(policy)) expect(p.category).not.toBe('not_applicable')
  })

  it('never classifies a scenario answer as unknown', () => {
    // `unknown` is what a key this module has never been taught falls to. A new
    // answer added without deciding what it means must fail here rather than
    // degrade quietly into a neutral quiet window.
    for (const c of SCENARIO_REVIEW_CHOICES) {
      expect(policyForJudgment(c.key).category, c.key).not.toBe('unknown')
    }
  })
})

describe('the copy each answer carries', () => {
  it('gives every answer its own consequence and its own note prompt', () => {
    const consequences = SCENARIO_REVIEW_CHOICES.map(c => c.consequence)
    const placeholders = SCENARIO_REVIEW_CHOICES.map(c => c.notePlaceholder)
    // Distinct, because one sentence for all four tells the reader nothing
    // about the one they are about to press.
    expect(new Set(consequences).size).toBe(4)
    expect(new Set(placeholders).size).toBe(4)
    for (const c of SCENARIO_REVIEW_CHOICES) {
      expect(c.consequence.length, c.key).toBeGreaterThan(10)
      expect(c.notePlaceholder.length, c.key).toBeGreaterThan(5)
    }
  })

  it('writes the recorded note in the first person, about the subject', () => {
    for (const o of scenarioReviewOptions('AMZN')) {
      expect(o.note, o.key).toContain('AMZN')
      expect(o.note, o.key).not.toContain('{sym}')
    }
  })
})

describe('the adapter into the existing write path', () => {
  /**
   * `applyVerdict` consumes a `VerdictOption`, and knows nothing about which
   * control collected it. Keeping the adapter honest is what stops replacing
   * the UI from becoming a second way of persisting a judgment.
   */
  it('carries key, label, disposition and note through unchanged', () => {
    const options = scenarioReviewOptions('TSLA')
    expect(options).toHaveLength(SCENARIO_REVIEW_CHOICES.length)
    options.forEach((o, i) => {
      const c = SCENARIO_REVIEW_CHOICES[i]
      expect(o.key).toBe(c.key)
      expect(o.label).toBe(c.label)
      expect(o.disposition).toBe(c.disposition)
      expect(o.tone).toBe(c.tone)
      expect(o.consequence).toBe(c.consequence)
    })
  })

  it('never marks a scenario answer as feed feedback', () => {
    // `intent: 'feed_quality'` suppresses the quick thought and blocks the
    // follow-on CTA. Every answer here is a claim about the INVESTMENT.
    for (const o of scenarioReviewOptions('NVDA')) {
      expect(o.intent ?? 'judgment').toBe('judgment')
    }
  })

  it('offers the case editor as the follow-on for the three that need work', () => {
    const byKey = Object.fromEntries(scenarioReviewOptions('NVDA').map(o => [o.key, o]))
    expect(byKey.scenario_thesis_intact.nextAction).toBeUndefined()
    for (const k of ['scenario_thesis_weaker', 'scenario_cases_outdated', 'scenario_needs_review']) {
      expect(byKey[k].nextAction, k).toEqual({ id: 'open_cases', label: 'Review cases' })
    }
  })
})

describe('the note limit', () => {
  it('matches the capture surfaces the note ends up in', () => {
    // `writeJudgmentThought` records it as a quick thought under the generated
    // sentence, and the capture modals cap at 300. A limit the field enforces
    // and the destination does not is a limit that shows up as a truncated
    // record rather than as a full field.
    expect(SCENARIO_NOTE_MAX).toBe(300)
  })
})
