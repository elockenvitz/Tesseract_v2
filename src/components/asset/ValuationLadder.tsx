/**
 * The scenario ladder, drawn as a valuation.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * One line of text: `bear $205 · bull $450 · skew 2.1:1`. The middle of the
 * distribution was missing, the weights were missing, and a reader could not
 * tell a 50/50 bear/bull from AAPL's actual 12/62 -- which are different
 * investments with the same bear and the same bull.
 *
 * ── Why the expected value is often refused ──────────────────────────────
 *
 * `buildValuation` decides, and `blockerText` says why in the reader's terms.
 * Of the ten assets carrying targets in production, four earn an expected
 * value and six do not: three carry no weights, two have a single rung, and
 * AAPL's weights are a valid distribution over DIFFERENT horizons, which is
 * not one distribution. Printing a number for all ten would look better and
 * be wrong, so the refusal is drawn as plainly as the figure.
 *
 * ── Units ────────────────────────────────────────────────────────────────
 *
 * Prices go through `displayMoney`, never a `$` in a template string: the
 * Overview's existing `money()` helper hardcodes a dollar sign, which on a
 * London name is wrong about the currency and wrong by a hundredfold at the
 * same time. Where the currency is unknown the price renders as a bare
 * number, which is the correct outcome rather than a gap.
 *
 * The implied percentages are safe regardless, because a ratio of two prices
 * in the same unit is unit-invariant -- `valuation.test.ts` asserts exactly
 * that against a pence/pounds pair.
 */
import { clsx } from 'clsx'
import { classifyQuotingCurrency, displayMoney } from '../../lib/market-data/currency'
import { blockerText, type Valuation } from '../../lib/asset-workspace/valuation'

/** A signed percentage, or a quiet dash when there is no spot to compare to. */
function MoveCell({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="text-gray-300 dark:text-gray-600">&nbsp;</span>
  }
  const up = pct >= 0
  return (
    <span
      className={clsx(
        'font-mono text-[12px] tabular-nums',
        up ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
      )}
    >
      {up ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

/**
 * A 2px rule under the row, as wide as the weight.
 *
 * The shape of the distribution is the point of showing weights at all, and
 * four numbers in a column do not have a shape. Scaled to the LARGEST weight
 * rather than to 100 so a flat 25/25/25/25 ladder still reads as flat instead
 * of as four quarter-width stubs.
 */
function WeightRule({ pct, max }: { pct: number | null; max: number }) {
  if (pct == null || max <= 0) return null
  return (
    <div className="mt-1 h-[2px] w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
      <div
        className="h-full rounded-full bg-gray-400 dark:bg-gray-500"
        style={{ width: `${Math.max(2, Math.min(100, (pct / max) * 100))}%` }}
      />
    </div>
  )
}

export interface ValuationLadderProps {
  valuation: Valuation
  /** The asset's quoting currency, or null when it is not known. */
  currency?: string | null
  /** Where a reader goes to set or fix the targets. */
  onOpenResearch?: () => void
}

export function ValuationLadder({ valuation, currency, onOpenResearch }: ValuationLadderProps) {
  const { scenarios, expected, blocker } = valuation
  const unit = classifyQuotingCurrency(currency ?? undefined)
  const price = (n: number) => displayMoney(n, unit).text

  if (scenarios.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {onOpenResearch ? (
          <button
            type="button"
            onClick={onOpenResearch}
            className="underline decoration-dotted underline-offset-2 hover:text-gray-700 dark:hover:text-gray-200"
          >
            No scenario targets set
          </button>
        ) : 'No scenario targets set'}
      </p>
    )
  }

  const maxWeight = Math.max(
    ...scenarios.map(s => s.probability ?? 0),
    0,
  )

  return (
    <div data-testid="valuation-ladder">
      <h5 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Valuation
      </h5>

      <ul className="mt-2 space-y-1.5">
        {scenarios.map(s => (
          <li key={s.id} data-testid="valuation-rung" data-scenario={s.name}>
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700 dark:text-gray-300">
                {s.name}
                {s.timeframe && (
                  <span className="ml-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                    {s.timeframe}
                  </span>
                )}
              </span>
              <span
                className={clsx(
                  'w-10 shrink-0 text-right font-mono text-[12px] tabular-nums',
                  s.probability == null
                    ? 'text-gray-300 dark:text-gray-600'
                    : 'text-gray-600 dark:text-gray-400',
                )}
                data-testid="valuation-weight"
              >
                {s.probability == null ? 'n/a' : `${s.probability}%`}
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {price(s.price)}
              </span>
              <span className="w-16 shrink-0 text-right">
                <MoveCell pct={s.impliedPct} />
              </span>
            </div>
            <WeightRule pct={s.probability} max={maxWeight} />
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-gray-200/70 pt-2 dark:border-white/[0.07]">
        {expected ? (
          <div className="flex items-baseline gap-2" data-testid="valuation-expected">
            <span className="min-w-0 flex-1 text-[13px] font-medium text-gray-700 dark:text-gray-300">
              Expected value
              <span className="ml-1.5 text-[11px] font-normal text-gray-400 dark:text-gray-500">
                {expected.horizon ?? 'horizon not stated'}
              </span>
            </span>
            <span className="w-10 shrink-0" />
            <span className="w-20 shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {price(expected.price)}
            </span>
            <span className="w-16 shrink-0 text-right">
              <MoveCell pct={expected.impliedPct} />
            </span>
          </div>
        ) : (
          <p
            className="text-[12px] text-gray-500 dark:text-gray-400"
            data-testid="valuation-blocker"
            data-blocker={blocker ?? undefined}
          >
            {/* No expected value, and the reason rather than a blank. */}
            <span className="font-medium text-gray-600 dark:text-gray-300">No expected value. </span>
            {blocker ? blockerText(blocker, valuation) : null}
          </p>
        )}
      </div>
    </div>
  )
}
