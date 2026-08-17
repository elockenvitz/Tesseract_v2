import { clsx } from 'clsx'
import type { ScenarioCase } from '../../lib/signals/builders/scenarioGap'

interface ScenarioDistributionProps {
  cases: ScenarioCase[]
  expected: number | null
  /**
   * Why there is no expectation, when there isn't one — "Probabilities sum to
   * 125%", "Mixed horizons: 6 months, 12 months". Comes from the builder.
   */
  blockedBy?: string | null
  price: number
}

/**
 * How the analyst's conviction is distributed across their own cases.
 *
 * The ladder answers "where is the tape". This answers "where is the weight",
 * which is a different question and often the more revealing one: on AAPL the
 * *base* case carries 19% while a bull case carries 62%, so the name the
 * analyst calls "most likely" is not the outcome they actually believe.
 *
 * ── The blocked state ─────────────────────────────────────────────────────
 *
 * Six of ten symbols in this database cannot produce a distribution — four
 * have no probabilities at all, and AAPL's sum to 125% across two horizons.
 * This pane renders in all of those cases and says which, rather than being
 * dropped from the carousel. A pane that silently disappears is the collapse
 * problem in a new place: the reader cannot tell the difference between "no
 * weight was recorded" and "this card doesn't have that view".
 */
export function ScenarioDistribution({ cases, expected, blockedBy, price }: ScenarioDistributionProps) {
  const sorted = [...cases].sort((a, b) => b.price - a.price)
  const weighted = sorted.filter(c => c.probability != null)
  const sum = weighted.reduce((n, c) => n + (c.probability ?? 0), 0)
  const maxProb = Math.max(...sorted.map(c => c.probability ?? 0), 1)

  // No probabilities anywhere. Not a degraded chart — a different statement.
  if (!weighted.length) {
    return (
      <div className="flex min-h-[92px] flex-1 flex-col justify-center" data-testid="distribution-empty">
        <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-200">
          No conviction recorded
        </p>
        <p className="mt-1 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
          None of the {sorted.length} cases carries a probability, so there is no
          distribution to show and no expected value to compute. The spread is
          still a view; the weighting was never written down.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[92px] flex-1 flex-col overflow-hidden" data-testid="scenario-distribution">
      {/* One bar per case, ordered by price descending so it reads against the
          ladder's left-to-right axis turned on its side. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
        {sorted.slice(0, 5).map((c, i) => {
          const p = c.probability
          const frac = p != null ? p / maxProb : 0
          return (
            <div key={`${c.name}-${c.price}-${i}`} className="flex items-center gap-2">
              <span className="w-[62px] shrink-0 truncate text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {c.name}
              </span>
              <span className="w-[40px] shrink-0 text-right text-[10px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">
                ${c.price.toFixed(0)}
              </span>
              <div className="relative h-[10px] flex-1 min-w-0 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-full',
                    // Above the tape is upside, below it is downside. Colouring
                    // by side rather than by size means the bar answers "how
                    // much weight is on the bad outcome" at a glance.
                    c.price >= price ? 'bg-emerald-500/70' : 'bg-rose-500/70',
                  )}
                  style={{ width: `${Math.max(frac * 100, p ? 4 : 0)}%` }}
                />
              </div>
              <span className="w-[30px] shrink-0 text-right text-[10px] font-bold tabular-nums text-gray-700 dark:text-gray-200">
                {p != null ? `${p.toFixed(0)}%` : '—'}
              </span>
            </div>
          )
        })}

        {/* Always rendered, never clipped. With five bars the summary fell
            below the fixed evidence band, so the one line that explains why
            there is no expected value was the first thing lost. */}
        <div className="mt-1 flex shrink-0 items-center gap-2 text-[10px] font-semibold">
          {blockedBy ? (
            // Stated, not hidden. This is the analyst's own numbers being
            // inconsistent, which is a finding rather than a rendering problem.
            <span className="text-amber-600 dark:text-amber-500" data-testid="distribution-blocked">
              {blockedBy} — no expected value
            </span>
          ) : expected != null ? (
            <span className="text-gray-500 dark:text-gray-400">
              Sums to {sum.toFixed(0)}% · expected ${expected.toFixed(2)}
            </span>
          ) : (
            <span className="text-gray-400">Sums to {sum.toFixed(0)}%</span>
          )}
          {sorted.length > 5 && (
            <span className="ml-auto shrink-0 text-gray-400">+{sorted.length - 5} in detail</span>
          )}
        </div>
      </div>
    </div>
  )
}
