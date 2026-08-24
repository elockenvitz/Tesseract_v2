import { clsx } from 'clsx'

/**
 * Three ways into the case editor, and the range the market has already paid.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * `TargetExplorer` on the no-target card: a row of case-name chips over a
 * slider. It set ONE number under ONE name, so an analyst who wanted the three
 * cases the chips were offering had to run the whole control three times — and
 * never saw the three together while choosing, which is the only reason to
 * have three.
 *
 * ── Why this card holds no numbers of its own ─────────────────────────────
 *
 * Two attempts put them here and both were wrong in the same direction.
 *
 * The first filled the rungs from the 52-week range on sight, under a caption
 * saying so. A price rendered in the case slot of a ladder IS a target as far
 * as anybody reading the card is concerned, and one line of 10px grey does not
 * undo three numbers set in bold — on a card whose own headline says the name
 * has no target on record.
 *
 * The second made it opt-in: a `Use 52w range` button that filled them on
 * request. Better, and still the wrong shape. It put a second decision on a
 * card that has one thing to offer, and the numbers it produced were not what
 * anybody would have typed — they were a shortcut standing in for the judgement
 * the drawer exists to collect.
 *
 * So the rows carry no prices at all. Each one is a way into the editor for
 * that case, and the editor is where a price gets chosen, with the horizon and
 * the probability and the reason that make it mean something.
 *
 * ── Why the range still shows ─────────────────────────────────────────────
 *
 * `52w $164.08–$260.10` is a fact about the market, labelled as one, in a slot
 * that never holds a case. It is the cheapest reality check available when
 * pricing a name from nothing and it claims nothing about anybody's view.
 */

/** The three the ladder assumes. A fourth is the drawer's business. */
const RUNGS = ['Bull', 'Base', 'Bear'] as const

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
  /** The last year's trading range, where there is history for it. */
  range52w?: { low: number; high: number } | null
  /**
   * Open the full editor for a rung.
   *
   * The only thing this card does. A case is a price, a horizon, a probability
   * and a reason; a 172px pane can collect the first two and would write nulls
   * for the rest, which is how bare numbers nobody can interpret get into the
   * database.
   */
  onOpenDetails: (name: string, horizon: string) => void
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)
/** "12 months" reads as "12M" beside a case name. */
const shortHorizon = (h: string) => h.replace(/\s*months?/, 'M').replace(/\s*years?/, 'Y')

export function CaseLadderBuilder({ range52w, onOpenDetails }: CaseLadderBuilderProps) {
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
          ── Why they sit together at the top ────────────────────────────────
          This block was `flex-1`, so the pane's spare height opened up between
          the last rung and the line under it and the three rows read as
          scattered down the screen rather than as one list. They are a list:
          they keep their own height, stay adjacent, and the slack falls below
          them where it costs nothing.
          Whole-row targets. There is one action per row, so the row IS the
          button and nothing competes for the same tap. */}
      <div className="mt-1.5 shrink-0" data-slot="ladder-rows">
        {RUNGS.map(r => (
          <button
            key={r}
            type="button"
            data-slot="ladder-row"
            data-rung={r}
            onClick={() => onOpenDetails(r, DEFAULT_LADDER_HORIZON)}
            className="grid h-[30px] w-full grid-cols-[2.6rem_1fr_auto] items-center gap-2 text-left"
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

            {/* Not a figure, and deliberately not styled as one. Every price on
                this card would be a price nobody has chosen. */}
            <span
              data-slot="ladder-value"
              data-rung={r}
              className="justify-self-start text-[13px] text-gray-400"
            >
              Set a price
            </span>

            <span className="flex items-center gap-2 justify-self-end">
              <span
                data-slot="ladder-horizon"
                className="shrink-0 text-[11px] font-bold tabular-nums text-gray-400"
              >
                {shortHorizon(DEFAULT_LADDER_HORIZON)}
              </span>
              <span aria-hidden className="w-2 shrink-0 text-[15px] leading-none text-gray-300 dark:text-gray-600">
                ›
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* Directly under the list it describes, not pinned to the pane's floor. */}
      <p data-slot="ladder-hint" className="mt-1.5 shrink-0 truncate text-[11px] text-gray-400">
        Tap a case to record it
      </p>
    </div>
  )
}
