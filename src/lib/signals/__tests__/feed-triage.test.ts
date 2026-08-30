import { beforeEach, describe, expect, it } from 'vitest'

import type { SignalCard } from '../contract'
import { dispositionEntityFor, dispositionKey, loadDispositions } from '../dispositions'
import {
  attentionCardId, attentionCardType, buildAttentionCard,
} from '../builders/legacy-kinds'
import { TRIAGE_JUDGMENT, recordTriage, triageQuietDays } from '../feed-triage'
import {
  acknowledgmentFor, policyForJudgment, quietHoursFor, quietMsFor,
} from '../judgment-policy'
import { DAY_MS } from '../thresholds'

/**
 * Snooze and Dismiss, and the one thing they must not become.
 *
 * Both controls have been on every card since the contract was written and
 * neither did anything: the dashboard passed `() => {}` at six of its seven
 * card call sites. The fix had to use the store the feed already reads, because
 * a second one would mean two rules disagreeing about how long a card stays
 * away — which is exactly the divergence this branch removed elsewhere.
 */

const USER = 'user-1'
const NOW = Date.UTC(2026, 7, 26)

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
    dedupeKey: 'no_research:aapl:2026-08-26',
    ...over,
  } as SignalCard
}

beforeEach(() => { localStorage.clear() })

describe('recordTriage', () => {
  it('writes into the disposition store the feed already reads', () => {
    expect(recordTriage(USER, card(), 'snooze', NOW)).toBe(true)
    const map = loadDispositions(USER)
    const d = map[dispositionKey('no_research', 'aapl')]
    expect(d).toBeDefined()
    expect(d.key).toBe('feed_snoozed')
    expect(d.cardType).toBe('no_research')
  })

  it('quiets for exactly as long as the button says', () => {
    // "Snooze for a week". A control whose label and behaviour disagree is
    // worse than one that does nothing, because the reader believes it.
    expect(triageQuietDays('snooze')).toBe(7)
    recordTriage(USER, card(), 'snooze', NOW)
    const d = loadDispositions(USER)[dispositionKey('no_research', 'aapl')]
    expect(d.until).toBe(NOW + 7 * DAY_MS)
  })

  it('dismisses for longer than it snoozes, and neither forever', () => {
    expect(triageQuietDays('dismiss')).toBeGreaterThan(triageQuietDays('snooze'))
    expect(triageQuietDays('dismiss')).toBeLessThan(365)
  })

  it('is suppressed by the ranking gate, which is the only gate', () => {
    /**
     * The load-bearing assertion. `priorityFor` reads a stored judgment through
     * `acknowledgmentFor`, and an unclassified key falls to `unknown` and
     * suppresses nothing — so a triage key that nobody classified would have
     * been written, read back, and silently ignored.
     */
    for (const action of ['snooze', 'dismiss'] as const) {
      const key = TRIAGE_JUDGMENT[action].key
      const policy = policyForJudgment(key)
      expect(policy.category, `${key} must be classified`).not.toBe('unknown')

      const ack = acknowledgmentFor({ key, kind: 'settled', at: NOW }, NOW + DAY_MS)
      expect(ack.suppressed, `${key} should hide the card while quiet`).toBe(true)
    }
  })

  it('lets the finding back once the quiet runs out', () => {
    // Triage is not a delete. The condition that produced the card is unchanged,
    // so it returns — demoted, because the reader has already seen it.
    const key = TRIAGE_JUDGMENT.dismiss.key
    const after = NOW + (triageQuietDays('dismiss') + 1) * DAY_MS
    const ack = acknowledgmentFor({ key, kind: 'settled', at: NOW }, after)
    expect(ack.suppressed).toBe(false)
    expect(ack.resolved).toBe(false)
    expect(ack.penalty).toBeGreaterThan(0)
  })

  it('resolves nothing — a cleared screen is not an answered question', () => {
    for (const action of ['snooze', 'dismiss'] as const) {
      expect(policyForJudgment(TRIAGE_JUDGMENT[action].key).resolves).toBe(false)
    }
  })
})

describe('dispositionEntityFor', () => {
  it('keys a machine finding on its entity, so the same claim recurring is the same claim', () => {
    expect(dispositionEntityFor(card())).toBe('aapl')
  })

  it('keys a post on the post, so one answer cannot silence a colleague', () => {
    /**
     * The over-suppression this prevents: two people post thoughts about AAPL,
     * the reader dismisses one, and keyed on the ticker the other disappears
     * too — a different person, a different argument, hidden by an answer that
     * was never about it.
     */
    const priya = card({ id: 'idea:quick_thought:p1', type: 'thought', surface: 'desk' })
    const marcus = card({ id: 'idea:quick_thought:m1', type: 'thought', surface: 'desk' })

    recordTriage(USER, priya, 'dismiss', NOW)
    const map = loadDispositions(USER)

    expect(map[dispositionKey('thought', dispositionEntityFor(priya))]).toBeDefined()
    expect(map[dispositionKey('thought', dispositionEntityFor(marcus))]).toBeUndefined()
  })
})

