/**
 * What these tests are for.
 *
 * The guarantees this slice makes are not "the insert happens" — that is
 * trivially true and uninteresting. They are:
 *
 *   1. A retry cannot record an action twice.
 *   2. A genuinely distinct later action is still a distinct event.
 *   3. A memory failure never fails the portfolio action.
 *   4. No event asserts a reason the product does not actually have.
 *
 * Each of those is tested against a fake that models the DB's partial unique
 * index, because a test with a mock that accepts every insert would certify
 * an idempotency scheme that does not work.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const insertSpy = vi.fn()
const portfolioOrg = { value: 'org-1' as string | null }

vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'memory_events') {
        return { insert: (row: unknown) => insertSpy(row) }
      }
      if (table === 'portfolios') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: portfolioOrg.value ? { organization_id: portfolioOrg.value } : null,
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  },
}))

import {
  recordRecommendationSubmitted,
  recordDecisionRecorded,
  recordDecisionReverted,
  recordExecutionRecorded,
  resolveOrganizationIdForPortfolio,
  __resetOrgCacheForTests,
} from '../lifecycle-events'

/**
 * Stand-in for `memory_events_dedupe_uk`:
 *   unique (organization_id, dedupe_key) where dedupe_key is not null
 *
 * Modelling the real index rather than "reject identical rows" matters,
 * because the keys deliberately differ from the row contents: two inserts
 * with different payloads and the same key MUST collide, and that is the
 * whole mechanism.
 */
function installUniqueIndex() {
  const seen = new Set<string>()
  insertSpy.mockImplementation((row: Record<string, unknown>) => {
    const key = row.dedupe_key as string | null
    if (key != null) {
      const composite = `${row.organization_id}::${key}`
      if (seen.has(composite)) {
        return Promise.resolve({
          error: {
            message:
              'duplicate key value violates unique constraint "memory_events_dedupe_uk"',
          },
        })
      }
      seen.add(composite)
    }
    return Promise.resolve({ error: null })
  })
  return seen
}

const BASE = { organizationId: 'org-1', actorId: 'user-1' }

/**
 * One resolving write's `reviewed_at`, which is now a decision event's
 * identity. Written out at every `recordDecisionRecorded` call site rather
 * than folded into BASE, so that a case which deliberately uses a DIFFERENT
 * instant is visibly different from one that reuses the same one.
 */
const REVIEWED_AT = '2026-11-15T12:00:00.123Z'

beforeEach(() => {
  insertSpy.mockReset()
  portfolioOrg.value = 'org-1'
  __resetOrgCacheForTests()
  vi.restoreAllMocks()
})

