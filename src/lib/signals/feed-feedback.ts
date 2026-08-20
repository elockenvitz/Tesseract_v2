import type { SignalCard } from './contract'

/**
 * What the reader thinks about the FEED, as opposed to about the investment.
 *
 * ── Why this is a separate module, a separate vocabulary and a separate table ─
 *
 * These are two feedback loops that happen to be collected on the same card,
 * and they were sharing a control. "Cases outdated" and "don't show me this"
 * sat side by side in one row, mapped to the same three generic states, and
 * landed in the same durable store.
 *
 * That costs both. An analyst answering a question about a position should not
 * be choosing between a view and a complaint; and anyone reading the research
 * record back has to filter out product feedback before counting anything.
 *
 * So: investment judgment goes to `audit_events` through `judgment-log.ts` and
 * is research history. Feed feedback goes to `pilot_telemetry_events` through
 * `feed-feedback-log.ts` and is product-quality data. Neither can pollute the
 * other.
 *
 * ── Why the WRITE lives in a separate file ────────────────────────────────
 *
 * This module is pure: types and one predicate over a card. The write is in
 * `feed-feedback-log.ts` because it reaches Supabase, and `SignalCardView`
 * needs `feedbackOptionsFor` to decide which menu items to render.
 *
 * That is not tidiness. The card gallery is a standalone Vite entry with no
 * Supabase env, and `supabase.ts` throws at module load without it — so a
 * component importing anything that transitively reaches it takes the whole
 * gallery down, React never mounts, and all 130 layout assertions fail at once
 * with no test naming the cause. That happened here. Same split, same reason,
 * as `dispositions.ts` versus `judgment-log.ts`.
 *
 * ── Why `pilot_telemetry_events` ──────────────────────────────────────────
 *
 * It is the existing primitive for "a user did something worth measuring":
 * `user_id`, `organization_id`, `event_type`, a jsonb `metadata`, and an INSERT
 * policy of `user_id = auth.uid()`. It needs no migration and no new table.
 *
 * `audit_events` was the wrong home even though it is right there. It carries a
 * checksum, a retention policy and an entity timeline because it exists to be
 * an immutable record of decisions about entities. "I didn't find this card
 * useful" is not a decision about an asset, and putting it there would make the
 * investment audit trail noisier for every future reader of it.
 */

/**
 * The feed-feedback vocabulary.
 *
 * Deliberately prefixed, and deliberately not overlapping the judgment keys or
 * `FeedActionKey`. `feed_not_useful` and `not_price_driven` must never be
 * confusable by anything reading them back, which is the entire point of the
 * separation.
 */
export type FeedFeedbackKey =
  /** This card was not worth showing me. */
  | 'feed_not_useful'
  /** This was routed to the wrong person — I am not who should see it. */
  | 'feed_wrong_person'

export interface FeedFeedbackOption {
  key: FeedFeedbackKey
  label: string
  /**
   * Whether choosing it should also remove the card from this reader's feed.
   *
   * Recorded feedback and immediate card handling are two EFFECTS, declared
   * separately. Phase 3's defect was a compatibility state silently driving
   * unrelated behaviour; collapsing "tell the product this was useless" into
   * "hide it" would be the same mistake in a new place. A reader can find a
   * card unhelpful without wanting that signal suppressed, and the menu should
   * be able to express both.
   */
  dismisses: boolean
}

/**
 * What each card offers, which is not the same for every kind.
 *
 * `feed_wrong_person` only appears where routing is a real possibility — a
 * workflow item addressed to somebody, or a research gap on a name somebody
 * else covers. It is meaningless on a market move, which was routed to nobody.
 */
export function feedbackOptionsFor(card: SignalCard): FeedFeedbackOption[] {
  const base: FeedFeedbackOption[] = [
    { key: 'feed_not_useful', label: 'Not useful', dismisses: true },
  ]
  const routed = card.surface === 'workflow'
    || card.type === 'no_research'
    || card.type === 'research_stale'
    || card.type === 'no_target'
  if (routed) {
    base.push({ key: 'feed_wrong_person', label: 'Wrong person', dismisses: true })
  }
  return base
}

/**
 * NOT SHIPPED, and the reason is worth keeping.
 *
 * "Show fewer like this" and "Mute this signal" both promise influence over
 * what the feed shows next, and nothing consumes that yet — ranking is a later
 * phase and this one is explicitly forbidden from touching it. A control
 * labelled "show fewer" that changes nothing is the dead-end button this
 * project has been removing for six phases.
 *
 * Both become one option each in `feedbackOptionsFor` the day ranking can read
 * this table. The vocabulary is deliberately open for it.
 */
export const DEFERRED_FEEDBACK = ['feed_show_fewer', 'feed_mute_signal'] as const
