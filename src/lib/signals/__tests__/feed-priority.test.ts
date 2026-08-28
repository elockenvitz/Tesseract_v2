import { describe, expect, it } from 'vitest'

import {
  compareRanked, explainPriority, materialityBand, priorityFor, rankFeed,
  type PriorityInput,
} from '../feed-priority'
import { CLASSIFIED_JUDGMENT_KEYS, acknowledgmentFor, policyForJudgment } from '../judgment-policy'
import { DAY_MS } from '../thresholds'

/**
 * Phase 8: the feed as attention allocation rather than a list of alerts.
 *
 * Every clock here is an explicit `NOW`. The ranking model takes `now` as a
 * parameter precisely so these cannot depend on when they run — a test whose
 * expected order drifts with the wall clock proves nothing about ordering.
 */

const NOW = new Date('2026-08-19T12:00:00.000Z').getTime()
const days = (n: number) => NOW - n * DAY_MS

const sig = (over: Partial<PriorityInput> & Pick<PriorityInput, 'id' | 'type'>): PriorityInput => ({
  severity: 'attention',
  occurredAt: days(1),
  ...over,
})

/** Rank a list of raw inputs and return the ids, in order. */
const order = (inputs: PriorityInput[]) =>
  rankFeed(inputs, i => i, NOW).map(r => r.input.id)

describe('ordering cases', () => {
  it('case 1: a scenario gap on a held position leads stale research', () => {
    // The core claim of the phase. The stale card is newer and that must not
    // matter — a price outside the desk's own ladder is a decision already
    // overdue, and "nobody has looked lately" is not.
    expect(order([
      sig({ id: 'stale', type: 'research_stale', weightPct: 2, occurredAt: days(0) }),
      sig({ id: 'gap', type: 'scenario_gap', weightPct: 6, severity: 'critical',
            deviationPct: 18, occurredAt: days(9) }),
    ])).toEqual(['gap', 'stale'])
  })

  it('case 2: the bigger position leads, all else equal', () => {
    expect(order([
      sig({ id: 'small', type: 'no_target', weightPct: 1 }),
      sig({ id: 'big', type: 'no_target', weightPct: 25 }),
    ])).toEqual(['big', 'small'])
  })

  it('case 3: an old unresolved high-impact card stays ahead of fresh trivia', () => {
    // Recency is a bounded modifier, not the sort key. A 200-day-old breach
    // beats a news story published a minute ago.
    expect(order([
      sig({ id: 'news', type: 'news', occurredAt: NOW, weightPct: 30 }),
      sig({ id: 'breach', type: 'target_hit', severity: 'critical',
            deviationPct: 22, occurredAt: days(200) }),
    ])).toEqual(['breach', 'news'])
  })

  it('case 4: a material scenario breach leads an overdue project', () => {
    expect(order([
      sig({ id: 'project', type: 'project_overdue', overdueDays: 2, severity: 'attention' }),
      sig({ id: 'gap', type: 'scenario_gap', weightPct: 12, severity: 'critical', deviationPct: 20 }),
    ])).toEqual(['gap', 'project'])
  })

  it('case 5: the held name leads the watchlist name on the same signal', () => {
    expect(order([
      sig({ id: 'unheld', type: 'target_hit', held: false, weightPct: null }),
      sig({ id: 'held', type: 'target_hit', held: true, weightPct: 4 }),
    ])).toEqual(['held', 'unheld'])
  })

  it('case 6: the larger framework deviation leads, within one signal type', () => {
    expect(order([
      sig({ id: 'slight', type: 'scenario_gap', weightPct: 5, deviationPct: 3 }),
      sig({ id: 'severe', type: 'scenario_gap', weightPct: 5, deviationPct: 34 }),
    ])).toEqual(['severe', 'slight'])
  })
})

