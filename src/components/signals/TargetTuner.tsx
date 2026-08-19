import { useRef, useState } from 'react'
import { clsx } from 'clsx'

interface TargetTunerProps {
  symbol: string
  /** The target as it stands today. */
  currentTarget: number
  /**
   * What implied return is measured against, and what that number IS.
   *
   * Null when there is no price this card may honestly compare to. The control
   * still works — moving a target is meaningful on its own — it simply stops
   * claiming an upside it cannot compute. Passing a price with no label is not
   * possible on purpose: an unlabelled reference is how a holdings mark ends up
   * being read as a live quote.
   */
  reference: { price: number; label: string } | null
  /** Commit. Called only after a deliberate hold, never on drag or tap. */
  onRecord: (target: number) => void
}

/** Long enough to be a decision, short enough not to be a chore. */
const HOLD_MS = 700

/**
 * Move the target, watch what it does to the implied return, then decide.
 *
 * ── Why a target card needs this ──────────────────────────────────────────
 *
 * "Your view on MSFT has outlived its own horizon" states a problem and offers
 * nothing to do about it. The only real responses are to restate the target, to
 * extend it, or to drop it, and all three of those are the same gesture: pick a
 * number and say why. Until now that meant leaving the feed, which is the
 * failure this whole surface exists to avoid.
 *
 * ── What the commit does, and what it does not ────────────────────────────
 *
 * It RECORDS a proposed target against the name. It does not edit the analyst's
 * price target, and the label never says it does. Research artifacts are owned
 * by their author and edited on the asset page; what a feed can honestly do is
 * capture the number you arrived at, with the arithmetic that produced it
 * attached, where the desk will find it.
 *
 * ── Why the range is relative, not absolute ───────────────────────────────
 *
 * Half to double the standing target, rather than a fixed dollar window. A
 * $12 name and a $900 name need the same *proportional* resolution, and a
 * slider whose step is meaningful for one is unusable on the other.
 */
export function TargetTuner({ symbol, currentTarget, reference, onRecord }: TargetTunerProps) {
  const [proposed, setProposed] = useState(currentTarget)
  const [holdPct, setHoldPct] = useState(0)
  const timer = useRef<number | null>(null)
  const start = useRef(0)

  const min = currentTarget * 0.5
  const max = currentTarget * 2
  // Three significant-ish steps across the range whatever the price level.
  const step = Math.max(currentTarget / 200, 0.01)

  const changed = Math.abs(proposed - currentTarget) >= step
  const impliedNow = reference ? (currentTarget - reference.price) / reference.price : null
  const impliedNext = reference ? (proposed - reference.price) / reference.price : null

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
      onRecord(Number(proposed.toFixed(2)))
      // A proposal already sent must not keep sitting in the control looking
      // pending.
      setProposed(currentTarget)
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
    // `safe center`, not `center`.
    //
    // This sits in the card's disclosure region, which is bounded by
    // `flex-1 min-h-0` and gets whatever height the evidence band and the metric
    // well leave behind. On a card carrying a 196px chart that can be less than
    // the control needs, and plain `justify-center` centres the OVERFLOW: the
    // header row and the commit button are both clipped, in equal halves, so the
    // control reads as broken rather than as scrollable. `safe` falls back to
    // flex-start the moment the content stops fitting, which keeps the top of
    // the control anchored and the remainder reachable.
    <div
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto [justify-content:safe_center]"
      data-testid="target-tuner"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {symbol} target
        </span>
        <span className="text-[20px] font-bold tabular-nums text-gray-900 dark:text-white" data-testid="target-tuner-value">
          ${proposed.toFixed(2)}
        </span>
        {changed && (
          <span className={clsx(
            'text-[12px] font-bold tabular-nums',
            proposed > currentTarget ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}>
            {proposed > currentTarget ? '+' : ''}{(proposed - currentTarget).toFixed(2)}
          </span>
        )}
        {impliedNext != null && (
          <span
            className="ml-auto shrink-0 text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400"
            data-testid="target-tuner-implied"
          >
            {impliedNext >= 0 ? '+' : ''}{(impliedNext * 100).toFixed(0)}% implied
          </span>
        )}
      </div>

      {/* Dragging writes nothing. It is the whole point that this is free. */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={proposed}
        aria-label={`Proposed ${symbol} target`}
        data-testid="target-tuner-slider"
        onChange={e => { clearHold(); setProposed(Number(e.target.value)) }}
        className="h-7 w-full cursor-pointer accent-primary-600 dark:accent-primary-400"
      />

      <div className="flex flex-wrap items-center gap-x-2 text-[10px] font-medium text-gray-400">
        <span>standing ${currentTarget.toFixed(2)}</span>
        {reference && (
          <>
            <span aria-hidden>·</span>
            {/* The reference is always named. An unlabelled price beside a
                target is exactly how a holdings mark gets read as a quote. */}
            <span>{reference.label} ${reference.price.toFixed(2)}</span>
            {impliedNow != null && (
              <span className="tabular-nums">
                ({impliedNow >= 0 ? '+' : ''}{(impliedNow * 100).toFixed(0)}% today)
              </span>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        data-testid="target-tuner-record"
        disabled={!changed}
        onPointerDown={beginHold}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
        // Deliberately not onClick. A tap must never record anything.
        className={clsx(
          'relative h-9 shrink-0 overflow-hidden rounded-xl text-[13px] font-bold transition-colors no-touch-target',
          changed
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
            : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600',
        )}
      >
        <span
          className="absolute inset-y-0 left-0 bg-emerald-500/40 transition-[width] duration-75"
          style={{ width: `${holdPct * 100}%` }}
          aria-hidden
        />
        <span className="relative">
          {changed ? `Hold to record $${proposed.toFixed(2)}` : 'Drag to test a target'}
        </span>
      </button>
    </div>
  )
}
