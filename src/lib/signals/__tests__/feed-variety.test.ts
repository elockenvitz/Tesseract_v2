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
import { categoryForType } from '../content-registry'
import type { SignalType } from '../contract'

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

/** The screen the saturation rule measures. Mirrors the module's own. */
const VIEWPORT = 6

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
    /**
     * The real category, because production passes one.
     *
     * This was `() => null`, which switched off both the opening cap and — once
     * it existed — the saturation rule, so the file measured a composer the
     * feed does not run. The second cluster manual QA reported is a CATEGORY
     * cluster, and it was invisible here for exactly that reason.
     */
    categoryOf: (c: Cand) => categoryForType(c.type as SignalType),
    trace: true,
    ...over,
  })
}

/** How many windows of six are more than half one value, on one axis. */
function saturatedWindows(seq: string[], n = 6): number {
  let dom = 0
  for (let i = 0; i + n <= seq.length; i++) {
    const counts = new Map<string, number>()
    for (const v of seq.slice(i, i + n)) counts.set(v, (counts.get(v) ?? 0) + 1)
    if (Math.max(...counts.values()) > n / 2) dom += 1
  }
  return dom
}

interface Metrics {
  longestRun: number
  /** The longest run before the pool runs out of alternatives. */
  longestReachableRun: number
  adjacentPairs: number
  /** Windows of six more than half one family / question / category. */
  familySaturated: number
  questionSaturated: number
  categorySaturated: number
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
  /**
   * The last screen is not the feed.
   *
   * Rule 4 permits a family to repeat when nothing else is left, and on a
   * 94-card pool that is literally the last three cards: the thoughts are
   * exhausted and only trade ideas remain. Measuring the whole list makes the
   * headline number a statement about the tail nobody scrolls to. Both are
   * reported — the whole list, and the part a reader can reach.
   */
  const reachable = result.order.slice(0, -VIEWPORT).map(r => r.item.family)
  const questions = result.order.map(r => String(readerQuestionFor(r.item.type)))
  const categories = result.order.map(r => String(categoryForType(r.item.type as SignalType)))
  return {
    longestRun,
    longestReachableRun: (() => {
      let best = 1
      let run = 1
      for (let i = 1; i < reachable.length; i++) {
        if (reachable[i] === reachable[i - 1]) best = Math.max(best, ++run)
        else run = 1
      }
      return best
    })(),
    adjacentPairs,
    familySaturated: saturatedWindows(seq),
    questionSaturated: saturatedWindows(questions),
    categorySaturated: saturatedWindows(categories),
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
  it('never repeats a family anywhere a reader can reach', () => {
    /**
     * One, not two — no family appears twice in a row in the first 88 of 94.
     *
     * The whole-list number is 3, and all three are the last three cards, where
     * the pool holds nothing but trade ideas because the thoughts are used up.
     * That is rule 4 working, not the rule failing, and asserting on the whole
     * list made the headline figure a statement about the tail.
     */
    expect(shipped.longestReachableRun).toBe(1)
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
  it('never displaces a card by more than the widest tolerance in play', () => {
    /**
     * −0.295 against a 0.30 bar, and the bar is the saturation rule's.
     *
     * It was −0.143 against 0.15 while only the run rules could bind. Breaking
     * a screen that is more than half one kind of work needs a wider bar,
     * because a pool stratified by category has no alternative inside 0.15 —
     * see `SCREEN_TOLERANCE`, where the sweep that chose 0.30 is recorded.
     * Nothing exceeds the bar it was given, which is the property that matters.
     */
    expect(shipped.worstPriorityCost).toBeGreaterThan(-0.31)
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
  /**
   * Why the ORDINARY tolerance is still 0.15, re-measured.
   *
   * It was recorded here as making the sequence worse. With the saturation rule
   * in place and the real category on the harness, the claim has to be restated
   * against what actually changed: widening the ordinary bar to 0.45 buys no
   * reduction in screen domination at all — one MORE saturated category window,
   * 10 against 9 — and costs more displacement and more top-of-feed drift.
   *
   * The narrow bar is not what was standing between the reader and a varied
   * screen. Reach was, and then a bar wide enough to see across a stratified
   * pool at the one moment it matters. Anybody tempted to loosen the general
   * case should have to delete this.
   */
  it('records that a looser ordinary tolerance buys nothing and costs more', () => {
    const looser = measure(compose({ tolerance: 0.45 }))
    expect(looser.categorySaturated).toBeGreaterThanOrEqual(shipped.categorySaturated)
    expect(looser.worstPriorityCost).toBeLessThan(shipped.worstPriorityCost)
    expect(looser.topTenMaxDrift).toBeGreaterThanOrEqual(shipped.topTenMaxDrift)
  })
})

/**
 * The complaint the run rules could not answer.
 *
 * Manual QA with the longest exact-family run already at two: "many Trade
 * Ideas / Thoughts / Pair Trades clustered together, then many No Core Thesis /
 * New Research tiles — the sequence technically avoids huge exact-family runs
 * but still feels semantically repetitive."
 *
 * A run rule constrains adjacency. A phone screen is a window, and one kind of
 * work can fill it without ever repeating twice in a row.
 */
describe('no one kind of work fills the screen', () => {
  const shipped = measure(compose())
  const off = measure(compose({ maxPerViewport: 99 }))

  it('halves the screens dominated by one category', () => {
    // Measured: 20 of 89 windows before, 9 after.
    expect(off.categorySaturated).toBeGreaterThanOrEqual(18)
    expect(shipped.categorySaturated).toBeLessThanOrEqual(10)
  })

  it('cuts the screens dominated by one reader question', () => {
    // Measured: 14 of 89 windows before, 9 after.
    expect(shipped.questionSaturated).toBeLessThan(off.questionSaturated)
    expect(shipped.questionSaturated).toBeLessThanOrEqual(10)
  })

  it('leaves the family axis, which was already varied, alone', () => {
    // The family rules were doing their job: 1 saturated window before.
    expect(shipped.familySaturated).toBeLessThanOrEqual(off.familySaturated + 1)
  })

  /**
   * The soft target, stated as the reader would state it.
   *
   * Three distinct families on a normal screen, on average, whenever the pool
   * has alternatives. Measured at 4.55 after and 4.46 before.
   */
  it('shows at least three distinct families on an average screen', () => {
    const seq = compose().order.map(r => r.item.family)
    const counts: number[] = []
    for (let i = 0; i + VIEWPORT <= seq.length; i++) {
      counts.push(new Set(seq.slice(i, i + VIEWPORT)).size)
    }
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length
    expect(avg).toBeGreaterThanOrEqual(3)
  })

  it('is still deterministic with the rule on', () => {
    expect(compose().order.map(r => r.item.id))
      .toEqual(compose().order.map(r => r.item.id))
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
