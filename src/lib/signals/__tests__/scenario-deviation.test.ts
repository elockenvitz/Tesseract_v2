/**
 * The at_expected ranking defect, reproduced and then fixed.
 *
 * ── What the defect was ───────────────────────────────────────────────────
 *
 * `MobileDashboard`'s scenario ranking branch read `card.metric.value`, stripped
 * the non-digits out of it, and handed the result to `feed-priority` as
 * `deviationPct`. Two of `buildScenarioGapCard`'s three claims render a
 * percentage there. The third renders a PRICE — the probability-weighted
 * expected value — so a fairly-valued name went into the scorer as a deviation
 * of several hundred percent.
 *
 * The first test below is the reproduction: it performs the old parse on a real
 * `at_expected` card and shows what the scorer would have been told. It fails
 * loudly if the card's metric ever stops being a price, which would mean the
 * reproduction has gone stale rather than the bug has gone away.
 */

import { describe, expect, it } from 'vitest'

import { buildScenarioGapCard } from '../builders/scenarioGap'
import { deriveScenarioState, dislocationPct } from '../scenario-state'
import { deviationBand, priorityFor, type PriorityInput } from '../feed-priority'
import { MATERIAL_DEVIATION_PCT, SEVERE_DEVIATION_PCT } from '../thresholds'
import type { SignalCard } from '../contract'

const CASES = [
  { id: 'c-bear', name: 'Bear', price: 400, probability: 25, timeframe: '12 months' },
  { id: 'c-base', name: 'Base', price: 520, probability: 50, timeframe: '12 months' },
  { id: 'c-bull', name: 'Bull', price: 620, probability: 25, timeframe: '12 months' },
]

const card = (price: number): SignalCard => {
  const r = buildScenarioGapCard({
    assetId: 'a-amzn',
    symbol: 'AMZN',
    companyName: 'Amazon',
    price,
    priceAsOf: new Date(Date.now() - 5 * 60_000).toISOString(),
    cases: CASES,
    heldIn: [{ id: 'p-core', name: 'Core Equity' }],
    statedAt: '2026-02-05T00:00:00.000Z',
  })
  if (!r.ok) throw new Error(`suppressed: ${r.reason} — ${r.detail ?? ''}`)
  return r.card
}

/** The expected value of the ladder above: 0.25·400 + 0.5·520 + 0.25·620. */
const EXPECTED_VALUE = 515

/** Exactly what the shipping ranker used to do. */
const oldParse = (c: SignalCard): number =>
  Number(String(c.metric?.value ?? '').replace(/[^0-9.]/g, ''))

/** What it does now: read the ladder the card already carries. */
const newDerive = (c: SignalCard): number | null => {
  const d = c.evidence?.data as { price: number; cases: typeof CASES }
  const state = deriveScenarioState(d.price, d.cases as never)
  return state ? dislocationPct(d.price, state) : null
}

describe('the defect, reproduced', () => {
  const fairlyValued = card(EXPECTED_VALUE)

  it('at_expected renders a price as its metric', () => {
    expect(fairlyValued.metric?.value).toBe(`$${EXPECTED_VALUE}`)
    expect(fairlyValued.metric?.value).not.toContain('%')
  })

  it('the old parse turned that price into a deviation of the same magnitude', () => {
    expect(oldParse(fairlyValued)).toBe(EXPECTED_VALUE)
    expect(oldParse(fairlyValued)).toBeGreaterThan(SEVERE_DEVIATION_PCT)
  })

  it('which put the in-range claim in the maximum deviation band', () => {
    expect(deviationBand(oldParse(fairlyValued))).toBe(1)
  })
})

describe('the fix', () => {
  const fairlyValued = card(EXPECTED_VALUE)

  it('reads null for a price inside the modelled range', () => {
    expect(newDerive(fairlyValued)).toBeNull()
  })

  it('gives the in-range claim the neutral band, not the maximum one', () => {
    expect(deviationBand(newDerive(fairlyValued))).toBe(0)
  })

  it('drops the card below a real dislocation in the same tier', () => {
    const base: Omit<PriorityInput, 'id' | 'deviationPct' | 'severity'> = {
      type: 'scenario_gap',
      occurredAt: new Date().toISOString(),
      weightPct: 4.8,
      held: true,
      coverage: 'direct',
    }
    const dislocated = card(312)

    const before = priorityFor({
      ...base, id: 'at-expected', severity: 'informational',
      deviationPct: oldParse(fairlyValued),
    }, Date.now())
    const after = priorityFor({
      ...base, id: 'at-expected', severity: 'informational',
      deviationPct: newDerive(fairlyValued),
    }, Date.now())
    const real = priorityFor({
      ...base, id: 'dislocated', severity: dislocated.severity,
      deviationPct: newDerive(dislocated),
    }, Date.now())

    // The tier is unchanged: this is a scoring correction, not a re-filing.
    expect(after.tier).toBe(before.tier)
    expect(after.total).toBeLessThan(before.total)
    // And the real dislocation now outranks it, which it did not always before.
    expect(real.total).toBeGreaterThan(after.total)
  })
})

describe('real dislocations are preserved', () => {
  it('below the lowest case keeps the same magnitude it always had', () => {
    const c = card(312)
    // 312 against a lowest case of 400: 22% below it.
    expect(newDerive(c)).toBeCloseTo(22, 0)
    expect(oldParse(c)).toBe(22)
    expect(c.metric?.value).toBe('22%')
  })

  it('above the highest case keeps its sign and magnitude', () => {
    const c = card(760)
    // 760 against a highest case of 620: 22.6% above it.
    expect(newDerive(c)).toBeCloseTo(22.6, 1)
    expect(deviationBand(newDerive(c))).toBe(deviationBand(oldParse(c)))
  })

  /**
   * The one behavioural difference, stated exactly.
   *
   * The old path rounded on its way through a label. A gap of 14.6% became
   * "15%" and was read back as 15, which crosses `MATERIAL_DEVIATION_PCT` and
   * lifted the card a band it had not earned. The correction removes that
   * inflation; it never lowers a card below where the true number puts it.
   */
  it('no longer rounds a gap up across a band boundary', () => {
    // 349 against a lowest case of 400 is 12.75% — comfortably inside a band.
    const inside = card(349)
    expect(newDerive(inside)!).toBeLessThan(MATERIAL_DEVIATION_PCT)

    // A gap that rounds up across the boundary is the case that changed.
    const state = deriveScenarioState(341, CASES as never)!
    const trueGap = dislocationPct(341, state)!
    expect(trueGap).toBeLessThan(MATERIAL_DEVIATION_PCT)
    expect(Number(trueGap.toFixed(0))).toBeGreaterThanOrEqual(MATERIAL_DEVIATION_PCT)
    expect(deviationBand(trueGap)).toBeLessThan(deviationBand(Number(trueGap.toFixed(0))))
  })
})
