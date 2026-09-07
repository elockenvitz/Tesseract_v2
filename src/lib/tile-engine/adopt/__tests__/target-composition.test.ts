/**
 * Target Hit, and the first composition that actually removes a tile.
 *
 * Every card here is built by the shipping builder from a shipping lens row,
 * and every ranking input is `rankInputFor`'s own branch transcribed. A failure
 * means the engine disagrees with what ships.
 */

import { describe, expect, it } from 'vitest'

import {
  absorbedTargetLenses, composeTargetPair, findingsBehind, type TargetPair,
} from '../target-composition'
import { adoptComposedTarget, adoptStaleTarget, adoptTargetHit } from '../mobile'
import { compareParity, explainParity } from '../compare'
import { situationPriorityInput } from '../../importance'
import { priorityFor } from '../../../signals/feed-priority'
import { readerQuestionFor } from '../../../signals/reader-question'
import { targetHitSeverity } from '../../../signals/lens-severity'
import {
  NOW, PHONE, staleTargetCard, staleTargetRankInput, staleTargetRow,
  targetBreachRow, targetHitCard, targetHitRankInput,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }
const COVERAGE = () => 'direct' as const

const pairFor = (
  hitOver: Parameters<typeof targetBreachRow>[0] = {},
  staleOver: Parameters<typeof staleTargetRow>[0] = {},
): TargetPair => ({
  assetId: 'a-msft',
  hit: { row: targetBreachRow(hitOver), card: targetHitCard(hitOver) },
  expired: { row: staleTargetRow(staleOver), card: staleTargetCard(staleOver) },
})

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — Target Hit parity
// ─────────────────────────────────────────────────────────────────────────────

