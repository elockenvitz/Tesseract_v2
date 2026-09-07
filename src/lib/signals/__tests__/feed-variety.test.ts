/**
 * How repetitive the composed feed actually is, measured.
 *
 * ── The report this answers ───────────────────────────────────────────────
 *
 * Manual QA, after the diversity axis was corrected to name the visible family:
 * "many tiles of one visible family consecutively, followed by a long run of
 * another." The axis was right and the rule was not binding.
 *
 * Two constants moved, both chosen from the numbers below rather than picked:
 *
 *   MAX_RUN                 2 → 1     prefer not to place two together
 *   FAMILY_BREAK_LOOKAHEAD  new, 48   reach far enough to find the alternative
 *
 * The TOLERANCE is deliberately unchanged. It was never what was binding — an
 * alternative family is reachable at 91 of 94 positions at 0.15 — and widening
 * it to 0.45 made the sequence WORSE while more than doubling what the pass
 * costs in priority. That measurement is asserted below so nobody repeats it.
 *
 * ── Why this file exists rather than a comment ────────────────────────────
 *
 * "The feed feels repetitive" is the kind of claim that gets fixed by feel and
 * regresses by feel. These are the four numbers that say whether it is true:
 * the longest run of one family, how many adjacent pairs there are, how far the
 * pass moved anything, and how far it moved anything IMPORTANT.
 */

import { describe, expect, it } from 'vitest'

import { rankFeed, type PriorityInput, type RankedItem } from '../feed-priority'
import { composeFeed } from '../feed-compose'
import { readerQuestionFor } from '../reader-question'

interface Cand {
  id: string
  family: string
  type: string
  weight: number | null
  dev: number | null
  days: number
}

/**
 * A pool shaped like the feed the reader described.
 *
 * Dominated by attention and posts, with a thin spine of decision cards — 94
 * candidates, which is the order of magnitude a real desk produces. The shape
 * matters more than the exact counts: the failure only appears when one family
 * occupies a contiguous stretch of the ranked list, which is what a score-sorted
 * list does whenever one family dominates a tier.
 */
function pool(): Cand[] {
  const rows: Cand[] = []
  const push = (n: number, family: string, type: string, f: (i: number) => Partial<Cand>) => {
    for (let i = 0; i < n; i++) {
      rows.push({ id: `${family}-${i}`, family, type, weight: null, dev: null, days: i, ...f(i) })
    }
  }
  push(18, 'project_overdue', 'project_overdue', i => ({ days: i }))
  push(14, 'awaiting_review', 'awaiting_review', i => ({ days: i }))
  push(22, 'trade_idea', 'trade_idea', i => ({ days: i }))
  push(16, 'thought', 'thought', i => ({ days: i }))
  push(6, 'research:long_silence', 'research_stale', i => ({ weight: 2 + i, days: i * 3 }))
  push(4, 'research:no_case', 'no_research', i => ({ weight: 3 + i, days: i * 3 }))
  push(3, 'scenario_gap', 'scenario_gap', i => ({ weight: 4 + i, dev: 20 + i * 4, days: i }))
  push(2, 'target_expired', 'target_expired', i => ({ dev: 30, days: i }))
  push(9, 'news', 'news', i => ({ days: i }))
  return rows
}

const NOW = Date.parse('2026-09-07T12:00:00.000Z')

const toInput = (c: Cand): PriorityInput => ({
  id: c.id,
  type: c.type as never,
  severity: 'attention',
  occurredAt: new Date(NOW - c.days * 86_400_000).toISOString(),
  weightPct: c.weight,
  held: c.weight != null,
  deviationPct: c.dev,
  coverage: 'unknown',
})

const ranked = (): RankedItem<Cand>[] => rankFeed(pool(), toInput, NOW)

function compose(over: Record<string, unknown> = {}) {
  return composeFeed(ranked(), {
    familyOf: (c: Cand) => c.family,
    subjectOf: () => null,
    questionOf: (c: Cand) => readerQuestionFor(c.type),
    categoryOf: () => null,
    trace: true,
    ...over,
  })
}

interface Metrics {
  longestRun: number
  adjacentPairs: number
  /** The worst score a card gave up to be pulled forward. Zero or negative. */
  worstPriorityCost: number
  /** How far the ten highest-ranked cards moved. */
  topTenMaxDrift: number
}

function measure(result: ReturnType<typeof compose>): Metrics {
  const seq = result.order.map(r => r.item.family)
  let longestRun = 1
  let run = 1
  let adjacentPairs = 0
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) {
      run += 1
      adjacentPairs += 1
      longestRun = Math.max(longestRun, run)
    } else run = 1
  }
  const topTen = result.trace.filter(t => t.rankBefore <= 10)
  return {
    longestRun,
    adjacentPairs,
    worstPriorityCost: Math.min(...result.trace.map(t => t.priorityCost)),
    topTenMaxDrift: Math.max(0, ...topTen.map(t => Math.abs(t.rankAfter - t.rankBefore))),
  }
}

