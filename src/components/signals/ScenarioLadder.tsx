import { useState } from 'react'
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
  const [picked, setPicked] = useState<number | null>(null)
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

  /**
   * Diameter no longer encodes probability.
   *
   * It did, and on this corpus that was a lie by omission: 11 of 30 target rows
   * have no probability at all, and the sums that do exist are 125 and 25. A
   * dot sized by a missing or inconsistent weight looks exactly like a dot
   * sized by a real one, and the reader has no way to tell which they are
   * looking at. Every dot is the same size until conviction is trustworthy;
   * the conviction pane is where weight is shown, and it says when it cannot.
   */
  const DOT = 11

  const below = price < lo
  const above = price > hi
  const tapeTone = below ? 'bg-rose-500' : above ? 'bg-emerald-500' : 'bg-gray-900 dark:bg-white'
  const pillTone = below
    ? 'bg-rose-500 text-white'
    : above
      ? 'bg-emerald-600 text-white'
      : 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'

  return (
    // The axis is a fixed band, and the block centres inside whatever it is
    // given. It used to be `flex-1`, so on a 236px evidence band the axis
    // absorbed every spare pixel and drew one horizontal line through the
    // middle of ~180px of nothing — the same "the emptiness moved inside the
    // chart" failure the card's own evidence band was rewritten to avoid.
    // 96px is what the markers, the price pill and the end labels actually
    // need; the slack belongs around the block, not inside the axis.
    <div className="flex h-full min-h-0 flex-col justify-center overflow-hidden" data-testid="scenario-ladder">
      <div className="relative h-[96px] shrink-0 overflow-hidden">
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
        {sorted.map((c, i) => (
          <button
            key={`${c.name}-${c.price}-${i}`}
            type="button"
            data-testid="ladder-dot"
            data-case-index={i}
            aria-label={`${c.name} $${c.price.toFixed(2)}`}
            onClick={() => setPicked(picked === i ? null : i)}
            className={clsx(
              'absolute rounded-full ring-2 transition-colors no-touch-target',
              picked === i
                ? 'bg-gray-900 ring-gray-900 dark:bg-white dark:ring-white'
                : 'bg-gray-500 ring-white dark:bg-gray-300 dark:ring-gray-900',
            )}
            style={{
              left: `${pos(c.price)}%`,
              top: `calc(50% - ${DOT / 2}px)`,
              width: `${DOT}px`,
              height: `${DOT}px`,
              transform: 'translateX(-50%)',
            }}
          />
        ))}

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
      </div>

      {/* What the tap actually said.
          The dots and the legend were both tappable and both only changed
          colour, so the control was interactive in the sense that it responded
          and inert in the sense that it told you nothing. The comparison a
          reader wants off this chart is "how far is the tape from THAT case",
          which is arithmetic between two marks the axis draws but never states.
          Selecting a case states it. */}
      <div
        className="mt-1 shrink-0 text-[11px] leading-snug text-gray-500 dark:text-gray-400"
        data-testid="ladder-readout"
      >
        {picked != null && sorted[picked] ? (
          <span className="text-gray-700 dark:text-gray-200">
            <span className="font-bold uppercase tracking-wide">{sorted[picked].name}</span>
            {' '}${sorted[picked].price.toFixed(2)} is{' '}
            <span className={clsx(
              'font-bold tabular-nums',
              sorted[picked].price >= price
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400',
            )}>
              {sorted[picked].price >= price ? '+' : ''}
              {(((sorted[picked].price - price) / price) * 100).toFixed(0)}%
            </span>
            {' '}from ${price.toFixed(2)}
            {sorted[picked].timeframe ? ` on a ${sorted[picked].timeframe} view` : ''}
            {typeof sorted[picked].probability === 'number'
              ? `, weighted ${Math.round(sorted[picked].probability as number)}%`
              : ''}
          </span>
        ) : (
          'Tap a case to compare it with the price.'
        )}
      </div>

      {/* Identity, off the axis. Wraps freely, so density cannot make two
          entries overlap — the failure mode that killed labelled markers. */}
      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 overflow-hidden" data-testid="ladder-legend">
        {sorted.map((c, i) => (
          <button
            key={`legend-${c.name}-${c.price}-${i}`}
            type="button"
            data-testid="ladder-legend-item"
            onClick={() => setPicked(picked === i ? null : i)}
            className={clsx(
              'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition-colors no-touch-target',
              picked === i
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'text-gray-500 dark:text-gray-400',
            )}
          >
            <span className={clsx(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              picked === i ? 'bg-white dark:bg-gray-900' : 'bg-gray-400',
            )} aria-hidden />
            <span className="uppercase tracking-wide">{c.name}</span>
            <span className="tabular-nums">${c.price.toFixed(0)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
