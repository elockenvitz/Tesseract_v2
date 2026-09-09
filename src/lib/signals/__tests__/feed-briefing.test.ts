/**
 * What the first screen is made of, on the pools that produced the complaint.
 *
 * ── The report ────────────────────────────────────────────────────────────
 *
 * Manual QA, with the run rules, the question rules and the screen-saturation
 * rules all passing:
 *
 *   Needs Review, Overdue, Coverage Gap, Needs Review, Coverage Gap, Overdue
 *
 * and separately a stretch of Thought, Trade Idea, Pair Trade. Measured on a
 * pilot-shaped pool the composed top ten held four reader questions and four
 * categories — the acceptance criteria of the day, met — while seven of the ten
 * cards said something needs looking at.
 *
 * The model had four names for one lane: `research_stale` prints the same two
 * words as `awaiting_review`, coverage is filed under research, and a
 * recommendation is filed under decisions. Each of those is right on its own
 * terms and none is visible to a reader holding a phone.
 *
 * ── What this file measures ───────────────────────────────────────────────
 *
 * The first ten, on four pools shaped like real ones, against the composer with
 * the lane cap switched off. Aggregate metrics are not enough here: the
 * complaint was about a specific mix, so the assertions are about the mix.
 */

import { describe, expect, it } from 'vitest'

import { rankFeed, type PriorityInput, type RankedItem } from '../feed-priority'
import { composeFeed } from '../feed-compose'
import { readerQuestionFor } from '../reader-question'
import { categoryForType } from '../content-registry'
import { BRIEF_CLASSES, briefClassFor } from '../brief-class'
import type { SignalType } from '../contract'

const NOW = Date.parse('2026-09-08T12:00:00.000Z')
const DAY = 86_400_000

interface Cand {
  id: string
  family: string
  type: SignalType
  severity: PriorityInput['severity']
  weight: number | null
  dev: number | null
  days: number
  overdue: number | null
}

const rows = (
  n: number, family: string, type: string, f: (i: number) => Partial<Cand> = () => ({}),
): Cand[] => Array.from({ length: n }, (_, i) => ({
  id: `${family}-${i}`,
  family,
  type: type as SignalType,
  severity: 'attention' as const,
  weight: null,
  dev: null,
  days: i,
  overdue: null,
  ...f(i),
}))

const toInput = (c: Cand): PriorityInput => ({
  id: c.id,
  type: c.type,
  severity: c.severity,
  occurredAt: new Date(NOW - c.days * DAY).toISOString(),
  weightPct: c.weight,
  held: c.weight != null,
  deviationPct: c.dev,
  overdueDays: c.overdue,
  coverage: 'unknown',
})

function compose(pool: Cand[], over: Record<string, unknown> = {}) {
  return composeFeed(rankFeed(pool, toInput, NOW), {
    familyOf: (c: Cand) => c.family,
    subjectOf: () => null,
    questionOf: (c: Cand) => readerQuestionFor(c.type),
    categoryOf: (c: Cand) => categoryForType(c.type),
    briefOf: (c: Cand) => briefClassFor(c.type),
    trace: true,
    ...over,
  })
}

/** The composer as it stood before the lane cap: every other rule, unchanged. */
const withoutCap = (pool: Cand[]) => compose(pool, { maxPerBrief: 99 })

const top = <T>(order: RankedItem<Cand>[], n: number, f: (c: Cand) => T): T[] =>
  order.slice(0, n).map(r => f(r.item))

const counts = <T>(xs: T[]): Map<T, number> => {
  const m = new Map<T, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return m
}

const worst = <T>(xs: T[]): number => Math.max(0, ...counts(xs).values())

const lanesIn = (order: RankedItem<Cand>[], n = 10) =>
  top(order, n, c => String(briefClassFor(c.type)))
const questionsIn = (order: RankedItem<Cand>[], n = 10) =>
  top(order, n, c => String(readerQuestionFor(c.type)))
const familiesIn = (order: RankedItem<Cand>[], n = 10) => top(order, n, c => c.family)

// ─────────────────────────────────────────────────────────────────────────────
// A. The pool that produced the complaint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A pilot desk: plenty of attention, few written views.
 *
 * This is the shape the report came from. `awaiting_review`, `project_overdue`,
 * `coverage_gap`, `research_stale` and `recommendation` are five families, four
 * questions and three categories — and one lane.
 */
const WORK_HEAVY: Cand[] = [
  ...rows(9, 'awaiting_review', 'awaiting_review', i => ({ severity: i < 3 ? 'critical' : 'attention' })),
  ...rows(8, 'project_overdue', 'project_overdue', i => ({ severity: i < 2 ? 'critical' : 'attention', days: i + 2, overdue: 8 + i })),
  ...rows(7, 'coverage_gap', 'coverage_gap', i => ({ severity: i < 2 ? 'critical' : 'attention', days: 20 + i })),
  ...rows(11, 'trade_idea', 'trade_idea', () => ({ severity: 'informational' })),
  ...rows(9, 'thought', 'thought', () => ({ severity: 'informational' })),
  ...rows(2, 'research:long_silence', 'research_stale', i => ({ weight: 2 + i, days: i * 3 })),
  ...rows(1, 'research:no_case', 'no_research', i => ({ weight: 3 + i })),
  ...rows(6, 'news', 'news', () => ({ severity: 'informational' })),
  ...rows(1, 'recommendation', 'recommendation', () => ({ severity: 'critical' })),
]

