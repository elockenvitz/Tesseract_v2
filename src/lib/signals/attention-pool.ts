import type { AttentionItem, AttentionResponse } from '../../types/attention'

/**
 * Which attention rows a feed may draw on, in priority order.
 *
 * ── Why this is a module and not three lines in a shell ───────────────────
 *
 * It was three lines in `MobileDashboard`, and desktop had none -- so the
 * Workflow category, which is `attentionToExplore`'s entire output, could not
 * appear on a desktop Explore field at all. Wiring desktop up meant either
 * importing from a 7000-line component or copying the rule, and a copied
 * selection rule is how two surfaces come to disagree about which work is
 * still outstanding.
 *
 * ── The two decisions it carries ──────────────────────────────────────────
 *
 * ORDER. All four sections, not only the two urgent ones. Restricting the
 * pool to decisions and actions left long stretches of the feed with nothing
 * to act on, and the sections are concatenated most-urgent-first so a
 * consumer that truncates keeps the right half. Ranking still reorders them
 * afterwards; this only decides what is eligible.
 *
 * STATUS. A resolved or dismissed row is finished work. It is dropped here
 * rather than in each consumer, because a surface that forgot the filter
 * would be asking the reader to do something they have already done -- which
 * is worse than showing nothing.
 */
export function attentionPool(
  sections: AttentionResponse['sections'] | null | undefined,
): AttentionItem[] {
  const byPriority = [
    ...(sections?.decision_required ?? []),
    ...(sections?.action_required ?? []),
    ...(sections?.alignment ?? []),
    ...(sections?.informational ?? []),
  ]
  return byPriority.filter(a => a.status !== 'resolved' && a.status !== 'dismissed')
}

/**
 * The attention rows that are WORK, as opposed to a trade awaiting a decision.
 *
 * ── Why desktop takes only this half ──────────────────────────────────────
 *
 * A `trade_queue_item` becomes a `recommendation` card, and desktop already
 * builds those itself: `useDesktopAttentionFeed` runs its own decision scan
 * through `buildRecommendationCard`. Admitting the attention copy as well
 * would put the same proposal on the field twice, from two producers, with
 * two ids -- which `dedupeExplore` cannot collapse because they are genuinely
 * different rows.
 *
 * It also avoids a second problem desktop has no data for. Mobile drops all
 * but the highest-priority leg of a pair trade, using a `pairKeyBySource` map
 * from a query desktop does not make; without it both legs of one decision
 * would render as two tiles. Excluding trade rows removes the need for that
 * query rather than shipping the duplication.
 *
 * Everything else -- projects, deliverables, coverage changes, reviews
 * awaiting someone -- is work with a deadline, which is exactly what the
 * Workflow category is for and what no desktop producer was emitting.
 */
export function workAttention(items: AttentionItem[]): AttentionItem[] {
  return items.filter(a => a.source_type !== 'trade_queue_item')
}
