import { logPilotEvent } from '../pilot/pilot-telemetry'
import type { SignalCard } from './contract'
import type { FeedFeedbackOption } from './feed-feedback'

/**
 * The write half of feed feedback.
 *
 * Split from `feed-feedback.ts` because this reaches Supabase and the card
 * component does not — see that file's header for why that matters more than it
 * looks.
 */

export interface FeedFeedbackInput {
  card: SignalCard
  option: FeedFeedbackOption
  orgId: string | null
  /** The question the card was asking, for context. */
  prompt?: string
}

/**
 * Record it, through the telemetry primitive that already exists.
 *
 * `logPilotEvent` reads the session itself, writes to
 * `pilot_telemetry_events`, and is deliberately fire-and-forget with all errors
 * swallowed. Reusing it rather than hand-rolling a second insert is the point:
 * it is the same taxonomy, the same table and the same failure discipline that
 * every other product-quality event in this app already uses.
 *
 * Void, and that is correct HERE in a way it would not be for a judgment.
 * A judgment reports success because the reader is told their answer landed and
 * the feed will act on it. Feed feedback has no such promise to keep — the card
 * goes away because the caller dismissed it, not because telemetry replied — so
 * surfacing a telemetry failure would be noise about a system the reader is not
 * responsible for.
 */
export function recordFeedFeedback(input: FeedFeedbackInput): void {
  const { card, option, orgId, prompt } = input
  logPilotEvent({
    eventType: 'feed_feedback',
    organizationId: orgId,
    metadata: {
      feedback_key: option.key,
      feedback_label: option.label,
      // Everything a future ranking or false-positive analysis needs to group
      // by: which signal, on what kind of thing, asking what.
      signal_type: card.type,
      card_surface: card.surface,
      entity_kind: card.entity.kind,
      entity_id: card.entity.id,
      asset_symbol: card.entity.ticker ?? null,
      prompt: prompt ?? card.prompt ?? null,
      dismissed: option.dismisses,
    },
  })
}