describe('idempotency: a retry cannot record the same action twice', () => {
  it('execution — the same accepted trade lands once across three attempts', async () => {
    installUniqueIndex()
    const args = { ...BASE, acceptedTradeId: 'trade-9', portfolioId: 'pf-1', action: 'buy' }

    const first = await recordExecutionRecorded(args)
    const second = await recordExecutionRecorded(args)
    const third = await recordExecutionRecorded(args)

    expect(first).toEqual({ written: true, duplicate: false })
    expect(second).toEqual({ written: false, duplicate: true })
    expect(third).toEqual({ written: false, duplicate: true })
  })

  it('revert — a double-click on Revert produces one event', async () => {
    installUniqueIndex()
    const args = { ...BASE, acceptedTradeId: 'trade-9' }
    expect(await recordDecisionReverted(args)).toEqual({ written: true, duplicate: false })
    expect(await recordDecisionReverted(args)).toEqual({ written: false, duplicate: true })
  })

  it('decision — a retried emit over one resolving write lands once', async () => {
    installUniqueIndex()
    // The retry that actually happens here is an EMIT retry: the UPDATE
    // succeeded, the insert did not, and the caller tries again with the same
    // inputs. The identity is the resolving write's own `reviewed_at`, so the
    // second emit rebuilds the same key and collides.
    //
    // This case previously asserted that the key contained no timestamp at
    // all, which the current epoch-millisecond encoding would have satisfied
    // by accident — the key holds an instant but not in `YYYY-MM-DDT` form.
    // Asserting the shape would therefore have passed while testing nothing.
    // It asserts the behaviour instead.
    const args = {
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted',
      reviewedAt: REVIEWED_AT, acceptedTradeId: 'trade-9',
    }
    await recordDecisionRecorded(args)
    const retry = await recordDecisionRecorded(args)
    expect(retry.duplicate).toBe(true)

    const keys = insertSpy.mock.calls.map(c => (c[0] as Record<string, unknown>).dedupe_key)
    expect(keys[0]).toBe(keys[1])
  })

  it('decision — the key is reproducible from the canonical row, in any timestamp spelling', async () => {
    installUniqueIndex()
    // The reason the key carries epoch milliseconds and not the string. The
    // live writer sends the browser's ISO form; a later reconciler reads the
    // same instant back from PostgREST as `+00:00` with microseconds. If the
    // key were the literal text, the reconciler would rebuild a key that
    // never matched, decide the decision was uncaptured, and append a second
    // event into an append-only table.
    const asSentByBrowser = '2026-11-15T12:00:00.123Z'
    const asReturnedByPostgrest = '2026-11-15T12:00:00.123456+00:00'

    await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted', reviewedAt: asSentByBrowser,
    })
    const reconciled = await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted', reviewedAt: asReturnedByPostgrest,
    })

    expect(reconciled.duplicate).toBe(true)
    const keys = insertSpy.mock.calls.map(c => (c[0] as Record<string, unknown>).dedupe_key)
    expect(keys[0]).toBe(keys[1])

    // ...and the instant is genuinely IN the key, not merely ignored. Without
    // this, a key that dropped `reviewed_at` altogether would satisfy the
    // assertion above by collapsing every resolution of the request into one
    // event — which is the failure in the other direction.
    await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted',
      reviewedAt: '2026-11-15T14:30:00.000Z',
    })
    const laterKey = (insertSpy.mock.calls[2][0] as Record<string, unknown>).dedupe_key
    expect(laterKey).not.toBe(keys[0])
  })

  it('decision — the key does NOT embed the accepted trade, which is written later', async () => {
    installUniqueIndex()
    // The defect this replaces. `markDRAccepted` resolves the request and
    // emits before `createAcceptedTrade` runs, so the trade id is null at
    // emit time and `linkDecisionRequestToTrade` fills it in afterwards. A
    // key naming the trade froze a field the canonical row would contradict
    // minutes later, which is why reconciliation could not match it.
    //
    // Same request, same resolving instant, trade id absent then present:
    // one decision, so one event.
    await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted',
      reviewedAt: REVIEWED_AT, acceptedTradeId: null,
    })
    const afterLink = await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted',
      reviewedAt: REVIEWED_AT, acceptedTradeId: 'trade-9',
    })
    expect(afterLink.duplicate).toBe(true)
  })

  it('recommendation — an identical resubmission lands once', async () => {
    installUniqueIndex()
    const args = {
      ...BASE, tradeQueueItemId: 'tqi-1', decisionRequestId: 'dr-1',
      proposalId: 'prop-1', sizingMode: 'weight', weight: 2.5, shares: null,
    }
    await recordRecommendationSubmitted(args)
    expect((await recordRecommendationSubmitted(args)).duplicate).toBe(true)
  })
})

