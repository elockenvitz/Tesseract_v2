/**
 * The valuation, against the ladders that are actually in production.
 *
 * Every fixture in the first block is a real scenario set read from
 * `analyst_price_targets` for the pilot organisation on 2026-11-17, prices,
 * weights and horizons unaltered. That matters more than invented cases here:
 * the interesting behaviour is which real ladders earn an expected value and
 * which are refused, and a hand-written fixture would have quietly been built
 * to pass.
 *
 * Of the ten assets carrying targets, four earn an expected value and six are
 * refused -- for four different reasons. A module that printed a number for
 * all ten would look better and be wrong.
 */
import { describe, expect, it } from 'vitest'
import {
  buildValuation,
  blockerText,
  PROBABILITY_SUM_TOLERANCE,
  type ValuationInput,
} from '../valuation'

const t = (
  name: string,
  price: number | null,
  probability: number | null,
  timeframe: string | null,
): ValuationInput => ({ id: `${name}-${price}`, name, price, probability, timeframe })

/* ─────────────────── production ladders, verbatim ─────────────────────── */

/** Weighted, but a 6-month bear under a 12-month bull. */
const AAPL = [
  t('Bull', 450, 62, '12 months'),
  t('Base', 400, 19, '6 months'),
  t('Bear', 205, 12, '6 months'),
  t('Uber Bull', 500, 7, '12 months'),
]
/** Official, three-rung, no weights at all. */
const AMZN = [
  t('Bull', 180, null, '12 months'),
  t('Bear', 90, null, '12 months'),
  t('Base', 120, null, '12 months'),
]
/** Weighted and single-horizon: this one works. */
const TSLA = [
  t('Bull', 400, 75, '6 months'),
  t('Base', 375, 15, '6 months'),
  t('Bear', 325, 10, '6 months'),
]
const COIN = [
  t('Base', 225, 40, '12 months'),
  t('Bull', 375, 30, '12 months'),
  t('Bear', 100, 30, '12 months'),
]
const PLTR = [
  t('Bull', 250, 50, '12 months'),
  t('Base', 175, 40, '12 months'),
  t('Bear', 50, 10, '12 months'),
]
/** One rung only. */
const NKE = [t('Bear', 50, null, '12 months')]

describe('the ladders in production', () => {
  it('weights TSLA, whose three rungs share a horizon', () => {
    const v = buildValuation(TSLA, 350)
    // 400*.75 + 375*.15 + 325*.10
    expect(v.expected?.price).toBeCloseTo(388.75, 10)
    expect(v.blocker).toBeNull()
    expect(v.expected?.horizon).toBe('6 months')
    expect(v.probabilitySum).toBe(100)
  })

  it('weights COIN and PLTR too', () => {
    expect(buildValuation(COIN).expected?.price).toBeCloseTo(232.5, 10)
    expect(buildValuation(PLTR).expected?.price).toBeCloseTo(200, 10)
  })

  it('refuses AAPL: the horizons are not one distribution', () => {
    const v = buildValuation(AAPL, 270)
    expect(v.blocker).toBe('mixed_horizons')
    expect(v.expected).toBeNull()
    /*
     * The weights are a valid distribution -- this is NOT a sum problem, and
     * saying so would send the reader to fix the wrong thing.
     */
    expect(v.probabilitySum).toBe(100)
  })

  it('refuses AMZN: nothing is weighted', () => {
    const v = buildValuation(AMZN, 150)
    expect(v.blocker).toBe('missing_probabilities')
    expect(v.probabilitySum).toBeNull()
  })

  it('refuses NKE: one rung is not a distribution', () => {
    expect(buildValuation(NKE, 60).blocker).toBe('single_scenario')
  })

  it('still lists the rungs of every refused ladder', () => {
    // A refusal is about the expected value, not about the data.
    for (const ladder of [AAPL, AMZN, NKE]) {
      const v = buildValuation(ladder, 100)
      expect(v.scenarios).toHaveLength(ladder.length)
      expect(v.scenarios.every(s => Number.isFinite(s.price))).toBe(true)
    }
  })
})

/* ──────────────────────────── the ordering ─────────────────────────────── */

describe('rungs read low to high', () => {
  it('sorts by price, not by scenario name', () => {
    const v = buildValuation(AAPL, 270)
    expect(v.scenarios.map(s => s.price)).toEqual([205, 400, 450, 500])
    // 'Uber Bull' outranks 'Bull' on price and no hand-written rank says so.
    expect(v.scenarios[3].name).toBe('Uber Bull')
  })

  it('reports the range from the extremes', () => {
    expect(buildValuation(AAPL).range).toEqual({ low: 205, high: 500 })
  })

  it('has no range with a single rung', () => {
    expect(buildValuation(NKE).range).toBeNull()
  })
})

