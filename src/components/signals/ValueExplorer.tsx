import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Pencil } from 'lucide-react'

import { DragTrack } from './DragTrack'

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
   * What Save actually DOES, in the reader's words.
   *
   * "Hold to record" was the old label and nobody could tell what it recorded
   * — a target? a trade? The button is the only place that ambiguity can be
   * settled without a paragraph of instructions, so it names the artefact:
   * "Record a thought", "Propose as an idea".
   */
  saveLabel?: string
  saving?: boolean
  /**
   * A third live figure in the values row, in place of an empty record.
   *
   * Measured on the oversized tile: the row was Current / Staged / Proposed,
   * and the conviction branch never stages anything — so a third of the row
   * read "None set" while the number the reader actually wanted, the change in
   * points, sat in a row of its own beneath the commit buttons. That extra row
   * was what put the pane 0.8px over its 172px budget.
   *
   * Passing a trailing figure moves it up beside the two numbers it is derived
   * from and removes the row. It also fixes the reading order: the consequence
   * of a proposal now sits above the button that commits it rather than under
   * it.
   */
  trailing?: { label: string; value: string } | null
  /**
   * Drop the recorded column when there is nothing recorded.
   *
   * Only for callers where absence is uninteresting. On a target card "None
   * set" is the entire point of the card and must stay.
   */
  hideEmptyRecorded?: boolean
  /** Test/measurement hook. */
  slot?: string
}

