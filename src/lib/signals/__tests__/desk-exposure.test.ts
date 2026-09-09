/**
 * A name is as material as its strongest claim to be, not as large as it is.
 *
 * ── What this widens ──────────────────────────────────────────────────────
 *
 * The priority model asked one question about how much a card matters: the
 * position's weight in its heaviest book. A desk has three answers and the
 * other two were computed, stored and never read:
 *
 *   SIZE      ten percent of one book is ten percent of one book
 *   BREADTH   one percent held in eight books is the firm's view
 *   ACTIVE    two percent against a five percent index weight is a three point
 *             underweight, and a size band cannot see it at all
 *
 * These tests pin two things: that the widening cannot lower any score, and
 * that a caller who supplies nothing gets exactly what they got before.
 */

import { describe, expect, it } from 'vitest'

import { activeBand, breadthBand, deskMateriality } from '../desk-exposure'
import { materialityBand, priorityFor, type PriorityInput } from '../feed-priority'
import { CRITICAL_ACTIVE_PCT, MIN_ACTIVE_PCT } from '../builders/activeRisk'

describe('breadth: how much of the desk holds it', () => {
  it('is nothing when the book does not hold it', () => {
    expect(breadthBand(0)).toBe(0)
    expect(breadthBand(null)).toBe(0)
    expect(breadthBand(undefined)).toBe(0)
  })

  /**
   * Two is where the product already draws this line: `usePortfolioLenses`
   * will not call a name crowded below two books, because one book holding
   * something is a position and two holding it is a house view.
   */
  it('clears the middle at the count the product calls crowded', () => {
    expect(breadthBand(1)).toBeLessThan(0.5)
    expect(breadthBand(2)).toBeGreaterThan(0.5)
  })

  it('rises with the count and then saturates', () => {
    const counts = [1, 2, 3, 4, 5].map(breadthBand)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
    expect(breadthBand(5)).toBe(1)
    expect(breadthBand(9)).toBe(breadthBand(5))
  })
})

describe('active: how big a bet it is against the index', () => {
  it('is nothing without a benchmark to compare against', () => {
    expect(activeBand(null)).toBe(0)
    expect(activeBand(undefined)).toBe(0)
    expect(activeBand(0)).toBe(0)
  })

  /** The thresholds are `activeRisk`'s own, not new ones. */
  it('uses the levels the product already draws', () => {
    expect(activeBand(MIN_ACTIVE_PCT - 0.1)).toBeLessThan(activeBand(MIN_ACTIVE_PCT))
    expect(activeBand(CRITICAL_ACTIVE_PCT - 0.1)).toBeLessThan(activeBand(CRITICAL_ACTIVE_PCT))
    expect(activeBand(CRITICAL_ACTIVE_PCT)).toBe(1)
  })

  /**
   * An underweight is a decision. A desk holding two percent of a name the
   * index holds at seven has said something as loudly as one holding nine, and
   * a signed band would score the first as nothing.
   */
  it('treats an underweight as loudly as an overweight', () => {
    expect(activeBand(-6)).toBe(activeBand(6))
    expect(activeBand(-2)).toBe(activeBand(2))
  })
})

describe('the composite takes the strongest claim', () => {
  /** No exposure means no change, which is what keeps every caller safe. */
  it('is exactly the size band when nothing else is known', () => {
    for (const w of [null, 0, 0.5, 2, 4, 8, 20]) {
      const size = materialityBand(w, w != null && w > 0)
      expect(deskMateriality(size, null)).toBe(size)
      expect(deskMateriality(size, undefined)).toBe(size)
    }
  })

  it('never lowers the size band', () => {
    const size = materialityBand(12, true)
    expect(deskMateriality(size, { bookCount: 1, activePct: 0 })).toBe(size)
    expect(deskMateriality(size, { bookCount: 5, activePct: 9 })).toBeGreaterThanOrEqual(size)
  })

  /**
   * The case the whole thing exists for. A one percent position is the bottom
   * of the size scale; held across five books and two points from its index it
   * is one of the desk's real bets, and the old model called it noise.
   */
  it('raises a small position that the whole desk holds', () => {
    // Half a percent is the second band from the bottom of the size scale.
    const size = materialityBand(0.5, true)
    const rich = deskMateriality(size, { weightPct: 0.5, bookCount: 5, activePct: 2 })
    expect(size).toBeLessThan(0.3)
    expect(rich).toBe(1)
  })

  it('raises a small position that is a large active bet', () => {
    const size = materialityBand(2, true)
    expect(deskMateriality(size, { weightPct: 2, bookCount: 1, activePct: -6 }))
      .toBeGreaterThan(size)
  })

  /**
   * An index-weight position and an active bet of the same size are no longer
   * the same card, which is the distinction a manager is actually paid on.
   */
  it('separates an index weight from a bet of the same size', () => {
    const size = materialityBand(5, true)
    const passive = deskMateriality(size, { weightPct: 5, benchmarkPct: 5, activePct: 0, bookCount: 1 })
    const bet = deskMateriality(size, { weightPct: 5, benchmarkPct: 0, activePct: 5, bookCount: 1 })
    expect(bet).toBeGreaterThan(passive)
  })
})

describe('through the ranker', () => {
  const input = (over: Partial<PriorityInput> = {}): PriorityInput => ({
    id: 'x',
    type: 'scenario_gap',
    severity: 'attention',
    occurredAt: null,
    weightPct: 1,
    held: true,
    deviationPct: null,
    coverage: 'unknown',
    ...over,
  }) as PriorityInput

  const NOW = Date.parse('2026-09-09T12:00:00.000Z')

  /** Every existing caller passes no exposure and must be unaffected. */
  it('changes nothing for a card with no exposure', () => {
    const before = priorityFor(input(), NOW)
    const after = priorityFor(input({ exposure: null }), NOW)
    expect(after.total).toBe(before.total)
    expect(after.components.materiality).toBe(before.components.materiality)
  })

  it('lifts a thinly-held name the whole desk owns', () => {
    const plain = priorityFor(input(), NOW)
    const broad = priorityFor(input({
      exposure: { weightPct: 1, bookCount: 6, activePct: 1 },
    }), NOW)
    expect(broad.components.materiality).toBeGreaterThan(plain.components.materiality)
    expect(broad.total).toBeGreaterThan(plain.total)
  })

  /** And it cannot move a card across the semantic partition. */
  it('never changes a tier', () => {
    const plain = priorityFor(input(), NOW)
    const broad = priorityFor(input({
      exposure: { weightPct: 1, bookCount: 9, activePct: 20 },
    }), NOW)
    expect(broad.tier).toBe(plain.tier)
  })

  /** Bounded by its own weight, so it cannot swamp the rest of the model. */
  it('moves a total by no more than the materiality weight', () => {
    const plain = priorityFor(input({ weightPct: null, held: false }), NOW)
    const broad = priorityFor(input({
      weightPct: null, held: false,
      exposure: { weightPct: null, bookCount: 9, activePct: 20 },
    }), NOW)
    expect(broad.total - plain.total).toBeLessThanOrEqual(0.22)
  })
})
