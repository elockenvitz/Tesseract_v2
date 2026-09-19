/**
 * Seven Overdue tiles in a row, and the rule that ends them.
 *
 * ── The P1 this pins ──────────────────────────────────────────────────────
 *
 * Manual QA on localhost, with every rule in `feed-compose` passing and the
 * briefing cap, the lane cap and the critical protection all live:
 *
 *   Overdue Overdue Overdue Overdue Overdue Overdue Overdue
 *
 * Reproduced here from the collectors' own rules rather than from invented
 * numbers, because the defect was a property of the DATA meeting the ordering
 * pass and neither half shows it alone:
 *
 *   `collectProjects`      useAttention.ts:332   isOverdue -> severity 'high'
 *   `collectDeliverables`  useAttention.ts:238   isOverdue -> severity 'high'
 *
 * Neither grades how late anything is, so a project one day late and one
 * forty-six days late are both `high`, which `attentionRankSeverity` reads as
 * `critical`. Every one of them then scores identically — measured at 0.576 —
 * because `weightPct` and `deviationPct` are null for workflow cards, so the
 * two largest components of the score are inert and only the per-type constant
 * is left.
 *
 * Eight identical criticals at the head of the ranking did two things. They
 * filled the protected set, whose reservation then handed them the opening's
 * remaining seats — six consecutive tiles with the trace reason
 * `reserved-seat`, and the highest-scoring card in the entire pool, at 0.689,
 * pushed to position twelve. And they formed a contiguous block in which no
 * alternative sat within `TOLERANCE` of the head, so every rule keyed on
 * repetition reported `no-competitor` and stood down.
 *
 * Both halves are asserted below: the share cap binds, and the reservation can
 * no longer produce a run.
 */

import { describe, expect, it } from 'vitest'

import { rankFeed, type PriorityInput } from '../feed-priority'
import { composeFeed, longestRun } from '../feed-compose'
import { readerQuestionFor } from '../reader-question'
import { categoryForType } from '../content-registry'
import { briefClassFor } from '../brief-class'
import type { SignalType } from '../contract'

const NOW = Date.parse('2026-09-09T12:00:00.000Z')
const DAY = 86_400_000

interface Cand {
  id: string
  family: string
  type: SignalType
  severity: PriorityInput['severity']
  days: number
  overdue: number | null
  held: boolean
}

const rows = (
  n: number, family: string, type: string, f: (i: number) => Partial<Cand> = () => ({}),
): Cand[] => Array.from({ length: n }, (_, i) => ({
  id: `${family}-${i}`,
  family,
  type: type as SignalType,
  severity: 'informational' as const,
  days: i,
  overdue: null,
  held: false,
  ...f(i),
}))

/**
 * Eight overdue items, all critical because the collectors cannot say
 * otherwise, and all raised in the same collector pass.
 *
 * `days` is deliberately constant across them. `rankInputFor` passes the
 * attention row's `created_at` as `occurredAt`, and a collector that raises
 * eight rows in one pass stamps them within the same minute — so recency, the
 * one component that could have separated them, is identical too. `overdueDays`
 * varies over the range a real desk produces and changes nothing, which is the
 * point: the collectors compute it and the score never sees it.
 */
const OVERDUE: Cand[] = rows(8, 'project_overdue', 'project_overdue', i => ({
  severity: 'critical' as const,
  days: 2,
  overdue: [46, 33, 21, 17, 9, 5, 3, 1][i],
}))

/**
 * The rest of a pilot desk, sized so the cap is satisfiable.
 *
 * Eight of fifty-five is about fifteen percent, comfortably inside the fifth
 * the cap allows. Sizing it at exactly twenty percent would be asking for a
 * PERFECT packing — eight items in fifty slots at no more than two per sliding
 * ten leaves no slack anywhere — and the first card nudged by any other rule
 * would produce a window of three. A cap is not a scheduler and should not be
 * tested as though it were.
 *
 * A family that genuinely is a third of the supply cannot be held to a fifth by
 * any ordering. That limit is real and is measured in `feed-variety`, where it
 * belongs, rather than confused with this rule.
 */
const REST: Cand[] = [
  ...rows(3, 'awaiting_review', 'recommendation', i => ({
    severity: 'attention' as const, days: i, held: true,
  })),
  ...rows(5, 'coverage_gap', 'coverage_gap', i => ({
    severity: 'attention' as const, days: 20 + i,
  })),
  ...rows(14, 'trade_idea', 'trade_idea'),
  ...rows(12, 'thought', 'thought', i => ({ days: i + 1 })),
  ...rows(10, 'news', 'news'),
  ...rows(3, 'research:long_silence', 'research_stale', i => ({ days: i * 3 })),
]

const POOL = [...OVERDUE, ...REST]

const toInput = (c: Cand): PriorityInput => ({
  id: c.id,
  type: c.type,
  severity: c.severity,
  occurredAt: new Date(NOW - c.days * DAY).toISOString(),
  weightPct: null,
  held: c.held,
  deviationPct: null,
  overdueDays: c.overdue,
  coverage: 'unknown',
}) as PriorityInput

const compose = (opts: Record<string, unknown> = {}) =>
  composeFeed(rankFeed(POOL, toInput, NOW), {
    familyOf: (c: Cand) => c.family,
    subjectOf: () => null,
    questionOf: (c: Cand) => readerQuestionFor(c.type),
    categoryOf: (c: Cand) => categoryForType(c.type),
    briefOf: (c: Cand) => briefClassFor(c.type),
    scope: 'mixed',
    trace: true,
    ...opts,
  })

const families = (o: ReturnType<typeof compose>) => o.order.map(r => r.item.family)