export function ValueExplorer({
  referenceLabel, recordedLabel, proposedLabel = 'Proposed',
  state, onChange, onSave, format, secondary, reachable = [], presets,
  step, saving, saveLabel = 'Save', slot = 'value-explorer',
  trailing, hideEmptyRecorded,
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
  /**
   * The bounds re-snapped to whatever step is actually in use.
   *
   * `sliderRange` derives a step and puts its own bounds on that grid, so
   * every round number in range is reachable. A caller overriding `step` — a
   * weight moves in tenths of a point regardless of span — breaks that
   * alignment, and the values reachable become `min + n * 0.1` off a minimum
   * that is not a multiple of 0.1. The reader aims at 5.0% and lands on
   * 4.97%, which is the exact failure the grid alignment exists to prevent.
   */
  const trackMin = Math.max(0, Math.floor(range.min / resolvedStep) * resolvedStep)
  const trackMax = Math.ceil(range.max / resolvedStep) * resolvedStep

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
    /* `overflow-hidden`: a floor, not a fix.
       Every child here is `shrink-0` and this box is `h-full` with shrink 1,
       so when the pane is smaller than the content the box shrinks and the
       content keeps its size and paints straight through whatever follows.
       That is how a 0.8px overshoot became a reported overlap rather than a
       0.8px clip. The rows above are budgeted to fit; this makes the failure
       mode a truncation if one of them ever grows again. */
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot={slot}>
      {/* The three values. Reference and record are always present; the
          proposal joins them only once it exists, so the row itself says
          whether anything is being explored. */}
      {/* Measured to fit.
          The pane floor is 172px and this control had grown past it: three
          figure rows at 17px, a preset row, a 44px track and a 40px footer
          come to roughly 190px, so the commit buttons fell off the bottom and
          on the size card the extra rows overlapped the text. Every row below
          is sized against that budget rather than chosen for looks. */}
      <div className="flex shrink-0 items-start gap-3">
        <Figure
          label={referenceLabel}
          value={state.reference}
          format={format}
          slot="reference"
        />
        {!(hideEmptyRecorded && state.recorded == null) && (
          <Figure
            label={recordedLabel}
            value={state.recorded}
            format={format}
            secondary={secondary}
            slot="recorded"
            emptyNote="None set"
          />
        )}
        {/* The proposal, editable, IN the row.
            It was a separate control below, which put the three values on two
            lines and made the entry box read as a read-out of the slider. All
            three belong on one line — current, recorded, proposed — because
            comparing them is the entire job of this control, and the one you
            can change is the one you tap. */}
        <div data-slot="proposed" className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-primary-500">
            {proposedLabel}
          </p>
          {typing === null ? (
            <button
              type="button"
              data-slot="value-tap"
              onClick={() => setTyping(shown != null ? String(Number(shown.toFixed(2))) : '')}
              className="flex items-center gap-1 text-[17px] font-bold tabular-nums leading-tight text-primary-600 dark:text-primary-400"
            >
              {state.proposed != null ? format(state.proposed) : (shown != null ? format(shown) : '—')}
              <Pencil className="h-3 w-3 text-primary-400" aria-hidden />
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
              className="w-20 rounded border border-primary-500 px-1 py-0.5 text-[15px] font-bold tabular-nums"
            />
          )}

        </div>

        {/* The consequence, beside its cause. */}
        {trailing && (
          <div data-slot="trailing" className="ml-auto min-w-0 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
              {trailing.label}
            </p>
            <p className="text-[17px] font-bold tabular-nums leading-tight text-gray-900 dark:text-white">
              {trailing.value}
            </p>
          </div>
        )}
      </div>

      {/* Presets and reset. No plus/minus: two more buttons on a row that was
          already clipping, to move a value by an amount too small to matter on
          a target. The presets below step in amounts somebody would actually
          choose, and exact entry is a tap on the figure above. */}
      <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-1">
        {presets?.map(p => (
          <button
            key={p.label}
            type="button"
            data-slot="preset"
            onClick={() => { const v = p.value(); if (v != null) onChange(propose(state, v)) }}
            className="rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* The track. See `DragTrack` for why this is not an `<input
          type="range">`: that control quantises before you see it, does
          nothing on a tap, and arbitrates its gesture on the browser's terms
          rather than on this app's. */}
      <DragTrack
        min={trackMin}
        max={trackMax}
        step={resolvedStep}
        value={shown ?? trackMin}
        onChange={v => onChange(propose(state, v))}
        label={`${proposedLabel} value`}
        // The number of record on the track, so "how far have I moved this"
        // is answerable without reading a figure.
        marks={[
          ...(state.recorded != null ? [{ value: state.recorded, label: recordedLabel }] : []),
          ...(state.reference != null ? [{ value: state.reference, label: referenceLabel }] : []),
        ]}
      />

      {/* Save and Cancel exist only while a proposal does. Their presence is
          how the reader knows nothing has been written yet — which is why
          there is no sentence anywhere on this control explaining that. */}
      {/* The consequence lives DOWN HERE, on the footer row.
          ── Why it moved ────────────────────────────────────────────────────
          It sat under the proposed figure, and it only exists once there is a
          proposal — so the first touch of the slider inserted a line above the
          track and the whole control jumped down under the finger. Reported on
          the no-target card: "as I start using the slider it jumps down to
          accommodate the % diff vs current."
          The footer is already a fixed-height row that appears with the same
          condition, so putting the number there costs no additional height and
          nothing above the track can move. */}
      {/* Packed from the TOP, not pinned to the bottom.
          `mt-auto` pushed this row onto the pane's bottom edge — which is the
          edge the card's action bar reserve clips, so the Save and Cancel
          buttons sat under it. The values, the presets and the track are all
          fixed height, so letting them stack naturally puts the commit row
          immediately below the track with room to spare, wherever the pane
          ends. */}
      <div className="mt-1.5 flex h-9 shrink-0 items-center gap-2">
        {state.proposed != null && secondary?.(state.proposed) && (
          <span
            data-slot="proposed-secondary"
            className="min-w-0 flex-1 truncate text-[12px] font-bold tabular-nums text-primary-600 dark:text-primary-400"
          >
            {secondary(state.proposed)}
          </span>
        )}
        {dirty && (
          <>
            {/* Reset lives here, not on the presets row.
                On the presets row it appeared only when dirty, so the FIRST
                drag added a chip, the row wrapped to a second line, and the
                track below it moved down under the finger. Reported as the
                slider jumping to the bottom of the card the moment you use it.
                The footer is a fixed-height row that appears on exactly the
                same condition, so nothing above the track can change size. */}
          {/* Reset is gone, and it was never a second behaviour.
              It called `resetExploration(state)` — the identical handler as
              Cancel, on the identical condition, three buttons apart on a row
              already too tight to hold "Propose as an idea" beside a change
              figure. Two labels for one action is not a choice; it is a reason
              to hesitate. Cancel is the one that survives because it is the
              word paired with Save everywhere else in the app. */}
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
          </>
        )}
      </div>
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
