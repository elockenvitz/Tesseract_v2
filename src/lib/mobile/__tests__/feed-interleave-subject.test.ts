import { describe, it, expect } from 'vitest'
import { interleaveByKind } from '../feed-interleave'

/**
 * The repetition these guard against is not "too many news tiles" — maxRun
 * already handled that. It is one *name* arriving as three different kinds on
 * three consecutive screens, which reads as repetition however well the kinds
 * were mixed and which nothing checked before.
 */
const entry = (kind: string, subject: string | null, score: number) =>
  ({ kind, subject, score, id: `${kind}:${subject}:${score}` })

describe('interleaveByKind subject cooldown', () => {
  it('does not put the same subject on consecutive screens while alternatives exist', () => {
    // NVDA as the top-scoring entry of three different kinds — the exact shape
    // of the bug — with enough other names that the cooldown never has to
    // yield.
    const out = interleaveByKind([
      entry('news', 'NVDA', 10),
      entry('lens', 'NVDA', 9),
      entry('template', 'NVDA', 8),
      entry('news', 'AAPL', 7), entry('news', 'META', 6),
      entry('lens', 'MSFT', 5), entry('lens', 'AMZN', 4),
      entry('template', 'TSLA', 3), entry('template', 'GOOG', 2),
    ], { maxRun: 1, subjectCooldown: 3 })

    for (let i = 1; i < out.length; i++) {
      expect(out[i].subject).not.toBe(out[i - 1].subject)
    }
  })

  it('yields rather than stalling once only one subject is left', () => {
    // The tail of a feed can legitimately repeat: three NVDA entries and
    // nothing else remaining has no non-repeating arrangement. Documented
    // because the alternative — dropping them — silently shortens the feed,
    // and because an over-strict reading of the rule above would call this a
    // bug when it is the designed fallback.
    const out = interleaveByKind([
      entry('news', 'NVDA', 10), entry('lens', 'NVDA', 9), entry('template', 'NVDA', 8),
      entry('news', 'AAPL', 7),
    ], { maxRun: 1, subjectCooldown: 3 })
    expect(out).toHaveLength(4)
    expect(out.filter(e => e.subject === 'NVDA')).toHaveLength(3)
  })

  it('keeps a subject apart by the cooldown window where it can', () => {
    const out = interleaveByKind([
      entry('news', 'NVDA', 10), entry('lens', 'NVDA', 9),
      entry('news', 'AAPL', 8), entry('lens', 'MSFT', 7),
      entry('news', 'TSLA', 6), entry('lens', 'AMZN', 5),
    ], { maxRun: 1, subjectCooldown: 3 })

    const positions = out
      .map((e, i) => ({ s: e.subject, i }))
      .filter(x => x.s === 'NVDA')
      .map(x => x.i)
    if (positions.length === 2) expect(positions[1] - positions[0]).toBeGreaterThan(1)
  })

  it('emits everything even when every entry shares one subject', () => {
    // The cooldown is a preference, not a filter. Dropping entries to honour
    // it would silently shorten the feed, which is worse than repeating.
    const out = interleaveByKind([
      entry('news', 'NVDA', 3), entry('lens', 'NVDA', 2), entry('template', 'NVDA', 1),
    ], { maxRun: 1, subjectCooldown: 6 })
    expect(out).toHaveLength(3)
  })

  it('never holds back entries that have no subject', () => {
    // Macro releases and unattributed stories carry no subject and must not be
    // treated as all sharing one.
    const out = interleaveByKind([
      entry('template', null, 5), entry('template', null, 4), entry('news', null, 3),
    ], { maxRun: 2, subjectCooldown: 6 })
    expect(out).toHaveLength(3)
  })

  it('still respects maxRun', () => {
    const out = interleaveByKind([
      entry('news', 'A', 5), entry('news', 'B', 4),
      entry('lens', 'C', 3), entry('lens', 'D', 2),
    ], { maxRun: 1, subjectCooldown: 6 })
    for (let i = 1; i < out.length; i++) {
      expect(out[i].kind).not.toBe(out[i - 1].kind)
    }
  })
})
