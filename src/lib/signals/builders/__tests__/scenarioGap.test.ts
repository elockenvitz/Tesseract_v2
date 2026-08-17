import { describe, it, expect, beforeEach } from 'vitest'
import { buildScenarioGapCard, type ScenarioGapInput } from '../scenarioGap'
import { readSuppressionLog } from '../../suppression'
import type { CardResult, SignalCard } from '../../contract'

/**
 * Every case here is real production data, not invented.
 *
 * Read from `analyst_price_targets` on 2026-08-16. That matters: the previous
 * three builders were written against imagined shapes and two of them could
 * never render — one filtered on status values that do not exist, one computed
 * against a benchmark table with zero rows. These fixtures are what is
 * actually in the database.
 */

const card = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason} (${r.detail})`)
  return r.card
}
const reason = (r: CardResult): string => {
  if (r.ok) throw new Error(`expected suppression, got: ${r.card.headline}`)
  return r.reason
}

const fresh = () => new Date().toISOString()

const base = (over: Partial<ScenarioGapInput>): ScenarioGapInput => ({
  assetId: 'a1', symbol: 'X', price: 100, priceAsOf: fresh(),
  cases: [], heldIn: ['Tech & Consumer Growth'], statedAt: '2026-03-21T18:49:00.000Z',
  ...over,
})

/** TSLA: Bear 325 @10%, Base 375 @15%, Bull 400 @75%. Price 248.90. */
const TSLA = base({
  assetId: 'tsla', symbol: 'TSLA', companyName: 'Tesla', price: 248.90,
  cases: [
    { name: 'Bear', price: 325, probability: 10, timeframe: '6 months' },
    { name: 'Base', price: 375, probability: 15, timeframe: '6 months' },
    { name: 'Bull', price: 400, probability: 75, timeframe: '6 months' },
  ],
})

/** AMZN: Bear 90, Base 120, Bull 180, no probabilities. Price 232.99. */
const AMZN = base({
  assetId: 'amzn', symbol: 'AMZN', companyName: 'Amazon', price: 232.99,
  cases: [
    { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
    { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
    { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
  ],
})

/**
 * AAPL, exactly as production holds it: SIX cases, probabilities summing to
 * 125, and two different horizons. Price 276.49.
 *
 * The earlier fixture in this file listed four of the six and claimed an
 * expected value of $280. That was not the data — it was a subset that
 * happened to sum to 100. Read from analyst_price_targets on 2026-08-17.
 */
const AAPL = base({
  assetId: 'aapl', symbol: 'AAPL', companyName: 'Apple', price: 276.49,
  cases: [
    { name: 'Bear', price: 205, probability: 12, timeframe: '6 months' },
    { name: 'Base', price: 230, probability: 19, timeframe: '6 months' },
    { name: 'Bear', price: 255, probability: 10, timeframe: '12 months' },
    { name: 'Bull', price: 285, probability: 62, timeframe: '12 months' },
    { name: 'Bull', price: 345, probability: 15, timeframe: '12 months' },
    { name: 'Uber Bull', price: 500, probability: 7, timeframe: '12 months' },
  ],
})

/** A coherent ladder: one horizon, probabilities summing to 100. */
const COHERENT = base({
  // 104 against an expected value of 105 — inside the 3% band that makes the
  // "priced at expected value" claim true. At 100 it is 4.8% away, which is
  // simply inside the range and correctly says nothing.
  assetId: 'coh', symbol: 'COH', price: 104,
  cases: [
    { name: 'Bear', price: 80, probability: 25, timeframe: '12 months' },
    { name: 'Base', price: 100, probability: 50, timeframe: '12 months' },
    { name: 'Bull', price: 140, probability: 25, timeframe: '12 months' },
  ],
})

/** GOOGL: price 142.80 against targets of 800, 800 and 1605.12. */
const GOOGL = base({
  assetId: 'googl', symbol: 'GOOGL', price: 142.80,
  cases: [
    { name: 'Bear', price: 800, probability: null, timeframe: '6 months' },
    { name: 'Base', price: 800, probability: null, timeframe: '12 months' },
    { name: 'Bull', price: 1605.12, probability: null, timeframe: '11 months' },
  ],
})

beforeEach(() => localStorage.clear())

describe('below the bear case — TSLA', () => {
  it('names the claim the single-target view hides', () => {
    const c = card(buildScenarioGapCard(TSLA))
    // Every other surface picks one row and shows 400, which reads as upside.
    expect(c.headline).toBe('TSLA is trading below your bear case')
    expect(c.metric?.value).toBe('23%')
    expect(c.metric?.label).toBe('Below bear case of $325')
    expect(c.metric?.direction).toBe('bad')
  })

  it('is critical when the gap is wide', () => {
    expect(card(buildScenarioGapCard(TSLA)).severity).toBe('critical')
    // Just under the bear case is worth saying, but it is not an emergency.
    const near = { ...TSLA, price: 320 }
    expect(card(buildScenarioGapCard(near)).severity).toBe('attention')
  })

  it('dates the number by the quote, not by when the ladder was written', () => {
    const c = card(buildScenarioGapCard(TSLA))
    expect(c.metric?.source).toBe('quote')
    expect(new Date(c.metric!.asOf).getTime()).toBeGreaterThan(new Date(TSLA.statedAt).getTime())
  })

  it('carries the ladder as evidence, because the spread is the argument', () => {
    const c = card(buildScenarioGapCard(TSLA))
    expect(c.evidence?.kind).toBe('scenario_ladder')
    const d = c.evidence!.data as { price: number; cases: unknown[]; expected: number | null }
    expect(d.price).toBe(248.90)
    expect(d.cases).toHaveLength(3)
    expect(d.expected).toBeCloseTo(388.75, 2)
  })

  it('re-surfaces when the claim recurs on a later day', () => {
    const a = card(buildScenarioGapCard(TSLA)).dedupeKey
    const b = card(buildScenarioGapCard({ ...TSLA, price: 240 })).dedupeKey
    expect(b).toBe(a) // same claim, same day
    expect(a).toContain('below_bear')
  })
})

describe('above the bull case — AMZN', () => {
  it('says the upside is spent', () => {
    const c = card(buildScenarioGapCard(AMZN))
    expect(c.headline).toBe('AMZN has passed your bull case')
    expect(c.metric?.value).toBe('+29%')
    expect(c.metric?.direction).toBe('good')
    expect(c.body).toContain('no stated upside left')
  })

  it('computes no expected value when probabilities are missing', () => {
    // Weighting the unlabelled cases at zero would invent a number.
    const c = card(buildScenarioGapCard(AMZN))
    expect((c.evidence!.data as { expected: number | null }).expected).toBeNull()
    expect(c.context.some(x => x.label.startsWith('EV'))).toBe(false)
  })
})

describe('expected value only from a real distribution', () => {
  it('computes it when the weights sum to 100 on one horizon', () => {
    // 0.25*80 + 0.50*100 + 0.25*140 = 105
    const c = card(buildScenarioGapCard(COHERENT))
    expect(c.headline).toBe('COH is priced at your expected value')
    expect(c.metric?.value).toBe('$105')
    expect(c.severity).toBe('informational')
  })

  it('refuses to normalise AAPL, whose probabilities sum to 125', () => {
    // The old code divided by the sum of whatever was present, so it presented
    // a "probability-weighted expected value" from a distribution the analyst
    // never wrote. No number they could enter would make the card disagree
    // with them, which makes the fair-value claim unfalsifiable.
    const r = buildScenarioGapCard(AAPL)
    expect(r.ok).toBe(false)
    expect(reason(r)).toBe('resolved')
  })

  it('states why there is no expectation rather than omitting it silently', () => {
    // Below its bear case, so the card still renders — and carries the reason
    // the EV chip is missing.
    const c = card(buildScenarioGapCard({ ...AAPL, price: 150 }))
    expect(c.context.some(x => x.label === 'Probabilities sum to 125%')).toBe(true)
    expect(c.context.some(x => x.label.startsWith('EV'))).toBe(false)
  })

  it('refuses to average across mixed horizons', () => {
    // A 6-month bear at 205 and a 12-month bull at 285 are not competing
    // outcomes of one question; weighting them describes no point in time.
    const mixed = {
      ...COHERENT,
      cases: [
        { name: 'Bear', price: 80, probability: 25, timeframe: '6 months' },
        { name: 'Base', price: 100, probability: 50, timeframe: '12 months' },
        { name: 'Bull', price: 140, probability: 25, timeframe: '12 months' },
      ],
    }
    const c = card(buildScenarioGapCard({ ...mixed, price: 60 }))
    expect(c.context.some(x => x.label.startsWith('Mixed horizons'))).toBe(true)
    expect((c.evidence!.data as { expected: number | null }).expected).toBeNull()
  })
})

describe('suppressions', () => {
  it('rejects an implausible gap as a data fault, not a 460% finding', () => {
    // GOOGL, live in production: a split-adjusted price meeting unadjusted
    // targets. The most confident wrong thing the surface could say.
    expect(reason(buildScenarioGapCard(GOOGL))).toBe('inconsistent_numbers')
  })

  it('rejects a stale quote — the claim would be unfalsifiable', () => {
    const stale = { ...TSLA, priceAsOf: new Date(Date.now() - 60 * 60_000).toISOString() }
    expect(reason(buildScenarioGapCard(stale))).toBe('quote_stale')
  })

  it('rejects a missing price', () => {
    // PLTR, COIN, DASH, CEG, NVDA and NKE all have targets and no
    // current_price. 68 of 911 assets carry one.
    expect(reason(buildScenarioGapCard({ ...TSLA, price: 0 }))).toBe('quote_unavailable')
  })

  it('rejects a single target — one number is not a ladder', () => {
    const one = { ...TSLA, cases: [TSLA.cases[0]] }
    expect(reason(buildScenarioGapCard(one))).toBe('insufficient_coverage')
  })

  it('says nothing when the price is simply inside the range', () => {
    // The normal state of every position. A card that fires here fires on
    // everything and teaches people to ignore the surface.
    const inside = { ...TSLA, price: 360 }
    expect(reason(buildScenarioGapCard(inside))).toBe('resolved')
  })

  it('logs every suppression with its entity', () => {
    buildScenarioGapCard(GOOGL)
    buildScenarioGapCard({ ...TSLA, price: 360 })
    const log = readSuppressionLog()
    expect(log.map(e => e.type)).toEqual(['scenario_gap', 'scenario_gap'])
    expect(log.map(e => e.entity)).toEqual(['GOOGL', 'TSLA'])
    expect(log.every(e => !!e.detail)).toBe(true)
  })
})

describe('contract invariants', () => {
  // Built inside the test, not at collection time. As a module-scope const, a
  // single suppression threw during collection and took all 17 tests in this
  // file with it — reported as "no tests" rather than as a failure, which is
  // indistinguishable from the file not existing.
  const build = () => [TSLA, AMZN, COHERENT].map(i => card(buildScenarioGapCard(i)))

  it('no headline carries the metric value', () => {
    for (const c of build()) expect(c.headline).not.toContain(c.metric!.value)
  })

  it('every card names its stake and can explain itself', () => {
    for (const c of build()) {
      expect(c.context.some(x => x.label.startsWith('Held') || x.label === 'Not held')).toBe(true)
      expect(c.provenance.reason).toContain('scenarios')
      expect(c.actions.primary.inline).toBe(true)
      expect(c.dedupeKey.startsWith('scenario_gap')).toBe(true)
    }
  })
})
