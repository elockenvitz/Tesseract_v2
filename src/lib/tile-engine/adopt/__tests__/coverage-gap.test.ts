/**
 * Coverage Gap: whose name is this, and is anybody still answering for it?
 *
 * ── The question this family was not being asked ──────────────────────────
 *
 * `collectNeglectedCoverage` walks the reader's own active coverage rows and
 * raises any name with no research contribution in three weeks. It stamps
 * `attention_type: 'action_required'`, which `ATTENTION_CARD_TYPE` maps to
 * `project_overdue` — so the tile printed "Overdue", answered to the Overdue
 * pill, and told a reader that a deadline had passed on work nobody assigned.
 *
 * Reported from a phone in those words: "overdue doesn't seem like the right
 * type since it's coverage being stale."
 *
 * ── What is asserted here ─────────────────────────────────────────────────
 *
 * The card comes out of `buildAttentionCard` from a row transcribed field for
 * field off the collector, and the ranking input is `rankInputFor`'s attention
 * branch transcribed. So a failure means the engine disagrees with what ships,
 * not with a fixture.
 *
 * Two of the eleven cases in this matrix have no producer — nothing in the
 * product raises "this position has no analyst" or "the owner changed and
 * nobody reviewed". Those are asserted as SEAMS: the situation exists, resolves
 * and composes, and no production path reaches it. Manufacturing a fixture that
 * pretended otherwise would be the one thing this adoption must not do.
 */

import { describe, expect, it } from 'vitest'

import { adoptCoverageGap, adoptResearchInsight, cardOrOriginal } from '../mobile'
import { compareParity } from '../compare'
import { coverageStaleFinding } from '../producers'
import { composeSituations } from '../../situation'
import { coverageGapFinding } from '../../builders'
import { SITUATION_DEFINITIONS } from '../../situations'
import { situationPriorityInput } from '../../importance'
import type { Fact } from '../../facts'
import { priorityFor, type PriorityInput } from '../../../signals/feed-priority'
import { feedActionIsRoutable } from '../../../signals/feed-actions'
import { readerQuestionFor } from '../../../signals/reader-question'
import { categoryForType } from '../../../signals/content-registry'
import { buildAttentionCard } from '../../../signals/builders/legacy-kinds'
import { coverageDuplicateAssets, suppressCoveredAttention } from '../../../signals/feed-dedupe'
import { attentionCardType, attentionSignalType } from '../../../mobile/entry-signal-type'
import {
  displayFamilyOf, entryHasExactFamily, familyLabel, familyOf,
} from '../../../mobile/feed-categories'
import { deriveFeedView } from '../../../mobile/feed-continuity'
import { KIND_LABEL } from '../../../../components/signals/card-identity'
import {
  COVERAGE_ASSET, COVERAGE_LAST_LOOK, COVERAGE_NOW, NOW, PHONE,
  attentionRankInput, coverageCard, coverageRow, staleCard, staleInsight,
  thesisCard, thesisInsight,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }

/** The reference fixtures' own helper, which is not exported from them. */
const fact = <V,>(key: string, value: V, source: Fact['source'], asOf: string): Fact<V> =>
  ({ key, value, source, asOf })

const adopt = (over: Record<string, unknown> = {}) =>
  adoptCoverageGap(coverageRow(over) as never, coverageCard(over), READER, PHONE, COVERAGE_NOW)

const adoption = (over: Record<string, unknown> = {}) => {
  const r = adopt(over)
  if (!r.ok) throw new Error(`unexpected decline: ${r.reason} — ${r.detail}`)
  return r.adoption
}

/** The elapsed span the fixture is built around, stated once. */
const DAYS = Math.floor((COVERAGE_NOW - Date.parse(COVERAGE_LAST_LOOK)) / 86_400_000)

// ─────────────────────────────────────────────────────────────────────────────
// 1 + 3. The two cases with no producer
// ─────────────────────────────────────────────────────────────────────────────

