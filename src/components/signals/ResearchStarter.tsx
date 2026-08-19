import { useState } from 'react'
import { clsx } from 'clsx'

export interface ResearchPrompt {
  id: string
  /** The chip, short enough to read at a glance. */
  label: string
  /** The heading the note opens with, in the analyst's own voice. */
  heading: string
}

interface ResearchStarterProps {
  symbol: string
  /** How long the name has gone unwritten, for the framing line. */
  daysSince?: number | null
  /** Opens the capture sheet with a scaffolded note. */
  onStart: (prompt: ResearchPrompt, note: string) => void
}

/**
 * The four questions that restart a stalled thesis.
 *
 * Deliberately generic and deliberately few. They are not a template for a
 * research note — the product has those, and they live where research is
 * actually written. These are the openings people stare at a blank box trying
 * to find, and the only job here is that the box is not blank.
 *
 * Ordered by how often they are the right place to start on a name nobody has
 * touched: what moved, then what would break it, then why it is still held,
 * then what the other side says.
 */
const PROMPTS: ResearchPrompt[] = [
  { id: 'changed', label: 'What changed?', heading: 'What has changed since this was last written up' },
  { id: 'breaks', label: 'What breaks it?', heading: 'What would have to happen for this thesis to be wrong' },
  { id: 'why', label: 'Why still held?', heading: 'Why this is still a position at its current size' },
  { id: 'bear', label: 'The bear case', heading: 'The strongest argument against owning this' },
]

/**
 * A blank box is why the coverage gap exists.
 *
 * ── Why a card about missing research needs a control at all ──────────────
 *
 * "Nobody has written on AMT in months" is a true, useless card. It states a
 * gap, offers "Capture" — which opens an empty text box — and leaves the reader
 * exactly where they were, except now mildly accused. The card names a problem
 * whose entire cause is that starting is hard, and then makes starting hard.
 *
 * Tapping a prompt opens the same capture sheet with a heading and the
 * provenance already in it. It saves perhaps thirty seconds, which is not the
 * point: the point is that the reader is now editing something instead of
 * facing a cursor, and that is the difference between a note written and a card
 * scrolled past.
 *
 * ── What it deliberately is not ───────────────────────────────────────────
 *
 * It does not generate prose. Nothing here writes an opinion on the reader's
 * behalf, and nothing pretends to know anything about the name. A scaffold
 * that filled in a view would be inventing research, which is worse than no
 * research and far worse than a blank box.
 */
export function ResearchStarter({ symbol, daysSince, onStart }: ResearchStarterProps) {
  const [picked, setPicked] = useState<string | null>(null)
  const prompt = PROMPTS.find(p => p.id === picked) ?? null

  const noteFor = (p: ResearchPrompt) =>
    `${symbol} — ${p.heading}\n\n` +
    `(Started from the feed${
      daysSince != null ? `, ${daysSince} days after the last research activity` : ''
    }.)\n\n`

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto [justify-content:safe_center]"
      data-testid="research-starter"
    >
      <p className="text-[12px] font-bold uppercase tracking-wide text-gray-400">
        Start writing on {symbol}
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        {PROMPTS.map(p => (
          <button
            key={p.id}
            type="button"
            data-research-prompt={p.id}
            aria-pressed={picked === p.id}
            onClick={() => setPicked(c => (c === p.id ? null : p.id))}
            className={clsx(
              'rounded-xl border px-2 py-2 text-[12px] font-semibold transition-colors no-touch-target',
              picked === p.id
                ? 'border-gray-900 bg-gray-100 text-gray-900 dark:border-white dark:bg-gray-800 dark:text-white'
                : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {prompt ? (
        <button
          type="button"
          data-testid="research-start"
          onClick={() => { onStart(prompt, noteFor(prompt)); setPicked(null) }}
          className="h-9 shrink-0 rounded-xl bg-gray-900 text-[13px] font-bold text-white dark:bg-white dark:text-gray-900 no-touch-target"
        >
          Open a note on this
        </button>
      ) : (
        <p className="text-[10px] font-medium text-gray-400">
          Opens a note with the question already in it. Nothing is written for you.
        </p>
      )}
    </div>
  )
}
