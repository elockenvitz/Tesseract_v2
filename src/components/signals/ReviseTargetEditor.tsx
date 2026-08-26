import { useMemo, useState } from 'react'
import { clsx } from 'clsx'

import { parseNumericEntry } from '../../lib/mobile/exploration'
import {
  deviationFrom, referenceLabelFor, type PriceSnapshot,
} from '../../lib/signals/price-snapshot'

/**
 * A new number and a new horizon, in the smallest control that can carry both.
 *
 * ── Why this is not `TargetExplorer` ──────────────────────────────────────
 *
 * `TargetExplorer` is a slider over one value. Two things make it the wrong
 * control here.
 *
 * First, it cannot express a horizon, and a horizon is half of what this card
 * is about. A target edited without one leaves the signal firing — see
 * `resolvesExpiry` — so an editor that can only change the price is an editor
 * that cannot resolve the card it is reached from.
 *
 * Second, its adjustment chips read `−20% −10% +10% +20% +50%` with no stated
 * reference. They were percentages off the current price, which the docstring
 * says and the surface does not: sitting under a row headed OLD TARGET and a
 * row headed NEW TARGET, "+20%" has three plausible meanings and the control
 * picks none of them. The chips here name their reference in the row's own
 * heading, and the number field is the precision mechanism — you type the
 * target, because a target is a considered figure and not something anybody
 * arrives at by dragging.
 *
 * ── The three rows, and why each is on screen at once ─────────────────────
 *
 *   CURRENT PRICE   what the market says, from the card's one snapshot
 *   OLD TARGET      the number that expired, so the change is visible
 *   NEW TARGET      what the reader is proposing
 *   NEW HORIZON     required, and the reason this resolves anything
 *
 * All four, because the judgement being made is "given where it trades and what
 * I said last time, what do I say now, and for how long". Any row removed turns
 * that into arithmetic the reader has to do from memory.
 */

/** The horizons the rest of the product offers. Matches `MobileCaseTargets`. */
export const HORIZON_PRESETS = ['3 months', '6 months', '12 months', '18 months', '24 months'] as const

export interface ReviseTargetValue {
  target: number
  horizon: string
}

interface ReviseTargetEditorProps {
  symbol: string
  /** The card's one price. See `price-snapshot`. */
  snapshot: PriceSnapshot | null
  /** The target that expired. Null only where the name never had one. */
  recordedTarget: number | null
  /** The horizon that expired, e.g. "6 months". Shown as the one NOT to reuse. */
  expiredHorizon: string | null
  /**
   * Price editing off, for "Still valid".
   *
   * The reader has said the number stands and only the clock ran out, so
   * offering to change it invites an edit they did not ask to make. The row
   * still SHOWS the target, because "keeping this number" is the decision and
   * it should be visible while they make it.
   */
  horizonOnly?: boolean
  onSave: (value: ReviseTargetValue) => void
  saving?: boolean
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400">
        {label}
      </span>
      {children}
    </div>
  )
}

