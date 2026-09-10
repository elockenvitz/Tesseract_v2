/**
 * AI System V2 — the canonical Tesseract action vocabulary.
 *
 * ── What this is ──────────────────────────────────────────────────────────
 *
 * The closed set of things the model is allowed to recommend, and the only
 * bridge from a model recommendation to platform behaviour. Every entry maps
 * onto a seam this app ALREADY has — `openAsset`, `openResearch`, `openIdea`,
 * `openThoughtsCapture`, `discuss`, `decision-engine-action`. Nothing here
 * invents a destination, a route or a component.
 *
 * ── Why a closed catalogue rather than free-form routing ──────────────────
 *
 * `handleSearchResult` in DashboardPage builds a tab from `result.type`
 * verbatim. A model that could put a string there could open any tab type in
 * the shell, with any `data` payload, and the shell would comply. So the model
 * never supplies a tab type: it supplies an ACTION ID from this catalogue, and
 * the tab type is a literal written here, in code the model cannot reach.
 *
 * ── The two invariants ────────────────────────────────────────────────────
 *
 * 1. An action id that is not in `ACTION_SPECS` produces no executable action.
 *    Not a fallback, not a generic "open" — nothing. `parseAiActions` drops it
 *    and records why, so the pane can render the label as inert text if it
 *    wants to.
 *
 * 2. An action may only target an object the model was GIVEN. The allowlist
 *    comes from the context selector, so a hallucinated uuid — or a real uuid
 *    for an object the user was never shown — cannot be acted on. This is the
 *    property that makes the eventual execute step safe: approving an action
 *    can only ever operate on something already on screen.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 *
 * Not an execution framework. `executeAiAction` performs ONE navigation or
 * ONE capture-pane open. It never writes. Consequential work stays where it
 * already lives, behind the user's own hands.
 */

import { openAsset } from '../desktop-asset'
import { openResearch } from '../desktop-research'
import { openIdea } from '../desktop-ideas'
import { discuss } from '../engagement'
import type { EngagementTarget } from '../engagement'

// ---------------------------------------------------------------------------
// Object references
// ---------------------------------------------------------------------------

/**
 * The kinds of object an action can point at.
 *
 * Deliberately narrower than `EngagementObjectType`: this union only contains
 * kinds that at least one action in the catalogue can actually do something
 * with. A kind with no action is a kind the model should not be naming.
 */
export type AiObjectType = 'asset' | 'portfolio' | 'theme' | 'idea' | 'project'

export interface AiObjectRef {
  type: AiObjectType
  id: string
  /** Display name. Also what a ticker-shaped action passes as `symbol`. */
  label?: string
  /** Ticker, when the object is or belongs to an asset. */
  symbol?: string
}