describe('tiers hold against arithmetic', () => {
  it('a huge position on a news card cannot outrank a small real breach', () => {
    /**
     * The reason tiers exist at all. Under a purely additive model a 40%
     * position would carry enough materiality to lift an informational card
     * over a genuine decision mismatch, and no coefficient fixes that: the two
     * are different kinds of claim, not different amounts of one.
     */
    const news = priorityFor(sig({ id: 'n', type: 'news', weightPct: 40, severity: 'attention' }), NOW)
    const breach = priorityFor(sig({ id: 'b', type: 'scenario_gap', weightPct: 0.5 }), NOW)
    expect(news.total).toBeGreaterThan(breach.total * 0.5) // genuinely competitive on score
    expect(order([
      sig({ id: 'news', type: 'news', weightPct: 40 }),
      sig({ id: 'gap', type: 'scenario_gap', weightPct: 0.5 }),
    ])).toEqual(['gap', 'news'])
  })

  it('a severely overdue workflow is promoted, but not into a decision tier', () => {
    // Three weeks late with someone waiting is a real failure, not housekeeping.
    expect(priorityFor(sig({ id: 'p', type: 'project_overdue', overdueDays: 2 }), NOW).tier).toBe(3)
    const severe = priorityFor(sig({ id: 'p', type: 'project_overdue', overdueDays: 30 }), NOW)
    expect(severe.tier).toBe(2)
    // Still below a position that has left its framework.
    expect(order([
      sig({ id: 'project', type: 'project_overdue', overdueDays: 30 }),
      sig({ id: 'gap', type: 'scenario_gap', weightPct: 3 }),
    ])).toEqual(['gap', 'project'])
  })

  it('ranks an unknown signal type last rather than throwing', () => {
    const p = priorityFor(sig({ id: 'x', type: 'made_up' as never }), NOW)
    expect(p.tier).toBe(4)
  })
})

describe('materiality', () => {
  it('bands rather than scales, so 20% is not twenty times 1%', () => {
    const one = materialityBand(1, true)
    const twenty = materialityBand(20, true)
    expect(twenty).toBeGreaterThan(one)
    expect(twenty / one).toBeLessThan(4)
  })

  it('treats unknown weight as neutral, not as tiny', () => {
    /**
     * `TargetBreach` and `StaleTarget` carry no weight at all, so the two
     * highest-precedence lenses in the product have `weightPct == null`. If
     * null scored as the bottom band, every target card would sink beneath
     * every sized one — a data-plumbing gap silently reordering the feed.
     */
    expect(materialityBand(null, true)).toBeGreaterThan(materialityBand(0.2, true))
    expect(materialityBand(null, true)).toBeLessThan(materialityBand(6, true))
    // An unheld name is genuinely less material than a held one.
    expect(materialityBand(null, false)).toBeLessThan(materialityBand(null, true))
  })
})

describe('recency', () => {
  it('breaks ties but never reorders tiers', () => {
    expect(order([
      sig({ id: 'old', type: 'no_target', weightPct: 5, occurredAt: days(60) }),
      sig({ id: 'new', type: 'no_target', weightPct: 5, occurredAt: NOW }),
    ])).toEqual(['new', 'old'])
  })

  it('is capped, so an old high-impact card does not sink indefinitely', () => {
    const fresh = priorityFor(sig({ id: 'f', type: 'news', occurredAt: NOW }), NOW)
    const ancient = priorityFor(sig({ id: 'a', type: 'news', occurredAt: days(400) }), NOW)
    expect(fresh.total - ancient.total).toBeLessThanOrEqual(0.12 + 1e-9)
  })
})

