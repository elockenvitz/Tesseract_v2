/**
 * The AI presentation layer.
 *
 * One set of components for every surface that shows model output: the chat
 * pane today, a contextual asset briefing next. Nothing here reads the
 * database, holds a conversation, or decides what to send — it renders what it
 * is given, which is what makes it reusable and testable.
 *
 * Components only. The words and the pure helpers live in `lib/ai`
 * (`trail-text`, `markdown`, `figures`, `presentation`), both because fast
 * refresh needs a component module to export nothing else, and because the
 * three-status rule belongs somewhere a test can read it without a DOM.
 */
export { AiProse } from './AiProse'
export { ResearchTrail, SourceRef } from './ResearchTrail'
export { Citations } from './Citations'
export { AiMessage } from './AiMessage'
export { AiThinking, AiErrorNotice, AiPrompts } from './AiStates'
