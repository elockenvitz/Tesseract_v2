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
  recordRecommendationWithdrawn: vi.fn().mockResolvedValue({ written: true, duplicate: false }),
  resolveOrganizationIdForPortfolio: vi.fn().mockResolvedValue('org-1'),
}))
const {
  recordDecisionRecorded, recordRecommendationWithdrawn, resolveOrganizationIdForPortfolio,
} = spies

vi.mock('../../memory/lifecycle-events', () => ({
  recordDecisionRecorded: spies.recordDecisionRecorded,
  recordRecommendationWithdrawn: spies.recordRecommendationWithdrawn,
  resolveOrganizationIdForPortfolio: spies.resolveOrganizationIdForPortfolio,
  recordDecisionReverted: vi.fn().mockResolvedValue({ written: true, duplicate: false }),
  recordExecutionRecorded: vi.fn().mockResolvedValue({ written: true, duplicate: false }),
  recordRecommendationSubmitted: vi.fn().mockResolvedValue({ written: true, duplicate: false }),
}))

/**
 * The four statuses that are a PM RULING, and the one that is not.
 *
 * `withdrawn` used to sit in the same list as the rest, which is exactly how
 * the defect worked: it is a resolved status, so it fell through the single
 * resolved-status gate into `recordDecisionRecorded` and a withdrawal was
 * recorded as a decision nobody made. Splitting the list here is the
 * assertion. `accepted_with_modification` is included now — it is a real
 * resolved status and its absence from the old list was an oversight.
 */
const PM_RULINGS = ['accepted', 'accepted_with_modification', 'rejected', 'deferred'] as const

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

/**
 * Records the UPDATE payload and echoes `reviewed_at` back from it.
 *
 * Both halves matter. Recording the payload lets a test compare the event's
 * identity against the value the resolving statement actually wrote; echoing
 * it back models PostgREST's `returning`, which is where the service now
 * reads it from — and it echoes in the `+00:00` microsecond spelling rather
 * than the `Z` form that was sent, because that difference is the reason the
 * key carries epoch milliseconds instead of the literal text.
 */
const writes = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>> }))

function asPostgrestTimestamp(iso: string): string {
  return `${iso.replace(/Z$/, '')}456+00:00`
}

vi.mock('../../supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        writes.updates.push(payload)
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'dr-1',
                  portfolio_id: 'pf-1',
                  trade_queue_item_id: 'tqi-1',
                  proposal_id: 'prop-1',
                  reviewed_at: typeof payload.reviewed_at === 'string'
                    ? asPostgrestTimestamp(payload.reviewed_at)
                    : null,
                },
                error: null,
              }),
            }),
          }),
        }
      },
    }),
  },
}))

import { updateDecisionRequest } from '../decision-request-service'

beforeEach(() => {
  recordDecisionRecorded.mockClear()
  recordRecommendationWithdrawn.mockClear()
  resolveOrganizationIdForPortfolio.mockClear()
  resolveOrganizationIdForPortfolio.mockResolvedValue('org-1')
  writes.updates.length = 0
})

/** The payload of the UPDATE that resolved the request. */
const resolvingWrite = () =>
  writes.updates.find(u => typeof u.reviewed_at === 'string') as Record<string, unknown> | undefined

