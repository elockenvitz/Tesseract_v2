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
/* The one context component that WRITES. It changes the conversation's tags,
   which is the canonical input the server reads — see its own note for why
   that is not a contradiction of the display-only rule above. */
export { AiContextAttach, ATTACHABLE_TYPES } from './AiContextAttach'
export type { AiContextAttachProps, AttachableType } from './AiContextAttach'
/* Keeping an answer. It opens the canonical capture form prefilled and
   writes nothing itself -- see its own note on why it still confirms. */
export { AiKeep } from './AiKeep'
export type { AiKeepProps } from './AiKeep'
/* The box, the keys and the Send/Stop control. It holds no conversation: it
   is handed a value and two handlers, which is what lets a test press Stop
   without standing up the hook. */
export { AiComposer } from './AiComposer'
export type { AiComposerProps } from './AiComposer'
/* Tesseract's own Slash Commands, for the few that can be honoured in a chat
   message. It names the ones that cannot, rather than degrading them. */
export { AiSlashMenu, slashRowText } from './AiSlashMenu'
export type { AiSlashMenuProps } from './AiSlashMenu'
export { AiBriefing } from './AiBriefing'
export type { AiBriefingProps } from './AiBriefing'
