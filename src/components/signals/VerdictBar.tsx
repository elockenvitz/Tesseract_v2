import { useRef, useState } from 'react'
import { clsx } from 'clsx'
import { consequenceOf, type DispositionKind } from '../../lib/signals/dispositions'

/**
 * What the reader is being asked to do next, once they have answered.
 *
 * Declared now, rendered in a later phase. It sits on the OPTION rather than on
 * the bar because the follow-on depends on the answer, not on the card:
 * "cases outdated" leads to the case editor, "someone else owns it" leads to
 * coverage, and both can be answers to the same question. Putting it here means
 * progressive disclosure later needs a render branch, not a contract change.
 */
export interface VerdictNextAction {
  /** Stable id the feed can route on. */
  id: string
  /** The control's label when it is eventually shown. */
  label: string
}

export interface VerdictOption {
  /**
   * The semantic judgment, stable across rewordings: `thesis_intact`,
   * `cases_outdated`, `not_price_driven`.
   *
   * This is what persists and what downstream analysis reads. Labels are copy
   * and will change; this must not, because a stored answer that stops being
   * comparable to last quarter's is not a record of anything.
   */
  key: string
  /** The verb, in the reader's words. Copy — safe to reword. */
  label: string
  /**
   * How the FEED should treat the card afterwards. A compatibility mapping,
   * deliberately not a description of the judgment.
   *
   * Several semantic answers legitimately share one: "thesis intact" and "this
   * position is not price-driven" both mean the card should stop asking, and
   * mean entirely different things about the investment. The generic state
   * governs suppression; `key` carries the meaning.
   */
  disposition: DispositionKind
  tone?: 'affirm' | 'neutral' | 'negate'
  /**
   * Whether this is a judgment about the INVESTMENT or feedback about the FEED.
   *
   * "Not useful" and "show fewer like this" are feed-quality signals that were
   * sitting in primary response sets beside real investment judgments, which
   * makes both harder to read: an analyst answering a question about a position
   * should not be choosing between "the thesis is intact" and "stop showing me
   * this". Marking the distinction now means feed-quality options can move to
   * the overflow menu later without hunting for them.
   *
   * Defaults to `judgment`, which is what every Phase 3 set is.
   */
  intent?: 'judgment' | 'feed_quality'
  /**
   * What gets written if this is chosen, in the first person.
   *
   * Only `flagged` opens the capture sheet with it: committing to work is worth
   * a sentence the reader can edit. Making somebody write a paragraph to say
   * "this is fine" is how a triage control becomes one nobody touches.
   */
  note: string
  /** Declared for a later phase; deliberately not rendered yet. */
  nextAction?: VerdictNextAction
}

interface VerdictBarProps {
  /** The question, as a question. */
  question: string
  options: VerdictOption[]
  /**
   * Applies the judgment. May be async.
   *
   * Returning `false` (or rejecting) means the write did not stick, and the bar
   * says so rather than showing a confident selected state over nothing.
   */
  onRespond: (
    option: VerdictOption,
    /**
     * Anything the reader chose to add in their own words.
     *
     * Optional and almost always empty. The value of a one-tap judgment is
     * that it is one tap, so this must never be a field somebody has to clear
     * — it is a closed affordance that opens only if they want it.
     */
    commentary?: string,
  ) => boolean | void | Promise<boolean | void>
  /**
   * The optional next step for a recorded judgment, or null for no follow-on.
   *
   * Resolved by the CALLER, not here. The bar knows what was chosen; only the
   * feed knows where `open_cases` goes, whether it resolves at all, and whether
   * the card's own action bar is already offering the same thing a few pixels
   * below. Keeping that here would put a second navigation mapping beside the
   * Phase 4 resolver, which is the one thing that mapping exists to prevent.
   *
   * Returning null is the normal case and carries no stigma: most judgments are
   * complete on their own, and a surface that produces a task from every answer
   * is the documentation friction this feed exists to reduce.
   */
  resolveNext?: (option: VerdictOption) => { label: string; run: () => void } | null
  /**
   * Suppress the visible heading, because the CARD already asked.
   *
   * Phase 2 gave `SignalCard` a `prompt`, rendered high in the hierarchy where
   * a reader sees it while deciding whether to engage. When the response bar
   * answers that same question it printed it a second time, so a 390px card
   * carried "Has the investment view changed?" twice in two type styles about
   * 100px apart — which reads as two different questions until you notice they
   * are identical.
   *
   * The question is still REQUIRED and still labels the radio group for
   * assistive tech, and it is still what gets persisted with the judgment. Only
   * the duplicate rendering goes.
   */
  hideQuestion?: boolean
}

