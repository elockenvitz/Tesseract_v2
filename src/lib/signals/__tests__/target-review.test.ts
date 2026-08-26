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
    expect(choiceFor('target_still_valid')!.cta).toBe('Refresh view')
    expect(choiceFor('target_needs_review')!.cta).toBe('Add review note')
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
  it('anchors the horizon on the last restatement, not the row creation', () => {
    // The bug: `created_at` never changes, so a revised target stayed exactly
    // as overdue as before and the card came back saying the same thing.
    expect(statedAtOf('2025-02-14T00:00:00.000Z', '2026-08-24T00:00:00.000Z'))
      .toBe('2026-08-24T00:00:00.000Z')
  })

  it('falls back to creation for a row that has never been updated', () => {
    expect(statedAtOf('2025-02-14T00:00:00.000Z', null)).toBe('2025-02-14T00:00:00.000Z')
  })

  it('ignores an updated_at that predates the row', () => {
    // Backfills and imports produce these, and a horizon anchored before the
    // target existed would make a fresh view look ancient.
    expect(statedAtOf('2026-08-24T00:00:00.000Z', '2025-01-01T00:00:00.000Z'))
      .toBe('2026-08-24T00:00:00.000Z')
  })

  it('is null when neither parses, rather than standing in a zero', () => {
    expect(statedAtOf(null, null)).toBeNull()
    expect(statedAtOf('not a date', undefined)).toBeNull()
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