describe('the defect, reproduced', () => {
  /**
   * The control. If these stop being identical the reproduction has drifted
   * and every assertion below is about a different pool than the one reported.
   */
  it('starts from eight identically-scored criticals', () => {
    const ranked = rankFeed(POOL, toInput, NOW)
    const overdue = ranked.filter(r => r.item.family === 'project_overdue')
    expect(overdue).toHaveLength(8)
    expect(overdue.every(r => r.input.severity === 'critical')).toBe(true)
    expect(new Set(overdue.map(r => r.priority.total.toFixed(3))).size).toBe(1)
  })

  /**
   * What the cap is worth on this pool, as a comparison.
   *
   * Not "the run is at least five without it". The seven-tile run needed the
   * OLD lane-bounded reservation as well, and that mechanism is gone — it is
   * family-bounded now, which is asserted separately below. What can still be
   * measured with a single option is how much of the clustering the cap alone
   * removes, and that is what this records.
   */
  it('clusters the family more without the share cap than with it', () => {
    const off = compose({ maxPerFamilyShare: 99 })
    const on = compose()
    const worstWindow = (o: ReturnType<typeof compose>) => {
      const fams = o.order.map(r => r.item.family)
      let worst = 0
      for (let i = 0; i + 10 <= fams.length; i++) {
        const counts = new Map<string, number>()
        for (const f of fams.slice(i, i + 10)) counts.set(f, (counts.get(f) ?? 0) + 1)
        worst = Math.max(worst, ...counts.values())
      }
      return worst
    }
    expect(worstWindow(off)).toBeGreaterThan(worstWindow(on))
    expect(longestRun(off.order, r => r.item.family))
      .toBeGreaterThanOrEqual(longestRun(on.order, r => r.item.family))
  })
})

describe('the share cap', () => {
  const shipped = compose()

  /**
   * The reported defect, asserted on the family it was reported about.
   *
   * Overdue is exactly eight of forty here, so its share is satisfiable for the
   * whole feed and the cap must hold everywhere. Trade ideas are ten of forty
   * and thoughts eight, so those two crowd the limit once the small families
   * are spent — which is the supply arithmetic measured in `feed-variety`, not
   * a failure of this rule, and deliberately not asserted here.
   */
  it('never places two Overdue tiles together, anywhere', () => {
    expect(longestRun(shipped.order, r =>
      r.item.family === 'project_overdue' ? 'project_overdue' : String(r.input.id),
    )).toBe(1)
  })

  it('holds Overdue to two of any ten cards, anywhere', () => {
    const fams = families(shipped)
    for (let i = 0; i + 10 <= fams.length; i++) {
      const n = fams.slice(i, i + 10).filter(f => f === 'project_overdue').length
      expect(n, `window ${i}`).toBeLessThanOrEqual(2)
    }
  })

  /** And no family at all is over its share while the pool can support it. */
  it('holds every family to its share through the opening', () => {
    const fams = families(shipped).slice(0, 20)
    for (let i = 0; i + 10 <= fams.length; i++) {
      const counts = new Map<string, number>()
      for (const f of fams.slice(i, i + 10)) counts.set(f, (counts.get(f) ?? 0) + 1)
      expect(Math.max(...counts.values()), `window ${i}`).toBeLessThanOrEqual(2)
    }
  })

  it('drops nothing — the eight edged out appear later, not never', () => {
    expect(shipped.order).toHaveLength(POOL.length)
    expect(families(shipped).filter(f => f === 'project_overdue')).toHaveLength(8)
  })

  it('keeps the ranking inside the family, so the latest project comes first', () => {
    const overdue = shipped.order
      .filter(r => r.item.family === 'project_overdue')
      .map(r => r.item.overdue)
    /**
     * Descending by days overdue is what `compareRanked` produces here, because
     * `occurredAt` is the tie-break once the scores are equal. That is thin, and
     * it is the reason the collectors still need grading — but the composer must
     * not be what disturbs it.
     */
    expect(overdue).toEqual([...overdue].sort((a, b) => (b ?? 0) - (a ?? 0)))
  })
})

describe('the reservation can no longer produce a run', () => {
  const shipped = compose()

  it('reserves at most two seats for any one family', () => {
    const seats = shipped.trace
      .filter(t => t.reason === 'reserved-seat')
      .map(t => String(t.family))
    const counts = new Map<string, number>()
    for (const f of seats) counts.set(f, (counts.get(f) ?? 0) + 1)
    expect(Math.max(0, ...counts.values())).toBeLessThanOrEqual(2)
  })

  /**
   * The inversion the protection was written to prevent, checked in the
   * direction it actually failed.
   *
   * Under the lane-bounded reservation the highest-scoring card in the pool was
   * pushed to position twelve by cards scoring 0.576. A rule against inversions
   * had become one.
   */
  it('still opens with the highest-scoring card in the pool', () => {
    const ranked = rankFeed(POOL, toInput, NOW)
    expect(shipped.order[0].input.id).toBe(ranked[0].input.id)
    expect(shipped.trace[0].rankBefore).toBe(1)
  })

  it('brings the edged-out criticals back quickly rather than burying them', () => {
    const at = families(shipped)
      .map((f, i) => (f === 'project_overdue' ? i + 1 : -1))
      .filter(i => i > 0)
    // Two per ten, so the eighth lands around forty. "Later" must mean later,
    // not "at the end of the feed".
    expect(at[at.length - 1]).toBeLessThanOrEqual(40)
  })
})

describe('the pass is still what it was', () => {
  it('is deterministic', () => {
    expect(compose().order.map(r => r.input.id))
      .toEqual(compose().order.map(r => r.input.id))
  })

  it('emits no card twice', () => {
    const ids = compose().order.map(r => r.input.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
