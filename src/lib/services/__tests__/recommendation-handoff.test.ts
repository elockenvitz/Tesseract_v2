/**
 * Submit Recommendation: the handoff from Idea Pipeline to Decision Inbox.
 *
 * This is the seam the four-stage change exists to establish, so what is
 * pinned here is mostly a NEGATIVE: submitting a recommendation must not touch
 * the idea's stage.
 *
 * That used to happen in two places — `submitRecommendation` Step 3, and
 * `autoAdvanceToDeciding` in trade-lab-service — and it is how the pipeline
 * came to carry decision state at all. An analyst saved sizing and the meaning
 * of their idea was rewritten underneath them; worse, nothing ever moved the
 * stage back, so ideas executed months earlier still read `deciding`.
 *
 * A test that only asserted the happy path would not have caught either, which
 * is why the assertions below are about what is NOT called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsertProposal = vi.fn()
const ensureDecisionRequestForProposal = vi.fn()
const moveTradeIdea = vi.fn()

vi.mock('../trade-lab-service', () => ({
  upsertProposal: (...a: unknown[]) => upsertProposal(...a),
}))
vi.mock('../decision-request-service', () => ({
  ensureDecisionRequestForProposal: (...a: unknown[]) => ensureDecisionRequestForProposal(...a),
  isActiveDecisionRequestStatus: () => true,
  isResolvedDecisionRequestStatus: () => false,
}))
vi.mock('../trade-idea-service', () => ({
  moveTradeIdea: (...a: unknown[]) => moveTradeIdea(...a),
}))
vi.mock('../../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ in: () => ({ data: [], error: null }) }) }),
      insert: () => ({ data: null, error: null }),
    }),
  },
}))

import { submitRecommendation } from '../recommendation-service'

const PROPOSAL = { id: 'prop-1', trade_queue_item_id: 'tq-1', portfolio_id: 'pf-1' }
const REQUEST = { id: 'dr-1', trade_queue_item_id: 'tq-1', status: 'pending' }

const input = {
  tradeQueueItemId: 'tq-1',
  portfolioId: 'pf-1',
  weight: 2.5,
  notes: 'Sized to 2.5% on the reacceleration case',
  requestedAction: 'buy',
}
const context = { actorId: 'u-1', actorName: 'Analyst', uiSource: 'test' } as any

beforeEach(() => {
  vi.clearAllMocks()
  upsertProposal.mockResolvedValue(PROPOSAL)
  ensureDecisionRequestForProposal.mockResolvedValue(REQUEST)
  moveTradeIdea.mockResolvedValue(undefined)
})

describe('submitRecommendation', () => {
  it('creates the recommendation and the decision request', () => {
    return submitRecommendation(input as any, context).then((result) => {
      expect(upsertProposal).toHaveBeenCalledTimes(1)
      expect(ensureDecisionRequestForProposal).toHaveBeenCalledTimes(1)
      expect(result.proposal).toEqual(PROPOSAL)
      expect(result.decisionRequest).toEqual(REQUEST)
    })
  })

  it('does NOT move the idea to another stage', async () => {
    await submitRecommendation(input as any, context)
    expect(moveTradeIdea).not.toHaveBeenCalled()
  })

  it('ignores a caller that still passes autoAdvance', async () => {
    // The option is retained as accepted-and-ignored so existing call sites
    // compile. If it ever starts working again, this fails.
    await submitRecommendation(input as any, context, {
      autoAdvance: { tradeStage: 'developing', createdBy: 'u-1', assignedTo: 'u-1' },
    })
    expect(moveTradeIdea).not.toHaveBeenCalled()
  })

  it('ignores autoAdvance even from the exact state that used to trigger it', async () => {
    // The old condition was: stage is modeling/simulating AND the actor owns
    // the idea. Reproduced precisely, because a partial reproduction would
    // pass whether or not the behaviour was removed.
    for (const tradeStage of ['modeling', 'simulating']) {
      await submitRecommendation(input as any, context, {
        autoAdvance: { tradeStage, createdBy: 'u-1', assignedTo: 'u-1' },
      })
    }
    expect(moveTradeIdea).not.toHaveBeenCalled()
  })

  it('surfaces a decision-request failure instead of reporting success', async () => {
    // The recommendation is only submitted if it actually reached the inbox.
    // Swallowing this would leave the analyst believing a PM had been asked.
    ensureDecisionRequestForProposal.mockRejectedValue(new Error('rls denied'))
    await expect(submitRecommendation(input as any, context)).rejects.toThrow(/decision request/i)
  })
})
