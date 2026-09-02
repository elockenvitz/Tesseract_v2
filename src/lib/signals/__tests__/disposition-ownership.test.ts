import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SignalCard } from '../contract'
import {
  DISPOSITION_DAYS,
  dispositionEntityFor,
  dispositionKey,
  loadDispositions,
  recordDisposition,
} from '../dispositions'
import {
  ACTION_OWNERSHIP,
  DURABLE_KEY_PREFIX,
  SHARED_ACK,
  durableDispositionKey,
  isPersonalAction,
  mutatesSharedObject,
  ownershipOf,
  parseDurableKey,
  suppressionFieldFor,
} from '../disposition-scope'
import { acknowledgmentFor } from '../judgment-policy'
import { DAY_MS } from '../thresholds'

/**
 * Ownership: whose state does an action change?
 *
 * ── What went wrong, and what these tests are pinning ─────────────────────
 *
 * The desktop attention card's Defer branched on `source_type` and, for a trade
 * queue item, wrote `trade_queue_items.revisit_at` — the shared row every
 * unvoted member of the organization sees. One analyst's "not today" moved the
 * revisit time the whole desk reads, and, because the attention filter never
 * looks at `revisit_at`, deferred nothing for the person who clicked.
 *
 * A personal intent with a shared effect and no personal effect. These tests
 * exist so that shape cannot come back unnoticed: the ownership table is pinned
 * against the vocabularies the app actually writes, and the storage tests prove
 * that a personal answer is invisible to a colleague and survives a reload.
 *
 * Note what is deliberately NOT asserted anywhere below: any relationship
 * between one user's disposition and another user's view of the same object.
 * There is none, and the absence is the property.
 */

const ALICE = 'user-alice'
const BOB = 'user-bob'
const NOW = Date.UTC(2026, 8, 2)

function card(over: Partial<SignalCard> = {}): SignalCard {
  return {
    id: 'insight:aapl-1',
    type: 'no_research',
    surface: 'research',
    severity: 'attention',
    headline: 'AAPL has no thesis on record',
    metric: null,
    body: 'body',
    entity: { kind: 'asset', id: 'aapl', name: 'Apple', ticker: 'AAPL' },
    context: [],
    actions: {
      primary: { id: 'capture', label: 'Capture', inline: true },
      quick: [],
      menu: [],
      open: { label: 'Open AAPL', href: '/asset/aapl' },
    },
    provenance: { occurredAt: new Date(NOW).toISOString(), reason: 'because' },
    expiry: { staleAfterDays: 14 },
    dedupeKey: 'no_research:aapl:2026-09-02',
    ...over,
  } as SignalCard
}

beforeEach(() => { localStorage.clear() })

// ─────────────────────────────────────────────────────────────────────────────
// 1. The contract itself
// ─────────────────────────────────────────────────────────────────────────────