describe('updateDecisionRequest records resolved decisions only', () => {
  it.each(PM_RULINGS)(
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
      // And a ruling is never recorded as a withdrawal.
      expect(recordRecommendationWithdrawn).not.toHaveBeenCalled()
    },
  )

  it('records a WITHDRAWAL, not a decision, for the resolved status withdrawn', async () => {
    await updateDecisionRequest('dr-1', {
      status: 'withdrawn', previousStatus: 'under_review',
    } as never)

    expect(recordRecommendationWithdrawn).toHaveBeenCalledTimes(1)
    expect(recordRecommendationWithdrawn.mock.calls[0][0]).toMatchObject({
      decisionRequestId: 'dr-1',
      fromStatus: 'under_review',
      actorId: 'user-1',
      organizationId: 'org-1',
    })
    // The point of the whole change: no phantom PM decision.
    expect(recordDecisionRecorded).not.toHaveBeenCalled()
  })

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

  it('carries the accepted trade as a pointer, when this path happens to know it', async () => {
    // Still passed, and still useful: it lands in the event's `related` so a
    // reader can navigate from the decision to the trade. It is NO LONGER the
    // event's identity — see `dedupeKeys.decisionRecorded`. It cannot be,
    // because the other two decision paths resolve the request before the
    // trade exists and fill this in with a later UPDATE.
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

/**
 * The event's identity has to be the resolving write's own `reviewed_at`.
 *
 * This is the wiring half of the dedupe fix, and it is the half that broke
 * before. The key builder in `lifecycle-events.ts` can be perfectly correct
 * while a call site hands it the wrong value — which is exactly what happened
 * with `accepted_trade_id`: a field written by a LATER statement was frozen
 * into an identity, so no reconciler could ever rebuild it from the row.
 *
 * So these do not test the formula. They test that what reaches the writer is
 * the value the database holds.
 */
describe('the decision event is identified by the write that resolved it', () => {
  it('passes the server-returned reviewed_at, not a fresh clock reading', async () => {
    await updateDecisionRequest('dr-1', { status: 'accepted' } as never)

    const sent = resolvingWrite()?.reviewed_at as string
    const returned = asPostgrestTimestamp(sent)
    const passed = (recordDecisionRecorded.mock.calls[0][0] as Record<string, unknown>).reviewedAt

    // The double echoes the stored value back in PostgREST's spelling. The
    // service must forward THAT, because it is what a later read of the row
    // will produce. Forwarding the string it sent would also work today and
    // would break the moment a trigger or a default touched the column.
    expect(passed).toBe(returned)
    expect(passed).not.toBe(sent)
    expect(Date.parse(passed as string)).toBe(Date.parse(sent))
  })

  it.each(PM_RULINGS)(
    'identifies the %s decision by the same instant the row records',
    async (status) => {
      await updateDecisionRequest('dr-1', { status } as never)

      const sent = resolvingWrite()?.reviewed_at as string
      const passed = (recordDecisionRecorded.mock.calls[0][0] as Record<string, unknown>).reviewedAt

      // Exact string equality against the value the double stored and
      // returned, deliberately — not `Date.parse(a) === Date.parse(b)`. That
      // weaker form passes whenever a wrongly minted clock reading lands in
      // the same millisecond as the real one, which it usually does, so it
      // would have reported a pass for a broken call site most of the time.
      expect(passed).toBe(asPostgrestTimestamp(sent))
      // ...and both still denote the one instant the row records.
      expect(Date.parse(passed as string)).toBe(Date.parse(sent))
    },
  )

  it('identifies a WITHDRAWAL by the same instant the row records', async () => {
    // Identical assertion strength to the rulings above. A withdrawal moving
    // to its own writer must not move to a weaker identity, which is the
    // easiest way for this change to quietly reintroduce the c8ae04e4 defect
    // on a second code path.
    await updateDecisionRequest('dr-1', {
      status: 'withdrawn', previousStatus: 'pending',
    } as never)

    const sent = resolvingWrite()?.reviewed_at as string
    const passed = (recordRecommendationWithdrawn.mock.calls[0][0] as Record<string, unknown>).reviewedAt

    expect(passed).toBe(asPostgrestTimestamp(sent))
    expect(passed).not.toBe(sent)
    expect(Date.parse(passed as string)).toBe(Date.parse(sent))
  })

  it('never passes a null identity on a path that stamps reviewed_at', async () => {
    // A null `reviewedAt` keys the event `...:no-instant`, which is
    // indistinguishable between two resolutions of the same request. It is
    // tolerated by the writer for genuinely unreviewed rows and must never
    // come from a path that just wrote the column.
    for (const status of PM_RULINGS) {
      recordDecisionRecorded.mockClear()
      writes.updates.length = 0
      await updateDecisionRequest('dr-1', { status } as never)
      const passed = (recordDecisionRecorded.mock.calls[0][0] as Record<string, unknown>).reviewedAt
      expect(passed, `status ${status}`).toBeTruthy()
    }

    // The withdrawal path carries the same obligation.
    recordRecommendationWithdrawn.mockClear()
    writes.updates.length = 0
    await updateDecisionRequest('dr-1', { status: 'withdrawn' } as never)
    const withdrawnInstant =
      (recordRecommendationWithdrawn.mock.calls[0][0] as Record<string, unknown>).reviewedAt
    expect(withdrawnInstant, 'status withdrawn').toBeTruthy()
  })
})
