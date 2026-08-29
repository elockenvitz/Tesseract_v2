import { clsx } from 'clsx'

import {
  SCENARIO_NOTE_MAX,
  SCENARIO_REVIEW_CHOICES,
  type ScenarioReviewChoice,
} from '../../lib/signals/scenario-review'

/**
 * "Has the investment view changed?" — choose, add a note, submit in the footer.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * `VerdictBar`, which is the right control for the seven card types that have
 * no per-answer story, and the wrong one here. Three of its behaviours fought
 * this card:
 *
 *   1. It carries its OWN commit button inside the pane, so a card whose sticky
 *      footer already offers a primary showed two commit-shaped controls with
 *      nothing to say which was authoritative.
 *   2. The note is behind a "+ Note" affordance that REPLACES the consequence
 *      row when opened, so the layout moves twice per interaction — once on
 *      selecting an answer, again on opening the field.
 *   3. Its footer block reserves height for a consequence row, a note row and a
 *      button, which on a four-option 2×2 grid is what pushed the answers
 *      toward the carousel indicators.
 *
 * The pattern here is the one `TargetReview` already established for the
 * expired-target card: the body owns the CHOICE and the NOTE, the sticky footer
 * owns the commit, and selection mutates nothing. This is that pattern applied
 * to a second card type — not a second response system. Both funnel into the
 * same `applyVerdict` → `recordSignalJudgment` path.
 *
 * ── Selection mutates nothing ─────────────────────────────────────────────
 *
 * Choosing an answer changes what the footer offers and does nothing else: no
 * judgment, no audit row, no disposition, no quick thought. Every write happens
 * on the footer's `Submit response`, and only a successful one records
 * anything. That is the property the expired-target card was rewritten to gain
 * and the reason this card follows it rather than inventing a third shape.
 *
 * Pure: no Supabase, no hooks beyond what the parent passes. The gallery
 * renders it, which is where a card of this size gets measured.
 */

interface ScenarioRespondProps {
  /** The question. Labels the radiogroup; the card's prompt shows it visually. */
  question: string
  selected: ScenarioReviewChoice | null
  onSelect: (choice: ScenarioReviewChoice | null) => void
  /** Owned by the parent so it survives a failed submit. */
  note: string
  onNoteChange: (note: string) => void
  saving?: boolean
  /** Set when a submit failed. The selection and the note are kept. */
  error?: string | null
  /** Set once a response has been recorded, so the pane can say so. */
  recorded?: ScenarioReviewChoice | null
  /** Clears the recorded state so the reader can answer again. */
  onChangeAnswer?: () => void
}

