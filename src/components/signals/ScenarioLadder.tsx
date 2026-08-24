import { useState } from 'react'
import { clsx } from 'clsx'

import { groupCases } from '../../lib/signals/scenario-state'
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
  /**
   * ONE selection, keyed on the coordinate rather than on a position.
   *
   * It was an index, and two things indexed different lists: the dots mapped
   * over CASES and the legend over GROUPS, both compared against the same
   * number. Selecting Bull — group 1 — highlighted case 1, which is Base at
   * $800. The wrong dot, on the ladder the grouping exists to disambiguate.
   *
   * A key also survives an edit. When a case is repriced the groups rebuild,
   * and an index would silently point at whatever now sits in that slot.
   */
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  if (cases.length < 2) return null

  const sorted = [...cases].sort((a, b) => a.price - b.price)
  /**
   * The legend lists COORDINATES; the Cases pane lists records.
   *
   * Two cases at $800 are one point on this axis and were drawn as two dots
   * with two legend chips — "BASE $800 · BEAR $800 · BULL $1605" — which reads
   * as three levels on a ladder that has two, and gave the reader two
   * indistinguishable tap targets at the same coordinate.
   *
   * Grouping is presentation only. Nothing here mutates a case, and the Cases
   * pane still shows Bear and Base separately with their own horizons, which is
   * where that difference actually matters.
   */
  const groups = groupCases(sorted)
  /**
   * A selection that no longer exists is dropped, not carried.
   *
   * Editing Bear from $800 to $500 splits the `Bear / Base` group, so the key
   * held here matches nothing. Falling back to null shows the resting state
   * rather than highlighting an arbitrary survivor.
   */
  const selected = groups.find(g => g.key === selectedKey) ?? null
  const toggle = (g: { key: string }) =>
    setSelectedKey(selectedKey === g.key ? null : g.key)
  /** "12 months" → "12-month view". "on a 11 months view" was the alternative. */
  const horizonPhrase = (t: string | null | undefined) => {
    if (!t) return null
    const m = t.trim().match(/^(\d+)\s*(month|year|week|day)s?$/i)
    return m ? `${m[1]}-${m[2].toLowerCase()} view` : `${t.trim()} view`
  }
  /** "Bear 6m · Base 12m" — the distinction a shared target hides. */
  const memberSummary = (g: { cases: { name: string; timeframe?: string | null }[] }) =>
    g.cases
      .map(c => {
        const short = c.timeframe?.trim().match(/^(\d+)\s*(month|year|week|day)s?$/i)
        return short ? `${c.name} ${short[1]}${short[2][0].toLowerCase()}` : c.name
      })
      .join(' · ')
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
      {/* 128px, from 96. The labels moved onto the axis and the staggered row
          needs a full label height below the dot; at 96 the lower row was
          clipped by this container's own `overflow-hidden`. */}
      <div className="relative h-[140px] shrink-0 overflow-hidden">
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
          {/* NOW, because the reader should not have to infer which mark is
              the tape. It is context rather than a scenario, so it is a pill
              above the axis and a plain mark on it — never a dot that looks
              like something to select. */}
          <span className="mr-1 text-[9px] font-bold uppercase tracking-wide opacity-80">now</span>
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

        {/* The tape, on the axis. Not a button: the current price is the thing
            the scenarios are measured against, and making it selectable would
            offer a comparison of the price with itself. */}
        <div
          data-testid="ladder-tape"
          aria-hidden
          className={clsx(
            'absolute top-1/2 z-10 h-[16px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full',
            tapeTone,
          )}
          style={{ left: `${pos(price)}%` }}
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
        {/* The hit area is 32px; the dot stays 11px.
            An 11×11 target is roughly a quarter of a fingertip, and these were
            the only way to select a case from the axis. Growing the dot would
            wreck the chart — six of them at 32px on a 390px axis would overlap
            into a smear — so the BUTTON is padded and transparent, and the dot
            is drawn inside it. Same picture, a target three times the size.
            32 rather than 44 because adjacent cases can sit ~40px apart and a
            full-size target would make neighbours ambiguous; the legend below
            carries the same selection at full width for anyone who misses. */}
        {/* Two elements per coordinate: the mark, and its label.
            They were one button wrapping both, and a shrink-to-fit box that
            has to hold a 71px label while sitting at 100% of the axis cannot
            be sized without either clipping the label or reporting a
            scrollWidth wider than its box — which the card's
            nothing-scrolls-sideways rule catches, correctly.
            Split, each sizes itself: the mark is a fixed 32px target on its
            true position, and the label is its own max-content box that slides
            inward at the ends. Both carry the same `g.key`, so there is still
            one selection and no second mapping. */}
        {groups.map((g, i) => {
          const on = selected?.key === g.key
          const shift = pos(g.price) > 82 ? -32 : pos(g.price) < 18 ? 32 : 0
          return (
          <span key={g.key}>
            <button
              type='button'
              data-testid='ladder-dot'
              data-group-key={g.key}
              data-group-price={g.price}
              aria-label={`${g.label} $${g.price.toFixed(2)}`}
              aria-pressed={on}
              onClick={() => toggle(g)}
              className='absolute z-10 flex items-center justify-center'
              style={{ left: `${pos(g.price)}%`, top: '50%', width: '32px', height: '32px', transform: 'translate(-50%, -50%)' }}
            >
              <span
                aria-hidden
                className={clsx('rounded-full transition-colors', on
                  ? 'bg-gray-900 ring-4 ring-gray-900/20 dark:bg-white dark:ring-white/25'
                  : 'bg-gray-500 ring-2 ring-white dark:bg-gray-300 dark:ring-gray-900')}
                style={{ width: `${DOT}px`, height: `${DOT}px` }}
              />
            </button>
            <button
              type='button'
              data-testid='ladder-dot-label'
              data-group-key={g.key}
              tabIndex={-1}
              aria-hidden
              onClick={() => toggle(g)}
              className='absolute z-10 flex flex-col items-center whitespace-nowrap leading-tight no-touch-target'
              style={{ left: `${pos(g.price)}%`, top: '50%', width: 'max-content', transform: `translate(calc(-50% + ${shift}px), ${i % 2 === 1 ? '40px' : '14px'})` }}
            >
              <span className={clsx('text-[9px] font-bold uppercase tracking-wide', on ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400')}>{g.label}</span>
              <span className={clsx('text-[11px] font-bold tabular-nums', on ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300')}>${g.price.toFixed(g.price >= 1000 ? 0 : 2)}</span>
            </button>
          </span>
          )
        })}

        {/* The bare axis ticks are gone.
            They read "$349" at one end and "$1605" at the other — numbers with
            no name attached, which look like axis furniture and were in fact
            the price and the bull case. Every plotted coordinate now carries
            its own name and number, so a tick is either a duplicate of one or
            a number belonging to nothing. */}
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
        {selected ? (
          <span className="text-gray-700 dark:text-gray-200">
            <span className="font-bold uppercase tracking-wide">{selected.label}</span>
            {' '}${selected.price.toFixed(2)} is{' '}
            <span className={clsx(
              'font-bold tabular-nums',
              selected.price >= price
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400',
            )}>
              {selected.price >= price ? '+' : ''}
              {(((selected.price - price) / price) * 100).toFixed(0)}%
            </span>
            {' '}from ${price.toFixed(2)}
            {/* The horizons, which is what a shared target hides.
                "2 cases at this price" said there was a distinction and not
                what it was; "Bear 6m · Base 12m" is the distinction. A single
                case states its horizon in full. */}
            <span className="mt-0.5 block text-[10px] text-gray-500 dark:text-gray-400">
              {selected.cases.length === 1
                ? [horizonPhrase(selected.cases[0].timeframe),
                   typeof selected.cases[0].probability === 'number'
                     ? `weighted ${Math.round(selected.cases[0].probability)}%` : null]
                    .filter(Boolean).join(' · ')
                : memberSummary(selected)}
            </span>
          </span>
        ) : (
          'Tap a case to compare it with the price.'
        )}
      </div>
      {/* The chip row is gone.
          It existed because the dots were unlabelled: it carried the case
          names at full width so the reader could map them back onto the axis.
          Now every coordinate names itself, and a second list of the same two
          entries is the mapping problem restated rather than a second way to
          tap. Its one real advantage — a wide target — moved into the dot,
          whose hit area is 92x28 around an 11px mark. */}
    </div>
  )
}
