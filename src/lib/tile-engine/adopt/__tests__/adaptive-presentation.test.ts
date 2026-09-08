/**
 * The picture the resolver chose, and whether it reaches the reader.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * The plan has always named a primitive. Nothing rendered it. `SignalCardView`
 * reads `card.evidence.kind` as a gate and takes the NODE from its caller, and
 * the caller is a component with hand-written per-kind panes that predate the
 * engine. So an adopted card got the plan's copy, metric, actions, context and
 * accent rail — and the picture the feed had always drawn for that producer.
 * Every situation whose claim is not about the price still led with the price.
 *
 * `visualDataFor` is the missing link: the lead claim, expressed as the union
 * `ExploreVisualBlock` already draws. This file is the proof that the three
 * situations in front of us resolve to three different pictures, that two of
 * them share one primitive, and that no picture is drawn from data that is not
 * there.
 */

import { describe, expect, it } from 'vitest'

import {
  adoptCoverageGap, adoptScenarioGap, adoptStaleTarget, adoptWorkOverdue,
} from '../mobile'
import { visualDataFor } from '../visual'
import { workOverdueFinding } from '../producers'
import { resolvePresentation } from '../../resolver'
import { composeSituations } from '../../situation'
import { PRIMITIVE_COMPONENTS } from '../../presentation'
import { SITUATION_DEFINITIONS } from '../../situations'
import { buildAttentionCard } from '../../../signals/builders/legacy-kinds'
import { feedActionIsRoutable } from '../../../signals/feed-actions'
import {
  COVERAGE_ASSET, COVERAGE_NOW, PHONE, coverageCard, coverageRow,
  dislocationCard, staleTargetCard, staleTargetRow,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }

const unwrap = (r: ReturnType<typeof adoptScenarioGap>) => {
  if (!r.ok) throw new Error(`unexpected decline: ${r.reason} — ${r.detail}`)
  return r.adoption
}

// ─────────────────────────────────────────────────────────────────────────────
// Case vs Price — the valuation picture
// ─────────────────────────────────────────────────────────────────────────────