export function ScenarioRespond({
  question, selected, onSelect, note, onNoteChange, saving, error, recorded, onChangeAnswer,
}: ScenarioRespondProps) {
  /**
   * The recorded state replaces the control rather than sitting under it.
   *
   * A grid of four answers with one of them ticked, plus a confirmation, plus a
   * note field nobody can now edit, is three explanations of one fact. What the
   * reader needs after answering is confirmation and a way to correct a
   * mis-tap.
   */
  if (recorded) {
    return (
      <div
        className="flex h-full min-h-0 flex-col justify-center gap-1.5 overflow-hidden"
        data-testid="scenario-respond-saved"
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          Your response
        </p>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[17px] font-bold text-gray-900 dark:text-white">
            {recorded.label}
            <span className="ml-1.5 text-emerald-600 dark:text-emerald-400" aria-hidden>✓</span>
          </span>
          {/* Correction is possible, and quiet. Choosing again writes a NEW
              judgment; it never edits the audit row already written. */}
          {onChangeAnswer && (
            <button
              type="button"
              data-testid="scenario-respond-change"
              onClick={onChangeAnswer}
              className="shrink-0 text-[12px] font-semibold text-gray-500 underline underline-offset-2 dark:text-gray-400 no-touch-target"
            >
              Change
            </button>
          )}
        </div>
        <p className="text-[12px] leading-snug text-gray-500 dark:text-gray-400">
          {recorded.consequence}
        </p>
        {note.trim() && (
          <p className="line-clamp-2 text-[12px] italic leading-snug text-gray-500 dark:text-gray-400">
            “{note.trim()}”
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden"
      data-testid="scenario-respond"
    >
      {/* Labels the radiogroup for assistive tech. The card's prompt already
          asks this visually, directly above the band, so printing it here would
          put one question on a 390px card twice in two type styles. */}
      <p id="scenario-respond-question" className="sr-only">{question}</p>

      <div
        role="radiogroup"
        aria-labelledby="scenario-respond-question"
        /*
          `shrink-0`, and this is the overlap bug.

          It was `min-h-0`, which in a flex column tells the browser this grid
          MAY be shrunk below its content. The content is two rows of 44px
          touch targets plus a gap — a floor, not a preference — so when the
          band was short the grid box shrank, the buttons did not, and they
          painted straight over the line beneath them. Reported from the phone
          as the helper text colliding with the answers; the helper was where
          it had always been, and the answers had left their box.

          A 2x2 of 44px targets is the one thing on this pane that cannot give
          up height. Everything below it can, and now does.
        */
        className="grid shrink-0 grid-cols-2 gap-1.5"
        data-testid="scenario-respond-options"
      >
        {SCENARIO_REVIEW_CHOICES.map(c => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={selected?.key === c.key}
            data-verdict={c.key}
            disabled={saving}
            // Toggling off is deliberate: a reader who taps the wrong answer
            // clears it with a second tap rather than being stuck with a footer
            // offering to submit something they did not mean.
            onClick={() => onSelect(selected?.key === c.key ? null : c)}
            className={clsx(
              // No `no-touch-target`: index.css gives buttons a 44px floor on
              // coarse pointers and the answer controls must keep it.
              'flex min-h-[44px] items-center justify-center rounded-xl border px-2 py-1.5',
              'text-center text-[13px] font-semibold leading-tight transition-colors',
              saving && 'opacity-60',
              selected?.key === c.key
                ? c.tone === 'affirm'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'border-gray-900 bg-gray-100 text-gray-900 dark:border-white dark:bg-gray-800 dark:text-white'
                : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/*
        What the CHOSEN answer means — and nothing at all before one is chosen.

        The placeholder was "Your answer changes what this feed shows you
        next.", which is true of every answer on every card of every type. It
        occupied the one line that exists to say what THIS answer does, it
        described the mechanism rather than the consequence, and a reader who
        has not answered yet has no use for it. Gone.

        The height is RESERVED rather than added on selection. Two lines at
        this size, whether or not anything is in them, so choosing an answer
        cannot push the note field down under the reader's thumb while they are
        still comparing options — the same reason the note stopped hiding
        behind "+ Note". `line-clamp-2` is the ceiling for a long consequence;
        the copy in `scenario-review.ts` fits one or two lines at 320px.

        In normal flow, `shrink-0`, nothing absolutely positioned. The overlap
        this pane had came from the grid above shrinking, not from this line
        being placed over anything.
      */}
      <div
        data-testid="scenario-respond-consequence"
        className="min-h-[30px] shrink-0"
      >
        {selected && (
          <p className="line-clamp-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
            {selected.consequence}
          </p>
        )}
      </div>

      {/*
        The note, always here, in a FIXED position whatever is selected.

        `VerdictBar` hides it behind "+ Note" and then swaps it in place of the
        consequence row, so the block reflows twice while somebody is deciding.
        It is always present, always the same height, and only its placeholder
        changes — which is the one thing that can change without moving anything.

        Deliberately NO save button of its own. The note travels with the
        footer's `Submit response`; a second commit control inside an optional
        field is how a reader ends up with two records of one decision.
      */}
      {/*
        Directly under the consequence, NOT pushed to the bottom of the band.

        `TargetReview` uses `mt-auto` and is right to: its band is short enough
        that the bottom is a few pixels below the answers. This card's carousel
        band measures 345px at 390x844, so `mt-auto` opened about 250px between
        the answer somebody had just chosen and the field asking them to explain
        it — and dropped the field onto the carousel indicator row, which is the
        one thing directly under it.

        Answer, consequence, note is one unit and should read as one. The slack
        falls below it, where it separates the pane from the indicators instead
        of splitting it in half.
      */}
      <div className="shrink-0">
        <label
          htmlFor="scenario-respond-note"
          className="text-[10px] font-bold uppercase tracking-wide text-gray-400"
        >
          Note · optional
        </label>
        {/*
          A TEXTAREA, because a 300-character note cannot be read in a
          single-line field.

          It was an `<input>`, and the two facts that made that unworkable are
          measurable rather than a matter of taste. The field is 352px of
          content width. Its text renders at 16px — `index.css` forces that on
          every input and textarea with `!important`, to stop iOS zooming the
          viewport on focus and never zooming back — so the `text-[13px]` this
          class list asks for was never what shipped, and the line holds about
          40 characters. `SCENARIO_NOTE_MAX` is 300.

          A single-line input given more text than it can show scrolls
          horizontally to keep the CARET visible, and everything behind the
          caret leaves the field to the left. Measured on the note in the
          gallery screenshot: `scrollWidth` 542 against a `clientWidth` of 352,
          `scrollLeft` 190 — the first 35 characters were 190px off the left
          edge, mid-word, while the reader was still typing. Nothing was lost
          and nothing was readable, which is the worst version of both.

          Wrapping is the fix, not padding: `px-2.5` was always applied and the
          text was not clipped BY it — the field was scrolled past it. Three
          rows at the 24px line-height the 16px rule implies show about 120
          characters at once, the note starts at the left edge and stays there,
          and a longer note scrolls VERTICALLY, which keeps the line being
          typed whole.

          `resize-none` because the card is a fixed band inside a carousel: a
          drag handle on this corner would let the reader grow the field
          through the indicator row below it.

          The pane has 131px of slack under this field at 390x844; three rows
          spend 48 of them. Nothing above moves, and `the response clears the
          indicators and the action bar` in `case-vs-price.spec.ts` is the
          assertion that keeps it honest.
        */}
        <textarea
          id="scenario-respond-note"
          data-testid="scenario-respond-note"
          rows={3}
          value={note}
          disabled={saving}
          maxLength={SCENARIO_NOTE_MAX}
          onChange={e => onNoteChange(e.target.value)}
          placeholder={selected?.notePlaceholder ?? 'Add note (optional)…'}
          className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-2.5 py-1.5 leading-6 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900"
        />
        {/* Failure is stated here and the selection is KEPT, so the reader
            retries rather than re-deciding. */}
        {error && (
          <p
            role="alert"
            data-testid="scenario-respond-error"
            className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
