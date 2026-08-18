import { useRef, useState } from 'react'
import { clsx } from 'clsx'

interface WhatIfSizeProps {
  symbol: string
  /** Current weight, percent. */
  currentPct: number
  /** Benchmark weight, percent. Null when there is no benchmark. */
  benchmarkPct: number | null
  /** Where the benchmark came from, so the card never implies a licensed feed. */
  benchmarkNote?: string
  /**
   * Commit. Called ONLY after a deliberate hold — never on drag, never on tap.
   * Receives the proposed weight; the caller decides what recording means.
   */
  onStage: (proposedPct: number) => void
  /** Upper bound. A position cannot be more than the book. */
  maxPct?: number
}

/** How long the commit must be held. Long enough to be a decision, short
 *  enough not to be a chore. */
const HOLD_MS = 700

/**
 * Move the position, see what it does to the active weight, then decide.
 *
 * ── Why this is not a form ────────────────────────────────────────────────
 *
 * A card that only states a number leaves the reader to do the arithmetic
 * somewhere else and come back. The question an active-weight card provokes is
 * always "what if it were smaller" — so the card should answer it in place.
 * Dragging recomputes the active weight live and writes nothing.
 *
 * ── What the commit does, and what it does not ────────────────────────────
 *
 * It RECORDS the proposed size. It does not change the position.
 *
 * `buildActiveRiskCard` has said from the beginning that recording a view is
 * the one thing genuinely resolvable from a feed, and that an inline control
 * pretending to change a size would be a lie about what the button does. That
 * still holds — what changed is that the arithmetic no longer has to happen
 * somewhere else. Exploring the size is free and local; committing writes down
 * the number you arrived at, attached to the name, where the desk can find it.
 *
 * So the label says "record", not "stage" or "trim". A control that says
 * "stage" while producing a note is the same defect class as a placeholder
 * quote stamped with the current time: the surface claiming more than the
 * write behind it delivers.
 *
 * ── Why committing is deliberately awkward ────────────────────────────────
 *
 * Writes must be possible but never accidental. A drag that records a number
 * the moment your thumb lifts is a surface nobody can explore, because every
 * experiment has a consequence. So exploration is free and commitment is a
 * distinct physical act: press and hold for 700ms, with the proposed number
 * restated on the button and the progress visible under your thumb.
 *
 * Hold rather than a confirm dialog because a dialog is dismissed by reflex —
 * people learn to tap through them — while a hold cannot complete without
 * sustained intent, and releasing early cancels with nothing written.
 *
 * The slider snaps back to the current weight afterwards, so the card never
 * shows a proposal that has already been sent as though it were still pending.
 */
export function WhatIfSize({
  symbol, currentPct, benchmarkPct, benchmarkNote, onStage, maxPct = 12,
}: WhatIfSizeProps) {
  const [proposed, setProposed] = useState(currentPct)
  const [holdPct, setHoldPct] = useState(0)
  const timer = useRef<number | null>(null)
  const start = useRef(0)

  const changed = Math.abs(proposed - currentPct) >= 0.05
  const activeNow = benchmarkPct == null ? null : currentPct - benchmarkPct
  const activeNext = benchmarkPct == null ? null : proposed - benchmarkPct

  const clearHold = () => {
    if (timer.current) cancelAnimationFrame(timer.current)
    timer.current = null
    setHoldPct(0)
  }

  const tick = () => {
    const pct = Math.min((performance.now() - start.current) / HOLD_MS, 1)
    setHoldPct(pct)
    if (pct >= 1) {
      clearHold()
      onStage(Number(proposed.toFixed(2)))
      // Snap back: a proposal already sent must not keep sitting in the control
      // looking pending.
      setProposed(currentPct)
      return
    }
    timer.current = requestAnimationFrame(tick)
  }

  const beginHold = () => {
    if (!changed) return
    start.current = performance.now()
    timer.current = requestAnimationFrame(tick)
  }

  return (
    // h-full, not flex-1. The disclosure region this sits in is a block
    // (`min-h-0 flex-1 overflow-y-auto`), not a flex container, so `flex-1` on
    // this root resolved to nothing and the control clumped at the top of a
    // 380px band of empty card. h-full fills the region; justify-center then
    // distributes the slack around the control instead of below it.
    <div className="flex h-full min-h-0 flex-col justify-center gap-2" data-testid="what-if-size">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {symbol} weight
        </span>
        <span className="text-[20px] font-bold tabular-nums text-gray-900 dark:text-white">
          {proposed.toFixed(2)}%
        </span>
        {changed && (
          <span className={clsx(
            'text-[12px] font-bold tabular-nums',
            proposed > currentPct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}>
            {proposed > currentPct ? '+' : ''}{(proposed - currentPct).toFixed(2)}
          </span>
        )}
        {activeNext != null && (
          <span className="ml-auto shrink-0 text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
            active {activeNext >= 0 ? '+' : ''}{activeNext.toFixed(2)}%
          </span>
        )}
      </div>

      {/* Dragging writes nothing. It is the whole point that this is free. */}
      <input
        type="range"
        min={0}
        max={maxPct}
        step={0.05}
        value={proposed}
        aria-label={`Proposed ${symbol} weight`}
        data-testid="what-if-slider"
        onChange={e => { clearHold(); setProposed(Number(e.target.value)) }}
        className="h-7 w-full cursor-pointer accent-gray-900 dark:accent-white"
      />

      <div className="flex items-center gap-2 text-[10px] font-medium text-gray-400">
        <span>now {currentPct.toFixed(2)}%</span>
        {benchmarkPct != null && (
          <>
            <span aria-hidden>·</span>
            <span>bench {benchmarkPct.toFixed(2)}%</span>
            {activeNow != null && (
              <span className="tabular-nums">
                (active {activeNow >= 0 ? '+' : ''}{activeNow.toFixed(2)}%)
              </span>
            )}
          </>
        )}
        {/* Never implies a licensed benchmark. */}
        {benchmarkNote && <span className="ml-auto shrink-0 truncate">{benchmarkNote}</span>}
      </div>

      <button
        type="button"
        data-testid="what-if-stage"
        disabled={!changed}
        onPointerDown={beginHold}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
        // Deliberately not onClick. A tap must never record anything.
        className={clsx(
          'relative h-10 shrink-0 overflow-hidden rounded-xl text-[13px] font-bold transition-colors no-touch-target',
          changed
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
            : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600',
        )}
      >
        {/* Progress under the thumb: the hold has to be visible or it reads as
            an unresponsive button. */}
        <span
          className="absolute inset-y-0 left-0 bg-emerald-500/40 transition-[width] duration-75"
          style={{ width: `${holdPct * 100}%` }}
          aria-hidden
        />
        <span className="relative">
          {changed ? `Hold to record ${proposed.toFixed(2)}%` : 'Drag to explore a size'}
        </span>
      </button>
    </div>
  )
}
