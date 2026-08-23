import { useState } from 'react'
import { clsx } from 'clsx'

/**
 * The ladder a name could have, and one tap to record any rung of it.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * `TargetExplorer` on the no-target card: a row of case-name chips over a
 * slider. It set ONE number under ONE name, so an analyst who wanted the three
 * cases the chips were offering had to run the whole control three times — and
 * never saw the three together while choosing, which is the only reason to
 * have three.
 *
 * ── Why the rows start empty ──────────────────────────────────────────────
 *
 * They did not. The first version filled them from the 52-week range on sight —
 * Bull $260.10, Base $212.44, Bear $164.08 — under a line reading "suggested
 * from the 52-week range".
 *
 * That was wrong, and the label did not save it. A price rendered in the case
 * slot of a ladder IS a target as far as anybody reading the card is
 * concerned; the caption explaining otherwise is one line of 10px grey against
 * three numbers set in bold, and the card's own headline says this name has no
 * price target on record. Somebody glancing at it comes away believing the
 * ladder exists. On a screen whose entire subject is an absence, filling the
 * absence with plausible numbers is the one thing it must not do.
 *
 * So nothing is shown until somebody puts it there. `Use 52w range` fills the
 * rows in one tap for anybody who wants that starting point — which makes it a
 * choice they made rather than a state they found, and that is the whole
 * difference.
 *
 * ── Why the range itself still shows ──────────────────────────────────────
 *
 * `52w $164.08–$260.10` is a fact about the market, labelled as one, in a slot
 * that never holds a case. It is the cheapest reality check available when
 * pricing a name from nothing, and it makes no claim about anybody's view.
 *
 * ── And why nothing is written here ───────────────────────────────────────
 *
 * A case is a price, a horizon, a probability and a reason. This pane has room
 * for the first two and would silently write nulls for the rest, which is how
 * bare numbers nobody can interpret get into the database. Every row opens the
 * full editor instead.
 */

/** The three the ladder assumes. A fourth is the drawer's business. */
const RUNGS = ['Bull', 'Base', 'Bear'] as const
type Rung = typeof RUNGS[number]

/**
 * What the drawer opens with when the reader has not said otherwise.
 *
 * Every row in production is a preset string like "12 months". Shown on the row
 * rather than assumed silently: the horizon is half of what makes a target
 * checkable later, and a card offering to record one owes the reader the date
 * it runs to.
 */
export const DEFAULT_LADDER_HORIZON = '12 months'

interface CaseLadderBuilderProps {
  /** Last close, or the book mark. What a filled rung is measured against. */
  currentPrice: number | null
  /** The last year's trading range, where there is history for it. */
  range52w?: { low: number; high: number } | null
  /**
   * Open the full editor for a rung, prefilled with whatever the row holds.
   *
   * The only way anything is written.
   */
  onOpenDetails: (name: string, price: number | null, horizon: string) => void
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)
/** "12 months" reads as "12M" on a row that also carries a price and a change. */
const shortHorizon = (h: string) => h.replace(/\s*months?/, 'M').replace(/\s*years?/, 'Y')

const EMPTY: Record<Rung, number | null> = { Bull: null, Base: null, Bear: null }

/**
 * The range, spread across the rungs — only ever on request.
 *
 * Base takes the last close rather than the midpoint: the midpoint is a
 * computed opinion, and "it is worth roughly what it trades at" is the honest
 * null hypothesis somebody is about to argue with.
 */
export function seedLadder(
  currentPrice: number | null,
  range52w: { low: number; high: number } | null | undefined,
): Record<Rung, number | null> {
  if (!range52w || !Number.isFinite(range52w.low) || !Number.isFinite(range52w.high)) return EMPTY
  return {
    Bull: range52w.high,
    Base: currentPrice != null && currentPrice > 0 ? currentPrice : null,
    Bear: range52w.low,
  }
}

