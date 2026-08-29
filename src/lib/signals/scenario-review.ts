import type { VerdictOption } from '../../components/signals/VerdictBar'
import type { DispositionKind } from './dispositions'

/**
 * The four answers to "has the investment view changed?", in one place.
 *
 * ── Why the keys are untouched, and must stay untouched ───────────────────
 *
 * `scenario_thesis_intact`, `scenario_thesis_weaker`, `scenario_cases_outdated`
 * and `scenario_needs_review` are already recorded against real judgments in
 * `audit_events`, are classified in `judgment-policy` (with distinct quiet
 * windows of 30 / 7 / 7 / 3 days and distinct penalties), and are what any
 * downstream analysis reads. Copy is copy; a semantic key that stops being
 * comparable to last quarter's is a record of nothing.
 *
 * So this module MOVES the option set out of a 5,000-line component and adds
 * the two pieces of copy the new pane needs — a consequence line and a note
 * placeholder — and changes nothing else. Labels, notes, dispositions and
 * follow-on actions are the ones the feed has been writing.
 *
 * ── Why it is a module rather than a literal in the card ──────────────────
 *
 * Two consumers now render the same four answers: the feed and the gallery
 * fixture the phone suite measures. They were separate literals that had
 * already drifted — the gallery's `scenario_cases_outdated` note read "the
 * cases are stale rather than the view" where the app's read "the cases are
 * stale rather than the view. They need restating against where the price
 * actually is." A fixture that is a paraphrase of the card is a guard
 * measuring something adjacent to what ships.
 *
 * Pure: no React, no Supabase, no clock. The gallery entry has no Supabase
 * environment and has to be able to import this.
 */

export type ScenarioReviewKey =
  | 'scenario_thesis_intact'
  | 'scenario_thesis_weaker'
  | 'scenario_cases_outdated'
  | 'scenario_needs_review'

export interface ScenarioReviewChoice {
  key: ScenarioReviewKey
  /** The button in the 2×2 grid. Copy — safe to reword, unlike `key`. */
  label: string
  /**
   * How the FEED treats the card afterwards. A compatibility mapping, and
   * deliberately not a description of the judgment — see `dispositions`.
   */
  disposition: DispositionKind
  tone: 'affirm' | 'neutral' | 'negate'
  /**
   * One sentence saying what THIS answer means, in place of the generic
   * disposition line.
   *
   * `consequenceOf(disposition)` describes what happens to the feed, which is
   * true of three of these four identically and interesting about none of them.
   * On a card whose four answers are four different claims about the thesis,
   * one sentence for all four tells the reader nothing about the one they are
   * about to press.
   */
  consequence: string
  /** What the optional note asks for, per answer. */
  notePlaceholder: string
  /** The first-person prose recorded as a quick thought. `{sym}` is the ticker. */
  note: string
  /** Declared follow-on, resolved by the feed. Absent where the answer is complete. */
  nextAction?: { id: string; label: string }
}

export const SCENARIO_REVIEW_CHOICES: ScenarioReviewChoice[] = [
  {
    key: 'scenario_thesis_intact',
    label: 'Thesis intact',
    disposition: 'settled',
    tone: 'affirm',
    consequence: 'Records that the view stands and stops asking for a month.',
    notePlaceholder: 'Why does the view still hold?',
    note: '{sym}: the thesis is intact; the market has moved, my view has not.',
  },
  {
    key: 'scenario_thesis_weaker',
    label: 'Thesis weaker',
    disposition: 'flagged',
    tone: 'neutral',
    consequence: 'Flags the position as needing work. Back in a week.',
    notePlaceholder: 'What has weakened?',
    note: '{sym}: the move outside my modelled range has weakened the thesis.',
    nextAction: { id: 'open_cases', label: 'Review cases' },
  },
  {
    key: 'scenario_cases_outdated',
    label: 'Cases outdated',
    disposition: 'flagged',
    tone: 'neutral',
    // The distinction this card exists to draw: the framework is stale, not
    // the view. Said plainly, because it is the answer readers reach for most
    // and the one the generic line describes worst.
    consequence: 'Says the framework is stale, not the view. Back in a week.',
    notePlaceholder: 'What should the cases say instead?',
    note: '{sym}: the cases are stale rather than the view. They need restating against where the price actually is.',
    nextAction: { id: 'open_cases', label: 'Review cases' },
  },
  {
    key: 'scenario_needs_review',
    label: 'Needs review',
    disposition: 'flagged',
    tone: 'neutral',
    consequence: 'Records that you have seen it and not decided. Back in three days.',
    notePlaceholder: 'What would settle it?',
    note: '{sym}: needs a proper review before I would call it either way.',
    nextAction: { id: 'open_cases', label: 'Review cases' },
  },
]

/**
 * The choices as `VerdictOption`s, which is what `applyVerdict` consumes.
 *
 * The write path is unchanged and shared: `recordSignalJudgment` takes a
 * `{ key, label, disposition, intent }` and knows nothing about which control
 * collected it. This adapter is the seam, so replacing the UI flow could not
 * accidentally become a second way of persisting a judgment.
 */
export function scenarioReviewOptions(symbol: string): VerdictOption[] {
  return SCENARIO_REVIEW_CHOICES.map(c => ({
    key: c.key,
    label: c.label,
    tone: c.tone,
    disposition: c.disposition,
    consequence: c.consequence,
    note: c.note.replace('{sym}', symbol),
    ...(c.nextAction ? { nextAction: c.nextAction } : {}),
  }))
}

/**
 * How much of their own words the reader may attach.
 *
 * 300, matching `QuickTradeIdeaCapture` and `AddTradeIdeaModal` — which is
 * where this text ends up, because `writeJudgmentThought` records it as a quick
 * thought under the generated sentence. A limit the note field enforces and the
 * destination does not would be a limit that shows up as a truncated record
 * rather than as a full field.
 */
export const SCENARIO_NOTE_MAX = 300
