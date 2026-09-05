/**
 * What a reader can actually make from an object.
 *
 * ── Audited, not imagined ────────────────────────────────────────────────
 *
 * Every entry here maps to a capture form that exists and persists today. The
 * product's capture registry is `PendingCaptureType` in `sidebarStore`, and
 * `ThoughtsSection.handleOpenCapture` renders one form per mode:
 *
 *   idea        a thought against the object
 *   trade_idea  a trade idea against the asset
 *   prompt      a question assigned to a named person, with its own visibility
 *   proposal    a recommendation, which requires an existing trade idea
 *
 * Two things are deliberately NOT offered:
 *
 *   Research note   there is no capture type for one. Research is written on
 *                   the Asset page through the thesis editor, and the
 *                   workbench already routes there with "Edit on the asset".
 *                   A second entry point that opened the same editor under a
 *                   different name would be a menu item pretending to be a
 *                   workflow.
 *
 *   Task / follow-up  no such object exists in the product. Nothing here
 *                   invents one.
 *
 * `prompt` survives the "is this just Ask AI?" test: Ask AI opens the model
 * pane, while a prompt is a persisted question assigned to a teammate with a
 * visibility choice. Different object, different destination, both kept.
 */

import type { FocusIntent } from '../dashboard/focus'

/** The capture modes the sidebar can be opened directly into. */
export type CreateKind = 'idea' | 'trade_idea' | 'prompt' | 'proposal'

export interface CreateAction {
  kind: CreateKind
  /** The verb, as it appears in the menu. */
  label: string
  /** One line saying what it makes, for the reader who has not met it. */
  hint: string
}

/** What the object is, in the terms the capture sidebar needs. */
export interface CreateContext {
  /** Stable id of the asset the object hangs off. Required for a trade idea. */
  assetId?: string | null
  symbol?: string | null
  /** Whether a trade idea already exists on this name. */
  hasLiveIdea?: boolean
}

const ACTIONS: Record<CreateKind, Omit<CreateAction, 'kind'>> = {
  trade_idea: { label: 'Trade idea', hint: 'A proposed trade on this name' },
  idea: { label: 'Thought', hint: 'A note against this object' },
  prompt: { label: 'Question for someone', hint: 'Assign a question to a teammate' },
  proposal: { label: 'Recommendation', hint: 'Submit a recommendation on an existing idea' },
}

/**
 * What can be made from this object, given what the reader reached for.
 *
 * ── Why the intent narrows it ────────────────────────────────────────────
 *
 * A reader inspecting the written case is thinking about the argument, and
 * offering them a trade idea there is the menu guessing. A reader inspecting
 * the price is thinking about the position. The object's own capability is the
 * outer bound; the intent only removes what is unlikely to be wanted, and
 * never adds something the object cannot support.
 *
 * A trade idea needs a real `assetId` -- the capture form hangs it off the
 * asset -- so a finding with no asset simply cannot offer one, whatever the
 * intent. That is the reason for the capability check rather than a fixed
 * list per intent.
 */
export function createActionsFor(
  ctx: CreateContext, intent: FocusIntent = 'overview',
): CreateAction[] {
  const kinds: CreateKind[] = []

  const canTrade = !!ctx.assetId
  // The recommendation form opens by selecting an existing trade idea, so it
  // is only honest to offer where one exists.
  const canRecommend = canTrade && !!ctx.hasLiveIdea

  if (intent === 'claim') {
    // The argument, not the trade.
    kinds.push('idea', 'prompt')
  } else if (intent === 'price' || intent === 'book') {
    if (canTrade) kinds.push('trade_idea')
    if (canRecommend) kinds.push('proposal')
    kinds.push('idea')
  } else {
    if (canTrade) kinds.push('trade_idea')
    if (canRecommend) kinds.push('proposal')
    kinds.push('idea', 'prompt')
  }

  return kinds.map(kind => ({ kind, ...ACTIONS[kind] }))
}

/**
 * Open the capture sidebar on one form, with the object already bound.
 *
 * Routed on `assetId`, never on the ticker or the heading: the capture form
 * stores `context_id`, and a name would attach the new object to whichever
 * asset happened to share it.
 *
 * This is the same event the decision engine's `OPEN_ASSET_CREATE_IDEA`
 * dispatches, so nothing new is introduced -- the Dashboard now raises the
 * creation the rest of the product already raises.
 */
export function openCreate(kind: CreateKind, ctx: CreateContext): boolean {
  if (typeof window === 'undefined') return false
  if (!ctx.assetId) return false
  window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
    detail: {
      contextType: 'asset',
      contextId: ctx.assetId,
      contextTitle: ctx.symbol ?? undefined,
      captureType: kind,
    },
  }))
  return true
}