describe('A. the work-heavy pool the reader complained about', () => {
  const before = withoutCap(WORK_HEAVY).order
  const after = compose(WORK_HEAVY).order

  /**
   * The ranked feed is nine tenths one lane, which is the honest starting point.
   *
   * Composition is not being asked to fix ranking. It is being asked to decide
   * what a screen looks like when the pool is like this.
   */
  it('starts from a top ten that is almost entirely one lane', () => {
    const ranked = rankFeed(WORK_HEAVY, toInput, NOW)
    expect(worst(lanesIn(ranked))).toBeGreaterThanOrEqual(9)
  })

  it('no longer lets one lane take half the first screen', () => {
    // Measured: 5 of 10 before the cap, 4 after.
    expect(worst(lanesIn(before))).toBeGreaterThanOrEqual(5)
    expect(worst(lanesIn(after))).toBeLessThanOrEqual(4)
  })

  it('shows at least four reader questions in the first ten', () => {
    expect(new Set(questionsIn(after)).size).toBeGreaterThanOrEqual(4)
  })

  it('shows at least four visible families in the first ten', () => {
    expect(new Set(familiesIn(after)).size).toBeGreaterThanOrEqual(4)
  })

  /**
   * The specific sequence from the report, as a count.
   *
   * Needs Review, Overdue and Coverage Gap are three of the five families in
   * the `work` lane; between them they may not hold most of the screen.
   */
  it('stops Needs Review, Overdue and Coverage Gap dominating together', () => {
    const trio = new Set(['awaiting_review', 'project_overdue', 'coverage_gap'])
    const held = familiesIn(after).filter(f => trio.has(f)).length
    expect(held).toBeLessThanOrEqual(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B. The other cluster from the report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A desk that talks: posts, and little else competing.
 *
 * A pair trade is a post whose stored type resolves to `thought`, so all three
 * of the families the reader named live in one lane and two of them share one
 * question already.
 */
const DESK_HEAVY: Cand[] = [
  ...rows(14, 'trade_idea', 'trade_idea', () => ({ severity: 'attention' })),
  ...rows(12, 'thought', 'thought', () => ({ severity: 'attention' })),
  ...rows(4, 'research_note', 'research_note', () => ({ severity: 'informational' })),
  ...rows(4, 'awaiting_review', 'awaiting_review'),
  ...rows(3, 'news', 'news', () => ({ severity: 'informational' })),
  ...rows(2, 'research:long_silence', 'research_stale', i => ({ weight: 2 + i })),
  ...rows(2, 'active_risk', 'active_risk', i => ({ weight: 6 + i })),
]

describe('B. the desk-heavy pool', () => {
  const before = withoutCap(DESK_HEAVY).order
  const after = compose(DESK_HEAVY).order

  /**
   * Already held, and the cap agrees rather than improving on it.
   *
   * Recorded because it is the honest result: on this pool the question and
   * category rules already keep the desk lane to four of ten, so the lane cap
   * binds at the same number and moves nothing. The reader's report of desk
   * clustering predates the screen-saturation rule that fixed it; this asserts
   * it stays fixed with the new axis in play rather than claiming a second
   * improvement that did not happen.
   */
  it('holds Thought, Trade idea and Research note to four of the first ten', () => {
    expect(worst(lanesIn(before))).toBeLessThanOrEqual(4)
    expect(worst(lanesIn(after))).toBeLessThanOrEqual(4)
    // And the ranked feed is what it is being held back from.
    expect(worst(lanesIn(rankFeed(DESK_HEAVY, toInput, NOW)))).toBeGreaterThanOrEqual(6)
  })

  it('still shows four distinct families in the first ten', () => {
    expect(new Set(familiesIn(after)).size).toBeGreaterThanOrEqual(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C. Priority is sovereign
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A desk where the important thing genuinely IS one lane.
 *
 * Five positions outside their modelled bands and two targets reached, against
 * a tail of posts and news that nobody would want instead. Concentration here
 * is the correct answer and the cap must not fight it.
 */
const CRITICAL_HEAVY: Cand[] = [
  ...rows(5, 'scenario_gap', 'scenario_gap', i => ({ severity: 'critical', weight: 6 + i, dev: 30 + i * 5 })),
  ...rows(2, 'target_hit', 'target_hit', i => ({ severity: 'critical', weight: 5 + i, dev: 20 + i })),
  ...rows(2, 'target_expired', 'target_expired', i => ({ severity: 'attention', weight: 4 + i, dev: 25 })),
  ...rows(10, 'thought', 'thought', () => ({ severity: 'informational' })),
  ...rows(8, 'news', 'news', () => ({ severity: 'informational' })),
]

describe('C. one lane that deserves the screen keeps it', () => {
  const after = compose(CRITICAL_HEAVY).order

  /**
   * Nothing trivial is promoted over something critical.
   *
   * The judgment lane holds nine candidates here, every one of them a position
   * against its own written range. The cap may cost it a slot or two of the
   * opening; it may not hand the top of the feed to a post.
   */
  it('keeps the critical lane at the top of the feed', () => {
    const firstFive = lanesIn(after, 5)
    expect(firstFive.filter(l => l === 'judgment').length).toBeGreaterThanOrEqual(3)
  })

  it('never puts an informational post above a critical position', () => {
    const ranked = rankFeed(CRITICAL_HEAVY, toInput, NOW)
    const best = ranked[0]
    expect(after[0].item.id).toBe(best.item.id)
  })

  /**
   * A displaced card is displaced by a comparable one, never by a distant one.
   *
   * The tolerance and the tier bound are what enforce that, and they are
   * unchanged. This asserts the property holds with the new axis in play.
   */
  it('pays no more than the screen tolerance for any swap', () => {
    const worstCost = Math.min(...compose(CRITICAL_HEAVY).trace.map(t => t.priorityCost))
    expect(worstCost).toBeGreaterThan(-0.31)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// D. A balanced pool is left alone
// ─────────────────────────────────────────────────────────────────────────────

const BALANCED: Cand[] = [
  ...rows(3, 'scenario_gap', 'scenario_gap', i => ({ weight: 4 + i, dev: 20 + i })),
  ...rows(3, 'awaiting_review', 'awaiting_review'),
  ...rows(3, 'trade_idea', 'trade_idea', () => ({ severity: 'informational' })),
  ...rows(3, 'news', 'news', () => ({ severity: 'informational' })),
  ...rows(3, 'active_risk', 'active_risk', i => ({ weight: 5 + i })),
  ...rows(3, 'coverage_gap', 'coverage_gap'),
]

describe('D. a pool that is already varied is not rearranged', () => {
  it('changes nothing when no lane is over its share', () => {
    const before = withoutCap(BALANCED).order.map(r => r.item.id)
    const after = compose(BALANCED).order.map(r => r.item.id)
    expect(after).toEqual(before)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The properties that must survive all four
// ─────────────────────────────────────────────────────────────────────────────

describe('the rule is an editor, not a shuffler', () => {
  const POOLS = { WORK_HEAVY, DESK_HEAVY, CRITICAL_HEAVY, BALANCED }

  it.each(Object.entries(POOLS))('%s is deterministic', (_name, pool) => {
    expect(compose(pool).order.map(r => r.item.id))
      .toEqual(compose(pool).order.map(r => r.item.id))
  })

  it.each(Object.entries(POOLS))('%s loses no candidate', (_name, pool) => {
    const order = compose(pool).order
    expect(order).toHaveLength(pool.length)
    expect(new Set(order.map(r => r.item.id)).size).toBe(pool.length)
  })

  /**
   * Not a round robin.
   *
   * A rule that cycled the lanes would produce a repeating period, and a reader
   * notices that faster than they notice repetition. The opening is checked for
   * an exact cycle of the lanes present in it.
   */
  it.each(Object.entries(POOLS))('%s does not cycle its lanes', (_name, pool) => {
    const lanes = lanesIn(compose(pool).order)
    const distinct = [...new Set(lanes)]
    if (distinct.length < 2) return
    const period = distinct.length
    const cyclic = lanes.every((l, i) => l === lanes[i % period])
    expect(cyclic).toBe(false)
  })

  /**
   * The cap is off the moment the reader names what they want.
   *
   * Asking for one family and being handed a briefing composed around it would
   * be the filter diversifying other families back in — the exact-filter
   * contract, broken. `scope` is what carries that, and the lane rule follows
   * the category cap in respecting it.
   */
  it('does not compose a briefing inside a filtered view', () => {
    const filtered = WORK_HEAVY.filter(c => c.family === 'awaiting_review')
    const ranked = rankFeed(filtered, toInput, NOW).map(r => r.item.id)
    const composed = composeFeed(rankFeed(filtered, toInput, NOW), {
      familyOf: (c: Cand) => c.family,
      subjectOf: () => null,
      questionOf: (c: Cand) => readerQuestionFor(c.type),
      categoryOf: (c: Cand) => categoryForType(c.type),
      briefOf: (c: Cand) => briefClassFor(c.type),
      scope: 'type',
    }).order.map(r => r.item.id)
    expect(composed).toEqual(ranked)
  })

  /** Every lane is reachable and none of them is a colour. */
  it('names five lanes and derives them from the type', () => {
    expect(BRIEF_CLASSES).toHaveLength(5)
    expect(briefClassFor('awaiting_review')).toBe('work')
    expect(briefClassFor('research_stale')).toBe('work')
    expect(briefClassFor('coverage_gap')).toBe('work')
    expect(briefClassFor('recommendation')).toBe('work')
    expect(briefClassFor('scenario_gap')).toBe('judgment')
    expect(briefClassFor('trade_idea')).toBe('desk')
    expect(briefClassFor('news')).toBe('market')
    expect(briefClassFor('active_risk')).toBe('book')
    expect(briefClassFor(null)).toBeNull()
  })
})