describe('acknowledgment is not resolution', () => {
  const gap = (key: string, at: number) =>
    sig({ id: 'gap', type: 'scenario_gap', weightPct: 8, judgment: { key, at } })

  it('confirmed current buys a long quiet', () => {
    const p = priorityFor(gap('scenario_thesis_intact', days(1)), NOW)
    expect(p.suppressed).toBe(true)
    expect(p.acknowledgment.category).toBe('confirmed')
    // Answering the question is not the same as the issue being closed.
    expect(p.acknowledgment.resolved).toBe(false)
  })

  it('action needed is acknowledged and still open', () => {
    const fresh = priorityFor(gap('scenario_cases_outdated', days(1)), NOW)
    expect(fresh.suppressed).toBe(true)
    expect(fresh.acknowledgment.resolved).toBe(false)

    // And it comes back, because the framework is still stale.
    const later = priorityFor(gap('scenario_cases_outdated', days(10)), NOW)
    expect(later.suppressed).toBe(false)
  })

  it('does not make an acknowledged card disappear forever', () => {
    // The specific failure the phase forbids. A year on, still visible.
    expect(priorityFor(gap('scenario_cases_outdated', days(365)), NOW).suppressed).toBe(false)
  })

  it('needs review comes back sooner than action needed', () => {
    expect(policyForJudgment('scenario_needs_review').quietDays)
      .toBeLessThan(policyForJudgment('scenario_cases_outdated').quietDays)
    // Five days on: the uncertain answer is back, the action-needed one is not.
    expect(priorityFor(gap('scenario_needs_review', days(5)), NOW).suppressed).toBe(false)
    expect(priorityFor(gap('scenario_cases_outdated', days(5)), NOW).suppressed).toBe(true)
  })

  it('does not punish the reader for answering', () => {
    /**
     * "Needs review" must not pin the card to the top of tomorrow's feed. If
     * engaging makes the surface louder, the rational move is to stop engaging,
     * and the judgment layer dies.
     */
    const answered = priorityFor(gap('scenario_needs_review', days(5)), NOW)
    const never = priorityFor(sig({ id: 'gap', type: 'scenario_gap', weightPct: 8 }), NOW)
    expect(answered.total).toBeLessThan(never.total)
  })

  it('ranks an answered-but-open card below one nobody has seen', () => {
    expect(order([
      sig({ id: 'seen', type: 'no_target', weightPct: 8,
            judgment: { key: 'view_needs_update', at: days(30) } }),
      sig({ id: 'unseen', type: 'no_target', weightPct: 8 }),
    ])).toEqual(['unseen', 'seen'])
  })

  it('not-price-driven resolves the no-target card and only that card', () => {
    // The reader answered the question the no-target card asked. Re-asking it is
    // the definition of nagging.
    const noTarget = priorityFor(sig({
      id: 'nt', type: 'no_target', weightPct: 8,
      judgment: { key: 'not_price_driven', at: days(1) },
    }), NOW)
    expect(noTarget.suppressed).toBe(true)
    expect(noTarget.acknowledgment.resolved).toBe(true)

    // It says nothing about whether the price has left the ladder, so a scenario
    // gap on the same name is untouched — neither resolved nor quietened. The
    // first version of this leaked the 180-day quiet across signal types.
    const stillOpen = priorityFor(sig({
      id: 'sg', type: 'scenario_gap', weightPct: 8,
      judgment: { key: 'not_price_driven', at: days(1) },
    }), NOW)
    expect(stillOpen.acknowledgment.resolved).toBe(false)
    expect(stillOpen.suppressed).toBe(false)
    // And no standing penalty either: the reader never answered this question.
    expect(stillOpen.components.acknowledgment).toBe(0)
  })

  it('reads a pre-Phase-3 record through the legacy kind, without inventing a key', () => {
    // No semantic key exists on these. Guessing one would fabricate a specific
    // answer out of a generic state.
    const settled = acknowledgmentFor({ kind: 'settled', at: days(1) }, NOW)
    expect(settled.category).toBe('unknown')
    expect(settled.suppressed).toBe(true)
    // `flagged` is never suppressed — matching `isDisposedOf`.
    expect(acknowledgmentFor({ kind: 'flagged', at: days(1) }, NOW).suppressed).toBe(false)
  })

  it('treats an unclassified key as neutral rather than guessing', () => {
    const p = acknowledgmentFor({ key: 'something_new', at: days(1) }, NOW)
    expect(p.category).toBe('unknown')
    expect(p.suppressed).toBe(false)
    expect(p.penalty).toBe(0)
  })

  it('classifies every judgment key the mobile surface can write', () => {
    /**
     * The guard that keeps this honest. Adding an option to a card without
     * deciding what it means for resolution would otherwise degrade silently to
     * "unknown", and the card would quietly stop respecting the answer.
     *
     * The list is transcribed from `MobileDashboard`'s verdict options rather
     * than imported, because importing it would reach Supabase.
     */
    const written = [
      'active_thesis', 'add', 'agree', 'answered', 'attention_misplaced',
      'case_framework', 'change_accounted_for', 'defer', 'disagree',
      'discussion_warranted', 'done',
      // Triage. Not answers to the card's question — answers to "do I want this
      // on my screen" — but written to the same store and therefore read back
      // through the same policy. See lib/signals/feed-triage.
      'feed_dismissed', 'feed_snoozed',
      'hold_as_is', 'in_progress',
      'legacy_position', 'needs_review', 'needs_work', 'no_longer_covered',
      'not_mine', 'not_now', 'not_price_driven', 'owned_elsewhere', 'price_target',
      'priced_in', 'questions', 'reduce_exit', 'reunderwrite', 'revise_target',
      'scenario_cases_outdated', 'scenario_needs_review', 'scenario_thesis_intact',
      'scenario_thesis_weaker', 'size_wrong', 'sized_right', 'target_needs_review',
      'target_replace_with_cases', 'target_revise', 'target_still_valid',
      'thesis_relevant', 'trim', 'view_needs_update', 'view_stale',
    ]
    const missing = written.filter(k => !CLASSIFIED_JUDGMENT_KEYS.includes(k))
    expect(missing, `unclassified judgment keys: ${missing.join(', ')}`).toEqual([])
  })

  it('cannot keep a card alive that the data no longer produces', () => {
    /**
     * The underlying-fix case. Nothing here checks whether the reader edited
     * their cases, because nothing needs to: ranking only ever receives signals
     * that eligibility already produced from live data. A name whose cases were
     * updated simply is not in the list.
     */
    const eligibleAfterFix: PriorityInput[] = []
    expect(rankFeed(eligibleAfterFix, i => i, NOW)).toEqual([])
  })
})

