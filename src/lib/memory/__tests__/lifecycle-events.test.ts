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

  it('decision — a retried accept lands once even though reviewed_at moved', async () => {
    installUniqueIndex()
    // The real failure this guards: `updateDecisionRequest` stamps a fresh
    // reviewed_at/updated_at on EVERY call, so a client that retries after
    // losing the response re-writes the row with a new timestamp. A dedupe
    // key derived from that timestamp would not collide, and the retry would
    // record a second decision that never happened.
    const args = { ...BASE, decisionRequestId: 'dr-1', status: 'accepted', acceptedTradeId: 'trade-9' }
    await recordDecisionRecorded(args)
    const retry = await recordDecisionRecorded(args)
    expect(retry.duplicate).toBe(true)

    const keys = insertSpy.mock.calls.map(c => (c[0] as Record<string, unknown>).dedupe_key)
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).not.toMatch(/\d{4}-\d{2}-\d{2}T/) // no timestamp in the key
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
    // Each accept produces a NEW accepted_trade, and the trade id is in the
    // key — so the second accept is correctly distinct. Without the trade id
    // the second decision would be swallowed as a duplicate of the first and
    // the record would show one decision for two.
    const d1 = await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted', acceptedTradeId: 'trade-1',
    })
    await recordDecisionReverted({ ...BASE, acceptedTradeId: 'trade-1' })
    const d2 = await recordDecisionRecorded({
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted', acceptedTradeId: 'trade-2',
    })
    expect(d1.written).toBe(true)
    expect(d2.written).toBe(true)
  })

  it('the same request rejected then (after reopen) deferred is two decisions', async () => {
    installUniqueIndex()
    expect((await recordDecisionRecorded({ ...BASE, decisionRequestId: 'dr-1', status: 'rejected' })).written).toBe(true)
    expect((await recordDecisionRecorded({ ...BASE, decisionRequestId: 'dr-1', status: 'deferred' })).written).toBe(true)
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
      recordDecisionRecorded({ ...BASE, decisionRequestId: 'dr-1', status: 'accepted' }),
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
    await recordDecisionRecorded({ ...BASE, decisionRequestId: 'dr-1', status: 'rejected' })
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
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted',
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
      ...BASE, decisionRequestId: 'dr-1', status: 'accepted',
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
