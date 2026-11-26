/**
 * Outcomes must report the PM's actual answer, once.
 *
 * Two defects, both measured in the QA org on 2026-11-20.
 *
 * ── A. A deferral was reported as a rejection ────────────────────────────
 *
 * `useDecisionAccountability` built its row with:
 *
 *     stage: (d.status === 'deferred' ? 'rejected' : d.status) as any
 *
 * because `DecisionStage` had no `deferred` member. The cast through `any`
 * is what let it compile. A PM who deferred META was shown, in the log of
 * record, as having REJECTED it. Those are different decisions: a rejection
 * closes the idea, a deferral keeps it open and says "not yet".
 *
 * ── B. A rejection was listed twice ──────────────────────────────────────
 *
 * Rejecting a recommendation writes the outcome onto the idea AND leaves the
 * `decision_requests` row in `rejected`, so both row sources emit one. CRWD
 * appeared twice; MSFT (accepted) and META (deferred) appeared once each.
 *
 * They cannot be deduplicated by `decision_id` -- `decisionRows` key on the
 * `trade_queue_items` id and `passedRows` on the `decision_requests` id, so
 * the same decision carries two ids and nothing collides. The shared
 * identity is the idea.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 * The two extracted pure functions. The QA org's three real decisions are
 * the fixture, including the two that must NOT be touched, so a rule that
 * over-collapses or over-relabels fails here rather than in the product.
 */
import { describe, it, expect } from 'vitest'
import { stageFromRequestStatus, dropIdeaRowsSupersededByRequest } from '../decision-stage-identity'

// The QA org, as it actually stands.
const CRWD_IDEA = 'crwd-idea-id'
const META_IDEA = 'meta-idea-id'
const MSFT_IDEA = 'msft-idea-id'

describe('the PM answer survives to the row', () => {
  // THE DEFECT: this returned 'rejected'.
  it('reports a deferral as deferred', () => {
    expect(stageFromRequestStatus('deferred')).toBe('deferred')
  })

  it('reports a rejection as rejected', () => {
    expect(stageFromRequestStatus('rejected')).toBe('rejected')
  })

  it('does not collapse deferred and rejected onto one stage', () => {
    expect(stageFromRequestStatus('deferred')).not.toBe(stageFromRequestStatus('rejected'))
  })

  it('passes an approval through', () => {
    expect(stageFromRequestStatus('approved')).toBe('approved')
  })

  it('passes a cancellation through', () => {
    expect(stageFromRequestStatus('cancelled')).toBe('cancelled')
  })

  it('falls back to cancelled for a status it does not know', () => {
    // Fail closed to a terminal, non-judgmental stage rather than asserting
    // a rejection nobody made.
    expect(stageFromRequestStatus('some_future_status')).toBe('cancelled')
  })

  it('falls back for null', () => {
    expect(stageFromRequestStatus(null)).toBe('cancelled')
  })
})

describe('one decision, one row', () => {
  // THE DEFECT: CRWD was emitted by both sources.
  it('drops the idea row when a passed request covers it', () => {
    const kept = dropIdeaRowsSupersededByRequest(
      [{ decision_id: CRWD_IDEA, category: 'passed' }],
      [{ trade_idea: { id: CRWD_IDEA } }],
    )
    expect(kept).toHaveLength(0)
  })

  it('keeps a rejected idea that has no request of its own', () => {
    // Not every rejection goes through a decision request. Dropping this
    // would silently lose the decision instead of duplicating it.
    const kept = dropIdeaRowsSupersededByRequest(
      [{ decision_id: CRWD_IDEA, category: 'passed' }],
      [],
    )
    expect(kept).toHaveLength(1)
  })

  it('never drops an executed row, even if a passed request names the idea', () => {
    // An approved row carries the matched executions. It is not a duplicate
    // of a passed request and must survive regardless.
    const kept = dropIdeaRowsSupersededByRequest(
      [{ decision_id: MSFT_IDEA, category: 'acted' }],
      [{ trade_idea: { id: MSFT_IDEA } }],
    )
    expect(kept).toHaveLength(1)
  })

  it('leaves the QA org at three rows, one per decision', () => {
    const kept = dropIdeaRowsSupersededByRequest(
      [
        { decision_id: CRWD_IDEA, category: 'passed' }, // superseded
        { decision_id: META_IDEA, category: 'passed' }, // superseded
        { decision_id: MSFT_IDEA, category: 'acted' },  // kept
      ],
      [{ trade_idea: { id: CRWD_IDEA } }, { trade_idea: { id: META_IDEA } }],
    )
    // The two passed requests re-enter as passedRows, so the total is
    // 1 + 2 = 3, not 5.
    expect(kept.map(r => r.decision_id)).toEqual([MSFT_IDEA])
  })

  it('tolerates a request with no joined idea', () => {
    const kept = dropIdeaRowsSupersededByRequest(
      [{ decision_id: CRWD_IDEA, category: 'passed' }],
      [{ trade_idea: null }, {}],
    )
    expect(kept).toHaveLength(1)
  })

  it('tolerates a null request list', () => {
    const kept = dropIdeaRowsSupersededByRequest(
      [{ decision_id: CRWD_IDEA, category: 'passed' }],
      null,
    )
    expect(kept).toHaveLength(1)
  })
})
