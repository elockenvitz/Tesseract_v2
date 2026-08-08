import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, Check, Trash2 } from 'lucide-react'
import { parseSizingInput } from '../../../lib/trade-lab/sizing-parser'
import { applyStep, type SizingMode } from '../../../lib/mobile/sizing-steps'
import type { SimulationRow } from '../../../hooks/useSimulationRows'
import { BottomSheet } from '../BottomSheet'

/**
 * Sizing modes offered as a segmented control.
 *
 * The desktop input infers the framework from the syntax — bare numbers are
 * weight, `#` prefixes shares, `@` prefixes active. That is fast to type and
 * invisible to discover, which is fine at a keyboard and wrong on a phone
 * where the user cannot see a help popover and a `#` costs a keyboard switch.
 * The mode is explicit here and writes the prefix for them.
 */

/** Deltas offered as one-tap chips, in the units of the active mode. */
const WEIGHT_STEPS = [-1, -0.5, -0.25, 0.25, 0.5, 1]
const SHARE_STEPS = [-1000, -500, -100, 100, 500, 1000]

interface MobileSizingSheetProps {
  row: SimulationRow
  portfolioTotalValue: number
  hasBenchmark: boolean
  readOnly?: boolean
  /** Commits a canonical sizing string, e.g. "2.5", "+0.5", "#500", "@t0.5". */
  onCommit: (sizingInput: string) => void
  /** Drops the position from the simulation entirely. */
  onRemove?: () => void
  onClose: () => void
}

/**
 * The sizing editor, built for a thumb.
 *
 * This is the one screen where a phone can genuinely beat the desktop. Sizing
 * a position is arithmetic against a number you already know — "take it to
 * three", "add a quarter point" — and on a phone that is a tap, where at a
 * keyboard it is a syntax. The chips are the primary control; the text field
 * is the escape hatch for anything they do not cover, and still accepts the
 * full desktop syntax so muscle memory transfers.
 *
 * The before/after readout is the other half. A sizing input alone tells you
 * what you typed, not what it does — the whole reason to open this on a phone
 * mid-meeting is to see where the position lands.
 */
