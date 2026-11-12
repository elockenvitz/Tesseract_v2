/**
 * AI System V2 — the orchestration seam.
 *
 * Four modules, one job each:
 *
 *   actions            what the model may recommend, and the only bridge from
 *                      a recommendation to platform behaviour
 *   response-policy    how long an answer may be, decided before the request
 *   envelope           how a response is read back into answer + evidence +
 *                      actions, without the UI scraping prose
 *   context-selection  what the model is given, in priority order, on a budget
 *
 * Nothing here calls a model, opens a socket or touches React. The existing
 * `useAI` path continues to work untouched; this is the layer it grows into.
 */

export {
  ACTION_SPECS,
  AI_ACTION_IDS,
  isAiActionId,
  objectKey,
  parseAiActions,
  executeAiAction,
  describeActionVocabulary,
} from './actions'
export type {
  AiActionId,
  AiActionClass,
  AiActionSpec,
  AiAction,
  AiObjectRef,
  AiObjectType,
  RawAiAction,
  RejectedAiAction,
  AiActionRejectionCode,
  ParsedAiActions,
} from './actions'

export {
  resolveResponsePolicy,
  ANSWER_SHAPE,
  AI_VERBOSITIES,
} from './response-policy'
export type {
  AiVerbosity,
  AiPurpose,
  AiResponsePolicy,
  ResolvePolicyInput,
} from './response-policy'

export {
  parseAiResponse,
  describeEnvelopeContract,
  ENVELOPE_FENCE,
} from './envelope'
export type { AiResponseEnvelope, AiEvidence, ParseEnvelopeOptions } from './envelope'

export {
  TOOL_STATUS_LABEL,
  PHASE_STATUS_LABEL,
  AI_STREAM_EVENT_TYPES,
  isAiToolName,
  isAiStatusPhase,
  statusLabel,
  toStreamEvent,
} from './stream-protocol'
export type {
  AiToolName,
  AiStatusPhase,
  AiStreamEvent,
  AiStreamMetaEvent,
  AiStreamStatusEvent,
  AiStreamDeltaEvent,
  AiStreamFinalEvent,
  AiStreamErrorEvent,
} from './stream-protocol'

export {
  FENCE_MARKER,
  createSseDecoder,
  createFenceFilter,
  createMarks,
  deriveLatency,
  consumeAiStream,
} from './stream'
export type {
  FenceFilter,
  AiStreamMarks,
  AiLatency,
  AiStreamHandlers,
  AiStreamOutcome,
} from './stream'

export {
  boundHistory,
  stripStoredExcerpts,
  DEFAULT_HISTORY_BUDGET,
} from './history'
export type { HistoryMessage, HistoryBudget, BoundedHistory } from './history'

export {
  createRequestContext,
  createInFlight,
  cancelInFlight,
  shouldApplyToView,
  __resetRequestCounter,
} from './request-context'
export type {
  AiRequestContext,
  AiInFlightRequest,
  AiRequestStatus,
  ViewState,
} from './request-context'

export {
  chatModeFor,
  chatLayout,
  modeToggleLabel,
} from './chat-modes'
export type { AiChatMode, ChatLayout, ChatModeInput } from './chat-modes'

export { suggestedPrompts } from './suggested-prompts'
export type { PromptContext, PromptTag, PromptTarget } from './suggested-prompts'

/* Whether the pane yet knows what it is showing. */
export { isThreadSettling } from './restore-gate'
export type { RestoreGateInput } from './restore-gate'

/* What the assistant is called. One place, so renaming is one edit. */
export {
  ACT_AI, ACT_AI_RESEARCH, ACT_AI_BRIEFING, ACT_AI_PLACEHOLDER, ACT_AI_ANALYZE,
  actAiTitle,
} from './brand'

export {
  selectContext,
  describeSelection,
  DEFAULT_BUDGET,
  OBJECT_TOKEN_COST,
} from './context-selection'
export type {
  ReaderLocation,
  ContextSelection,
  SelectedObject,
  SelectableType,
  ContextRole,
  SelectionBudget,
  AiTag,
  AiTagType,
} from './context-selection'
