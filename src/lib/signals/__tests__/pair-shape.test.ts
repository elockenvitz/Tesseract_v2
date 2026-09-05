import { describe, it, expect } from 'vitest'
import {
  canRepresentPairPerformance, hasPairPriceCoverage, isDeletedLeg, includedLegs, legSide,
  pairIsLive, pairSides, pairWeightingIsDefined, sideLabel, survivingLegs,
} from '../pair-shape'
import { policyForJudgment } from '../judgment-policy'

/**
 * Written against the five pair groups that actually exist in production, and
 * each shape below broke an assumption the obvious implementation makes.
 */

const leg = (over: Partial<Parameters<typeof legSide>[0]> = {}) => ({
  action: 'buy', status: 'idea', outcome: null, symbol: 'AAA', ...over,
} as any)

describe('legSide — pair_leg_type is empty in production', () => {
  it('prefers the declared side when a row ever carries one', () => {
    expect(legSide(leg({ pair_leg_type: 'short', action: 'buy' }))).toBe('short')
    expect(legSide(leg({ pair_leg_type: 'long', action: 'sell' }))).toBe('long')
  })

  it('falls back to the action, which is all production rows have', () => {
    expect(legSide(leg({ action: 'buy' }))).toBe('long')
    expect(legSide(leg({ action: 'add' }))).toBe('long')
    expect(legSide(leg({ action: 'sell' }))).toBe('short')
    expect(legSide(leg({ action: 'trim' }))).toBe('short')
  })

  it('refuses to guess a side it cannot derive', () => {
    expect(legSide(leg({ action: 'hold' }))).toBe('unknown')
    expect(legSide(leg({ action: null }))).toBe('unknown')
    expect(legSide(null)).toBe('unknown')
  })
})

describe('deleted is not terminal', () => {
  it('recognises a deleted leg', () => {
    expect(isDeletedLeg(leg({ status: 'deleted' }))).toBe(true)
    expect(isDeletedLeg(leg({ status: 'idea' }))).toBe(false)
  })

  it('removes deleted legs from the structure entirely', () => {
    const legs = [leg({ status: 'deleted' }), leg({ status: 'idea' })]
    expect(survivingLegs(legs)).toHaveLength(1)
  })

  /**
   * The production case: a ten-leg group with six deletions. Counting a
   * deletion as finished work would make a live pair read as settled.
   */
  it('keeps a pair live when the only terminal-looking legs were deleted', () => {
    const legs = [
      leg({ status: 'deleted' }), leg({ status: 'deleted' }),
      leg({ status: 'deciding', outcome: null }),
    ]
    expect(pairIsLive(legs)).toBe(true)
  })
})

describe('pairIsLive — any surviving live leg keeps the pair open', () => {
  /** `9597…`: two live legs, status 'idea'. */
  it('is live for a simple untouched pair', () => {
    expect(pairIsLive([
      leg({ action: 'buy', status: 'idea' }),
      leg({ action: 'sell', status: 'idea' }),
    ])).toBe(true)
  })

  /** `2e22…`: one leg executed, the rest still being worked. */
  it('is live when one leg is executed and others are not', () => {
    expect(pairIsLive([
      leg({ action: 'sell', status: 'deciding', outcome: 'executed' }),
      leg({ action: 'buy', status: 'deciding', outcome: null }),
    ])).toBe(true)
  })

  /** `95b8…`: both legs executed. */
  it('is terminal once every surviving leg is finished', () => {
    expect(pairIsLive([
      leg({ action: 'buy', status: 'executed', outcome: 'executed' }),
      leg({ action: 'sell', status: 'executed', outcome: 'executed' }),
    ])).toBe(false)
  })

  /** `4d8c…` / `94ec…`: every leg deleted. */
  it('is not a pair at all when nothing survives', () => {
    expect(pairIsLive([leg({ status: 'deleted' }), leg({ status: 'deleted' })])).toBe(false)
    expect(pairIsLive([])).toBe(false)
  })

  it('lets a deleted parent close the pair regardless of its legs', () => {
    const live = [leg({ status: 'idea' })]
    expect(pairIsLive(live)).toBe(true)
    expect(pairIsLive(live, { deleted_at: '2026-01-01T00:00:00Z' })).toBe(false)
  })

  it('lets a terminal parent status close the pair', () => {
    expect(pairIsLive([leg({ status: 'idea' })], { status: 'executed' })).toBe(false)
  })
})

