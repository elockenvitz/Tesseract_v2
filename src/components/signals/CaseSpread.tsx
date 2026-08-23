import { clsx } from 'clsx'

/**
 * What the ladder says about today's price, and what that implies.
 *
 * ── Why the previous two attempts did not work ────────────────────────────
 *
 * A slider set a number with nothing to judge it against. Draggable bands on
 * the price chart added context, but the wrong context — the reader already
 * has three panes of price history, so it read as a duplicate. A probability
 * distribution showed the spread honestly and still did not land, because a
 * chart of bars is *data*: it asks the reader to derive the conclusion.
 *
 * All three answered "how do I change a number". None answered the question
 * the card actually raises, which is **should I?**
 *
 * ── What this shows instead ───────────────────────────────────────────────
 *
 * The finding, in words, then the asymmetry that justifies it.
 *
 * A ladder's whole content is a claim about skew: how far the name falls if
 * the analyst is wrong against how far it rises if they are right. That single
 * ratio is what makes somebody act — 1.8x more downside than upside is a trim
 * whatever the narrative says, and nobody reaches it by reading bar heights.
 *
 * So: one sentence naming where the price sits in the reader's own cases, a
 * bar showing that position, and the two numbers either side of it. The
 * conclusion is stated; the evidence supports it rather than the other way
 * round.
 *
 * ── Editing follows assessment ────────────────────────────────────────────
 *
 * The case values are tappable in place, which is what the pills were reaching
 * for. Selecting a case to edit is a mode; tapping the number you disagree
 * with is not, and the reader is already looking at it because it is part of
 * the argument the card just made.
 */

export interface SpreadCase {
  id: string
  name: string
  price: number | null
  /** Percent, 0-100. Null where the analyst has not committed to one. */
  probability?: number | null
}