export function MobileSizingSheet({
  row,
  portfolioTotalValue,
  hasBenchmark,
  readOnly,
  onCommit,
  onRemove,
  onClose,
}: MobileSizingSheetProps) {
  const existing = row.variant?.sizing_input ?? ''
  const [value, setValue] = useState(existing)
  const [mode, setMode] = useState<SizingMode>(() =>
    existing.startsWith('#') ? 'shares' : existing.startsWith('@') ? 'active' : 'weight'
  )

  // Reopening on a different row must not carry the previous row's draft.
  useEffect(() => {
    setValue(row.variant?.sizing_input ?? '')
  }, [row.asset_id, row.variant?.id])

  const price = row.baseline?.price ?? (row.simShares > 0 ? row.simNotional / row.simShares : 0)

  const parsed = useMemo(
    () => (value.trim() ? parseSizingInput(value.trim(), { has_benchmark: hasBenchmark }) : null),
    [value, hasBenchmark]
  )

  /**
   * What the position becomes, computed locally.
   *
   * The server recomputes on commit and is the authority; this exists so the
   * readout tracks the chips at tap speed rather than after a round trip. It
   * covers the frameworks the chips can produce — anything else falls back to
   * showing no projection rather than a wrong one.
   */
  const projected = useMemo(() => {
    if (!parsed?.is_valid || parsed.value == null || !price || !portfolioTotalValue) return null
    const cur = row.currentWeight
    switch (parsed.framework) {
      case 'weight_target':
        return parsed.value
      case 'weight_delta':
        return cur + (parsed.input_sign === '-' ? -parsed.value : parsed.value)
      case 'shares_target':
        return ((parsed.value * price) / portfolioTotalValue) * 100
      case 'shares_delta': {
        const delta = parsed.input_sign === '-' ? -parsed.value : parsed.value
        return (((row.currentShares + delta) * price) / portfolioTotalValue) * 100
      }
      default:
        // Active-space sizing needs the benchmark weight to resolve; the server
        // does that. Showing nothing beats showing a number that ignores it.
        return null
    }
  }, [parsed, price, portfolioTotalValue, row.currentWeight, row.currentShares])

  const deltaWeight = projected != null ? projected - row.currentWeight : null
  const deltaNotional =
    deltaWeight != null ? (deltaWeight / 100) * portfolioTotalValue : null

  /** Apply a chip. Chips are always deltas — a target is what the field is for. */
  const step = (amount: number) => setValue(v => applyStep(v, mode, amount))

  const modeChips = mode === 'shares' ? SHARE_STEPS : WEIGHT_STEPS
  const invalid = !!value.trim() && parsed && !parsed.is_valid

  return (
    <BottomSheet open onClose={onClose} title={`${row.symbol} · sizing`} snapPoints={[0.75, 0.95]}>
      <div className="px-4 pb-4 space-y-4">
        {/* Where it lands. The headline, because it is the question being asked. */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
              {(projected ?? row.simWeight).toFixed(2)}%
            </span>
            <span className="text-sm text-gray-400 tabular-nums">
              from {row.currentWeight.toFixed(2)}%
            </span>
            {deltaWeight != null && Math.abs(deltaWeight) > 0.001 && (
              <span
                className={clsx(
                  'ml-auto text-sm font-semibold tabular-nums',
                  deltaWeight > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                )}
              >
                {deltaWeight > 0 ? '+' : ''}
                {deltaWeight.toFixed(2)}%
              </span>
            )}
          </div>

          <WeightBar from={row.currentWeight} to={projected ?? row.simWeight} />

          <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
            <span className="tabular-nums">
              {row.currentShares.toLocaleString()} sh
              {projected != null && price > 0 && (
                <>
                  {' → '}
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    {Math.round((projected / 100 * portfolioTotalValue) / price).toLocaleString()} sh
                  </span>
                </>
              )}
            </span>
            {deltaNotional != null && Math.abs(deltaNotional) > 1 && (
              <span className="tabular-nums">
                {deltaNotional > 0 ? '+' : '−'}
                {formatCompactUsd(Math.abs(deltaNotional))}
              </span>
            )}
          </div>

          {/* Benchmark and active weight. Without these, sizing in active space
              is a mode with nothing to aim at — you cannot see the gap you are
              trying to close. */}
          {hasBenchmark && row.benchWeight != null && (
            <dl className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 grid grid-cols-3 gap-2">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Bench</dt>
                <dd className="text-[13px] tabular-nums text-gray-700 dark:text-gray-200">
                  {row.benchWeight.toFixed(2)}%
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Active now</dt>
                <dd className={clsx(
                  'text-[13px] tabular-nums',
                  (row.activeWeight ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                )}>
                  {row.activeWeight != null ? `${row.activeWeight >= 0 ? '+' : ''}${row.activeWeight.toFixed(2)}%` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Active after</dt>
                <dd className={clsx(
                  'text-[13px] font-semibold tabular-nums',
                  ((projected ?? row.simWeight) - row.benchWeight) >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                )}>
                  {(() => {
                    const a = (projected ?? row.simWeight) - row.benchWeight!
                    return `${a >= 0 ? '+' : ''}${a.toFixed(2)}%`
                  })()}
                </dd>
              </div>
            </dl>
          )}
        </div>

        {!readOnly && (
          <>
            {/* Mode writes the prefix, so the syntax never has to be recalled. */}
            <div className="flex gap-1">
              {(['weight', 'shares', ...(hasBenchmark ? ['active' as const] : [])] as SizingMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setValue('') }}
                  className={clsx(
                    'flex-1 h-9 rounded-lg text-sm font-medium capitalize no-touch-target',
                    mode === m
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* The primary control. Sizing on a phone should be tapping, not typing. */}
            <div className="grid grid-cols-6 gap-1.5">
              {modeChips.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => step(s)}
                  className={clsx(
                    'h-11 rounded-lg text-sm font-semibold tabular-nums border no-touch-target',
                    s > 0
                      ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-400'
                      : 'border-red-200 text-red-700 dark:border-red-900/60 dark:text-red-400'
                  )}
                >
                  {s > 0 ? '+' : ''}
                  {mode === 'shares' ? compactShares(s) : s}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Or type it
              </label>
              <input
                type="text"
                inputMode={mode === 'shares' ? 'numeric' : 'decimal'}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={mode === 'shares' ? '#500 or #+100' : mode === 'active' ? '@t0.5' : '2.5 or +0.5'}
                className={clsx(
                  'w-full h-11 px-3 rounded-lg border bg-white dark:bg-gray-800 text-[15px] tabular-nums text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2',
                  invalid
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
                )}
              />
              <p className="mt-1 text-[11px] text-gray-400">
                {invalid
                  ? parsed?.error || 'That is not a sizing this field understands.'
                  : 'A bare number is a target; a signed one is a change.'}
              </p>
            </div>

            {row.hasConflict && row.conflict && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-[12px] text-amber-800 dark:text-amber-200">
                  {row.conflict.message ?? 'This sizing works against the idea it came from.'}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              {onRemove && row.variant && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 text-red-600 dark:text-red-400 no-touch-target"
                  aria-label={`Remove ${row.symbol} from the simulation`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                disabled={!!invalid}
                onClick={() => { onCommit(value.trim()); onClose() }}
                className="flex-1 h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-40 no-touch-target"
              >
                <Check className="h-4 w-4" />
                {value.trim() ? 'Apply' : 'Clear sizing'}
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  )
}

/**
 * Current weight and simulated weight on one track.
 *
 * Two numbers a line apart do not convey how big a change is relative to the
 * position. Shown as a bar, "2.4 to 3.1" is visibly a quarter more rather than
 * arithmetic the reader has to do.
 */
function WeightBar({ from, to }: { from: number; to: number }) {
  const max = Math.max(from, to, 0.1) * 1.15
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100))
  const growing = to >= from

  return (
    <div className="mt-2 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden relative">
      <span
        className="absolute inset-y-0 left-0 bg-gray-300 dark:bg-gray-600"
        style={{ width: `${pct(Math.min(from, to))}%` }}
        aria-hidden
      />
      <span
        className={clsx(
          'absolute inset-y-0',
          growing ? 'bg-emerald-500' : 'bg-red-500'
        )}
        style={{
          left: `${pct(Math.min(from, to))}%`,
          width: `${Math.max(0, pct(Math.max(from, to)) - pct(Math.min(from, to)))}%`,
        }}
        aria-hidden
      />
    </div>
  )
}



function compactShares(n: number): string {
  const abs = Math.abs(n)
  return abs >= 1000 ? `${abs / 1000}k` : String(abs)
}

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${value.toFixed(0)}`
}
