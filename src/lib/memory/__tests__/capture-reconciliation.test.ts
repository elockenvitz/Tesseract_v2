/**
 * The detector's job is to be right about the DENOMINATOR.
 *
 * Its predecessor — a hand comparison in the architecture audit — divided
 * 35 events by 113 decision requests and 53 trades and concluded the Memory
 * Spine captured 1.8% and 7.5% of the product's history. Almost every one
 * of those canonical rows was written before `memory_events` existed. The
 * conclusion drawn from that number was to put a database trigger on
 * `accepted_trades`, the most guarded write path in the product, to fix
 * writers that were in fact firing.
 *
 * So these tests are mostly about the three buckets, and especially about
 * `out_of_epoch` being neither silently dropped nor counted as a failure.
 */

import { describe, it, expect } from 'vitest'
import {
  reconcileCapture,
  tradeHasExecutionEvidence,
  formatCaptureReport,
  eventKey,
  SPINE_EPOCH,
} from '../capture-reconciliation'
import { dedupeKeys, legacyDedupeKeys } from '../lifecycle-events'

const BEFORE = '2026-08-01T12:00:00Z'
const AFTER = '2026-10-12T13:41:29Z'

describe('epoch handling', () => {
  it('does not count a pre-epoch decision as a missed capture', () => {
    const r = reconcileCapture({
      decisions: [{ id: 'dr-old', status: 'accepted', reviewedAt: BEFORE, acceptedTradeId: null }],
      trades: [],
      presentEventKeys: [],
    })
    expect(r.counts).toEqual({ captured: 0, missing: 0, out_of_epoch: 1 })
    // The number the audit produced. A writer that did not exist cannot
    // have missed anything, so there is no coverage to report at all.
    expect(r.coverageInEpoch).toBeNull()
  })

  it('does count a post-epoch decision with no event as missing', () => {
    const r = reconcileCapture({
      decisions: [{ id: 'dr-new', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: null }],
      trades: [],
      presentEventKeys: [],
    })
    expect(r.counts.missing).toBe(1)
    expect(r.counts.out_of_epoch).toBe(0)
    expect(r.coverageInEpoch).toBe(0)
  })

  it('reproduces the real production shape: 2 of 4 captured, the rest out of epoch', () => {
    // The four decision requests resolved since 2026-09-16, two of which
    // carry an event, plus one older row to stand for the other 50.
    const captured = [
      { id: 'dr-a', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: 'at-a' },
      { id: 'dr-b', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: 'at-b' },
    ]
    const missed = [
      { id: 'dr-c', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: 'at-c' },
      { id: 'dr-d', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: 'at-d' },
    ]
    const r = reconcileCapture({
      decisions: [
        ...captured,
        ...missed,
        { id: 'dr-ancient', status: 'accepted', reviewedAt: BEFORE, acceptedTradeId: null },
      ],
      trades: [],
      presentEventKeys: captured.map(d => eventKey('decision.recorded', d.id)),
    })
    expect(r.counts).toEqual({ captured: 2, missing: 2, out_of_epoch: 1 })
    expect(r.coverageInEpoch).toBe(0.5)
    expect(r.rows.filter(x => x.verdict === 'missing').map(x => x.sourceId)).toEqual(['dr-c', 'dr-d'])
  })

  it('treats an absent or unparseable timestamp as out of epoch, not as a miss', () => {
    const r = reconcileCapture({
      decisions: [
        { id: 'dr-null', status: 'accepted', reviewedAt: null, acceptedTradeId: null },
        { id: 'dr-junk', status: 'accepted', reviewedAt: 'not a date', acceptedTradeId: null },
      ],
      trades: [],
      presentEventKeys: [],
    })
    expect(r.counts.missing).toBe(0)
    expect(r.counts.out_of_epoch).toBe(2)
  })
})

