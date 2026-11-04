import { clsx } from 'clsx'
import {
  useRecordThesisReview, useCurrentThesisConclusion, type ThesisReviewOutcome,
} from '../../hooks/useThesisReview'
import { conclusionWords } from '../../lib/memory/thesis-review'

/**
 * "Does the case still hold?", and the three answers.
 *
 * ── Why this is a component and not two copies ────────────────────────────
 *
 * It was written once, inline, in `ResearchDetail`, and the asset workspace
 * had nothing like it -- so a reader who arrived at a name FROM a finding
 * could read the case and had no way to say what they concluded. The only
 * durable trace of a conclusion was an edit, which means "it still holds"
 * and "this is broken" both had to be expressed by rewriting a document:
 * one that did not need editing, and one nobody had time to rewrite yet.
 *
 * Copying eighty lines into the second surface would put the verb in both
 * places and put the WORDING, the colours, the standing-answer rule and the
 * correction path in both places too. This codebase has paid for that kind
 * of fork before -- two filter taxonomies, two symbol caps, two definitions
 * of a trade's source. One component, two call sites.
 *
 * ── What it deliberately keeps from the original ──────────────────────────
 *
 * All of the reasoning that was proven in use, unchanged:
 *
 *   - OUTLINED, not filled. Three filled buttons would each claim to be the
 *     recommended answer, and the product must not nudge an analyst toward
 *     one conclusion about their own thesis.
 *   - The STANDING answer is filled, because it is a fact rather than an
 *     offer. It was also UNPRESSABLE, on the reasoning that pressing it would
 *     write a second identical event; that part did not survive -- see
 *     `VERDICT_SELECTED` -- because it left no way back to unanswered.
 *     Pressing it clears it now, which is neither a repeat nor a no-op.
 *   - `opacity` is not used to mark a button as unavailable: the standing one
 *     is the most informative thing on the bar and dimming it would make the
 *     record quieter than the alternatives to it.
 *   - A FIXED-WIDTH status slot. The sentence measured 272px and appeared,
 *     changed and disappeared under a single click, resizing the bar and
 *     sliding the buttons sideways by about half the delta each time --
 *     measured at 1920, the group moved ~140px across one press. So the slot
 *     is always present and always the same width, and the empty state says
 *     what the empty state IS rather than reserving a blank.
 */

/**
 * The three conclusions, in the order a reader reaches them.
 *
 * Wording matters here: each is a statement about the CASE, not an
 * instruction to the reader. "Needs work" says the document cannot be judged
 * as written -- a different fact from the case having broken, and the two
 * were previously both unsayable.
 */
const REVIEW_CHOICES: ReadonlyArray<{ outcome: ThesisReviewOutcome; label: string }> = [
  { outcome: 'holds', label: 'Still holds' },
  { outcome: 'changed', label: 'Changed' },
  { outcome: 'needs_work', label: 'Needs work' },
]

/**
 * Each answer in its own colour, because the row asked to be ignored.
 *
 * Three identical grey text buttons do not read as a choice -- they read as a
 * toolbar, which is how the one verb this surface has went unused. These are
 * the only coloured controls on the bar, and the colours are the product's
 * existing semantics rather than decoration: the case holding is the good
 * outcome, the case having changed is a fact to act on, and a case that
 * cannot be judged as written is the one that needs a person.
 */
const VERDICT_TONE: Record<ThesisReviewOutcome, string> = {
  holds:
    'border-emerald-300 bg-white text-emerald-800 hover:border-emerald-500 hover:bg-emerald-50 '
    + 'dark:border-emerald-800 dark:bg-transparent dark:text-emerald-300 dark:hover:bg-emerald-950/40',
  changed:
    'border-amber-300 bg-white text-amber-800 hover:border-amber-500 hover:bg-amber-50 '
    + 'dark:border-amber-800 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-950/40',
  needs_work:
    'border-rose-300 bg-white text-rose-800 hover:border-rose-500 hover:bg-rose-50 '
    + 'dark:border-rose-900 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-950/40',
}

/**
 * The answer already on the record. Filled, because it is a fact.
 *
 * ── It is pressable again, and `cursor-default` went with that ───────────
 *
 * This used to be unpressable, on the reasoning that pressing it would write
 * a second identical event and read as if nothing had happened. True of a
 * repeat, and it left no way to say "ignore that, I have not actually decided"
 * -- the reader could change their answer to one of the other two but never
 * get back to not having one. Reported as needing to unselect.
 *
 * So pressing the standing answer CLEARS it. That is not a repeat and not a
 * no-op: it writes a newer event that leaves the asset unanswered, which is a
 * state the record could always hold and the interface could not reach. See
 * `CONCLUSION_CLEARED`.
 */