export function CaseLadderBuilder({
  currentPrice, range52w, onOpenDetails,
}: CaseLadderBuilderProps) {
  const [prices, setPrices] = useState<Record<Rung, number | null>>(EMPTY)
  const filled = RUNGS.some(r => prices[r] != null)

  const bear = prices.Bear
  const bull = prices.Bull
  /**
   * The same ratio `CaseSpread` shows, computed the same way — so a ladder
   * being drafted is measured by the yardstick the recorded one will be.
   *
   * Absent until the reader has filled the ends themselves, because a ratio
   * over numbers nobody chose is a verdict on nobody's view.
   */
  const skew = bear != null && bull != null && currentPrice != null && currentPrice > 0
    && bear < currentPrice && bull > currentPrice
    ? (bull - currentPrice) / (currentPrice - bear)
    : null

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="ladder-builder">
      {/* The market's own range: a fact, in a slot that never holds a case. */}
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <p data-slot="ladder-note" className="truncate text-[10px] font-bold uppercase tracking-wide text-gray-400">
          No target on record
        </p>
        {range52w && (
          <span data-slot="ladder-52w" className="shrink-0 text-[10px] tabular-nums text-gray-400">
            52w {money(range52w.low)}–{money(range52w.high)}
          </span>
        )}
      </div>

      {/* Three rows, high to low — the order a ladder is read in.
          Whole-row targets: there is one action per row, so the row IS the
          button and nothing competes for the same tap on a 34px line. */}
      <div className="mt-1.5 min-h-0 flex-1" data-slot="ladder-rows">
        {RUNGS.map(r => {
          const v = prices[r]
          const chg = v != null && currentPrice != null && currentPrice > 0
            ? ((v - currentPrice) / currentPrice) * 100
            : null
          return (
            <button
              key={r}
              type="button"
              data-slot="ladder-row"
              data-rung={r}
              onClick={() => onOpenDetails(r, v, DEFAULT_LADDER_HORIZON)}
              className="grid h-[34px] w-full grid-cols-[2.6rem_1fr_auto] items-center gap-2 text-left"
            >
              <span
                data-slot="ladder-name"
                className={clsx(
                  'text-[10px] font-bold uppercase tracking-wide',
                  r === 'Bull' ? 'text-emerald-600 dark:text-emerald-400'
                    : r === 'Bear' ? 'text-rose-600 dark:text-rose-400'
                    : 'text-gray-500 dark:text-gray-400',
                )}
              >
                {r}
              </span>

              <span
                data-slot="ladder-value"
                data-rung={r}
                className={clsx(
                  'justify-self-start tabular-nums',
                  v != null
                    ? 'text-[15px] font-bold text-gray-900 dark:text-white'
                    // Deliberately not bold and not a figure. An empty rung has
                    // to be unmistakably empty from across the room.
                    : 'text-[13px] text-gray-400',
                )}
              >
                {v != null ? money(v) : 'Set a price'}
              </span>

              <span className="flex items-center gap-2 justify-self-end">
                {chg != null && (
                  <span
                    data-slot="ladder-chg"
                    className={clsx(
                      'text-[12px] font-bold tabular-nums',
                      // Neutral at the price, not green: a base case at the last
                      // close renders 0%, and green there reads as a gain on a
                      // card whose subject is that nobody has claimed one.
                      Math.abs(chg) < 0.5 ? 'text-gray-400'
                        : chg > 0 ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {Math.abs(chg) < 0.5 ? 'at the price' : `${chg > 0 ? '+' : ''}${chg.toFixed(0)}%`}
                  </span>
                )}
                <span
                  data-slot="ladder-horizon"
                  className="w-8 shrink-0 text-right text-[11px] font-bold tabular-nums text-gray-400"
                >
                  {shortHorizon(DEFAULT_LADDER_HORIZON)}
                </span>
                <span aria-hidden className="w-2 shrink-0 text-[15px] leading-none text-gray-300 dark:text-gray-600">
                  ›
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-1 flex h-6 shrink-0 items-center gap-2">
        {/* The starting point, as something chosen rather than something found.
            Same numbers the card used to show on sight; the difference is
            entirely that a person asked for them, which is what stops a
            suggestion being read as a record. */}
        {range52w && !filled ? (
          <button
            type="button"
            data-slot="ladder-seed"
            onClick={() => setPrices(seedLadder(currentPrice, range52w))}
            className="shrink-0 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            Use 52w range
          </button>
        ) : (
          <span data-slot="ladder-hint" className="truncate text-[11px] text-gray-400">
            Tap a case to record it
          </span>
        )}
        {skew != null && (
          <span data-slot="ladder-skew" className="ml-auto shrink-0 text-[11px] tabular-nums text-gray-500">
            <span className={clsx(
              'text-[13px] font-bold',
              skew >= 1.5 ? 'text-emerald-600 dark:text-emerald-400'
                : skew >= 1 ? 'text-gray-900 dark:text-white'
                : 'text-rose-600 dark:text-rose-400',
            )}>{skew.toFixed(1)}×</span> reward:risk
          </span>
        )}
      </div>
    </div>
  )
}
