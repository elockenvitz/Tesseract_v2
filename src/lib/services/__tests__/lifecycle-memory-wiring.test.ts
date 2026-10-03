/**
 * The wiring, as distinct from the writers.
 *
 * `lifecycle-events.test.ts` proves the writers behave. These prove the
 * services CALL them, and — the part that actually bites — that one service
 * does not.
 *
 * `revertAcceptedTrade` reopens its decision request by calling
 * `updateDecisionRequest(id, { status: 'pending' })`. If the memory write in
 * that function were unguarded, every revert would append a `decision.recorded`
 * event claiming a decision was made, at the exact moment one was being undone.
 * The Spine would then say a reverted trade was decided twice. That is the
 * regression this file exists to catch, and it is invisible in the UI.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// `vi.mock` factories are hoisted above every top-level const, so the spies
// have to be created inside `vi.hoisted` to exist by the time they run.
const spies = vi.hoisted(() => ({
  recordDecisionRecorded: vi.fn().mockResolvedValue({ written: true, duplicate: false }),
  resolveOrganizationIdForPortfolio: vi.fn().mockResolvedValue('org-1'),
}))
const { recordDecisionRecorded, resolveOrganizationIdForPortfolio } = spies

vi.mock('../../memory/lifecycle-events', () => ({
  recordDecisionRecorded: spies.recordDecisionRecorded,
  resolveOrganizationIdForPortfolio: spies.resolveOrganizationIdForPortfolio,
  recordDecisionReverted: vi.fn().mockResolvedValue({ written: true, duplicate: false }),
  recordExecutionRecorded: vi.fn().mockResolvedValue({ written: true, duplicate: false }),
  recordRecommendationSubmitted: vi.fn().mockResolvedValue({ written: true, duplicate: false }),
}))

/*
 * This suite is about which lifecycle MEMORY EVENTS a decision writes.
 * `updateDecisionRequest` also keeps a deferral obligation in step, and the
 * stub below does not model `memory_obligations` — so every case printed a
 * TypeError warning from the obligation writer. Correct behaviour, but noise
 * that would hide a real one. The writer is tested properly in
 * lib/memory/__tests__/due-obligations.test.ts.
 */
vi.mock('../../memory/obligation-writer', () => ({
  syncIdeaRevisitObligation: vi.fn(async () => ({ obligationId: 'ob-test', action: 'superseded' })),
  syncDecisionRevisitObligation: vi.fn(async () => ({ obligationId: 'ob-test', action: 'superseded' })),
  clearIdeaRevisitObligation: vi.fn(async () => ({ obligationId: null, action: 'unchanged' })),
}))

vi.mock('../../supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: {
                id: 'dr-1',
                portfolio_id: 'pf-1',
                trade_queue_item_id: 'tqi-1',
                proposal_id: 'prop-1',
              },
              error: null,
            }),
          }),
        }),
      }),
    }),
  },
}))

import { updateDecisionRequest } from '../decision-request-service'

beforeEach(() => {
  recordDecisionRecorded.mockClear()
  resolveOrganizationIdForPortfolio.mockClear()
  resolveOrganizationIdForPortfolio.mockResolvedValue('org-1')
})

describe('updateDecisionRequest records resolved decisions only', () => {
  it.each(['accepted', 'rejected', 'deferred', 'withdrawn'])(
    'records a decision for the resolved status %s',
    async (status) => {
      await updateDecisionRequest('dr-1', { status } as never)
      expect(recordDecisionRecorded).toHaveBeenCalledTimes(1)
      expect(recordDecisionRecorded.mock.calls[0][0]).toMatchObject({
        decisionRequestId: 'dr-1',
        status,
        actorId: 'user-1',
        organizationId: 'org-1',
      })
    },
  )

  it.each(['pending', 'under_review', 'needs_discussion'])(
    'records NOTHING for the active status %s',
    async (status) => {
      await updateDecisionRequest('dr-1', { status } as never)
      expect(recordDecisionRecorded).not.toHaveBeenCalled()
    },
  )

  it('a revert reopening a request logs no decision', async () => {
    // Exactly the call revertAcceptedTrade makes.
    await updateDecisionRequest('dr-1', {
      status: 'pending',
      decisionNote: null,
      acceptedTradeId: null,
    } as never)
    expect(recordDecisionRecorded).not.toHaveBeenCalled()
  })

  it('carries the accepted trade so a re-accept after revert stays distinct', async () => {
    await updateDecisionRequest('dr-1', {
      status: 'accepted',
      acceptedTradeId: 'trade-7',
    } as never)
    expect(recordDecisionRecorded.mock.calls[0][0]).toMatchObject({
      acceptedTradeId: 'trade-7',
    })
  })

  it('passes no rationale, note, or thesis into the event', async () => {
    await updateDecisionRequest('dr-1', {
      status: 'rejected',
      decisionNote: 'Valuation too rich at these levels',
    } as never)
    const arg = recordDecisionRecorded.mock.calls[0][0] as Record<string, unknown>
    const serialised = JSON.stringify(arg)
    expect(serialised).not.toContain('Valuation')
    for (const key of ['decisionNote', 'rationale', 'reason', 'note']) {
      expect(arg).not.toHaveProperty(key)
    }
  })

  it('still returns the updated request when the org cannot be resolved', async () => {
    resolveOrganizationIdForPortfolio.mockResolvedValue(null)
    const result = await updateDecisionRequest('dr-1', { status: 'accepted' } as never)
    expect(recordDecisionRecorded).not.toHaveBeenCalled()
    expect(result).toMatchObject({ id: 'dr-1' })
  })
})