/** Stable key for allowlist membership. */
export function objectKey(ref: { type: string; id: string }): string {
  return `${ref.type}:${ref.id}`
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export type AiActionId =
  // Navigation
  | 'open_asset'
  | 'open_research'
  | 'open_portfolio'
  | 'open_theme'
  | 'open_idea'
  | 'open_project'
  | 'open_chart'
  | 'open_pipeline'
  // Investment work
  | 'update_thesis'
  | 'review_target'
  // Capture
  | 'create_thought'
  | 'create_prompt'
  | 'create_trade_idea'
  | 'create_recommendation'
  // Collaboration
  | 'discuss'

export type AiActionClass = 'navigation' | 'investment' | 'capture' | 'collaboration'

export interface AiActionSpec {
  id: AiActionId
  class: AiActionClass
  /** Object kinds this action accepts. Empty means the action takes no target. */
  targets: readonly AiObjectType[]
  /** Default button label when the model does not supply a usable one. */
  defaultLabel: string
  /**
   * `navigate` moves the reader. `compose` opens a form with fields prefilled
   * and nothing saved. Nothing in this catalogue writes, which is why there is
   * no `mutate` — when one is added it must arrive with an approval step.
   */
  effect: 'navigate' | 'compose'
  /** One line the system prompt uses to teach the model when to pick this. */
  when: string
}

/**
 * Every action, and the seam it rides.
 *
 * Each entry was checked against a live listener before being added. An action
 * the AI can offer must reach something from wherever the panel is open, and
 * two families fail that for different reasons. Both stay out; recommending a
 * button that does nothing is worse than recommending nothing.
 *
 *   `OPEN_PROMPT_THREAD` is dead outright. Its case in
 *   dispatchDecisionAction.ts is an empty `break` under the comment "Prompts
 *   not fully implemented".
 *
 *   The `outcomes:*` family is NOT unlistened — that was the original claim
 *   here and it is wrong. `outcomes:open-section` is handled at
 *   DecisionAccountabilityPage.tsx:864 and `outcomes:section-opened` at
 *   PilotOutcomesGetStarted.tsx:146. What disqualifies them is narrower and
 *   more durable: both listeners are registered by components mounted inside
 *   those pages, so the event only lands when the reader is already on the
 *   page the action would take them to. The AI panel opens over any surface,
 *   which is exactly the case where the handler does not exist. A page-local
 *   event is not an app seam, and it will not become one by being listened to
 *   more carefully.
 */
export const ACTION_SPECS: Readonly<Record<AiActionId, AiActionSpec>> = Object.freeze({
  open_asset: {
    id: 'open_asset',
    class: 'navigation',
    targets: ['asset'],
    defaultLabel: 'Open asset',
    effect: 'navigate',
    when: 'The reader should look at the whole asset — case, position, decisions, activity.',
  },
  open_research: {
    id: 'open_research',
    class: 'navigation',
    targets: ['asset'],
    defaultLabel: 'Inspect research',
    effect: 'navigate',
    when: 'The question is about the written case or the evidence behind it.',
  },
  open_portfolio: {
    id: 'open_portfolio',
    class: 'navigation',
    targets: ['portfolio'],
    defaultLabel: 'Open portfolio',
    effect: 'navigate',
    when: 'The question is about exposure, sizing or the book as a whole.',
  },
  open_theme: {
    id: 'open_theme',
    class: 'navigation',
    targets: ['theme'],
    defaultLabel: 'Open theme',
    effect: 'navigate',
    when: 'The reasoning turns on a cross-asset theme the user tracks.',
  },
  open_idea: {
    id: 'open_idea',
    class: 'navigation',
    targets: ['idea'],
    defaultLabel: 'Open idea',
    effect: 'navigate',
    when: 'There is a specific trade idea whose decision or thesis is the subject.',
  },
  open_project: {
    id: 'open_project',
    class: 'navigation',
    targets: ['project'],
    defaultLabel: 'Open project',
    effect: 'navigate',
    when: 'The work is tracked as a project and the reader needs its state.',
  },
  open_chart: {
    id: 'open_chart',
    class: 'navigation',
    targets: ['asset'],
    defaultLabel: 'Open chart',
    effect: 'navigate',
    when: 'Price action, not the written case, is what would settle the question.',
  },
  open_pipeline: {
    id: 'open_pipeline',
    class: 'navigation',
    targets: [],
    defaultLabel: 'Open idea pipeline',
    effect: 'navigate',
    when: 'The next step is triage across ideas rather than work on one object.',
  },
  update_thesis: {
    id: 'update_thesis',
    class: 'investment',
    targets: ['asset'],
    defaultLabel: 'Update thesis',
    effect: 'navigate',
    when: 'The written case no longer matches what is known.',
  },
  review_target: {
    id: 'review_target',
    class: 'investment',
    targets: ['asset'],
    defaultLabel: 'Review valuation',
    effect: 'navigate',
    when: 'Price has moved through a target, or the targets are stale.',
  },
  create_thought: {
    id: 'create_thought',
    class: 'capture',
    targets: ['asset', 'portfolio', 'theme'],
    defaultLabel: 'Capture a thought',
    effect: 'compose',
    when: 'There is something worth recording that is not yet a decision.',
  },
  create_prompt: {
    id: 'create_prompt',
    class: 'capture',
    targets: ['asset', 'portfolio', 'theme'],
    defaultLabel: 'Prompt a teammate',
    effect: 'compose',
    when: 'Someone else holds the answer and should be asked for it.',
  },
  create_trade_idea: {
    id: 'create_trade_idea',
    class: 'capture',
    targets: ['asset'],
    defaultLabel: 'Create trade idea',
    effect: 'compose',
    when: 'The analysis has reached something actionable in the book.',
  },
  create_recommendation: {
    id: 'create_recommendation',
    class: 'capture',
    targets: ['asset'],
    defaultLabel: 'Make a recommendation',
    effect: 'compose',
    when: 'A position change should be put to the PM.',
  },
  discuss: {
    id: 'discuss',
    class: 'collaboration',
    targets: ['asset', 'portfolio', 'theme', 'idea'],
    defaultLabel: 'Discuss with the team',
    effect: 'navigate',
    when: 'The disagreement or the missing input is human, not analytical.',
  },
})

/** Every action id, sorted. The single source of truth for prompt + guards. */
export const AI_ACTION_IDS: readonly AiActionId[] = Object.freeze(
  (Object.keys(ACTION_SPECS) as AiActionId[]).sort(),
)

export function isAiActionId(value: unknown): value is AiActionId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTION_SPECS, value)
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

