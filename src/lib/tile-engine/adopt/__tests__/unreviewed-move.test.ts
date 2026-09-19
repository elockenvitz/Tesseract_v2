/**
 * Unreviewed Move: three shipping framings, one situation.
 *
 * Every card comes out of `buildInsightCard` from a `DerivedInsight` shaped as
 * `useDerivedInsights` emits one, and every ranking input is `rankInputFor`'s
 * insight branch transcribed. A failure means the engine disagrees with what
 * ships.
 */

import { describe, expect, it } from 'vitest'

import {
  adoptResearchInsight, adoptScenarioGap, adoptStaleTarget, adoptTargetHit,
} from '../mobile'
import { compareParity, explainParity } from '../compare'
import { composeForSubject } from '../composition'
import { situationPriorityInput } from '../../importance'
import { priorityFor } from '../../../signals/feed-priority'
import { researchBaseFor } from '../../../research/case-state'
import { readerQuestionFor } from '../../../signals/reader-question'
import { SITUATION_DEFINITIONS } from '../../situations'
import {
  NOW, PHONE, dislocationCard, insightRankInput, staleCard, staleInsight,
  staleTargetCard, staleTargetRow, targetBreachRow, targetHitCard,
  thesisCard, thesisInsight,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }
type Framing = 'price_move' | 'new_evidence' | 'long_silence'
const FRAMINGS: Framing[] = ['price_move', 'new_evidence', 'long_silence']

const adopt = (f: Framing) =>
  adoptResearchInsight(staleInsight(f), staleCard(f), READER, PHONE)