describe('Case vs Price draws the case, not the tape', () => {
  const adoption = () => unwrap(adoptScenarioGap(dislocationCard(), null, READER, PHONE))

  it('resolves to the band with the price marked on it', () => {
    const v = adoption().visual
    expect(v?.kind).toBe('scenario_range')
  })

  /**
   * The numbers are the producer's own, straight off the claim.
   *
   * `scenarioGapFinding` built the band from `deriveScenarioState`, which is
   * the one assembler of ladder geometry in the product. Nothing here recomputes
   * a level, and the test compares against the claim rather than against a
   * literal so it cannot drift from what the adapter said.
   */
  it('carries the modelled ends and the live price unchanged', () => {
    const { situation, visual } = adoption()
    const band = situation.lead.claim.band!
    expect(visual).toMatchObject({ low: band.low, high: band.high, current: band.current })
  })

  it('ticks every case the producer carried', () => {
    const v = adoption().visual
    if (v?.kind !== 'scenario_range') throw new Error('not a range')
    expect((v.cases ?? []).length).toBeGreaterThan(1)
    for (const c of v.cases ?? []) {
      expect(c.label).toBeTruthy()
      expect(Number.isFinite(c.price)).toBe(true)
    }
  })

  /**
   * The whole point of Part 2, as an assertion.
   *
   * A price series is what this card used to lead with, and it answers a
   * different question — where the price has been, not where it sits against
   * what somebody modelled.
   */
  it('never falls back to the price series while a band exists', () => {
    expect(adoption().visual?.kind).not.toBe('price_trend')
    expect(adoption().plan.visuals[0].primitive).toBe('scenario_range')
  })

  /**
   * No fake levels.
   *
   * With no band on the claim there is nothing to draw, and the honest answer
   * is no picture rather than a range invented from one end.
   */
  it('draws nothing rather than a band it does not have', () => {
    const { situation, plan } = adoption()
    const bandless = { ...situation, lead: { ...situation.lead, claim: { ...situation.lead.claim, band: null } } }
    expect(visualDataFor(bandless, plan, dislocationCard())).toBeNull()
  })

  it('draws nothing when the band has collapsed to a point', () => {
    const { situation, plan } = adoption()
    const flat = {
      ...situation,
      lead: { ...situation.lead, claim: { ...situation.lead.claim, band: { low: 100, high: 100, current: 120 } } },
    }
    expect(visualDataFor(flat, plan, null)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Coverage Gap — elapsed time, and no deadline that was never set
// ─────────────────────────────────────────────────────────────────────────────

describe('Coverage Gap draws the silence', () => {
  const adoption = () => {
    const r = adoptCoverageGap(coverageRow() as never, coverageCard(), READER, PHONE, COVERAGE_NOW)
    if (!r.ok) throw new Error('declined')
    return r.adoption
  }

  it('resolves to the temporal primitive', () => {
    expect(adoption().visual?.kind).toBe('timeline')
    expect(adoption().plan.visuals[0].primitive).toBe('timeline')
  })

  /**
   * One segment, because nobody set a date.
   *
   * The collector fires on three weeks of quiet; that is a rule, not a
   * commitment somebody made. Drawing an amber "due" cap on it would assert a
   * promise that does not exist — the same refusal `target_compare` makes about
   * a target nobody wrote.
   */
  it('carries no due date, because none was ever given', () => {
    const v = adoption().visual
    if (v?.kind !== 'timeline') throw new Error('not a timeline')
    expect(v.dueAt).toBeUndefined()
    expect(v.statedAt).toBe(coverageRow().last_activity_at)
  })

  it('names the span in the reader own terms', () => {
    const v = adoption().visual
    if (v?.kind !== 'timeline') throw new Error('not a timeline')
    expect(v.overdueLabel).toBe('since your last contribution')
  })

  it('is not a price picture', () => {
    expect(adoption().visual?.kind).not.toBe('price_trend')
    expect(adoption().visual?.kind).not.toBe('last_look')
  })

  /** The action decided last stage survives this one. */
  it('still opens the name as its primary', () => {
    expect(adoption().card.actions.primary.id).toBe('open_asset')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Overdue — work and time, not market price
// ─────────────────────────────────────────────────────────────────────────────

describe('Overdue draws the deadline it missed', () => {
  const NOW = Date.parse('2026-09-08T00:00:00.000Z')
  const row = (over: Record<string, unknown> = {}) => ({
    attention_id: 'att-overdue-1',
    attention_type: 'action_required' as const,
    reason_code: 'task_overdue',
    reason_text: 'Model refresh is past its date',
    title: 'Q3 model refresh',
    subtitle: 'Coverage review',
    tags: ['overdue'],
    created_at: '2026-08-01T00:00:00.000Z',
    last_activity_at: '2026-08-20T00:00:00.000Z',
    due_at: '2026-08-25T00:00:00.000Z',
    next_action: 'Finish the model',
    severity: 'high',
    context: { asset_id: 'a-amzn' },
    ...over,
  })
  const card = (over: Record<string, unknown> = {}) => {
    const r = buildAttentionCard(row(over) as never, COVERAGE_ASSET)
    if (!r.ok) throw new Error(`fixture suppressed: ${r.reason}`)
    return r.card
  }
  const adoption = (over: Record<string, unknown> = {}) => {
    const r = adoptWorkOverdue(row(over) as never, card(over), READER, PHONE, NOW)
    if (!r.ok) throw new Error(`declined: ${r.reason} — ${r.detail}`)
    return r.adoption
  }

  it('resolves to the temporal primitive, with the date it missed', () => {
    const v = adoption().visual
    if (v?.kind !== 'timeline') throw new Error('not a timeline')
    expect(v.dueAt).toBe(row().due_at)
    expect(v.statedAt).toBe(row().created_at)
  })

  it('leads with how late it is, in days', () => {
    const { copy } = adoption()
    // Due 25 Aug, now 8 Sep.
    expect(copy.metric?.value).toBe('14d')
    expect(copy.metric?.label).toBe('Late')
    expect(copy.body).toContain('Due')
  })

  /**
   * The sentence is about the work, not about the ticker.
   *
   * `buildAttentionCard` gives the card an asset entity when the row names one,
   * which is right for the chip and the deep link and wrong for the claim. The
   * finding's subject is the deliverable.
   */
  it('names the work rather than the asset it concerns', () => {
    expect(adoption().situation.subject.kind).toBe('project')
    expect(adoption().copy.headline).toContain('Q3 model refresh')
    expect(adoption().copy.headline).not.toContain('AMZN')
    // And the asset stays on the card, as supporting context.
    expect(adoption().card.entity.ticker).toBe('AMZN')
  })

  it('is not a price picture', () => {
    expect(adoption().visual?.kind).not.toBe('price_trend')
  })

  it('opens the item, which is a real supported destination', () => {
    const primary = adoption().card.actions.primary
    expect(primary.id).toBe('open_item')
    expect(feedActionIsRoutable(primary.id, { assetId: 'a-amzn', symbol: 'AMZN' })).toBe(true)
  })

  /**
   * A row with no date missed nothing.
   *
   * `attentionCardType` types every `action_required` row `project_overdue`,
   * including the many that carry no `due_at` at all. Those decline and render
   * exactly as they ship.
   */
  it('declines a row that was never given a date', () => {
    const r = workOverdueFinding({
      item: row({ due_at: null }) as never, card: card({ due_at: null }),
      coverage: 'direct', now: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it('declines work that is not late yet', () => {
    const r = workOverdueFinding({
      item: row({ due_at: '2026-12-01T00:00:00.000Z' }) as never,
      card: card({ due_at: '2026-12-01T00:00:00.000Z' }),
      coverage: 'direct', now: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('not_an_attention_state')
  })

  it('keeps its number when there is no span to draw', () => {
    const a = adoptWorkOverdue(
      row({ created_at: null }) as never, card({ created_at: null }), READER, PHONE, NOW,
    )
    if (!a.ok) throw new Error('declined')
    expect(a.adoption.copy.metric?.value).toBe('14d')
    // No interval, so no track — and no invented one.
    expect(a.adoption.visual).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The vocabulary
// ─────────────────────────────────────────────────────────────────────────────

describe('the primitives are shared, not per situation', () => {
  const NOW = Date.parse('2026-09-08T00:00:00.000Z')

  /**
   * The claim this whole stage rests on.
   *
   * Coverage neglect and overdue work are different producers, different
   * questions, different subjects and different sentences — and they draw
   * through one primitive, which decides its own shape from whether a deadline
   * exists. A second timeline component for either would have been the widget
   * zoo this architecture exists to prevent.
   */
  it('one temporal primitive serves coverage, overdue and a lapsed horizon', () => {
    const coverage = adoptCoverageGap(coverageRow() as never, coverageCard(), READER, PHONE, COVERAGE_NOW)
    const target = adoptStaleTarget(staleTargetRow(), staleTargetCard(), READER, PHONE)
    if (!coverage.ok || !target.ok) throw new Error('declined')

    expect(coverage.adoption.visual?.kind).toBe('timeline')
    expect(target.adoption.visual?.kind).toBe('timeline')
    expect(SITUATION_DEFINITIONS.work_overdue.predicate)
      .toBe(SITUATION_DEFINITIONS.target_expired.predicate)

    // And the same component draws all of them.
    expect(PRIMITIVE_COMPONENTS.timeline).toBe('src/components/signals/HorizonTimeline.tsx')
  })

  it('every kind resolves to a primitive in the closed vocabulary', () => {
    const kinds = Object.keys(PRIMITIVE_COMPONENTS)
    for (const [kind, def] of Object.entries(SITUATION_DEFINITIONS)) {
      const plan = resolvePresentation({
        situation: composeSituations([{
          id: `probe:${kind}`, kind: kind as never, subject: { kind: 'asset', id: 'a', name: 'A' },
          question: def.question, claim: { predicate: def.predicate }, facts: [],
          stakes: {}, occurredAt: '2026-09-01T00:00:00.000Z', severity: 'attention',
          signalType: def.signalType, intents: def.intents,
        }])[0],
        surface: 'mobile_brief',
        viewer: { canCommit: false, coverage: 'direct' },
        container: PHONE,
        state: 'passive',
      })
      for (const v of plan.visuals) expect(kinds, kind).toContain(v.primitive)
    }
  })

  /**
   * The plan says what it means, never what to render it with.
   *
   * A plan carrying a component name would be a template, and a template per
   * situation is the thing this whole design refuses. The rationale is prose
   * for a human and is exempt.
   */
  it('the plan names no components', () => {
    const { plan } = unwrap(adoptScenarioGap(dislocationCard(), null, READER, PHONE))
    const serialised = JSON.stringify({ ...plan, rationale: [] })
    expect(serialised).not.toMatch(/\.tsx|Widget|Component|Card\b/)
  })

  it('is deterministic for the same inputs', () => {
    const once = adoptWorkOverdue(
      { attention_id: 'x', title: 'T', due_at: '2026-08-01T00:00:00.000Z', created_at: '2026-07-01T00:00:00.000Z' },
      coverageCard(), READER, PHONE, NOW,
    )
    const twice = adoptWorkOverdue(
      { attention_id: 'x', title: 'T', due_at: '2026-08-01T00:00:00.000Z', created_at: '2026-07-01T00:00:00.000Z' },
      coverageCard(), READER, PHONE, NOW,
    )
    if (!once.ok || !twice.ok) throw new Error('declined')
    expect(once.adoption.visual).toEqual(twice.adoption.visual)
    expect(once.adoption.copy).toEqual(twice.adoption.copy)
  })
})
