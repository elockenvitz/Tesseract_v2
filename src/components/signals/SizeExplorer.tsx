import { useState } from 'react'
import { clsx } from 'clsx'

import { ValueExplorer } from './ValueExplorer'
import {
  beginExploration, pointsChange, type Exploration,
} from '../../lib/mobile/exploration'

/**
 * What if the position were X%?
 *
 * ── Analysis, not execution ───────────────────────────────────────────────
 *
 * This asks a question; it does not place a trade. The distinction is carried
 * by the labels and by what Save does — it stages a proposed weight for
 * somebody to act on through the trade flow, which is the only place a trade
 * is ever committed. Nothing here reaches `accepted_trades`.
 *
 * ── Why "Change" is its own figure ────────────────────────────────────────
 *
 * A weight is already a percentage, so the difference between 7.2% and 5.0% is
 * 2.2 POINTS, not 30%. Showing it as a percentage of a percentage is the
 * classic way to make a sizing control lie, and the reader has to do the
 * subtraction in their head otherwise. It gets a labelled figure of its own.
 */

interface SizeExplorerProps {
  symbol: string
  /** Today's weight in the book. */
  currentPct: number | null
  /** A previously staged proposal, if there is one. */
  stagedPct?: number | null
  /**
   * Benchmark weight, so the slider can reach neutral and the card can say
   * what the active weight is.
   *
   * Null means the portfolio has no benchmark file — NOT that the index holds
   * none of this name. A name the file omits is a genuine zero; a book with no
   * file has no active weight at all, and the control says which it is.
   */
  benchmarkPct?: number | null
  /** Names the book in the sentence explaining a missing benchmark. */
  portfolioName?: string | null
  onStage: (proposedPct: number) => void
  /**
   * Names the artefact. The default says "idea" because that is exactly what
   * this creates — a proposal somebody else decides on — and the old "Hold to
   * record" left a reader on an oversized position unable to tell whether the
   * control was about to trim it.
   */
  saveLabel?: string
  saving?: boolean
}

