import { useState } from 'react'

import { ValueExplorer } from './ValueExplorer'
import {
  beginExploration, upsidePct, type Exploration,
} from '../../lib/mobile/exploration'

/**
 * Explore a price target without committing to it.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * `TargetTuner`, which showed one number and a slider. Dragging it changed a
 * figure whose meaning shifted silently — market price, then recorded target,
 * then your proposal — with nothing on screen saying which. Reported as the
 * concept being strong and the execution hard to understand, which is exactly
 * what that ambiguity produces.
 *
 * Everything specific to targets lives here — the labels, the money
 * formatting, the upside calculation, the levels the slider must be able to
 * reach. The interaction itself is `ValueExplorer`, shared with cases and
 * position size, because all three are the same gesture over a different
 * number.
 */

interface TargetExplorerProps {
  symbol: string
  /** Last close. The proposal is measured against this. */
  currentPrice: number | null
  /** The saved target, or null when the name has never had one. */
  recordedTarget: number | null
  /** Scenario levels, so the slider can always reach the cases on the card. */
  caseLevels?: (number | null | undefined)[]
  onSave: (target: number) => void
  /**
   * What the reference price IS.
   *
   * Not always "Current". On a stale-target card it is the holdings mark,
   * which is a book price and not a live quote, and calling it "Current" would
   * be the `snapshot_vs_live` confusion the contract already names.
   */
  referenceLabel?: string
  /** Names the artefact Save creates. See ValueExplorer. */
  saveLabel?: string
  saving?: boolean
  /** Notified as the reader explores, so the chart can draw the proposal. */
  onProposedChange?: (proposed: number | null) => void
}

const money = (v: number) => v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`

export function TargetExplorer({
  symbol, currentPrice, recordedTarget, caseLevels = [], onSave,
  referenceLabel = 'Current price', saveLabel = 'Save target', saving, onProposedChange,
}: TargetExplorerProps) {
  const [state, setState] = useState<Exploration>(
    () => beginExploration(recordedTarget, currentPrice),
  )

  const update = (next: Exploration) => {
    setState(next)
    // The chart draws the proposal as a band while it is being explored, so
    // the reader sees where they are putting it rather than only the number.
    onProposedChange?.(next.proposed)
  }

  return (
    <ValueExplorer
      slot="target-explorer"
      referenceLabel={referenceLabel}
      recordedLabel="Recorded target"
      proposedLabel="Proposed"
      state={state}
      onChange={update}
      onSave={onSave}
      saveLabel={saveLabel}
      saving={saving}
      format={money}
      /**
       * Upside against the market price, which is the only comparison that
       * means anything for a target. Null when there is no price — 68 of 912
       * assets have one — and the row simply does not render rather than
       * claiming the upside is flat.
       */
      secondary={v => {
        const pct = upsidePct(v, currentPrice)
        if (pct == null) return null
        return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs current`
      }}
      reachable={caseLevels}
      // A dollar at a time. The last few dollars are unreachable by dragging a
      // 300px track at any sensitivity.
      nudge={1}
      aria-label={`${symbol} target`}
    />
  )
}
