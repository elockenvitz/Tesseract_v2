/**
 * Desktop Ideas — the domain layer.
 *
 * An Idea is an investment object. Direction and maturity are separate
 * dimensions because `trade_queue_items` carries both. Ranking is tier-first,
 * reusing the discipline proven in mobile's feed-priority and Today's tiers.
 */

export type {
  IdeaDirection, IdeaMaturity, IdeaConviction, IdeaRow, IdeaFamily, IdeaEnrichment,
} from './model'
export {
  MATURITY_LABEL, maturityOf, familyFor, issueFor, seedPromptFor,
  primaryActionFor, targetFor,
} from './model'

export type { IdeaTier, IdeaScore } from './rank'
export { IDEA_TIER_LABEL, scoreIdea, compareIdeas } from './rank'
