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
    <div className="flex h-full min-h-0 flex-col" data-slot="size-explorer">
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
        // about the DIFFERENCE, so it belongs in its own row below rather than
        // repeated under each value.
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

      {/* One row, not two blocks.
          Change and active weight were stacked figure-blocks under the
          explorer, which on a card that already fills its pane pushed them
          into the text below — reported as overlapping on the oversized tile.
          They are two numbers; they fit on a line. */}
      {change != null && (
        <div className="mt-1 flex shrink-0 items-baseline gap-3 text-[12px]" data-slot="size-change">
          <span className="tabular-nums">
            <span className="font-bold uppercase tracking-wide text-gray-400">Change </span>
            <span className="font-bold text-gray-900 dark:text-white">
              {change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(1)} pts
            </span>
          </span>
          {/* Active weight is a subtraction we can actually do — the benchmark
              is on the card. Anything needing a risk model is deliberately
              absent. */}
          {benchmarkPct != null && proposed != null && (
            <span className="tabular-nums" data-slot="size-active">
              <span className="font-bold uppercase tracking-wide text-gray-400">Active </span>
              <span className="font-bold text-gray-900 dark:text-white">
                {(proposed - benchmarkPct) >= 0 ? '+' : '−'}
                {Math.abs(proposed - benchmarkPct).toFixed(1)} pts
              </span>
            </span>
          )}
        </div>
      )}

      {/* The one sentence on this control, and it earns its place: it is the
          difference between an analytical tool and a trade ticket. Stated as
          what DOES happen rather than what does not, because "this is not a
          trade" still leaves the reader wondering what it is. */}
      <p className="mt-0.5 shrink-0 text-[10px] leading-tight text-gray-400">
        Creates an idea for the desk to review. No trade is placed.
      </p>
    </div>
  )
}