describe('pairSides — the structure the data actually has', () => {
  it('splits a simple one-long one-short pair', () => {
    const s = pairSides([leg({ action: 'buy', symbol: 'MCD' }), leg({ action: 'sell', symbol: 'CMG' })])
    expect(s.long.map(l => l.symbol)).toEqual(['MCD'])
    expect(s.short.map(l => l.symbol)).toEqual(['CMG'])
  })

  /**
   * `2e22…` has LLY and PFE both as `buy`. The user's mental model of
   * one-long-one-short must not be forced onto data that says otherwise.
   */
  it('puts two buys on the same side rather than inventing an opposition', () => {
    const s = pairSides([
      leg({ action: 'buy', symbol: 'LLY' }), leg({ action: 'buy', symbol: 'PFE' }),
      leg({ action: 'sell', symbol: 'GH' }),
    ])
    expect(s.long.map(l => l.symbol)).toEqual(['LLY', 'PFE'])
    expect(s.short.map(l => l.symbol)).toEqual(['GH'])
  })

  it('reports an empty side as empty rather than hiding the pair', () => {
    const s = pairSides([leg({ action: 'buy', symbol: 'MCD' })])
    expect(s.long).toHaveLength(1)
    expect(s.short).toHaveLength(0)
  })

  it('counts deletions without placing them on a side', () => {
    const s = pairSides([leg({ status: 'deleted', action: 'buy' }), leg({ action: 'sell' })])
    expect(s.deletedCount).toBe(1)
    expect(s.long).toHaveLength(0)
  })
})

describe('sideLabel — compact enough for a ten-leg pair', () => {
  it('lists a short side in full', () => {
    expect(sideLabel([leg({ symbol: 'LLY' }), leg({ symbol: 'PFE' })], 3)).toBe('LLY · PFE')
  })

  it('counts the overflow rather than truncating silently', () => {
    const legs = ['LLY', 'PFE', 'NVO', 'MRK', 'ABBV'].map(s => leg({ symbol: s }))
    expect(sideLabel(legs, 2)).toBe('LLY · PFE · +3')
  })

  it('is empty for an empty side', () => {
    expect(sideLabel([], 2)).toBe('')
  })
})

