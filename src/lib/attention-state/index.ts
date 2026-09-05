/**
 * Durable personal attention state, and the narrow shared-defer capability.
 *
 * Personal dispositions live in `attention_user_state` via the seven
 * SECURITY DEFINER RPCs that already exist in production. Shared deferral
 * exists only where an object genuinely has a revisit date.
 */

export type {
  PersonalDisposition,
  DismissReason,
  SharedDefer,
  SharedDeferCapability,
  PersonalAttentionRow,
  SuppressionReason,
} from './types'
export { DISMISS_REASONS } from './types'

export {
  toAttentionKey,
  feedItemAttentionKey,
  sourceOfFeedItemId,
  DECISION_NAMESPACE,
  ATTENTION_ITEM_PREFIX,
} from './keys'
export type { AttentionKeySource } from './keys'

export {
  suppressionFor,
  isSuppressed,
  suppressedKeys,
  snoozeUntilISO,
  isDismissPermanent,
  SNOOZE_PRESETS,
  DISMISS_RESURFACE_NOTE,
  SNOOZE_RESURFACE_NOTE,
} from './suppression'

export { sharedDeferCapability, supportsSharedDefer } from './shared-defer'
