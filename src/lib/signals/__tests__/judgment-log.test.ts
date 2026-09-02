import { beforeEach, describe, expect, it, vi } from 'vitest'

type EmitParams = Parameters<typeof import('../../audit/audit-service').emitAuditEvent>[0]
const emitAuditEvent = vi.fn(async (_p: EmitParams) => 'evt-1' as string | null)
vi.mock('../../audit/audit-service', () => ({ emitAuditEvent: (p: EmitParams) => emitAuditEvent(p) }))

/**
 * `judgment-log` now reaches Supabase twice, for two different things.
 *
 * The audit row is the firm's record and is mocked above. The second is the
 * reader's own durable suppression, through `disposition-sync` — a separate
 * store with separate eligibility, which is why it is not behind the audit
 * gate. `src/lib/supabase.ts` throws at module load without its environment
 * variables, so the module needs stubbing here or the file cannot be collected
 * at all.
 *
 * Stubbed rather than asserted on: what the durable disposition write does with
 * its arguments is `disposition-ownership.test.ts`'s subject, and duplicating
 * it here would mean two files to update for one behaviour.
 */
const rpc = vi.fn(async () => ({ error: null }))
vi.mock('../../supabase', () => ({ supabase: { rpc: () => rpc() } }))

const { recordSignalJudgment, JUDGMENT_ACTION } = await import('../judgment-log')
const { dispositionKey, judgmentOf, loadDispositions } = await import('../dispositions')
import type { SignalCard } from '../contract'

/**
 * The durable half of the judgment system.
 *
 * The properties that matter: the semantic key reaches the audit log under its
 * own name, feed-quality feedback stays distinguishable from investment
 * judgment, and a server failure never costs the reader their answer.
 */

const ASSET_ID = '11111111-2222-3333-4444-555555555555'

function card(over: Partial<SignalCard> = {}): SignalCard {
  return {
    id: 'c1', type: 'target_expired', surface: 'research', severity: 'attention',
    headline: 'h', metric: null, body: 'b',
    entity: { kind: 'asset', id: ASSET_ID, name: 'Apple', ticker: 'AAPL' },
    context: [], actions: {
      primary: { id: 'capture', label: 'Capture', inline: true }, quick: [], menu: [],
      open: { label: 'Open', href: '/asset/x' },
    },
    provenance: { occurredAt: new Date().toISOString(), reason: 'r' },
    expiry: { staleAfterDays: 30 }, dedupeKey: 'k',
    ...over,
  } as SignalCard
}

const judgment = { key: 'cases_outdated', label: 'Cases outdated', disposition: 'flagged' as const }

beforeEach(() => { localStorage.clear(); emitAuditEvent.mockClear(); emitAuditEvent.mockResolvedValue('evt-1') })

describe('recordSignalJudgment', () => {
  it('writes the semantic key to the audit log under its own metadata field', async () => {
    const r = await recordSignalJudgment({
      userId: 'u1', orgId: 'org1', card: card(),
      question: 'Has the investment view changed?', judgment,
    })
    expect(r).toEqual({ local: true, durable: 'written', state: 'written' })

    const arg = emitAuditEvent.mock.calls[0][0]
    expect(arg.action).toEqual({ type: JUDGMENT_ACTION, category: 'state_change' })
    expect(arg.entity).toMatchObject({ type: 'asset', id: ASSET_ID })
    // `metadata` is optional on the audit params and always set by this module,
    // which is the thing being asserted rather than assumed.
    const md = arg.metadata
    expect(md).toBeDefined()
    // Queryable on its own, not buried inside a state blob.
    expect(md!.judgment_key).toBe('cases_outdated')
    expect(md!.judgment_question).toBe('Has the investment view changed?')
    // The compatibility state is recorded as a feed mechanism, clearly named.
    expect(md!.feed_disposition).toBe('flagged')
    expect(md!.judgment_intent).toBe('judgment')
  })

  it('keeps feed feedback distinguishable from an investment conclusion', async () => {
    // `not_relevant` on a news card maps to `rejected` for suppression. Anything
    // reading these back must be able to exclude it, or complaints about the
    // surface get counted as research about the position.
    await recordSignalJudgment({
      userId: 'u1', orgId: 'org1',
      card: card({ type: 'news' }),
      question: 'What does this mean for AAPL?',
      judgment: { key: 'not_relevant', label: 'Not relevant', disposition: 'rejected', intent: 'feed_quality' },
    })
    const md = emitAuditEvent.mock.calls[0][0].metadata
    expect(md!.judgment_intent).toBe('feed_quality')
    expect(md!.feed_disposition).toBe('rejected')
  })

  it('records locally first, so a server failure never costs the answer', async () => {
    emitAuditEvent.mockResolvedValue(null)
    const r = await recordSignalJudgment({
      userId: 'u1', orgId: 'org1', card: card(), question: 'Q', judgment,
    })
    // The reader is told it worked, because for them it did: the feed reads the
    // local store on the next open and will not show this card again.
    // The two durable writes fail independently. A dropped audit request
    // does not cost the reader the suppression they just bought.
    expect(r).toEqual({ local: true, durable: 'failed', state: 'written' })
    const stored = loadDispositions('u1')[dispositionKey('target_expired', ASSET_ID)]
    expect(judgmentOf(stored)!.key).toBe('cases_outdated')
  })

  it('skips the durable write for entities audit_events cannot represent', async () => {
    // `valid_entity_type` allows `asset` and not `market`. Writing a macro
    // release under a fabricated asset id would put false data in the audit log
    // to avoid a schema conversation.
    const r = await recordSignalJudgment({
      userId: 'u1', orgId: 'org1',
      card: card({ type: 'economic_release', entity: { kind: 'market', id: 'CPI', name: 'CPI' } }),
      question: 'Q', judgment,
    })
    expect(r.durable).toBe('skipped')
    expect(r.local).toBe(true)
    expect(emitAuditEvent).not.toHaveBeenCalled()
    /**
     * …and the reader's own state is still recorded durably.
     *
     * This is the split the `state` field exists for. `audit_events` cannot
     * name a macro release — its entity CHECK has no `market` member — but the
     * card still has to stop asking, on this device and every other. Gating
     * suppression on auditability would mean the cards least able to prove
     * anything are the ones that never remember an answer.
     */
    expect(r.state).toBe('written')
  })

  it('skips rather than throwing when there is no organisation', async () => {
    const r = await recordSignalJudgment({
      userId: 'u1', orgId: null, card: card(), question: 'Q', judgment,
    })
    expect(r).toEqual({ local: true, durable: 'skipped', state: 'written' })
    expect(emitAuditEvent).not.toHaveBeenCalled()
  })

  it('never opens a capture sheet as a side effect of a judgment', async () => {
    /**
     * Phase 3 opened the capture sheet automatically for any `flagged`
     * judgment. `flagged` is a FEED state, and five of the most ordinary
     * answers map to it — Thesis weaker, Cases outdated, Needs review, Revise
     * target, Needs update — so answering a question in one tap threw the
     * reader into a form they never asked for.
     *
     * This module is the whole write path. If it returns without touching
     * anything but storage and the audit log, judgment is decoupled from
     * writing, which is the product principle.
     */
    const r = await recordSignalJudgment({
      userId: 'u1', orgId: 'org1', card: card(), question: 'Q',
      judgment: { key: 'thesis_weaker', label: 'Thesis weaker', disposition: 'flagged' },
    })
    expect(r.local).toBe(true)
    // Exactly one outbound call, and it is the audit log.
    expect(emitAuditEvent).toHaveBeenCalledTimes(1)
  })
})
