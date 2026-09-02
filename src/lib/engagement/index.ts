/**
 * The engagement seam.
 *
 * One shared mechanism for "act on / ask AI about / discuss" a surfaced
 * investment object, with the object and the triggering issue already bound.
 *
 * Stage D1 is infrastructure only. It carries context into the EXISTING AI
 * panel and the EXISTING messages threads; it introduces no second AI system,
 * no second messaging system, and no schema change. AI analyses and proposes
 * in this stage — it does not mutate.
 */

export type {
  EngagementObjectType,
  EngagementMode,
  EngagementIssue,
  EngagementContextChip,
  EngagementTarget,
  EngagementRequest,
  EngagementResult,
  EngagementRefusal,
  EngagementLimitation,
} from './types'
export { ENGAGEMENT_OBJECT_TYPES, isEngagementObjectType } from './types'

export { engagementAffordances } from './affordances'
export type { EngagementAffordances } from './affordances'

export {
  toAITags,
  toThreadKey,
  canDiscuss,
  describeTarget,
  contextChipsFor,
  toPaneContext,
  targetMatchesContext,
  fromDecisionContext,
  DISCUSSABLE_OBJECT_TYPES,
} from './target'
export type { ThreadKey, DiscussableObjectType, PaneContext } from './target'

export {
  openEngagement,
  askAI,
  discuss,
  subscribeToEngagement,
  ENGAGEMENT_EVENT,
} from './open-engagement'

export {
  registerPrimaryAction,
  resolvePrimaryAction,
  registeredPrimaryActionKeys,
  __clearPrimaryActions,
} from './primary-action'
export type { PrimaryAction, PrimaryActionFactory } from './primary-action'
