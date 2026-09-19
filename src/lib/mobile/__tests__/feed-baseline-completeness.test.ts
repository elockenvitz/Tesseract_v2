/**
 * The order the reader gets is the order the composer produced.
 *
 * ── The P1 this reproduces ────────────────────────────────────────────────
 *
 * QA on localhost, with the opening briefing cap live and every composer test
 * passing:
 *
 *   Trade Idea, Thought, Trade Idea, Pair Trade, Trade Idea, Pair Trade,
 *   Trade Idea, Trade Idea, Trade Idea, Overdue, Overdue, Overdue
 *
 * That sequence cannot come out of `composeFeed`. Attention sits a tier above
 * posts, so a single composed list leads with the Overdue tiles and the lane
 * cap spaces what follows. Nine posts and then three Overdue is what you get
 * when the posts are composed ALONE and the attention rows arrive afterwards.
 *
 * `MobileDashboard` commits the base order in an effect, and an effect declared
 * above a render's early return still runs behind the loader. So the first
 * paint remembered whichever sources had resolved — the posts — and
 * `reconcileToRemembered` then held that order and appended everything else
 * behind it for the life of the page. The composed order was recomputed
 * correctly on every render after that and discarded by the line that
 * reconciles it.
 *
 * ── What this file drives ─────────────────────────────────────────────────
 *
 * The real ranker, the real composer and the real continuity functions, in the
 * order the component calls them, across two loads of the same visit. No source
 * assertions: the failure is a sequence, so the test is a sequence.
 */

import { describe, expect, it } from 'vitest'

import { rankFeed, type PriorityInput } from '../../signals/feed-priority'
import { composeFeed } from '../../signals/feed-compose'
import { readerQuestionFor } from '../../signals/reader-question'
import { categoryForType } from '../../signals/content-registry'
import { briefClassFor } from '../../signals/brief-class'
import { reconcileToRemembered, rememberBaseOrder } from '../feed-continuity'
import type { SignalType } from '../../signals/contract'

const NOW = Date.parse('2026-09-09T12:00:00.000Z')
const DAY = 86_400_000

interface Cand {
  id: string
  family: string
  type: SignalType
  severity: PriorityInput['severity']
  days: number
  overdue: number | null
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
  ...f(i),
}))

/** What resolves first on a cold load: the posts. */
const POSTS: Cand[] = [
  ...rows(6, 'trade_idea', 'trade_idea'),
  ...rows(3, 'thought', 'thought'),
  ...rows(3, 'pair_trade', 'pair_trade'),
]

/** What lands a moment later, and outranks all of it. */
const ATTENTION: Cand[] = [
  ...rows(4, 'project_overdue', 'project_overdue', i => ({
    severity: i < 2 ? 'critical' : 'attention', days: i + 2, overdue: 9 + i,
  })),
  ...rows(3, 'awaiting_review', 'awaiting_review', i => ({
    severity: i < 1 ? 'critical' : 'attention', days: i,
  })),
  ...rows(2, 'coverage_gap', 'coverage_gap', () => ({ severity: 'attention', days: 20 })),
]

const toInput = (c: Cand): PriorityInput => ({
  id: c.id,
  type: c.type,
  severity: c.severity,
  occurredAt: new Date(NOW - c.days * DAY).toISOString(),
  weightPct: null,
  held: false,
  deviationPct: null,
  overdueDays: c.overdue,
  coverage: 'unknown',
})

/** The dashboard's ordering pass, exactly as it calls it. */
function composedOrder(pool: Cand[]): Cand[] {
  return composeFeed(rankFeed(pool, toInput, NOW), {
    familyOf: (c: Cand) => c.family,
    subjectOf: () => null,
    questionOf: (c: Cand) => readerQuestionFor(c.type),
    categoryOf: (c: Cand) => categoryForType(c.type),
    briefOf: (c: Cand) => briefClassFor(c.type),
    scope: 'mixed',
  }).order.map(r => r.item)
}

/**
 * One render of the feed, as the component performs it.
 *
 * Compose, reconcile against whatever is remembered, then commit — with the
 * commit gated on whether the pool is complete, which is the fix.
 */
function render(
  pool: Cand[],
  remembered: string[] | null,
  opts: { composing: boolean; gateCommit: boolean },
): { shown: Cand[]; remembered: string[] | null } {
  const composed = composedOrder(pool)
  const paired = composed.map(item => ({ key: item.id, item }))
  const shown = reconcileToRemembered(paired, remembered).map(p => p.item)

  const mayCommit = opts.gateCommit ? !opts.composing : true
  const next = mayCommit
    ? rememberBaseOrder(remembered, shown.map(c => c.id))
    : remembered

  return { shown, remembered: next }
}

