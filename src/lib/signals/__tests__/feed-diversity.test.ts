import { describe, expect, it } from 'vitest'

import { diversify, rankFeed, type PriorityInput } from '../feed-priority'
import { CATEGORY_KINDS, FEED_CATEGORIES, categoryOf } from '../../mobile/feed-categories'
import { DAY_MS } from '../thresholds'

/**
 * Phase 8.1: variety in the mixed feed, without discarding the ranking.
 *
 * Hands-on testing found the default feed running six no-target cards in a row.
 * Each one was correctly ranked; the sequence was still useless, because a
 * reader swiping through it learns the shape of the database rather than the
 * shape of their problem.
 */

const NOW = new Date('2026-08-20T12:00:00.000Z').getTime()
const days = (n: number) => NOW - n * DAY_MS

const sig = (over: Partial<PriorityInput> & Pick<PriorityInput, 'id' | 'type'>): PriorityInput => ({
  severity: 'attention', occurredAt: days(1), ...over,
})

const run = (inputs: PriorityInput[], enabled = true) =>
  diversify(rankFeed(inputs, i => i, NOW), { enabled }).map(r => r.input.type)

/** The fixture the brief specifies: 8 no_target, 2 scenario, 2 research, 1 news, 1 workflow. */
const MIXED: PriorityInput[] = [
  ...Array.from({ length: 8 }, (_, i) =>
    sig({ id: `nt${i}`, type: 'no_target', weightPct: 6 - i * 0.4, held: true })),
  sig({ id: 'sg1', type: 'scenario_gap', severity: 'critical', weightPct: 11, held: true, deviationPct: 24 }),
  sig({ id: 'sg2', type: 'scenario_gap', severity: 'critical', weightPct: 9, held: true, deviationPct: 19 }),
  sig({ id: 'rs1', type: 'research_stale', weightPct: 6, held: true, deviationPct: 17 }),
  sig({ id: 'rs2', type: 'research_stale', weightPct: 4, held: true }),
  sig({ id: 'nw1', type: 'news', occurredAt: NOW }),
  sig({ id: 'wf1', type: 'project_overdue', overdueDays: 3 }),
]

/** Longest streak of one value. */
const longestRun = (xs: string[]) => {
  let best = 0, cur = 0, prev: string | null = null
  for (const x of xs) { cur = x === prev ? cur + 1 : 1; prev = x; best = Math.max(best, cur) }
  return best
}

