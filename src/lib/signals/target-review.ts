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
  /** The commit button, and — once committed — the card's sticky primary. */
  cta: string
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
    label: 'Still valid',
    consequence: 'Keeps the target as it is. Its horizon ran out, so pick a new one.',
    cta: 'Refresh view',
  },
  {
    key: 'target_revise',
    surface: 'revise_target',
    label: 'Revise target',
    consequence: 'Opens the editor for a new number and a new horizon.',
    cta: 'Edit target',
  },
  {
    key: 'target_replace_with_cases',
    surface: 'cases',
    label: 'Replace with cases',
    consequence: 'Swaps the single number for a Bull / Base / Bear ladder.',
    cta: 'Build cases',
  },
  {
    key: 'target_needs_review',
    surface: 'note',
    label: 'Needs review',
    consequence: 'Leaves the signal open and records what needs working through.',
    cta: 'Add review note',
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
  return [
    {
      key: 'target_still_valid',
      label: 'Still valid',
      tone: 'affirm',
      disposition: 'settled',
      note: `${symbol}: the target still stands; only its horizon lapsed, and it has been given a new one.`,
      consequence: TARGET_REVIEW_CHOICES[0].consequence,
      commitLabel: TARGET_REVIEW_CHOICES[0].cta,
    },
    {
      key: 'target_revise',
      label: 'Revise target',
      tone: 'neutral',
      disposition: 'flagged',
      note: `${symbol}: the target needs revising now its horizon has run out.`,
      consequence: TARGET_REVIEW_CHOICES[1].consequence,
      commitLabel: TARGET_REVIEW_CHOICES[1].cta,
    },
    {
      key: 'target_replace_with_cases',
      label: 'Replace with cases',
      tone: 'neutral',
      disposition: 'flagged',
      note: `${symbol}: a single target is the wrong shape for this name; it should be scenarios.`,
      consequence: TARGET_REVIEW_CHOICES[2].consequence,
      commitLabel: TARGET_REVIEW_CHOICES[2].cta,
      // Routes to the ladder. Kept as a follow-on as well as a CTA because the
      // case editor is a genuinely different destination from this card's own
      // primary, which is the dedup rule `resolveNextFor` applies.
      nextAction: { id: 'open_cases', label: 'Review cases' },
    },
    {
      key: 'target_needs_review',
      label: 'Needs review',
      tone: 'neutral',
      disposition: 'flagged',
      note: `${symbol}: needs a proper review before I would call it either way.`,
      consequence: TARGET_REVIEW_CHOICES[3].consequence,
      commitLabel: TARGET_REVIEW_CHOICES[3].cta,
    },
  ]
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