/**
 * Workflow identity, which had the post bug and did not have the post fix.
 *
 * `dispositionEntityFor` was stated in terms of `desk`, so workflow cards fell
 * through to the entity and two pending decisions on one name shared a key.
 * Answering either silenced both for thirty days — on a surface whose entire
 * promise is that answering a question is safe.
 */
describe('workflow card identity', () => {
  /** Two genuinely distinct queue items that happen to be about the same name. */
  const decision = card({
    id: attentionCardId('a1'),
    type: 'awaiting_review',
    surface: 'workflow',
    entity: { kind: 'asset', id: 'aapl', name: 'Apple', ticker: 'AAPL' },
  })
  const deliverable = card({
    id: attentionCardId('a2'),
    type: 'awaiting_review',
    surface: 'workflow',
    entity: { kind: 'asset', id: 'aapl', name: 'Apple', ticker: 'AAPL' },
  })

  it('does not let one AAPL workflow card suppress another', () => {
    recordTriage(USER, decision, 'dismiss', NOW)
    const map = loadDispositions(USER)

    expect(map[dispositionKey('awaiting_review', dispositionEntityFor(decision))]).toBeDefined()
    expect(map[dispositionKey('awaiting_review', dispositionEntityFor(deliverable))]).toBeUndefined()
  })

  it('keeps the same workflow card suppressed', () => {
    recordTriage(USER, decision, 'dismiss', NOW)
    const stored = loadDispositions(USER)[
      dispositionKey('awaiting_review', dispositionEntityFor(decision))
    ]

    expect(stored).toBeDefined()
    // Same card, same key: rebuilding the feed must find the answer again.
    // `attention_id` is a deterministic hash, so the id is stable across loads.
    const rebuilt = card({ ...decision })
    expect(dispositionEntityFor(rebuilt)).toBe(dispositionEntityFor(decision))

    const ack = acknowledgmentFor(
      { key: stored.key, kind: stored.kind, at: stored.at },
      NOW + DAY_MS,
    )
    expect(ack.suppressed).toBe(true)
  })

  it('keeps different assets independent', () => {
    const msft = card({
      id: attentionCardId('a3'),
      type: 'awaiting_review',
      surface: 'workflow',
      entity: { kind: 'asset', id: 'msft', name: 'Microsoft', ticker: 'MSFT' },
    })

    recordTriage(USER, decision, 'dismiss', NOW)
    const map = loadDispositions(USER)

    expect(map[dispositionKey('awaiting_review', dispositionEntityFor(msft))]).toBeUndefined()
  })

  it('keys a workflow item with no linked asset on the item, not on nothing', () => {
    /**
     * The second half of the defect: an attention item with no asset ranked
     * with `context.asset_id === undefined`, so the lookup returned null and
     * the answer was written somewhere nothing ever read.
     */
    const orphan = card({
      id: attentionCardId('a4'),
      type: 'project_overdue',
      surface: 'workflow',
      entity: { kind: 'project', id: 'a4', name: 'Q3 model refresh' },
    })

    recordTriage(USER, orphan, 'snooze', NOW)
    const key = dispositionEntityFor(orphan)

    expect(key).toBe(attentionCardId('a4'))
    expect(loadDispositions(USER)[dispositionKey('project_overdue', key)]).toBeDefined()
  })

  it('leaves asset-level machine findings keyed on the asset', () => {
    /**
     * The part that must NOT change. "AAPL has no thesis" is a claim about
     * AAPL, and tomorrow's identical card is the same claim — so the entity is
     * the correct subject and the fix must not sweep it up.
     */
    const finding = card()          // surface: 'research', entity aapl
    const market = card({ id: 'news:1', type: 'news', surface: 'market' })
    const risk = card({ id: 'crowded-aapl', type: 'crowding', surface: 'risk' })

    for (const c of [finding, market, risk]) {
      expect(dispositionEntityFor(c)).toBe('aapl')
    }

    recordTriage(USER, finding, 'dismiss', NOW)
    // Same entity, same type, a new day key: the recurrence is still suppressed.
    const tomorrow = card({ dedupeKey: 'no_research:aapl:2026-08-27' })
    expect(
      loadDispositions(USER)[dispositionKey('no_research', dispositionEntityFor(tomorrow))],
    ).toBeDefined()
  })
})

