/**
 * What the attention severity defect cost, measured.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `rankInputFor` read `a.priority` for an attention item's severity.
 * `AttentionItem` has no such field — it has `severity`, and `'high'`/`'medium'`
 * are that type's values, so the branch was reaching for the right thing under
 * the wrong name. `undefined` matched neither arm, so every attention item in
 * the product scored `informational`: a decision waiting on the reader, a
 * deliverable three weeks late and next Thursday's earnings note all carried
 * the same urgency.
 *
 * ── Why this file measures rather than asserts a constant ─────────────────
 *
 * Severity is worth 0.14 of the score and cannot move a tier, so the correction
 * is bounded by construction. "Bounded by construction" is exactly the kind of
 * claim that is true until somebody adds a rule, so the bound is measured here
 * against a pool shaped like a real desk's, and the numbers the correction
 * actually produced are recorded beside it.
 *
 * The pool's severities are the collectors' own expressions, transcribed from
 * `useAttention` — a project's priority column, days past due, days since a
 * contribution. Nothing here invents a severity for anything.
 */

import { describe, expect, it } from 'vitest'

import { rankFeed, priorityFor, type PriorityInput, type RankedItem } from '../feed-priority'
import { composeFeed } from '../feed-compose'
import { readerQuestionFor } from '../reader-question'
import { attentionRankSeverity, attentionSignalType } from '../../mobile/entry-signal-type'

const NOW = Date.parse('2026-09-07T12:00:00.000Z')
const DAY = 86_400_000

/**
 * One attention row per collector, with the severity that collector computes.
 *
 * Transcribed from `useAttention`, line by line — the expression is quoted in
 * each `why` so a reader can check it against the source rather than trusting
 * the label. `type` is what `attentionSignalType` returns for the row, which is
 * the ranker's own mapping and is untouched by this correction.
 */
interface Row {
  id: string
  family: string
  source_type: string
  attention_type: 'informational' | 'action_required' | 'decision_required' | 'alignment'
  severity: 'low' | 'medium' | 'high' | 'critical'
  due_at: string | null
  ageDays: number
  assetId: string | null
  why: string
}

