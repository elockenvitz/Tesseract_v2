import { beforeEach, describe, expect, it, vi } from 'vitest'

type LogInput = Parameters<typeof import('../../pilot/pilot-telemetry').logPilotEvent>[0]
const logPilotEvent = vi.fn((_i: LogInput) => {})
vi.mock('../../pilot/pilot-telemetry', () => ({ logPilotEvent: (i: LogInput) => logPilotEvent(i) }))

const { recordFeedFeedback } = await import('../feed-feedback-log')
const { feedbackOptionsFor, DEFERRED_FEEDBACK } = await import('../feed-feedback')
import type { SignalCard } from '../contract'

/**
 * The separation, asserted from the persistence side.
 *
 * Investment judgment is research history and lives in `audit_events`. Feed
 * feedback is product-quality data and lives in `pilot_telemetry_events`. The
 * tests that matter are the ones proving neither can contaminate the other.
 */

function card(over: Partial<SignalCard> = {}): SignalCard {
  return {
    id: 'c1', type: 'news', surface: 'market', severity: 'informational',
    headline: 'h', metric: null, body: 'b',
    entity: { kind: 'asset', id: 'a-1', name: 'Apple', ticker: 'AAPL' },
    context: [], actions: {
      primary: { id: 'capture', label: 'Capture', inline: true }, quick: [], menu: [],
      open: { label: 'Open', href: '/asset/a-1' },
    },
    provenance: { occurredAt: new Date().toISOString(), reason: 'r' },
    expiry: { staleAfterDays: 3 }, dedupeKey: 'k',
    ...over,
  } as SignalCard
}

beforeEach(() => logPilotEvent.mockClear())

describe('feed feedback', () => {
  it('writes product telemetry, never an investment audit row', () => {
    // The whole point of the split. If this ever reached audit_events, every
    // future reader of the research record would have to filter out complaints
    // about the surface before counting anything.
    recordFeedFeedback({
      orgId: 'org1', card: card(),
      option: { key: 'feed_not_useful', label: 'Not useful', dismisses: true },
    })
    const arg = logPilotEvent.mock.calls[0][0]
    expect(arg.eventType).toBe('feed_feedback')
    const md = arg.metadata as Record<string, unknown>
    expect(md.feedback_key).toBe('feed_not_useful')
    // Enough context for a future false-positive or ranking analysis.
    expect(md.signal_type).toBe('news')
    expect(md.entity_id).toBe('a-1')
  })

  it('keeps its vocabulary distinct from investment judgment keys', () => {
    // `feed_not_useful` must never be confusable with `not_price_driven`.
    const opts = feedbackOptionsFor(card())
    for (const o of opts) expect(o.key.startsWith('feed_')).toBe(true)
  })

  it('offers "wrong person" only where routing is a real possibility', () => {
    // Meaningless on a market move, which was routed to nobody.
    expect(feedbackOptionsFor(card({ type: 'news', surface: 'market' })).map(o => o.key))
      .toEqual(['feed_not_useful'])
    // Real on a research gap or a workflow item addressed to someone.
    expect(feedbackOptionsFor(card({ type: 'no_research', surface: 'research' })).map(o => o.key))
      .toContain('feed_wrong_person')
    expect(feedbackOptionsFor(card({ type: 'project_overdue', surface: 'workflow' })).map(o => o.key))
      .toContain('feed_wrong_person')
  })

  it('does not ship a control whose promise nothing consumes', () => {
    // "Show fewer like this" and "Mute this signal" both promise influence over
    // future ranking, and ranking is a later phase. A control labelled
    // "show fewer" that changes nothing is the dead-end button this project has
    // been removing since Phase 4.
    const offered = feedbackOptionsFor(card({ type: 'no_research', surface: 'research' })).map(o => o.key)
    for (const deferred of DEFERRED_FEEDBACK) {
      expect(offered).not.toContain(deferred)
    }
  })

  it('returns synchronously, so a dismissal never waits on the network', () => {
    /**
     * Failure safety is `logPilotEvent`'s: it wraps the whole write in a
     * detached async IIFE with a swallowing catch, so nothing propagates. What
     * this asserts is the property THIS wrapper is responsible for — that it
     * adds no await, so the card disappears the moment the reader asks rather
     * than after a round trip.
     *
     * An earlier version of this test claimed "never throws" and then asserted
     * that it does. The wrapper is a thin delegate; if the primitive threw, so
     * would this. The primitive does not, and that is where the guarantee
     * belongs.
     */
    const r = recordFeedFeedback({
      orgId: null, card: card(),
      option: { key: 'feed_not_useful', label: 'Not useful', dismisses: true },
    })
    expect(r).toBeUndefined()
    expect(logPilotEvent).toHaveBeenCalledTimes(1)
  })

  it('declares dismissal as its own effect rather than inferring it', () => {
    // Recorded feedback and card handling are two effects. Phase 3's defect was
    // a compatibility state silently driving unrelated behaviour; collapsing
    // "this was useless" into "hide it" would be the same mistake relocated.
    for (const o of feedbackOptionsFor(card({ type: 'no_research', surface: 'research' }))) {
      expect(typeof o.dismisses).toBe('boolean')
    }
  })
})
