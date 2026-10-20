import { useState } from 'react'
import { AttentionBand } from './AttentionBand'
import { useAssetAttentionSignals, type AssetAttentionInput } from '../../hooks/useAssetAttentionSignals'
import type { WorkspaceDestination, SignalFocus } from '../../lib/asset-workspace/context'

/** Signals shown before the reader asks for the rest. Keeps the surface a
 *  short prioritized list, not a feed. */
const TOP = 3

export interface AssetAttentionBandProps extends AssetAttentionInput {
  /** Where a signal should take the reader — precise target in `focus`. */
  onFocus: (destination: WorkspaceDestination, focus?: SignalFocus) => void
  className?: string
}

/**
 * One attention surface for the whole Asset page.
 *
 * Shows the top few signals (already deduped, grouped and weight-sorted by the
 * resolver) with an expander for the remainder, so the page never becomes a
 * notification feed. Absent when there is nothing to say; a restrained
 * placeholder while the facts load; it never asserts an all-clear or a count
 * for rows the reader cannot see.
 */
export function AssetAttentionBand({ onFocus, className, ...input }: AssetAttentionBandProps) {
  const { signals, state, isLoading } = useAssetAttentionSignals(input)
  const [expanded, setExpanded] = useState(false)

  if (isLoading) {
    return (
      <div
        data-testid="attention-band-loading"
        aria-hidden
        className="h-9 animate-pulse rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
      />
    )
  }

  // Empty is absent, not an all-clear: "no signals" is not a finding this
  // surface is entitled to assert.
  if (signals.length === 0) return null

  const shown = expanded ? signals : signals.slice(0, TOP)
  const hidden = signals.length - shown.length

  return (
    <div data-testid="asset-attention-band" className={className}>
      <AttentionBand state={state} signals={shown} onOpen={onFocus} />
      {signals.length > TOP && (
        <button
          type="button"
          data-testid="attention-expand"
          onClick={() => setExpanded(e => !e)}
          className="mt-1 w-full rounded-lg px-3 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50"
        >
          {expanded ? 'Show fewer' : `${hidden} more`}
        </button>
      )}
    </div>
  )
}