const TONE: Record<NonNullable<VerdictOption['tone']>, string> = {
  affirm: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  neutral: 'border-gray-900 bg-gray-100 text-gray-900 dark:border-white dark:bg-gray-800 dark:text-white',
  negate: 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
}

/**
 * Layout by option count.
 *
 * Four is a 2×2 grid, not a row: four labels across 390px leaves about 80px
 * each, which forces either 10px type or truncation, and "Someone else owns it"
 * survives neither. Two is also a grid, for thumb size. Three stays a row,
 * because three labels at ~118px still read and a 2×2 with a hole in it looks
 * like a rendering fault.
 */
function gridFor(n: number): string {
  return n === 3 ? 'grid-cols-3' : 'grid-cols-2'
}

/**
 * What should happen to this finding, in the reader's own terms.
 *
 * ── Why this is not a second capture button ───────────────────────────────
 *
 * Because it changes the feed. A judgment clears the card, keeps it, or stops
 * that finding recurring for the name. Capture writes a thought nobody asked
 * for and changes nothing about what you are shown — exactly right for a
 * thought, and useless as triage.
 *
 * ── Why the options say what an analyst would say ─────────────────────────
 *
 * The first version named its options after the feed states they mapped to:
 * "Handled", "Needs work", "Not useful". That is the system's vocabulary, and
 * it flattened the distinctions the product exists to capture. "This position
 * is deliberately not valued on a price target" and "the thesis is intact" are
 * both `settled` to the feed and are not remotely the same claim; a research
 * record that cannot tell them apart has lost the thing worth recording.
 *
 * So options carry a semantic `key` and the generic state is a mapping beneath
 * it. Notably `not_price_driven` maps to `settled`, NOT `rejected` — a position
 * held on a non-price framework is a legitimate investment process, not a
 * failure to comply with one, and nothing here may imply otherwise.
 *
 * ── Why choosing and committing are two steps ─────────────────────────────
 *
 * Tapping a judgment selects it and writes nothing. What appears is the
 * consequence, in a sentence, and a second explicit control to apply it. A
 * one-tap logger produces a feed quietly emptied by accidents, and the first
 * time somebody loses a card they meant to keep they stop trusting the row.
 */
