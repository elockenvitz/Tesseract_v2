import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Pencil } from 'lucide-react'

import {
  commitExploration, displayedValue, isDirty, parseNumericEntry, propose,
  resetExploration, sliderRange, type Exploration,
} from '../../lib/mobile/exploration'

/**
 * One control for exploring a number, wearing whatever labels the card needs.
 *
 * ── Why the three values are always on screen ─────────────────────────────
 *
 * "Never require the user to infer which value a number represents." The old
 * controls showed a single figure that silently changed meaning as you dragged
 * — market price, then saved target, then your proposal — and there was no way
 * to tell which one you were looking at, or what you would be overwriting.
 *
 * So the reference and the record are always visible, and the proposal appears
 * beside them the moment it exists. Three labelled rows cost about 40px and
 * remove the entire class of "which number is this".
 *
 * ── Why it explains itself through state rather than copy ─────────────────
 *
 * There is no instructional text. The Save and Cancel controls only exist
 * while a proposal exists, so their presence IS the message that you are in an
 * exploratory state and nothing has been written yet.
 */

export interface ValueExplorerProps {
  /** e.g. "Current" — what the proposal is measured against. */
  referenceLabel: string
  /** e.g. "Recorded target". */
  recordedLabel: string
  /** e.g. "Proposed". */
  proposedLabel?: string
  state: Exploration
  onChange: (next: Exploration) => void
  /** Persist. Only called with a genuinely changed value. */
  onSave: (value: number) => void
  /** Render a number as the reader should see it. */
  format: (v: number) => string
  /**
   * The secondary figure under a value — upside, or a change in points.
   * Returns null when it cannot be computed, and nothing is rendered rather
   * than a zero standing in for unknown.
   */
  secondary?: (v: number) => string | null
  /** Extra levels the slider must be able to reach: cases, benchmark. */
  reachable?: (number | null | undefined)[]
  /** Quick presets, e.g. Half / -1pt. Omitted when the card has none. */
  presets?: { label: string; value: () => number | null }[]
  step?: number
  /**
   * Step for the plus/minus buttons, in the value's own unit.
   *
   * Omit to hide them. A target nudges in dollars, a weight in tenths of a
   * point, and neither is reachable by dragging a 300px track.
   */
  nudge?: number
  /**
   * What Save actually DOES, in the reader's words.
   *
   * "Hold to record" was the old label and nobody could tell what it recorded
   * — a target? a trade? The button is the only place that ambiguity can be
   * settled without a paragraph of instructions, so it names the artefact:
   * "Record a thought", "Propose as an idea".
   */
  saveLabel?: string
  saving?: boolean
  /** Test/measurement hook. */
  slot?: string
}

