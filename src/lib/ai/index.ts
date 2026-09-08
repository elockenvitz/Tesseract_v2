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