export function ReviseTargetEditor({
  symbol, snapshot, recordedTarget, expiredHorizon, horizonOnly = false, onSave, saving,
}: ReviseTargetEditorProps) {
  const [entry, setEntry] = useState(() => (recordedTarget != null ? recordedTarget.toFixed(2) : ''))
  const [horizon, setHorizon] = useState<string | null>(null)

  const proposed = horizonOnly ? recordedTarget : parseNumericEntry(entry)
  const deviation = deviationFrom(proposed, snapshot)

  /**
   * The chips, with their reference named in the heading above them.
   *
   * Off the CURRENT PRICE, which is also what the deviation under the field is
   * quoted against — so "+20%" on a chip and "+20.0% vs current price" under
   * the number are one statement rather than two coincidentally similar ones.
   * Absent entirely when there is no price: a percentage of nothing is not a
   * shortcut, it is a wrong number with a confident label.
   */
  const chips = useMemo(() => {
    const base = snapshot?.price
    if (base == null) return []
    return [-20, -10, 10, 20, 50].map(pct => ({
      pct,
      label: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`,
      value: base * (1 + pct / 100),
    }))
  }, [snapshot])

  const canSave = proposed != null && proposed > 0 && !!horizon && !saving

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden" data-testid="revise-target">
      <div className="shrink-0 space-y-1.5 text-[13px] tabular-nums">
        <Row label={referenceLabelFor(snapshot)}>
          <span
            className="font-bold text-gray-900 dark:text-white"
            data-testid="revise-current-price"
            data-price-source={snapshot?.source ?? 'none'}
          >
            {snapshot ? money(snapshot.price) : '—'}
          </span>
        </Row>
        <Row label="Old target">
          <span className="font-semibold text-gray-500 dark:text-gray-400" data-testid="revise-old-target">
            {recordedTarget != null ? money(recordedTarget) : '—'}
            {expiredHorizon ? (
              <span className="ml-1.5 font-medium text-gray-400">· {expiredHorizon}, expired</span>
            ) : null}
          </span>
        </Row>
      </div>

      {/* The number itself. Typed, not dragged — see the header. */}
      {!horizonOnly && (
        <div className="shrink-0">
          <Row label="New target">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-bold text-gray-400">$</span>
              <input
                data-testid="revise-target-input"
                inputMode="decimal"
                value={entry}
                onChange={e => setEntry(e.target.value)}
                aria-label={`New ${symbol} target`}
                className="h-9 w-24 rounded-lg border border-gray-300 px-2 text-right text-[15px] font-bold tabular-nums dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              />
            </div>
          </Row>
          {/* The deviation, against the same snapshot the chips use. */}
          <p
            className="mt-1 text-right text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400"
            data-testid="revise-deviation"
          >
            {deviation == null
              ? 'No price to compare against'
              : `${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}% vs ${referenceLabelFor(snapshot).toLowerCase()}`}
          </p>
        </div>
      )}

      {/* Chips name their reference. This heading IS the fix for the unanchored
          −20% / +50% row: the numbers are meaningless without it. */}
      {!horizonOnly && chips.length > 0 && (
        <div className="shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
            From {referenceLabelFor(snapshot).toLowerCase()}
          </p>
          <div className="mt-1 flex gap-1" data-testid="revise-chips">
            {chips.map(c => (
              <button
                key={c.pct}
                type="button"
                data-revise-chip={c.pct}
                onClick={() => setEntry(c.value.toFixed(2))}
                className="flex-1 rounded-lg border border-gray-200 py-1 text-[11px] font-bold text-gray-600 dark:border-gray-700 dark:text-gray-300 no-touch-target"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Required, and the control says so rather than failing on save.
          A horizon is what makes this an answer to the card — see
          `resolvesExpiry`. The expired one is deliberately not preselected. */}
      <div className="mt-auto shrink-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          New horizon <span className="text-amber-600 dark:text-amber-400">· required</span>
        </p>
        <div className="mt-1 flex gap-1" data-testid="revise-horizons">
          {HORIZON_PRESETS.map(h => (
            <button
              key={h}
              type="button"
              data-revise-horizon={h}
              aria-pressed={horizon === h}
              onClick={() => setHorizon(h)}
              className={clsx(
                'flex-1 rounded-lg border py-1 text-[11px] font-bold transition-colors no-touch-target',
                horizon === h
                  ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                  : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
              )}
            >
              {h.replace(' months', 'M')}
            </button>
          ))}
        </div>

        <button
          type="button"
          data-testid="revise-save"
          disabled={!canSave}
          onClick={() => { if (proposed != null && horizon) onSave({ target: proposed, horizon }) }}
          className={clsx(
            'mt-2 h-11 w-full rounded-xl text-[14px] font-bold transition-colors no-touch-target',
            canSave
              ? 'bg-primary-600 text-white shadow-sm active:bg-primary-800'
              : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
          )}
        >
          {saving ? 'Saving…' : horizonOnly ? 'Refresh view' : 'Save target'}
        </button>
        {!horizon && (
          <p className="mt-1 text-[10px] font-medium text-gray-400" data-testid="revise-horizon-required">
            A new horizon is what clears this card. Without one the view stays expired.
          </p>
        )}
      </div>
    </div>
  )
}