/**
 * The two halves of a disposition key are computed in two places — the builder
 * makes the card, the ranker looks the answer up before the card exists — and
 * they must produce the same string or every answer silently fails to suppress.
 * That is what went wrong here, so it is pinned rather than trusted.
 */
describe('attention card vocabulary', () => {
  it('agrees with the card the builder actually emits', () => {
    const built = buildAttentionCard(
      {
        attention_id: 'a1',
        attention_type: 'decision_required',
        title: 'Approve the AAPL add',
        reason_text: 'A decision is waiting on you.',
      },
      { id: 'aapl', symbol: 'AAPL', companyName: 'Apple' },
    )

    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.card.id).toBe(attentionCardId('a1'))
    expect(built.card.type).toBe(attentionCardType('decision_required'))
    // The identity rule and the card agree, which is the whole invariant.
    expect(dispositionEntityFor(built.card)).toBe(attentionCardId('a1'))
  })

  it('falls back rather than inventing a type', () => {
    expect(attentionCardType('something_new')).toBe('awaiting_review')
  })
})

/**
 * One clock over one user intent.
 *
 * Every durable write of a quiet window used to be a hardcoded number at a call
 * site, and each disagreed with the policy the feed enforces. The worst was
 * `not_mine`: 180 days here, `snoozeFor(id, 24 * 7)` there, so the same tap
 * bought half a year of quiet or a week depending on which surface you opened
 * next.
 */
describe('one policy clock', () => {
  it('gives not_mine 180 days, and gives both stores the same number', () => {
    expect(policyForJudgment('not_mine').quietDays).toBe(180)
    expect(quietHoursFor('not_mine')).toBe(180 * 24)
    expect(quietMsFor('not_mine')).toBe(180 * DAY_MS)
    // The durable hours and the local milliseconds are the same window.
    expect(quietHoursFor('not_mine') * 3600_000).toBe(quietMsFor('not_mine'))
  })

  it('derives the triage windows from the same table the buttons promise', () => {
    expect(quietHoursFor(TRIAGE_JUDGMENT.snooze.key)).toBe(7 * 24)
    expect(quietHoursFor(TRIAGE_JUDGMENT.dismiss.key)).toBe(30 * 24)
  })

  it('returns zero for an unclassified key rather than inventing a window', () => {
    // A zero-length snooze must not be sent: an action that does nothing is
    // worse than one that admits it cannot.
    expect(quietHoursFor('never_classified')).toBe(0)
    expect(quietMsFor(null)).toBe(0)
  })

  it('agrees with the window acknowledgmentFor actually enforces', () => {
    for (const key of ['not_mine', 'reviewed', 'defer', 'feed_snoozed', 'feed_dismissed']) {
      const ms = quietMsFor(key)
      expect(acknowledgmentFor({ key, at: NOW }, NOW + ms - 1).suppressed).toBe(true)
      expect(acknowledgmentFor({ key, at: NOW }, NOW + ms + 1).suppressed).toBe(false)
    }
  })
})

/**
 * "Done" claimed a shared resolution that no tap on this surface performs.
 */
describe('personal acknowledgement is not a resolution', () => {
  it('resolves nothing, on the new key or the retained old ones', () => {
    for (const key of ['reviewed', 'answered', 'done']) {
      expect(policyForJudgment(key).resolves, `${key} must not claim resolution`).toBe(false)
    }
  })

  it('still buys quiet, so reviewing is worth doing', () => {
    expect(policyForJudgment('reviewed').quietDays).toBe(30)
    expect(acknowledgmentFor({ key: 'reviewed', at: NOW }, NOW + DAY_MS).suppressed).toBe(true)
  })

  it('does not offer a completion verb without the capability to complete', () => {
    const a = {
      attention_id: 'a9',
      attention_type: 'action_required' as const,
      title: 'Finish the Q3 deliverable',
      reason_text: 'An action is waiting on you.',
    }

    // No `can`: the surface cannot mutate the shared object, so it must not
    // say Done, Complete or Resolve.
    const without = buildAttentionCard(a)
    expect(without.ok).toBe(true)
    if (!without.ok) return
    expect(without.card.actions.primary.label).toBe('Review')
    expect(without.card.actions.primary.id).not.toBe('resolve')

    // With the capability, the true shared resolution is offered and named.
    const withCan = buildAttentionCard(a, null, { markDone: true })
    expect(withCan.ok).toBe(true)
    if (!withCan.ok) return
    expect(withCan.card.actions.primary.id).toBe('mark_done')
    expect(withCan.card.actions.primary.label).toBe('Mark done')
  })
})
