import { primaryActionFor } from './model'
import type { IdeaRow } from './model'
import type { IdeasSelection } from './selection'

/**
 * The one next step a candidate can take from the feed.
 *
 * ── The rule this enforces ────────────────────────────────────────────────
 *
 * A visible CTA must either perform a real workflow transition or enter a work
 * mode more specific than clicking the tile. Clicking the tile already opens
 * the workspace, so a button that lands in the SAME state is a second control
 * for one action and returns null here.
 *
 * That is why this returns a `mode` rather than just a label: the mode is the
 * evidence that the destination differs. A label with no mode and no mutation
 * has nothing to justify occupying the card.
 *
 * ── What it does not do ───────────────────────────────────────────────────
 *
 * Mutate. `Advance research` and `Advance thesis` OPEN the work; they do not
 * write a stage. Entering a research view is not evidence that research
 * happened, and a CTA that advanced a pipeline because somebody looked at it
 * would put false progress into the record.
 *
 * Machine-derived families return null. Their existing actions already resolve
 * to the same asset-and-focus destination the tile opens, and this stage is
 * not inventing transitions for findings.
 */

export type ProgressionMode =
  /** Open the idea workspace focused on a specific module. */
  | { kind: 'idea_focus'; focus: 'research' | 'thesis' | 'decision' }
  /** Open the promote-to-trade-idea flow over the feed. */
  | { kind: 'promote_thought' }
  /** Open the prompt workspace with the response composer open. */
  | { kind: 'prompt_respond' }
  /** Write the prompt's status. A real transition, no navigation. */
  | { kind: 'prompt_resolve' }

export interface Progression {
  label: string
  mode: ProgressionMode
}

/** A prompt's status, as the tag model stores it. */
export function promptStatus(tags: string[] | null | undefined): 'open' | 'responded' | 'closed' {
  const t = tags?.find(x => x.startsWith('status:'))?.slice(7)
  return t === 'responded' || t === 'closed' ? t : 'open'
}

/**
 * `primaryActionFor` already names the truthful verb for a maturity. The work
 * here is deciding whether that verb has somewhere distinct to go.
 */
function ideaProgression(idea: IdeaRow, canDecide: boolean): Progression | null {
  const label = primaryActionFor(idea, undefined, canDecide)
  if (!label) return null

  switch (idea.maturity) {
    case 'researching':
      return { label, mode: { kind: 'idea_focus', focus: 'research' } }
    case 'thesis_forming':
      return { label, mode: { kind: 'idea_focus', focus: 'thesis' } }
    case 'decision_ready':
    case 'deciding':
      /*
       * `Decide` enters the decision module, which is where a decision is
       * actually recorded. Without a track that can record one the verb is
       * "Review decision" — still a distinct module rather than the workspace
       * default, so it still earns its place.
       */
      return { label, mode: { kind: 'idea_focus', focus: 'decision' } }
  }
}

export function progressionFor(
  selection: IdeasSelection,
  opts: { idea?: IdeaRow | null; canDecide?: boolean } = {},
): Progression | null {
  if (selection.family !== 'post') return null

  if (selection.postType === 'trade_idea') {
    if (!opts.idea) return null
    return ideaProgression(opts.idea, opts.canDecide ?? false)
  }

  if (selection.postType === 'thought') {
    const item = selection.item as unknown as { promoted_to_trade_idea_id?: string | null } | null
    // Already a trade idea. Offering it again would create a second one.
    if (item?.promoted_to_trade_idea_id) return null
    return { label: 'Promote to trade idea', mode: { kind: 'promote_thought' } }
  }

  if (selection.postType === 'prompt') {
    const item = selection.item as unknown as { tags?: string[] | null } | null
    const status = promptStatus(item?.tags)
    if (status === 'open') return { label: 'Respond', mode: { kind: 'prompt_respond' } }
    if (status === 'responded') return { label: 'Resolve', mode: { kind: 'prompt_resolve' } }
    // Closed. The conversation is over; there is nothing to advance.
    return null
  }

  return null
}