/* ──────────────────────────── implied moves ───────────────────────────── */

describe('implied move', () => {
  it('is signed against spot', () => {
    const v = buildValuation(TSLA, 350)
    const bear = v.scenarios.find(s => s.name === 'Bear')!
    const bull = v.scenarios.find(s => s.name === 'Bull')!
    expect(bear.impliedPct).toBeCloseTo(((325 - 350) / 350) * 100, 10)
    expect(bear.impliedPct!).toBeLessThan(0)
    expect(bull.impliedPct!).toBeGreaterThan(0)
  })

  it('is null without a spot, and the block still has prices', () => {
    const v = buildValuation(TSLA, null)
    expect(v.scenarios.every(s => s.impliedPct == null)).toBe(true)
    expect(v.expected?.price).toBeCloseTo(388.75, 10)
    expect(v.expected?.impliedPct).toBeNull()
  })

  it('refuses a nonsensical spot rather than dividing by it', () => {
    for (const spot of [0, -10]) {
      expect(buildValuation(TSLA, spot).scenarios[0].impliedPct).toBeNull()
    }
  })

  it('is unit-invariant, which is why it is safe without a known currency', () => {
    /*
     * The same ladder quoted in pence rather than pounds: every price and the
     * spot scale by 100, and the percentage must not move. This is the reason
     * the surface can show implied moves on an asset whose currency it cannot
     * name.
     */
    const pounds = buildValuation(TSLA, 350)
    const pence = buildValuation(
      TSLA.map(s => ({ ...s, price: (s.price as number) * 100 })),
      35000,
    )
    pounds.scenarios.forEach((s, i) => {
      expect(pence.scenarios[i].impliedPct).toBeCloseTo(s.impliedPct!, 10)
    })
    expect(pence.expected!.impliedPct).toBeCloseTo(pounds.expected!.impliedPct!, 10)
  })
})

/* ───────────────────── what it refuses to invent ──────────────────────── */

describe('it does not invent conviction', () => {
  it('refuses weights that miss 100 instead of renormalising them', () => {
    const v = buildValuation(
      [t('Bear', 100, 20, '1y'), t('Base', 200, 30, '1y'), t('Bull', 300, 40, '1y')],
      150,
    )
    expect(v.blocker).toBe('probabilities_do_not_sum')
    expect(v.probabilitySum).toBe(90)
    /* Renormalising to 22/33/44 would have produced 222.2 here. */
    expect(v.expected).toBeNull()
  })

  it('refuses fractional weights rather than guessing the scale', () => {
    /*
     * 0.6/0.3/0.1 sums to 1. Reading that as "100%" would be a hundredfold
     * reinterpretation of somebody's conviction, so it is refused with the
     * sum shown.
     */
    const v = buildValuation(
      [t('Bear', 100, 0.1, '1y'), t('Base', 200, 0.3, '1y'), t('Bull', 300, 0.6, '1y')],
      150,
    )
    expect(v.blocker).toBe('probabilities_do_not_sum')
    expect(v.probabilitySum).toBeCloseTo(1, 10)
  })

  it('accepts a rounding miss inside tolerance', () => {
    const v = buildValuation(
      [t('Bear', 100, 33.3, '1y'), t('Base', 200, 33.3, '1y'), t('Bull', 300, 33.4, '1y')],
      150,
    )
    expect(v.blocker).toBeNull()
    expect(v.expected?.price).toBeCloseTo(100 * 0.333 + 200 * 0.333 + 300 * 0.334, 10)
  })

  it('holds the tolerance boundary on both sides', () => {
    const at = (sum: number) => buildValuation(
      [t('a', 100, sum - 50, '1y'), t('b', 200, 50, '1y')],
      150,
    ).blocker
    expect(at(100 + PROBABILITY_SUM_TOLERANCE)).toBeNull()
    expect(at(100 - PROBABILITY_SUM_TOLERANCE)).toBeNull()
    expect(at(100 + PROBABILITY_SUM_TOLERANCE + 0.01)).toBe('probabilities_do_not_sum')
    expect(at(100 - PROBABILITY_SUM_TOLERANCE - 0.01)).toBe('probabilities_do_not_sum')
  })

  it('drops a rung with no price instead of treating it as zero', () => {
    /* A zero-priced rung would drag the expectation toward nothing. */
    const v = buildValuation([...TSLA, t('Draft', null, 0, '6 months')], 350)
    expect(v.scenarios).toHaveLength(3)
    expect(v.expected?.price).toBeCloseTo(388.75, 10)
  })

  it('ignores a non-finite probability rather than arithmetic on NaN', () => {
    const v = buildValuation(
      [t('a', 100, Number.NaN, '1y'), t('b', 200, 50, '1y')],
      150,
    )
    expect(v.blocker).toBe('missing_probabilities')
    expect(v.expected).toBeNull()
  })
})

