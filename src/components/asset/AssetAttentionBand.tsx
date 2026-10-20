import { useState, useRef, useEffect } from 'react'
import { AlertTriangle, ChevronDown, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { AttentionBand } from './AttentionBand'
import { useAssetAttentionSignals, type AssetAttentionInput } from '../../hooks/useAssetAttentionSignals'
import type { WorkspaceDestination, SignalFocus, WorkspaceState, WorkspaceSignal } from '../../lib/asset-workspace/context'

/** Signals shown before the reader asks for the rest. Keeps the surface a
 *  short prioritized list, not a feed. */
const TOP = 3

export interface AssetAttentionBandProps extends AssetAttentionInput {
  /** Where a signal should take the reader — precise target in `focus`. */
  onFocus: (destination: WorkspaceDestination, focus?: SignalFocus) => void
  /**
   * Start as a one-line summary pill that expands to the full band on click.
   * Presentation only: the signals, their order, grouping and deep-link focus
   * all come from the resolver unchanged — this flag changes nothing but how
   * much of that is shown before the reader asks.
   */
  collapsible?: boolean
  /**
   * UX2 Phase 1: 'popover' moves the surface behind the header ⚡ trigger (count
   * visible, panel on click) instead of an in-body band. Same resolver, signals,
   * grouping, counts, priorities and deep-link focus — only where it is shown
   * changes. Default 'inline' keeps every existing caller byte-for-byte.
   */
  variant?: 'inline' | 'popover'
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
export function AssetAttentionBand({ onFocus, className, collapsible = false, variant = 'inline', ...input }: AssetAttentionBandProps) {
  const { signals, state, isLoading } = useAssetAttentionSignals(input)
  const [expanded, setExpanded] = useState(false) // within the band: top-N vs all
  const [open, setOpen] = useState(false) // collapsible: pill vs full band

  // UX2 Phase 1: header-anchored popover presentation. Same signals/state/
  // grouping/deep-links from the one resolver; only the container differs.
  if (variant === 'popover') {
    return (
      <AttentionPopover
        signals={signals}
        state={state}
        isLoading={isLoading}
        onFocus={onFocus}
        className={className}
      />
    )
  }

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

  // Compact, expandable: a one-line summary of what the resolver already ranked.
  // `signals[0]` is the highest-priority item (the resolver sorts by weight), so
  // naming it here reflects that priority without re-deciding it.
  if (collapsible && !open) {
    const n = signals.length
    return (
      <div className={className}>
        <button
          type="button"
          data-testid="attention-pill"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-left text-[12.5px] text-amber-800 hover:bg-amber-100/70 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-900/30"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="shrink-0 font-semibold">{n} need{n === 1 ? 's' : ''} attention</span>
          <span className="min-w-0 truncate text-amber-700/90 dark:text-amber-400/90">· {signals[0].headline}</span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-80" />
        </button>
      </div>
    )
  }

  const shown = expanded ? signals : signals.slice(0, TOP)
  const hidden = signals.length - shown.length

  return (
    <div data-testid="asset-attention-band" className={className}>
      <AttentionBand state={state} signals={shown} onOpen={onFocus} />
      <div className="mt-1 flex items-center gap-1">
        {signals.length > TOP && (
          <button
            type="button"
            data-testid="attention-expand"
            onClick={() => setExpanded(e => !e)}
            className="flex-1 rounded-lg px-3 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50"
          >
            {expanded ? 'Show fewer' : `${hidden} more`}
          </button>
        )}
        {collapsible && (
          <button
            type="button"
            data-testid="attention-collapse"
            onClick={() => { setOpen(false); setExpanded(false) }}
            className="rounded-lg px-3 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50"
          >
            Hide
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The ⚡ header trigger + popover. Renders the exact same `AttentionBand` over
 * the same resolver output — no second data path. The count is `signals.length`
 * (the surface the reader can actually see). Selecting a signal closes the
 * popover and hands the destination + focus to `onFocus`, which performs the
 * tab / book / anchor navigation. Absent (no trigger) until there is something
 * to say, consistent with the inline band's "empty is absent" rule.
 */
function AttentionPopover({
  signals, state, isLoading, onFocus, className,
}: {
  signals: WorkspaceSignal[]
  state: WorkspaceState
  isLoading: boolean
  onFocus: (destination: WorkspaceDestination, focus?: SignalFocus) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (isLoading || signals.length === 0) return null

  const n = signals.length
  return (
    <div className={clsx('relative', className)} ref={ref}>
      <button
        type="button"
        data-testid="attention-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="ux2-band-iconbtn"
        title={`${n} need${n === 1 ? 's' : ''} attention`}
      >
        <Zap className="h-4 w-4" />
        <span className="ux2-attn-count">{n}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Needs attention"
          data-testid="attention-popover"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(440px,92vw)] rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        >
          <AttentionBand state={state} signals={signals} onOpen={(d, f) => { setOpen(false); onFocus(d, f) }} />
        </div>
      )}
    </div>
  )
}
