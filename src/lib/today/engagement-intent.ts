/**
 * Carrying WHICH PART of an object an engagement is about.
 *
 * ── Why an adapter rather than a change to the seam ──────────────────────
 *
 * The engagement seam is owned elsewhere and a later stage gives it a proper
 * affordance contract. Until then Today needs one thing the seam does not yet
 * model: Ask AI raised from the framework is not the same question as Ask AI
 * raised from the card, and the pane should open knowing the difference.
 *
 * This is deliberately the narrowest possible adapter. It adds no field to
 * `EngagementTarget`, introduces no second identity, and can be deleted in one
 * edit when the real contract lands.
 *
 * ── What it must never do ────────────────────────────────────────────────
 *
 * Replace the object. `objectId` still names the one object the engagement is
 * about, and two findings on one ticker stay distinct because the intent is
 * not part of what identifies them. The intent only refines the question, and
 * `issue.reason` is untouched — it keys the primary-action registry, and
 * changing it per sub-object would silently unregister every verb.
 */

import type { EngagementTarget } from '../engagement'
import type { FocusIntent } from '../dashboard/focus'

/** What the pane says it was given, per part of the object. */
const CHIP_LABEL: Record<FocusIntent, string | null> = {
  overview: null,
  claim: 'The written claim',
  framework: 'The case framework',
  price: 'Price history',
  book: 'Position and book',
}

/** The question a reader reaching for that part is most likely asking. */
const SEED: Record<FocusIntent, (t: EngagementTarget) => string | null> = {
  overview: () => null,
  claim: t => `Does the written case for ${t.symbol ?? t.label} still hold?`,
  framework: t => `Where does the price sit against the cases we wrote for ${t.symbol ?? t.label}, and which case is now hardest to defend?`,
  price: t => `What has ${t.symbol ?? t.label} done since we last looked, and does it change anything?`,
  book: t => `What does our position in ${t.symbol ?? t.label} look like against the rest of the book?`,
}

/**
 * Refine a target with the part of the object the reader engaged with.
 *
 * `overview` returns the target untouched — a click on the card's own ground
 * is a question about the object, which is what the target already says.
 */
export function withIntent(
  target: EngagementTarget, intent: FocusIntent,
): EngagementTarget {
  if (intent === 'overview') return target

  const chip = CHIP_LABEL[intent]
  const seed = SEED[intent](target)

  return {
    ...target,
    // The surface's suggestion, replaced rather than appended: a reader who
    // reached for the framework asked about the framework, and stacking the
    // general question underneath it would make the composer argue with itself.
    seedPrompt: seed ?? target.seedPrompt,
    contextChips: chip
      ? [{ label: 'Focus', value: chip }, ...(target.contextChips ?? [])]
      : target.contextChips,
  }
}
