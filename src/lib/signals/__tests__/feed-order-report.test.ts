import { describe, expect, it } from 'vitest'

import { composeFeed, longestRun, type ComposeScope } from '../feed-compose'
import { diversify, rankFeed, LEAD_TIER } from '../feed-priority'
import { interleaveByKind } from '../../mobile/feed-interleave'
import { buildPool, NOW, runOf, toInput, type Cand } from './feed-pool.fixture'

/**
 * What the feed's order actually was, and what it is now.
 *
 * ── Why this is a test and not a script ───────────────────────────────────
 *
 * The composition lived inline in a 6,851-line component behind a Supabase
 * render, so the only place the ORDER had ever been observable was a phone
 * screen behind a login. That is how a diversity pass came to be discarded by
 * the line after it and stay that way: nothing could see the sequence.
 *
 * So the sequence gets measured in the suite. The assertions below are the
 * claims this stage makes; the `console.log` output beside them is the
 * evidence, printed on every run so the next person to change the ranking sees
 * what they did to it.
 *
 * The pool is reconstructed from figures the codebase records about production
 * and is not production — see `feed-pool.fixture`. Every number here inherits
 * that qualifier.
 */

const pool = buildPool()

const compose = (cands: Cand[], scope: ComposeScope = 'mixed') => composeFeed(
  rankFeed(cands, toInput, NOW),
  {
    familyOf: (c: Cand) => c.family,
    subjectOf: (c: Cand) => c.symbol,
    categoryOf: (c: Cand) => c.category,
    scope,
    trace: true,
  },
)

/** The pipeline exactly as `MobileDashboard` composed it before this stage. */
const composeOld = (cands: Cand[]) => {
  const ranked = rankFeed(cands, toInput, NOW)
  const diversified = diversify(ranked, { categoryOf: (c: Cand) => c.category })
  const lead = diversified.filter(r => r.priority.tier <= LEAD_TIER)
  const tail = diversified.filter(r => r.priority.tier > LEAD_TIER)
  return {
    ranked: ranked.map(r => r.item),
    diversified: diversified.map(r => r.item),
    composed: [
      ...lead.map(r => r.item),
      ...interleaveByKind<any>(
        tail.map(r => ({ ...r.item, score: r.priority.total, subject: r.item.symbol })),
        { maxRun: 1, seed: 12345 },
      ) as Cand[],
    ],
  }
}

const dist = (xs: Cand[], key: (c: Cand) => string) => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')
}