const VERDICT_SELECTED: Record<ThesisReviewOutcome, string> = {
  holds:
    'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 '
    + 'dark:border-emerald-500 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-700',
  changed:
    'border-amber-600 bg-amber-600 text-white hover:bg-amber-700 '
    + 'dark:border-amber-500 dark:bg-amber-600 dark:text-white dark:hover:bg-amber-700',
  needs_work:
    'border-rose-600 bg-rose-600 text-white hover:bg-rose-700 '
    + 'dark:border-rose-500 dark:bg-rose-600 dark:text-white dark:hover:bg-rose-700',
}

export function ThesisVerdictBar({
  assetId,
  /**
   * Drop the standing-conclusion sentence, keeping the question and answers.
   *
   * For a bar that shares its row with other controls and cannot afford a
   * 19rem fixed slot. The record is still readable -- the standing answer is
   * the filled button -- so what is lost is when it was answered and by whom,
   * not whether it was.
   */
  compact = false,
}: {
  assetId: string | null
  compact?: boolean
}) {
  const {
    record: recordReview, clear: clearReview, isPending: reviewPending, pendingOutcome,
  } = useRecordThesisReview(assetId)
  /*
   * `isDone` is deliberately not read.
   *
   * It used to disable all three buttons for the life of the component, so a
   * reader who pressed the wrong one had no way back inside the pane that had
   * just taken their answer -- the one moment they were certain to notice the
   * mistake. The standing conclusion is read from the record instead, which
   * outlives the mount and is what makes a correction possible at all.
   */
  const { current: reviewState } = useCurrentThesisConclusion(assetId)
  /* The answer in flight wins over the record while it is in flight, so the
     press is acknowledged immediately and never un-acknowledged. */
  const standingOutcome = pendingOutcome ?? reviewState?.outcome ?? null

  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.03]"
      data-slot="research-thesis-review"
    >
      {/* The question is asked, not labelled: it takes the row step its own
          answers take, not the caption step beneath them. */}
      <span className="text-[13px] font-medium text-gray-500">
        Does the case still hold?
      </span>
      <span className="flex items-center gap-1.5">
        {REVIEW_CHOICES.map(choice => {
          const standing = standingOutcome === choice.outcome
          return (
            <button
              key={choice.outcome}
              type="button"
              data-slot={`research-review-${choice.outcome}`}
              aria-pressed={standing}
              /* Press the standing answer to take it back. `aria-pressed`
                 already told a screen reader this is a toggle; the title is
                 what tells everyone else, because a filled button that clears
                 on click is not guessable from its colour. */
              title={standing ? 'Press again to clear this answer' : undefined}
              onClick={() => (standing ? clearReview() : recordReview(choice.outcome))}
              disabled={reviewPending}
              className={clsx(
                'rounded-lg border px-2.5 py-1 text-[13px] font-semibold transition-colors',
                /* On both branches now. It used to be on the unselected one
                   only, because the standing button was permanently disabled
                   and dimming the record would have made it quieter than the
                   alternatives to it. It is only disabled WHILE A WRITE IS IN
                   FLIGHT now, which is a different thing and true of all
                   three at once, so the dimming says "wait" rather than
                   "this one does not apply". */
                'disabled:opacity-60',
                standing
                  ? VERDICT_SELECTED[choice.outcome]
                  : VERDICT_TONE[choice.outcome],
              )}
            >
              {choice.label}
            </button>
          )
        })}
      </span>
      {!compact && (
        <span
          data-slot="research-review-standing"
          className="w-[19rem] shrink-0 whitespace-nowrap text-[13px] text-gray-500"
        >
          {reviewPending ? 'Recording…' : reviewState ? (
            <>
              {conclusionWords(
                reviewState.outcome, reviewState.occurredAt, reviewState.byMe, new Date(),
              )}
              {' · '}
              {/* Says both ways out, because one of them is new and neither is
                  visible on the buttons. */}
              <span className="text-gray-400">change or clear it above</span>
            </>
          ) : (
            <span className="text-gray-400">Not reviewed yet</span>
          )}
        </span>
      )}
    </span>
  )
}
