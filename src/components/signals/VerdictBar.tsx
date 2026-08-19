import { useState } from 'react'
import { clsx } from 'clsx'

export interface VerdictOption {
  id: string
  /** The verb, in the reader's words: "Still my view", "Cut it", "Needs work". */
  label: string
  tone?: 'affirm' | 'neutral' | 'negate'
  /**
   * What gets written if this is chosen, in the first person.
   *
   * Held on the option rather than composed by the caller at commit time so the
   * confirm step can show the reader the exact sentence before it is recorded.
   * A control that says "Record" without showing what is trains people to stop
   * reading it.
   */
  note: string
}

interface VerdictBarProps {
  /** The question, as a question. */
  question: string
  options: VerdictOption[]
  /** Hands the chosen option to the caller, which opens the capture sheet. */
  onRespond: (option: VerdictOption) => void
  /** A caveat, a provenance line, whatever the caller must not overstate. */
  footnote?: string
}

const TONE: Record<NonNullable<VerdictOption['tone']>, string> = {
  affirm: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  neutral: 'border-gray-900 bg-gray-100 text-gray-900 dark:border-white dark:bg-gray-800 dark:text-white',
  negate: 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
}

/**
 * The smallest honest thing a reader can do with a card.
 *
 * ── Why every card needs one ──────────────────────────────────────────────
 *
 * Most cards state something true and then offer only "Capture" and "Open",
 * which are a blank text box and a navigation away. Neither engages the finding
 * the card just made, so the reader scrolls, and a surface people scroll past
 * stops being read at all.
 *
 * A verdict is the one response that fits every kind. A stale target, a
 * crowded name, a colleague's trade idea and an unusual move are all
 * propositions, and a proposition can always be agreed with, questioned or
 * rejected. That makes this the one interactive element that can be offered
 * everywhere without inventing a fake affordance per kind.
 *
 * ── Why choosing and recording are two steps ──────────────────────────────
 *
 * Tapping a verdict selects it and writes nothing. What appears is the exact
 * sentence that would be recorded, and a second, explicit control to send it.
 * A one-tap opinion logger produces a database full of accidental verdicts, and
 * the first time somebody finds their own name against a view they did not hold
 * they stop touching the surface.
 *
 * There is no hold here, unlike `WhatIfSize` and `TargetTuner`. Those two put a
 * number on the record; this hands a prefilled note to the capture sheet, which
 * the reader still has to submit. A hold in front of a form is a chore guarding
 * a door that is already locked.
 */
export function VerdictBar({ question, options, onRespond, footnote }: VerdictBarProps) {
  const [chosen, setChosen] = useState<string | null>(null)
  const picked = options.find(o => o.id === chosen) ?? null

  return (
    // `safe center` for the same reason `TargetTuner` uses it: choosing an
    // option adds a preview line and a send button, so this control grows by
    // about 80px after the first tap. Plain `justify-center` would clip the
    // question and the send button simultaneously at exactly the moment the
    // reader is trying to use it.
    <div
      className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto [justify-content:safe_center]"
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
              'min-w-0 flex-1 rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition-colors no-touch-target',
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
          {/* The exact sentence, before it is sent anywhere. */}
          <p
            className="rounded-lg bg-gray-50 px-2.5 py-2 text-[12px] leading-snug text-gray-600 dark:bg-gray-800/60 dark:text-gray-300"
            data-testid="verdict-preview"
          >
            {picked.note}
          </p>
          <button
            type="button"
            data-testid="verdict-send"
            onClick={() => { onRespond(picked); setChosen(null) }}
            className="h-10 shrink-0 rounded-xl bg-gray-900 text-[13px] font-bold text-white dark:bg-white dark:text-gray-900 no-touch-target"
          >
            Write this down
          </button>
        </>
      ) : (
        footnote && (
          <p className="text-[10px] font-medium text-gray-400">{footnote}</p>
        )
      )}
    </div>
  )
}
