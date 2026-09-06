/**
 * Shared workflow deferral — deliberately narrow.
 *
 * ── Why this file is mostly a refusal ─────────────────────────────────────
 *
 * "Defer" is shared-workflow language. It means the team's revisit date moved,
 * and everyone sees it. Exactly one object in this product has that concept:
 * `trade_queue_items.revisit_at`, already written by `useAttention`'s
 * `deferTradeIdeaMutation`.
 *
 * The bug being fixed is that the desktop menu offered "Defer" on everything,
 * and for everything else it quietly performed a personal localStorage snooze
 * instead. So the fix is not to build shared deferral for more object types —
 * that would be inventing workflow semantics the objects do not have. It is to
 * make the capability answerable BEFORE the control is drawn, so a surface can
 * decline to offer it.
 *
 * This mirrors D1's `canDiscuss`: ask first, and if a request arrives anyway,
 * fail visibly rather than substituting something else.
 */

import type { EngagementTarget } from '../engagement'
import type { SharedDeferCapability } from './types'

/**
 * Can this object's shared revisit date genuinely be moved?
 *
 * `trade_idea` is the object type the D1 seam produces for a trade queue item,
 * and `trade_queue_items.revisit_at` is the column that moves. Everything else
 * returns a reason, which a surface can show instead of a disabled control
 * with no explanation.
 */
export function sharedDeferCapability(target: EngagementTarget): SharedDeferCapability {
  if (target.objectType === 'trade_idea' && target.objectId) {
    return { supported: true, defer: { kind: 'trade_queue_item', targetId: target.objectId } }
  }

  return {
    supported: false,
    reason:
      `${target.label} has no shared revisit date to move. ` +
      'Deferring it would only change what you see, which is what "Snooze for me" does — ' +
      'and calling that "Defer" is what made the two indistinguishable before.',
  }
}

export function supportsSharedDefer(target: EngagementTarget): boolean {
  return sharedDeferCapability(target).supported
}
