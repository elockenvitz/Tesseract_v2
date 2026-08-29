import { describe, it, expect, beforeEach } from 'vitest'
import { buildAttentionCard, buildIdeasSignalCard, type AttentionLike, type IdeasSignal } from '../legacy-kinds'
import type { CardResult, SignalCard } from '../../contract'

/**
 * Two claims a card makes that nothing else was checking.
 *
 * The first is that its primary button does something. `feedActionIsRoutable`
 * is the guard for that, and it has a hole: `resolve` is in `SURFACE_HANDLED`,
 * so the guard reads it as a promise the card surface will keep. The mobile
 * feed did not keep it — every non-recommendation attention card rendered
 * through `renderCard`, whose `onPrimary` was hard-coded to a no-op — so the
 * largest, darkest control on those cards said "Resolve" and was inert.
 *
 * The second is that a card is not a second, blunter copy of a card the feed
 * already carries. `stale_coverage` and `useDerivedInsights`' `stale_research`
 * both emit `research_stale`, and the first still applies the silence-alone
 * rule the second deliberately abandoned.
 */

const card = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`expected a card, got: ${r.reason} (${r.detail})`)
  return r.card
}
const reason = (r: CardResult): string => {
  if (r.ok) throw new Error('expected suppression, got a card')
  return r.reason
}

beforeEach(() => localStorage.clear())

const ASSET = { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' }

const attention = (over: Partial<AttentionLike> = {}): AttentionLike => ({
  attention_id: 'at1',
  attention_type: 'decision_required',
  title: 'Approve the MSFT trim',
  subtitle: 'The PM has not answered this',
  created_at: '2026-08-20T09:00:00.000Z',
  context: { asset_id: 'a1' },
  ...over,
})

describe('attention card primary', () => {
  /**
   * The mobile feed calls `buildAttentionCard(a, asset)` with no `can`, which
   * is the shape this asserts. A capability the caller cannot honour must not
   * appear, and the fallback must not be a verb the caller cannot perform
   * either — which is what "Resolve" was.
   */
  it('names what the surface can do when it is given no capabilities', () => {
    const c = card(buildAttentionCard(attention(), ASSET))
    expect(c.actions.primary.id).toBe('open_item')
    expect(c.actions.primary.label).toBe('Open MSFT')
  })

  it('falls back to a generic open when the item is about nothing in the book', () => {
    const c = card(buildAttentionCard(
      attention({ attention_type: 'action_required', context: null }), null,
    ))
    expect(c.actions.primary.id).toBe('open_item')
    expect(c.actions.primary.label).toBe('Open item')
  })

  it('never offers Resolve, which no caller of this builder implements', () => {
    for (const t of ['decision_required', 'action_required', 'alignment', 'informational'] as const) {
      const c = card(buildAttentionCard(attention({ attention_type: t }), ASSET))
      expect(c.actions.primary.id, t).not.toBe('resolve')
    }
  })

  it('still offers the real verbs to a caller that declares it can perform them', () => {
    // The fallback changed; the capability path did not. A surface that CAN
    // approve still gets Approve, which is the whole reason `can` is a
    // parameter rather than an assumption.
    expect(card(buildAttentionCard(attention(), ASSET, { approve: true })).actions.primary.id)
      .toBe('approve')
    expect(card(buildAttentionCard(
      attention({ attention_type: 'action_required' }), ASSET, { markDone: true },
    )).actions.primary.id).toBe('mark_done')
  })
})

const signal = (over: Partial<IdeasSignal> = {}): IdeasSignal => ({
  id: 's1',
  signalType: 'attention_cluster',
  headline: 'Three analysts have written on MSFT this week',
  body: 'Priya, Sam and Ade have all posted on the name since Monday.',
  relatedAssets: [{ id: 'a1', symbol: 'MSFT' }],
  createdAt: '2026-08-27T09:00:00.000Z',
  priority: 0.6,
  ...over,
})

describe('ideas signal cards', () => {
  it('suppresses stale coverage, which the derived-insight path supersedes', () => {
    /**
     * Two independent reasons, either of which is sufficient.
     *
     * `generateStaleCoverageSignals` fires on `days >= 30` alone — the rule
     * `useDerivedInsights` deliberately replaced with "silence PLUS a reason" —
     * and both emit `research_stale`, with no dedupe between the signal and
     * insight entry kinds. And it stamps `createdAt: new Date()`, so the
     * eyebrow reads "just now" directly above a metric reading "30+ days
     * silent".
     */
    expect(reason(buildIdeasSignalCard(signal({ signalType: 'stale_coverage' }))))
      .toBe('resolved')
  })

  it('keeps the two signals that state something true as of now', () => {
    // `attention_cluster` and `conflict` are computed from this week's activity,
    // so "just now" is honest for them, and neither has a competing producer.
    expect(card(buildIdeasSignalCard(signal({ signalType: 'attention_cluster' }))).type)
      .toBe('team_focus')
    expect(card(buildIdeasSignalCard(signal({ signalType: 'conflict' }))).type)
      .toBe('thesis_conflict')
  })

  it('still suppresses canned prompts', () => {
    expect(reason(buildIdeasSignalCard(signal({ signalType: 'prompt' })))).toBe('content_quality')
  })
})