describe('the composed feed is not a run of one family', () => {
  const shipped = measure(compose())

  /**
   * Before: longest run 9, 21 adjacent pairs out of 93.
   *
   * Those are the numbers this pool produced under `MAX_RUN = 2` with the
   * ordinary twelve-place lookahead — the build manual QA was looking at.
   */
  it('never places three of one family together', () => {
    expect(shipped.longestRun).toBeLessThanOrEqual(2)
  })

  it('leaves almost no adjacent pairs at all', () => {
    // 21 before. The one that survives is at the tail, where the pool has run
    // out of anything else — which is allowed and is the point of rule 4.
    expect(shipped.adjacentPairs).toBeLessThanOrEqual(2)
  })

  /**
   * Against the family rule switched off entirely.
   *
   * The historical "before" — longest run 9, 21 adjacent pairs — cannot be
   * reproduced through options any more, because the escalated reach is a
   * module constant rather than the `lookahead` argument. Those numbers stay
   * recorded in the header as the measurement that motivated the change; this
   * asserts the same thing against a baseline that IS reproducible, so the
   * comparison cannot go stale.
   */
  it('is far better than leaving the family rule off', () => {
    const off = measure(compose({ maxRun: 99, familyWindow: 0 }))
    expect(off.longestRun).toBeGreaterThanOrEqual(5)
    expect(shipped.longestRun).toBeLessThan(off.longestRun)
    expect(shipped.adjacentPairs).toBeLessThan(off.adjacentPairs)
  })
})

describe('importance stays sovereign', () => {
  const shipped = measure(compose())

  /**
   * Nothing is buried for variety.
   *
   * A card may only be pulled ahead of the head when it is inside the
   * tolerance, so the most any card gives up is bounded by that. This asserts
   * the bound holds in practice rather than only in principle.
   */
  it('never displaces a card by more than the tolerance', () => {
    expect(shipped.worstPriorityCost).toBeGreaterThan(-0.16)
  })

  it('keeps the highest-ranked cards near where rankFeed put them', () => {
    expect(shipped.topTenMaxDrift).toBeLessThanOrEqual(8)
  })

  /**
   * The sequence improves for almost nothing.
   *
   * Measured against the family rule off: −0.143 where doing nothing costs
   * −0.136. Two hundredths of one card's score buys a longest run of 9 → 2.
   */
  it('costs barely more priority than doing nothing', () => {
    const off = measure(compose({ maxRun: 99, familyWindow: 0 }))
    expect(shipped.worstPriorityCost).toBeGreaterThan(off.worstPriorityCost - 0.02)
  })

  /**
   * Why the tolerance was not widened, kept as a number.
   *
   * Reaching further finds the alternative. Lowering the bar admits worse ones,
   * and measurably produced a WORSE sequence for more than twice the priority
   * cost. Anybody tempted to loosen it should have to delete this.
   */
  it('records that a looser tolerance is worse on both axes', () => {
    const looser = measure(compose({ tolerance: 0.45 }))
    expect(looser.longestRun).toBeGreaterThan(shipped.longestRun)
    expect(looser.worstPriorityCost).toBeLessThan(shipped.worstPriorityCost * 2)
  })
})

describe('the result is composed, not alternated', () => {
  it('is deterministic across runs of the same input', () => {
    const a = compose().order.map(r => r.item.id)
    const b = compose().order.map(r => r.item.id)
    expect(a).toEqual(b)
  })

  /**
   * Not a fixed cycle.
   *
   * Fake alternation would repeat one period forever. The real sequence changes
   * which families are available as the pool drains, so the set of families in
   * the first quarter is not the set in the last.
   */
  it('does not settle into one repeating period', () => {
    const seq = compose().order.map(r => r.item.family)
    const quarter = Math.floor(seq.length / 4)
    const head = new Set(seq.slice(0, quarter))
    const tail = new Set(seq.slice(-quarter))
    expect([...head].some(f => !tail.has(f))).toBe(true)
  })

  it('lets a family repeat when the pool genuinely has nothing else', () => {
    // A pool of one family cannot be varied, and must not be dropped for it.
    const only = Array.from({ length: 6 }, (_, i) => ({
      id: `t-${i}`, family: 'thought', type: 'thought',
      weight: null, dev: null, days: i,
    }))
    const composed = composeFeed(rankFeed(only, toInput, NOW), {
      familyOf: (c: Cand) => c.family,
      subjectOf: () => null,
      categoryOf: () => null,
    })
    expect(composed.order).toHaveLength(6)
  })

  it('keeps every candidate — this reorders and never drops', () => {
    const composed = compose()
    expect(composed.order).toHaveLength(pool().length)
    expect(new Set(composed.order.map(r => r.item.id)).size).toBe(pool().length)
  })
})
