/**
 * Focused tests for durable attention state.
 *
 * Scope: the key namespace, suppression/expiry semantics, and the
 * personal-vs-shared boundary. All pure — no network, no React, no mobile.
 */

import { describe, it, expect } from 'vitest'
import type { EngagementTarget } from '../engagement'
import {
  toAttentionKey,
  feedItemAttentionKey,
  sourceOfFeedItemId,
  DECISION_NAMESPACE,
} from './keys'
import {
  suppressionFor,
  isSuppressed,
  suppressedKeys,
  snoozeUntilISO,
  isDismissPermanent,
  SNOOZE_PRESETS,
} from './suppression'
import { sharedDeferCapability, supportsSharedDefer } from './shared-defer'
import { DISMISS_REASONS } from './types'
import type { PersonalAttentionRow } from './types'

const T0 = Date.parse('2026-08-30T12:00:00.000Z')
const row = (over: Partial<PersonalAttentionRow> = {}): PersonalAttentionRow => ({
  attention_id: 'k', snoozed_until: null, dismissed_at: null, dismiss_reason: null, ...over,
})

describe('attention keys', () => {
  it('leaves a native attention id unnamespaced so both surfaces write one row', () => {
    // Load-bearing: the attention dashboard already calls
    // snooze_attention(<attention_id>). Namespacing would split one user's
    // judgment across two rows.
    expect(toAttentionKey('attention', 'a1b2c3')).toBe('a1b2c3')
  })

  it('namespaces synthetic decision-engine ids', () => {
    expect(toAttentionKey('decision', 'a2-execution-77')).toBe('decision:a2-execution-77')
  })

  it('is idempotent, so re-keying an already-namespaced id cannot double it', () => {
    const once = toAttentionKey('decision', 'x')!
    expect(toAttentionKey('decision', once)).toBe(once)
  })

  it('refuses an empty id rather than collapsing items onto one shared row', () => {
    expect(toAttentionKey('decision', '')).toBeNull()
    expect(toAttentionKey('decision', '   ')).toBeNull()
    expect(toAttentionKey('attention', '')).toBeNull()
  })

  it('classifies feed ids by the adapter prefix', () => {
    expect(sourceOfFeedItemId('attn-abc')).toBe('attention')
    expect(sourceOfFeedItemId('a2-execution-77')).toBe('decision')
  })

  it('strips the adapter prefix so the key matches what attention surfaces write', () => {
    expect(feedItemAttentionKey('attn-a1b2c3')).toBe('a1b2c3')
    expect(feedItemAttentionKey('a2-execution-77')).toBe(`${DECISION_NAMESPACE}a2-execution-77`)
  })

  it('keys carry no date, so the same claim tomorrow is the same key', () => {
    // The failure mobile documented: a time-varying key means the user answers
    // the same question every morning and the disposition never sticks.
    expect(feedItemAttentionKey('a4-deliverable-99')).toBe(feedItemAttentionKey('a4-deliverable-99'))
    expect(feedItemAttentionKey('a4-deliverable-99')).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('suppression', () => {
  it('reports nothing suppressed with no row', () => {
    expect(suppressionFor(undefined, T0)).toEqual({ suppressed: false })
  })

  it('hides a dismissed item and says why', () => {
    const r = row({ dismissed_at: '2026-08-29T09:00:00.000Z' })
    expect(suppressionFor(r, T0)).toEqual({
      suppressed: true, by: 'dismiss', since: '2026-08-29T09:00:00.000Z',
    })
  })

  it('hides a live snooze and says until when', () => {
    const until = new Date(T0 + 3_600_000).toISOString()
    expect(suppressionFor(row({ snoozed_until: until }), T0)).toEqual({
      suppressed: true, by: 'snooze', until,
    })
  })

  it('resurfaces on snooze expiry with no job and no cleanup', () => {
    const until = new Date(T0 - 1_000).toISOString()
    expect(isSuppressed(row({ snoozed_until: until }), T0)).toBe(false)
  })

  it('treats the expiry boundary as expired', () => {
    expect(isSuppressed(row({ snoozed_until: new Date(T0).toISOString() }), T0)).toBe(false)
  })

  it('reports dismissal over snooze when a row carries both', () => {
    const r = row({ dismissed_at: '2026-08-01T00:00:00.000Z', snoozed_until: new Date(T0 + 1e6).toISOString() })
    expect(suppressionFor(r, T0).suppressed && suppressionFor(r, T0)).toMatchObject({ by: 'dismiss' })
  })

  it('fails open on an unparseable timestamp rather than hiding forever', () => {
    expect(isSuppressed(row({ snoozed_until: 'not-a-date' }), T0)).toBe(false)
  })

  it('projects a row set to the currently-suppressed keys', () => {
    const keys = suppressedKeys([
      row({ attention_id: 'dismissed', dismissed_at: '2026-08-01T00:00:00.000Z' }),
      row({ attention_id: 'live-snooze', snoozed_until: new Date(T0 + 1e6).toISOString() }),
      row({ attention_id: 'expired', snoozed_until: new Date(T0 - 1e6).toISOString() }),
      row({ attention_id: 'untouched' }),
    ], T0)
    expect([...keys].sort()).toEqual(['dismissed', 'live-snooze'])
  })

  it('computes snooze expiry from the presets', () => {
    expect(snoozeUntilISO(24, T0)).toBe(new Date(T0 + 86_400_000).toISOString())
    expect(SNOOZE_PRESETS.map(p => p.hours)).toEqual([24, 72, 168])
  })

  it('states the conservative dismissal boundary rather than implying decay', () => {
    // D2 does not implement a material-change fingerprint; this names it.
    expect(isDismissPermanent()).toBe(true)
  })
})

describe('personal vs shared', () => {
  const tradeIdea: EngagementTarget = {
    objectType: 'trade_idea', objectId: 'tq-1', label: 'Sell CLOV',
  }
  const asset: EngagementTarget = {
    objectType: 'asset', objectId: 'a-amzn', label: 'AMZN', symbol: 'AMZN',
  }

  it('supports shared defer only where a real revisit date exists', () => {
    expect(supportsSharedDefer(tradeIdea)).toBe(true)
    const cap = sharedDeferCapability(tradeIdea)
    expect(cap).toMatchObject({ supported: true, defer: { kind: 'trade_queue_item', targetId: 'tq-1' } })
  })

  it.each([
    ['asset', asset],
    ['portfolio', { objectType: 'portfolio', objectId: 'p1', label: 'Growth' } as EngagementTarget],
    ['research_note', { objectType: 'research_note', objectId: 'n1', label: 'Note' } as EngagementTarget],
  ])('refuses shared defer for %s, and explains why', (_label, target) => {
    const cap = sharedDeferCapability(target)
    expect(cap.supported).toBe(false)
    expect(cap.supported === false && cap.reason).toMatch(/no shared revisit date/)
  })

  it('never presents a personal snooze as a shared defer', () => {
    // The exact conflation being fixed: one label, two meanings.
    const cap = sharedDeferCapability(asset)
    expect(cap.supported === false && cap.reason).toMatch(/Snooze for me/)
  })

  it('constrains dismiss reasons to what the database CHECK allows', () => {
    expect([...DISMISS_REASONS]).toEqual([
      'duplicate', 'incorrect_signal', 'not_my_responsibility', 'no_longer_relevant',
    ])
  })
})
