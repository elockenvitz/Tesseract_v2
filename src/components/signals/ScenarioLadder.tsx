import { clsx } from 'clsx'
import type { ScenarioCase } from '../../lib/signals/builders/scenarioGap'

interface ScenarioLadderProps {
  price: number
  cases: ScenarioCase[]
  expected: number | null
}

/**
 * The scenario spread on a price axis, with the live price against it.
 *
 * ── Why there are no labels on the axis ───────────────────────────────────
 *
 * There were, and they could not survive real density. AAPL carries six cases
 * — 205, 230, 255, 285, 345, 500 — two named "Bear" and two named "Bull".
 * Labelling each on a 390px axis produced four defects, read off a screenshot
 * rather than guessed at:
 *
 *   1. The collision packer assigned rows 1,0,2,2,0,0, so BEAR $205 rendered
 *      *below* BASE $230. Vertical position meant nothing but read as though
 *      it did, and the eye could not recover price order.
 *   2. With three rows exhausted the packer clamped, and "BEAR $255 10%" was
 *      struck through by "BULL $285".
 *   3. Duplicate scenario names were indistinguishable without reading prices.
 *   4. Row offsets lifted the markers off the axis, so the band drawn between
 *      lowest and highest case no longer related to the dots.
 *
 * Each earlier fix moved a collision instead of removing it, because the
 * problem was never the packing — it was asking one 390px line to carry six
 * labels.
 *
 * So the axis carries only dots. Their x positions are the claim: a red tick
 * far left with every dot clustered right *is* "the tape is below your worst
 * case", legible without reading a word. Names, prices, probabilities and
 * reasoning live in the detail pane, which has room for them and can
 * disambiguate two cases called "Bear" by showing their prices together.
 *
 * Deliberately not a sparkline of price history. History is what every other
 * tool shows; the analyst's own modelled range is what only this product knows.
 */
export function ScenarioLadder({ price, cases, expected }: ScenarioLadderProps) {
  if (cases.length < 2) return null

  const sorted = [...cases].sort((a, b) => a.price - b.price)
  const lo = sorted[0].price
  const hi = sorted[sorted.length - 1].price

  const values = [...sorted.map(c => c.price), price, ...(expected != null ? [expected] : [])]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  if (span <= 0) return null

  // 8% padding each end so an extreme marker is never flush against the edge.
  const pos = (v: number) => 8 + ((v - min) / span) * 84

  const anyProbability = sorted.some(c => c.probability != null)
  const maxProb = Math.max(...sorted.map(c => c.probability ?? 0), 1)

  const below = price < lo
  const above = price > hi
  const tapeTone = below ? 'bg-rose-500' : above ? 'bg-emerald-500' : 'bg-gray-900 dark:bg-white'
  const pillTone = below
    ? 'bg-rose-500 text-white'
    : above
      ? 'bg-emerald-600 text-white'
      : 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="scenario-ladder">
      <div className="relative min-h-[92px] flex-1 overflow-hidden">
        {/* The tape's own price, in its own band above the axis. Coloured by
            which side of the modelled range it sits on, so the claim is
            legible before any number is read. */}
        <div
          className={clsx(
            'absolute top-0 z-20 rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums whitespace-nowrap',
            pillTone,
          )}
          style={{
            left: `${pos(price)}%`,
            transform: `translateX(${pos(price) > 68 ? '-100%' : pos(price) < 32 ? '0' : '-50%'})`,
          }}
        >
          ${price.toFixed(2)}
        </div>

        {/* Axis. The heavier segment is the range the analyst actually
            modelled; outside it is territory their own work does not describe,
            which is what makes the two outside claims worth a card at all. */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-gray-200 dark:bg-gray-700" />
        <div
          className="absolute top-1/2 -mt-[2px] h-[5px] rounded-full bg-gray-300 dark:bg-gray-600"
          style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }}
        />

        {/* Expected value, when there is one. Hollow, so it reads as derived
            rather than as another case the analyst wrote down. */}
        {expected != null && (
          <div
            className="absolute top-1/2 -mt-[6px] h-[13px] w-[13px] -translate-x-1/2 rounded-full border-2 border-gray-500 bg-white dark:border-gray-300 dark:bg-gray-900"
            style={{ left: `${pos(expected)}%` }}
            data-testid="ladder-expected"
            aria-label={`Expected value $${expected.toFixed(2)}`}
          />
        )}

        {/* One dot per case. Diameter scales with probability where the analyst
            set one; a 7% tail must still be visible, so there is a floor. No
            labels means no collision is possible at any density. */}
        {sorted.map((c, i) => {
          const weight = anyProbability ? (c.probability ?? 0) / maxProb : 0.6
          const d = 6 + weight * 10
          return (
            <div
              key={`${c.name}-${c.price}-${i}`}
              data-testid="ladder-dot"
              title={`${c.name} $${c.price.toFixed(2)}${c.probability != null ? ` · ${c.probability.toFixed(0)}%` : ''}`}
              className="absolute rounded-full bg-gray-500 ring-2 ring-white dark:bg-gray-300 dark:ring-gray-900"
              style={{
                left: `${pos(c.price)}%`,
                top: `calc(50% - ${d / 2}px)`,
                width: `${d}px`,
                height: `${d}px`,
                transform: 'translateX(-50%)',
              }}
            />
          )
        })}

        {/* The tape marker, drawn after the dots so it sits above them. */}
        <div
          className={clsx('absolute top-1/2 -mt-[16px] z-10 h-[33px] w-[3px] -translate-x-1/2 rounded-full', tapeTone)}
          style={{ left: `${pos(price)}%` }}
          data-testid="ladder-tape"
        />

        {/* Scale at the ends only — two labels the axis can always fit, so the
            dots carry a magnitude without competing for space. */}
        <div className="absolute bottom-0 left-0 text-[10px] font-semibold tabular-nums text-gray-400">
          ${min.toFixed(0)}
        </div>
        <div className="absolute bottom-0 right-0 text-[10px] font-semibold tabular-nums text-gray-400">
          ${max.toFixed(0)}
        </div>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {sorted.length} cases
        </div>
      </div>
    </div>
  )
}
