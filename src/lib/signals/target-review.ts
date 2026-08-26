import type { VerdictOption } from '../../components/signals/VerdictBar'

/**
 * The four ways an expired target gets resolved, each with its own words.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * One generic sentence and one generic button for all four. Every choice
 * showed `consequenceOf(disposition)` — "Keeps it in your feed and opens a note
 * so the work is written down" — and a commit button reading **Write it down**.
 *
 * That is a true statement about the FEED and a useless one about the decision.
 * "Replace with cases" and "Needs review" are not the same act, they do not
 * produce the same artefact, and telling the reader that both will write a note
 * describes the least interesting thing either of them does. Worse, "Write it
 * down" is what the button said on the one choice — Revise target — whose whole
 * point is that a number changes.
 *
 * So the copy and the CTA belong to the CHOICE. `VerdictBar` still falls back
 * to the generic pair, which is right for the seven other card types that have
 * no per-option story to tell.
 *
 * ── Why the keys are untouched ────────────────────────────────────────────
 *
 * `target_still_valid`, `target_revise`, `target_replace_with_cases` and
 * `target_needs_review` are already recorded against real judgments and are
 * classified in `judgment-policy`. Copy is copy; a semantic key that stops
 * being comparable to last quarter's is a record of nothing. Only the prose and
 * the button move.
 */

export type TargetReviewKey =
  | 'target_still_valid'
  | 'target_revise'
  | 'target_replace_with_cases'
  | 'target_needs_review'

/** What choosing this opens, once the judgment is recorded. */
export type TargetReviewSurface =
  /** The compact horizon-and-target editor, inline on the card. */
  | 'refresh_horizon'
  /** The same editor, with the number editable as well as the horizon. */
  | 'revise_target'
  /** `MobileCaseTargets` in the existing sheet — Bull / Base / Bear. */
  | 'cases'
  /** A short note saying what needs work. The signal stays. */
  | 'note'

export interface TargetReviewChoice {
  key: TargetReviewKey
  surface: TargetReviewSurface
  /** The button in the 2x2 grid. */
  label: string
  /** One sentence saying what this choice means. Replaces the generic line. */
  consequence: string
  /**
   * The card's sticky primary once this choice is selected.
   *
   * There is exactly ONE primary mechanism and it is the sticky footer. The
   * review body previously carried its own filled commit button as well, so
   * "Refresh view" appeared twice on one card a few hundred pixels apart, and
   * neither said which was authoritative.
   */
  cta: string
  /** What the optional note field asks for, per choice. */
  notePlaceholder: string
}

/**
 * "Still valid" is not a no-op, and this is the correction that matters most.
 *
 * The signal fires on an elapsed clock, so a reader who says the number still
 * stands has answered the price question and NOT the horizon one. Recording
 * that as settled and moving on leaves a view that is still, on its own terms,
 * expired — the card would clear for ninety days and come back saying the same
 * thing, because nothing about the data changed.
 *
 * So it carries a horizon refresh. The price view is kept exactly as it is; the
 * only thing being restated is how long it is meant to stand for, which is the
 * one fact that ran out.
 */
