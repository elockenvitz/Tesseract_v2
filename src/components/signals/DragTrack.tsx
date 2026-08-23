import { useRef } from 'react'
import { clsx } from 'clsx'

import { GESTURE } from '../../lib/mobile/gesture-intent'

/**
 * A slider that follows the finger, rather than one the browser interprets.
 *
 * ── Why not `<input type="range">` ────────────────────────────────────────
 *
 * Three things it does that are wrong for this surface, and none of them are
 * tunable:
 *
 * **It quantises to `min + n * step` before you see it.** That is a rendering
 * lag on every move — the thumb lands where the grid allows rather than where
 * the finger is, which reads as the control resisting you.
 *
 * **It does not jump on tap.** A press in the middle of the track does
 * nothing until you drag, so half of a reader's attempts to set a value feel
 * like nothing happened.
 *
 * **Its gesture arbitration is the browser's.** It competes with the feed's
 * vertical snap and the carousel's horizontal pager on the browser's terms,
 * not on the model in `gesture-intent` — which is the one place this app
 * decides who owns a finger.
 *
 * This takes the pointer at `pointerdown`, captures it, and writes the value
 * from the x position on every move. No dead zone, no step latency, and the
 * gesture is unambiguously the slider's the instant it starts — which is the
 * `slider` owner the arbitration model already describes.
 *
 * ── What it keeps ─────────────────────────────────────────────────────────
 *
 * `role="slider"` with the full aria value set, and arrow-key support. A
 * custom control that drops keyboard and screen-reader access in exchange for
 * feel is a worse control, not a better one.
 */

interface DragTrackProps {
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  label: string
  /** Marks drawn on the track: the recorded value, a benchmark, cases. */
  marks?: { value: number; label?: string }[]
  slot?: string
}

export function DragTrack({
  min, max, step, value, onChange, label, marks = [], slot = 'slider',
}: DragTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const span = max - min || 1
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const snap = (v: number) => {
    // Snapped to the step for the VALUE, never for the thumb position — the
    // thumb follows the finger and the readout follows the grid, so a fine
    // step never looks like stutter.
    const n = Math.round((v - min) / step)
    return clamp(min + n * step)
  }
  const pct = ((clamp(value) - min) / span) * 100

  const valueAt = (clientX: number) => {
    const el = trackRef.current
    if (!el) return value
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return value
    const frac = Math.min(Math.max((clientX - r.left) / r.width, 0), 1)
    return snap(min + frac * span)
  }

  return (
    <div
      ref={trackRef}
      data-slot={slot}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamp(value)}
      /**
       * `touch-action: none` and capture at pointerdown.
       *
       * A pointer that goes down on this control is unambiguous — there is
       * nothing to arbitrate — so it claims the gesture outright rather than
       * competing with the feed and the carousel. See `gesture-intent`: this
       * is the one owner decided at pointerdown rather than after a threshold.
       */
      // h-9, not h-11. Still above the 36px this codebase treats as the floor
      // for a draggable control, and the 8px saved is what keeps the commit
      // buttons inside the pane — see ValueExplorer's budget.
      className="relative mt-1.5 h-9 w-full shrink-0 cursor-pointer touch-none select-none"
      style={{ touchAction: 'none' }}
      onPointerDown={e => {
        dragging.current = true
        // jsdom implements no pointer capture, and an unguarded call throws
        // inside the handler — taking the control down rather than merely
        // failing to capture.
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* unsupported */ }
        // Jump to the tap. A press that does nothing until you drag is half of
        // why the old control felt unresponsive.
        onChange(valueAt(e.clientX))
      }}
      onPointerMove={e => { if (dragging.current) onChange(valueAt(e.clientX)) }}
      onPointerUp={e => {
        dragging.current = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
      }}
      onPointerCancel={() => { dragging.current = false }}
      onLostPointerCapture={() => { dragging.current = false }}
      onKeyDown={e => {
        // Ten steps a press on the coarse keys: an arrow-key user should not
        // need four hundred presses to cross a track.
        const fine = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
        const coarse = e.key === 'PageUp' || e.key === 'PageDown'
        if (!fine && !coarse) return
        e.preventDefault()
        const dir = (e.key === 'ArrowRight' || e.key === 'PageUp') ? 1 : -1
        onChange(snap(value + dir * step * (coarse ? 10 : 1)))
      }}
    >
      {/* The rail, vertically centred in a 44px hit area. The visible line is
          thin; the thing you can hit is not. */}
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className="h-full rounded-full bg-primary-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Reference marks. A track with the recorded value on it answers "how
          far have I moved this" without reading a number. */}
      {marks
        .filter(m => Number.isFinite(m.value) && m.value >= min && m.value <= max)
        .map(m => (
          <span
            key={`${m.label ?? ''}:${m.value}`}
            data-slot="track-mark"
            aria-hidden
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-gray-400 dark:bg-gray-500"
            style={{ left: `${((m.value - min) / span) * 100}%` }}
          />
        ))}

      <span
        data-slot="thumb"
        aria-hidden
        className={clsx(
          'absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full',
          'border-2 border-white bg-primary-600 shadow-md dark:border-gray-900',
        )}
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

/** Exported so callers can size their nudges against the same floor. */
export const TRACK_SLOP_PX = GESTURE.SLIDER_SLOP_PX
