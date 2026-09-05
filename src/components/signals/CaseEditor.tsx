import { useMemo, useState } from 'react'
import { clsx } from 'clsx'

export interface EditableCase {
  /** analyst_price_targets.id */
  id: string
  /** "Bear", "Base", "Bull". */
  name: string
  price: number
  probability: number | null
  timeframe?: string | null
  /**
   * Whether the signed-in user wrote this case.
   *
   * Not a styling hint. RLS on `analyst_price_targets` is
   * `auth.uid() = user_id` for UPDATE, so an edit to somebody else's case does
   * not fail loudly — it matches zero rows and returns success. A UI that
   * offered the control anyway would report a save that never happened, which
   * is worse than not offering it.
   */
  mine: boolean
  /** Shown on cases you cannot edit, so the reader knows whose view it is. */
  authorName?: string | null
}

interface CaseEditorProps {
  symbol: string
  cases: EditableCase[]
  /** Writes to the `draft_*` columns. Never touches the published values. */
  onSaveDraft: (edits: { id: string; probability: number }[]) => void
  saving?: boolean
}

/** Probability steps. 5 is the granularity people actually think in. */
const STEP = 5

/**
 * Reweight your own cases and watch the expectation move.
 *
 * ── The problem this is for ───────────────────────────────────────────────
 *
 * Six of the ten laddered names in this database cannot produce an expected
 * value. Four carry no probabilities at all; AAPL's sum to 125% across two
 * horizons. The scenario card correctly refuses to compute an expectation from
 * those and says why — and then the reader has to leave the feed, find the
 * asset page, and fix a number that was one tap away from where they read
 * about it.
 *
 * So the sum and the expectation recompute on every tap, before anything is
 * written. You can see 125% become 100% and watch what that does to the
 * expected value, which is the actual work — the save is an afterthought.
 *
 * ── Ownership is enforced here because the database enforces it silently ──
 *
 * `analyst_price_targets` allows UPDATE only where `auth.uid() = user_id`. An
 * update to another analyst's row does not error; it matches no rows and comes
 * back successful. Any UI that offered the control to everyone would show a
 * save confirmation for a write that never landed. Cases you did not write are
 * therefore rendered read-only with their author's name, which is also the
 * more honest surface: somebody else's conviction is not yours to restate.
 *
 * ── Why the save is a plain button and not a hold ─────────────────────────
 *
 * `WhatIfSize` needs a hold because its input is a drag, and a drag that
 * commits on release makes exploration impossible. Here the input is a
 * discrete tap on a stepper, which cannot commit by accident, and the write
 * lands in `draft_*` columns that leave the published case untouched. A hold
 * would be ceremony without a hazard to justify it.
 */