describe('the ownership contract', () => {
  /**
   * The list the app can actually write, restated here on purpose.
   *
   * Pinned rather than derived: deriving it from the same table it checks would
   * assert nothing. Adding a verb to a card without deciding who owns it fails
   * HERE, which is the point — the previous failure mode was a control acquiring
   * a shared effect because a mutation happened to be in scope at the call site.
   */
  const WRITABLE = [
    'feed_snoozed', 'feed_dismissed',
    'feed_not_useful', 'feed_wrong_person',
    'reviewed', 'in_progress', 'defer', 'not_mine',
    'judgment',
  ]

  it('classifies every verb the surfaces can write', () => {
    for (const key of WRITABLE) {
      expect(ownershipOf(key), `${key} is unclassified`).not.toBeNull()
    }
  })

  it('makes every feed and queue verb personal', () => {
    for (const key of WRITABLE) {
      expect(isPersonalAction(key), `${key} should be personal`).toBe(true)
      expect(mutatesSharedObject(key), `${key} must not mutate shared state`).toBe(false)
    }
  })

  it('keeps the real resolution verbs shared, and says where they land', () => {
    for (const verb of ['markDeliverableDone', 'approveTradeIdea', 'rejectTradeIdea', 'deferTradeIdea']) {
      expect(mutatesSharedObject(verb), `${verb} should be shared`).toBe(true)
      expect(ACTION_OWNERSHIP[verb].writes).toBeTruthy()
    }
  })

  /**
   * The specific regression. `defer` is the reader's own state; `deferTradeIdea`
   * is the queue's. They were the same button.
   */
  it('separates the personal Defer from the shared revisit-time verb', () => {
    expect(ownershipOf('defer')).toBe('personal')
    expect(ownershipOf('deferTradeIdea')).toBe('shared')
    expect(ACTION_OWNERSHIP.deferTradeIdea.writes).toContain('trade_queue_items')
    expect(ACTION_OWNERSHIP.defer.writes).toContain('attention_user_state')
  })

  it('leaves the shared-acknowledgment category empty rather than absent', () => {
    expect(SHARED_ACK.size).toBe(0)
    // Nothing may claim the third category by accident either.
    for (const v of Object.values(ACTION_OWNERSHIP)) {
      expect(v.ownership).not.toBe('shared_ack')
    }
  })

  it('returns null for a verb nobody has classified', () => {
    expect(ownershipOf('archive_everything')).toBeNull()
    expect(isPersonalAction('archive_everything')).toBe(false)
    // …and `mutatesSharedObject` is false too, so an unknown verb is not
    // silently granted shared authority by a defaulting branch.
    expect(mutatesSharedObject('archive_everything')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Durable identity
// ─────────────────────────────────────────────────────────────────────────────

describe('the durable key', () => {
  it('namespaces feed rows away from attention rows', () => {
    const k = durableDispositionKey('no_research', 'aapl')
    expect(k.startsWith(DURABLE_KEY_PREFIX)).toBe(true)
    // `generateAttentionId` produces a 32-char hex hash. The two shapes are
    // disjoint, which is why one table can hold both without collision.
    expect(/^[0-9a-f]{32}$/.test(k)).toBe(false)
  })

  it('round-trips a subject that contains colons', () => {
    // `idea:recommendation:<uuid>` and `attention:<uuid>` both do — only the
    // first separator after the namespace is structural.
    const subject = 'idea:recommendation:5f1c2f8e-0000-4000-8000-000000000001'
    const parsed = parseDurableKey(durableDispositionKey('recommendation', subject))
    expect(parsed).toEqual({ type: 'recommendation', subject })
  })

  it('refuses a key from the other namespace', () => {
    expect(parseDurableKey('a3f9c2b18e4d5a6f7b8c9d0e1f2a3b4c')).toBeNull()
    expect(parseDurableKey('signal:no_research')).toBeNull()
    expect(parseDurableKey('signal:no_research:')).toBeNull()
  })

  /**
   * Pair trades and multi-portfolio holdings, which are the same problem.
   *
   * A pair is two positions with one thesis, and the same asset can be held in
   * several portfolios. Both produce cards whose entity is the ASSET, and both
   * must therefore behave the way any recurring machine finding does: one
   * answer about AAPL is one answer about AAPL, whichever leg or portfolio
   * raised it. Keying deeper would ask the reader the same question once per
   * portfolio; keying shallower would silence a different name.
   *
   * The invariant that matters is that the identity is derived, deterministic
   * and not duplicated — the local and durable stores must agree on it by
   * construction, not by two call sites happening to build the same string.
   *
   * ── UNRESOLVED, and this test must not be read as settling it ────────────
   *
   * What is pinned below is that TODAY'S signals key on the asset, because
   * today's signals are claims about a name: "AAPL has no thesis on record" is
   * true or false about AAPL, not about a portfolio's copy of AAPL.
   *
   * That does NOT generalise to signals that do not yet exist. A future
   * Portfolio signal may have a portfolio in its semantic subject, and then
   * asset-global keying would be wrong in a way that is silent and expensive:
   *
   *   "AAPL framework break in Growth Fund"
   *   "AAPL framework break in Defensive Fund"
   *
   * are two findings, and answering one must not silence the other. The rule is
   * that **disposition identity follows the semantic subject of the signal** —
   * `dispositionEntityFor` already encodes one such distinction (entity for a
   * recurring claim, card for a one-off artefact) and would need a third case,
   * not a blanket switch.
   *
   * Audit this before wiring suppression for any portfolio-scoped signal. See
   * `docs/decision-memory-parked.md` §5.
   */
  it('gives one asset one key across legs and portfolios — for today’s signals', () => {
    const longLeg = card({ id: 'insight:pair-long', dedupeKey: 'no_research:aapl:2026-09-02' })
    const shortLeg = card({ id: 'insight:pair-short', dedupeKey: 'no_research:aapl:2026-09-03' })

    expect(dispositionEntityFor(longLeg)).toBe(dispositionEntityFor(shortLeg))
    expect(durableDispositionKey(longLeg.type, dispositionEntityFor(longLeg)))
      .toBe(durableDispositionKey(shortLeg.type, dispositionEntityFor(shortLeg)))
  })

  it('keeps the other leg of a pair independent when it is a different name', () => {
    const aapl = card()
    const msft = card({ entity: { kind: 'asset', id: 'msft', name: 'Microsoft', ticker: 'MSFT' } as never })
    expect(durableDispositionKey(aapl.type, dispositionEntityFor(aapl)))
      .not.toBe(durableDispositionKey(msft.type, dispositionEntityFor(msft)))
  })

  it('keeps two artefacts on one name apart', () => {
    // The `desk` / `workflow` rule: one colleague's post, or one queue item, is
    // an artefact somebody created — not a claim the data will make again.
    const a = card({ id: 'attention:item-1', surface: 'workflow' })
    const b = card({ id: 'attention:item-2', surface: 'workflow' })
    expect(durableDispositionKey(a.type, dispositionEntityFor(a)))
      .not.toBe(durableDispositionKey(b.type, dispositionEntityFor(b)))
  })

  it('sends settled and rejected to different windows, and flagged to neither', () => {
    expect(suppressionFieldFor('settled')).toBe('snoozed_until')
    expect(suppressionFieldFor('rejected')).toBe('dismissed_until')
    // A flagged answer is remembered and suppresses nothing — the reader said
    // the finding is real.
    expect(suppressionFieldFor('flagged')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. One user's disposition is one user's
// ─────────────────────────────────────────────────────────────────────────────

describe('personal state is personal', () => {
  it('does not let Alice’s dismissal reach Bob', () => {
    recordDisposition(ALICE, 'no_research', 'aapl', {
      kind: 'rejected',
      key: 'feed_dismissed',
      until: NOW + 30 * DAY_MS,
    })

    expect(loadDispositions(ALICE)[dispositionKey('no_research', 'aapl')]).toBeDefined()
    expect(loadDispositions(BOB)).toEqual({})
  })

  it('leaves the shared object itself untouched', () => {
    const shared = card()
    const before = JSON.stringify(shared)

    recordDisposition(ALICE, shared.type, dispositionEntityFor(shared), {
      kind: 'rejected', key: 'feed_dismissed', until: NOW + 30 * DAY_MS,
    })

    // The card is a projection of the investment object, and a disposition is
    // a fact about the reader. Nothing about the first may change.
    expect(JSON.stringify(shared)).toBe(before)
  })

  it('survives a reload', () => {
    recordDisposition(ALICE, 'no_research', 'aapl', {
      kind: 'settled', key: 'defer', until: NOW + 3 * DAY_MS,
    })

    // A reload is a fresh read of the store, with no in-memory state carried
    // over. Everything the feed needs has to come back out of it.
    const reloaded = loadDispositions(ALICE)[dispositionKey('no_research', 'aapl')]
    expect(reloaded).toBeDefined()
    expect(reloaded.key).toBe('defer')
    expect(reloaded.until).toBe(NOW + 3 * DAY_MS)
  })

  it('suppresses deterministically — same record, same clock, same answer', () => {
    const at = NOW
    const record = { key: 'feed_dismissed', at }

    // `feed_dismissed` is 30 days in `judgment-policy`. Inside the window it
    // hides; outside it, the issue is open again and only the penalty remains.
    expect(acknowledgmentFor(record, at + 29 * DAY_MS).suppressed).toBe(true)
    expect(acknowledgmentFor(record, at + 31 * DAY_MS).suppressed).toBe(false)
    expect(acknowledgmentFor(record, at + 31 * DAY_MS).penalty).toBeGreaterThan(0)

    // Same inputs, same output, every time. No clock of its own, no storage,
    // nothing session-dependent.
    for (let i = 0; i < 5; i++) {
      expect(acknowledgmentFor(record, at + 29 * DAY_MS)).toEqual(
        acknowledgmentFor(record, at + 29 * DAY_MS),
      )
    }
  })

  it('never claims a personal answer resolved a shared issue', () => {
    // The `Done` / `Answered` withdrawal. A reader clearing their own queue has
    // not completed anybody's deliverable.
    for (const key of ['reviewed', 'defer', 'in_progress', 'not_mine', 'feed_dismissed']) {
      expect(acknowledgmentFor({ key, at: NOW }, NOW).resolved, `${key} must not resolve`).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. The durable write carries no user identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The RLS proof lives in `supabase/tests/feed-disposition-ownership.sql`,
 * because cross-user isolation is a database property and asserting it in a
 * mock would only prove the mock. What is checked here is the half a mock CAN
 * prove and the database cannot: that the client never offers a user id in the
 * first place.
 *
 * That is the stronger half of the guarantee. `WITH CHECK (auth.uid() =
 * user_id)` rejects a forged id at the boundary; a call shape with nowhere to
 * put one cannot express the attempt.
 */
describe('the durable write', () => {
  it('sends no user id, and namespaces the key', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    vi.doMock('../../supabase', () => ({ supabase: { rpc } }))
    vi.resetModules()

    const { syncDisposition } = await import('../disposition-sync')
    const result = await syncDisposition({
      type: 'no_research',
      subject: 'aapl',
      kind: 'settled',
      key: 'defer',
      intent: 'attention',
      until: NOW + 3 * DAY_MS,
    })

    expect(result).toBe('written')
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('set_feed_disposition')
    // No p_user_id, and no field that could carry one.
    expect(Object.keys(args as object).some(k => /user/i.test(k))).toBe(false)
    expect((args as Record<string, unknown>).p_key).toBe('signal:no_research:aapl')
    expect((args as Record<string, unknown>).p_snoozed_until).toBeTruthy()
    expect((args as Record<string, unknown>).p_dismissed_until).toBeNull()

    vi.doUnmock('../../supabase')
    vi.resetModules()
  })

  it('reports failure rather than throwing, so triage is never blocked', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('offline'))
    vi.doMock('../../supabase', () => ({ supabase: { rpc } }))
    vi.resetModules()

    const { syncDisposition } = await import('../disposition-sync')
    await expect(syncDisposition({
      type: 'no_research', subject: 'aapl', kind: 'rejected',
      key: 'feed_dismissed', until: NOW + DISPOSITION_DAYS.rejected * DAY_MS,
    })).resolves.toBe('failed')

    vi.doUnmock('../../supabase')
    vi.resetModules()
  })
})