export function VerdictBar({ question, options, onRespond, hideQuestion = false, resolveNext }: VerdictBarProps) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  /**
   * Guards a double tap into two writes.
   *
   * A ref rather than state: the second tap can arrive before React has
   * re-rendered the first, so `disabled` alone is a race. The ref is set
   * synchronously inside the handler and is the actual gate.
   */
  const inFlight = useRef(false)

  /** What was recorded, kept after `chosen` clears so the answer stays visible. */
  const [recorded, setRecorded] = useState<VerdictOption | null>(null)
  const picked = options.find(o => o.key === chosen) ?? null
  const busy = state === 'saving'
  // Only ever computed for a judgment that actually saved. A follow-on shown
  // beside a failed write would tell the reader their answer landed.
  const next = state === 'saved' && recorded ? (resolveNext?.(recorded) ?? null) : null

  const [commentary, setCommentary] = useState('')
  const [writing, setWriting] = useState(false)

  const commit = async () => {
    if (!picked || inFlight.current) return
    inFlight.current = true
    setState('saving')
    try {
      const ok = await onRespond(picked, commentary.trim() || undefined)
      if (ok === false) {
        setState('failed')
        return
      }
      setState('saved')
      setRecorded(picked)
      setChosen(null)
    } catch {
      setState('failed')
    } finally {
      inFlight.current = false
    }
  }

  return (
    <div
      /**
       * The commit control is pinned to the bottom, always.
       *
       * This was `[justify-content:safe_center]`, which centres short content
       * and aligns tall content to the START — so when a long question and a
       * long consequence pushed the block past the pane, the part that
       * overflowed was the BOTTOM, and `overflow-hidden` deleted the one
       * button the whole control exists to offer. Reported as the confirm
       * button being hidden by the text above it.
       *
       * The footer takes `mt-auto` instead. Whatever happens above it, the
       * button sits on the bottom edge of the pane and stays reachable; the
       * question clamps and the options give up space first, because a
       * truncated label is recoverable and an unreachable Apply is not.
       */
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden"
      data-testid="verdict-bar"
    >
      <p
        className={clsx(
          // Clamped: the question is context for the options, and no question
          // is worth pushing the answer off the card.
          'line-clamp-2 shrink-0 text-[12px] font-bold uppercase tracking-wide text-gray-400',
          // `sr-only` rather than removed: the radiogroup is labelled by this
          // element, and dropping it would leave the control unnamed for anyone
          // not reading the card visually.
          hideQuestion && 'sr-only',
        )}
        id="verdict-question"
      >
        {question}
      </p>

      {/* A radiogroup, not a row of buttons. Choosing one of a set is what a
          radio group IS, and assistive tech announces position and count from
          it without any extra markup. */}
      <div
        role="radiogroup"
        aria-labelledby="verdict-question"
        // `min-h-0` and no `shrink-0`: the options give up room before the
        // footer does.
        className={clsx('grid min-h-0 gap-1.5', gridFor(options.length))}
        data-testid="verdict-options"
        data-option-count={options.length}
      >
        {options.map(o => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={chosen === o.key}
            data-verdict={o.key}
            data-intent={o.intent ?? 'judgment'}
            disabled={busy}
            onClick={() => { setState('idle'); setChosen(c => (c === o.key ? null : o.key)) }}
            className={clsx(
              // NO `no-touch-target` here, deliberately.
              //
              // index.css gives every button a 44px minimum hit area on coarse
              // pointers, and `.no-touch-target` is the documented opt-out for
              // chips and dense toolbars. These buttons had it copied in from
              // the surrounding card furniture, which set `min-height: 0` and
              // silently overrode the 44px this control declared for itself —
              // rendering at 30px, below the floor, on the one control the
              // whole phase is about. The explicit min-h stays as well, because
              // the global rule is gated on `pointer: coarse` and the layout
              // guard runs without it.
              //
              // Labels wrap rather than truncate: "Someone else owns it" on two
              // lines is readable, and shortening it to fit would change what
              // the answer means.
              'flex min-h-[44px] items-center justify-center rounded-xl border px-2 py-1.5',
              'text-center text-[13px] font-semibold leading-tight transition-colors',
              busy && 'opacity-60',
              chosen === o.key
                ? TONE[o.tone ?? 'neutral']
                : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Pinned. See the root comment: everything above may shrink or clamp,
          this may not. */}
      <div className="mt-auto flex shrink-0 flex-col gap-1.5">
      {state === 'failed' ? (
        // Recoverable, and honest. The selection is KEPT so the reader retries
        // rather than re-deciding, and the card is not silently left unanswered
        // while they believe they answered it.
        <>
          <p
            className="flex h-[3.25rem] shrink-0 items-center rounded-lg bg-rose-50 px-2.5 text-[12px] leading-snug text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            data-testid="verdict-error"
            role="alert"
          >
            That did not save. Your answer is still selected.
          </p>
          <button
            type="button"
            data-testid="verdict-retry"
            onClick={() => void commit()}
            className="h-11 shrink-0 rounded-xl bg-primary-600 text-[14px] font-bold text-white shadow-sm transition-colors hover:bg-primary-700 active:bg-primary-800 no-touch-target"
          >
            Try again
          </button>
        </>
      ) : picked ? (
        <>
          {/* The consequence, before anything happens. A control that changes
              what the feed shows has to say so while there is still time to
              choose differently. */}
          {/* One line, with the note affordance on the end of it.
              ── Why it shrank ─────────────────────────────────────────────
              A reserved two-line box stopped the button moving, and cost the
              options two lines to do it — on a card where the options are the
              thing being blocked. Reported as the description covering the
              other choices.
              One line clamped, with "Add a note" inline at the end, is the
              same information in half the height and puts the note offer
              beside the answer it belongs to rather than under everything. The
              button below still cannot move, because the row is a FIXED one
              line whatever the copy does. */}
          {!writing && (
          /* Two lines, not one clipped one.
             The row was a fixed 28px with `truncate`, and the longest
             consequence — "Keeps it in your feed and opens a note so the work
             is not lost" — ended at "so the work…". That sentence is the only
             statement of what the button is about to do, so an ellipsis there
             removes the reason to press it or not. Fixed at two lines rather
             than free-growing: the answer buttons below must not move, and a
             row that can grow is a row that pushes them off the card. */
          <div className="flex min-h-[2.75rem] shrink-0 items-center gap-2 overflow-hidden rounded-lg bg-gray-50 px-2.5 py-1 dark:bg-gray-800/60">
            <p
              className="min-w-0 flex-1 text-[12px] leading-snug text-gray-600 dark:text-gray-300 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
              data-testid="verdict-consequence"
            >
              {consequenceOf(picked.disposition)}
            </p>
            {!writing && (
              <button
                type="button"
                data-testid="verdict-add-note"
                onClick={() => setWriting(true)}
                className="shrink-0 text-[12px] font-bold text-primary-600 dark:text-primary-400 no-touch-target"
              >
                + Note
              </button>
            )}
          </div>
          )}

          {/* The note REPLACES the consequence row rather than stacking under
              it, and it is one row tall.
              Stacked, it pushed the options up and off the card — the reader
              opened a note and lost the answers they were choosing between,
              which is worse than not offering one. Same height, same place, so
              nothing above it moves. */}
          {writing && (
            <div className="flex shrink-0 items-center gap-2">
              <input
                data-testid="verdict-commentary"
                autoFocus
                value={commentary}
                onChange={e => setCommentary(e.target.value)}
                onKeyDown={e => {
                  // Escape abandons it. A field with no way out is a trap, and
                  // there was no way out at all.
                  if (e.key === 'Escape') { setCommentary(''); setWriting(false) }
                }}
                placeholder="Anything worth adding?"
                className="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 text-[13px] dark:border-gray-600 dark:bg-gray-900"
              />
              <button
                type="button"
                data-testid="verdict-note-cancel"
                aria-label="Discard note"
                onClick={() => { setCommentary(''); setWriting(false) }}
                className="shrink-0 rounded-lg px-2 py-1.5 text-[13px] font-bold text-gray-500 no-touch-target"
              >
                ✕
              </button>
            </div>
          )}

          <button
            type="button"
            data-testid="verdict-send"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void commit()}
            className={clsx(
              'h-11 shrink-0 rounded-xl text-[14px] font-bold transition-colors no-touch-target',
              /**
               * The brand colour, not black and white.
               *
               * A monochrome commit button on a monochrome card gives the eye
               * nothing to aim at, and it reads as system chrome rather than
               * as the one thing on the card the reader is meant to press.
               */
              busy
                ? 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                : 'bg-primary-600 text-white shadow-sm hover:bg-primary-700 active:bg-primary-800',
            )}
          >
            {busy ? 'Saving…' : picked.disposition === 'flagged' ? 'Write it down' : 'Apply'}
          </button>
        </>
      ) : state === 'saved' && recorded ? (
        /**
         * The answer, then the confirmation, then — only sometimes — a next
         * step.
         *
         * The order is the argument. A judgment is a complete contribution, so
         * it is what the reader sees first and the follow-on sits BENEATH it as
         * an offer. Putting the CTA on top, or replacing the acknowledgement
         * with it, would say the tap merely unlocked the real work — which is
         * the friction this whole surface exists to remove.
         */
        <div className="flex flex-col gap-1.5" data-testid="verdict-saved">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900 dark:text-white">
              {recorded.label}
              <span className="ml-1 text-emerald-600 dark:text-emerald-400" aria-hidden>✓</span>
            </span>
            {/* Correction is possible, and quiet. People mis-tap, and a record
                that cannot be corrected is one people stop trusting. Choosing
                again writes a new judgment; it never edits the old audit row. */}
            <button
              type="button"
              data-testid="verdict-change"
              onClick={() => { setRecorded(null); setState('idle') }}
              className="shrink-0 text-[12px] font-semibold text-gray-500 underline underline-offset-2 dark:text-gray-400 no-touch-target"
            >
              Change
            </button>
          </div>
          <p className="text-[11px] font-medium text-gray-400">Recorded.</p>

          {next && (
            // Secondary by treatment, actionable by size. Bordered rather than
            // filled so it never competes with the card's own primary action,
            // and 44px because it is a real target.
            <button
              type="button"
              data-testid="verdict-next"
              data-next-label={next.label}
              onClick={next.run}
              className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-gray-300 text-[13px] font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-200"
            >
              {next.label}
              <span aria-hidden>→</span>
            </button>
          )}
        </div>
      ) : (
        <p className="text-[10px] font-medium text-gray-400">
          Your answer changes what this feed shows you next.
        </p>
      )}
      </div>
    </div>
  )
}