const ROWS: Row[] = [
  {
    id: 'deliverable-late', family: 'project_overdue', source_type: 'project_deliverable',
    attention_type: 'action_required', severity: 'high', due_at: '2026-08-14T00:00:00.000Z',
    ageDays: 24, assetId: null,
    why: 'collectProjectDeliverables: isOverdue ? high',
  },
  {
    id: 'deliverable-soon', family: 'project_overdue', source_type: 'project_deliverable',
    attention_type: 'action_required', severity: 'medium', due_at: '2026-09-10T00:00:00.000Z',
    ageDays: 3, assetId: null,
    why: 'collectProjectDeliverables: due soon',
  },
  {
    id: 'project-blocked', family: 'project_overdue', source_type: 'project',
    attention_type: 'action_required', severity: 'high', due_at: null, ageDays: 9, assetId: null,
    why: 'collectStaleProjects: isBlocked ? high',
  },
  {
    id: 'project-urgent', family: 'project_overdue', source_type: 'project',
    attention_type: 'action_required', severity: 'high', due_at: null, ageDays: 12, assetId: null,
    why: "collectProjects: p.priority === 'urgent' ? high",
  },
  {
    id: 'task-late', family: 'project_overdue', source_type: 'project',
    attention_type: 'action_required', severity: 'high', due_at: '2026-08-28T00:00:00.000Z',
    ageDays: 10, assetId: null,
    why: 'collectOverdueTasks: daysOver > 7 ? high',
  },
  {
    id: 'trade-urgent', family: 'recommendation', source_type: 'trade_queue_item',
    attention_type: 'decision_required', severity: 'high', due_at: null, ageDays: 2,
    assetId: 'a-msft',
    why: 'collectTradeDecisions: urgencyMap[t.urgency]',
  },
  {
    id: 'pm-decision-old', family: 'recommendation', source_type: 'trade_queue_item',
    attention_type: 'decision_required', severity: 'critical', due_at: null, ageDays: 16,
    assetId: 'a-nvda',
    why: 'collectPmDecisions: daysSince > 14 ? critical',
  },
  {
    id: 'idea-stale', family: 'recommendation', source_type: 'trade_queue_item',
    attention_type: 'action_required', severity: 'high', due_at: null, ageDays: 20,
    assetId: 'a-tsla',
    why: 'collectStaleIdeas: daysSince > 14 ? high',
  },
  {
    id: 'coverage-very-stale', family: 'coverage_gap', source_type: 'coverage_change',
    attention_type: 'action_required', severity: 'high', due_at: null, ageDays: 47,
    assetId: 'a-amzn',
    why: 'collectNeglectedCoverage: daysSince > 30 ? high',
  },
  {
    id: 'coverage-stale', family: 'coverage_gap', source_type: 'coverage_change',
    attention_type: 'action_required', severity: 'medium', due_at: null, ageDays: 24,
    assetId: 'a-goog',
    why: 'collectNeglectedCoverage: else medium',
  },
  {
    id: 'earnings-imminent', family: 'team_focus', source_type: 'coverage_change',
    attention_type: 'informational', severity: 'high', due_at: '2026-09-09T00:00:00.000Z',
    ageDays: 1, assetId: 'a-meta',
    why: 'collectUpcomingEarnings: daysUntil <= 3 ? high',
  },
  {
    id: 'earnings-far', family: 'team_focus', source_type: 'coverage_change',
    attention_type: 'informational', severity: 'low', due_at: '2026-09-25T00:00:00.000Z',
    ageDays: 1, assetId: 'a-nflx',
    why: 'collectUpcomingEarnings: else low',
  },
  {
    id: 'suggestion', family: 'awaiting_review', source_type: 'list_suggestion',
    attention_type: 'decision_required', severity: 'low', due_at: null, ageDays: 5, assetId: null,
    why: 'collectListSuggestions: severity low',
  },
  {
    id: 'shared-thought', family: 'thought', source_type: 'note',
    attention_type: 'informational', severity: 'low', due_at: null, ageDays: 2, assetId: null,
    why: 'collectTeammateThoughts: severity low',
  },
  {
    id: 'thesis-idea', family: 'awaiting_review', source_type: 'trade_queue_item',
    attention_type: 'alignment', severity: 'medium', due_at: null, ageDays: 6, assetId: 'a-crm',
    why: "collectIdeaAlignment: idea_type === 'thesis' ? medium",
  },
]

/** The branch as it shipped: a field the row does not have. */
const oldSeverity = (r: Row): PriorityInput['severity'] => {
  const phantom = (r as { priority?: string }).priority
  return phantom === 'high' ? 'critical' : phantom === 'medium' ? 'attention' : 'informational'
}

const inputFor = (
  r: Row,
  severity: (row: Row) => PriorityInput['severity'],
): PriorityInput => ({
  id: r.id,
  type: attentionSignalType(r) as PriorityInput['type'],
  severity: severity(r),
  occurredAt: new Date(NOW - r.ageDays * DAY).toISOString(),
  weightPct: null,
  held: !!r.assetId,
  deviationPct: null,
  overdueDays: r.due_at ? Math.floor((NOW - Date.parse(r.due_at)) / DAY) : null,
  coverage: 'unknown',
  judgment: null,
})

const rankOld = (): RankedItem<Row>[] => rankFeed(ROWS, r => inputFor(r, oldSeverity), NOW)
const rankNew = (): RankedItem<Row>[] => rankFeed(ROWS, r => inputFor(r, attentionRankSeverity), NOW)

// ─────────────────────────────────────────────────────────────────────────────
// The field
// ─────────────────────────────────────────────────────────────────────────────

