/**
 * AI System V2 — deterministic context selection.
 *
 * ── What context selection looks like today ───────────────────────────────
 *
 * `CommunicationPane` builds `initialTags` from whichever of two sources is
 * present — the engagement target, or the active tab's `contextType`/
 * `contextId` pair — and hands them to `useAI`. The edge function then loops
 * every tag and, for each asset, issues four serial queries and pushes
 * everything it finds into the request. There is no budget on that path: the
 * `MAX_CONTEXT_CHARS` ceiling is applied only in `buildContextPrompt`, which
 * is the non-Anthropic branch. On the default provider, five thesis sections
 * at 2,600 characters plus ten notes at 800 is roughly 5.5K tokens for ONE
 * tag, and a two-tag conversation simply doubles it.
 *
 * There is also nothing between "the tab I am on" and "everything about it".
 * The reader's actual location — which portfolio they were looking at the
 * asset from, which idea raised the question — reaches the model only when
 * the engagement seam happened to bind it.
 *
 * ── What this module does ─────────────────────────────────────────────────
 *
 * Turns a reader location into an ORDERED, CAPPED, BUDGETED selection, and
 * says out loud what it dropped. Pure: no Supabase, no React, no window. The
 * same location always produces the same selection, which is the property
 * that makes "why did the AI not know about X" answerable.
 *
 * ── The priority order ────────────────────────────────────────────────────
 *
 * 1. Objects the user named explicitly. They asked; it goes in.
 * 2. The subject — the engagement target's own object, or the active tab's.
 * 3. The asset the subject hangs off, when the subject is not itself one.
 * 4. The portfolio the reader was looking at the subject from.
 * 5. Nothing else. The rest of application state is not context.
 *
 * ── Why the allowlist comes from here ─────────────────────────────────────
 *
 * `selection.allowlist` is what the model may later act on. Deriving it from
 * the same pass that decides what to SEND means the two can never disagree:
 * an object the model was not given is an object the model cannot recommend
 * a button for. That is enforced in `parseAiActions`; this is where the set
 * is defined.
 */

import type { AiObjectRef, AiObjectType } from './actions'
import type { EngagementTarget } from '../engagement'

/** The AI tag types the edge function knows how to resolve. */
export type AiTagType = 'asset' | 'portfolio' | 'theme' | 'note'

export interface AiTag {
  type: AiTagType
  id: string
  label?: string
}

/**
 * Where the reader is.
 *
 * `tab` is the shell's active tab as-is; only its type, id, title and the few
 * data fields named below are read, so passing the whole tab is safe and
 * callers do not have to pre-digest it.
 */
export interface ReaderLocation {
  tab?: {
    type?: string | null
    id?: string | null
    title?: string | null
    data?: {
      id?: string | null
      symbol?: string | null
      name?: string | null
      portfolioId?: string | null
      portfolioName?: string | null
      selectedAssetId?: string | null
      selectedIdeaId?: string | null
    } | null
  } | null
  /** Set when the pane was opened through the engagement seam. */
  engagementTarget?: EngagementTarget | null
  /** Objects the user named in the composer. Highest priority. */
  explicitRefs?: readonly AiObjectRef[]
}

export type ContextRole = 'explicit' | 'subject' | 'supporting'

/**
 * Everything selection can carry, which is one kind wider than everything
 * actions can target.
 *
 * A note is worth sending — the edge function assembles a context block for
 * it and the model reads it — but no action in the catalogue accepts one, so
 * it must never reach the allowlist. Keeping the two sets distinct here is
 * what stops "the model was shown it" from silently becoming "the model may
 * recommend a button for it".
 */
export type SelectableType = AiObjectType | 'note'

export interface SelectedObject {
  type: SelectableType
  id: string
  label?: string
  symbol?: string
  role: ContextRole
  /** Why it was selected. Shown to the user as "context already supplied". */
  why: string
  /** Budget charge, in estimated tokens. */
  estimatedTokens: number
}

export interface ContextSelection {
  /** The one object the conversation is about, when there is one. */
  subject: SelectedObject | null
  /** Everything selected, in priority order, subject first. */
  selected: SelectedObject[]
  /** What the edge function is asked to resolve. */
  tags: AiTag[]
  /** What the model may target in a recommended action. */
  allowlist: AiObjectRef[]
  estimatedTokens: number
  /** Objects that priority or budget excluded, with the reason. */
  dropped: Array<{ ref: { type: SelectableType; id: string }; reason: 'budget' | 'object_cap' | 'duplicate' }>
}

