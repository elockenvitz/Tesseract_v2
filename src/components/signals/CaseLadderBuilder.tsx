import { clsx } from 'clsx'

/**
 * The ladder a name could have, and one tap to record any rung of it.
 *
 * ── What this replaces, and why ───────────────────────────────────────────
 *
 * `TargetExplorer` on the no-target card: a row of case-name chips over a
 * slider. It set ONE number under ONE name, so an analyst who wanted the three
 * cases the chips were offering had to run the whole control three times — pick
 * Bear, drag, save; pick Base, drag, save — and never saw the three numbers
 * together while choosing, which is the only reason to have three.
 *
 * ── Why nothing is edited here any more ───────────────────────────────────
 *
 * The first replacement made the rows editable in place: tap a number, type a
 * new one, press Save and write all three at once. It was quick and it was too
 * much furniture — an input, a horizon selector and a commit button stacked
 * into a 172px pane, reported as "getting too busy".
 *
 * And the quick path was quick about the wrong thing. A case is a price, a
 * horizon, a probability and a reason; the card had room for the price and
 * silently wrote nulls for the rest. Saving three cases in one tap mostly
 * created three bare numbers somebody would have to interpret later, which is
 * the complaint this whole area began with.
 *
 * So the card states the ladder and the drawer records it. Every row opens the
 * full editor, prefilled — which costs one tap more per case and collects all
 * four fields instead of one.
 *
 * ── Where the numbers come from ───────────────────────────────────────────
 *
 * The 52-week range, and the last close for the base. Nothing else.
 *
 * This is the one place a suggestion can come from honestly. A percentage rule
 * — bear at −20%, bull at +30% — would be a number this application invented,
 * and once saved it would be indistinguishable from the analyst's own work.
 * Where the name has traded is a fact, it is already on the card, and it is
 * what somebody reaches for first when pricing a name from nothing.
 *
 * Nothing here is written until the drawer writes it, so the suggestion never
 * becomes a record by accident. Where there is no price history the rows carry
 * no price at all, which is a correct statement about what is known.
 */

/** The three the ladder assumes. A fourth is the drawer's business. */
const RUNGS = ['Bull', 'Base', 'Bear'] as const
type Rung = typeof RUNGS[number]

/**
 * What the drawer opens with when the reader has not said otherwise.
 *
 * Every row in production is a preset string like "12 months", and twelve is
 * the one the desk uses. Shown on the row rather than assumed silently: the
 * horizon is half of what makes a target checkable later, and a card that hides
 * it is offering to record a number with no expiry.
 */
export const DEFAULT_LADDER_HORIZON = '12 months'

interface CaseLadderBuilderProps {
  /** Last close, or the book mark. The base case is suggested from it. */
  currentPrice: number | null
  /** The last year's trading range, where there is history for it. */
  range52w?: { low: number; high: number } | null
  /**
   * Open the full editor for a rung, prefilled.
   *
   * The only way anything is written. A case carries a probability and a reason
   * as well as a price and a horizon, and a 172px pane cannot collect four
   * fields without becoming the form this card stopped being.
   */
  onOpenDetails: (name: string, price: number | null, horizon: string) => void
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)
/** "12 months" reads as "12M" on a row that also carries a price and a change. */
const shortHorizon = (h: string) => h.replace(/\s*months?/, 'M').replace(/\s*years?/, 'Y')

/**
 * Suggested prices, or nothing.
 *
 * Base takes the last close rather than the midpoint of the range: the midpoint
 * is a computed opinion, and "it is worth roughly what it trades at" is the
 * honest null hypothesis somebody is about to argue with.
 */
export function seedLadder(
  currentPrice: number | null,
  range52w: { low: number; high: number } | null | undefined,
): Record<Rung, number | null> {
  const base = currentPrice != null && currentPrice > 0 ? currentPrice : null
  if (!range52w || !Number.isFinite(range52w.low) || !Number.isFinite(range52w.high)) {
    return { Bull: null, Base: base, Bear: null }
  }
  return { Bull: range52w.high, Base: base, Bear: range52w.low }
}

export function CaseLadderBuilder({
  currentPrice, range52w, onOpenDetails,
}: CaseLadderBuilderProps) {
  const prices = seedLadder(currentPrice, range52w)
  const bear = prices.Bear
  const bull = prices.Bull

  /**
   * The same ratio `CaseSpread` shows, computed the same way.
   *
   * So the ladder being SUGGESTED is measured by the yardstick the recorded one
   * will be measured by — which is what turns a list of three prices into
   * something worth agreeing or disagreeing with before opening the drawer.
   */
  const skew = bear != null && bull != null && currentPrice != null && currentPrice > 0
    && bear < currentPrice && bull > currentPrice
    ? (bull - currentPrice) / (currentPrice - bear)
    : null

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="ladder-builder">
      {/* What these numbers are, said before they are read as somebody's view. */}
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <p data-slot="ladder-note" className="truncate text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {range52w ? 'Suggested from the 52-week range' : 'No target on record'}
        </p>
        {range52w && (
          <span data-slot="ladder-52w" className="shrink-0 text-[10px] tabular-nums text-gray-400">
            52w {money(range52w.low)}–{money(range52w.high)}
          </span>
        )}
      </div>

      {/* Three rows, high to low — the order a ladder is read in.
          Whole-row targets. There is one action per row now, so the row IS the
          button: no reaching for a number, a chevron or a link, and nothing
          competing for the same tap. */}
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
                  'justify-self-start text-[15px] font-bold tabular-nums',
                  v != null ? 'text-gray-900 dark:text-white' : 'text-gray-400',
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
                      // Neutral at the price, not green. The suggested base is
                      // the last close, so it renders 0% — and in green that
                      // reads as a gain, from a card whose entire subject is
                      // that nobody has claimed one.
                      Math.abs(chg) < 0.5 ? 'text-gray-400'
                        : chg > 0 ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {Math.abs(chg) < 0.5 ? 'at the price' : `${chg > 0 ? '+' : ''}${chg.toFixed(0)}%`}
                  </span>
                )}
                {/* The horizon, on the row.
                    A price with no expiry cannot go stale, cannot be checked
                    and cannot be wrong — so a card offering to record one owes
                    the reader the date it runs to. It is the drawer's default
                    and the drawer can change it. */}
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

      {/* What a tap does, and what the ladder implies.
          One line where there used to be a horizon selector and a commit
          button. The instruction earns its place because the rows carry no
          other affordance, and the ratio earns its place because it is the
          reason to disagree with the suggestion before recording it. */}
      <div className="mt-1 flex h-5 shrink-0 items-baseline gap-2">
        <span data-slot="ladder-hint" className="truncate text-[11px] text-gray-400">
          Tap a case to record it
        </span>
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