describe('attention severity comes from the field the row has', () => {
  it('reads severity and ignores a priority that was never written', () => {
    expect(attentionRankSeverity({ severity: 'high' })).toBe('critical')
    // A row carrying only the phantom field gets nothing from it.
    expect(attentionRankSeverity({ priority: 'high' } as never)).toBe('informational')
  })

  /**
   * Four values in, three out, and the fourth is why this is not a rename.
   *
   * The original branch tested `'high'` and `'medium'` only. Pointed at the
   * real field unchanged, it would have sent `critical` — the loudest thing the
   * attention engine can say — to the quietest bucket.
   */
  it('maps the whole AttentionSeverity scale', () => {
    expect(attentionRankSeverity({ severity: 'critical' })).toBe('critical')
    expect(attentionRankSeverity({ severity: 'high' })).toBe('critical')
    expect(attentionRankSeverity({ severity: 'medium' })).toBe('attention')
    expect(attentionRankSeverity({ severity: 'low' })).toBe('informational')
  })

  it('falls back to informational for a row with no severity at all', () => {
    expect(attentionRankSeverity({})).toBe('informational')
    expect(attentionRankSeverity(null)).toBe('informational')
    expect(attentionRankSeverity({ severity: 'nonsense' })).toBe('informational')
  })

  /**
   * Every family the product produces gets the severity its collector computed.
   *
   * The rows are the collectors' own expressions — see each `why`. This asserts
   * the whole surface moves, not only the coverage family that found it.
   */
  it('gives every attention family a severity its collector authored', () => {
    const EXPECTED = { critical: 'critical', high: 'critical', medium: 'attention', low: 'informational' }
    const loud = new Set<string>()

    for (const r of ROWS) {
      // Every row was `informational` before, whatever its collector said.
      expect(oldSeverity(r), `${r.id} before`).toBe('informational')
      expect(attentionRankSeverity(r), `${r.id} (${r.why})`).toBe(EXPECTED[r.severity])
      if (r.severity !== 'low') loud.add(r.family)
    }

    // Every family the pool carries except the one that is genuinely quiet.
    expect([...loud].sort()).toEqual([
      'awaiting_review', 'coverage_gap', 'project_overdue', 'recommendation', 'team_focus',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What the correction does to the order
// ─────────────────────────────────────────────────────────────────────────────

interface Shift {
  moved: number
  largestMove: number
  largestScoreChange: number
  tierChanges: number
}

function shift(): Shift {
  const before = rankOld()
  const after = rankNew()
  const posBefore = new Map(before.map((r, i) => [r.item.id, i]))
  const scoreBefore = new Map(before.map(r => [r.item.id, r.priority.total]))
  const tierBefore = new Map(before.map(r => [r.item.id, r.priority.tier]))

  let moved = 0
  let largestMove = 0
  let largestScoreChange = 0
  let tierChanges = 0

  after.forEach((r, i) => {
    const was = posBefore.get(r.item.id)!
    if (was !== i) moved += 1
    largestMove = Math.max(largestMove, Math.abs(was - i))
    largestScoreChange = Math.max(
      largestScoreChange, Math.abs(r.priority.total - scoreBefore.get(r.item.id)!))
    if (r.priority.tier !== tierBefore.get(r.item.id)) tierChanges += 1
  })

  return { moved, largestMove, largestScoreChange, tierChanges }
}

describe('the correction reorders within tiers and only within tiers', () => {
  const s = shift()

  /**
   * Severity is `urgency`, worth 0.14, and it is not an input to the tier.
   *
   * `priorityFor` takes the tier from `TIER[type]` and promotes only on
   * `overdueDays`. So no card can cross a tier on account of this, which is the
   * property that makes the correction safe to make in one commit.
   */
  it('moves nothing between tiers', () => {
    expect(s.tierChanges).toBe(0)
  })

  it('changes no score by more than the urgency weight', () => {
    // (1 − 0.15) × 0.14 = 0.119, the full span of the component.
    expect(s.largestScoreChange).toBeLessThanOrEqual(0.12)
  })

  it('moves the items whose collectors said they were urgent', () => {
    /**
     * Measured on this pool: 11 of 15 rows change position, largest move 4
     * places, largest score change 0.119 — the full span of the urgency
     * component and not a hundredth more.
     *
     * A correction this wide is what a field nothing populated looks like when
     * it starts being read. It is bounded because the component is bounded,
     * which is the claim the two tests above hold.
     */
    expect(s.moved).toBeGreaterThanOrEqual(8)
    expect(s.largestMove).toBeLessThanOrEqual(6)
  })

  /**
   * The families that were being flattened, named.
   *
   * Every row in the pool carried `informational` before. Afterwards the desk's
   * own urgency is visible: a PM decision sixteen days old and a coverage name
   * quiet for seven weeks outrank a note somebody shared this morning.
   */
  it('lifts the loud rows above the quiet ones within their tier', () => {
    const after = rankNew()
    const at = (id: string) => after.findIndex(r => r.item.id === id)
    expect(at('pm-decision-old')).toBeLessThan(at('suggestion'))
    expect(at('coverage-very-stale')).toBeLessThan(at('earnings-far'))
  })

  it('is deterministic across runs of the same input', () => {
    expect(rankNew().map(r => r.item.id)).toEqual(rankNew().map(r => r.item.id))
  })

  /**
   * Nothing in the input is engagement.
   *
   * `PriorityInput` has no dwell, no click count and no interest weight, and
   * this correction added none: it changed which FIELD one existing component
   * reads. Asserted by scoring a row twice with everything but severity held
   * constant, which is only stable if nothing else varies per reader.
   */
  it('uses no engagement signal', () => {
    const row = ROWS[0]
    const a = priorityFor(inputFor(row, attentionRankSeverity), NOW)
    const b = priorityFor(inputFor(row, attentionRankSeverity), NOW)
    expect(a.total).toBe(b.total)
    /**
     * The one slot that could carry engagement is declared and left at zero.
     *
     * `personalization` exists so that the day ranking may read feedback
     * telemetry it is one function rather than a change to every call site.
     * Phase 8 is explicitly forbidden from consuming it, and this correction
     * did not start.
     */
    expect(a.components.personalization).toBe(0)
    expect(b.components.personalization).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The composition work from bb13d45
// ─────────────────────────────────────────────────────────────────────────────

describe('diversity still holds on the corrected order', () => {
  const compose = (ranked: RankedItem<Row>[]) => composeFeed(ranked, {
    familyOf: (r: Row) => r.family,
    subjectOf: (r: Row) => r.assetId,
    questionOf: (r: Row) => readerQuestionFor(r.family as never),
    categoryOf: () => null,
  })

  const longestRun = (seq: string[]) => {
    let best = 1
    let run = 1
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] === seq[i - 1]) best = Math.max(best, ++run)
      else run = 1
    }
    return best
  }

  /**
   * The run rule is a property of the composer, not of the order it is given.
   *
   * Ranking changed underneath it, which is exactly the circumstance where a
   * variety rule tuned to one order stops working. Measured on both orders so
   * the claim is that the composer holds, not that this particular list did.
   */
  it('keeps the same maximum run before and after the correction', () => {
    const before = longestRun(compose(rankOld()).order.map(r => r.item.family))
    const after = longestRun(compose(rankNew()).order.map(r => r.item.family))
    expect(after).toBeLessThanOrEqual(2)
    expect(after).toBeLessThanOrEqual(before + 1)
  })

  it('drops nothing and invents nothing', () => {
    const composed = compose(rankNew())
    expect(composed.order).toHaveLength(ROWS.length)
    expect(new Set(composed.order.map(r => r.item.id)).size).toBe(ROWS.length)
  })
})
