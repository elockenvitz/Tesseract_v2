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
  /**
   * What the reader wants to do with the question they picked.
   *
   * Three destinations rather than one. "Open a note on this" was the only
   * offer, and a card that says a name has no thesis wants a THESIS — a note
   * about the absence is not the thing that is missing. The others are real
   * choices too: some questions are worth a quick thought, and some are worth
   * asking somebody else.
   */
  onStart: (prompt: ResearchPrompt, note: string, kind: 'thesis' | 'thought' | 'prompt') => void
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
      // No inner scroller: the feed owns vertical. `safe center` keeps short
      // content centred without letting tall content escape its bounds.
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden [justify-content:safe_center]"
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
              'min-h-[44px] rounded-xl border px-2 py-2 text-[12px] font-semibold transition-colors no-touch-target',
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
        /**
         * Three ways out, because the card asks about an absence and there is
         * more than one way to fill it. Writing the thesis is first because it
         * is what a "no thesis" card is actually about; a note about the
         * absence was never the missing thing.
         */
        <div className="grid shrink-0 grid-cols-3 gap-1.5">
          <button
            type="button"
            data-testid="research-start"
            data-kind="thesis"
            onClick={() => { onStart(prompt, noteFor(prompt), 'thesis'); setPicked(null) }}
            className="min-h-[44px] rounded-xl bg-primary-600 px-1 text-[12px] font-bold leading-tight text-white no-touch-target"
          >
            Write thesis
          </button>
          <button
            type="button"
            data-kind="thought"
            onClick={() => { onStart(prompt, noteFor(prompt), 'thought'); setPicked(null) }}
            className="min-h-[44px] rounded-xl border border-gray-300 px-1 text-[12px] font-semibold leading-tight text-gray-700 dark:border-gray-600 dark:text-gray-200 no-touch-target"
          >
            Add thought
          </button>
          <button
            type="button"
            data-kind="prompt"
            onClick={() => { onStart(prompt, noteFor(prompt), 'prompt'); setPicked(null) }}
            className="min-h-[44px] rounded-xl border border-gray-300 px-1 text-[12px] font-semibold leading-tight text-gray-700 dark:border-gray-600 dark:text-gray-200 no-touch-target"
          >
            Ask the team
          </button>
        </div>
      ) : (
        <p className="text-[10px] font-medium text-gray-400">
          Pick a question, then choose where the answer goes.
        </p>
      )}
    </div>
  )
}