/** What the model emits, before validation. Every field is suspect. */
export interface RawAiAction {
  action?: unknown
  target?: unknown
  label?: unknown
  reason?: unknown
}

/** A validated, executable recommendation. */
export interface AiAction {
  action: AiActionId
  /** Null only for actions whose spec takes no target. */
  target: AiObjectRef | null
  /** Button text. Always present — falls back to the spec's default. */
  label: string
  /** One line of why-now, shown under the button. */
  reason?: string
}

export type AiActionRejectionCode =
  | 'unknown_action'
  | 'missing_target'
  | 'wrong_target_type'
  | 'target_not_in_context'
  | 'malformed'

export interface RejectedAiAction {
  code: AiActionRejectionCode
  /** The action id as the model wrote it, when it was a string at all. */
  raw: string | null
  detail: string
}

export interface ParsedAiActions {
  actions: AiAction[]
  rejected: RejectedAiAction[]
}

const MAX_LABEL_CHARS = 40
const MAX_REASON_CHARS = 120

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max - 1).trimEnd() + '…' : trimmed
}

/**
 * Validate model-emitted actions against the catalogue and the context.
 *
 * Total — never throws, never partially applies. Anything it cannot fully
 * vouch for lands in `rejected` with a reason, and the caller renders zero
 * buttons for it. `allowlist` is what the context selector actually sent to
 * the model; an empty allowlist means no targeted action can survive, which
 * is the correct answer for a conversation with no bound objects.
 */
