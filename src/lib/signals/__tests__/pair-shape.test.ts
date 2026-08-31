import { describe, it, expect } from 'vitest'
import {
  hasDefensiblePairHistory, isDeletedLeg, legSide, pairIsLive, pairSides,
  sideLabel, survivingLegs,
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

describe('hasDefensiblePairHistory — the deferred chart’s gate', () => {
  const closes = (m: Record<string, number>) => (s: string) => m[s] ?? 0

  it('requires cached history on BOTH sides', () => {
    const legs = [leg({ action: 'buy', symbol: 'MCD' }), leg({ action: 'sell', symbol: 'CMG' })]
    expect(hasDefensiblePairHistory(legs, closes({ MCD: 260, CMG: 260 }))).toBe(true)
  })

  /** Every live production pair fails here, which is why the chart is deferred. */
  it('refuses when only the long side is covered', () => {
    const legs = [leg({ action: 'buy', symbol: 'MCD' }), leg({ action: 'sell', symbol: 'CMG' })]
    expect(hasDefensiblePairHistory(legs, closes({ MCD: 260 }))).toBe(false)
  })

  it('refuses when only the short side is covered', () => {
    const legs = [leg({ action: 'buy', symbol: 'ONON' }), leg({ action: 'sell', symbol: 'NKE' })]
    expect(hasDefensiblePairHistory(legs, closes({ NKE: 260 }))).toBe(false)
  })

  it('accepts a multi-leg side when any one leg on it is covered', () => {
    const legs = [
      leg({ action: 'buy', symbol: 'LLY' }), leg({ action: 'buy', symbol: 'PFE' }),
      leg({ action: 'sell', symbol: 'GH' }), leg({ action: 'sell', symbol: 'CLOV' }),
    ]
    expect(hasDefensiblePairHistory(legs, closes({ LLY: 260, CLOV: 260 }))).toBe(true)
    expect(hasDefensiblePairHistory(legs, closes({ LLY: 260, PFE: 260 }))).toBe(false)
  })

  it('ignores deleted legs when judging coverage', () => {
    const legs = [
      leg({ action: 'buy', symbol: 'MCD' }),
      leg({ action: 'sell', symbol: 'CMG', status: 'deleted' }),
    ]
    expect(hasDefensiblePairHistory(legs, closes({ MCD: 260, CMG: 260 }))).toBe(false)
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
