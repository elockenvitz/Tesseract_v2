/**
 * A trade batch is ONE decision act, and its trades are its execution legs.
 *
 * Five trades approved together were one thing a person did. Before this, an
 * unexplained batch produced five separate "no reason recorded" findings --
 * five rows asking one question about one act. That is the repetition this
 * lens exists to avoid, arriving through the data rather than through the
 * layout, and no amount of card design fixes it.
 *
 * Kept in its own file because it is a semantic contract about identity, not
 * a rendering rule: a disposition, a discussion, an Ask AI turn and any future
 * composer all have to agree on which act they are talking about, and that
 * agreement rests on these functions.
 */

import { describe, it, expect } from 'vitest'
import {
  workOf, subjectOf, groupIntoSituations,
  type DecisionRecord,
} from './index'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const decision = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: 'dr-1', ideaId: 'tq-1',
  portfolioId: 'p1', portfolioName: 'Vision Fund 10K',
  assetId: 'a-orcl', symbol: 'ORCL', companyName: 'Oracle',
  status: 'accepted', action: 'buy',
  decidedBy: 'u1', decidedByName: 'Eric Lockenvitz', decidedAt: daysAgo(160),
  requestedByName: 'Seb Barbero', requestedAt: daysAgo(170),
  decisionNote: null, contextNote: null,
  sizingWeight: 2, sizingShares: null, baselineWeight: null,
  deferredUntil: null, execution: null,
  batch: null,
  ...over,
})

const batch = (id: string, description: string | null = null) =>
  ({ id, name: null, description })

/** Accepted with no written reason: the shape that owes a rationale. */
const owed = (id: string, over: Partial<DecisionRecord> = {}) =>
  decision({ id, status: 'accepted', decisionNote: null, ...over })

