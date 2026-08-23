import { useState } from 'react'
import { clsx } from 'clsx'

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
  /**
   * Which case this number is, chosen by the reader.
   *
   * A target IS a case, so a card offering to set one without asking which
   * leaves the reader guessing what they just created — reported on the
   * no-target card: "I am not able to specify what the case is."
   *
   * Present only where the caller can act on the answer. A card editing an
   * EXISTING target already knows its case and passes nothing.
   */
  caseNames?: string[]
  onCaseChange?: (name: string) => void
  saving?: boolean
  /** Notified as the reader explores, so the chart can draw the proposal. */
  onProposedChange?: (proposed: number | null) => void
}

const money = (v: number) => v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`

export function TargetExplorer({
  symbol, currentPrice, recordedTarget, caseLevels = [], onSave,
  referenceLabel = 'Current price', saveLabel = 'Save target', saving, onProposedChange,
  caseNames, onCaseChange,
}: TargetExplorerProps) {
  const [selectedCase, setSelectedCase] = useState(() => caseNames?.[0] ?? null)
  const [state, setState] = useState<Exploration>(
    () => beginExploration(recordedTarget, currentPrice),
  )

  const update = (next: Exploration) => {
    setState(next)
    // The chart draws the proposal as a band while it is being explored, so
    // the reader sees where they are putting it rather than only the number.
    onProposedChange?.(next.proposed)
  }

  const pick = (name: string) => { setSelectedCase(name); onCaseChange?.(name) }

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="target-explorer-root">
      {/* Which case this is. On a name with no target at all the reader is
          CREATING one, and a number with no case attached is a number nobody
          can interpret later. The same chip row the case editor uses, so the
          two controls read as one idea. */}
      {caseNames && caseNames.length > 0 && (
        <div className="mb-2 flex shrink-0 items-center gap-1" data-slot="case-selector">
          {caseNames.map(name => (
            <button
              key={name}
              type="button"
              data-slot="case-tab"
              data-case-id={name}
              aria-pressed={name === selectedCase}
              onClick={() => pick(name)}
              className={clsx(
                'rounded-full px-2.5 py-1 text-[12px] font-bold transition-colors',
                name === selectedCase
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

    <ValueExplorer
      slot="target-explorer"
      referenceLabel={referenceLabel}
      recordedLabel={selectedCase ? `${selectedCase} recorded` : 'Recorded target'}
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
      /**
       * Moves somebody would actually make.
       *
       * A target is a view about where a business gets to, and nobody revises
       * one by a dollar. These are percentage moves off the CURRENT PRICE,
       * which is the number the upside is quoted against, so "+20%" on the
       * button and "+20% vs current" under the figure are the same statement.
       */
      presets={currentPrice != null ? [
        { label: '−20%', value: () => currentPrice * 0.8 },
        { label: '−10%', value: () => currentPrice * 0.9 },
        { label: '+10%', value: () => currentPrice * 1.1 },
        { label: '+20%', value: () => currentPrice * 1.2 },
        { label: '+50%', value: () => currentPrice * 1.5 },
      ] : undefined}
      aria-label={`${symbol} ${selectedCase ?? 'target'}`}
    />
    </div>
  )
}
