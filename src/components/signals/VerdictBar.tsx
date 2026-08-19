import { useState } from 'react'
import { clsx } from 'clsx'
import { consequenceOf, type DispositionKind } from '../../lib/signals/dispositions'

export interface VerdictOption {
  id: string
  /** The verb, in the reader's words: "Handled", "Needs work", "Not useful". */
  label: string
  /**
   * What happens to the card and the feed.
   *
   * The load-bearing field. Without it a verdict is a differently-shaped
   * capture: it writes prose and changes nothing, which is why the response bar
   * and the Capture button felt like two routes to one outcome. A disposition
   * is something capture cannot do.
   */
  disposition: DispositionKind
  tone?: 'affirm' | 'neutral' | 'negate'
  /**
   * What gets written if this is chosen, in the first person.
   *
   * Only `flagged` opens the capture sheet with it: committing to work is worth
   * a sentence the reader can edit. `settled` and `rejected` keep it as
   * provenance on the disposition itself — making somebody write a paragraph to
   * say "this is fine" is how a triage control becomes one nobody touches.
   */
  note: string
}

interface VerdictBarProps {
  /** The question, as a question. */
  question: string
  options: VerdictOption[]
  /** Hands the chosen option to the caller, which records it and, for a
   *  `flagged` verdict, opens the capture sheet. */
  onRespond: (option: VerdictOption) => void
}

const TONE: Record<NonNullable<VerdictOption['tone']>, string> = {
  affirm: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  neutral: 'border-gray-900 bg-gray-100 text-gray-900 dark:border-white dark:bg-gray-800 dark:text-white',
  negate: 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
}

/**
 * What should happen to this finding.
 *
 * ── Why every card needs one ──────────────────────────────────────────────
 *
 * Most cards state something true and then offer "Capture" and "Open", which
 * are a blank text box and a navigation away. Neither engages the finding, so
 * the reader scrolls — and a surface people scroll past stops being read.
 *
 * A disposition is the one response that fits every kind. A stale target, a
 * crowded name and a colleague's trade idea are all propositions, and a
 * proposition can always be accepted, acted on, or rejected.
 *
 * ── Why it is not a second capture button ─────────────────────────────────
 *
 * Because it changes the feed. "Handled" clears the card for a quarter;
 * "not useful" stops that kind of finding for that name for six months;
 * "needs work" leaves it visible and opens a note. Capture writes a thought
 * nobody asked for and changes nothing about what you are shown, which is
 * exactly right for a thought and useless as triage.
 *
 * ── Why choosing and committing are two steps ─────────────────────────────
 *
 * Tapping a verdict selects it and does nothing else. What appears is the
 * consequence, in a sentence, and a second explicit control to apply it. A
 * one-tap disposition logger produces a feed quietly emptied by accidents, and
 * the first time somebody loses a card they meant to keep they stop trusting
 * the row.
 */
export function VerdictBar({ question, options, onRespond }: VerdictBarProps) {
  const [chosen, setChosen] = useState<string | null>(null)
  const picked = options.find(o => o.id === chosen) ?? null

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto [justify-content:safe_center]"
      data-testid="verdict-bar"
    >
      <p className="text-[12px] font-bold uppercase tracking-wide text-gray-400">{question}</p>

      <div className="flex flex-wrap items-stretch gap-1.5">
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            data-verdict={o.id}
            aria-pressed={chosen === o.id}
            onClick={() => setChosen(c => (c === o.id ? null : o.id))}
            className={clsx(
              'min-w-0 flex-1 rounded-xl border px-2 py-2 text-[13px] font-semibold transition-colors no-touch-target',
              chosen === o.id
                ? TONE[o.tone ?? 'neutral']
                : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {picked ? (
        <>
          {/* The consequence, before anything happens. A control that changes
              what the feed shows you has to say so while there is still time to
              choose differently. */}
          <p
            className="rounded-lg bg-gray-50 px-2.5 py-2 text-[12px] leading-snug text-gray-600 dark:bg-gray-800/60 dark:text-gray-300"
            data-testid="verdict-consequence"
          >
            {consequenceOf(picked.disposition)}
          </p>
          <button
            type="button"
            data-testid="verdict-send"
            onClick={() => { onRespond(picked); setChosen(null) }}
            className="h-9 shrink-0 rounded-xl bg-gray-900 text-[13px] font-bold text-white dark:bg-white dark:text-gray-900 no-touch-target"
          >
            {picked.disposition === 'flagged' ? 'Write it down' : 'Apply'}
          </button>
        </>
      ) : (
        <p className="text-[10px] font-medium text-gray-400">
          Your answer changes what this feed shows you next.
        </p>
      )}
    </div>
  )
}
