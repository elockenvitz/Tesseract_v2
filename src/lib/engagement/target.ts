/**
 * The engagement seam — target adapters.
 *
 * Pure functions. No React, no Supabase, no window. Everything here is
 * directly testable and is what mobile will reuse when it adopts the seam.
 */

import type { TagRef, TagType } from '../../hooks/useAI'
import type { DecisionContext } from '../../engine/decisionEngine/types'
import type {
  EngagementContextChip,
  EngagementObjectType,
  EngagementTarget,
} from './types'

// ---------------------------------------------------------------------------
// AI tags
// ---------------------------------------------------------------------------

/**
 * `ai_conversation_tags.tag_type` only understands four kinds.
 *
 * This is not a limitation worth routing around: the tag is what the
 * `ai-chat` edge function resolves into a context block, and it only knows
 * how to assemble context for these four. Inventing a fifth tag type here
 * would produce a conversation tagged with something the server silently
 * ignores — the tag would look present in the UI and contribute nothing.
 */
const AI_TAGGABLE: Partial<Record<EngagementObjectType, TagType>> = {
  asset: 'asset',
  portfolio: 'portfolio',
  theme: 'theme',
  note: 'note',
}

/**
 * The tags a new AI conversation about this target should start with.
 *
 * Returns the object's own tag when it has one, and otherwise falls back to
 * the asset and portfolio the object hangs off. A research note is not itself
 * taggable, but a research note about AMZN inside the Growth Composite still
 * gives the model AMZN's thesis and the portfolio — which is the entire point
 * of the seam. An empty array is a valid, honest answer: it means "we could
 * not bind anything", and the caller should not claim context was supplied.
 */
export function toAITags(target: EngagementTarget): TagRef[] {
  const tags: TagRef[] = []
  const own = AI_TAGGABLE[target.objectType]

  if (own) {
    tags.push({ type: own, id: target.objectId, label: target.label })
  } else if (target.assetId) {
    tags.push({ type: 'asset', id: target.assetId, label: target.symbol ?? target.label })
  }

  // Portfolio rides along whenever it is not already the subject, because
  // exposure changes the answer to most questions worth asking.
  if (target.portfolioId && target.objectType !== 'portfolio') {
    tags.push({ type: 'portfolio', id: target.portfolioId, label: target.portfolioName })
  }

  return tags
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * Object types that can carry a `messages` thread today.
 *
 * This list is evidence-based, not aspirational. `supabase/migrations/` does
 * not contain a definition of `messages` at all — production and the migration
 * ledger describe different databases — so the constraint on
 * `messages.context_type` cannot be read statically, and a value that violates
 * it would fail at insert time in front of a user.
 *
 * Every entry below is a value that shipping production code already reads or
 * writes against `messages`:
 *   asset / portfolio / theme / note  — read by MessagingSection's inbox
 *   trade_idea                        — written by TradeIdeaDiscussion
 *   quick_thought                     — written by IdeaComments
 *
 * `research_note`, `decision` and `coverage` are deliberately absent. Stage D1
 * would rather offer no Discuss button on those surfaces than offer one that
 * throws. Widening this list is a schema question for a later stage, and the
 * seam is built so that widening it is a one-line change here.
 */
export const DISCUSSABLE_OBJECT_TYPES = [
  'asset',
  'portfolio',
  'theme',
  'note',
  'trade_idea',
  'quick_thought',
] as const satisfies readonly EngagementObjectType[]

export type DiscussableObjectType = (typeof DISCUSSABLE_OBJECT_TYPES)[number]

/** The `(context_type, context_id)` pair a thread for this target lives under. */
export interface ThreadKey {
  contextType: DiscussableObjectType
  contextId: string
}

export function canDiscuss(target: EngagementTarget): boolean {
  return toThreadKey(target) !== null
}

/**
 * Where this target's thread lives, or null when it cannot hold one.
 *
 * Note what this deliberately does NOT do: it never falls back to the asset.
 * A comment about a research note is not a comment about the asset, and
 * quietly redirecting it would put the conversation somewhere the user did not
 * choose and cannot find again.
 */
export function toThreadKey(target: EngagementTarget): ThreadKey | null {
  if (!target.objectId) return null
  const t = DISCUSSABLE_OBJECT_TYPES.find(k => k === target.objectType)
  return t ? { contextType: t, contextId: target.objectId } : null
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** One line naming the object and, when there is one, the issue. */
export function describeTarget(target: EngagementTarget): string {
  const head = target.symbol && target.symbol !== target.label
    ? `${target.symbol} · ${target.label}`
    : target.label
  return target.issue ? `${head} — ${target.issue.title}` : head
}

/**
 * The chips shown as "context already supplied".
 *
 * Falls back to describing the binding when the surface supplied none, so the
 * pane can always tell the user what it bound rather than claiming nothing.
 */
export function contextChipsFor(target: EngagementTarget): EngagementContextChip[] {
  if (target.contextChips?.length) return target.contextChips

  const chips: EngagementContextChip[] = []
  if (target.symbol) chips.push({ label: 'Asset', value: target.symbol })
  if (target.portfolioName) chips.push({ label: 'Portfolio', value: target.portfolioName })
  if (target.issue?.reason) chips.push({ label: 'Raised by', value: target.issue.reason })
  return chips
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * Build a target from an engine `DecisionContext`.
 *
 * The subject is chosen most-specific-first — a trade idea is more specific
 * than the asset it concerns, which is more specific than the portfolio it
 * sits in. Everything not chosen as the subject is retained as context, so
 * nothing the evaluator knew is lost; it is only demoted.
 *
 * Returns null when the context names no object at all, which is a real case:
 * some intel items are about the book rather than about a thing.
 */
export function fromDecisionContext(
  context: DecisionContext,
  extra: {
    label: string
    issue?: EngagementTarget['issue']
    origin?: EngagementTarget['origin']
    seedPrompt?: string
    contextChips?: EngagementContextChip[]
  },
): EngagementTarget | null {
  const base = {
    label: extra.label,
    symbol: context.assetTicker,
    assetId: context.assetId,
    portfolioId: context.portfolioId,
    portfolioName: context.portfolioName,
    origin: extra.origin,
    issue: extra.issue,
    seedPrompt: extra.seedPrompt,
    contextChips: extra.contextChips,
  }

  if (context.tradeIdeaId) {
    return { ...base, objectType: 'trade_idea', objectId: context.tradeIdeaId }
  }
  if (context.assetId) {
    return { ...base, objectType: 'asset', objectId: context.assetId }
  }
  if (context.portfolioId) {
    return { ...base, objectType: 'portfolio', objectId: context.portfolioId }
  }
  return null
}