describe('Target Hit', () => {
  const row = targetBreachRow()
  const card = targetHitCard()

  it('is detected as the same situation', () => {
    const r = adoptTargetHit(row, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.situation.lead.signalType).toBe('target_hit')
    expect(r.adoption.situation.question).toBe('target')
    expect(r.adoption.situation.lead.claim.predicate).toBe('threshold_passed')
  })

  it('passes every parity axis', () => {
    const report = compareParity({
      original: card,
      productionRankInput: targetHitRankInput(row),
      adoption: adoptTargetHit(row, card, READER, PHONE),
    })
    expect(report.ok, explainParity(report)).toBe(true)
  })

  it('produces the identical ranking score', () => {
    const r = adoptTargetHit(row, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const oldP = priorityFor(targetHitRankInput(row), NOW)
    const newP = priorityFor(situationPriorityInput(r.adoption.situation), NOW)
    expect(newP.tier).toBe(oldP.tier)
    expect(newP.total).toBe(oldP.total)
  })

  /**
   * The card and the ranker now agree, and adoption D is why.
   *
   * `buildTargetHitCard` promoted at a 10% overshoot while the ranker promoted
   * at `MATERIAL_DEVIATION_PCT`, so an 11% position wore a critical rail and
   * scored as `attention` — and `judgmentPresentationFor` reads the card's
   * severity, so it also asked its question inline on a case the product's own
   * materiality bar calls immaterial. Both now come from `targetHitSeverity`.
   */
  it('takes one severity from one derivation', () => {
    const over = { overshootPct: 0.11 }
    const r = adoptTargetHit(targetBreachRow(over), targetHitCard(over), READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(targetHitSeverity(0.11)).toBe('attention')
    expect(targetHitCard(over).severity).toBe('attention')
    expect(r.adoption.card.severity).toBe('attention')
    expect(situationPriorityInput(r.adoption.situation).severity).toBe('attention')
  })

  it('still promotes past the material bar', () => {
    const over = { overshootPct: 0.18 }
    expect(targetHitCard(over).severity).toBe('critical')
    expect(targetHitSeverity(0.18)).toBe('critical')
  })

  /**
   * Classification and magnitude stay separate concepts.
   *
   * The scorer keeps receiving the continuous overshoot, so an 18% hit still
   * orders above a 16% one inside the tier even though both classify the same.
   */
  it('keeps the continuous overshoot for scoring', () => {
    const a = adoptTargetHit(targetBreachRow({ overshootPct: 0.18 }), targetHitCard({ overshootPct: 0.18 }), READER, PHONE)
    const b = adoptTargetHit(targetBreachRow({ overshootPct: 0.16 }), targetHitCard({ overshootPct: 0.16 }), READER, PHONE)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const ia = situationPriorityInput(a.adoption.situation)
    const ib = situationPriorityInput(b.adoption.situation)
    expect(ia.severity).toBe(ib.severity)
    expect(ia.deviationPct).toBeGreaterThan(ib.deviationPct!)
  })

  it('draws the price against the one level it passed', () => {
    const r = adoptTargetHit(row, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.plan.visuals[0]?.primitive).toBe('target_compare')
    expect(r.adoption.situation.lead.claim.threshold).toMatchObject({
      level: 520, observed: 613.6, label: 'Base',
    })
  })

  it('keeps the card identity and every feed-contract field', () => {
    const r = adoptTargetHit(row, card, READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const next = r.adoption.card
    expect(next.id).toBe(card.id)
    expect(next.type).toBe(card.type)
    expect(next.dedupeKey).toBe(card.dedupeKey)
    expect(next.entity).toEqual(card.entity)
    expect(next.provenance).toEqual(card.provenance)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — A, B, C
// ─────────────────────────────────────────────────────────────────────────────

describe('A. Target Hit only', () => {
  it('is one situation and one tile', () => {
    const c = composeTargetPair({ assetId: 'a-msft', hit: pairFor().hit }, 'direct')
    expect(c).toBeTruthy()
    expect(c!.lead).toBe('breach')
    expect(c!.absorbed).toBeNull()
    expect(findingsBehind(c!)).toBe(1)
  })
})

describe('B. Target Expired only', () => {
  it('is one situation and one tile', () => {
    const c = composeTargetPair({ assetId: 'a-msft', expired: pairFor().expired }, 'direct')
    expect(c).toBeTruthy()
    expect(c!.lead).toBe('stale')
    expect(c!.absorbed).toBeNull()
    expect(findingsBehind(c!)).toBe(1)
  })
})

describe('C. Target Hit + Target Expired on one name', () => {
  it('composes into ONE situation carrying two findings', () => {
    const c = composeTargetPair(pairFor(), 'direct')!
    expect(c.situation.supporting).toHaveLength(1)
    expect(findingsBehind(c)).toBe(2)
  })

  it('they compose because they ask one question, not because they look alike', () => {
    expect(readerQuestionFor('target_hit')).toBe('target')
    expect(readerQuestionFor('target_expired')).toBe('target')
    expect(composeTargetPair(pairFor(), 'direct')!.situation.question).toBe('target')
  })

  it('the reached target leads and the expired one corroborates', () => {
    const c = composeTargetPair(pairFor(), 'direct')!
    expect(c.lead).toBe('breach')
    expect(c.absorbed).toBe('stale')
    expect(c.situation.lead.kind).toBe('target_reached')
    expect(c.situation.supporting[0].kind).toBe('target_expired')
  })

  /**
   * Severity decides first, and it can hand the lead to the other one.
   *
   * `compareFindings` is severity, then kind precedence, then recency, then id.
   * A target six months past its horizon is critical; an 11% overshoot is not,
   * by the ranker's threshold — so the clock leads that name.
   */
  it('lets severity override the kind precedence', () => {
    const c = composeTargetPair(pairFor({ overshootPct: 0.11 }, { overdueMonths: 6 }), 'direct')!
    expect(c.lead).toBe('stale')
    expect(c.because).toContain('critical outranks attention')
  })

  it('falls back to kind precedence when severity ties', () => {
    const c = composeTargetPair(pairFor({ overshootPct: 0.18 }, { overdueMonths: 6 }), 'direct')!
    // Both critical: the event leads the clock, as TIER 0.85 vs 0.80 says.
    expect(c.situation.lead.severity).toBe(c.situation.supporting[0].severity)
    expect(c.lead).toBe('breach')
    expect(c.because).toContain('equal severity')
  })

  it('is deterministic whichever order the rows arrive in', () => {
    const forward = composeTargetPair(pairFor(), 'direct')!
    const p = pairFor()
    const reversed = composeTargetPair(
      { assetId: p.assetId, expired: p.expired, hit: p.hit }, 'direct')!
    expect(reversed.lead).toBe(forward.lead)
    expect(reversed.situation.lead.id).toBe(forward.situation.lead.id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Corroboration must not become a second rank boost
// ─────────────────────────────────────────────────────────────────────────────

describe('composition changes the tile count and not the score', () => {
  it('ranks exactly as the lead alone ranked', () => {
    const composed = composeTargetPair(pairFor(), 'direct')!
    const alone = composeTargetPair({ assetId: 'a-msft', hit: pairFor().hit }, 'direct')!
    expect(priorityFor(situationPriorityInput(composed.situation), NOW).total)
      .toBe(priorityFor(situationPriorityInput(alone.situation), NOW).total)
  })

  it('ranks exactly as the shipping breach card ranked', () => {
    const composed = composeTargetPair(pairFor(), 'direct')!
    const oldP = priorityFor(targetHitRankInput(targetBreachRow()), NOW)
    const newP = priorityFor(situationPriorityInput(composed.situation), NOW)
    expect(newP.tier).toBe(oldP.tier)
    expect(newP.total).toBe(oldP.total)
  })

  it('does not inherit the absorbed finding’s deviation', () => {
    const composed = composeTargetPair(pairFor(), 'direct')!
    const input = situationPriorityInput(composed.situation)
    // 18% overshoot, not the stale card's overdueMonths x 5.
    expect(input.deviationPct).toBeCloseTo(18, 5)
    expect(input.deviationPct).not.toBe(staleTargetRankInput().deviationPct)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The feed slot actually goes away, and the reader is told
// ─────────────────────────────────────────────────────────────────────────────

describe('two legacy cards become one tile', () => {
  it('names the entry the feed should drop', () => {
    const absorbed = absorbedTargetLenses([pairFor()], COVERAGE)
    expect(absorbed.get('a-msft')).toBe('stale')
  })

  it('drops nothing for a name with only one of the two', () => {
    const onlyHit: TargetPair = { assetId: 'a-msft', hit: pairFor().hit }
    expect(absorbedTargetLenses([onlyHit], COVERAGE).size).toBe(0)
  })

  it('the surviving tile says a second finding was folded in', () => {
    const r = adoptComposedTarget(pairFor(), targetHitCard(), READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const labels = r.adoption.card.context.map(c => c.label)
    expect(labels).toContain('2 findings')
  })

  it('a single finding gets no corroboration chip', () => {
    const r = adoptTargetHit(targetBreachRow(), targetHitCard(), READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.card.context.map(c => c.label)).not.toContain('2 findings')
  })

  it('the survivor keeps the lead card’s identity, so nothing downstream moves', () => {
    const r = adoptComposedTarget(pairFor(), targetHitCard(), READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.card.id).toBe(targetHitCard().id)
    expect(r.adoption.card.type).toBe('target_hit')
    expect(r.adoption.card.dedupeKey).toBe(targetHitCard().dedupeKey)
  })

  /**
   * The absorbed card is not deleted from the product.
   *
   * Adopting the expired row on its own still yields its own situation and its
   * own card, which is what Explore and a direct open still reach. Only the
   * FEED shows one tile.
   */
  it('the absorbed finding is still reachable on its own', () => {
    const r = adoptStaleTarget(staleTargetRow(), staleTargetCard(), READER, PHONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.adoption.situation.lead.kind).toBe('target_expired')
  })
})
