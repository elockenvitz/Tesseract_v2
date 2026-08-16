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
 * The only chart on this surface that carries an argument rather than
 * decorating one. Every other card's claim survives its chart being removed;
 * this one's does not — "TSLA is below your bear case" is a statement about a
 * position on this axis, and reading it without seeing the ladder means taking
 * the sentence on trust.
 *
 * Deliberately not a sparkline of price history. History is what every other
 * tool shows; the analyst's own modelled range is what only this product
 * knows, and putting the tape next to it is the entire point.
 *
 * Probability drives marker weight where it exists. On TSLA the bull case
 * carries 75% and the bear 10%, so the ladder should not present them as
 * equal claims — and where no probabilities were entered, all markers render
 * the same rather than inventing a weighting.
 */
export function ScenarioLadder({ price, cases, expected }: ScenarioLadderProps) {
  if (cases.length < 2) return null

  const values = [...cases.map(c => c.price), price, ...(expected != null ? [expected] : [])]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  // A flat span would divide by zero; it also cannot happen with two distinct
  // cases, so this is a guard rather than a case to design for.
  if (span <= 0) return null

  // 6% padding each end so an extreme marker is not flush against the edge.
  const pos = (v: number) => 6 + ((v - min) / span) * 88

  const anyProbability = cases.some(c => c.probability != null)
  const maxProb = Math.max(...cases.map(c => c.probability ?? 0), 1)

  /**
   * Stagger labels that would collide.
   *
   * TSLA's base and bull cases are $375 and $400 against a $249-$400 axis —
   * 16% apart, and their labels are wider than that. Rendered flat they
   * overlapped into "$375 15%400 75%", which makes the most precise part of
   * the card unreadable. Anything within 22% of its neighbour drops a row.
   *
   * Not solved by shrinking the text: the probabilities are the reason this
   * ladder beats a single target, and hiding them to fit would trade the
   * card's whole advantage for tidiness.
   */
  /**
   * Pack labels into rows so none can overlap another.
   *
   * The naive version compared each marker only with its immediate neighbour
   * and pushed collisions to "the other row". On AAPL that put Base and Bull
   * on the same second row 18% apart, so they collided with each other — a
   * fix that moved the problem rather than solving it.
   *
   * This assigns each marker to the lowest row whose last occupant is far
   * enough away, treating the price line as an occupant of row 0. It is the
   * standard label-placement greedy pack and it cannot produce an overlap.
   *
   * Labels are not shrunk to fit. The probabilities are why this ladder beats
   * a single price target; trading them for tidiness would give away the
   * card's whole advantage.
   */
  const MIN_GAP_PCT = 24
  const PRICE_GAP_PCT = 17
  const MAX_ROWS = 3

  const at = (v: number) => ((v - min) / span) * 100
  const pricePos = at(price)

  // Row 0 already contains the tape label.
  const lastInRow: number[] = [pricePos - MIN_GAP_PCT + PRICE_GAP_PCT, -Infinity, -Infinity]
  const rowOf = new Map<ScenarioCase, number>()
  let rowsUsed = 1

  for (const c of cases) {
    const p = at(c.price)
    let row = 0
    while (row < MAX_ROWS) {
      const clearOfNeighbour = p - lastInRow[row] >= MIN_GAP_PCT
      const clearOfPrice = row > 0 || Math.abs(p - pricePos) >= PRICE_GAP_PCT
      if (clearOfNeighbour && clearOfPrice) break
      row++
    }
    if (row >= MAX_ROWS) row = MAX_ROWS - 1
    rowOf.set(c, row)
    lastInRow[row] = p
    rowsUsed = Math.max(rowsUsed, row + 1)
  }

  const ROW_HEIGHT = 32
  const height = 32 + rowsUsed * ROW_HEIGHT

  return (
    <div className="pt-1 pb-0.5 overflow-hidden" data-testid="scenario-ladder">
      {/* Axis. The band between the lowest and highest case is the range the
          analyst actually modelled — everything outside it is territory their
          own work does not describe, which is what makes the two outside
          claims worth a card at all. */}
      <div className="relative overflow-hidden" style={{ height }}>
        <div className="absolute left-0 right-0 top-[26px] h-px bg-gray-200 dark:bg-gray-700" />
        <div
          className="absolute top-[26px] h-[3px] -mt-px rounded bg-gray-300 dark:bg-gray-600"
          style={{
            left: `${pos(Math.min(...cases.map(c => c.price)))}%`,
            width: `${pos(Math.max(...cases.map(c => c.price))) - pos(Math.min(...cases.map(c => c.price)))}%`,
          }}
        />

        {cases.map(c => {
          const weight = anyProbability ? (c.probability ?? 0) / maxProb : 0.7
          const row = rowOf.get(c) ?? 0
          return (
            <div
              key={`${c.name}-${c.price}`}
              className="absolute flex flex-col items-center"
              style={{
                left: `${pos(c.price)}%`,
                top: `${30 + row * ROW_HEIGHT}px`,
                // Centred markers push their labels past the container at the
                // extremes — "Uber Bull" at $500 sits at the right edge and a
                // -50% transform put half the word outside. End markers anchor
                // inward instead; measured, not guessed (e2e caught it).
                transform: `translateX(${pos(c.price) > 80 ? '-88%' : pos(c.price) < 20 ? '-12%' : '-50%'})`,
              }}
            >
              <span
                className="rounded-full bg-gray-500 dark:bg-gray-400"
                style={{
                  // 3px floor: a 7% case must still be visible, or the ladder
                  // silently drops the tail the analyst deliberately modelled.
                  width: `${3 + weight * 6}px`,
                  height: `${3 + weight * 6}px`,
                }}
              />
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap leading-none">
                {c.name}
              </span>
              <span className="mt-0.5 text-[10px] font-semibold tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap leading-none">
                ${c.price.toFixed(0)}
                {c.probability != null && (
                  <span className="font-medium text-gray-400"> {c.probability.toFixed(0)}%</span>
                )}
              </span>
            </div>
          )
        })}

        {/* The tape. Full-height and coloured so the eye lands here first —
            the whole card is about where this sits relative to the rest. */}
        <div
          className={clsx(
            // Spans the axis band only. Full height looked decisive and
            // struck through every label sharing its column — row packing
            // cannot help, because the line crosses all rows at once. The
            // markers already sit on this axis, so a tick is enough to place
            // the price among them.
            'absolute top-[18px] h-[22px] w-[2px] z-10 rounded',
            price < Math.min(...cases.map(c => c.price)) ? 'bg-rose-500'
              : price > Math.max(...cases.map(c => c.price)) ? 'bg-emerald-500'
              : 'bg-gray-900 dark:bg-white',
          )}
          style={{ left: `${pos(price)}%`, transform: 'translateX(-50%)' }}
        />
        <div
          className="absolute top-0 z-20 px-1 rounded bg-gray-900 dark:bg-white text-[10px] font-bold tabular-nums whitespace-nowrap text-white dark:text-gray-900"
          style={{
            left: `${pos(price)}%`,
            transform: `translateX(${pos(price) > 70 ? '-100%' : pos(price) < 30 ? '0' : '-50%'})`,
          }}
        >
          ${price.toFixed(2)}
        </div>
      </div>
    </div>
  )
}