/**
 * Estimated cost of including one object, in tokens.
 *
 * Derived from the caps the edge function already enforces, not guessed:
 * an asset is one overview (~40) plus five thesis sections at
 * `MAX_THESIS_CHARS` 2000 + 600 supporting (~650 each) plus five price
 * targets (~250) plus ten notes at `MAX_NOTE_CHARS * 4` (~200 each). That is
 * the WORST case, which is the only number a budget can be built on.
 */
export const OBJECT_TOKEN_COST: Readonly<Record<SelectableType, number>> = Object.freeze({
  asset: 5600,
  portfolio: 900,
  theme: 700,
  idea: 400,
  project: 300,
  note: 400,
})

export interface SelectionBudget {
  /** Ceiling on context tokens across every selected object. */
  maxTokens: number
  /** Ceiling on object count, regardless of size. */
  maxObjects: number
}

/**
 * The default budget.
 *
 * 12K tokens is roughly two full assets plus a portfolio — enough for the
 * comparison questions that actually get asked, and about a fifth of what an
 * unbudgeted four-tag conversation can currently send. Four objects is the
 * point past which the model starts summarising context instead of answering
 * the question.
 */
export const DEFAULT_BUDGET: SelectionBudget = Object.freeze({
  maxTokens: 12_000,
  maxObjects: 4,
})

const TAGGABLE: Readonly<Record<SelectableType, AiTagType | null>> = Object.freeze({
  asset: 'asset',
  portfolio: 'portfolio',
  theme: 'theme',
  note: 'note',
  // The edge function has no idea/project branch. Including them as tags
  // would show the user a chip for context that was never assembled.
  idea: null,
  project: null,
})

/** Actionable kinds. Anything outside this is context only. */
const ACTIONABLE: ReadonlySet<string> = new Set<AiObjectType>([
  'asset', 'portfolio', 'theme', 'idea', 'project',
])

/** Tab types whose subject is an asset, and where in `data` its id lives. */
const ASSET_TAB_TYPES: Readonly<Record<string, 'id' | 'selectedAssetId'>> = Object.freeze({
  asset: 'id',
  'research-v2': 'selectedAssetId',
})

type SelectableRef = { type: SelectableType; id: string; label?: string; symbol?: string }

function refFromTarget(target: EngagementTarget): SelectableRef | null {
  const map: Partial<Record<EngagementTarget['objectType'], SelectableType>> = {
    asset: 'asset',
    portfolio: 'portfolio',
    theme: 'theme',
    trade_idea: 'idea',
    note: 'note',
  }
  const type = map[target.objectType]
  if (!type) return null
  return {
    type,
    id: target.objectId,
    label: target.label,
    ...(target.symbol ? { symbol: target.symbol } : {}),
  }
}

function refFromTab(tab: NonNullable<ReaderLocation['tab']>): SelectableRef | null {
  const type = tab.type ?? ''
  const data = tab.data ?? {}

  const assetField = ASSET_TAB_TYPES[type]
  if (assetField) {
    const id = assetField === 'id' ? (data.id ?? tab.id) : data.selectedAssetId
    if (!id) return null
    return {
      type: 'asset',
      id,
      label: data.symbol ?? tab.title ?? undefined,
      ...(data.symbol ? { symbol: data.symbol } : {}),
    }
  }

  if (type === 'portfolio') {
    const id = data.id ?? tab.id
    if (!id) return null
    return { type: 'portfolio', id, label: data.name ?? tab.title ?? undefined }
  }

  if (type === 'theme') {
    const id = data.id ?? tab.id
    if (!id) return null
    return { type: 'theme', id, label: data.name ?? tab.title ?? undefined }
  }

  if (type === 'ideas-v2' && data.selectedIdeaId) {
    return { type: 'idea', id: data.selectedIdeaId, label: tab.title ?? undefined }
  }

  if (type === 'note') {
    const id = data.id ?? tab.id
    if (!id) return null
    return { type: 'note', id, label: tab.title ?? undefined }
  }

  // Every other tab type — dashboards, lists, settings, the trade surfaces —
  // has no single subject. Returning null is the honest answer; inventing one
  // is how a conversation ends up tagged with "Assets".
  return null
}

function key(ref: { type: string; id: string }): string {
  return `${ref.type}:${ref.id}`
}

/**
 * Select the context for one AI request.
 *
 * Deterministic and total: any location, including an empty one, produces a
 * valid selection. An empty selection is a correct outcome — a conversation
 * started from the dashboard is about nothing in particular, and pretending
 * otherwise is what makes generic answers feel like the model's fault.
 */
