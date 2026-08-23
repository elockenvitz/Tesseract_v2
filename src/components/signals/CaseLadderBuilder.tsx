import { useState } from 'react'
import { clsx } from 'clsx'

/**
 * Build a Bear / Base / Bull ladder in one pass.
 *
 * ── What this replaces, and why ───────────────────────────────────────────
 *
 * `TargetExplorer` on the no-target card: a row of case-name chips over a
 * slider. It set ONE number under ONE name, so the analyst who wanted the three
 * cases the chips were offering had to run the whole control three times —
 * pick Bear, drag, save; pick Base, drag, save; pick Bull, drag, save — and the
 * card gave them no way to see the three numbers together while they did it,
 * which is the only reason to have three.
 *
 * A ladder is a single judgement about a spread. It should be entered as one.
 *
 * ── Where the starting numbers come from ──────────────────────────────────
 *
 * The 52-week range, and the last close for the base. Nothing else.
 *
 * This is the one place a seed can come from honestly. A percentage rule —
 * bear at −20%, bull at +30% — would be a number this application invented and
 * then stored under somebody's name, and it would be indistinguishable from
 * their own work the moment it was saved. Where the name has traded is a fact,
 * it is already on the card, and it is what an analyst reaches for first when
 * pricing a name from nothing.
 *
 * The seed is labelled as such, and where there is no price history the rows
 * are simply empty. A blank field is a correct statement about what is known.
 *
 * ── The rows are drafts until Save ────────────────────────────────────────
 *
 * Nothing is written per row. The reader can put a bull case in, look at the
 * reward:risk it implies against the bear they just typed, and change their
 * mind — which is exactly the loop the old control could not support, because
 * each number was committed before the next one existed.
 */

/** The three the ladder assumes. A fourth is the drawer's business. */
const RUNGS = ['Bull', 'Base', 'Bear'] as const
type Rung = typeof RUNGS[number]

export const LADDER_HORIZONS = ['3 months', '6 months', '12 months', '24 months']

export interface LadderRow {
  name: string
  price: number
}

interface CaseLadderBuilderProps {
  symbol: string
  /** Last close, or the book mark. The base case seeds from it. */
  currentPrice: number | null
  /** The last year's trading range, where there is history for it. */
  range52w?: { low: number; high: number } | null
  /** Writes every filled row as a case, with the chosen horizon. */
  onSaveLadder: (rows: LadderRow[], horizon: string) => void
  /**
   * Open the full editor for one rung.
   *
   * A case carries a probability and a reason as well as a number, and neither
   * fits on a pane this size. The row collects the part that has to be quick;
   * the drawer collects the rest.
   */
  onOpenDetails?: (name: string, price: number | null) => void
  saving?: boolean
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)

/**
 * Seeds, or nothing.
 *
 * Base takes the last close rather than the midpoint of the range: the
 * midpoint is a computed opinion, and "it is worth roughly what it trades at"
 * is the honest null hypothesis somebody is about to argue with.
 */
export function seedLadder(
  currentPrice: number | null,
  range52w: { low: number; high: number } | null | undefined,
): Record<Rung, string> {
  if (!range52w || !Number.isFinite(range52w.low) || !Number.isFinite(range52w.high)) {
    return { Bull: '', Base: '', Bear: '' }
  }
  return {
    Bull: String(Number(range52w.high.toFixed(2))),
    Base: currentPrice != null && currentPrice > 0 ? String(Number(currentPrice.toFixed(2))) : '',
    Bear: String(Number(range52w.low.toFixed(2))),
  }
}