describe('determinism', () => {
  const mixed = (): PriorityInput[] => ([
    sig({ id: 'a', type: 'scenario_gap', weightPct: 6, deviationPct: 18 }),
    sig({ id: 'b', type: 'scenario_gap', weightPct: 6, deviationPct: 18 }),
    sig({ id: 'c', type: 'no_target', weightPct: 6 }),
    sig({ id: 'd', type: 'news', weightPct: 6 }),
    sig({ id: 'e', type: 'research_stale', weightPct: 6 }),
  ])

  it('produces the same order every time from the same inputs', () => {
    const first = order(mixed())
    for (let i = 0; i < 20; i++) expect(order(mixed())).toEqual(first)
  })

  it('does not depend on the order the sources happened to resolve in', () => {
    // Two identical cards differing only by id must break their tie on the id,
    // not on which source returned first.
    const forward = order(mixed())
    const reversed = order([...mixed()].reverse())
    expect(reversed).toEqual(forward)
  })

  it('is a total order, so equal cards never swap', () => {
    const a = { item: null, input: sig({ id: 'a', type: 'news' }), priority: priorityFor(sig({ id: 'a', type: 'news' }), NOW) }
    const b = { item: null, input: sig({ id: 'b', type: 'news' }), priority: priorityFor(sig({ id: 'b', type: 'news' }), NOW) }
    expect(compareRanked(a, b)).toBeLessThan(0)
    expect(compareRanked(b, a)).toBeGreaterThan(0)
    expect(compareRanked(a, a)).toBe(0)
  })
})

describe('explainability', () => {
  it('accounts for the score component by component', () => {
    // For bug reports and the gallery. Never for the product surface — a reader
    // shown "Priority score: 82" argues with the number, not the investment.
    const p = priorityFor(sig({ id: 'x', type: 'scenario_gap', weightPct: 12, deviationPct: 20, severity: 'critical' }), NOW)
    const text = explainPriority(p)
    expect(text).toContain('decision_mismatch')
    expect(text).toContain('materiality')
    expect(text).toContain('deviation')
  })

  it('leaves a personalization slot that contributes nothing yet', () => {
    // Phase 6B telemetry exists and Phase 8 is forbidden from consuming it.
    const p = priorityFor(sig({ id: 'x', type: 'news' }), NOW)
    expect(p.components.personalization).toBe(0)
  })
})
