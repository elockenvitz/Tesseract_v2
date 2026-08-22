import { describe, expect, it } from 'vitest'

/**
 * Which case counts as a target REACHED.
 *
 * Extracted here as the rule rather than the query, because the query needs a
 * database and the rule is what was wrong. The lens compared the price against
 * whichever single row ranked first — official, then most recent — which on a
 * name with a ladder is routinely the BEAR case. Reported on AMZN: "it says
 * the target is reached, based on the bear case."
 *
 * A price above the bear case is not an achievement. It is the downside not
 * happening.
 */

interface Case { id: string; name: string; price: number }

/** The rule under test, mirroring `usePortfolioLenses`. */
function reachedCase(cases: Case[], price: number): Case | null {
  const ladder = [...cases].sort((a, b) => a.price - b.price)
  // The lowest case is the floor, not a goal — see the header.
  const reachable = ladder.length > 1 ? ladder.slice(1) : ladder
  const passed = reachable.filter(c => price >= c.price)
  return passed.length ? passed[passed.length - 1] : null
}

const LADDER: Case[] = [
  { id: 'bear', name: 'Bear', price: 140 },
  { id: 'base', name: 'Base', price: 210 },
  { id: 'bull', name: 'Bull', price: 300 },
]

describe('passing the bear case is not a target reached', () => {
  it('fires nothing when the price is only above the bear case', () => {
    // The AMZN report. $180 is above bear and below base: the downside has not
    // happened and the thesis has not played out. There is no event here.
    expect(reachedCase(LADDER, 180)).toBeNull()
  })

  it('fires nothing when the price is below every case', () => {
    expect(reachedCase(LADDER, 100)).toBeNull()
  })

  it('reports the base case once the price passes it', () => {
    expect(reachedCase(LADDER, 215)?.name).toBe('Base')
  })
})

describe('the highest case passed is the headline', () => {
  it('reports bull rather than base when the price is through both', () => {
    /**
     * A price through the bull case has also passed the base, and reporting
     * the base would understate what happened.
     */
    expect(reachedCase(LADDER, 320)?.name).toBe('Bull')
  })

  it('reports the exact boundary as reached', () => {
    expect(reachedCase(LADDER, 210)?.name).toBe('Base')
    expect(reachedCase(LADDER, 300)?.name).toBe('Bull')
  })
})

describe('ladders that are not three cases', () => {
  it('uses a single case, because there is no floor to exclude', () => {
    // Nothing to reason about: one number is the target.
    expect(reachedCase([{ id: 'a', name: 'Target', price: 100 }], 120)?.name).toBe('Target')
    expect(reachedCase([{ id: 'a', name: 'Target', price: 100 }], 90)).toBeNull()
  })

  it('excludes the lower of two', () => {
    const two = [{ id: 'a', name: 'Bear', price: 100 }, { id: 'b', name: 'Base', price: 200 }]
    expect(reachedCase(two, 150)).toBeNull()
    expect(reachedCase(two, 210)?.name).toBe('Base')
  })

  it('handles an empty ladder without inventing an event', () => {
    expect(reachedCase([], 150)).toBeNull()
  })

  it('does not depend on the order the rows arrived in', () => {
    // The query orders by official then recency, which has nothing to do with
    // price — relying on it is how the bear case became "the" target.
    const shuffled = [LADDER[2], LADDER[0], LADDER[1]]
    expect(reachedCase(shuffled, 320)?.name).toBe('Bull')
  })

  it('copes with an unconventionally named ladder', () => {
    // "Uber Bull" exists in production. The rule is about ORDER, not names.
    const four = [...LADDER, { id: 'ub', name: 'Uber Bull', price: 400 }]
    expect(reachedCase(four, 420)?.name).toBe('Uber Bull')
    expect(reachedCase(four, 180)).toBeNull()
  })
})
