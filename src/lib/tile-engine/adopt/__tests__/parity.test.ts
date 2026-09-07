/**
 * Old path against new path, on real producer output.
 *
 * Every card here comes out of `buildStaleTargetCard` or
 * `buildScenarioGapCard`, and every ranking input is `rankInputFor`'s own
 * branch transcribed. So a failure means the engine disagrees with what ships,
 * which is the only thing this suite is for.
 */

import { describe, expect, it } from 'vitest'

import { compareParity, explainParity } from '../compare'
import { adoptScenarioGap, adoptStaleTarget } from '../mobile'
import { situationPriorityInput } from '../../importance'
import { priorityFor } from '../../../signals/feed-priority'
import {
  NOW, PHONE, atExpectedCard, dislocationCard, scenarioRankInput,
  staleTargetCard, staleTargetRankInput, staleTargetRow,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }
const CAPITAL = { weightPct: 4.8 }

describe('Target Expired', () => {
  const row = staleTargetRow()
  const card = staleTargetCard()

  it('is detected as the same situation', () => {
    const r = adoptStaleTarget(row, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.situation.lead.signalType).toBe('target_expired')
    expect(r.adoption.situation.question).toBe('target')
    expect(r.adoption.situation.subject.ticker).toBe('MSFT')
  })

  it('takes its severity from production rather than restating the rule', () => {
    const critical = staleTargetCard({ overdueMonths: 6 })
    const attention = staleTargetCard({ overdueMonths: 3 })
    const a = adoptStaleTarget(staleTargetRow({ overdueMonths: 6 }), critical, READER, PHONE)
    const b = adoptStaleTarget(staleTargetRow({ overdueMonths: 3 }), attention, READER, PHONE)
    expect(a.ok && a.adoption.situation.severity).toBe(critical.severity)
    expect(b.ok && b.adoption.situation.severity).toBe(attention.severity)
    expect(critical.severity).not.toBe(attention.severity)
  })

  it('passes every parity axis', () => {
    const report = compareParity({
      original: card,
      productionRankInput: staleTargetRankInput(row),
      adoption: adoptStaleTarget(row, card, READER, PHONE),
    })
    expect(report.ok, explainParity(report)).toBe(true)
  })

  it('produces the identical ranking score', () => {
    const r = adoptStaleTarget(row, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const oldP = priorityFor(staleTargetRankInput(row), NOW)
    const newP = priorityFor(situationPriorityInput(r.adoption.situation), NOW)
    expect(newP.tier).toBe(oldP.tier)
    expect(newP.total).toBe(oldP.total)
  })

  it('keeps the card identity and every feed-contract field', () => {
    const r = adoptStaleTarget(row, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const next = r.adoption.card
    expect(next.id).toBe(card.id)
    expect(next.type).toBe(card.type)
    expect(next.severity).toBe(card.severity)
    expect(next.dedupeKey).toBe(card.dedupeKey)
    expect(next.entity).toEqual(card.entity)
    expect(next.provenance).toEqual(card.provenance)
    expect(next.expiry).toEqual(card.expiry)
  })
})

describe('Case vs Price', () => {
  const card = dislocationCard()

  it('is detected as the same situation', () => {
    const r = adoptScenarioGap(card, CAPITAL, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.situation.lead.signalType).toBe('scenario_gap')
    expect(r.adoption.situation.question).toBe('framework')
    expect(r.adoption.situation.lead.claim.band).toMatchObject({ low: 400, high: 620 })
  })

  it('passes every parity axis', () => {
    const report = compareParity({
      original: card,
      productionRankInput: scenarioRankInput(card, CAPITAL),
      adoption: adoptScenarioGap(card, CAPITAL, READER, PHONE),
    })
    expect(report.ok, explainParity(report)).toBe(true)
  })

  it('produces the identical ranking score', () => {
    const r = adoptScenarioGap(card, CAPITAL, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const oldP = priorityFor(scenarioRankInput(card, CAPITAL), NOW)
    const newP = priorityFor(situationPriorityInput(r.adoption.situation), NOW)
    expect(newP.tier).toBe(oldP.tier)
    expect(newP.total).toBe(oldP.total)
  })

  it('inherits the metric rounding rather than improving on it', () => {
    const r = adoptScenarioGap(card, CAPITAL, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The card's metric string is the authority for the deviation, so the
    // finding's number is the rounded one production ranks on.
    const fromCard = Number(String(card.metric?.value).replace(/[^0-9.]/g, ''))
    expect(r.adoption.situation.lead.stakes.deviationPct).toBe(fromCard)
  })

  it('reports the unheld case as unheld, exactly as production does', () => {
    const r = adoptScenarioGap(card, null, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const input = situationPriorityInput(r.adoption.situation)
    expect(input.held).toBe(false)
    expect(input.weightPct).toBeNull()
  })

  it('declines at_expected loudly, as a claim this situation does not cover', () => {
    const r = adoptScenarioGap(atExpectedCard(), CAPITAL, READER, PHONE)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('claim_out_of_scope')
    expect(r.detail).toContain('at_expected')
  })

  it('a decline is not a parity failure, and is reported', () => {
    const original = atExpectedCard()
    const report = compareParity({
      original,
      productionRankInput: scenarioRankInput(original, CAPITAL),
      adoption: adoptScenarioGap(original, CAPITAL, READER, PHONE),
    })
    expect(report.ok).toBe(true)
    expect(report.checks[0].next).toContain('claim_out_of_scope')
  })
})

describe('the flag is safe in both positions', () => {
  it('a declined card renders as production built it', async () => {
    const { cardOrOriginal } = await import('../mobile')
    const original = atExpectedCard()
    const rendered = cardOrOriginal(original, adoptScenarioGap(original, CAPITAL, READER, PHONE))
    expect(rendered).toBe(original)
  })
})
