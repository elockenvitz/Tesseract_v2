import { describe, it, expect } from 'vitest'

import {
  TARGET_REVIEW_CHOICES, choiceFor, resolvesExpiry, targetReviewOptions,
} from '../target-review'
import { attributiveHorizon, statedAtOf } from '../horizon-copy'
import { consequenceOf } from '../dispositions'
import { isDisposedOf, recordDisposition, loadDispositions, DISPOSITION_DAYS } from '../dispositions'

describe('the four review paths', () => {
  const options = targetReviewOptions('GOOGL')

  it('offers exactly the four resolutions, and keeps their recorded keys', () => {
    expect(options.map(o => o.key)).toEqual([
      'target_still_valid',
      'target_revise',
      'target_replace_with_cases',
      'target_needs_review',
    ])
  })

  it('gives every choice its own explanatory copy', () => {
    const copy = options.map(o => o.consequence)
    expect(copy.every(Boolean)).toBe(true)
    expect(new Set(copy).size).toBe(4)
  })

  it('gives every choice its own CTA, and none of them says "Write it down"', () => {
    const ctas = options.map(o => o.commitLabel)
    expect(new Set(ctas).size).toBe(4)
    expect(ctas).not.toContain('Write it down')
    // Each CTA says exactly what the flow behind it does.
    expect(choiceFor('target_still_valid')!.cta).toBe('Refresh horizon')
    expect(choiceFor('target_revise')!.cta).toBe('Revise target')
    // "Review", not "Build": every name with an expired target already has a
    // Bull / Base / Bear ladder, so promising to create one is a lie.
    expect(choiceFor('target_replace_with_cases')!.cta).toBe('Review cases')
    expect(choiceFor('target_needs_review')!.cta).toBe('Keep open')
  })

  it('does not fall back to the generic disposition sentence', () => {
    // Three of the four are `flagged`, so without per-option copy they all
    // showed "Keeps it in your feed and opens a note so the work is written
    // down" — one sentence describing three different acts.
    for (const o of options) {
      expect(o.consequence).not.toBe(consequenceOf(o.disposition))
    }
  })

  it('routes each choice to the surface that resolves it', () => {
    expect(TARGET_REVIEW_CHOICES.map(c => c.surface)).toEqual([
      'refresh_horizon', 'revise_target', 'cases', 'note',
    ])
  })

  it('sends "Replace with cases" to the existing scenario editor', () => {
    const cases = options.find(o => o.key === 'target_replace_with_cases')!
    expect(choiceFor(cases.key)!.surface).toBe('cases')
    expect(cases.nextAction?.id).toBe('open_cases')
  })
})

describe('what each answer does to the feed', () => {
  it('keeps the signal for "Needs review", and records the answer', () => {
    const o = targetReviewOptions('GOOGL').find(x => x.key === 'target_needs_review')!
    expect(o.disposition).toBe('flagged')

    localStorage.clear()
    recordDisposition('u1', 'target_expired', 'goog', {
      kind: o.disposition, key: o.key, label: o.label,
      question: 'Is this target still your view?', cardType: 'target_expired',
      until: Date.now() + DISPOSITION_DAYS.flagged * 86_400_000,
    })
    const map = loadDispositions('u1')
    // Flagged is never suppressed — the reader said it needs work, and hiding
    // it at that moment removes the reminder they just asked for.
    expect(isDisposedOf(map, 'target_expired', 'goog')).toBe(false)
    expect(map['target_expired:goog'].key).toBe('target_needs_review')
  })

  it('settles only "Still valid"', () => {
    const settled = targetReviewOptions('GOOGL').filter(o => o.disposition === 'settled')
    expect(settled.map(o => o.key)).toEqual(['target_still_valid'])
  })
})

describe('resolvesExpiry', () => {
  it('refuses a revision with no horizon', () => {
    // The signal fires on an elapsed clock and on nothing else, so a new number
    // under a dead horizon leaves the trigger exactly where it was.
    expect(resolvesExpiry({ horizon: null })).toBe(false)
    expect(resolvesExpiry({ horizon: '' })).toBe(false)
  })

  it('refuses a revision that reuses the horizon that already expired', () => {
    expect(resolvesExpiry({ horizon: '6 months', horizonUnchanged: true })).toBe(false)
  })

  it('accepts a fresh horizon', () => {
    expect(resolvesExpiry({ horizon: '12 months' })).toBe(true)
  })
})

describe('statedAtOf', () => {
  /**
   * Anchored on `created_at`, which the revision path re-stamps.
   *
   * This briefly anchored on `updated_at` instead, on the reading that every
   * publish path writes it. The reading was right about the CODE and wrong
   * about the DATA: measured against production, 27 of 30 target rows carry a
   * bumped `updated_at` and the oldest in the table is four months old, so
   * nothing with a twelve-month horizon could ever look overdue. Five live
   * cards went to zero.
   */
  it('measures the horizon from created_at', () => {
    expect(statedAtOf('2025-02-14T00:00:00.000Z')).toBe('2025-02-14T00:00:00.000Z')
  })

  it('does not let a bumped updated_at make an old target look fresh', () => {
    // The regression, as an assertion. A backfilled `updated_at` must not
    // shorten the apparent age of a view nobody has restated.
    expect(statedAtOf('2025-02-14T00:00:00.000Z', '2026-08-24T00:00:00.000Z'))
      .toBe('2025-02-14T00:00:00.000Z')
  })

  it('is null when created_at is missing or unparseable, rather than zero', () => {
    expect(statedAtOf(null)).toBeNull()
    expect(statedAtOf('not a date')).toBeNull()
    expect(statedAtOf(undefined, '2026-08-24T00:00:00.000Z')).toBeNull()
  })
})

describe('a target stays overdue until it is restated', () => {
  const MONTH = 30.44 * 86_400_000
  const NOW = new Date('2026-08-25T00:00:00.000Z').getTime()
  /** The lens predicate, as `usePortfolioLenses` computes it. */
  const overdueMonths = (statedAt: string, horizonMonths: number) =>
    (NOW - new Date(statedAt).getTime()) / MONTH - horizonMonths

  it('is overdue on a 12-month view stated 18 months ago', () => {
    const stated = statedAtOf(new Date(NOW - 18 * MONTH).toISOString())!
    expect(overdueMonths(stated, 12)).toBeGreaterThanOrEqual(2)
  })

  it('stays overdue when only updated_at has moved', () => {
    // Exactly the production shape: an old view whose row was touched recently.
    const stated = statedAtOf(
      new Date(NOW - 18 * MONTH).toISOString(),
      new Date(NOW - 1 * MONTH).toISOString(),
    )!
    expect(overdueMonths(stated, 12)).toBeGreaterThanOrEqual(2)
  })

  it('clears once the revision re-stamps created_at with a fresh horizon', () => {
    // What `saveAnalystTarget` writes when the reader completes the editor.
    const stated = statedAtOf(new Date(NOW).toISOString())!
    expect(overdueMonths(stated, 12)).toBeLessThan(2)
  })
})

describe('attributiveHorizon', () => {
  it('hyphenates a stored horizon used as an adjective', () => {
    expect(attributiveHorizon('6 months')).toBe('6-month')
    expect(attributiveHorizon('12 months')).toBe('12-month')
    expect(attributiveHorizon('2 years')).toBe('2-year')
  })

  it('leaves anything that is not a plural unit alone', () => {
    expect(attributiveHorizon('H1 2027')).toBe('H1 2027')
    expect(attributiveHorizon('rolling')).toBe('rolling')
  })
})
