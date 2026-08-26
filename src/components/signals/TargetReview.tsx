import { clsx } from 'clsx'

import { TARGET_REVIEW_CHOICES, type TargetReviewChoice } from '../../lib/signals/target-review'

/**
 * The resolution surface for an expired target: choose, then act in the footer.
 *
 * ── The bug this rewrite exists to remove ─────────────────────────────────
 *
 * Selecting a choice used to COMMIT it. `applyVerdict` ran on the pane's own
 * send button — writing a localStorage disposition, an `audit_events` row and a
 * quick thought — and only then opened the editor the choice called for. So
 * "Keep target" wrote a `settled` disposition, which `isDisposedOf` suppresses
 * for ninety days, BEFORE the horizon was refreshed. A reader who opened the
 * horizon picker and backed out had silently hidden the card until November
 * with the view still expired, and nothing they could do would bring it back.
 *
 * Opening a flow is not completing it. Selection is now inert: it changes what
 * the sticky footer offers and nothing else. Every mutation, every judgment and
 * every audit row happens on a successful save inside the flow the footer
 * opens — see `TargetExpiredPanes`.
 *
 * ── One primary, in one place ─────────────────────────────────────────────
 *
 * The pane carried its own filled commit button while the sticky footer showed
 * the same action, so "Refresh horizon" appeared twice on one card with nothing
 * to say which was authoritative. The body has no primary action at all now.
 * What sits under the choices is the optional note, in a fixed position, so it
 * does not move as selections change.
 */

interface TargetReviewProps {
  /** The question, which must cover all four answers. */
  question: string
  selected: TargetReviewChoice | null
  onSelect: (choice: TargetReviewChoice | null) => void
  /** The note, owned by the card so it survives a cancelled flow. */
  note: string
  onNoteChange: (note: string) => void
  /** Set while a flow is saving, so the pane reads as busy. */
  saving?: boolean
  /** Set when a save failed, shown inline without losing the selection. */
  error?: string | null
}

export function TargetReview({
  question, selected, onSelect, note, onNoteChange, saving, error,
}: TargetReviewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden" data-testid="target-review">
      {/* Labels the radiogroup for assistive tech. The card's prompt already
          asks this visually, so it is not printed twice. */}
      <p id="target-review-question" className="sr-only">{question}</p>

      <div
        role="radiogroup"
        aria-labelledby="target-review-question"
        className="grid min-h-0 grid-cols-2 gap-1.5"
        data-testid="target-review-options"
      >
        {TARGET_REVIEW_CHOICES.map(c => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={selected?.key === c.key}
            data-verdict={c.key}
            disabled={saving}
            // Toggling off is deliberate: a reader who taps the wrong answer
            // clears it with a second tap rather than being stuck with a
            // footer offering something they did not mean.
            onClick={() => onSelect(selected?.key === c.key ? null : c)}
            className={clsx(
              // No `no-touch-target`: index.css gives buttons a 44px floor on
              // coarse pointers and this control must keep it.
              'flex min-h-[44px] items-center justify-center rounded-xl border px-2 py-1.5',
              'text-center text-[13px] font-semibold leading-tight transition-colors',
              saving && 'opacity-60',
              selected?.key === c.key
                ? c.key === 'target_still_valid'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'border-gray-900 bg-gray-100 text-gray-900 dark:border-white dark:bg-gray-800 dark:text-white'
                : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* What the choice means, above the note so the note's prompt reads as a
          follow-on from it. One line, clamped — the answer buttons must not
          move as the reader compares them. */}
      <p
        data-testid="target-review-consequence"
        className="line-clamp-1 shrink-0 text-[11px] leading-snug text-gray-500 dark:text-gray-400"
      >
        {selected?.consequence ?? 'Your answer changes what this feed shows you next.'}
      </p>

      {/*
        The note, in a FIXED position whatever is selected.

        It was a "+ Note" affordance that replaced the consequence row when
        opened, so the layout moved twice per interaction — once on selecting an
        answer and again on opening the field. A surface that reflows while
        somebody is deciding is a surface they stop trusting. It is always here,
        always the same height, and only its placeholder changes.

        Deliberately NO save button of its own. The note travels with whatever
        the footer's primary does; a second commit control inside an optional
        field is how a reader ends up with two records of one decision.
      */}
      <div className="mt-auto shrink-0">
        <label
          htmlFor="target-review-note"
          className="text-[10px] font-bold uppercase tracking-wide text-gray-400"
        >
          Note · optional
        </label>
        <input
          id="target-review-note"
          data-testid="target-review-note"
          value={note}
          disabled={saving}
          onChange={e => onNoteChange(e.target.value)}
          placeholder={selected?.notePlaceholder ?? 'Anything worth adding?'}
          className="mt-1 h-9 w-full rounded-lg border border-gray-300 px-2.5 text-[13px] disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900"
        />
        {/* Failure is stated here and the selection is KEPT, so the reader
            retries rather than re-deciding. */}
        {error && (
          <p
            role="alert"
            data-testid="target-review-error"
            className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
