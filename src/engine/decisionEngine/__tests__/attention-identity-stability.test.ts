/**
 * An attention item's identity must name the CONDITION, not its age.
 *
 * ── Why this gate exists ─────────────────────────────────────────────────
 *
 * `ratingNoFollowup` built its id as `i1-rating-${changeId}-${daysSince}`.
 * The condition it describes — a rating moved and nobody raised an idea —
 * does not change at midnight, but the id did. Anything keyed on that id
 * therefore stopped matching the moment the day rolled over.
 *
 * Nothing in the product suppressed an ACTION item by id at the time it was
 * found, so no live dismissal was being lost. That is a reason the defect
 * was invisible, not a reason it was harmless: `attention_user_state` is
 * keyed on exactly this kind of string (`attention_id text`, see
 * `src/lib/attention-state/keys.ts`), and the three RPCs that write it —
 * `snooze_attention`, `dismiss_attention`, `acknowledge_attention` — all
 * take that string as their only subject. The first durable per-user state
 * over these items would have silently forgotten everything overnight.
 *
 * ── Why it is written as a sweep rather than one assertion ───────────────
 *
 * A test pinned to `i1-rating-` would pass forever while the next evaluator
 * reintroduced a clock in its own id. This runs the whole engine twice, one
 * day apart, over data placed mid-window so that every item qualifies in
 * both runs, and requires the id sets to be identical.
 *
 * Non-vacuity: restore the `-${daysSince}` suffix in
 * `evaluators/ratingNoFollowup.ts` and `identifies the condition, not its
 * age` fails with two differing `i1-rating-*` ids. Proven by doing exactly
 * that before this file was committed.
 */

import { describe, it, expect } from 'vitest'
import { runGlobalDecisionEngine, type EngineArgs } from '../globalDecisionEngine'
import { evaluateRatingNoFollowup } from '../evaluators/ratingNoFollowup'

const DAY = 86400000

/** Mid-February, and one day later. Both inside every evaluator's window. */
const T0 = new Date('2026-02-15T12:00:00Z')
const T1 = new Date(T0.getTime() + DAY)

/**
 * Timestamps are absolute, not relative to `now`.
 *
 * This is the whole point: the input is one fixed history and the question
 * is whether reading it on two consecutive days yields the same identities.
 * Anchoring the fixture to `now` would move the data along with the clock
 * and the test would pass whatever the ids did.
 */
function at(daysBeforeT0: number): string {
  return new Date(T0.getTime() - daysBeforeT0 * DAY).toISOString()
}

function args(now: Date): EngineArgs {
  return {
    userId: 'u1',
    role: 'analyst',
    coverage: { assetIds: ['a1', 'a2'], portfolioIds: ['p1'] },
    data: {
      tradeIdeas: [
        // A1 proposal awaiting, A2 execution not confirmed, A3 unsimulated.
        { id: 't1', asset_id: 'a1', portfolio_id: 'p1', stage: 'deciding',
          action: 'buy', decision_outcome: null, outcome: null,
          visibility_tier: 'active', created_at: at(6), updated_at: at(6),
          asset_symbol: 'AAPL', portfolio_name: 'Growth' },
        { id: 't2', asset_id: 'a2', portfolio_id: 'p1', stage: 'active',
          action: 'buy', decision_outcome: null, outcome: null,
          visibility_tier: 'active', created_at: at(6), updated_at: at(6),
          asset_symbol: 'MSFT', portfolio_name: 'Growth' },
      ],
      proposals: [],
      ratingChanges: [
        // Day 4 of a 14-day lookback at T0, day 5 at T1. The item qualifies
        // in both runs and `daysSince` differs between them — which is what
        // made the old id drift.
        { id: 'rc1', rating_id: 'r-rc1', asset_id: 'a1', asset_symbol: 'AAPL',
          field_name: 'rating_value', old_value: 'BUY', new_value: 'SELL',
          changed_at: at(4), changed_by: 'u2' },
      ],
      thesisUpdates: [
        { asset_id: 'a1', section: 'thesis', updated_at: at(200),
          created_by: 'u1', asset_symbol: 'AAPL' },
      ],
      projects: [
        { id: 'pr1', name: 'Alpha Research', status: 'in_progress', priority: 'high',
          deliverables: [
            { id: 'd1', title: 'Weekly Report', due_date: at(6), completed: false,
              status: 'pending', created_at: at(20) },
          ] },
      ],
    },
    now,
  }
}

