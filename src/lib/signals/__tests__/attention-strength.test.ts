/**
 * Eighteen overdue projects should get eighteen places, not one and a hash.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 *
 * `rankFeed` scores a workflow card almost entirely from a per-type constant:
 * `weightPct` and `deviationPct` are null for one, so the two next-largest
 * components of the model are inert, and severity moves a total by at most
 * 0.119 and can never change a tier.
 *
 * Measured before this: eight overdue projects, one a day late and one
 * forty-six days late, scoring exactly 0.576 — the same number to three places.
 * `compareRanked` then fell through tier, total and `occurredAt` to its last
 * resort, which for an attention row is a truncated SHA-256 digest. The reader
 * met them in hash order.
 *
 * The fix reads the score `useAttention` has computed all along. These tests
 * are about the two properties that makes it worth doing — the order inside a
 * family becomes real, and the type table is not inverted to get it.
 */

import { describe, expect, it } from 'vitest'

import { attentionBase, attentionMagnitude, type ScoreTerm } from '../attention-strength'
import { baseFor } from '../feed-priority'

/** A breakdown as `calculateScore` emits one. */
const terms = (severity: number, overdue = 0, extra: ScoreTerm[] = []): ScoreTerm[] => [
  { key: 'severity', value: severity },
  ...(overdue ? [{ key: 'overdue', value: overdue }] : []),
  ...extra,
]

describe('the severity term comes out before anything is normalised', () => {
  /**
   * `rankFeed` applies severity itself through the urgency component. Leaving
   * it inside the number that feeds `base` would count one fact twice, and
   * would make a critical card's advantage depend on which of two unrelated
   * constants happened to be larger.
   */
  it('subtracts the severity term', () => {
    expect(attentionMagnitude(60, terms(20, 40))).toBe(40)
    expect(attentionMagnitude(50, terms(10, 40))).toBe(40)
  })

  /** Two cards differing ONLY in severity have the same magnitude. */
  it('leaves two cards of equal magnitude equal', () => {
    const critical = attentionMagnitude(20 + 75, terms(20, 75))
    const low = attentionMagnitude(10 + 75, terms(10, 75))
    expect(critical).toBe(low)
  })

  /**
   * A row from somewhere this code does not know about keeps its magnitude.
   * Counting severity twice is a smaller error than discarding lateness.
   */
  it('falls back to the whole score with no breakdown', () => {
    expect(attentionMagnitude(85, null)).toBe(85)
    expect(attentionMagnitude(85, [])).toBe(85)
  })

  it('is never negative', () => {
    expect(attentionMagnitude(5, terms(20))).toBe(0)
    expect(attentionMagnitude(null, null)).toBe(0)
    expect(attentionMagnitude(Number.NaN, null)).toBe(0)
  })
})

describe('the base lifts the type floor and never inverts it', () => {
  /** Nothing to say means say nothing, and the table is read as it always was. */
  it('returns null when there is no magnitude', () => {
    expect(attentionBase('project_overdue', 0, null)).toBeNull()
    expect(attentionBase('project_overdue', 20, terms(20))).toBeNull()
    expect(attentionBase('project_overdue', null, null)).toBeNull()
  })

  it('starts at the type floor and rises with the score', () => {
    const floor = baseFor('project_overdue')
    const light = attentionBase('project_overdue', 30 + 10, terms(10, 30))!
    const heavy = attentionBase('project_overdue', 140 + 10, terms(10, 140))!
    expect(light).toBeGreaterThan(floor)
    expect(heavy).toBeGreaterThan(light)
    // Two weeks late is the half-strength point, so exactly half the lift.
    expect(heavy).toBeCloseTo(floor + 0.05, 6)
  })

  /**
   * The overdue term is ten points a day and has no ceiling, so the curve has
   * to compress hard — but it must never FLATTEN.
   *
   * Flattening at the severe threshold was the first attempt and it put every
   * item past two weeks late back on the same number, which is where the hash
   * tie-break lives and where the reader most needs an order. Three months late
   * still edges one month late, just barely, and that is the point.
   */
  it('compresses without ever repeating itself', () => {
    const twoWeeks = attentionBase('project_overdue', 140 + 10, terms(10, 140))!
    const oneMonth = attentionBase('project_overdue', 300 + 10, terms(10, 300))!
    const threeMonths = attentionBase('project_overdue', 1000 + 10, terms(10, 1000))!
    expect(oneMonth).toBeGreaterThan(twoWeeks)
    expect(threeMonths).toBeGreaterThan(oneMonth)

    // And an equal step buys less the further out it starts, which is what
    // "compresses" means. Compared over the same 160 points at two places on
    // the curve, rather than over two intervals of different width.
    const at = (m: number) => attentionBase('project_overdue', m + 10, terms(10, m))!
    expect(at(460) - at(300)).toBeLessThan(at(300) - at(140))
  })

  /**
   * The bound that matters. A maximally overdue project is the loudest
   * workflow card there is and is still not a decision: it may reach the level
   * of `research_stale` in the review tier and must stay well below
   * `recommendation`.
   */
  it('never lifts a workflow card to a decision', () => {
    const loudest = attentionBase('project_overdue', 5000, terms(20, 4980))!
    expect(loudest).toBeLessThanOrEqual(baseFor('research_stale'))
    expect(loudest).toBeLessThan(baseFor('recommendation'))
    expect(loudest).toBeLessThan(baseFor('scenario_gap'))
  })

  /** Eighteen distinct lateness values produce eighteen distinct places. */
  it('orders a family that used to tie', () => {
    const days = Array.from({ length: 18 }, (_, i) => i + 1)
    const bases = days.map(d =>
      attentionBase('project_overdue', 10 * d + 20, terms(20, 10 * d))!)
    expect(new Set(bases).size).toBe(18)
    expect(bases).toEqual([...bases].sort((a, b) => a - b))
  })

  /** And it is monotone rather than banded, so nothing ties by construction. */
  it('is monotone in the magnitude', () => {
    const a = attentionBase('awaiting_review', 41, terms(10, 31))!
    const b = attentionBase('awaiting_review', 42, terms(10, 32))!
    expect(b).toBeGreaterThan(a)
  })
})
