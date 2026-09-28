/**
 * Outcome eligibility.
 *
 * The rule under test is "an outcome may be recorded only once a decision
 * has been", and the assertions that matter most are the ones proving stage
 * plays no part in it — the previous two versions of this rule were
 * `stage !== 'deciding'` and `stage !== 'ready_to_recommend'`, and the second
 * was just the first renamed.
 *
 * The pure predicates are tested directly; `fetchOutcomeEligibility` is
 * tested against a mocked client for the message it produces, because
 * "not eligible" with no explanation sends a reader hunting for a bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DECIDED_DECISION_STATUSES,
  isDecidedDecisionStatus,
  governingDecision,
  hasRecordedDecision,
  fetchOutcomeEligibility,
} from '../outcome-eligibility'

const dr = (status: string, created_at: string) => ({ status, created_at })

describe('what counts as a decision', () => {
  it('accepts the four statuses where a PM actually acted', () => {
    expect([...DECIDED_DECISION_STATUSES].sort()).toEqual([
      'accepted', 'accepted_with_modification', 'deferred', 'rejected',
    ])
  })

  it('does NOT count withdrawn', () => {
    // Withdrawal is the analyst pulling their own recommendation back. Nobody
    // decided anything. This is the single most important exclusion here,
    // because `RESOLVED_DECISION_REQUEST_STATUSES` — the set that already
    // existed — does include it, and reusing that set would have made every
    // withdrawn recommendation look like a decision.
    expect(isDecidedDecisionStatus('withdrawn')).toBe(false)
    expect(DECIDED_DECISION_STATUSES).not.toContain('withdrawn')
  })

  it('does not count anything still awaiting a decision', () => {
    for (const s of ['pending', 'under_review', 'needs_discussion']) {
      expect(isDecidedDecisionStatus(s)).toBe(false)
    }
  })

  it('does not count absent or unknown statuses', () => {
    expect(isDecidedDecisionStatus(null)).toBe(false)
    expect(isDecidedDecisionStatus(undefined)).toBe(false)
    expect(isDecidedDecisionStatus('')).toBe(false)
    expect(isDecidedDecisionStatus('deciding')).toBe(false)
  })
})

describe('which request governs when there are several', () => {
  it('takes the most recent by created_at', () => {
    // Production has 109 requests across 72 ideas; one idea has thirteen.
    const picked = governingDecision([
      dr('withdrawn', '2026-03-16T14:23:00Z'),
      dr('pending', '2026-03-16T16:21:00Z'),
      dr('withdrawn', '2026-03-07T22:20:00Z'),
    ])
    expect(picked?.status).toBe('pending')
  })

  it('is not "any request that was ever decided"', () => {
    // The distinction exists for revert: revertAcceptedTrade sets the request
    // back to `pending` precisely to reopen the question. "Any ever decided"
    // would keep reading that as decided and defeat the revert.
    const afterRevert = [
      dr('accepted', '2026-04-01T10:00:00Z'),
      dr('pending', '2026-04-02T10:00:00Z'),
    ]
    expect(governingDecision(afterRevert)?.status).toBe('pending')
    expect(hasRecordedDecision(afterRevert, [])).toBe(false)
  })

  it('reads a resubmission after an accept as undecided again', () => {
    const resubmitted = [
      dr('withdrawn', '2026-03-15T17:11:00Z'),
      dr('accepted', '2026-03-15T17:31:00Z'),
      dr('pending', '2026-03-16T09:00:00Z'),
    ]
    expect(governingDecision(resubmitted)?.status).toBe('pending')
  })

  it('returns null for an idea with no requests at all', () => {
    expect(governingDecision([])).toBeNull()
  })

  it('does not crash on a missing timestamp', () => {
    expect(governingDecision([{ status: 'accepted', created_at: null }])?.status).toBe('accepted')
  })
})

describe('hasRecordedDecision', () => {
  it('is false when nothing was ever submitted', () => {
    // "Ready but never submitted": the idea may be at ready_to_recommend, and
    // that is still not a decision.
    expect(hasRecordedDecision([], [])).toBe(false)
  })

  it('is false while a recommendation sits in the inbox', () => {
    expect(hasRecordedDecision([dr('pending', '2026-04-01T10:00:00Z')], [])).toBe(false)
    expect(hasRecordedDecision([dr('under_review', '2026-04-01T10:00:00Z')], [])).toBe(false)
    expect(hasRecordedDecision([dr('needs_discussion', '2026-04-01T10:00:00Z')], [])).toBe(false)
  })

  it('is false when the only request was withdrawn', () => {
    expect(hasRecordedDecision([dr('withdrawn', '2026-04-01T10:00:00Z')], [])).toBe(false)
  })

  it('is true once the governing request is decided', () => {
    for (const s of DECIDED_DECISION_STATUSES) {
      expect(hasRecordedDecision([dr(s, '2026-04-01T10:00:00Z')], [])).toBe(true)
    }
  })

  it('is true for a live accepted trade with no decision request at all', () => {
    // Promotion straight from simulation never creates a decision request.
    // accepted_trades is the canonical record of a committed trade, and both
    // promotion paths create it BEFORE moving the idea — so requiring a
    // decision_request here would have broken every simulation promotion.
    expect(hasRecordedDecision([], [{ is_active: true, reverted_at: null }])).toBe(true)
  })

  it('ignores a reverted or deactivated trade', () => {
    expect(hasRecordedDecision([], [{ is_active: false, reverted_at: null }])).toBe(false)
    expect(hasRecordedDecision([], [{ is_active: true, reverted_at: '2026-04-02T10:00:00Z' }])).toBe(false)
  })

  it('treats a missing is_active as live rather than as absent', () => {
    // A narrowed select that omits the column must not silently make every
    // committed trade disappear.
    expect(hasRecordedDecision([], [{}])).toBe(true)
  })

  it('takes a live trade as sufficient even when the request is pending', () => {
    // The revert path resets the request but leaves the trade active only if
    // the revert itself failed; a live trade is the stronger evidence.
    expect(hasRecordedDecision(
      [dr('pending', '2026-04-02T10:00:00Z')],
      [{ is_active: true, reverted_at: null }],
    )).toBe(true)
  })

  it('never consults a stage', () => {
    // The whole point. There is no stage in the signature, and no argument
    // shaped like one could change the answer.
    expect(hasRecordedDecision.length).toBe(2)
  })
})

// ── The IO wrapper ─────────────────────────────────────────────────────────

const rows: { requests: unknown[]; trades: unknown[] } = { requests: [], trades: [] }

vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => Promise.resolve({
          data: table === 'decision_requests' ? rows.requests : rows.trades,
          error: null,
        }),
      }),
    }),
  },
}))

beforeEach(() => {
  rows.requests = []
  rows.trades = []
})

describe('fetchOutcomeEligibility', () => {
  it('names the un-submitted case', async () => {
    const r = await fetchOutcomeEligibility('tq-1')
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/no recommendation has been submitted/i)
  })

  it('names the still-pending case', async () => {
    rows.requests = [dr('pending', '2026-04-01T10:00:00Z')]
    const r = await fetchOutcomeEligibility('tq-1')
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/awaiting a decision in the decision inbox/i)
  })

  it('names the withdrawn case separately, because the fix differs', async () => {
    rows.requests = [dr('withdrawn', '2026-04-01T10:00:00Z')]
    const r = await fetchOutcomeEligibility('tq-1')
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/withdrawn/i)
  })

  it('allows it once a decision exists, with no reason attached', async () => {
    rows.requests = [dr('accepted', '2026-04-01T10:00:00Z')]
    const r = await fetchOutcomeEligibility('tq-1')
    expect(r).toEqual({ eligible: true })
  })

  it('allows it for a committed trade with no request', async () => {
    rows.trades = [{ is_active: true, reverted_at: null }]
    expect((await fetchOutcomeEligibility('tq-1')).eligible).toBe(true)
  })
})
