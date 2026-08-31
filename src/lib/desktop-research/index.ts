/**
 * Desktop Research — the evidence workspace.
 *
 * Asset/thesis centred, because that is what the durable model describes:
 * asset_contributions holds the case per section, asset_notes holds evidence
 * keyed on the asset, and nothing describes a document with a life of its own.
 */

export type {
  ThesisSection, EvidenceItem, ResearchSubject, ResearchState, ResearchFamily,
} from './model'
export {
  CORE_SECTIONS, ALL_SECTIONS, SECTION_LABEL, STATE_LABEL,
  stateOf, whyItMatters, familyFor, primaryActionFor,
  issueFor, seedPromptFor, targetFor,
  tierOf, scoreOf, compareSubjects,
} from './model'

export { openResearch, subscribeToOpenResearch, researchTabFor, OPEN_RESEARCH_EVENT } from './navigate'
export type { OpenResearchRequest, ResearchFocus } from './navigate'
