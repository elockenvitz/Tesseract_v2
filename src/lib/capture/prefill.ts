/**
 * Opening a capture form with something already written in it.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * `openThoughtsCapture` has always carried a `prefillText` field, and nothing
 * ever read it: `Layout`'s listener destructures `contextType`, `contextId`,
 * `contextTitle` and `captureType` and drops the rest, so every caller that
 * sent words sent them into nothing. The AI action catalogue has been
 * dispatching one for `create_prompt` since it was written. The form on the
 * other end — `QuickThoughtCapture` — has accepted `initialContent`,
 * `initialIdeaType`, `initialSourceTitle` and `initialAssetId` all along.
 * Two ends of a wire with no wire.
 *
 * This is the wire, and it is a parser rather than a type cast: the event
 * detail comes off a global `CustomEvent` that anything on the page can
 * dispatch, so it is validated here once and the hosts work with the result.
 *
 * ── Why a prefill is only honoured for one form ───────────────────────────
 *
 * Only the quick-thought form takes initial values. `PromptModal`,
 * `RecommendationQuickModal` and `QuickTradeIdeaCapture` do not, so a prefill
 * aimed at those is DROPPED here rather than passed on and silently ignored
 * downstream. A caller that believes it prefilled a form which opened empty
 * is the same defect as a button that looks like a link and goes nowhere.
 * When one of those forms grows an initial-value prop, this is the one place
 * that has to change.
 *
 * ── What this does not do ─────────────────────────────────────────────────
 *
 * It does not save anything. A prefill is a draft in a form, under the
 * reader's hands, and it is submitted by the same component with the same
 * validation and the same org stamping as a capture typed from scratch.
 *
 * Pure — no React, no Supabase — so the hosts and the tests read the same
 * rules.
 */
import type { LegacyCaptureMode } from './capture-types'

/** The global channel. One name, written once. */
export const CAPTURE_OPEN_EVENT = 'openThoughtsCapture'

/** The quick-thought form's three kinds. Its own `idea_type` column. */
export type PrefilledIdeaType = 'thought' | 'research_idea' | 'thesis'

const IDEA_TYPES: readonly PrefilledIdeaType[] = ['thought', 'research_idea', 'thesis']
const CAPTURE_MODES: readonly LegacyCaptureMode[] = ['idea', 'trade_idea', 'prompt', 'proposal']

/**
 * The only form that takes initial values today.
 *
 * Named rather than inlined so the reason survives: see the note above.
 */
const PREFILLABLE: LegacyCaptureMode = 'idea'

/** `source_title` is a one-line field on the record, not a place for prose. */
export const SOURCE_TITLE_MAX = 200

export interface CapturePrefill {
  /** The words, exactly as the reader saw them. Never rewritten here. */
  text: string
  ideaType: PrefilledIdeaType
  /**
   * Where the words came from, for the record's own `source_title`.
   *
   * Required, not optional: a draft that arrives in a form from somewhere
   * else and says nothing about where it came from is how a model's sentence
   * becomes an analyst's note with no trace. Provenance is enforced in this
   * codebase, and this is the field that carries it.
   */
  sourceTitle: string
  /** Binds the capture to an asset when the source was about one. */
  assetId?: string
}

export interface CaptureOpenRequest {
  /** Which form to open. Null opens the picker. */
  captureType: LegacyCaptureMode | null
  contextType?: string
  contextId?: string
  contextTitle?: string
  prefill?: CapturePrefill
}

function text(value: unknown, max?: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return max && trimmed.length > max ? trimmed.slice(0, max - 1).trimEnd() + '…' : trimmed
}

function readPrefill(raw: unknown, captureType: LegacyCaptureMode | null): CapturePrefill | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  // A prefill for a form that cannot show one is not passed on. See the note.
  if (captureType !== PREFILLABLE) return undefined

  const candidate = raw as { text?: unknown; ideaType?: unknown; sourceTitle?: unknown; assetId?: unknown }
  /* Not trimmed to nothing: the body keeps its own leading and trailing
     shape apart from surrounding blank space, because the reader approved
     what they saw. */
  const body = typeof candidate.text === 'string' ? candidate.text.replace(/^\s+|\s+$/g, '') : ''
  if (!body) return undefined

  const sourceTitle = text(candidate.sourceTitle, SOURCE_TITLE_MAX)
  // No provenance, no prefill. The draft would be untraceable.
  if (!sourceTitle) return undefined

  const ideaType = IDEA_TYPES.includes(candidate.ideaType as PrefilledIdeaType)
    ? (candidate.ideaType as PrefilledIdeaType)
    : 'thought'

  const assetId = text(candidate.assetId)
  return { text: body, ideaType, sourceTitle, ...(assetId ? { assetId } : {}) }
}

/**
 * Validate an `openThoughtsCapture` detail.
 *
 * Total: never throws. Returns null only when there is no usable request at
 * all; a malformed prefill on an otherwise valid request drops the prefill
 * and still opens the form, because opening empty is recoverable and failing
 * to open is not.
 */
export function readCaptureOpen(detail: unknown): CaptureOpenRequest | null {
  /* An array is `typeof 'object'` and carries none of these fields, so it is
     a malformed detail rather than a bare "just open the picker" request. */
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
  const d = detail as Record<string, unknown>

  const captureType = CAPTURE_MODES.includes(d.captureType as LegacyCaptureMode)
    ? (d.captureType as LegacyCaptureMode)
    : null

  const contextType = text(d.contextType)
  const contextId = text(d.contextId)
  const contextTitle = text(d.contextTitle)
  const prefill = readPrefill(d.prefill, captureType)

  return {
    captureType,
    ...(contextType ? { contextType } : {}),
    ...(contextId ? { contextId } : {}),
    ...(contextTitle ? { contextTitle } : {}),
    ...(prefill ? { prefill } : {}),
  }
}

/** Ask the shell to open a capture form. False where there is no window. */
export function dispatchCaptureOpen(request: CaptureOpenRequest): boolean {
  if (typeof window === 'undefined') return false
  window.dispatchEvent(new CustomEvent(CAPTURE_OPEN_EVENT, { detail: request }))
  return true
}

/**
 * The prefill as `QuickThoughtCapture`'s props.
 *
 * Spelled out here so the mapping is one expression a test can read, rather
 * than four lines in the middle of a component's JSX.
 */
export function capturePrefillProps(prefill: CapturePrefill | null | undefined): {
  initialContent?: string
  initialIdeaType?: PrefilledIdeaType
  initialSourceTitle?: string
  initialAssetId?: string
} {
  if (!prefill) return {}
  return {
    initialContent: prefill.text,
    initialIdeaType: prefill.ideaType,
    initialSourceTitle: prefill.sourceTitle,
    ...(prefill.assetId ? { initialAssetId: prefill.assetId } : {}),
  }
}
