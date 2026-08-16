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

/** AAPL: 205 @12, 230 @19, 285 @62, 500 @7. EV = 280. Price 276.49. */
const AAPL = base({
  assetId: 'aapl', symbol: 'AAPL', companyName: 'Apple', price: 276.49,
  cases: [
    { name: 'Bear', price: 205, probability: 12, timeframe: '6 months' },
    { name: 'Base', price: 230, probability: 19, timeframe: '6 months' },
    { name: 'Bull', price: 285, probability: 62, timeframe: '12 months' },
    { name: 'Uber Bull', price: 500, probability: 7, timeframe: '12 months' },
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

describe('at expected value — AAPL', () => {
  it('reports a fair price as a decision rather than silence', () => {
    const c = card(buildScenarioGapCard(AAPL))
    expect(c.headline).toBe('AAPL is priced at your expected value')
    expect(c.metric?.value).toBe('$280')
    expect(c.severity).toBe('informational')
  })

  it('weights by probability across all four cases', () => {
    // 0.12*205 + 0.19*230 + 0.62*285 + 0.07*500 = 280
    const d = card(buildScenarioGapCard(AAPL)).evidence!.data as { expected: number }
    expect(d.expected).toBeCloseTo(280, 1)
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
  const all = [TSLA, AMZN, AAPL].map(i => card(buildScenarioGapCard(i)))

  it('no headline carries the metric value', () => {
    for (const c of all) expect(c.headline).not.toContain(c.metric!.value)
  })

  it('every card names its stake and can explain itself', () => {
    for (const c of all) {
      expect(c.context.some(x => x.label.startsWith('Held') || x.label === 'Not held')).toBe(true)
      expect(c.provenance.reason).toContain('scenarios')
      expect(c.actions.primary.inline).toBe(true)
      expect(c.dedupeKey.startsWith('scenario_gap')).toBe(true)
    }
  })
})