export function selectContext(
  location: ReaderLocation,
  budget: SelectionBudget = DEFAULT_BUDGET,
): ContextSelection {
  const candidates: Array<{ ref: SelectableRef; role: ContextRole; why: string }> = []
  const seen = new Set<string>()
  const dropped: ContextSelection['dropped'] = []

  const push = (ref: SelectableRef | null, role: ContextRole, why: string) => {
    if (!ref?.id || !ref.type) return
    const k = key(ref)
    if (seen.has(k)) {
      dropped.push({ ref, reason: 'duplicate' })
      return
    }
    seen.add(k)
    candidates.push({ ref, role, why })
  }

  // 1 — what the user named.
  for (const ref of location.explicitRefs ?? []) {
    push(ref, 'explicit', 'You referred to it')
  }

  // 2 — the subject.
  const target = location.engagementTarget ?? null
  if (target) {
    const own = refFromTarget(target)
    if (own) {
      push(own, 'subject', target.issue?.title ?? 'The object you opened AI from')
    } else if (target.assetId) {
      // A research note or decision is not itself taggable. The asset it hangs
      // off is the closest honest subject, and is what `toAITags` already does.
      push(
        {
          type: 'asset',
          id: target.assetId,
          label: target.symbol ?? target.label,
          ...(target.symbol ? { symbol: target.symbol } : {}),
        },
        'subject',
        `The asset behind ${target.label}`,
      )
    }
  } else if (location.tab) {
    push(refFromTab(location.tab), 'subject', 'The tab you are on')
  }

  // 3 — the asset behind the subject, when the subject is something else.
  if (target?.assetId) {
    push(
      {
        type: 'asset',
        id: target.assetId,
        label: target.symbol ?? undefined,
        ...(target.symbol ? { symbol: target.symbol } : {}),
      },
      'supporting',
      'The asset this hangs off',
    )
  }

  // 4 — the book the reader was looking from. Exposure changes most answers.
  const portfolioId = target?.portfolioId ?? location.tab?.data?.portfolioId ?? null
  const portfolioName = target?.portfolioName ?? location.tab?.data?.portfolioName ?? undefined
  if (portfolioId) {
    push(
      { type: 'portfolio', id: portfolioId, label: portfolioName ?? undefined },
      'supporting',
      'The book you were looking from',
    )
  }

  // ── Apply the budget, in priority order ─────────────────────────────────
  const selected: SelectedObject[] = []
  let spent = 0

  for (const candidate of candidates) {
    if (selected.length >= budget.maxObjects) {
      dropped.push({ ref: candidate.ref, reason: 'object_cap' })
      continue
    }
    const cost = OBJECT_TOKEN_COST[candidate.ref.type] ?? 500
    if (spent + cost > budget.maxTokens) {
      dropped.push({ ref: candidate.ref, reason: 'budget' })
      continue
    }
    spent += cost
    selected.push({ ...candidate.ref, role: candidate.role, why: candidate.why, estimatedTokens: cost })
  }

  const tags: AiTag[] = []
  for (const object of selected) {
    const tagType = TAGGABLE[object.type]
    if (!tagType) continue
    tags.push({ type: tagType, id: object.id, ...(object.label ? { label: object.label } : {}) })
  }

  return {
    subject: selected.find(o => o.role === 'subject') ?? selected[0] ?? null,
    selected,
    tags,
    // The allowlist is every SELECTED object — including the ones with no tag.
    // An idea the reader is looking at was named in the conversation even
    // though the edge function assembles no context block for it, and
    // "open the idea you are already on" is a legitimate recommendation.
    allowlist: selected
      .filter(o => ACTIONABLE.has(o.type))
      .map(o => ({
        type: o.type as AiObjectType,
        ...(o.label !== undefined ? { label: o.label } : {}),
        ...(o.symbol !== undefined ? { symbol: o.symbol } : {}),
        id: o.id,
      })),
    estimatedTokens: spent,
    dropped,
  }
}

/**
 * The selection as a line the user can read.
 *
 * The pane shows this so what the model was given is never a mystery. It
 * describes the SELECTION, so it cannot drift from what was actually sent.
 */
export function describeSelection(selection: ContextSelection): string {
  if (selection.selected.length === 0) return 'No object context'
  return selection.selected
    .map(o => (o.symbol ?? o.label ?? o.type))
    .join(', ')
}