describe('coverage is not representability', () => {
  const closes = (m: Record<string, number>) => (s: string) => m[s] ?? 0
  const oneByOne = [leg({ action: 'buy', symbol: 'MCD' }), leg({ action: 'sell', symbol: 'CMG' })]
  const basket = [
    leg({ action: 'buy', symbol: 'LLY' }), leg({ action: 'buy', symbol: 'PFE' }),
    leg({ action: 'sell', symbol: 'GH' }), leg({ action: 'sell', symbol: 'CLOV' }),
  ]

  describe('hasPairPriceCoverage — data for the WHOLE expression', () => {
    it('accepts a 1x1 pair with both legs cached', () => {
      expect(hasPairPriceCoverage(oneByOne, closes({ MCD: 260, CMG: 260 }))).toBe(true)
    })

    it('refuses when either side is uncovered', () => {
      expect(hasPairPriceCoverage(oneByOne, closes({ MCD: 260 }))).toBe(false)
      expect(hasPairPriceCoverage(oneByOne, closes({ CMG: 260 }))).toBe(false)
    })

    /**
     * The correction. `some()` per side let LLY-vs-GH stand in for a four-name
     * expression — a real chart of a different, smaller trade.
     */
    it('refuses a basket covered on only one leg per side', () => {
      expect(hasPairPriceCoverage(basket, closes({ LLY: 260, GH: 260 }))).toBe(false)
    })

    it('accepts a basket only when every included leg is covered', () => {
      expect(hasPairPriceCoverage(basket, closes({ LLY: 260, PFE: 260, GH: 260, CLOV: 260 }))).toBe(true)
    })

    it('refuses a one-sided group, which has no relationship to chart', () => {
      expect(hasPairPriceCoverage([leg({ action: 'buy', symbol: 'MCD' })], closes({ MCD: 260 }))).toBe(false)
    })

    it('ignores deleted legs when judging coverage', () => {
      const legs = [
        leg({ action: 'buy', symbol: 'MCD' }),
        leg({ action: 'sell', symbol: 'CMG' }),
        leg({ action: 'sell', symbol: 'ZZZZ', status: 'deleted' }),
      ]
      expect(hasPairPriceCoverage(legs, closes({ MCD: 260, CMG: 260 }))).toBe(true)
    })

    /**
     * A terminal leg is still part of the recorded pair — production's CLOV leg
     * is executed and was never deleted. Its history is needed to represent
     * the trade that was actually put on.
     */
    it('still requires coverage for an executed but undeleted leg', () => {
      const legs = [
        leg({ action: 'buy', symbol: 'MCD' }),
        leg({ action: 'sell', symbol: 'CMG' }),
        leg({ action: 'sell', symbol: 'CLOV', outcome: 'executed' }),
      ]
      expect(hasPairPriceCoverage(legs, closes({ MCD: 260, CMG: 260 }))).toBe(false)
      expect(hasPairPriceCoverage(legs, closes({ MCD: 260, CMG: 260, CLOV: 260 }))).toBe(true)
    })
  })

  describe('pairWeightingIsDefined — a basket needs real sizes', () => {
    it('needs no weights for one against one', () => {
      expect(pairWeightingIsDefined(oneByOne)).toBe(true)
    })

    /** Every pair leg in production has null weight and null shares. */
    it('refuses a basket with no stored allocation', () => {
      expect(pairWeightingIsDefined(basket)).toBe(false)
    })

    it('does not silently assume equal weighting', () => {
      const partial = [
        leg({ action: 'buy', symbol: 'LLY', proposed_weight: 2 }),
        leg({ action: 'buy', symbol: 'PFE' }),
        leg({ action: 'sell', symbol: 'GH', proposed_weight: 2 }),
      ]
      expect(pairWeightingIsDefined(partial)).toBe(false)
    })

    it('accepts a basket once every leg carries a real size', () => {
      const weighted = basket.map(l => ({ ...l, proposed_weight: 1.5 }))
      expect(pairWeightingIsDefined(weighted)).toBe(true)
    })

    it('accepts shares as a size too', () => {
      const weighted = basket.map(l => ({ ...l, proposed_shares: 100 }))
      expect(pairWeightingIsDefined(weighted)).toBe(true)
    })
  })

  describe('canRepresentPairPerformance — both must hold', () => {
    it('qualifies a fully covered 1x1 pair', () => {
      expect(canRepresentPairPerformance(oneByOne, closes({ MCD: 260, CMG: 260 }))).toBe(true)
    })

    it('fails a 1x1 pair missing a leg', () => {
      expect(canRepresentPairPerformance(oneByOne, closes({ MCD: 260 }))).toBe(false)
    })

    it('fails a basket on coverage', () => {
      expect(canRepresentPairPerformance(basket, closes({ LLY: 260, GH: 260 }))).toBe(false)
    })

    /** Covered everywhere and still not representable: no allocation exists. */
    it('fails a fully covered basket on weighting alone', () => {
      const all = closes({ LLY: 260, PFE: 260, GH: 260, CLOV: 260 })
      expect(hasPairPriceCoverage(basket, all)).toBe(true)
      expect(canRepresentPairPerformance(basket, all)).toBe(false)
    })

    it('qualifies a fully covered, fully weighted basket', () => {
      const weighted = basket.map(l => ({ ...l, proposed_weight: 1 }))
      expect(canRepresentPairPerformance(weighted, closes({ LLY: 260, PFE: 260, GH: 260, CLOV: 260 }))).toBe(true)
    })
  })

  /** Every live pair in production, as it stands today. */
  describe('the real population', () => {
    const prod = closes({ LLY: 260, PFE: 260, MCD: 260, NKE: 260 })
    it('fails MCD/CMG — the short side is uncached', () => {
      expect(canRepresentPairPerformance(oneByOne, prod)).toBe(false)
    })
    it('fails the LLY/PFE vs GH/CLOV basket on both counts', () => {
      expect(hasPairPriceCoverage(basket, prod)).toBe(false)
      expect(pairWeightingIsDefined(basket)).toBe(false)
    })
  })
})

describe('includedLegs — deletions out, finished work in', () => {
  it('drops deleted legs', () => {
    expect(includedLegs([leg({ status: 'deleted' }), leg({ status: 'idea' })])).toHaveLength(1)
  })

  it('keeps an executed leg that is still part of the recorded pair', () => {
    expect(includedLegs([leg({ status: 'deciding', outcome: 'executed' })])).toHaveLength(1)
  })
})

describe('pair judgment keys are classified', () => {
  /**
   * They were not. `back_pair` and its siblings fell to `unknown`, so
   * answering a pair bought no quiet and the card returned unchanged.
   */
  it('gives every pair answer a real policy', () => {
    for (const key of ['pair_back', 'pair_sizing', 'pair_one_leg', 'pair_no']) {
      expect(policyForJudgment(key).category).not.toBe('unknown')
      expect(policyForJudgment(key).quietDays).toBeGreaterThan(0)
    }
  })

  it('gives every single-name answer a real policy too', () => {
    for (const key of ['idea_back', 'idea_pass', 'idea_needs_work', 'idea_discuss']) {
      expect(policyForJudgment(key).category).not.toBe('unknown')
    }
  })
})