describe('matching is on (event_type, source_id), not on the dedupe key', () => {
  /**
   * This group exists because production disagreed with the first
   * implementation, which matched on the writers' `dedupe_key`.
   *
   * Both `decision.recorded` rows in production carry
   * `decision.recorded:<drId>:accepted:no-trade`, because the decision
   * event is emitted BEFORE `accepted_trade_id` is written to the row.
   * Rebuilding the key from current state produces
   * `...:accepted:<tradeId>`, matches nothing, and reports a decision that
   * WAS captured as missing. Measured against the live database on
   * 2026-11-15: key matching scored 0 captured / 4 missing; this scores
   * 2 / 2, which is the truth.
   */
  it('finds the event even though the key froze a field written afterwards', () => {
    const r = reconcileCapture({
      // The row now names its trade...
      decisions: [{ id: 'dr-1', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: 'at-1' }],
      trades: [],
      // ...but the event that exists was keyed before the trade existed.
      presentEventKeys: [eventKey('decision.recorded', 'dr-1')],
    })
    expect(r.counts.captured).toBe(1)
    expect(r.counts.missing).toBe(0)
  })

  it('reproduces the production counts that key matching got wrong', () => {
    const inEpoch = ['dr-a', 'dr-b', 'dr-c', 'dr-d'].map((id, i) => ({
      id, status: 'accepted', reviewedAt: AFTER, acceptedTradeId: `at-${i}`,
    }))
    const r = reconcileCapture({
      decisions: inEpoch,
      trades: [],
      presentEventKeys: ['dr-a', 'dr-b'].map(id => eventKey('decision.recorded', id)),
    })
    expect(r.counts.captured).toBe(2)
    expect(r.counts.missing).toBe(2)
  })

  it('still reports the dedupe key, so a drift from the writers stays visible', () => {
    const r = reconcileCapture({
      decisions: [{ id: 'dr-1', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: 'at-1' }],
      trades: [],
      presentEventKeys: [],
    })
    // Reported, never matched on. If the writers change their key builder
    // this assertion moves with them, which is the point of importing it.
    expect(r.rows[0].dedupeKey).toBe(dedupeKeys.decisionRecorded('dr-1', 'accepted', AFTER))
  })

  it('reports the legacy key too, so the rows written under it stay findable', () => {
    const r = reconcileCapture({
      decisions: [{ id: 'dr-1', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: 'at-1' }],
      trades: [{ id: 'at-1', createdAt: AFTER }],
      presentEventKeys: [],
    })
    const decision = r.rows.find(x => x.expectedEventType === 'decision.recorded')!
    const execution = r.rows.find(x => x.expectedEventType === 'execution.recorded')!

    // The two production rows carry the pre-2026-11-15 shape and are NOT
    // rewritten. A backfill has to be able to recognise them, so the detector
    // reports what that shape would be for each decision alongside the
    // current one.
    expect(decision.legacyDedupeKey)
      .toBe(legacyDedupeKeys.decisionRecorded('dr-1', 'accepted', 'at-1'))
    expect(decision.legacyDedupeKey).toContain(':at-1')
    expect(decision.legacyDedupeKey).not.toBe(decision.dedupeKey)

    // Only `decision.recorded` ever had a second shape. Inventing a legacy
    // key for the other event types would imply a migration that never
    // happened.
    expect(execution.legacyDedupeKey).toBeNull()
  })

  it('the current decision key is derived from reviewed_at, not from the trade', () => {
    // The defect, stated as a test on the detector rather than on the writer:
    // two decisions resolved at the same instant whose trade links differ
    // must produce the SAME key, because they are one decision whose trade
    // id was filled in by a later call.
    const atEmitTime = reconcileCapture({
      decisions: [{ id: 'dr-1', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: null }],
      trades: [], presentEventKeys: [],
    }).rows[0]
    const afterTheLink = reconcileCapture({
      decisions: [{ id: 'dr-1', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: 'at-9' }],
      trades: [], presentEventKeys: [],
    }).rows[0]

    expect(afterTheLink.dedupeKey).toBe(atEmitTime.dedupeKey)
    // ...while the old formula produced two different keys for that one
    // decision, which is exactly why a key-based backfill would have
    // appended a duplicate.
    expect(afterTheLink.legacyDedupeKey).not.toBe(atEmitTime.legacyDedupeKey)
  })

  it('does not double-count when two events share one source', () => {
    const r = reconcileCapture({
      decisions: [{ id: 'dr-1', status: 'accepted', reviewedAt: AFTER, acceptedTradeId: null }],
      trades: [],
      presentEventKeys: [
        eventKey('decision.recorded', 'dr-1'),
        eventKey('decision.recorded', 'dr-1'),
      ],
    })
    expect(r.rows).toHaveLength(1)
    expect(r.counts.captured).toBe(1)
  })
})