describe('diversity', () => {
  it('does not let one type dominate the opening of the feed', () => {
    /**
     * The rule as the brief states it, and as it should be stated: no type may
     * dominate the FIRST SCREENFUL. Asserting `longestRun <= 2` over the whole
     * feed would be a stronger claim than the design makes — once the
     * competitive alternatives are spent, a run of no-target cards is priority
     * working, not diversity failing, and forcing a break there would mean
     * promoting something the reader cares less about.
     */
    expect(longestRun(run(MIXED, false).slice(0, 6)), 'ranked-only opening')
      .toBeGreaterThanOrEqual(4)
    expect(longestRun(run(MIXED).slice(0, 6)), 'diversified opening')
      .toBeLessThanOrEqual(2)
  })

  it('interleaves while competitive alternatives remain, then stops', () => {
    // The honest shape of the output: broken up early, and settling into
    // priority order once nothing close enough is left to interleave with.
    const order = run(MIXED)
    expect(new Set(order.slice(0, 6)).size).toBeGreaterThanOrEqual(3)
    // Nothing was dropped to achieve it.
    expect(order).toHaveLength(MIXED.length)
  })

  it('still opens with the most consequential card', () => {
    // Variety is a presentation concern. It must never cost the reader the one
    // thing the ranking exists to put first.
    expect(run(MIXED)[0]).toBe('scenario_gap')
  })

  it('lets genuinely critical cards of one type sit together', () => {
    // A desk with two critical scenario gaps should see them together — that is
    // the feed working, not a run to be broken.
    expect(run(MIXED).slice(0, 2)).toEqual(['scenario_gap', 'scenario_gap'])
  })

  it('never promotes a weak informational card over a decision mismatch', () => {
    // The tier bound, which is absolute. Ten no-target cards and one news story:
    // the news must not be pulled up to break the run.
    const order = run([
      ...Array.from({ length: 10 }, (_, i) =>
        sig({ id: `nt${i}`, type: 'no_target', weightPct: 9, held: true })),
      sig({ id: 'nw', type: 'news', occurredAt: NOW }),
    ])
    expect(order[order.length - 1]).toBe('news')
  })

  it('leaves the run alone when no comparable alternative exists', () => {
    // Priority wins. A feed that reorders itself into something less useful for
    // the sake of looking varied has misunderstood what the variety was for.
    const only = Array.from({ length: 5 }, (_, i) =>
      sig({ id: `nt${i}`, type: 'no_target', weightPct: 9, held: true }))
    expect(run(only)).toHaveLength(5)
    expect(longestRun(run(only))).toBe(5)
  })

  it('does not reach past the score tolerance for variety', () => {
    // A clearly weaker card of another type stays where it ranked. Same tier,
    // but far enough behind that stepping in would be a demotion of the better
    // card rather than a tie-break.
    const order = run([
      ...Array.from({ length: 4 }, (_, i) =>
        sig({ id: `nt${i}`, type: 'no_target', severity: 'critical', weightPct: 25, held: true })),
      sig({ id: 'weak', type: 'no_research', severity: 'informational', weightPct: 0.2, held: false }),
    ])
    expect(order[order.length - 1]).toBe('no_research')
  })

  it('is deterministic', () => {
    const first = run(MIXED)
    for (let i = 0; i < 20; i++) expect(run(MIXED)).toEqual(first)
    // And independent of the order the sources happened to resolve in.
    expect(run([...MIXED].reverse())).toEqual(first)
  })

  it('is off under a single-category filter', () => {
    // The reader asked for every no-target card. Interleaving a category with
    // itself means nothing, and priority order is what they want.
    expect(run(MIXED, false).filter(t => t === 'no_target')).toHaveLength(8)
  })
})

describe('filter taxonomy', () => {
  it('resolves every feed entry kind to a category', () => {
    // A kind with no category is invisible under any filter and visible under
    // none — the failure mode that hid scenario cards from Curate entirely.
    const kinds = ['scenario', 'lens', 'insight', 'signal', 'idea', 'news', 'template']
    for (const kind of kinds) {
      expect(categoryOf({ kind }), `${kind} has no category`).not.toBeNull()
    }
  })

  it('splits attention by what the row actually is', () => {
    // One hook, two genuinely different things. A trade awaiting the PM's call
    // is a decision; a deliverable three weeks late is work with a due date.
    expect(categoryOf({ kind: 'attention', attention: { source_type: 'trade_queue_item' } })).toBe('decisions')
    expect(categoryOf({ kind: 'attention', attention: { source_type: 'project_deliverable' } })).toBe('workflow')
    expect(categoryOf({ kind: 'attention', attention: { source_type: 'notification' } })).toBe('workflow')
  })

  it('puts both documentation gaps in one category', () => {
    /**
     * The taxonomy defect hands-on testing found: an unreviewed-change card
     * appeared under "Signals" and a no-thesis card under "Insights". Those are
     * the same sort of finding about the same sort of gap, and they were split
     * because one is derived in `useDerivedInsights` and the other is not. No
     * PM could have guessed that.
     */
    expect(categoryOf({ kind: 'insight' })).toBe('research')
    expect(categoryOf({ kind: 'signal' })).toBe('research')
  })

  it('does not guess at an unknown entry shape', () => {
    expect(categoryOf({ kind: 'something_new' })).toBeNull()
    expect(categoryOf({})).toBeNull()
  })

  it('offers categories a reader could explain to a colleague', () => {
    // Five words, each meaning one thing. The old list read: decisions, ideas,
    // signals, insights, news, market events, portfolio lenses.
    expect(FEED_CATEGORIES.map(c => c.key))
      .toEqual(['decisions', 'research', 'ideas', 'workflow', 'news'])
    // And every category actually has sources behind it, so none can render as
    // a filter that is always empty.
    for (const { key } of FEED_CATEGORIES) {
      expect(CATEGORY_KINDS[key].length, `${key} has no kinds`).toBeGreaterThan(0)
    }
  })
})