describe('a trade batch is one decision, not five', () => {
  it('A. carries the real batch id through the canonical model', () => {
    const d = owed('t1', { batch: batch('b-1') })
    expect(d.batch!.id).toBe('b-1')
    // Both identities survive: the shared act, and the individual request.
    expect(d.id).toBe('t1')
    expect(subjectOf(d)).toBe('trade_batch:b-1')
  })

  it('B. three trades in one batch make one missing-rationale finding', () => {
    const rows = ['t1', 't2', 't3'].map(id => owed(id, { batch: batch('b-1') }))
    const found = groupIntoSituations(rows)
    expect(found).toHaveLength(1)
    expect(found[0].work).toBe('explain')
    expect(found[0].subject).toBe('trade_batch:b-1')
  })

  it('C. three unbatched trades make three findings', () => {
    const rows = ['t1', 't2', 't3'].map(id => owed(id))
    expect(groupIntoSituations(rows).map(s => s.subject))
      .toEqual(['decision_request:t1', 'decision_request:t2', 'decision_request:t3'])
  })

  it('D. two different batches stay two findings', () => {
    const rows = [
      owed('t1', { batch: batch('b-1') }),
      owed('t2', { batch: batch('b-1') }),
      owed('t3', { batch: batch('b-2') }),
    ]
    const found = groupIntoSituations(rows)
    expect(found.map(s => s.subject)).toEqual(['trade_batch:b-1', 'trade_batch:b-2'])
  })

  it('E. a batch beside an unbatched trade keeps them separate', () => {
    // 3 + 2 + 1 is three situations. Not six, and not one.
    const rows = [
      ...['a1', 'a2', 'a3'].map(id => owed(id, { batch: batch('b-A') })),
      ...['b1', 'b2'].map(id => owed(id, { batch: batch('b-B') })),
      owed('solo'),
    ]
    const found = groupIntoSituations(rows)
    expect(found).toHaveLength(3)
    expect(found.map(s => s.legs.length)).toEqual([3, 2, 1])
  })

  it('F. the grouped finding keeps every underlying trade', () => {
    const rows = ['t1', 't2', 't3'].map(id => owed(id, { batch: batch('b-1') }))
    const [s] = groupIntoSituations(rows)
    expect(s.legs.map(l => l.id)).toEqual(['t1', 't2', 't3'])
    expect(s.owed).toHaveLength(3)
    // Leg detail preserved, not summarised away.
    expect(s.legs.every(l => l.assetId != null)).toBe(true)
  })

  it('G. a rationale on the batch clears the whole group', () => {
    /*
     * `trade_batches.description` is where the Trade Book batch view puts a
     * written explanation. Requiring the same sentence on all five legs would
     * be asking somebody to explain one decision five times because the fills
     * happen to be five rows.
     */
    const rows = ['t1', 't2', 't3'].map(id => owed(id, {
      batch: batch('b-1', 'Rotated the semis overweight into staples ahead of the print.'),
    }))
    expect(groupIntoSituations(rows)).toHaveLength(0)
    expect(rows.every(r => workOf(r) == null)).toBe(true)
  })

  it('G2. a note on ONE leg never explains the rest of the batch', () => {
    /*
     * The dangerous direction. `decisionNote` belongs to that trade's own
     * request; reading it upward would let an execution remark about a
     * partial fill stand as the rationale for four unrelated names.
     */
    const rows = [
      owed('t1', { batch: batch('b-1'), decisionNote: 'Filled at the open, no slippage.' }),
      owed('t2', { batch: batch('b-1') }),
      owed('t3', { batch: batch('b-1') }),
    ]
    const found = groupIntoSituations(rows)
    expect(found).toHaveLength(1)
    /*
     * The act still has three legs -- an explained leg does not stop being
     * part of what was committed -- but only two of them owe a reason. Both
     * facts are needed: a card that could only see the stragglers could not
     * say how big the act was, or how much of it is already answered.
     */
    expect(found[0].legs.map(l => l.id)).toEqual(['t1', 't2', 't3'])
    expect(found[0].owed.map(l => l.id)).toEqual(['t2', 't3'])
  })

  it('counts how much of the act is already explained', () => {
    /*
     * A batch of four where two legs carry their own reasons is a different
     * situation from one where none do, and the card has to be able to say
     * which. Both halves come off the same record set -- nothing is counted
     * that is not a leg, and nothing is called explained that `hasHumanReason`
     * would not clear on its own.
     */
    const b = batch('b-1')
    const rows = [
      owed('t1', { batch: b, decisionNote: 'Trimmed into the print.' }),
      owed('t2', { batch: b, decisionNote: 'Funded the staples add.' }),
      owed('t3', { batch: b }),
      owed('t4', { batch: b }),
    ]
    const [s] = groupIntoSituations(rows)
    expect(s.legs).toHaveLength(4)
    expect(s.owed.map(l => l.id)).toEqual(['t3', 't4'])
    // Explained is the complement, never a second source of truth.
    expect(s.legs.length - s.owed.length).toBe(2)
  })

  it('a batch description counts for every leg, so nothing is left owed', () => {
    const b = batch('b-1', 'Rotated the semis overweight into staples.')
    const rows = [owed('t1', { batch: b }), owed('t2', { batch: b })]
    // No situation at all -- the act is explained, so it is not work.
    expect(groupIntoSituations(rows)).toHaveLength(0)
  })

  it('G3. a system string on the batch is not a rationale', () => {
    const rows = [owed('t1', { batch: batch('b-1', 'Auto-resolved on batch approval.') })]
    expect(groupIntoSituations(rows)).toHaveLength(1)
  })

  it('H. a genuine single trade is unchanged', () => {
    const [s] = groupIntoSituations([owed('t1')])
    expect(s.legs).toHaveLength(1)
    expect(s.batch).toBeNull()
    expect(s.subject).toBe('decision_request:t1')
  })

  it('J. the subject is deterministic whatever order rows arrive in', () => {
    const rows = [
      owed('t3', { batch: batch('b-1') }),
      owed('t1', { batch: batch('b-1') }),
      owed('t2', { batch: batch('b-2') }),
    ]
    const a = groupIntoSituations(rows).map(s => s.subject).sort()
    const b = groupIntoSituations([...rows].reverse()).map(s => s.subject).sort()
    expect(a).toEqual(b)
    expect(a).toEqual(['trade_batch:b-1', 'trade_batch:b-2'])
  })

  it('K. eligibility is untouched: only work groups, and only explain work', () => {
    /*
     * Grouping must not widen what counts. A withdrawn request owes no reason,
     * an explained one is finished, and a pending one is its own unanswered
     * question -- batching changes none of that. Nothing in a batch is ever
     * awaiting a decision, so `decide` work never collapses.
     */
    const rows = [
      owed('withdrawn', { status: 'withdrawn', batch: batch('b-1') }),
      owed('explained', { batch: batch('b-1'), decisionNote: 'Sized to 2% on the cohort data.' }),
      decision({ id: 'pending', status: 'pending', decidedAt: null, batch: batch('b-1') }),
    ]
    const found = groupIntoSituations(rows)
    expect(found).toHaveLength(1)
    expect(found[0].work).toBe('decide')
    expect(found[0].subject).toBe('decision_request:pending')
  })

  it('never groups on a coincidence', () => {
    /*
     * Same name, same book, same person, seconds apart, and still two
     * decisions -- because the database does not say they were one. Every
     * one of those is a signal a heuristic would happily collapse, and each
     * is routinely wrong.
     */
    const rows = [
      owed('t1', { symbol: 'AAPL', assetId: 'a-aapl', decidedAt: daysAgo(10) }),
      owed('t2', { symbol: 'AAPL', assetId: 'a-aapl', decidedAt: daysAgo(10) }),
    ]
    expect(groupIntoSituations(rows)).toHaveLength(2)
  })

  it('ignores a batch id whose batch could not be read', () => {
    /*
     * The hook only attaches `batch` when the row came back. A batch pointing
     * at something this reader cannot see is not an act they can open, so the
     * trade falls back to its own identity rather than joining a group that
     * cannot be described.
     */
    const rows = [owed('t1'), owed('t2')]
    expect(groupIntoSituations(rows).map(s => s.subject))
      .toEqual(['decision_request:t1', 'decision_request:t2'])
  })
})
