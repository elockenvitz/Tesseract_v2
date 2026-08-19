import { useRef, useState } from 'react'
import { clsx } from 'clsx'

interface TargetTunerProps {
  symbol: string
  /** The target as it stands today, or the mark when there is no target yet. */
  currentTarget: number
  /**
   * What implied return is measured against, and what that number IS.
   *
   * Null when there is no price this card may honestly compare to. The control
   * still works — moving a target is meaningful on its own — it simply stops
   * claiming an upside it cannot compute. A price with no label is not
   * representable on purpose: an unlabelled reference is how a holdings mark
   * ends up being read as a live quote.
   */
  reference: { price: number; label: string } | null
  /** True when no target exists yet, so the control asks for a first number
   *  rather than a revision. */
  isFirstTarget?: boolean
  /** Commit. Called only after a deliberate hold, never on drag or tap. */
  onRecord: (target: number) => void
}

/** Long enough to be a decision, short enough not to be a chore. */
const HOLD_MS = 700

/**
 * Upside presets, as fractions of the reference price.
 *
 * ── Why presets at all ────────────────────────────────────────────────────
 *
 * The first version was a bare slider across half to double the standing
 * target. On the one card it was designed for that is workable, because the
 * standing target anchors it. Everywhere else it is a blind drag: the reader
 * knows they think the name is worth "about twenty percent more", and the
 * control offers no way to express that except by nudging a thumb and reading
 * a number back. Worse, the step and the range both scale with the target, so
 * the same gesture means something different on every card.
 *
 * A preset is the unit people actually think in. The slider stays for anything
 * between them.
 */
const PRESETS = [-0.15, 0.1, 0.2, 0.35] as const

/**
 * Move the target, watch what it does to the implied return, then decide.
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
 * Half to double the anchor, rather than a fixed dollar window. A $12 name and
 * a $900 name need the same *proportional* resolution, and a slider whose step
 * is meaningful for one is unusable on the other.
 */
export function TargetTuner({
  symbol, currentTarget, reference, isFirstTarget = false, onRecord,
}: TargetTunerProps) {
  const [proposed, setProposed] = useState(currentTarget)
  const [holdPct, setHoldPct] = useState(0)
  const timer = useRef<number | null>(null)
  const start = useRef(0)

  const min = currentTarget * 0.5
  const max = currentTarget * 2
  const step = Math.max(currentTarget / 200, 0.01)

  const changed = Math.abs(proposed - currentTarget) >= step
  const impliedNow = reference ? (currentTarget - reference.price) / reference.price : null
  const impliedNext = reference ? (proposed - reference.price) / reference.price : null

  /** Position of a price on the slider track, as a percentage. */
  const trackPct = (v: number) => Math.min(Math.max(((v - min) / (max - min)) * 100, 0), 100)

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
    <div
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto [justify-content:safe_center]"
      data-testid="target-tuner"
    >
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {isFirstTarget ? `${symbol} first target` : `${symbol} target`}
        </span>
        <span className="text-[20px] font-bold tabular-nums text-gray-900 dark:text-white" data-testid="target-tuner-value">
          ${proposed.toFixed(2)}
        </span>
        {impliedNext != null && (
          <span
            className={clsx(
              'ml-auto shrink-0 text-[12px] font-bold tabular-nums',
              impliedNext >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
            )}
            data-testid="target-tuner-implied"
          >
            {impliedNext >= 0 ? '+' : ''}{(impliedNext * 100).toFixed(0)}% implied
          </span>
        )}
      </div>

      <div className="relative">
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
        {/* Where the two prices that matter sit on the track.
            A slider with no landmarks is a number generator: the reader cannot
            see whether they have moved above or below the mark without reading
            the figures back and doing the comparison in their head. */}
        {reference && trackPct(reference.price) > 2 && trackPct(reference.price) < 98 && (
          <span
            aria-hidden
            data-testid="target-tuner-mark-price"
            className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-gray-400"
            style={{ left: `${trackPct(reference.price)}%` }}
          />
        )}
        {!isFirstTarget && (
          <span
            aria-hidden
            data-testid="target-tuner-mark-target"
            className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-primary-500"
            style={{ left: `${trackPct(currentTarget)}%` }}
          />
        )}
      </div>

      {/* The unit people actually think in. */}
      {reference && (
        <div className="flex items-center gap-1" data-testid="target-tuner-presets">
          {PRESETS.map(p => {
            const v = reference.price * (1 + p)
            if (v < min || v > max) return null
            const on = Math.abs(proposed - v) < step
            return (
              <button
                key={p}
                type="button"
                data-target-preset={p}
                onClick={() => { clearHold(); setProposed(v) }}
                className={clsx(
                  'h-6 flex-1 rounded-md text-[10px] font-bold tabular-nums transition-colors no-touch-target',
                  on
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
                )}
              >
                {p > 0 ? '+' : ''}{Math.round(p * 100)}%
              </button>
            )
          })}
          <button
            type="button"
            data-target-preset="reset"
            onClick={() => { clearHold(); setProposed(currentTarget) }}
            className="h-6 flex-1 rounded-md bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400 no-touch-target"
          >
            Reset
          </button>
        </div>
      )}

      {/* Provenance, and only when it adds something.
          On a first target the anchor IS the mark, so this row said
          "book mark $212.44" directly under a heading reading
          "AAPL FIRST TARGET $212.44" — a duplicated number costing a line of a
          region that was already pushing the commit button under the action
          bar. The reference is still named wherever it is doing real work,
          because an unlabelled price beside a target is exactly how a holdings
          mark gets read as a live quote. */}
      {!isFirstTarget && (
        <div className="flex flex-wrap items-center gap-x-2 text-[10px] font-medium text-gray-400">
          <span>standing ${currentTarget.toFixed(2)}</span>
          {reference && (
            <>
              <span aria-hidden>·</span>
              <span>{reference.label} ${reference.price.toFixed(2)}</span>
              {impliedNow != null && (
                <span className="tabular-nums">
                  ({impliedNow >= 0 ? '+' : ''}{(impliedNow * 100).toFixed(0)}% today)
                </span>
              )}
            </>
          )}
        </div>
      )}

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
          {changed
            ? `Hold to record $${proposed.toFixed(2)}`
            : isFirstTarget ? 'Pick a number to propose' : 'Drag or tap a step'}
        </span>
      </button>
    </div>
  )
}