export function parseAiActions(
  raw: unknown,
  options: { allowlist: readonly AiObjectRef[]; max?: number } ,
): ParsedAiActions {
  const actions: AiAction[] = []
  const rejected: RejectedAiAction[] = []

  if (!Array.isArray(raw)) {
    return { actions, rejected }
  }

  const byKey = new Map<string, AiObjectRef>()
  for (const ref of options.allowlist) {
    if (ref && typeof ref.id === 'string' && ref.id) byKey.set(objectKey(ref), ref)
  }

  const max = options.max ?? 3
  const seen = new Set<string>()

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      rejected.push({ code: 'malformed', raw: null, detail: 'Action was not an object.' })
      continue
    }
    const candidate = entry as RawAiAction
    const id = candidate.action

    if (!isAiActionId(id)) {
      rejected.push({
        code: 'unknown_action',
        raw: typeof id === 'string' ? id : null,
        detail: 'Not a supported Tesseract action.',
      })
      continue
    }

    const spec = ACTION_SPECS[id]
    let target: AiObjectRef | null = null

    if (spec.targets.length > 0) {
      const t = candidate.target as { type?: unknown; id?: unknown } | undefined
      if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.type !== 'string') {
        rejected.push({ code: 'missing_target', raw: id, detail: `${id} needs a target object.` })
        continue
      }
      if (!(spec.targets as readonly string[]).includes(t.type)) {
        rejected.push({
          code: 'wrong_target_type',
          raw: id,
          detail: `${id} does not accept a ${t.type}.`,
        })
        continue
      }
      // The invariant: only objects the model was actually given.
      const known = byKey.get(objectKey({ type: t.type, id: t.id }))
      if (!known) {
        rejected.push({
          code: 'target_not_in_context',
          raw: id,
          detail: `${t.type} ${t.id} was not part of this conversation's context.`,
        })
        continue
      }
      target = known
    }

    const dedupeKey = `${id}|${target ? objectKey(target) : '-'}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    actions.push({
      action: id,
      target,
      label: clean(candidate.label, MAX_LABEL_CHARS) ?? spec.defaultLabel,
      reason: clean(candidate.reason, MAX_REASON_CHARS),
    })

    if (actions.length >= max) break
  }

  return { actions, rejected }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * The capture pane's channel. Dispatched rather than imported so this module
 * stays free of React and can be unit-tested without a DOM tree.
 */
function openCapture(
  captureType: 'idea' | 'trade_idea' | 'prompt' | 'proposal',
  ref: AiObjectRef,
  prefillText?: string,
): boolean {
  if (typeof window === 'undefined') return false
  window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
    detail: {
      contextType: ref.type,
      contextId: ref.id,
      contextTitle: ref.symbol ?? ref.label,
      captureType,
      ...(prefillText ? { prefillText } : {}),
    },
  }))
  return true
}

/** The shell's own tab channel. The `type` is always a literal from here. */
function openTab(detail: { type: string; id: string; title: string; data?: unknown }): boolean {
  if (typeof window === 'undefined') return false
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail }))
  return true
}

/**
 * `AiObjectType` and `EngagementObjectType` overlap but are not the same set:
 * the seam has no `project`, and calls a trade idea `trade_idea`. Written as
 * an explicit map so adding a kind to either union forces this to be revisited
 * rather than silently widening into a value the seam does not understand.
 */
const ENGAGEMENT_TYPE: Readonly<Record<AiObjectType, EngagementTarget['objectType'] | null>> =
  Object.freeze({
    asset: 'asset',
    portfolio: 'portfolio',
    theme: 'theme',
    idea: 'trade_idea',
    project: null,
  })

function engagementTargetFor(
  ref: AiObjectRef,
  objectType: NonNullable<EngagementTarget['objectType']>,
  reason?: string,
): EngagementTarget {
  return {
    objectType,
    objectId: ref.id,
    label: ref.label ?? ref.symbol ?? 'Object',
    ...(ref.symbol ? { symbol: ref.symbol } : {}),
    origin: { surface: 'ai' },
    ...(reason ? { issue: { title: reason, reason: 'ai-recommendation' } } : {}),
  }
}

/**
 * Perform one validated action.
 *
 * Returns false when nothing was dispatched — no `window`, or an action whose
 * seam declined the request. Callers use the return to avoid claiming they
 * navigated. Only accepts an `AiAction`, which can only have come from
 * `parseAiActions`, so an unvalidated string can never reach a seam.
 */
export function executeAiAction(action: AiAction): boolean {
  const t = action.target
  const origin = 'ai'

  switch (action.action) {
    case 'open_asset':
      return t ? openAsset({ assetId: t.id, symbol: t.symbol ?? t.label ?? null, focus: 'overview', issue: action.reason ?? null, origin }) : false

    case 'open_research':
      return t ? openResearch({ assetId: t.id, focus: 'thesis', issue: action.reason, origin }) : false

    case 'update_thesis':
      return t ? openResearch({ assetId: t.id, focus: 'thesis', issue: action.reason, origin }) : false

    case 'review_target':
      return t ? openResearch({ assetId: t.id, focus: 'price', issue: action.reason, origin }) : false

    case 'open_idea':
      return t ? openIdea({ ideaId: t.id, focus: 'decision', issue: action.reason, origin }) : false

    case 'open_portfolio':
      return t ? openTab({ type: 'portfolio', id: t.id, title: t.label ?? 'Portfolio', data: { id: t.id, name: t.label } }) : false

    case 'open_theme':
      return t ? openTab({ type: 'theme', id: t.id, title: t.label ?? 'Theme', data: { id: t.id, name: t.label } }) : false

    case 'open_project':
      return t ? openTab({ type: 'project', id: t.id, title: t.label ?? 'Project', data: { id: t.id } }) : false

    case 'open_chart':
      // Charting is a singleton tab keyed by symbol, not by asset id.
      return t?.symbol
        ? openTab({ type: 'charting', id: 'charting', title: 'Charting', data: { symbol: t.symbol } })
        : false

    case 'open_pipeline':
      return openTab({ type: 'trade-queue', id: 'trade-queue', title: 'Idea Pipeline', data: {} })

    case 'create_thought':
      return t ? openCapture('idea', t) : false

    case 'create_prompt':
      return t ? openCapture('prompt', t, action.reason) : false

    case 'create_trade_idea':
      return t ? openCapture('trade_idea', t) : false

    case 'create_recommendation':
      return t ? openCapture('proposal', t) : false

    case 'discuss': {
      if (!t) return false
      const objectType = ENGAGEMENT_TYPE[t.type]
      // A kind the seam cannot express is a kind that cannot be discussed.
      if (!objectType) return false
      return discuss(engagementTargetFor(t, objectType, action.reason))
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt surface
// ---------------------------------------------------------------------------

/**
 * The catalogue as the model sees it.
 *
 * Generated rather than hand-written so the prompt cannot drift from the code
 * that enforces it — the failure mode where the model is told about an action
 * that `parseAiActions` then silently drops.
 */
export function describeActionVocabulary(): string {
  const byClass = new Map<AiActionClass, AiActionSpec[]>()
  for (const id of AI_ACTION_IDS) {
    const spec = ACTION_SPECS[id]
    const list = byClass.get(spec.class) ?? []
    list.push(spec)
    byClass.set(spec.class, list)
  }
  const order: AiActionClass[] = ['navigation', 'investment', 'capture', 'collaboration']
  return order
    .filter(c => byClass.has(c))
    .map(c => {
      const lines = byClass.get(c)!.map(s => {
        const targets = s.targets.length ? s.targets.join('|') : 'none'
        return `- ${s.id} (target: ${targets}) — ${s.when}`
      })
      return `${c.toUpperCase()}\n${lines.join('\n')}`
    })
    .join('\n\n')
}