const families = (xs: Cand[], n = 12) => xs.slice(0, n).map(c => c.family)
const lanes = (xs: Cand[], n = 10) => xs.slice(0, n).map(c => String(briefClassFor(c.type)))
const worstLane = (xs: Cand[]) => {
  const m = new Map<string, number>()
  for (const l of lanes(xs)) m.set(l, (m.get(l) ?? 0) + 1)
  return Math.max(0, ...m.values())
}

// ─────────────────────────────────────────────────────────────────────────────
// The reproduction
// ─────────────────────────────────────────────────────────────────────────────

describe('the shipping order, across a two-stage load', () => {
  /**
   * The composer is not the problem, and this is the control.
   *
   * Given the complete pool it produces exactly what the briefing rule
   * promises: attention leads because it outranks posts, and no lane takes more
   * than its share of the opening.
   */
  it('composes the complete pool correctly', () => {
    const composed = composedOrder([...POSTS, ...ATTENTION])
    expect(briefClassFor(composed[0].type)).toBe('work')
    /**
     * Five, not three, and the reason is the protection from 8e0c321: three of
     * the ranked opening are critical work and are owed their seats. What
     * matters here is that it is nowhere near ten.
     */
    expect(worstLane(composed)).toBeLessThanOrEqual(5)
    expect(new Set(lanes(composed)).size).toBeGreaterThanOrEqual(2)
  })

  /**
   * The bug, reproduced end to end.
   *
   * Commit on the first render, while the attention query is still in flight,
   * and the reader gets the posts in a block with the attention rows appended
   * behind them — whatever the composer says on every render afterwards.
   */
  it('reproduces the reported sequence when the order is committed early', () => {
    const first = render(POSTS, null, { composing: true, gateCommit: false })
    const second = render([...POSTS, ...ATTENTION], first.remembered, {
      composing: false, gateCommit: false,
    })

    const shown = families(second.shown)
    const isPost = (f: string) => ['trade_idea', 'thought', 'pair_trade'].includes(f)
    // Nine posts, then the attention rows behind them — the reported sequence.
    expect(shown.slice(0, POSTS.length).every(isPost)).toBe(true)
    expect(shown.slice(POSTS.length).every(f => !isPost(f))).toBe(true)
    // And the first screen is one lane, which is what the cap exists to stop.
    expect(worstLane(second.shown)).toBe(10)
  })

  /**
   * The fix: nothing is remembered from a feed that is still arriving.
   *
   * While the sources are in flight the reader is looking at the loader, so
   * there is no position to protect and nothing on screen to keep still.
   */
  it('shows the composed order when the commit waits for the pool', () => {
    const first = render(POSTS, null, { composing: true, gateCommit: true })
    expect(first.remembered).toBeNull()

    const second = render([...POSTS, ...ATTENTION], first.remembered, {
      composing: false, gateCommit: true,
    })

    expect(second.shown.map(c => c.id))
      .toEqual(composedOrder([...POSTS, ...ATTENTION]).map(c => c.id))
    expect(briefClassFor(second.shown[0].type)).toBe('work')
    expect(worstLane(second.shown)).toBeLessThanOrEqual(5)
  })

  /**
   * And the contract the gate must not break.
   *
   * Once the pool IS complete the order is remembered, and a later arrival —
   * a refetch, a new finding — still appends rather than reshuffling what the
   * reader is looking at. That is the whole point of the continuity store and
   * the fix must not cost it.
   */
  it('still appends a late arrival once the reader has a feed', () => {
    const settled = render([...POSTS, ...ATTENTION], null, {
      composing: false, gateCommit: true,
    })
    expect(settled.remembered).not.toBeNull()

    const late = rows(1, 'news', 'news')
    const next = render([...POSTS, ...ATTENTION, ...late], settled.remembered, {
      composing: false, gateCommit: true,
    })

    expect(next.shown.slice(0, settled.shown.length).map(c => c.id))
      .toEqual(settled.shown.map(c => c.id))
    expect(next.shown[next.shown.length - 1].id).toBe('news-0')
  })

  it('loses no candidate on either path', () => {
    const first = render(POSTS, null, { composing: true, gateCommit: true })
    const second = render([...POSTS, ...ATTENTION], first.remembered, {
      composing: false, gateCommit: true,
    })
    expect(second.shown).toHaveLength(POSTS.length + ATTENTION.length)
    expect(new Set(second.shown.map(c => c.id)).size).toBe(POSTS.length + ATTENTION.length)
  })

  it('is deterministic across renders of the same state', () => {
    const a = render([...POSTS, ...ATTENTION], null, { composing: false, gateCommit: true })
    const b = render([...POSTS, ...ATTENTION], null, { composing: false, gateCommit: true })
    expect(a.shown.map(c => c.id)).toEqual(b.shown.map(c => c.id))
  })
})