describe('reverts', () => {
  it('expects no revert event for a trade that was never reverted', () => {
    const r = reconcileCapture({
      decisions: [],
      trades: [{ id: 'at-1', createdAt: AFTER }],
      presentEventKeys: [eventKey('execution.recorded', 'at-1')],
    })
    // Exactly one row, for the execution. Demanding a `decision.reverted`
    // here would make the report ask the product to record reversals that
    // did not happen.
    expect(r.rows).toHaveLength(1)
    expect(r.counts.missing).toBe(0)
  })

  it('expects one when the trade was reverted, and dates it by the revert', () => {
    const r = reconcileCapture({
      decisions: [],
      trades: [{ id: 'at-1', createdAt: BEFORE, revertedAt: AFTER }],
      presentEventKeys: [],
    })
    const rev = r.rows.find(x => x.expectedEventType === 'decision.reverted')
    expect(rev?.verdict).toBe('missing')
    // The execution predates the Spine; the revert does not. One trade,
    // two verdicts, which is the point of dating each event separately.
    expect(r.rows.find(x => x.expectedEventType === 'execution.recorded')?.verdict)
      .toBe('out_of_epoch')
  })
})

describe('execution evidence', () => {
  it('counts a trade only when execution was observed or attested', () => {
    expect(tradeHasExecutionEvidence({ execution_status: 'complete' })).toBe(true)
    // The important one. `createAcceptedTrade` deliberately does NOT emit
    // for a trade whose holdings never applied, so counting it would
    // demand an event the product is right to withhold. `not_started` is
    // the live-feed trade still awaiting a trader: 4 such rows exist in
    // production and none should carry an execution event.
    expect(tradeHasExecutionEvidence({ execution_status: 'not_started' })).toBe(false)
    expect(tradeHasExecutionEvidence({ execution_status: null })).toBe(false)
    expect(tradeHasExecutionEvidence({})).toBe(false)
  })

  it('reproduces the production execution denominator: 49 of 53 have evidence', () => {
    // Guards against a future widening of the predicate that would silently
    // put the 4 `not_started` trades back into the denominator.
    const rows = [
      ...Array.from({ length: 49 }, () => ({ execution_status: 'complete' })),
      ...Array.from({ length: 4 }, () => ({ execution_status: 'not_started' })),
    ]
    expect(rows.filter(tradeHasExecutionEvidence)).toHaveLength(49)
  })
})

describe('reporting', () => {
  it('says n/a rather than 0% when nothing is in epoch', () => {
    const out = formatCaptureReport(
      reconcileCapture({
        decisions: [{ id: 'd', status: 'accepted', reviewedAt: BEFORE, acceptedTradeId: null }],
        trades: [],
        presentEventKeys: [],
      }),
    )
    expect(out).toContain('coverage        n/a')
    expect(out).toContain('not a miss')
  })

  it('uses the migration date as the default epoch', () => {
    // Pinned so that moving it is a deliberate edit with a test to update,
    // not a silent change to every coverage number the product reports.
    expect(SPINE_EPOCH).toBe('2026-09-16T00:00:00Z')
    expect(reconcileCapture({ decisions: [], trades: [], presentEventKeys: [] }).epoch)
      .toBe(SPINE_EPOCH)
  })
})