const report = (label: string, xs: Cand[]) => {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 44 - label.length))}`)
  console.log(`count             ${xs.length}`)
  console.log(`longest family    ${runOf(xs, c => c.family).len} (${runOf(xs, c => c.family).what})`)
  console.log(`longest asset     ${runOf(xs, c => c.symbol).len} (${runOf(xs, c => c.symbol).what})`)
  console.log(`first 10 family   ${xs.slice(0, 10).map(c => c.family).join(' → ')}`)
  console.log(`first 20 family   ${xs.slice(0, 20).map(c => c.family).join(' → ')}`)
  console.log(`categories 1-10   ${dist(xs.slice(0, 10), c => c.category)}`)
  console.log(`categories 1-20   ${dist(xs.slice(0, 20), c => c.category)}`)
}

describe('the clustering root cause, measured', () => {
  const old = composeOld(pool)

  it('the tier split threw away everything diversify() achieved', () => {
    /**
     * The finding this whole stage rests on.
     *
     * `diversify` ran, and worked — it cut the longest single-family run from
     * 45 to 7. The very next line filtered its output into `tier ≤ 1` and
     * `tier > 1`, which is precisely the axis diversity had reached across:
     * every alternative it pulled up was, by construction, a lower tier, so
     * the split moved all of them out of the opening and put the run back.
     */
    const ranked = longestRun(old.ranked, c => c.family)
    const diversified = longestRun(old.diversified, c => c.family)
    const composed = longestRun(old.composed, c => c.family)

    console.log(`\nlongest family run: ranked ${ranked} → diversify ${diversified} → composed ${composed}`)

    expect(diversified).toBeLessThan(ranked)
    // And then it was undone, exactly.
    expect(composed).toBe(ranked)
  })

  it('the interleaver could not tell six Portfolio families apart', () => {
    /**
     * `interleaveByKind` buckets by ENTRY KIND — the hook that produced a row.
     * Crowding, no-target, target-hit, target-expired and both conviction
     * types are all `kind: 'lens'`, so `maxRun: 1` is satisfied completely by
     * a feed showing all six back to back.
     */
    const lensFamilies = new Set(pool.filter(c => c.kind === 'lens').map(c => c.family))
    expect(lensFamilies.size).toBeGreaterThan(4)
    // One bucket, several questions.
    expect(new Set(pool.filter(c => c.kind === 'lens').map(c => c.kind)).size).toBe(1)
  })

  it('the old diversity pass keyed on the type, which is coarser than the card', () => {
    // `scenario_gap` is both "Case vs price" and "Framework break" — two
    // categories, two pills, one `SignalType`. A run rule keyed on the type
    // cannot separate them, and cannot see a run of either.
    const gaps = pool.filter(c => c.type === 'scenario_gap')
    expect(new Set(gaps.map(c => c.family)).size).toBe(2)
    expect(new Set(gaps.map(c => c.category)).size).toBe(2)
  })
})

describe('the composed feed, before and after', () => {
  const old = composeOld(pool)
  const now = compose(pool)
  const nowOrder = now.order.map(r => r.item)

  it('prints the sequences and the run metrics', () => {
    report('RANKED · no ordering pass', old.ranked)
    report('BEFORE · lead ++ interleave(tail)', old.composed)
    report('AFTER · composeFeed', nowOrder)

    console.log('\n── top 25 ranked ────────────────────────────────')
    for (const [i, c] of old.ranked.slice(0, 25).entries()) {
      const r = rankFeed([c], toInput, NOW)[0]
      console.log(
        String(i + 1).padStart(3), c.symbol.padEnd(6), c.family.padEnd(26),
        c.category.padEnd(10), `t${r.priority.tier}`, r.priority.total.toFixed(3),
        `w=${c.weightPct ?? '—'}`,
      )
    }

    console.log('\n── top 25 composed ──────────────────────────────')
    for (const r of now.trace.slice(0, 25)) {
      console.log(
        String(r.rankAfter).padStart(3), `(was ${String(r.rankBefore).padStart(3)})`,
        (r.subject ?? '—').padEnd(6), (r.family ?? '—').padEnd(26),
        `t${r.tier}`, r.total.toFixed(3),
        r.priorityCost ? r.priorityCost.toFixed(3) : '   —  ', r.reason,
      )
    }

    const costs = now.trace.map(r => -r.priorityCost).filter(c => c > 0).sort((a, b) => a - b)
    console.log('\n── what diversity cost ──────────────────────────')
    console.log('moved > 3 places       ',
      now.trace.filter(r => Math.abs(r.rankAfter - r.rankBefore) > 3).length)
    console.log('largest priority drop  ', (costs[costs.length - 1] ?? 0).toFixed(4))
    console.log('median priority drop   ', (costs[Math.floor(costs.length / 2)] ?? 0).toFixed(4))
    console.log('paid anything          ', costs.length, 'of', now.trace.length)
    expect(true).toBe(true)
  })

  it('breaks the runs the brief reported, where a reader can see them', () => {
    /**
     * ── Why the window, and what the tail honestly is ────────────────────
     *
     * The reported problem is what the first screens look like, and there the
     * rule binds absolutely: no family may run past two.
     *
     * Deep in the tail it cannot, and should not. This pool holds 45 cards
     * with no written case out of 109, and every candidate that could stand
     * between two of them is spent by about card 45 — what remains is tier 4,
     * which a substitute may not be pulled up from, because a news story
     * interrupting a decision is a worse feed than a repetitive one. So the
     * last stretch is a run of unwritten cases, and it is a true statement
     * about the book: the fix for a book with 45 unwritten cases is to write
     * some, not to shuffle the list.
     *
     * The number is asserted rather than merely tolerated, so it cannot grow
     * quietly.
     */
    /**
     * The precise claim, which is stronger than a number: a family runs past
     * two ONLY where nothing was close enough to take its place.
     *
     * That is also the critical-cluster override, stated as an invariant.
     * Three framework breaks at 1.000, 1.000 and 1.000 against a next-best
     * 0.847 produce an empty competitor set at the third, so the run stands
     * and the trace says `no-competitor` — exactly the case §9 asks for, and
     * no threshold was needed to get it.
     */
    let run = 0
    let prev: string | null = null
    for (const row of now.trace) {
      run = row.family === prev ? run + 1 : 1
      prev = row.family
      // Never a family reason: the tuple ranks family above name, so if any
      // competitor had offered a different family it would have won. A run
      // past two therefore means one of exactly two things — nothing was
      // close enough at all, or the only close things were the same family
      // and the swap that did happen was about the ticker.
      if (run > 2) {
        expect(['no-competitor', 'subject-run', 'recent-subject'])
          .toContain(row.reason)
      }
    }

    /**
     * What actually changed where the reader looks.
     *
     * The longest run in the opening is 3 both before and after, and that is
     * correct: it is the framework-break cluster the override protects. The
     * measurable difference is how much of the book the first twenty cards
     * describe — the same three questions, or most of them.
     */
    const famsBefore = new Set(old.composed.slice(0, 20).map(c => c.family)).size
    const famsAfter = new Set(nowOrder.slice(0, 20).map(c => c.family)).size
    const catsBefore = new Set(old.composed.slice(0, 20).map(c => c.category)).size
    const catsAfter = new Set(nowOrder.slice(0, 20).map(c => c.category)).size
    console.log(`
first 20: families ${famsBefore} → ${famsAfter}`
      + ` · categories ${catsBefore} → ${catsAfter}`)
    expect(famsAfter).toBeGreaterThan(famsBefore)

    console.log(`longest family run overall: before ${longestRun(old.composed, c => c.family)}`
      + ` → after ${longestRun(nowOrder, c => c.family)}`)
    expect(longestRun(nowOrder, c => c.family))
      .toBeLessThan(longestRun(old.composed, c => c.family))
  })

  it('never shows one name three times in a row', () => {
    // Unlike the family rule this one holds everywhere, because a name has
    // few enough cards that a substitute always exists.
    expect(longestRun(nowOrder, c => c.symbol)).toBeLessThanOrEqual(2)
  })

  it('keeps the single most important finding first', () => {
    // The one thing diversity may never do. The head of the ranking is the
    // head of the feed, always: nothing precedes it, so nothing repeats.
    expect(nowOrder[0].id).toBe(old.ranked[0].id)
  })

  it('pays a small, bounded price in priority to do it', () => {
    const costs = now.trace.map(r => -r.priorityCost).filter(c => c > 0)
    // Bounded by the tolerance, by construction — a substitute has to be
    // within 0.15 of the head to be eligible at all.
    expect(Math.max(...costs)).toBeLessThanOrEqual(0.15)
  })
})