const pct = (v: number) => `${v.toFixed(1)}%`
/** A difference between two weights is POINTS, never a percent of a percent. */
const pts = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pts`

export function SizeExplorer({
  symbol, currentPct, stagedPct = null, benchmarkPct = null, onStage,
  saveLabel = 'Propose as an idea', saving, portfolioName,
}: SizeExplorerProps) {
  const [state, setState] = useState<Exploration>(
    () => beginExploration(stagedPct, currentPct),
  )

  const proposed = state.proposed
  const change = pointsChange(proposed, currentPct)

  return (
    /**
     * `overflow-hidden` and no trailing prose.
     *
     * The card carried a line reading "Creates an idea for the desk to review.
     * No trade is placed." It was there to reassure, and on a pane already at
     * its height budget it pushed the change figures into the commit buttons —
     * so the reassurance arrived as an overlap. The Save button says "Propose
     * as an idea", which makes the same point in the place somebody is
     * actually looking before they press it.
     */
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="size-explorer">
      <ValueExplorer
        slot="size-value"
        referenceLabel="Current weight"
        recordedLabel="Staged"
        proposedLabel="Proposed"
        state={state}
        onChange={setState}
        onSave={onStage}
        saveLabel={saveLabel}
        saving={saving}
        format={pct}
        // No secondary under each figure: the consequence is a single number
        // about the DIFFERENCE, so it belongs beside the values rather than
        // repeated under each one.
        /**
         * Change, promoted into the values row.
         *
         * Measured: the pane is 172px and this control rendered 172.8px, with
         * the change row's bottom edge landing exactly on the pane boundary and
         * 5.5px between the Save button and the row it sat above. That is not a
         * layout — it is a coincidence, and it is why the same overlap has been
         * reported and "fixed" three times.
         *
         * Moving Change up removes the row outright and puts the number beside
         * the two it is the difference of. `hideEmptyRecorded` reclaims the
         * space: the conviction branch passes no `stagedPct`, so that column
         * was rendering "None set".
         */
        trailing={change != null
          ? { label: 'Change', value: `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} pts` }
          : null}
        hideEmptyRecorded
        reachable={[benchmarkPct, 0]}
        /**
         * 0 to 100, because that is what a weight is.
         *
         * The track used to derive its ends from the numbers on the card, so on
         * a 25% position the rail stopped around 30% and on a 5% one around 8%.
         * The same finger travel therefore meant a different number on every
         * card, and the picture the rail drew — "this position is nearly at the
         * end of the scale" — was an artifact of the derivation rather than a
         * fact about the book.
         *
         * A full-scale rail says something true instead: a 25% position sits a
         * quarter of the way along, which is the thing an oversized card is
         * about.
         */
        bounds={{ min: 0, max: 100 }}
        step={0.1}
        presets={[
          // Only the ones the existing numbers actually support. A preset that
          // needs a calculation this card cannot do would be inventing risk
          // maths, which is explicitly out of scope.
          // Sizes somebody would actually propose, not increments.
          { label: 'Current', value: () => currentPct },
          { label: 'Half', value: () => (currentPct != null ? currentPct / 2 : null) },
          // Capped, like the rail. Doubling a 60% position is 120% of the book,
          // which is not a size anybody can propose — the preset would set a
          // value the track then had to stretch to hold.
          { label: 'Double', value: () => (currentPct != null ? Math.min(currentPct * 2, 100) : null) },
          { label: 'Exit', value: () => 0 },
          ...(benchmarkPct != null ? [{ label: 'Neutral', value: () => benchmarkPct }] : []),
        ]}
        aria-label={`${symbol} weight`}
      />

      {/* Active weight: what it is, and what it would become.
          ── Why both numbers ────────────────────────────────────────────────
          It showed only the proposal, which is the number that does not exist
          yet — so the reader was told their active weight would be +11.2 pts
          with nothing on screen saying what it is today. On a card whose whole
          subject is that a position is too big, the distance travelled IS the
          decision, and it was the one thing missing.

          Active weight is a subtraction we can actually do: the benchmark is on
          the card. Anything needing a risk model is deliberately absent. */}
      {benchmarkPct != null && currentPct != null && (
        <div className="mt-1 flex shrink-0 items-baseline gap-1.5 text-[12px]" data-slot="size-change">
          <span className="font-bold uppercase tracking-wide text-gray-400">Active</span>
          <span className="font-bold tabular-nums text-gray-900 dark:text-white" data-slot="size-active-now">
            {pts(currentPct - benchmarkPct)}
          </span>
          {/* Only once there is a proposal to compare it to. Before then the
              arrow would point at the number it started from. */}
          {proposed != null && Math.abs(proposed - currentPct) >= 0.05 && (
            <>
              <span aria-hidden className="text-gray-400">→</span>
              <span
                data-slot="size-active-next"
                className={clsx(
                  'font-bold tabular-nums',
                  // Toward the benchmark is the direction an oversized card is
                  // arguing for, whichever side of it the position sits on.
                  Math.abs(proposed - benchmarkPct) < Math.abs(currentPct - benchmarkPct)
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400',
                )}
              >
                {pts(proposed - benchmarkPct)}
              </span>
            </>
          )}
          <span className="ml-auto shrink-0 truncate text-[11px] text-gray-400" data-slot="size-bench">
            bench {benchmarkPct.toFixed(1)}%
          </span>
        </div>
      )}

      {/* An absence with a reason.
          ── Why this is not simply blank ────────────────────────────────────
          Most books in this database have no benchmark file — measured: 7 of
          the active portfolios have one and the rest have none, and the
          largest overweight positions sit in books that do not. So the row
          rendered nothing at all on the cards that most needed it, and the
          reader's reasonable conclusion was that the feature was broken.

          It is not broken; the number does not exist. There is no such thing
          as the active weight of a portfolio with nothing to be active
          against, and inventing one by reading an empty table as a zero is the
          same defect as reading a null quote as a zero price. Saying so also
          names the fix, which is to load an index file for this book. */}
      {benchmarkPct == null && currentPct != null && (
        <p className="mt-1 shrink-0 text-[11px] text-gray-400" data-slot="size-no-bench">
          No benchmark on {portfolioName ?? 'this portfolio'}, so there is no active weight to show.
        </p>
      )}

    </div>
  )
}
