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
  /**
   * Benchmark weight, so the slider can reach neutral and the card can say
   * what the active weight is.
   *
   * Null means the portfolio has no benchmark file — NOT that the index holds
   * none of this name. A name the file omits is a genuine zero; a book with no
   * file has no active weight at all, and the control says which it is.
   */
  benchmarkPct?: number | null
  /* No `portfolioName`: the missing benchmark is stated in the values row as
     "Active — no benchmark", and the card's context chips already name the
     book above it. Repeating it inside a 90px column would truncate. */
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
const pts = (v: number) => `${signed(v)} pts`
/** The bare figure, for the left half of a "from → to" where the unit follows. */
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`

export function SizeExplorer({
  symbol, currentPct, stagedPct = null, benchmarkPct = null, onStage,
  saveLabel = 'Propose as an idea', saving,
}: SizeExplorerProps) {
  const [state, setState] = useState<Exploration>(
    () => beginExploration(stagedPct, currentPct),
  )

  const proposed = state.proposed
  const change = pointsChange(proposed, currentPct)

  /**
   * One trailing figure, always the most informative one available.
   *
   * ── Why active weight is not its own row ──────────────────────────────────
   *
   * It was, and it was invisible. `ValueExplorer` is `h-full` with shrink 1,
   * so a sibling row underneath it does not add height to the pane — it takes
   * height FROM the explorer, which then clips its own last row. The pane is
   * 172px and the explorer needs every pixel of it, so the row below stole
   * ~18px from the bottom and sheared Save and Cancel in half. Reported as
   * three separate symptoms: no active weight, and buttons cut off.
   *
   * ── Why it replaces Change rather than joining it ─────────────────────────
   *
   * They are the same fact. "Active +18.6 → +3.3 pts" and "Change −15.3 pts"
   * differ by a constant — the benchmark weight — so the second number carries
   * nothing the first does not, and it was costing a column on a row with three
   * of them. Active wins where it exists because it says what the position is
   * relative to something outside this book; Change only relates it to itself.
   *
   * Where the book has no benchmark there is no active weight to state — not
   * zero, none — so Change is the honest fallback, and the absence is named in
   * the same slot rather than left blank. Measured: 7 of the active portfolios
   * in production carry a benchmark file and the rest carry none, and the
   * largest overweight positions sit in books that do not. Rendering nothing
   * there is what made this look broken.
   */
  const trailing = benchmarkPct != null && currentPct != null
    ? {
        label: 'Active',
        value: proposed != null && Math.abs(proposed - currentPct) >= 0.05
          ? `${signed(currentPct - benchmarkPct)} → ${pts(proposed - benchmarkPct)}`
          // The unit once, at the end. Both halves are points, and printing
          // "pts" twice made the column 200px wide against the 174px a 360px
          // phone leaves it — so the second figure ran off the right edge.
          : pts(currentPct - benchmarkPct),
      }
    // No benchmark, but a proposal: Change is the only consequence there is,
    // and it is what somebody mid-drag wants to read. Checked BEFORE the
    // absence note, or the note would make this branch unreachable and the
    // card would go silent the moment it was used.
    : change != null
      ? { label: 'Change', value: pts(change) }
      // No benchmark and nothing proposed. The slot says which of the two
      // reasons it is empty for, rather than leaving a gap that reads as a
      // broken feature.
      : currentPct != null
        ? { label: 'Active', value: 'no benchmark', muted: true }
        : null

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
        // "Current weight" measured 15px past the row on a 320px phone once
        // the Active column joined it. The column sits under a heading that
        // already says WEIGHT OF THE BOOK and beside a value printed as a
        // percentage, so the second word was carrying nothing.
        referenceLabel="Current"
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
        trailing={trailing}
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

    </div>
  )
}