const adoption = (f: Framing) => {
  const r = adopt(f)
  if (!r.ok) throw new Error(`unexpected decline: ${r.reason} — ${r.detail}`)
  return r.adoption
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — framing semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('three framings are one situation', () => {
  it('every framing asks the research question', () => {
    for (const f of FRAMINGS) {
      expect(adoption(f).situation.question, f).toBe('research')
    }
    expect(readerQuestionFor('research_stale')).toBe('research')
  })

  it('every framing is the same finding kind and the same predicate', () => {
    for (const f of FRAMINGS) {
      expect(adoption(f).situation.lead.kind, f).toBe('unreviewed_move')
      expect(adoption(f).situation.lead.claim.predicate, f).toBe('unreviewed')
    }
  })

  it('two framings on one name would compose into ONE tile', () => {
    // Production's precedence gives a case at most one framing, so this cannot
    // arrive today. It proves the composer would not produce two tiles if it
    // ever did — which is the reason they are one kind rather than three.
    const a = adopt('price_move')
    const b = adoptResearchInsight(
      { ...staleInsight('long_silence'), id: 'research-long_silence-a-nke' },
      staleCard('long_silence'), READER, PHONE,
    )
    const c = composeForSubject([a, b])
    expect(c.tileCount).toBe(1)
    expect(c.absorbed).toBe(1)
  })

  /**
   * The framing lives in the claim's SHAPE, not in a kind.
   *
   * A percentage means the price moved; a count means material arrived; neither
   * means it has simply been quiet. Nothing downstream is told which framing it
   * is looking at.
   */
  it('carries each state as a different shape of claim', () => {
    expect(adoption('price_move').situation.lead.claim.quantity)
      .toMatchObject({ unit: 'pct', value: -30.5, precision: 1 })
    expect(adoption('new_evidence').situation.lead.claim.quantity)
      .toMatchObject({ unit: 'count', value: 3 })
    expect(adoption('long_silence').situation.lead.claim.quantity).toBeUndefined()
    for (const f of FRAMINGS) {
      expect(adoption(f).situation.lead.claim.interval, f).toBeTruthy()
    }
  })

  it('picks its picture from the unit, never from the framing', () => {
    expect(adoption('price_move').plan.visuals[0]?.primitive).toBe('last_look')
    expect(adoption('new_evidence').plan.visuals[0]?.primitive).toBe('price_trend')
    expect(adoption('long_silence').plan.visuals[0]?.primitive).toBe('price_trend')
  })

  /**
   * The one genuine difference, and it is an ORDER rather than a vocabulary.
   *
   * `buildInsightCard` sends `new_evidence` to the research item and the other
   * two to the thesis editor. The finding reorders the situation's declared
   * intents; it does not add one.
   */
  it('reads what arrived before revising the view, and only then', () => {
    expect(adoption('new_evidence').card.actions.primary.id).toBe('open_research')
    expect(adoption('price_move').card.actions.primary.id).toBe('update_thesis')
    expect(adoption('long_silence').card.actions.primary.id).toBe('update_thesis')
  })

  it('never invents an intent the situation did not declare', () => {
    const declared = new Set(SITUATION_DEFINITIONS.unreviewed_move.intents)
    for (const f of FRAMINGS) {
      for (const i of adoption(f).situation.lead.intents) {
        expect(declared.has(i), `${f} invented ${i}`).toBe(true)
      }
      expect(adoption(f).situation.lead.intents).toHaveLength(declared.size)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — ranking parity, per framing
// ─────────────────────────────────────────────────────────────────────────────

describe('ranking parity across the framings', () => {
  it('passes every parity axis in every framing', () => {
    for (const f of FRAMINGS) {
      const report = compareParity({
        original: staleCard(f),
        productionRankInput: insightRankInput(staleInsight(f)),
        adoption: adopt(f),
      })
      expect(report.ok, `${f}: ${explainParity(report)}`).toBe(true)
    }
  })

  it('produces the identical tier and total in every framing', () => {
    for (const f of FRAMINGS) {
      const oldP = priorityFor(insightRankInput(staleInsight(f)), NOW)
      const newP = priorityFor(situationPriorityInput(adoption(f).situation), NOW)
      expect(newP.tier, f).toBe(oldP.tier)
      expect(newP.total, f).toBe(oldP.total)
    }
  })

  /**
   * The base varies by framing, which is the whole reason this family matters.
   *
   * Unanswered evidence leads an unaccounted move, which leads a long quiet.
   * The engine carries `researchBaseFor` rather than computing anything.
   */
  it('carries the framing base and preserves its order', () => {
    const bases = FRAMINGS.map(f => situationPriorityInput(adoption(f).situation).base!)
    const [move, evidence, silence] = bases
    expect(move).toBe(researchBaseFor(staleInsight('price_move').issue))
    expect(evidence).toBeGreaterThan(move)
    expect(move).toBeGreaterThan(silence)
  })

  /**
   * The move's magnitude lives in the base and never in the deviation.
   *
   * `researchBaseFor` documents why: `deviationBand` is weighted more than the
   * entire spread between the framing bases, so passing the move twice inverted
   * the family's specified order. The engine must not reintroduce it.
   */
  it('passes no deviation, so the move is never counted twice', () => {
    for (const f of FRAMINGS) {
      expect(situationPriorityInput(adoption(f).situation).deviationPct, f).toBeNull()
    }
  })

  it('lets a bigger move order price_move against itself', () => {
    // Both past MOVE_PCT so both are cards; only the magnitude differs, and
    // the small one is below SEVERE_MOVE_PCT so the lift has room to move.
    const small = staleInsight('price_move')
    small.issue = { ...small.issue, movePct: -18 }
    const big = staleInsight('price_move')
    big.issue = { ...big.issue, movePct: -55 }
    const a = adoptResearchInsight(small, staleCard('price_move'), READER, PHONE)
    const b = adoptResearchInsight(big, staleCard('price_move'), READER, PHONE)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(situationPriorityInput(b.adoption.situation).base!)
      .toBeGreaterThan(situationPriorityInput(a.adoption.situation).base!)
    // And still never reaches the evidence framing.
    expect(situationPriorityInput(b.adoption.situation).base!)
      .toBeLessThan(researchBaseFor(staleInsight('new_evidence').issue))
  })

  it('carries the same materiality inputs and recency anchor', () => {
    for (const f of FRAMINGS) {
      const oldIn = insightRankInput(staleInsight(f))
      const newIn = situationPriorityInput(adoption(f).situation)
      expect(newIn.weightPct, f).toBe(oldIn.weightPct)
      expect(newIn.held, f).toBe(oldIn.held)
      expect(new Date(String(newIn.occurredAt)).getTime(), f)
        .toBe(new Date(String(oldIn.occurredAt)).getTime())
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Part 6 — presentation
// ─────────────────────────────────────────────────────────────────────────────

describe('presentation', () => {
  it('states the essential metric production states', () => {
    expect(adoption('price_move').copy.metric?.value).toBe('−30.5%')
    expect(staleCard('price_move').metric?.value).toBe('−30.5%')

    expect(adoption('new_evidence').copy.metric?.value).toBe('3')
    expect(staleCard('new_evidence').metric?.value).toBe('3')

    expect(adoption('long_silence').copy.metric?.value).toBe('210d')
    expect(staleCard('long_silence').metric?.value).toBe('210d')
  })

  it('falls back to the elapsed time when a count is not worth leading with', () => {
    const one = staleInsight('new_evidence')
    one.issue = {
      ...one.issue,
      evidence: [{ id: 'e1', at: '2026-06-01T00:00:00.000Z', kind: 'note' as const }],
    }
    const r = adoptResearchInsight(one, staleCard('new_evidence'), READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The shipping card does the same, for the reason it records: one item is
    // not a quantity worth putting at hero size.
    expect(r.adoption.copy.metric?.value).toBe('210d')
  })

  it('leads with what happened rather than with the price', () => {
    expect(adoption('price_move').copy.headline).toContain('has moved and the written view has not followed')
    expect(adoption('new_evidence').copy.headline).toContain('Material has arrived')
    expect(adoption('long_silence').copy.headline).toContain('Nobody has revisited')
  })

  it('keeps the card identity and every feed-contract field', () => {
    for (const f of FRAMINGS) {
      const card = staleCard(f)
      const next = adoption(f).card
      expect(next.id, f).toBe(card.id)
      expect(next.type, f).toBe(card.type)
      expect(next.severity, f).toBe(card.severity)
      expect(next.dedupeKey, f).toBe(card.dedupeKey)
      expect(next.entity, f).toEqual(card.entity)
      expect(next.kindLabel, f).toBe(card.kindLabel)
    }
  })

  /**
   * The producer's own evidence data survives; the plan names the shape.
   *
   * `buildInsightCard` carries a sparkline anchored on the review date, and the
   * projection keeps that payload rather than rebuilding it — a picture assembled
   * twice is a picture that can disagree with itself.
   */
  it('keeps the evidence the producer assembled', () => {
    for (const f of FRAMINGS) {
      expect(staleCard(f).evidence?.kind, f).toBe('sparkline')
      expect(adoption(f).card.evidence?.data, f).toEqual(staleCard(f).evidence?.data)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Part 5 — composition against everything already adopted
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One name, so composition has something to compose.
 *
 * Every fixture is re-pointed at NKE. All five combinations are producible:
 * the lenses read `analyst_price_targets`, the scenario hook reads the ladder
 * in that same table, and the research scan reads `investment_case`
 * contributions — different objects on one security.
 */
const NKE = { assetId: 'a-nke', symbol: 'NKE', companyName: 'Nike' }

const moveOn = () => adopt('price_move')

const dislocationOn = () =>
  adoptScenarioGap(dislocationCard({ ...NKE }), { weightPct: 2.6 }, READER, PHONE)

const hitOn = () =>
  adoptTargetHit(targetBreachRow(NKE), targetHitCard(NKE), READER, PHONE)

const expiredOn = () =>
  adoptStaleTarget(staleTargetRow(NKE), staleTargetCard(NKE), READER, PHONE)

const thesisOn = () =>
  adoptResearchInsight(
    thesisInsight({ assetId: 'a-nke', symbol: 'NKE', companyName: 'Nike' }),
    thesisCard({ assetId: 'a-nke', symbol: 'NKE', companyName: 'Nike' }),
    READER, PHONE,
  )

describe('composition matrix', () => {
  it('A. Unreviewed Move alone: 1 finding, 1 situation, 1 tile, research', () => {
    const c = composeForSubject([moveOn()])
    expect(c.tileCount).toBe(1)
    expect(c.absorbed).toBe(0)
    expect(c.questions).toEqual(['research'])
  })

  it('B. + Case vs Price: 2 findings, 2 situations, 2 tiles', () => {
    const c = composeForSubject([moveOn(), dislocationOn()])
    // Same subject, so the split is the question and nothing else.
    expect(new Set(c.situations.map(s => s.subject.id))).toEqual(new Set(['a-nke']))
    expect(c.tileCount).toBe(2)
    expect(c.absorbed).toBe(0)
    expect([...c.questions].sort()).toEqual(['framework', 'research'])
  })

  it('C. + Target Hit: 2 findings, 2 situations, 2 tiles', () => {
    const c = composeForSubject([moveOn(), hitOn()])
    expect(c.tileCount).toBe(2)
    expect(c.absorbed).toBe(0)
    expect([...c.questions].sort()).toEqual(['research', 'target'])
  })

  it('D. + Target Expired: 2 findings, 2 situations, 2 tiles', () => {
    const c = composeForSubject([moveOn(), expiredOn()])
    expect(c.tileCount).toBe(2)
    expect(c.absorbed).toBe(0)
    expect([...c.questions].sort()).toEqual(['research', 'target'])
  })

  it('E. + No Core Thesis: 2 findings, 2 situations, 2 tiles', () => {
    const c = composeForSubject([moveOn(), thesisOn()])
    expect(c.tileCount).toBe(2)
    expect(c.absorbed).toBe(0)
    expect([...c.questions].sort()).toEqual(['research', 'thesis'])
  })

  /**
   * The one merge in the matrix, and it is not with Unreviewed Move.
   *
   * Target Hit and Target Expired share the target question, so they compose.
   * Unreviewed Move joins neither of them, because "has the view changed" is
   * not "what should this be worth".
   */
  it('everything at once: 4 findings, 3 situations, 3 tiles', () => {
    const c = composeForSubject([moveOn(), hitOn(), expiredOn(), thesisOn()])
    expect(c.tileCount).toBe(3)
    expect(c.absorbed).toBe(1)
    expect([...c.questions].sort()).toEqual(['research', 'target', 'thesis'])
  })

  /**
   * The pair Unreviewed Move is most often confused with.
   *
   * A material move the case has not accounted for and a price outside the
   * modelled band are both "the price did something". They are not one
   * question: the first asks whether the written view still holds, the second
   * asks whether the case that was written is still the case. Production says
   * so too — `research_stale` is tier 2 and `scenario_gap` is tier 0.
   */
  it('never merges a move with a broken framework', () => {
    const c = composeForSubject([moveOn(), dislocationOn()])
    const [move, gap] = c.situations.sort((a, b) => a.question < b.question ? 1 : -1)
    expect(move.question).toBe('research')
    expect(gap.question).toBe('framework')
    expect(move.lead.signalType).toBe('research_stale')
    expect(gap.lead.signalType).toBe('scenario_gap')
  })
})