describe('the seams: what the product cannot currently notice', () => {
  /**
   * Nothing raises "this position has nobody assigned to it".
   *
   * `collectNeglectedCoverage` starts FROM the coverage table, filtered to rows
   * the reader owns. A name with no coverage row produces no row to walk, so
   * the absence is invisible to it by construction, and no other collector
   * looks. The finding kind and its reference builder exist — this asserts they
   * are unreachable rather than pretending a fixture reaches them.
   */
  it('has a coverage_gap situation and no production path to it', () => {
    const unowned = coverageGapFinding({
      subject: { kind: 'asset', id: 'a-nvda', name: 'NVIDIA', ticker: 'NVDA' },
      analyst: fact('analyst_id', null, 'stated', '2026-09-01T00:00:00.000Z'),
      weightPct: 7.1,
      stakes: { coverage: 'none' },
      observedAt: '2026-09-01T00:00:00.000Z',
    }, NOW)!

    expect(unowned.claim.predicate).toBe('unowned')
    expect(unowned.question).toBe('coverage')
    expect(unowned.intents[0]).toBe('assign_coverage')

    // And the only production row that reaches this family says the opposite:
    // somebody covers it. `coverage_neglected` is raised from the reader's own
    // active coverage.
    expect(coverageRow().reason_code).toBe('coverage_neglected')
    expect(adoption().situation.lead.kind).toBe('coverage_stale')
  })

  /**
   * An ownership change is an audit event, not an attention item.
   *
   * `user.coverage_admin_changed` and `team_node.coverage_override_changed` are
   * org-activity rows read by the desktop organisation page. Nothing turns them
   * into a candidate, so "the owner changed and nobody has reviewed since" has
   * no observation behind it. Recorded so the gap is a decision rather than an
   * oversight.
   */
  it('raises no attention item for a coverage ownership change', () => {
    const reasons = ['coverage_neglected', 'earnings_upcoming']
    expect(reasons).not.toContain('coverage_reassigned')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Stale coverage — the one live case
// ─────────────────────────────────────────────────────────────────────────────

describe('stale coverage becomes a coverage finding', () => {
  it('claims elapsed attention, measured in days', () => {
    const { situation } = adoption()
    expect(situation.lead.kind).toBe('coverage_stale')
    expect(situation.lead.claim.predicate).toBe('unreviewed')
    expect(situation.lead.claim.quantity).toEqual({
      value: DAYS, unit: 'days', direction: 'bad',
    })
    expect(situation.lead.claim.interval?.from).toBe(COVERAGE_LAST_LOOK)
  })

  it('takes its severity from the shipping card, never its own rule', () => {
    expect(adoption().situation.severity).toBe(coverageCard().severity)
  })

  it('declines any attention row that is not the coverage finding', () => {
    const earnings = coverageRow({
      reason_code: 'earnings_upcoming', attention_type: 'informational',
    })
    const r = coverageStaleFinding({
      item: earnings as never, card: coverageCard(), coverage: 'direct', now: COVERAGE_NOW,
    })
    expect(r.ok).toBe(false)
  })

  it('declines rather than guessing when there is no date to measure from', () => {
    const r = coverageStaleFinding({
      item: { reason_code: 'coverage_neglected', context: { asset_id: 'a-amzn' } },
      card: coverageCard(), coverage: 'direct', now: COVERAGE_NOW,
    })
    expect(r.ok).toBe(false)
  })

  /**
   * The clock, not the tape.
   *
   * The resolver reads the UNIT and nothing else — it has never heard of
   * coverage. A claim measured in days is a claim about elapsed time, so the
   * elapsed time is what gets drawn. Manual QA on the old card: "not showing
   * much besides just a price chart."
   */
  it('draws the elapsed time instead of a price series', () => {
    expect(adoption().plan.visuals[0].primitive).toBe('timeline')
  })

  it('leads with the reader rather than with the case', () => {
    const { copy } = adoption()
    expect(copy.headline).toContain('AMZN')
    expect(copy.metric?.value).toBe(`${DAYS}d`)
    expect(copy.metric?.label).toBe('Since your last contribution')
  })
})

/**
 * What the reader actually reads, pinned against the legacy card it replaces.
 *
 * Manual QA, on a build where the identity had shipped and the presentation had
 * not: "I can see a Coverage Gap tile, but the card still says Research stale
 * and shows a price chart with almost no coverage detail." The chip and the
 * face were describing different findings.
 */
describe('the card says what the chip says', () => {
  it('no longer leads with the producer own words', () => {
    const legacy = coverageCard()
    expect(legacy.headline).toContain('Research stale')
    expect(adoption().card.headline).not.toContain('Research stale')
  })

  it('answers the four things a coverage tile has to answer', () => {
    const { card } = adoption()
    // Who is answerable, and that they have not been near it.
    expect(card.headline).toContain('AMZN')
    // How long it has been stale, in the hero slot the legacy card left empty.
    expect(card.metric?.value).toBe(`${DAYS}d`)
    expect(legacyMetricIsEmpty()).toBe(true)
    // What is stale, and since when.
    expect(card.body).toContain('22 Jul')
    // What to do next.
    expect(card.actions.primary.id).toBe('open_asset')
  })

  const legacyMetricIsEmpty = () => coverageCard().metric == null

  /**
   * The status chips are the producer's and they survive.
   *
   * `buildAttentionCard` puts the row's own tags on the context line —
   * "Coverage", "Stale" — and the projection keeps the producer's chips rather
   * than restating them. So the status the brief asks for is already on the
   * card and the engine does not need to invent it.
   */
  it('keeps the producer own status chips', () => {
    const labels = adoption().card.context.map(c => c.label)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.join(' ').toLowerCase()).toContain('coverage')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4 + 10. Composition
// ─────────────────────────────────────────────────────────────────────────────

describe('coverage findings on one name are one situation', () => {
  const unownedOn = (assetId: string) => coverageGapFinding({
    subject: { kind: 'asset', id: assetId, name: 'Amazon.com', ticker: 'AMZN' },
    analyst: fact('analyst_id', null, 'stated', '2026-09-01T00:00:00.000Z'),
    weightPct: 7.1,
    stakes: { coverage: 'none' },
    observedAt: '2026-09-01T00:00:00.000Z',
  }, NOW)!

  it('composes the absent owner and the lapsed one into a single tile', () => {
    const composed = composeSituations([adoption().situation.lead, unownedOn('a-amzn')])
    expect(composed).toHaveLength(1)
    expect(composed[0].supporting).toHaveLength(1)
  })

  /**
   * The stronger claim leads.
   *
   * "Nobody is responsible for this" outranks "the responsible person has been
   * quiet" — a name with no owner has nobody to go stale. `KIND_PRECEDENCE`
   * decides it, and severity partitions above that, exactly as it does for the
   * two target findings.
   */
  it('leads with the absent owner and keeps the staleness as corroboration', () => {
    const composed = composeSituations([adoption().situation.lead, unownedOn('a-amzn')])
    expect(composed[0].lead.kind).toBe('coverage_gap')
    expect(composed[0].supporting[0].kind).toBe('coverage_stale')
  })

  it('is deterministic — same findings in either order, same tile', () => {
    const lead = adoption().situation.lead
    const a = composeSituations([lead, unownedOn('a-amzn')])
    const b = composeSituations([unownedOn('a-amzn'), lead])
    expect(a[0].id).toBe(b[0].id)
    expect(a[0].lead.id).toBe(b[0].lead.id)
    expect(a.map(s => s.lead.kind)).toEqual(b.map(s => s.lead.kind))
  })

  it('keeps two names apart', () => {
    const composed = composeSituations([adoption().situation.lead, unownedOn('a-nvda')])
    expect(composed).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5 + 6. Distinct from the families it used to be filed with
// ─────────────────────────────────────────────────────────────────────────────

describe('coverage is not the families it was being counted as', () => {
  const overdueRow = {
    attention_id: 'att-overdue', attention_type: 'action_required' as const,
    reason_code: 'task_overdue', title: 'Q3 model refresh', source_type: 'project',
    context: { asset_id: null }, created_at: '2026-08-01T00:00:00.000Z',
    last_activity_at: '2026-08-01T00:00:00.000Z',
    due_at: '2026-08-20T00:00:00.000Z', next_action: 'Finish the model',
  }

  /** 5. Overdue asks what work missed its deadline. Coverage has no deadline. */
  it('is a different type from Overdue, on the same attention_type', () => {
    expect(overdueRow.attention_type).toBe(coverageRow().attention_type)
    expect(attentionCardType(overdueRow)).toBe('project_overdue')
    expect(attentionCardType(coverageRow())).toBe('coverage_gap')
    expect(coverageRow().due_at).toBeNull()
  })

  it('prints a different chip and answers a different pill', () => {
    expect(KIND_LABEL.coverage_gap).toBe('Coverage gap')
    expect(KIND_LABEL.coverage_gap).not.toBe(KIND_LABEL.project_overdue)
    expect(familyLabel('coverage_gap')).toBe('Coverage gap')
  })

  /** Needs Review asks which existing judgment needs revisiting. */
  it('is a different type from Needs Review', () => {
    const decision = { attention_type: 'decision_required' as const, reason_code: 'pm_decision_needed' }
    expect(attentionCardType(decision)).toBe('awaiting_review')
    expect(attentionCardType(coverageRow())).not.toBe('awaiting_review')
  })

  /** 6. Research asks whether the written view has kept up. */
  it('asks a different reader question from Research', () => {
    expect(readerQuestionFor('coverage_gap')).toBe('coverage')
    expect(readerQuestionFor('research_stale')).toBe('research')
    expect(readerQuestionFor('no_research')).toBe('thesis')
  })

  it('does not compose with an unrelated Research finding on the same name', () => {
    const research = adoptResearchInsight(
      staleInsight('price_move'), staleCard('price_move'), READER, PHONE,
    )
    if (!research.ok) throw new Error('fixture declined')
    const onOneName = {
      ...research.adoption.situation.lead,
      subject: adoption().situation.lead.subject,
    }
    const composed = composeSituations([adoption().situation.lead, onOneName])
    expect(composed).toHaveLength(2)
    expect(composed.map(s => s.question).sort()).toEqual(['coverage', 'research'])
  })

  it('does not compose with No Core Thesis on the same name either', () => {
    const thesis = adoptResearchInsight(thesisInsight(), thesisCard(), READER, PHONE)
    if (!thesis.ok) throw new Error('fixture declined')
    const onOneName = {
      ...thesis.adoption.situation.lead,
      subject: adoption().situation.lead.subject,
    }
    expect(composeSituations([adoption().situation.lead, onOneName])).toHaveLength(2)
  })

  /**
   * A category is not a question.
   *
   * Coverage is filed under Research for browsing — it is a claim about the
   * written record on a name — while asking a question of its own. `no_research`
   * does the same thing, which is the precedent.
   */
  it('browses under Research and still asks its own question', () => {
    expect(categoryForType('coverage_gap')).toBe('research')
    expect(categoryForType('no_research')).toBe('research')
    expect(SITUATION_DEFINITIONS.coverage_stale.question).toBe('coverage')
    expect(SITUATION_DEFINITIONS.no_core_thesis.question).toBe('thesis')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. The legacy duplicate
// ─────────────────────────────────────────────────────────────────────────────

describe('the same finding is never shown twice', () => {
  const entry = (row: Record<string, unknown>) => ({ kind: 'attention' as const, attention: row })

  /**
   * Research still wins, and the rule is unchanged in substance.
   *
   * `useDerivedInsights` calls the same observation `long_silence` and gives it
   * a card with the framing's own panes and an action that opens the thesis.
   * Coverage Gap becoming canonical does not change which of the two says more
   * about the same name — the Research card still does — so the precedence
   * stays and only the KEY it is expressed in changes.
   */
  it('drops the coverage item where a Research card covers the name', () => {
    const kept = suppressCoveredAttention([entry(coverageRow())], new Set(['a-amzn']))
    expect(kept).toEqual([])
  })

  it('keeps it where no Research card covers the name', () => {
    const entries = [entry(coverageRow())]
    expect(suppressCoveredAttention(entries, new Set(['a-nvda']))).toEqual(entries)
  })

  /**
   * The defect the old key carried, pinned.
   *
   * `source_type: 'coverage_change'` is shared with `collectUpcomingEarnings`,
   * so the old rule deleted a name's earnings tile whenever it had a Research
   * card. The reason code names the finding; the source names the drawer.
   */
  it('no longer takes the earnings item with it', () => {
    const earnings = entry(coverageRow({
      reason_code: 'earnings_upcoming', attention_type: 'informational',
    }))
    expect(suppressCoveredAttention([earnings], new Set(['a-amzn']))).toEqual([earnings])
  })
})

/**
 * Same question, not same asset.
 *
 * The set handed to the rule used to be every asset with ANY Research card on
 * it — a subject rule wearing a duplicate rule's clothes. A name with a
 * price-move card lost its coverage tile, and the two answer different reader
 * questions. `coverageDuplicateAssets` is the predicate now.
 */
describe('only the Research card making the same claim suppresses coverage', () => {
  const insight = (framing: string, assetId = 'a-amzn') => ({ assetId, issue: { framing } })
  const entry = (row: Record<string, unknown>) => ({ kind: 'attention' as const, attention: row })
  const coverage = entry(coverageRow())

  const survives = (framing: string) =>
    suppressCoveredAttention([coverage], coverageDuplicateAssets([insight(framing)]))

  /**
   * `long_silence` is the coverage finding said again.
   *
   * Both fire on quiet alone, both measure from the last contribution, and
   * neither asserts that anything happened.
   */
  it('suppresses under a long-silence Research card', () => {
    expect(survives('long_silence')).toEqual([])
  })

  it('survives an Unreviewed Move on the same name', () => {
    // A price that moved is a different claim, with evidence this one has not.
    expect(survives('price_move')).toEqual([coverage])
  })

  it('survives new evidence on the same name', () => {
    expect(survives('new_evidence')).toEqual([coverage])
  })

  it('survives No Core Thesis on the same name', () => {
    expect(survives('no_case')).toEqual([coverage])
    expect(survives('incomplete_case')).toEqual([coverage])
  })

  it('is not suppressed by a long silence on a different name', () => {
    const elsewhere = coverageDuplicateAssets([insight('long_silence', 'a-nvda')])
    expect(suppressCoveredAttention([coverage], elsewhere)).toEqual([coverage])
  })

  /** The set itself, so the predicate is legible without the filter around it. */
  it('selects exactly the long-silence assets', () => {
    const set = coverageDuplicateAssets([
      insight('long_silence', 'a-amzn'),
      insight('price_move', 'a-msft'),
      insight('no_case', 'a-nvda'),
      insight('long_silence', 'a-goog'),
      { assetId: null, issue: { framing: 'long_silence' } },
    ])
    expect([...set].sort()).toEqual(['a-amzn', 'a-goog'])
  })

  it('is a no-op when the feed carries no Research at all', () => {
    const entries = [coverage]
    expect(suppressCoveredAttention(entries, coverageDuplicateAssets([]))).toBe(entries)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. The pill
// ─────────────────────────────────────────────────────────────────────────────

describe('the Coverage gap pill returns exactly Coverage gap', () => {
  /** The entry shapes `MobileDashboard` builds, not hand-made ones. */
  const coverageEntry = { kind: 'attention' as const, attention: coverageRow() }
  const overdueEntry = {
    kind: 'attention' as const,
    attention: {
      attention_id: 'att-overdue', attention_type: 'action_required',
      reason_code: 'task_overdue', context: { asset_id: null },
    },
  }
  const reviewEntry = {
    kind: 'attention' as const,
    attention: {
      attention_id: 'att-review', attention_type: 'decision_required',
      reason_code: 'pm_decision_needed', context: { asset_id: 'a-msft' },
    },
  }
  const researchEntry = { kind: 'insight' as const, insight: { issue: { framing: 'long_silence' } } }
  const FEED = [coverageEntry, overdueEntry, reviewEntry, researchEntry]

  it('resolves the visible family to the chip the tile prints', () => {
    expect(displayFamilyOf(coverageEntry)).toBe('coverage_gap')
    expect(familyLabel(displayFamilyOf(coverageEntry))).toBe(KIND_LABEL.coverage_gap)
  })

  /**
   * The chip is a control, not a word.
   *
   * `pillFilterFor` withholds the handler unless this passes, and a chip with
   * no handler renders as a `<span>` — which is how an entire class of tiles
   * came to print a family the reader could see and could not tap. Asserted for
   * the new family before it ships rather than after a phone finds it.
   */
  it('offers the pill as something that can be pressed', () => {
    expect(entryHasExactFamily(coverageEntry)).toBe(true)
  })

  it('returns only the coverage tiles', () => {
    const view = deriveFeedView(FEED, displayFamilyOf, displayFamilyOf(coverageEntry))
    expect(view).toEqual([coverageEntry])
  })

  it('is not returned by the Overdue or Needs Review pills', () => {
    expect(deriveFeedView(FEED, displayFamilyOf, displayFamilyOf(overdueEntry)))
      .toEqual([overdueEntry])
    expect(deriveFeedView(FEED, displayFamilyOf, displayFamilyOf(reviewEntry)))
      .toEqual([reviewEntry])
  })

  /**
   * The diversity axis agrees with the chip.
   *
   * `familyOf` is what `composeFeed` breaks runs on. If it still called these
   * tiles `project_overdue`, a screen of coverage tiles and a screen of genuine
   * overdue work would count as one family and neither would be broken up.
   */
  it('names the same family to the composer', () => {
    expect(familyOf(coverageEntry)).toBe('coverage_gap')
    expect(familyOf(coverageEntry)).toBe(displayFamilyOf(coverageEntry))
  })

  it('never exposes the producer name', () => {
    expect(displayFamilyOf(coverageEntry)).not.toContain('coverage_change')
    expect(familyLabel('coverage_gap')).not.toContain('change')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. Ranking
// ─────────────────────────────────────────────────────────────────────────────

describe('ranking is where it was', () => {
  /**
   * The tier and base are the legacy row's own.
   *
   * `rankInputFor` typed every coverage item `awaiting_review` — tier 3, base
   * 0.50 — because `attentionSignalType` sends anything that is not a trade
   * queue item or a project there. `coverage_gap` takes the same pair, so
   * adopting the family changes what the tile says and not where it sits.
   */
  it('scores identically to the legacy awaiting_review row', () => {
    const legacy: PriorityInput = { ...attentionRankInput(), type: 'awaiting_review' }
    const adopted: PriorityInput = { ...attentionRankInput(), type: 'coverage_gap' }
    expect(priorityFor(adopted, COVERAGE_NOW)).toEqual(priorityFor(legacy, COVERAGE_NOW))
  })

  /**
   * The ranker still reads the row, and still calls it `awaiting_review`.
   *
   * `attentionSignalType` is the ranking mapping and is deliberately untouched:
   * the pool is ranked from the ENTRY, before any card is built, so nothing the
   * card face does can move a tile. That separation is what makes this adoption
   * safe to ship, and it is asserted rather than assumed.
   */
  it('leaves the ranking mapping alone', () => {
    expect(attentionSignalType(coverageRow())).toBe('awaiting_review')
    expect(attentionCardType(coverageRow())).toBe('coverage_gap')
  })

  it('carries no base of its own, exactly as production carries none', () => {
    expect(situationPriorityInput(adoption().situation).base).toBeUndefined()
    expect(attentionRankInput().base).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 11. Actions
// ─────────────────────────────────────────────────────────────────────────────

describe('every action goes somewhere real', () => {
  const ctx = { assetId: COVERAGE_ASSET.id, symbol: COVERAGE_ASSET.symbol }

  /**
   * The primary opens the name, and does not claim the thesis is wrong.
   *
   * The row names three destinations in one sentence — "Update thesis, rating,
   * or research for this covered name" — and the finding establishes none of
   * them. It establishes that nothing has been added. So the card takes the
   * reader to where all three live rather than picking one on their behalf.
   */
  it('leads with the name rather than with a verdict on the thesis', () => {
    expect(adoption().card.actions.primary.id).toBe('open_asset')
    // Still offered, one place down, for the reader who knows more than the card.
    const rest = [...adoption().card.actions.quick, ...adoption().card.actions.menu]
    expect(rest.map(a => a.id)).toContain('update_thesis')
  })

  /**
   * `assign_coverage` belongs to the other coverage finding, not this one.
   *
   * It routes to the coverage register, which is right when nobody is
   * responsible. Here the reader is, and the card has just said so.
   */
  it('never offers to assign an owner to a name the reader already covers', () => {
    const { actions } = adoption().card
    const ids = [actions.primary, ...actions.quick, ...actions.menu].map(a => a.id)
    expect(ids).not.toContain('open_coverage')
    expect(SITUATION_DEFINITIONS.coverage_gap.intents).toContain('assign_coverage')
    expect(SITUATION_DEFINITIONS.coverage_stale.intents).not.toContain('assign_coverage')
  })

  it('routes every action it offers', () => {
    const { actions } = adoption().card
    const all = [actions.primary, ...actions.quick, ...actions.menu]
    for (const a of all) {
      if (a.id === 'why' || a.id === 'snooze' || a.id === 'dismiss') continue
      expect(feedActionIsRoutable(a.id, ctx), a.id).toBe(true)
    }
  })

  it('keeps triage, so the tile can still be got rid of', () => {
    const ids = adoption().card.actions.menu.map(a => a.id)
    expect(ids).toContain('snooze')
    expect(ids).toContain('dismiss')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The feed contract, and the differences that are on purpose
// ─────────────────────────────────────────────────────────────────────────────

describe('the feed contract survives the adoption', () => {
  it('preserves identity, dedupe key and provenance', () => {
    const original = coverageCard()
    const next = adoption().card
    expect(next.id).toBe(original.id)
    expect(next.dedupeKey).toBe(original.dedupeKey)
    expect(next.severity).toBe(original.severity)
    expect(next.entity).toEqual(original.entity)
    expect(next.provenance).toEqual(original.provenance)
  })

  it('hands back the production card when the adapter declines', () => {
    const original = coverageCard()
    const declined = coverageStaleFinding({
      item: { reason_code: 'earnings_upcoming' }, card: original,
      coverage: 'direct', now: COVERAGE_NOW,
    })
    expect(declined.ok).toBe(false)
    expect(cardOrOriginal(original, adoptCoverageGap(
      { reason_code: 'earnings_upcoming' }, original, READER, PHONE, COVERAGE_NOW,
    ))).toBe(original)
  })

  /**
   * Three differences, each one deliberate, each one reported.
   *
   * ── The metric ───────────────────────────────────────────────────────────
   *
   * Production shows none. `buildAttentionCard` builds its metric from `due_at`
   * and the collector sets that to null, so the hero slot on a coverage tile
   * has always been empty — which is the complaint that these tiles showed
   * nothing but a chart. The engine puts the elapsed silence there, computed
   * from timestamps the row already carries.
   *
   * ── The primary action ───────────────────────────────────────────────────
   *
   * Production falls back to `open_item`: the one thing the mobile surface can
   * honestly do for a generic attention row. The engine offers the verb the
   * row's own `next_action` names, and every action it offers is routable —
   * asserted above.
   *
   * ── The ranking input, which is a finding rather than a change ────────────
   *
   * Asserted separately below, because it is the only one of the three that
   * would matter if the engine ranked. It does not: `MobileDashboard` ranks the
   * POOL through `rankInputFor` before any card is built, so the card face
   * cannot move a tile. See the ranking suite, which asserts the score itself
   * is unchanged.
   */
  it('diverges from production on the metric, the primary and the rank input', () => {
    const report = compareParity({
      original: coverageCard(),
      productionRankInput: attentionRankInput(),
      adoption: adopt(),
    })
    const failed = report.checks.filter(c => !c.ok).map(c => c.axis)
    expect(failed.sort()).toEqual(['action_intent', 'metric_value', 'ranking_input'])
    expect(coverageCard().metric).toBeNull()
    expect(buildAttentionCard(coverageRow() as never, COVERAGE_ASSET))
      .toMatchObject({ ok: true })
  })

  /**
   * What the rank-input difference actually is, in three lines.
   *
   * `type` differs and scores the same, which is the whole ranking claim and is
   * asserted above. The other two are worth naming precisely:
   *
   *   severity     production says `informational`, the engine says `attention`
   *   occurredAt   production dates the ROW, the engine dates the last look
   *
   * The severity gap is a production defect and not a choice. `rankInputFor`
   * reads `a.priority`, and `AttentionItem` has no such field — it carries
   * `severity`. So every attention item in the feed, coverage or not, has
   * always ranked `informational` regardless of how urgent the collector said
   * it was. Fixing it here would move every Overdue and Needs Review tile in
   * the product, so it is reported rather than taken inside a coverage stage.
   */
  it('names the rank-input difference rather than papering over it', () => {
    const engine = situationPriorityInput(adoption().situation)
    const production = attentionRankInput()

    expect(production.severity).toBe('informational')
    expect(engine.severity).toBe('attention')
    // The field the production branch reads, on the row it reads it from.
    expect('priority' in coverageRow()).toBe(false)
    expect(coverageRow().severity).toBe('high')

    expect(production.occurredAt).toBe(coverageRow().created_at)
    expect(engine.occurredAt).toBe(COVERAGE_LAST_LOOK)
  })
})