export function ValueExplorer({
  referenceLabel, recordedLabel, proposedLabel = 'Proposed',
  state, onChange, onSave, format, secondary, reachable = [], presets,
  step, nudge, saving, saveLabel = 'Save', slot = 'value-explorer',
}: ValueExplorerProps) {
  const [typing, setTyping] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const dirty = isDirty(state)
  const shown = displayedValue(state)
  const range = sliderRange([state.reference, state.recorded, ...reachable, state.proposed])
  // The range decides its own step so the bounds sit ON the grid — see
  // `sliderRange`. A caller may still override it where the unit demands one
  // (weights step in tenths of a point regardless of the span).
  const resolvedStep = step ?? range.step

  useEffect(() => {
    if (typing === null) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    /**
     * Bring the field above the keyboard.
     *
     * On a phone the software keyboard covers roughly the bottom 40% of the
     * viewport, and these controls live in a card's evidence band — which is
     * exactly where it lands. Reported as the keyboard interfering with being
     * able to see the value being typed.
     *
     * `block: 'center'` rather than `nearest`: the browser considers a field
     * that is technically on screen to need no scrolling, and it cannot know
     * the bottom of that screen is now a keyboard. Centring is the only
     * request that reliably clears it.
     *
     * Deferred a frame so the scroll happens after the focus has resized the
     * visual viewport, not before.
     */
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [typing])

  const commit = () => {
    const done = commitExploration(state)
    if (!done) return
    onSave(done.saved)
    onChange(done.next)
  }

  const acceptTyped = () => {
    if (typing === null) return
    const parsed = parseNumericEntry(typing)
    // A rejected entry leaves the state alone rather than zeroing it.
    // `Number('')` is 0, and 0 is a value somebody could have meant.
    if (parsed != null) onChange(propose(state, parsed))
    setTyping(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot={slot}>
      {/* The three values. Reference and record are always present; the
          proposal joins them only once it exists, so the row itself says
          whether anything is being explored. */}
      <div className="flex shrink-0 items-start gap-4">
        <Figure
          label={referenceLabel}
          value={state.reference}
          format={format}
          slot="reference"
        />
        <Figure
          label={recordedLabel}
          value={state.recorded}
          format={format}
          secondary={secondary}
          slot="recorded"
          emptyNote="None set"
        />
        {/* The proposal lives on the editable control below, not here — two
            places showing one number was the confusion. Its consequence still
            belongs beside the others, so only that is repeated. */}
        {state.proposed != null && secondary?.(state.proposed) && (
          <div data-slot="proposed" className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary-500">
              {proposedLabel}
            </p>
            <p data-slot="proposed-secondary" className="text-[13px] font-bold tabular-nums text-primary-600 dark:text-primary-400">
              {secondary(state.proposed)}
            </p>
          </div>
        )}
      </div>

      {/* Direct entry, ON the proposed figure.
          It used to be a separate box below the row, which made two places
          showing the same number and neither obviously the one you type in.
          The proposed value IS the editable one, so tapping it edits it —
          which is also what makes "how do I enter an exact target" answer
          itself. */}
      {/* Wraps rather than clipping. At 390px a row of an entry box, two
          nudges and three presets runs past the card, and the labels were
          cutting mid-word. */}
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1.5">
        {typing === null ? (
          <button
            type="button"
            data-slot="value-tap"
            onClick={() => setTyping(shown != null ? String(Number(shown.toFixed(2))) : '')}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px] font-bold tabular-nums text-gray-900 dark:border-gray-600 dark:text-white"
          >
            <Pencil className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
              {proposedLabel}
            </span>
            {shown != null ? format(shown) : '—'}
          </button>
        ) : (
          <input
            ref={inputRef}
            data-slot="value-input"
            // `decimal` rather than `numeric`: iOS shows a keypad with a
            // decimal separator, which a price needs and a PIN pad lacks.
            inputMode="decimal"
            value={typing}
            onChange={e => setTyping(e.target.value)}
            onBlur={acceptTyped}
            onKeyDown={e => {
              if (e.key === 'Enter') acceptTyped()
              if (e.key === 'Escape') setTyping(null)
            }}
            className="w-24 rounded border border-primary-500 px-2 py-1 text-[13px] font-bold tabular-nums"
          />
        )}

        {/* Nudges. A slider on a phone is 300px wide, so a dollar is a pixel
            and the last few are unreachable by drag at any sensitivity. These
            are how somebody lands on an exact figure without opening a
            keyboard. */}
        {nudge != null && (
          <div className="flex items-center gap-1" data-slot="nudge">
            <button
              type="button"
              data-slot="nudge-down"
              aria-label="Decrease"
              onClick={() => shown != null && onChange(propose(state, Math.max(0, shown - nudge)))}
              className="h-8 w-8 rounded-lg bg-gray-100 text-[15px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              −
            </button>
            <button
              type="button"
              data-slot="nudge-up"
              aria-label="Increase"
              onClick={() => shown != null && onChange(propose(state, shown + nudge))}
              className="h-8 w-8 rounded-lg bg-gray-100 text-[15px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              +
            </button>
          </div>
        )}

        {presets?.map(p => (
          <button
            key={p.label}
            type="button"
            data-slot="preset"
            onClick={() => { const v = p.value(); if (v != null) onChange(propose(state, v)) }}
            className="rounded bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            {p.label}
          </button>
        ))}

        {dirty && (
          <button
            type="button"
            data-slot="reset"
            onClick={() => onChange(resetExploration(state))}
            className="ml-auto text-[11px] font-semibold text-gray-500 underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* The track.
          `touch-action: none` and pointer capture, both deliberate: a pointer
          that goes down on a thumb is unambiguous, so the slider claims the
          gesture outright rather than competing with the carousel and the
          feed. See `gesture-intent` — this is the `slider` owner, and it is
          the one case decided at pointerdown rather than after a threshold. */}
      <input
        type="range"
        data-slot="slider"
        aria-label={`${proposedLabel} value`}
        min={range.min}
        max={range.max}
        step={resolvedStep}
        value={shown ?? range.min}
        onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
        onChange={e => onChange(propose(state, Number(e.target.value)))}
        className="mt-3 h-9 w-full shrink-0 cursor-pointer touch-none accent-primary-600"
        style={{ touchAction: 'none' }}
      />

      {/* Save and Cancel exist only while a proposal does. Their presence is
          how the reader knows nothing has been written yet — which is why
          there is no sentence anywhere on this control explaining that. */}
      {dirty && (
        // `pb-1` and `mt-auto`: the commit row sat flush against the bottom
        // edge of the pane and clipped on shorter screens.
        <div className="mt-auto flex shrink-0 gap-2 pb-1 pt-2">
          <button
            type="button"
            data-slot="save"
            disabled={saving}
            onClick={commit}
            className="rounded bg-primary-600 px-3 py-1.5 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
          <button
            type="button"
            data-slot="cancel"
            onClick={() => onChange(resetExploration(state))}
            className="rounded border border-gray-300 px-3 py-1.5 text-[13px] font-semibold text-gray-600 dark:border-gray-600 dark:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function Figure({
  label, value, format, secondary, slot, accent, emptyNote,
}: {
  label: string
  value: number | null
  format: (v: number) => string
  secondary?: (v: number) => string | null
  slot: string
  accent?: boolean
  emptyNote?: string
}) {
  const sub = value != null && secondary ? secondary(value) : null
  return (
    <div data-slot={slot} className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={clsx(
        'text-[17px] font-bold tabular-nums leading-tight',
        accent ? 'text-primary-600 dark:text-primary-400' : 'text-gray-900 dark:text-white',
      )}>
        {value != null ? format(value) : (emptyNote ?? '—')}
      </p>
      {/* Rendered only when it can be computed. A card that cannot work out
          upside must say nothing, not claim the upside is flat. */}
      {sub && (
        <p data-slot={`${slot}-secondary`} className="text-[11px] font-semibold tabular-nums text-gray-500">
          {sub}
        </p>
      )}
    </div>
  )
}