/* ───────────────────────────── horizons ───────────────────────────────── */

describe('horizons', () => {
  it('treats spacing and case as the same horizon', () => {
    const v = buildValuation(
      [t('a', 100, 50, '12 Months'), t('b', 200, 50, ' 12  months ')],
      150,
    )
    expect(v.blocker).toBeNull()
    /* Reported in the analyst's own words, not the normalised form. */
    expect(v.expected?.horizon).toBe('12 Months')
  })

  it('weights an entirely unstated ladder, and says the horizon is unknown', () => {
    const v = buildValuation([t('a', 100, 50, null), t('b', 200, 50, null)], 150)
    expect(v.blocker).toBeNull()
    expect(v.expected?.horizon).toBeNull()
    expect(v.expected?.price).toBeCloseTo(150, 10)
  })

  it('does not let a stated horizon match an unstated one', () => {
    const v = buildValuation([t('a', 100, 50, '12 months'), t('b', 200, 50, null)], 150)
    expect(v.blocker).toBe('mixed_horizons')
  })

  it('treats empty text as unstated', () => {
    const v = buildValuation([t('a', 100, 50, '   '), t('b', 200, 50, null)], 150)
    expect(v.blocker).toBeNull()
  })
})

/* ──────────────────── the order the reasons are given ─────────────────── */

describe('the blocker reported is the one worth acting on', () => {
  it('names the missing weights before the disagreeing horizons', () => {
    /*
     * CEG in production: three official rungs at 3, 6 and 12 months with no
     * probabilities. Both conditions fail; being told the horizons disagree
     * would send a reader to fix the wrong thing.
     */
    const v = buildValuation(
      [t('Base', 370, null, '3 months'), t('Bear', 355, null, '6 months'), t('Bull', 390, null, '12 months')],
      360,
    )
    expect(v.blocker).toBe('missing_probabilities')
  })

  it('names the single rung before anything else', () => {
    expect(buildValuation([t('Bear', 50, null, null)]).blocker).toBe('single_scenario')
  })

  it('reports nothing at all for an empty ladder, as one rung short', () => {
    const v = buildValuation([])
    expect(v.scenarios).toEqual([])
    expect(v.blocker).toBe('single_scenario')
    expect(v.range).toBeNull()
  })

  it('treats a missing ladder as no ladder rather than throwing', () => {
    /*
     * `rungs` is one field on a large hook result and a partial cache entry
     * or a test stub can omit it. Reading `.filter` off undefined took the
     * whole Overview down, so nullish is a supported input.
     */
    for (const absent of [null, undefined]) {
      const v = buildValuation(absent)
      expect(v.scenarios).toEqual([])
      expect(v.blocker).toBe('single_scenario')
      expect(v.expected).toBeNull()
    }
  })
})

/* ───────────────────────── the wording shown ──────────────────────────── */

describe('blockerText states the fact', () => {
  it('counts the unweighted rungs when only some are missing', () => {
    const v = buildValuation(
      [t('a', 100, 50, '1y'), t('b', 200, null, '1y'), t('c', 300, null, '1y')],
      150,
    )
    expect(blockerText(v.blocker!, v)).toBe('2 of 3 scenarios carry no probability.')
  })

  it('says none rather than 3 of 3', () => {
    const v = buildValuation(AMZN, 150)
    expect(blockerText(v.blocker!, v)).toBe('No scenario carries a probability.')
  })

  it('quotes the actual total, without a trailing zero on a whole number', () => {
    const whole = buildValuation([t('a', 100, 20, '1y'), t('b', 200, 70, '1y')], 150)
    expect(blockerText(whole.blocker!, whole)).toBe('Probabilities total 90%, not 100%.')
    const frac = buildValuation([t('a', 100, 20, '1y'), t('b', 200, 70.5, '1y')], 150)
    expect(blockerText(frac.blocker!, frac)).toBe('Probabilities total 90.5%, not 100%.')
  })

  it('has a sentence for every blocker the builder can return', () => {
    /*
     * Enumerated from the type rather than from a list kept by hand, so adding
     * a blocker without wording fails here instead of rendering "undefined".
     */
    const all = [
      buildValuation([t('a', 1, null, null)]),
      buildValuation(AMZN, 10),
      buildValuation([t('a', 100, 20, '1y'), t('b', 200, 70, '1y')], 150),
      buildValuation(AAPL, 270),
    ]
    const seen = new Set(all.map(v => v.blocker))
    expect(seen).toEqual(
      new Set(['single_scenario', 'missing_probabilities', 'probabilities_do_not_sum', 'mixed_horizons']),
    )
    for (const v of all) {
      const text = blockerText(v.blocker!, v)
      expect(text).toMatch(/[.]$/)
      expect(text).not.toMatch(/undefined|NaN/)
    }
  })
})
