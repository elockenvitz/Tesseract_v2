import { beforeEach, describe, expect, it } from 'vitest'

import type { SignalCard } from '../contract'
import { dispositionEntityFor, dispositionKey, loadDispositions } from '../dispositions'
import { TRIAGE_JUDGMENT, recordTriage, triageQuietDays } from '../feed-triage'
import { acknowledgmentFor, policyForJudgment } from '../judgment-policy'
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
/**
 * The clock, not a date.
 *
 * This was `Date.UTC(2026, 7, 26)`, and `loadDispositions` prunes anything
 * whose `until` has passed against the REAL clock — so a snooze written seven
 * days after a hard-coded August date expired at 2026-09-02T00:00Z and every
 * assertion that reads the store back began failing four minutes later. A
 * fixture that is only valid until a particular morning is a test that reports
 * the calendar rather than the code.
 */
const NOW = Date.now()

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
