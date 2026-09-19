/**
 * The feed leads with what matters, and not with the same thing every morning.
 *
 * ── The requirement, and why it needs a rule at all ───────────────────────
 *
 * "Importance should generally lead, but I don't want users opening the app
 * every day and seeing the same thing."
 *
 * Both halves are real and they pull against each other. The first card is the
 * one position in the feed where no repetition rule can apply — nothing
 * precedes it, so nothing repeats — which is exactly why it was identical every
 * morning while the rest of the feed varied.
 *
 * The rule resolves it by spending only what the priority model says is
 * worthless: `LEAD_BAND` is `WEIGHTS.ownership`, the smallest weight in the
 * model and so the finest distinction it claims to draw. Two cards closer
 * together than that are equally important by the model's own account.
 *
 * These tests pin the four properties that make that safe: it is off unless
 * asked for, it never reaches outside the band or across a tier, it never
 * blocks, and it is deterministic.
 */

import { describe, expect, it } from 'vitest'

import { rankFeed, type PriorityInput } from '../feed-priority'
import { composeFeed } from '../feed-compose'
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
  weight: number | null
  dev: number | null
}

const rows = (
  n: number, family: string, type: string, f: (i: number) => Partial<Cand> = () => ({}),
): Cand[] => Array.from({ length: n }, (_, i) => ({
  id: `${family}-${i}`, family, type: type as SignalType,
  severity: 'informational' as const, days: i, weight: null, dev: null, ...f(i),
}))

/**
 * Three framework breaks close together at the top, then the rest of a desk.
 *
 * The three leaders differ only in deviation, which puts them inside a few
 * hundredths of each other — the situation the band exists for, and the one a
 * real desk produces constantly because several positions break at once.
 */
const POOL: Cand[] = [
  ...rows(3, 'scenario_gap', 'scenario_gap', i => ({
    severity: 'critical' as const, weight: 8, dev: 34 - i, days: i,
  })),
  ...rows(4, 'project_overdue', 'project_overdue', () => ({
    severity: 'attention' as const, days: 3,
  })),
  ...rows(6, 'trade_idea', 'trade_idea'),
  ...rows(5, 'news', 'news'),
  ...rows(4, 'thought', 'thought', i => ({ days: i + 1 })),
]

const toInput = (c: Cand): PriorityInput => ({
  id: c.id,
  type: c.type,
  severity: c.severity,
  occurredAt: new Date(NOW - c.days * DAY).toISOString(),
  weightPct: c.weight,
  held: c.weight != null,
  deviationPct: c.dev,
  coverage: 'unknown',
}) as PriorityInput

const compose = (led?: string[]) =>
  composeFeed(rankFeed(POOL, toInput, NOW), {
    familyOf: (c: Cand) => c.family,
    subjectOf: () => null,
    questionOf: (c: Cand) => readerQuestionFor(c.type),
    categoryOf: (c: Cand) => categoryForType(c.type),
    briefOf: (c: Cand) => briefClassFor(c.type),
    scope: 'mixed',
    trace: true,
    ...(led ? { ledRecently: new Set(led) } : {}),
  })

const ranked = () => rankFeed(POOL, toInput, NOW)
const leaderOf = (led?: string[]) => compose(led).order[0].input.id

describe('the band is off unless the caller asks for it', () => {
  /**
   * The invariant every other test in this directory depends on. A caller that
   * passes no set — which is every caller but the dashboard, and every existing
   * test — gets the ranking's own first card, bit for bit.
   */
  it('leads with the top-ranked card when nothing is remembered', () => {
    expect(leaderOf()).toBe(ranked()[0].input.id)
    expect(leaderOf([])).toBe(ranked()[0].input.id)
    expect(compose().trace[0].reason).toBe('head')
  })
})

describe('a card that led yesterday does not lead today', () => {
  it('steps down to the next card in the band', () => {
    const first = ranked()[0].input.id
    const second = leaderOf([first])
    expect(second).not.toBe(first)
    expect(compose([first]).trace[0].reason).toBe('fresh-lead')
  })

  it('walks further down as more of the band is used up', () => {
    const a = ranked()[0].input.id
    const b = leaderOf([a])
    const c = leaderOf([a, b])
    expect(new Set([a, b, c]).size).toBe(3)
  })

  /** And the card it stepped over is still in the feed, near the top. */
  it('does not drop the card it stepped over', () => {
    const first = ranked()[0].input.id
    const order = compose([first]).order.map(r => r.input.id)
    expect(order).toContain(first)
    expect(order.indexOf(first)).toBeLessThanOrEqual(3)
  })
})

describe('what freshness may never do', () => {
  /**
   * Never reach outside the band. The overdue and post families sit well
   * below the framework breaks, so once all three breaks are used up the band
   * is empty and the ranking wins again.
   */
  it('leads with the top-ranked card when the whole band was led with', () => {
    const band = ranked().slice(0, 3).map(r => r.input.id)
    expect(leaderOf(band)).toBe(ranked()[0].input.id)
    expect(compose(band).trace[0].reason).toBe('head')
  })

  /** Never cross a tier. A post may not open the feed to be fresh. */
  it('never leads with a lower tier than the ranking would', () => {
    const everything = POOL.map(c => c.id)
    const withAll = compose(everything).order[0]
    expect(withAll.priority.tier).toBe(ranked()[0].priority.tier)
  })

  /** Never spend more than the band. */
  it('gives up no more importance than the band allows', () => {
    const first = ranked()[0].input.id
    const chosen = compose([first]).order[0]
    expect(ranked()[0].priority.total - chosen.priority.total)
      .toBeLessThanOrEqual(0.06)
  })

  /**
   * Never reach past the first card. Freshness decides one slot, so the rest
   * of the feed is composed exactly as it would have been.
   */
  it('changes only the opening, not the composition below it', () => {
    const first = ranked()[0].input.id
    const plain = compose().order.map(r => r.input.id)
    const fresh = compose([first]).order.map(r => r.input.id)
    // Same membership, and the two differ only by moving one card up.
    expect(new Set(fresh)).toEqual(new Set(plain))
    expect(fresh.filter(id => id !== fresh[0]))
      .toEqual(plain.filter(id => id !== fresh[0]))
  })
})

describe('the pass is still pure', () => {
  it('is deterministic for one set', () => {
    const led = [ranked()[0].input.id]
    expect(compose(led).order.map(r => r.input.id))
      .toEqual(compose(led).order.map(r => r.input.id))
  })

  it('loses nothing', () => {
    const led = [ranked()[0].input.id]
    expect(compose(led).order).toHaveLength(POOL.length)
  })

  /** An id nobody in the pool has is simply ignored. */
  it('ignores a remembered card that is no longer in the feed', () => {
    expect(leaderOf(['gone-forever'])).toBe(ranked()[0].input.id)
  })
})