export const TARGET_REVIEW_CHOICES: TargetReviewChoice[] = [
  {
    key: 'target_still_valid',
    surface: 'refresh_horizon',
    // "Still valid" was ambiguous in exactly the way this card is about: the
    // TARGET may still be valid while its horizon has objectively expired, so
    // the label appeared to contradict the finding. "Keep target" says what
    // the reader is choosing to do rather than making a claim the card denies.
    label: 'Keep target',
    consequence: 'The number stands. Its horizon ran out, so it needs a new one.',
    cta: 'Refresh horizon',
    notePlaceholder: 'Why does the view still hold?',
  },
  {
    key: 'target_revise',
    surface: 'revise_target',
    label: 'Revise target',
    consequence: 'A new number and a new horizon, replacing what expired.',
    cta: 'Revise target',
    notePlaceholder: 'What changed?',
  },
  {
    key: 'target_replace_with_cases',
    surface: 'cases',
    /**
     * The CTA says REVIEW, because the ladder already exists.
     *
     * Measured against production: every name carrying an expired target also
     * carries Bull / Base / Bear — AAPL has four scenarios, AMZN, CEG, GOOGL,
     * TSLA, PLTR, COIN and DASH have three each. A target IS a case (one row
     * per `scenario_id`), so there is no "replace" operation in the data model
     * at all, and a CTA reading "Build cases" promises to create something that
     * is already there. The card resolves the single-point view by moving the
     * reader's attention to the ladder, not by constructing one.
     */
    label: 'Replace with cases',
    consequence: 'Moves the view onto the Bull / Base / Bear ladder for this name.',
    cta: 'Review cases',
    notePlaceholder: 'Why is a scenario framework more appropriate?',
  },
  {
    key: 'target_needs_review',
    surface: 'note',
    // "Needs review" was ambiguous because the reader is already IN the review.
    label: 'Review later',
    consequence: 'Keeps the signal open. Nothing about the target changes.',
    cta: 'Keep open',
    notePlaceholder: 'What still needs work?',
  },
]

export function choiceFor(key: string | null | undefined): TargetReviewChoice | null {
  return TARGET_REVIEW_CHOICES.find(c => c.key === key) ?? null
}

/**
 * The verdict options this card offers, in the reader's words.
 *
 * `disposition` is the FEED state and is deliberately unchanged from what these
 * keys already recorded. Note that only `target_still_valid` settles: the other
 * three are `flagged`, which `isDisposedOf` never suppresses — so "Needs
 * review" keeps the card, which is what the label promises.
 */
export function targetReviewOptions(symbol: string): VerdictOption[] {
  return TARGET_REVIEW_CHOICES.map(c => ({
    key: c.key,
    // User-facing copy comes from the choice; the KEY is what persists and is
    // deliberately untouched. `target_still_valid` has been recorded against
    // real judgments and is classified in `judgment-policy`; renaming it would
    // orphan every answer already given.
    label: c.label,
    tone: (c.key === 'target_still_valid' ? 'affirm' : 'neutral') as VerdictOption['tone'],
    // Only "Keep target" settles. The other three are `flagged`, which
    // `isDisposedOf` never suppresses — so "Review later" keeps the card,
    // which is exactly what its label promises.
    disposition: (c.key === 'target_still_valid' ? 'settled' : 'flagged') as VerdictOption['disposition'],
    note: NOTE_FOR[c.key](symbol),
    consequence: c.consequence,
    commitLabel: c.cta,
    ...(c.key === 'target_replace_with_cases'
      ? { nextAction: { id: 'open_cases', label: 'Review cases' } }
      : {}),
  }))
}

/** The generated sentence each judgment writes, in the first person. */
const NOTE_FOR: Record<TargetReviewKey, (s: string) => string> = {
  target_still_valid: s =>
    `${s}: the target still stands; only its horizon lapsed, and it has been given a new one.`,
  target_revise: s => `${s}: the target has been revised now its horizon has run out.`,
  target_replace_with_cases: s =>
    `${s}: a single target is the wrong shape for this name; the view belongs on the case ladder.`,
  target_needs_review: s => `${s}: the target needs work; left open deliberately.`,
}

/**
 * Whether a resolution actually resolves the signal.
 *
 * ── The rule the editor enforces ──────────────────────────────────────────
 *
 * A target whose price moves but whose horizon is still the expired one has not
 * answered this card. The signal fires on `ageMonths - timeframeMonths >= 2`
 * and on nothing else, so a new number under a dead clock leaves the trigger
 * exactly where it was — the card would return, correctly, saying the view has
 * outlived its horizon, and the reader would reasonably conclude their edit was
 * lost.
 *
 * So both editing paths require a horizon before they will save. This is the
 * predicate, kept out of the component so it can be asserted directly.
 */
export function resolvesExpiry(input: {
  horizon: string | null | undefined
  /** True when the horizon chosen is the one that already expired. */
  horizonUnchanged?: boolean
}): boolean {
  if (!input.horizon) return false
  return !input.horizonUnchanged
}