function allIds(now: Date): string[] {
  const r = runGlobalDecisionEngine(args(now))
  return [...r.actionItems, ...r.intelItems].map(i => i.id).sort()
}

describe('attention identity stability', () => {
  it('produces items on both days, so the comparison has something to compare', () => {
    // Guards the sweep below against passing by returning two empty sets.
    expect(allIds(T0).length).toBeGreaterThan(2)
    expect(allIds(T1).length).toBeGreaterThan(2)
  })

  it('identifies the condition, not its age', () => {
    expect(allIds(T1)).toEqual(allIds(T0))
  })

  it('keeps no evaluator id containing a bare day count', () => {
    // A second, independent shape of the same rule: a trailing `-<n>` or
    // `-<n>d` segment is how elapsed time has leaked into an id before.
    for (const id of allIds(T0)) {
      expect(id).not.toMatch(/-\d+d?$/)
    }
  })

  it('still mints distinct identities for two rating changes on one asset', () => {
    // Dropping the day count must not collapse distinct conditions. The
    // cheap wrong fix — keying on the asset — would fail this.
    //
    // Asserted against the evaluator, which is where identity is minted.
    // The engine's `postprocess.dedupKey` deliberately keeps only the
    // highest-severity item per (signal type, category, asset), so running
    // this through `runGlobalDecisionEngine` would return one item and prove
    // nothing about the ids. See the note below.
    const changes = [
      { id: 'rc1', rating_id: 'r-rc1', asset_id: 'a1', asset_symbol: 'AAPL',
        old_value: 'BUY', new_value: 'SELL', changed_at: at(4) },
      { id: 'rc2', rating_id: 'r-rc2', asset_id: 'a1', asset_symbol: 'AAPL',
        old_value: 'Hold', new_value: 'Buy', changed_at: at(3) },
    ]
    const ids = evaluateRatingNoFollowup({ ratingChanges: changes, tradeIdeas: [], now: T0 })
      .map(i => i.id)
    expect(ids).toEqual(['i1-rating-rc1', 'i1-rating-rc2'])

    // And they are the same ids a day later.
    const next = evaluateRatingNoFollowup({ ratingChanges: changes, tradeIdeas: [], now: T1 })
      .map(i => i.id)
    expect(next).toEqual(ids)
  })

  /**
   * ADJACENT, NOT FIXED HERE — recorded so it is not lost.
   *
   * `postprocess.dedupKey` derives an item's signal type by string-slicing
   * its id (`id.split('-').slice(0, 2)`) and then keeps one item per
   * (signal type, category, asset). Two consequences, both outside this
   * change:
   *
   *   1. The id's PREFIX SHAPE is load-bearing. An evaluator whose id does
   *      not have exactly two dash-separated leading segments gets a
   *      different grouping than its author intended, silently.
   *   2. Two genuinely distinct conditions on one asset are merged. That is
   *      the documented intent, but it is also precisely the "two unrelated
   *      signals are not equivalent because they share an asset" trap, and
   *      it means the second rating change above is unreachable in the UI.
   *
   * This test pins the current behaviour so a later change to it is a
   * deliberate decision rather than a surprise.
   */
  it('documents that the engine keeps one rating item per asset', () => {
    const base = args(T0)
    const two = {
      ...base,
      data: {
        ...base.data,
        ratingChanges: [
          ...base.data.ratingChanges!,
          { id: 'rc2', rating_id: 'r-rc2', asset_id: 'a1', asset_symbol: 'AAPL',
            field_name: 'rating_value', old_value: 'Hold', new_value: 'Buy',
            changed_at: at(3), changed_by: 'u2' },
        ],
      },
    }
    const ratingIds = runGlobalDecisionEngine(two).actionItems
      .filter(i => i.id.startsWith('i1-rating-'))
      .map(i => i.id)
    expect(ratingIds).toHaveLength(1)
    // The survivor is the significant swing, by severity weight.
    expect(ratingIds[0]).toBe('i1-rating-rc1')
  })
})