export function CaseEditor({ symbol, cases, onSaveDraft, saving }: CaseEditorProps) {
  const [edits, setEdits] = useState<Record<string, number>>({})

  const rows = useMemo(
    () => [...cases].sort((a, b) => b.price - a.price),
    [cases],
  )

  const probOf = (c: EditableCase) => edits[c.id] ?? c.probability ?? 0
  const changed = rows.filter(c => edits[c.id] != null && edits[c.id] !== (c.probability ?? 0))

  const weighted = rows.filter(c => probOf(c) > 0)
  const sum = weighted.reduce((n, c) => n + probOf(c), 0)
  // Only meaningful at 100. Shown at any sum so the reader can see it converge.
  const expected = sum > 0
    ? weighted.reduce((n, c) => n + c.price * (probOf(c) / sum), 0)
    : null
  const balanced = Math.abs(sum - 100) < 0.5

  const bump = (c: EditableCase, dir: 1 | -1) => {
    if (!c.mine) return
    const next = Math.min(Math.max(probOf(c) + dir * STEP, 0), 100)
    setEdits(e => ({ ...e, [c.id]: next }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="case-editor">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {symbol} cases
        </span>
        <span
          data-testid="case-editor-sum"
          className={clsx(
            'text-[12px] font-bold tabular-nums',
            balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
          )}
        >
          {sum.toFixed(0)}%
        </span>
        {/* The expectation is the point of reweighting, so it updates as you
            tap rather than after a save. */}
        {expected != null && (
          <span className="ml-auto shrink-0 text-[12px] font-semibold tabular-nums text-gray-600 dark:text-gray-300"
                data-testid="case-editor-expected">
            EV ${expected.toFixed(0)}
          </span>
        )}
      </div>

      {!balanced && (
        // One line, because this sits in a bounded region above the rows the
        // reader is here to tap. Two lines of prose pushed the first case
        // half out of view, which made the warning cost more than it bought.
        <p className="shrink-0 truncate text-[11px] font-medium text-amber-600 dark:text-amber-400"
           data-testid="case-editor-unbalanced">
          Sums to {sum.toFixed(0)}% — EV is normalised, not stated
        </p>
      )}

      {/* Horizontal, not vertical.
          Six cases with reasoning measured 464px inside a 153px region, so
          311px of the analyst's own work was unreachable — the feed will not
          hand a vertical drag to an inner scroller, so nothing could reach it.
          Paging sideways keeps every case reachable and leaves vertical to the
          feed, which is the one gesture the surface cannot afford to lose. */}
      <div
        data-testid="case-columns"
        /**
         * A plain list, bounded — not a column-wrapped horizontal pager.
         *
         * The pager solved the height and created a worse problem: a sideways
         * scroller inside a pane the carousel already pages sideways. Two
         * nested horizontal scrollers is a gesture nobody can aim.
         */
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden"
      >
        {rows.slice(0, 4).map(c => {
          const p = probOf(c)
          const dirty = edits[c.id] != null && edits[c.id] !== (c.probability ?? 0)
          return (
            <div key={c.id} data-testid="case-row"
                 /* `shrink`, like the sibling ladder's rows and for the same
                    reason: every child of an `overflow-hidden` box being
                    `shrink-0` means nothing can yield when the box is a few
                    pixels short, so the overflow comes off the bottom and the
                    last row is cut. A row can lose a pixel of padding and
                    still read. See `ScenarioCaseDetail`, where this was found
                    first. */
                 className="flex min-h-0 shrink items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5 dark:border-gray-700">
              <span className="w-[52px] shrink-0 truncate text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
                {c.name}
              </span>
              <span className="shrink-0 text-[13px] font-bold tabular-nums text-gray-900 dark:text-white">
                ${c.price.toFixed(0)}
              </span>

              {c.mine ? (
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button" data-testid="case-prob-down" aria-label={`Lower ${c.name} probability`}
                    onClick={() => bump(c, -1)}
                    className="h-7 w-7 rounded-full bg-gray-100 text-[14px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300 no-touch-target"
                  >−</button>
                  <span className={clsx(
                    'w-[38px] text-center text-[12px] font-bold tabular-nums',
                    dirty ? 'text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-200',
                  )} data-testid="case-prob">
                    {p}%
                  </span>
                  <button
                    type="button" data-testid="case-prob-up" aria-label={`Raise ${c.name} probability`}
                    onClick={() => bump(c, 1)}
                    className="h-7 w-7 rounded-full bg-gray-100 text-[14px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300 no-touch-target"
                  >+</button>
                </div>
              ) : (
                // Somebody else's view. Stated, not hidden — the reader needs
                // to know the case exists and whose it is.
                <span className="ml-auto shrink-0 text-[11px] font-medium text-gray-400" data-testid="case-readonly">
                  {c.probability != null ? `${c.probability}% · ` : ''}
                  {c.authorName || 'another analyst'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        data-testid="case-editor-save"
        disabled={!changed.length || !!saving}
        onClick={() => onSaveDraft(changed.map(c => ({ id: c.id, probability: probOf(c) })))}
        className={clsx(
          'h-10 shrink-0 rounded-xl text-[13px] font-bold transition-colors no-touch-target',
          changed.length && !saving
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
            : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600',
        )}
      >
        {saving
          ? 'Saving…'
          : changed.length
            ? `Save ${changed.length} draft${changed.length > 1 ? 's' : ''}`
            : 'Adjust your own cases'}
      </button>
    </div>
  )
}
