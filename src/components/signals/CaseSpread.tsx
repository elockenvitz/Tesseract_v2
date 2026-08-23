import { useState } from 'react'
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
}

interface CaseSpreadProps {
  cases: SpreadCase[]
  /** Last close. Everything here is relative to it. */
  currentPrice: number | null
  onSave: (caseId: string, price: number) => void
  saving?: boolean
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`

export function CaseSpread({ cases, currentPrice, onSave, saving }: CaseSpreadProps) {
  const [edits, setEdits] = useState<Record<string, number>>({})
  const [typing, setTyping] = useState<string | null>(null)
  const [buffer, setBuffer] = useState('')

  const priced = cases
    .map(c => ({ ...c, price: edits[c.id] ?? c.price }))
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

  /** Where today's price sits between the extremes, 0-100. */
  const span = high.price - low.price || 1
  const at = Math.min(Math.max(((currentPrice - low.price) / span) * 100, 0), 100)

  /**
   * The finding, in a sentence.
   *
   * Named against the reader's own cases rather than as a percentile, because
   * "above your Bull case" is a fact somebody can act on and "the 94th
   * percentile of your distribution" is a statistic about a chart.
   */
  const above = sorted.filter(c => currentPrice >= c.price)
  const below = sorted.filter(c => currentPrice < c.price)
  const finding = currentPrice >= high.price
    ? `Trading above ${high.name} — every case you wrote is behind the price.`
    : currentPrice < low.price
      ? `Trading below ${low.name} — beneath even your worst case.`
      : `Between ${above[above.length - 1].name} and ${below[0].name}.`

  const commit = (id: string) => {
    const n = Number(buffer.replace(/[$,\s]/g, ''))
    if (Number.isFinite(n) && n > 0) {
      setEdits(e => ({ ...e, [id]: n }))
      onSave(id, n)
    }
    setTyping(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col justify-between" data-slot="case-spread">
      {/* The conclusion first. Everything below is why. */}
      <p data-slot="spread-finding" className="shrink-0 text-[14px] font-semibold leading-snug text-gray-900 dark:text-white">
        {finding}
      </p>

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
            {typing === c.id ? (
              <input
                autoFocus
                data-slot="value-input"
                inputMode="decimal"
                value={buffer}
                onChange={e => setBuffer(e.target.value)}
                onBlur={() => commit(c.id)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className="w-16 rounded border border-primary-500 px-1 text-[13px] font-bold tabular-nums"
              />
            ) : (
              <button
                type="button"
                data-slot="case-value"
                data-case-id={c.id}
                disabled={saving}
                onClick={() => { setTyping(c.id); setBuffer(String(Number(c.price.toFixed(2)))) }}
                className="text-[13px] font-bold tabular-nums text-gray-700 underline decoration-dotted underline-offset-2 dark:text-gray-200"
              >
                {money(c.price)}
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