describe('distinctness: a genuinely different action is still a new event', () => {
  it('resubmitting at a different size is a second recommendation', async () => {
    installUniqueIndex()
    const base = {
      ...BASE, tradeQueueItemId: 'tqi-1', decisionRequestId: 'dr-1',
      proposalId: 'prop-1', sizingMode: 'weight', shares: null,
    }
    expect((await recordRecommendationSubmitted({ ...base, weight: 2.5 })).written).toBe(true)
    expect((await recordRecommendationSubmitted({ ...base, weight: 4.0 })).written).toBe(true)
  })

  it('accept → revert → accept-again records two decisions, not one', async () => {
    installUniqueIndex()
    // Two resolutions of one request, so two events. The discriminator is
    // each resolution's own `reviewed_at`: a revert sets the request back to
    // `pending` and leaves `reviewed_at` alone, and the re-accept overwrites
    // it with a new instant.
    //
    // This is what the old key CLAIMED to do with the accepted trade id and
    // did not: the id is null at emit time on the paths that matter, so both
    // accepts produced `...:accepted:no-trade` and the second was swallowed.
    // Here the trade ids are deliberately left out, to show the distinction
    // comes from the resolution instant and not from them.
    const d1 = await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted',
      reviewedAt: '2026-11-15T12:00:00.000Z',
    })
    await recordDecisionReverted({ ...BASE, acceptedTradeId: 'trade-1' })
    const d2 = await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted',
      reviewedAt: '2026-11-15T14:30:00.000Z',
    })
    expect(d1.written).toBe(true)
    expect(d2.written).toBe(true)
  })

  it('the same request rejected then (after reopen) deferred is two decisions', async () => {
    installUniqueIndex()
    expect((await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'rejected', reviewedAt: REVIEWED_AT,
    })).written).toBe(true)
    expect((await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'deferred', reviewedAt: REVIEWED_AT,
    })).written).toBe(true)
  })

  it('two different trades are two executions', async () => {
    installUniqueIndex()
    expect((await recordExecutionRecorded({ ...BASE, acceptedTradeId: 'trade-1' })).written).toBe(true)
    expect((await recordExecutionRecorded({ ...BASE, acceptedTradeId: 'trade-2' })).written).toBe(true)
  })
})

