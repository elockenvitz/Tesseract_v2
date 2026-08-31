/**
 * Desktop Portfolio — where the book and the framework disagree.
 *
 * Position identity is (asset, portfolio): the same name carries very
 * different weights in different books, and every number here belongs to one.
 */

export type { PositionFrame, LiveIdea, GapState, RouteTo } from './model'
export {
  EMPTY_FRAME, GAP_LABEL, MATERIAL_PCT,
  gapOf, breakPct, whyItMatters, primaryActionFor,
  issueFor, seedPromptFor, targetFor,
  tierOf, scoreOf, comparePositions,
} from './model'