export function CaseLadderBuilder({
  symbol, currentPrice, range52w, onSaveLadder, onOpenDetails, saving,
}: CaseLadderBuilderProps) {
  const [prices, setPrices] = useState<Record<Rung, string>>(
    () => seedLadder(currentPrice, range52w),
  )
  const [horizon, setHorizon] = useState('12 months')
  /** True until the reader changes something, so the label can say so. */
  const [untouched, setUntouched] = useState(true)

  const num = (r: Rung) => {
    const v = Number.parseFloat(prices[r])
    return Number.isFinite(v) && v > 0 ? v : null
  }
  const filled: LadderRow[] = RUNGS
    .map(r => ({ name: r as string, price: num(r) }))
    .filter((r): r is LadderRow => r.price != null)

  const bear = num('Bear')
  const bull = num('Bull')
  /**
   * The same ratio `CaseSpread` shows, computed the same way and for the same
   * reason — so that the ladder somebody is TYPING is judged by the measure
   * their saved ladders will be judged by. It appears as soon as both ends
   * exist, which is what makes this an assessment rather than a form.
   */
  const skew = bear != null && bull != null && currentPrice != null && currentPrice > 0
    && bear < currentPrice && bull > currentPrice
    ? (bull - currentPrice) / (currentPrice - bear)
    : null

  const seeded = untouched && range52w != null

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="ladder-builder">
      {/* What the numbers below are, before they are read as somebody's view. */}
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <p data-slot="ladder-note" className="truncate text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {seeded ? '52-week range · adjust each' : 'No target on record'}
        </p>
        {range52w && (
          <span data-slot="ladder-52w" className="shrink-0 text-[10px] tabular-nums text-gray-400">
            52w {money(range52w.low)}–{money(range52w.high)}
          </span>
        )}
      </div>

      {/* Three rows, high to low — the order a ladder is read in. */}
      <div className="mt-1 min-h-0 flex-1" data-slot="ladder-rows">
        {RUNGS.map(r => {
          const v = num(r)
          const chg = v != null && currentPrice != null && currentPrice > 0
            ? ((v - currentPrice) / currentPrice) * 100
            : null
          return (
            <div key={r} className="flex h-[30px] items-center gap-2" data-slot="ladder-row" data-rung={r}>
              <button
                type="button"
                data-slot="ladder-name"
                onClick={() => onOpenDetails?.(r, v)}
                disabled={!onOpenDetails}
                className={clsx(
                  'w-12 shrink-0 rounded-md py-0.5 text-[10px] font-bold uppercase tracking-wide',
                  r === 'Bull' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : r === 'Bear' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
                )}
              >
                {r}
              </button>

              {/* Typed, not dragged.
                  A slider needs a range to be meaningful, and pricing a name
                  from nothing is precisely the case where nobody knows what the
                  range should be — the old control had to invent track bounds
                  around a number that did not exist yet. A keypad has no such
                  problem, and an analyst pricing a case has a figure in mind
                  rather than a position on a rail. */}
              <input
                data-slot="ladder-price"
                data-rung={r}
                inputMode="decimal"
                value={prices[r]}
                placeholder="—"
                aria-label={`${symbol} ${r} case price`}
                onChange={e => { setUntouched(false); setPrices(p => ({ ...p, [r]: e.target.value })) }}
                className="h-[26px] w-[86px] shrink-0 rounded-md border border-gray-300 px-2 text-[14px] font-bold tabular-nums dark:border-gray-600 dark:bg-gray-900"
              />

              {chg != null && (
                <span
                  data-slot="ladder-chg"
                  className={clsx(
                    'shrink-0 text-[12px] font-bold tabular-nums',
                    // Neutral at the price, not green.
                    // The seeded base case is the last close, so it renders
                    // "+0%" — and in green that reads as a gain from a card
                    // whose entire subject is that nobody has claimed one.
                    // Under half a point either way is the price, said plainly.
                    Math.abs(chg) < 0.5 ? 'text-gray-400'
                      : chg > 0 ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400',
                  )}
                >
                  {Math.abs(chg) < 0.5 ? 'at the price' : `${chg > 0 ? '+' : ''}${chg.toFixed(0)}%`}
                </span>
              )}

              {onOpenDetails && (
                <button
                  type="button"
                  data-slot="ladder-details"
                  aria-label={`${r} case details`}
                  onClick={() => onOpenDetails(r, v)}
                  className="ml-auto shrink-0 text-[11px] font-semibold text-gray-400 underline decoration-dotted no-touch-target"
                >
                  details
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Horizon once, for the ladder.
          Three cases written in one sitting share a horizon in practice, and
          asking three times would be the same repetition this control exists to
          remove. A rung that needs its own runs through the drawer. */}
      <div className="mt-1 flex shrink-0 items-center gap-1" data-slot="ladder-horizon">
        <span className="mr-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400">By</span>
        {LADDER_HORIZONS.map(h => (
          <button
            key={h}
            type="button"
            data-slot="ladder-horizon-option"
            aria-pressed={horizon === h}
            onClick={() => setHorizon(h)}
            className={clsx(
              'rounded-md px-1.5 py-0.5 text-[11px] font-bold',
              horizon === h
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
            )}
          >
            {h.replace(' months', 'M')}
          </button>
        ))}
      </div>

      {/* The verdict on what has been typed, beside the button that commits it.
          Deliberately not below: the consequence of a change belongs where the
          eye already is before pressing Save, not underneath it. */}
      <div className="mt-1 flex h-8 shrink-0 items-center gap-2">
        {skew != null && (
          <span data-slot="ladder-skew" className="shrink-0 text-[12px] tabular-nums text-gray-500">
            <span className={clsx(
              'font-bold',
              skew >= 1.5 ? 'text-emerald-600 dark:text-emerald-400'
                : skew >= 1 ? 'text-gray-900 dark:text-white'
                : 'text-rose-600 dark:text-rose-400',
            )}>{skew.toFixed(1)}×</span> reward:risk
          </span>
        )}
        <button
          type="button"
          data-slot="ladder-save"
          disabled={saving || filled.length === 0}
          onClick={() => onSaveLadder(filled, horizon)}
          className="ml-auto shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : `Save ${filled.length} case${filled.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