describe('failure isolation: memory never breaks the portfolio action', () => {
  it('a database error resolves instead of throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    insertSpy.mockResolvedValue({ error: { message: 'permission denied for table memory_events' } })
    await expect(
      recordExecutionRecorded({ ...BASE, acceptedTradeId: 'trade-9' }),
    ).resolves.toEqual({ written: false, duplicate: false })
  })

  it('a thrown network error resolves instead of propagating', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    insertSpy.mockRejectedValue(new Error('Failed to fetch'))
    await expect(
      recordDecisionRecorded({
        ...BASE, decisionRequestId: 'dr-1', status: 'accepted', reviewedAt: REVIEWED_AT,
      }),
    ).resolves.toEqual({ written: false, duplicate: false })
  })

  it('a duplicate is not reported as a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installUniqueIndex()
    await recordExecutionRecorded({ ...BASE, acceptedTradeId: 'trade-9' })
    await recordExecutionRecorded({ ...BASE, acceptedTradeId: 'trade-9' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('honesty: events say what happened, never why', () => {
  it('decision.recorded carries a status and nothing resembling a reason', async () => {
    installUniqueIndex()
    await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'rejected', reviewedAt: REVIEWED_AT,
    })
    const row = insertSpy.mock.calls[0][0] as Record<string, any>
    expect(row.payload).toEqual({ status: 'rejected' })
    for (const forbidden of ['rationale', 'reason', 'decision_note', 'note', 'thesis']) {
      expect(Object.keys(row.payload)).not.toContain(forbidden)
    }
  })

  it('decision.reverted points at revert_reason rather than copying it', async () => {
    installUniqueIndex()
    await recordDecisionReverted({ ...BASE, acceptedTradeId: 'trade-9' })
    const row = insertSpy.mock.calls[0][0] as Record<string, any>
    expect(row.source_type).toBe('accepted_trades')
    expect(row.source_id).toBe('trade-9')
    expect(row.source_field).toBe('revert_reason')
    expect(row.payload).toEqual({})
  })

  it('an absent decision request is omitted, not written as null', async () => {
    installUniqueIndex()
    // Simulation promotion commits a trade with no decision request. The
    // distinction between "no request exists" and "a request was looked up
    // and found empty" is the whole reason compact() drops empty keys: a
    // reader checking `related.decision_request_id` must not see a key.
    await recordExecutionRecorded({
      ...BASE, acceptedTradeId: 'trade-9', portfolioId: 'pf-1', decisionRequestId: null,
    })
    const row = insertSpy.mock.calls[0][0] as Record<string, any>
    expect(row.related).not.toHaveProperty('decision_request_id')
    expect(row.related.accepted_trade_id).toBe('trade-9')
  })

  it('an inbox accept DOES carry the decision request', async () => {
    installUniqueIndex()
    await recordExecutionRecorded({
      ...BASE, acceptedTradeId: 'trade-9', decisionRequestId: 'dr-1',
    })
    const row = insertSpy.mock.calls[0][0] as Record<string, any>
    expect(row.related.decision_request_id).toBe('dr-1')
  })
})

describe('shape: every event is navigable back to canonical truth', () => {
  it.each([
    ['recommendation.submitted', () => recordRecommendationSubmitted({
      ...BASE, tradeQueueItemId: 'tqi-1', decisionRequestId: 'dr-1',
    }), 'idea', 'decision_requests'],
    ['decision.recorded', () => recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted', reviewedAt: REVIEWED_AT,
    }), 'decision', 'decision_requests'],
    ['decision.reverted', () => recordDecisionReverted({
      ...BASE, acceptedTradeId: 'trade-9',
    }), 'trade', 'accepted_trades'],
    ['execution.recorded', () => recordExecutionRecorded({
      ...BASE, acceptedTradeId: 'trade-9',
    }), 'trade', 'accepted_trades'],
  ])('%s has a subject, a source pointer and a dedupe key', async (type, run, subjectType, sourceType) => {
    installUniqueIndex()
    await run()
    const row = insertSpy.mock.calls[0][0] as Record<string, any>
    expect(row.event_type).toBe(type)
    expect(row.subject_type).toBe(subjectType)
    expect(row.subject_id).toBeTruthy()
    expect(row.source_type).toBe(sourceType)
    expect(row.source_id).toBeTruthy()
    expect(row.dedupe_key).toBeTruthy()
    expect(row.organization_id).toBe('org-1')
    expect(row.actor_id).toBe('user-1')
  })

  it('every writer links the idea, so one query returns the whole story', async () => {
    installUniqueIndex()
    await recordRecommendationSubmitted({
      ...BASE, tradeQueueItemId: 'tqi-1', decisionRequestId: 'dr-1',
    })
    await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted', reviewedAt: REVIEWED_AT,
      tradeQueueItemId: 'tqi-1', acceptedTradeId: 'trade-1',
    })
    await recordExecutionRecorded({
      ...BASE, acceptedTradeId: 'trade-1', tradeQueueItemId: 'tqi-1',
    })
    await recordDecisionReverted({
      ...BASE, acceptedTradeId: 'trade-1', tradeQueueItemId: 'tqi-1',
    })
    // fetchIdeaLifecycle filters on related->>trade_queue_item_id. If any
    // writer stopped populating it, that query would silently return a
    // partial history rather than fail.
    for (const call of insertSpy.mock.calls) {
      expect((call[0] as any).related.trade_queue_item_id).toBe('tqi-1')
    }
  })
})

describe('organisation resolution', () => {
  it('resolves through the portfolio and caches the answer', async () => {
    expect(await resolveOrganizationIdForPortfolio('pf-1')).toBe('org-1')
    portfolioOrg.value = 'org-CHANGED'
    expect(await resolveOrganizationIdForPortfolio('pf-1')).toBe('org-1')
  })

  it('returns null for an unknown portfolio instead of throwing', async () => {
    portfolioOrg.value = null
    await expect(resolveOrganizationIdForPortfolio('pf-missing')).resolves.toBeNull()
  })

  it('returns null for a missing portfolio id', async () => {
    await expect(resolveOrganizationIdForPortfolio(null)).resolves.toBeNull()
  })
})
