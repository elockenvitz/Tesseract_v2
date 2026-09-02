/**
 * The engagement seam — what a surface is allowed to offer.
 *
 * ── The duplication this exists to delete ─────────────────────────────────
 *
 * Six surfaces — AssetWorkspace, AssetTab, IdeaDetail, ResearchDetail,
 * PositionDetail, DecisionDetail — each wrote some spelling of:
 *
 *   const teamable = !!target && canDiscuss(target)
 *   ...
 *   <button onClick={() => askAI(target!)}>Ask AI</button>
 *   {teamable && <button onClick={() => discuss(target!)}>Team</button>}
 *
 * Three separate mistakes were available at every one of those call sites: to
 * forget the `canDiscuss` guard and render a Team button that opens onto an
 * explanation of why there is no thread; to forget the null check and call the
 * seam with nothing bound; and to reach for `target!` to silence the compiler
 * about the null check that was in fact only done for the *other* button.
 * Duplicating a guard six ways is how six surfaces end up disagreeing about
 * what an object supports.
 *
 * So the seam answers the question once. A surface asks what it may offer for
 * a target and gets back booleans to render on and no-argument callbacks to
 * fire — the null case is resolved here rather than at each call site, which
 * is what removes the assertions.
 *
 * ── Why this is not a hook ────────────────────────────────────────────────
 *
 * It is a pure function of the target and holds no state, so making it a hook
 * would buy nothing and would put it out of reach of mobile, of the adapters,
 * and of a plain unit test. Surfaces that want memoisation already have
 * `useMemo` and the target they would key it on.
 */

import { askAI, discuss } from './open-engagement'
import { canDiscuss } from './target'
import { isEngagementObjectType, type EngagementResult, type EngagementTarget } from './types'

/**
 * What a surface may offer for one target, and how to fire it.
 *
 * Every field is safe to read for a null target: the booleans are false and
 * the callbacks refuse rather than throw. That is deliberate — a card that has
 * not resolved its target yet should be able to render its controls disabled
 * without branching on null first.
 */
export interface EngagementAffordances {
  /** The bound target, or null. Handy for headers and test assertions. */
  target: EngagementTarget | null
  /** True when there is an object AI can be opened against. */
  canAskAI: boolean
  /** True when the object can actually hold a thread. Render Team on this. */
  canDiscuss: boolean
  /**
   * Set when there is a target but the app does not engage with its kind —
   * an adapter produced something outside the union. Surfaces can show it or
   * ignore it; what matters is that it is not silently indistinguishable from
   * "no object yet".
   */
  unsupportedType: boolean
  /** Open AI bound to this object. Safe to call when `canAskAI` is false. */
  askAI: () => EngagementResult
  /**
   * Open the thread for this object. Safe to call when `canDiscuss` is false:
   * the pane opens and says why there is no thread, and the result carries
   * `limitation: 'discuss-unsupported'`.
   */
  discuss: () => EngagementResult
}

const NO_TARGET: EngagementResult = { opened: false, refused: 'no-target' }

/**
 * Resolve the engagement affordances for a target.
 *
 * The one entry point a surface needs. It never throws, never navigates, and
 * knows nothing about the pane — a caller that has a target can render its
 * controls from this without importing three functions and re-deriving the
 * same two booleans a seventh time.
 */
export function engagementAffordances(
  target: EngagementTarget | null | undefined,
): EngagementAffordances {
  const bound = target?.objectId && target?.objectType ? target : null
  const supported = bound ? isEngagementObjectType(bound.objectType) : false
  const engageable = bound !== null && supported

  return {
    target: bound,
    canAskAI: engageable,
    canDiscuss: engageable && canDiscuss(bound),
    unsupportedType: bound !== null && !supported,
    askAI: () => (bound ? askAI(bound) : NO_TARGET),
    discuss: () => (bound ? discuss(bound) : NO_TARGET),
  }
}