interface CaseSpreadProps {
  cases: SpreadCase[]
  /** Last close. Everything here is relative to it. */
  currentPrice: number | null
  /**
   * Open the full editor for a case.
   *
   * Tapping a target used to edit the number in place, which handled the one
   * field a card has room for and none of the others. A case is a price AND a
   * horizon, a probability and a reason — and somebody who has just been told
   * their reward:risk is 0.6x is usually changing the argument, not nudging a
   * figure.
   */
  onEditCase: (caseId: string) => void
  /**
   * The last year's trading range, where there is price history for it.
   *
   * The cases say what the analyst thinks can happen. This says what the
   * market has already been willing to pay, which is the cheapest possible
   * reality check on a ladder — a bull case below the 52-week high is a
   * different claim from one well above it.
   */
  range52w?: { low: number; high: number } | null
  saving?: boolean
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`

export function CaseSpread({ cases, currentPrice, onEditCase, range52w, saving }: CaseSpreadProps) {
  const priced = cases
    .filter(c => c.price != null && Number.isFinite(c.price)) as (SpreadCase & { price: number })[]

  if (priced.length < 2 || currentPrice == null || currentPrice <= 0) return null

  const sorted = [...priced].sort((a, b) => a.price - b.price)
  const low = sorted[0]
  const high = sorted[sorted.length - 1]

  /**
   * Downside and upside from TODAY, not from the base case.
   *
   * The reader owns the position at the current price. What matters is the
   * distance from here to each end, which is the loss and the gain they are
   * actually exposed to — measuring from the base case would describe a trade
   * nobody is in.
   */
  const downside = ((low.price - currentPrice) / currentPrice) * 100
  const upside = ((high.price - currentPrice) / currentPrice) * 100

  /**
   * Reward per unit of risk. The number that drives the decision.
   *
   * Null when the price is outside the ladder entirely, because a ratio with a
   * non-negative downside is not a ratio — it is a statement that the analyst's
   * own worst case is already behind the price, which the sentence says in
   * words instead.
   */
  const skew = downside < 0 && upside > 0 ? upside / Math.abs(downside) : null

  /**
   * The expected value, and an honest statement of how it was reached.
   *
   * Where the analyst has committed to probabilities it is their weighted
   * expectation. Where they have not, it is the plain average of the cases —
   * and the label says "unweighted" rather than showing an invented 33% on
   * each, which was the earlier mistake: a fabricated probability is a number
   * somebody will quote later without its caveat, whereas an average is
   * plainly an average.
   *
   * Both are worth showing. An EV below the price is the whole argument for
   * trimming, and refusing to compute one because nobody filled in a
   * probability field would withhold the card's most useful number on the
   * majority of ladders.
   */
  const weighted = sorted.filter(c => c.probability != null && c.probability > 0)
  const usesStated = weighted.length === sorted.length
  const ev = usesStated
    ? sorted.reduce((sum, c) => sum + c.price * (c.probability! / 100), 0)
      / (sorted.reduce((n, c) => n + c.probability!, 0) / 100)
    : sorted.reduce((sum, c) => sum + c.price, 0) / sorted.length
  const evUpside = ((ev - currentPrice) / currentPrice) * 100

  /** Where today's price sits between the extremes, 0-100. */
  const span = high.price - low.price || 1
  const at = Math.min(Math.max(((currentPrice - low.price) / span) * 100, 0), 100)

  /**
   * A sentence ONLY when the price has left the ladder.
   *
   * "Between Base and Bull." said nothing the reader could not already see:
   * the needle sits between two labelled cases, so naming them was a caption
   * on a picture. It occupied the card's most valuable line — the top one —
   * with a restatement, which is worse than occupying it with nothing.
   *
   * The out-of-range cases are different, and they stay. When the price is
   * past either end the needle clamps to the rail, so the bar can no longer
   * distinguish "just reached Bull" from "40% above it" — the only thing that
   * carries that is words. And it is precisely the state worth interrupting
   * somebody about: their own cases have stopped bounding the name.
   */
  const finding = currentPrice >= high.price
    ? `Trading above ${high.name} — every case you wrote is behind the price.`
    : currentPrice < low.price
      ? `Trading below ${low.name} — beneath even your worst case.`
      : null

  return (
    <div className="flex h-full min-h-0 flex-col justify-between" data-slot="case-spread">
      {/* Absent on the common path, so the asymmetry starts at the top. */}
      {finding && (
        <p data-slot="spread-finding" className="shrink-0 text-[14px] font-semibold leading-snug text-gray-900 dark:text-white">
          {finding}
        </p>
      )}

      {/* The asymmetry, which is the argument. */}
      <div className="flex shrink-0 items-end justify-between" data-slot="spread-skew">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Downside</p>
          <p className="text-[19px] font-bold tabular-nums leading-none text-rose-600 dark:text-rose-400">
            {pct(downside)}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">to {low.name}</p>
        </div>

        {skew != null && (
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Reward : risk</p>
            <p className={clsx(
              'text-[22px] font-bold tabular-nums leading-none',
              // Colour carries the verdict, and only here. Below 1 the analyst
              // is risking more than they stand to make on their own numbers,
              // which is the case worth flagging.
              skew >= 1.5 ? 'text-emerald-600 dark:text-emerald-400'
                : skew >= 1 ? 'text-gray-900 dark:text-white'
                : 'text-rose-600 dark:text-rose-400',
            )}>
              {skew.toFixed(1)}×
            </p>
          </div>
        )}

        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Upside</p>
          <p className="text-[19px] font-bold tabular-nums leading-none text-emerald-600 dark:text-emerald-400">
            {pct(upside)}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">to {high.name}</p>
        </div>
      </div>

      {/* The price itself, named.
          It was only a needle on the bar, which showed WHERE it sits and never
          said what it is — so every percentage above was relative to a number
          the reader could not see. The 52-week range sits beside it because it
          is the cheapest reality check on a ladder: a bull case below the
          year's high is a different claim from one well above it. */}
      <div className="flex shrink-0 items-baseline gap-2" data-slot="spread-now">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Now</span>
        <span className="text-[17px] font-bold tabular-nums leading-none text-gray-900 dark:text-white">
          {money(currentPrice)}
        </span>
        {range52w && (
          <span data-slot="spread-52w" className="ml-auto text-[10px] tabular-nums text-gray-400">
            52w {money(range52w.low)}–{money(range52w.high)}
          </span>
        )}
      </div>

      {/* The expected value. An EV below the price is the whole argument for
          trimming, so it sits directly under the price it is compared with. */}
      <div className="flex shrink-0 items-baseline gap-2" data-slot="spread-ev">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">EV</span>
        <span className={clsx(
          'text-[17px] font-bold tabular-nums leading-none',
          evUpside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
        )}>
          {money(ev)}
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-gray-500">{pct(evUpside)}</span>
        {/* Said plainly. A reader must be able to tell an expectation the
            analyst asserted from one this card averaged. */}
        <span className="ml-auto text-[10px] text-gray-400">
          {usesStated ? 'your weights' : 'unweighted'}
        </span>
      </div>

      {/* The bar. One line, showing where the price stands between the two
          ends — the picture behind the numbers above, not a thing to read on
          its own. */}
      <div className="relative mt-1 h-2 shrink-0 rounded-full bg-gradient-to-r from-rose-400 via-gray-200 to-emerald-400 dark:via-gray-700">
        <span
          data-slot="spread-needle"
          className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-900 ring-2 ring-white dark:bg-white dark:ring-gray-900"
          style={{ left: `${at}%` }}
          aria-label={`Current price ${money(currentPrice)}`}
        />
      </div>

      {/* The cases, tappable where they are. No mode, no selection: the number
          you disagree with is the one you press. */}
      <div className="flex shrink-0 items-center justify-between gap-1" data-slot="spread-cases">
        {sorted.map(c => (
          <span key={c.id} className="min-w-0 text-center">
            <span className="block text-[9px] font-bold uppercase tracking-wide text-gray-400">{c.name}</span>
            <button
              type="button"
              data-slot="case-value"
              data-case-id={c.id}
              disabled={saving}
              onClick={() => onEditCase(c.id)}
              className="text-[13px] font-bold tabular-nums text-gray-700 underline decoration-dotted underline-offset-2 dark:text-gray-200"
            >
              {money(c.price)}
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
