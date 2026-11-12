/**
 * The AI presentation layer.
 *
 * One set of components for every surface that shows model output: the chat
 * pane and the contextual asset briefing. Nothing here reads the database,
 * holds a conversation, or decides what to send — it renders what it is
 * given, which is what makes it reusable and testable.
 *
 * Components only. The words and the pure helpers live in `lib/ai`
 * (`trail-text`, `markdown`, `figures`, `presentation`), both because fast
 * refresh needs a component module to export nothing else, and because the
 * three-status rule belongs somewhere a test can read it without a DOM.
 */
export { AiProse } from './AiProse'
export { ResearchTrail, SourceRef } from './ResearchTrail'
export { Citations } from './Citations'
/*
 * The one evidence section a message shows. `ResearchTrail` and `Citations`
 * remain exported: `SourceRef` lives in the former and both still have their
 * own suites, but no surface should render either directly any more -- a
 * message's sources go through `AiEvidence`, which is what stops the same
 * record appearing twice under two headings.
 */
export { AiEvidence } from './AiEvidence'
export type { AiEvidenceProps } from './AiEvidence'
export { AiMessage } from './AiMessage'
export { AiThinking, AiErrorNotice, AiPrompts } from './AiStates'
export { AiContextChips } from './AiContextChips'
export type { AiContextSubject, AiContextTarget } from './AiContextChips'
export { AiBriefing } from './AiBriefing'
export type { AiBriefingProps } from './AiBriefing'
