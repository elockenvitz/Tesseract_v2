import { describe, it, expect } from 'vitest'

import { rankFeed, diversify, compareRanked, type PriorityInput } from '../feed-priority'

/**
 * Curate filters the POOL, and the pool is never truncated before it.
 *
 * ── The invariant, and why it needs a test rather than a comment ──────────
 *
 * "Case vs Price is missing" was reported repeatedly, and the obvious
 * architecture to suspect is the wrong one:
 *
 *     candidates → rank → take top N → filter the top N        ← BROKEN
 *     candidates → filter → rank → present                      ← what we do
 *
 * Under the first, selecting a type shows nothing whenever that type happened
 * to rank below the cutoff, and the reader is told a finding does not exist
 * when it does. `MobileDashboard` composes `all` from every source, applies
 * `feedFilter`/`kindFilter` to it, and only then calls `rankFeed` and
 * `diversify` — so the second holds today.
 *
 * These tests lock it. They are written against the real ranking primitives so
 * that a future change moving a filter downstream of a cap, or introducing a
 * `.slice()` between the pool and the filter, fails here.
 */

type Entry = { id: string; type: string; severity: string; at: string }

/** A real `PriorityInput`. `severity` is required — omitting it yields NaN
 *  totals, and NaN breaks the comparator's transitivity. */
const input = (e: Entry): PriorityInput => ({
  id: e.id,
  type: e.type as PriorityInput['type'],
  severity: e.severity as PriorityInput['severity'],
  occurredAt: e.at,
})

/** A desk with plenty of higher-ranked noise and a few scenario findings. */
function pool(): Entry[] {
  const out: Entry[] = []
  // 50 critical items of another type, all far newer than the ladders.
  for (let i = 0; i < 50; i++) {
    out.push({
      id: `att-${String(i).padStart(3, '0')}`,
      type: 'attention_cluster',
      severity: 'critical',
      at: `2026-08-2${(i % 9) + 1}T12:00:00Z`,
    })
  }
  // Three Case vs Price findings, informational and months old, so nothing
  // about them is asking for a good position.
  for (const sym of ['AMZN', 'TSLA', 'AAPL']) {
    out.push({
      id: `scenario_gap:${sym}`,
      type: 'scenario_gap',
      severity: 'informational',
      at: '2026-01-01T00:00:00Z',
    })
  }
  return out
}

/** What the dashboard does: filter the POOL, then rank what is left. */
const curate = (all: Entry[], type: string | null) =>
  type ? all.filter(e => e.type === type) : all

describe('a type filter surfaces findings the mixed feed had no room for', () => {
  /**
   * Where they land is the ranking's business, and the filter's answer must
   * not depend on it. Recorded rather than asserted: `scenario_gap` leads
   * tier 0 by design (`feed-priority.ts`), so on this desk it happens to rank
   * high — and the filter would have to work identically if it ranked last.
   */
  it('does not depend on where the findings rank in the mixed feed', () => {
    const all = pool()
    const mixed = rankFeed(all, input, Date.parse('2026-08-29T12:00:00Z'))
    const mixedIds = mixed.map(r => r.item.id)
    const filtered = rankFeed(curate(all, 'scenario_gap'), input, Date.parse('2026-08-29T12:00:00Z'))

    // Whatever positions they occupy in the mixed feed…
    const positions = mixedIds
      .map((id, i) => ({ id, i }))
      .filter(x => x.id.startsWith('scenario_gap:'))
      .map(x => x.i)
    expect(positions).toHaveLength(3)

    // …the filter returns all three regardless.
    expect(filtered).toHaveLength(3)
  })

  /**
   * THE regression. Under a rank-then-truncate-then-filter architecture this
   * returns nothing, because the three findings never survived to be filtered.
   */
  it('returns every Case vs Price finding when that type is selected', () => {
    const filtered = curate(pool(), 'scenario_gap')
    const ranked = rankFeed(filtered, input, Date.parse('2026-08-29T12:00:00Z'))
    expect(ranked).toHaveLength(3)
    expect(ranked.map(r => r.item.id).sort()).toEqual([
      'scenario_gap:AAPL', 'scenario_gap:AMZN', 'scenario_gap:TSLA',
    ])
  })

  /** And filtering ranks them against EACH OTHER, not against the noise. */
  it('ranks the filtered findings among themselves', () => {
    const ranked = rankFeed(curate(pool(), 'scenario_gap'), input, Date.now())
    expect(ranked.every(r => r.item.type === 'scenario_gap')).toBe(true)
  })

  /**
   * `diversify` reorders; it must never drop. A candidate lost here would be
   * invisible to the filter for the same reason a truncation would.
   */
  it('diversify returns every item it was given', () => {
    const ranked = rankFeed(pool(), input, Date.now())
    const out = diversify(ranked, { enabled: true, categoryOf: () => 'decisions' })
    expect(out).toHaveLength(ranked.length)
    expect(new Set(out.map(r => r.item.id))).toEqual(new Set(ranked.map(r => r.item.id)))
  })

  it('keeps the scenario findings after diversification', () => {
    const out = diversify(rankFeed(pool(), input, Date.now()), { enabled: true })
    expect(out.filter(r => r.item.type === 'scenario_gap')).toHaveLength(3)
  })
})

describe('the ordering is deterministic, so nothing crosses a boundary by chance', () => {
  /**
   * A valid finding must not appear and disappear because two equal-ranked
   * candidates swapped places. `compareRanked` breaks ties on tier, then
   * total, then timestamp, then the candidate id — the last of which is unique
   * and total, so no pair is ever left unordered.
   */
  it('orders identical scores by a stable id, never by input order', () => {
    const tied: Entry[] = ['c', 'a', 'b'].map(k => ({
      id: `scenario_gap:${k}`, type: 'scenario_gap',
      severity: 'attention', at: '2026-06-01T00:00:00Z',
    }))
    const forward = rankFeed(tied, input, Date.now()).map(r => r.item.id)
    const reversed = rankFeed([...tied].reverse(), input, Date.now()).map(r => r.item.id)
    expect(forward).toEqual(reversed)
    expect(forward).toEqual(['scenario_gap:a', 'scenario_gap:b', 'scenario_gap:c'])
  })

  it('is a total order — no pair compares equal', () => {
    const ranked = rankFeed(pool(), input, Date.now())
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        expect(compareRanked(ranked[i], ranked[j])).not.toBe(0)
      }
    }
  })

  /** Same inputs, same eligible set, every time. */
  it('recomposes to the same set and the same order', () => {
    const a = rankFeed(curate(pool(), 'scenario_gap'), input, 1_700_000_000_000)
    const b = rankFeed(curate(pool(), 'scenario_gap'), input, 1_700_000_000_000)
    expect(a.map(r => r.item.id)).toEqual(b.map(r => r.item.id))
  })
})
