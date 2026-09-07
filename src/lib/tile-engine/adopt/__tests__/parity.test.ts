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
import { adoptNoCoreThesis, adoptScenarioGap, adoptStaleTarget } from '../mobile'
import { situationPriorityInput } from '../../importance'
import { priorityFor } from '../../../signals/feed-priority'
import {
  NOW, PHONE, atExpectedCard, dislocationCard, insightRankInput, scenarioRankInput,
  staleTargetCard, staleTargetRankInput, staleTargetRow, thesisCard, thesisInsight,
} from './fixtures'
import { ALL_CANONICAL as REFERENCE_FINDINGS } from '../../__tests__/fixtures'
import { researchBaseFor } from '../../../research/case-state'

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
    expect(r.reason).toBe('not_an_attention_state')
    expect(r.detail).toContain('confirmation rather than a finding')
  })

  it('a decline is not a parity failure, and is reported', () => {
    const original = atExpectedCard()
    const report = compareParity({
      original,
      productionRankInput: scenarioRankInput(original, CAPITAL),
      adoption: adoptScenarioGap(original, CAPITAL, READER, PHONE),
    })
    expect(report.ok).toBe(true)
    expect(report.checks[0].next).toContain('not_an_attention_state')
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

describe('No Core Thesis', () => {
  const insight = thesisInsight()
  const card = thesisCard()

  it('is detected as the same situation', () => {
    const r = adoptNoCoreThesis(insight, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.situation.lead.signalType).toBe('no_research')
    expect(r.adoption.situation.question).toBe('thesis')
  })

  it('passes every parity axis', () => {
    const report = compareParity({
      original: card,
      productionRankInput: insightRankInput(insight),
      adoption: adoptNoCoreThesis(insight, card, READER, PHONE),
    })
    expect(report.ok, explainParity(report)).toBe(true)
  })

  it('produces the identical ranking score', () => {
    const r = adoptNoCoreThesis(insight, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const oldP = priorityFor(insightRankInput(insight), NOW)
    const newP = priorityFor(situationPriorityInput(r.adoption.situation), NOW)
    expect(newP.tier).toBe(oldP.tier)
    expect(newP.total).toBe(oldP.total)
  })

  /**
   * The framing base is production's and is carried, never computed.
   *
   * It is worth 0.40 of the score — the largest single weight in the model — so
   * withholding it would have moved every Research card in the feed, and
   * inventing one would have been the engine ranking itself.
   */
  it('carries production’s framing base rather than inventing one', () => {
    const r = adoptNoCoreThesis(insight, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(situationPriorityInput(r.adoption.situation).base)
      .toBe(researchBaseFor(insight.issue))
  })

  it('ranks a partial case above a void one, exactly as production does', () => {
    const partial = thesisInsight({ issue: { framing: 'incomplete_case' } as any })
    const partialCard = thesisCard({ issue: { framing: 'incomplete_case' } as any })
    const a = adoptNoCoreThesis(partial, partialCard, READER, PHONE)
    const b = adoptNoCoreThesis(insight, card, READER, PHONE)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const pa = priorityFor(situationPriorityInput(a.adoption.situation), NOW).total
    const pb = priorityFor(situationPriorityInput(b.adoption.situation), NOW).total
    const oa = priorityFor(insightRankInput(partial), NOW).total
    const ob = priorityFor(insightRankInput(insight), NOW).total
    expect(pa).toBe(oa)
    expect(pb).toBe(ob)
    expect(pa < pb).toBe(oa < ob)
  })

  it('leads with the missing judgment and never with a price or a weight', () => {
    const r = adoptNoCoreThesis(insight, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { copy } = r.adoption
    expect(copy.headline).toContain('what AMZN is for')
    expect(copy.headline).not.toContain('$')
    expect(copy.headline).not.toContain('%')
    /**
     * And no metric at all, matching the shipping card.
     *
     * Counting the missing sections would be "a number standing in for
     * nothing" in the one slot reserved for the figure a decision turns on.
     */
    expect(copy.metric).toBeNull()
    expect(r.adoption.card.metric).toBeNull()
  })

  it('tells a void case from a partly written one', () => {
    const partial = thesisInsight({ issue: { framing: 'incomplete_case' } as any })
    const r = adoptNoCoreThesis(partial, thesisCard({ issue: { framing: 'incomplete_case' } as any }), READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.copy.headline).toContain('only part written')
    expect(r.adoption.copy.metric).toBeNull()
    expect(r.adoption.copy.body).toContain('1 of 3')
  })

  it('keeps the card identity and every feed-contract field', () => {
    const r = adoptNoCoreThesis(insight, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const next = r.adoption.card
    expect(next.id).toBe(card.id)
    expect(next.type).toBe(card.type)
    expect(next.severity).toBe(card.severity)
    expect(next.dedupeKey).toBe(card.dedupeKey)
    expect(next.entity).toEqual(card.entity)
    expect(next.provenance).toEqual(card.provenance)
  })

  it('declines the other half of the same producer', () => {
    const stale = adoptNoCoreThesis(
      { ...insight, kind: 'stale_research' }, card, READER, PHONE)
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.detail).toContain('not an adopted situation')
  })
})

describe('the engine invents no ranking input', () => {
  it('the reference builders never set a base', () => {
    for (const f of REFERENCE_FINDINGS()) {
      expect(f.stakes.base, `${f.kind} invented a base`).toBeUndefined()
    }
  })
})
