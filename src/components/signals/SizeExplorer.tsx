import { useState } from 'react'

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
  /** Benchmark weight, so the slider can always reach neutral. */
  benchmarkPct?: number | null
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

export function SizeExplorer({
  symbol, currentPct, stagedPct = null, benchmarkPct = null, onStage,
  saveLabel = 'Propose as an idea', saving,
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
        step={0.1}
        presets={[
          // Only the ones the existing numbers actually support. A preset that
          // needs a calculation this card cannot do would be inventing risk
          // maths, which is explicitly out of scope.
          // Sizes somebody would actually propose, not increments.
          { label: 'Current', value: () => currentPct },
          { label: 'Half', value: () => (currentPct != null ? currentPct / 2 : null) },
          { label: 'Double', value: () => (currentPct != null ? currentPct * 2 : null) },
          { label: 'Exit', value: () => 0 },
          ...(benchmarkPct != null ? [{ label: 'Neutral', value: () => benchmarkPct }] : []),
        ]}
        aria-label={`${symbol} weight`}
      />

      {/* Active weight only.
          Change used to share this row and has moved into the values row
          above — see `trailing`. What is left appears solely on the active-risk
          card, which is the only caller that passes a benchmark, and that card
          has the height for it because its values row is full.

          Active weight is a subtraction we can actually do: the benchmark is on
          the card. Anything needing a risk model is deliberately absent. */}
      {benchmarkPct != null && proposed != null && (
        <div className="mt-1 flex shrink-0 items-baseline gap-3 text-[12px]" data-slot="size-change">
          <span className="tabular-nums" data-slot="size-active">
            <span className="font-bold uppercase tracking-wide text-gray-400">Active </span>
            <span className="font-bold text-gray-900 dark:text-white">
              {(proposed - benchmarkPct) >= 0 ? '+' : '−'}
              {Math.abs(proposed - benchmarkPct).toFixed(1)} pts
            </span>
          </span>
        </div>
      )}

    </div>
  )
}
