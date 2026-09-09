/**
 * AI System V2 — the wire protocol between the edge function and the client.
 *
 * ── Why a protocol at all ─────────────────────────────────────────────────
 *
 * Stage 1 shipped a single JSON body: the reader waited for the whole answer,
 * the tool loop, and the structured block before seeing one character. The
 * response contract was deliberately built prose-first so that wait could be
 * removed without the UI ever parsing partial JSON. This is that removal.
 *
 * ── What the server is allowed to say ─────────────────────────────────────
 *
 * Five event kinds and nothing else. The server never sends prose it authored
 * itself, never sends a label, and never sends anything the client renders
 * without translating first. A `status` event carries a TOOL NAME, not a
 * sentence — the words live in `TOOL_STATUS_LABEL` below, on the client, where
 * they can be reviewed and tested. A server that could send display strings is
 * a server that could leak whatever the model put in a tool argument.
 *
 * ── What is deliberately NOT in the protocol ──────────────────────────────
 *
 * No component names, no routes, no tab types, no action objects. Actions
 * reach the client only inside the final raw text, and only become executable
 * after `parseAiResponse` has validated them against the request's own frozen
 * allowlist. Streaming changes when the reader sees prose; it changes nothing
 * about what can become a button.
 *
 * ── Truncation is a normal outcome ────────────────────────────────────────
 *
 * `final` is the only terminal success marker. A stream that ends without one
 * — dropped connection, killed function, aborted request — leaves the reader
 * with the prose that did arrive and zero actions. There is no synthesised
 * fallback action, ever.
 */

/** The tools the edge function can report running. Mirrors RESEARCH_TOOLS. */
export type AiToolName =
  | 'get_asset'
  | 'search_assets'
  | 'get_portfolio'
  | 'get_theme'
  | 'search_team_notes'

/**
 * What the reader is told while a tool runs.
 *
 * Grounded in an actual tool invocation and nothing else. These describe the
 * ACTIVITY, not the model's reasoning: "Checking recent research" is a true
 * statement about a database read that is happening. Anything describing why
 * the model chose to read it would be chain-of-thought, which is not ours to
 * show and is not in this map.
 *
 * The tool's arguments are deliberately not interpolated. A ticker would be
 * harmless; the habit of pasting model-supplied strings into the UI is not.
 */
export const TOOL_STATUS_LABEL: Readonly<Record<AiToolName, string>> = Object.freeze({
  get_asset: 'Checking asset details…',
  search_assets: 'Searching assets…',
  get_portfolio: 'Checking portfolio exposure…',
  get_theme: 'Checking theme…',
  search_team_notes: 'Checking recent research…',
})

/** Non-tool phases worth showing. Same rule: activity, never reasoning. */
export type AiStatusPhase = 'context' | 'thinking'

export const PHASE_STATUS_LABEL: Readonly<Record<AiStatusPhase, string>> = Object.freeze({
  context: 'Reviewing current context…',
  thinking: 'Working…',
})

export function isAiToolName(value: unknown): value is AiToolName {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(TOOL_STATUS_LABEL, value)
}

export function isAiStatusPhase(value: unknown): value is AiStatusPhase {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(PHASE_STATUS_LABEL, value)
}

/**
 * Resolve a status event to the words the reader sees.
 *
 * Returns null for anything unrecognised, so a server that learns a new tool
 * before the client does shows nothing rather than a raw identifier.
 */
export function statusLabel(event: AiStreamStatusEvent): string | null {
  if (event.tool && isAiToolName(event.tool)) return TOOL_STATUS_LABEL[event.tool]
  if (event.phase && isAiStatusPhase(event.phase)) return PHASE_STATUS_LABEL[event.phase]
  return null
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface AiStreamMetaEvent {
  type: 'meta'
  model: string | null
  verbosity: string | null
  /** Server phase timings up to the point the provider request was issued. */
  timings: Record<string, number>
}

export interface AiStreamStatusEvent {
  type: 'status'
  tool?: string
  phase?: string
  /** Which tool-loop iteration this belongs to. Diagnostic. */
  iteration?: number
}

export interface AiStreamDeltaEvent {
  type: 'delta'
  text: string
}

export interface AiStreamFinalEvent {
  type: 'final'
  /**
   * The complete model output, structured block included.
   *
   * The client re-parses this rather than trusting a server-side parse: the
   * allowlist an action must satisfy belongs to the request the client made,
   * and only the client holds it. Sending pre-validated actions would move
   * that check to the side of the wire that cannot perform it correctly.
   */
  raw: string
  model: string | null
  citations: Array<{ document_title: string; cited_text: string }>
  tool_calls: Array<{ name: string; input: Record<string, unknown>; result_summary?: string }>
  usage: Record<string, unknown>
  timings: Record<string, number>
}

export interface AiStreamErrorEvent {
  type: 'error'
  message: string
  code?: string
  /** A recoverable error does not end the stream. A terminal one does. */
  recoverable: boolean
  details?: Record<string, unknown>
}

export type AiStreamEvent =
  | AiStreamMetaEvent
  | AiStreamStatusEvent
  | AiStreamDeltaEvent
  | AiStreamFinalEvent
  | AiStreamErrorEvent

export const AI_STREAM_EVENT_TYPES = Object.freeze(
  ['meta', 'status', 'delta', 'final', 'error'] as const,
)

/**
 * Coerce one decoded SSE payload into a typed event.
 *
 * Total: anything unrecognised returns null and the reader skips it. A server
 * that gains an event kind before the client does must not break the stream,
 * which is the whole reason this is a filter and not an assertion.
 */
export function toStreamEvent(payload: unknown): AiStreamEvent | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>

  switch (p.type) {
    case 'meta':
      return {
        type: 'meta',
        model: typeof p.model === 'string' ? p.model : null,
        verbosity: typeof p.verbosity === 'string' ? p.verbosity : null,
        timings: isNumberMap(p.timings) ? p.timings : {},
      }

    case 'status':
      return {
        type: 'status',
        ...(typeof p.tool === 'string' ? { tool: p.tool } : {}),
        ...(typeof p.phase === 'string' ? { phase: p.phase } : {}),
        ...(typeof p.iteration === 'number' ? { iteration: p.iteration } : {}),
      }

    case 'delta':
      // An empty or non-string delta is not an error, just nothing to render.
      return typeof p.text === 'string' && p.text.length > 0
        ? { type: 'delta', text: p.text }
        : null

    case 'final':
      return {
        type: 'final',
        raw: typeof p.raw === 'string' ? p.raw : '',
        model: typeof p.model === 'string' ? p.model : null,
        citations: Array.isArray(p.citations) ? p.citations as AiStreamFinalEvent['citations'] : [],
        tool_calls: Array.isArray(p.tool_calls) ? p.tool_calls as AiStreamFinalEvent['tool_calls'] : [],
        usage: p.usage && typeof p.usage === 'object' ? p.usage as Record<string, unknown> : {},
        timings: isNumberMap(p.timings) ? p.timings : {},
      }

    case 'error':
      return {
        type: 'error',
        message: typeof p.message === 'string' && p.message ? p.message : 'The AI request failed.',
        ...(typeof p.code === 'string' ? { code: p.code } : {}),
        recoverable: p.recoverable === true,
        ...(p.details && typeof p.details === 'object'
          ? { details: p.details as Record<string, unknown> }
          : {}),
      }

    default:
      return null
  }
}

function isNumberMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(v => typeof v === 'number')
}
