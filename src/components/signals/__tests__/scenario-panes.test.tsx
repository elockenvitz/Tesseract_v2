import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ScenarioCaseDetail } from '../ScenarioCaseDetail'
import { ScenarioLadder } from '../ScenarioLadder'

/**
 * The polish pass, pinned.
 *
 * Each case here is something the rendered card got wrong on a phone while
 * every existing test stayed green: a legend that listed three levels on a
 * two-level ladder, a repair message clipped below the pane edge, and a
 * probability state that told somebody who had entered probabilities to enter
 * some.
 */

const CASES = [
  { name: 'Bear', price: 800, probability: null, timeframe: '6 months' },
  { name: 'Base', price: 800, probability: null, timeframe: '12 months' },
  { name: 'Bull', price: 1605, probability: null, timeframe: '11 months' },
]
const PRICE = 350.75

const slot = (n: string) => document.querySelector(`[data-slot="${n}"]`)

describe('the ladder plots coordinates, and every one names itself', () => {
  const dots = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-dot"]')]
  /**
   * The mark and its label are siblings, not nested.
   *
   * One button wrapping both could not be sized: it has to hold a 71px label
   * while sitting at 100% of the axis, so it either clipped the label or
   * reported a scrollWidth wider than its box — which the card's
   * nothing-scrolls-sideways rule catches. Both carry the same `data-group-key`.
   */
  const labels = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-dot-label"]')]

  it('draws one dot per price, labelled with the cases that share it', () => {
    // Three dots on a two-level ladder, two of them at the same coordinate and
    // neither labelled — the reader had to map a separate chip row back onto
    // unlabelled marks.
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    expect(dots(container)).toHaveLength(2)
    const l = labels(container)
    expect(l).toHaveLength(2)
    expect(l[0].textContent).toContain('Bear / Base')
    expect(l[0].textContent).toContain('800')
    expect(l[1].textContent).toContain('Bull')
  })

  it('names the shared group bear-first, whatever order the rows arrived in', () => {
    const reversed = [CASES[1], CASES[2], CASES[0]]
    const { container } = render(<ScenarioLadder price={PRICE} cases={reversed} expected={null} />)
    expect(labels(container)[0].textContent).toContain('Bear / Base')
  })

  it('carries no second list of the same coordinates', () => {
    // The chip row existed because the dots were unlabelled. Once each names
    // itself, a second list is the mapping problem restated.
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    expect(container.querySelector('[data-testid="ladder-legend-item"]')).toBeNull()
  })

  it('marks the tape, and does not offer it as a scenario', () => {
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    expect(container.querySelector('[data-testid="ladder-tape"]')).toBeTruthy()
    // Two groups, two buttons. The price is not one of them.
    expect(dots(container)).toHaveLength(2)
  })

  it('mutates nothing — the Cases pane still lists both records', () => {
    // Grouping is presentation. Bear and Base differ by horizon, and that is
    // exactly what the case list is for.
    render(<ScenarioCaseDetail price={PRICE} cases={CASES} expected={null} />)
    expect(screen.getByText('Bear')).toBeTruthy()
    expect(screen.getByText('Base')).toBeTruthy()
    expect(screen.getByText(/6 months/)).toBeTruthy()
    expect(screen.getByText(/12 months/)).toBeTruthy()
  })
})

describe('the three probability states are distinct', () => {
  it('asks for probabilities when there are none', () => {
    render(<ScenarioCaseDetail price={PRICE} cases={CASES} expected={null} onAddProbabilities={vi.fn()} />)
    expect(slot('no-probabilities')!.textContent).toContain('No case probabilities recorded')
    expect(slot('add-probabilities')!.textContent).toBe('Add probabilities')
    expect(slot('invalid-probabilities')).toBeNull()
  })

  it('names the total when they were entered and do not add up', () => {
    // Telling somebody who has done the work to "add probabilities" would be
    // telling them to do it again. Different problem, different repair.
    const weighted = CASES.map((c, i) => ({ ...c, probability: [50, 50, 25][i] }))
    render(
      <ScenarioCaseDetail
        price={PRICE} cases={weighted} expected={null}
        blockedBy="Probabilities sum to 125%" onAddProbabilities={vi.fn()}
      />,
    )
    expect(slot('invalid-probabilities')!.textContent).toContain('Probabilities total 125%')
    expect(slot('fix-probabilities')!.textContent).toBe('Fix probabilities')
    expect(slot('no-probabilities')).toBeNull()
  })

  it('falls back to a general repair when the fault is not the total', () => {
    // A ladder running to different horizons cannot be averaged either, and
    // the message must not claim a total is wrong when it is not.
    const weighted = CASES.map((c, i) => ({ ...c, probability: [40, 30, 30][i] }))
    render(
      <ScenarioCaseDetail
        price={PRICE} cases={weighted} expected={null}
        blockedBy="Mixed horizons: 6 months, 12 months" onAddProbabilities={vi.fn()}
      />,
    )
    expect(slot('invalid-probabilities')!.textContent).toContain('Case probabilities need review')
  })

  it('states the expectation, and no repair, when the weights are usable', () => {
    render(<ScenarioCaseDetail price={PRICE} cases={CASES} expected={1000} onAddProbabilities={vi.fn()} />)
    expect(screen.getByText('Expected')).toBeTruthy()
    expect(screen.getByText('probability-weighted')).toBeTruthy()
    expect(slot('no-probabilities')).toBeNull()
    expect(slot('invalid-probabilities')).toBeNull()
  })

  it('offers no repair action when the caller cannot open the editor', () => {
    render(<ScenarioCaseDetail price={PRICE} cases={CASES} expected={null} />)
    expect(slot('no-probabilities')).toBeTruthy()
    expect(slot('add-probabilities')).toBeNull()
  })
})

describe('the case list yields height to the repair line', () => {
  it('still lists all three cases beside it', () => {
    // The alternative fix was dropping a case row, which would have hidden a
    // scenario to show a message about scenarios.
    render(<ScenarioCaseDetail price={PRICE} cases={CASES} expected={null} onAddProbabilities={vi.fn()} />)
    for (const name of ['Bear', 'Base', 'Bull']) expect(screen.getByText(name)).toBeTruthy()
    expect(document.querySelector('[data-testid="cases-truncated"]')).toBeNull()
  })

  it('introduces no scroller inside the pane', () => {
    // The tile is one snap point; a vertical scroller in it competes with the
    // feed, and a horizontal one competes with the carousel.
    const { container } = render(
      <ScenarioCaseDetail price={PRICE} cases={CASES} expected={null} onAddProbabilities={vi.fn()} />,
    )
    const scrollers = [...container.querySelectorAll('*')].filter(n =>
      /auto|scroll/.test((n as HTMLElement).className))
    expect(scrollers).toHaveLength(0)
  })
})

describe('selection follows the coordinate, not an array position', () => {
  const dots = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-dot"]')]
  const readout = (c: HTMLElement) => c.querySelector('[data-testid="ladder-readout"]')!.textContent ?? ''
  const on = (d: Element[]) => d.filter(x => x.getAttribute('aria-pressed') === 'true')

  it('highlights $1605 when Bull is selected — never the $800 group', () => {
    /**
     * The bug this pass fixes.
     *
     * Selection was an index, and two lists were indexed by it: the dots
     * mapped over CASES and the legend over GROUPS. Selecting Bull — group 1 —
     * highlighted case 1, which is Base at $800. The wrong dot, on the ladder
     * the grouping exists to disambiguate.
     */
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    const d = dots(container)
    fireEvent.click(d[1])

    const lit = on(dots(container))
    expect(lit).toHaveLength(1)
    expect(lit[0].getAttribute('data-group-price')).toBe('1605')
    expect(lit[0].getAttribute('data-group-price')).not.toBe('800')
  })

  it('highlights $800 when the shared group is selected', () => {
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    fireEvent.click(dots(container)[0])
    const lit = on(dots(container))
    expect(lit).toHaveLength(1)
    expect(lit[0].getAttribute('data-group-price')).toBe('800')
  })

  it('selects the same coordinate however the raw cases are ordered', () => {
    // An index would follow the array; a key follows the case.
    const reordered = [CASES[2], CASES[0], CASES[1]]
    const { container } = render(<ScenarioLadder price={PRICE} cases={reordered} expected={null} />)
    fireEvent.click(dots(container)[1])
    expect(on(dots(container))[0].getAttribute('data-group-price')).toBe('1605')
  })

  it('keys selection on case identity, so it survives a reprice elsewhere', () => {
    const withIds = CASES.map((c, i) => ({ ...c, id: `case-${i}` }))
    const { container, rerender } = render(
      <ScenarioLadder price={PRICE} cases={withIds} expected={null} />,
    )
    fireEvent.click(dots(container)[1])
    expect(on(dots(container))[0].getAttribute('data-group-price')).toBe('1605')

    // Bear moves to $500, which splits the shared group. Bull is untouched and
    // must still be the selected coordinate.
    const edited = withIds.map(c => (c.id === 'case-0' ? { ...c, price: 500 } : c))
    rerender(<ScenarioLadder price={PRICE} cases={edited} expected={null} />)
    expect(dots(container)).toHaveLength(3)
    expect(on(dots(container))[0].getAttribute('data-group-price')).toBe('1605')
  })

  it('drops a selection whose coordinate no longer exists', () => {
    // Editing the selected group apart leaves its key matching nothing. The
    // resting state is correct; highlighting an arbitrary survivor is not.
    const withIds = CASES.map((c, i) => ({ ...c, id: `case-${i}` }))
    const { container, rerender } = render(
      <ScenarioLadder price={PRICE} cases={withIds} expected={null} />,
    )
    fireEvent.click(dots(container)[0])
    expect(on(dots(container))).toHaveLength(1)

    const edited = withIds.map(c => (c.id === 'case-0' ? { ...c, price: 500 } : c))
    rerender(<ScenarioLadder price={PRICE} cases={edited} expected={null} />)
    expect(on(dots(container))).toHaveLength(0)
    expect(readout(container)).toContain('Tap a case')
  })

  it('states the move and the horizons a shared target hides', () => {
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    fireEvent.click(dots(container)[0])
    const t = readout(container)
    expect(t).toContain('Bear / Base')
    expect(t).toContain('$800.00')
    expect(t).toMatch(/\+128%|\+129%/)
    // "2 cases at this price" said there was a distinction, not what it was.
    expect(t).toContain('Bear 6m')
    expect(t).toContain('Base 12m')
  })

  it('states a single case with natural grammar', () => {
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    fireEvent.click(dots(container)[1])
    const t = readout(container)
    expect(t).toContain('11-month view')
    expect(t).not.toContain('on a 11 months')
  })

  it('places coordinates by real numeric distance', () => {
    // $800 sits between $350 and $1605 by arithmetic, not by being the middle
    // of three semantic states.
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    const left = (el: Element) => parseFloat((el as HTMLElement).style.left)
    const d = dots(container)
    expect(left(d[0])).toBeLessThan(left(d[1]))
    // Nearer the low end than the high one, because 800 is.
    expect(left(d[0])).toBeLessThan(50)
  })
})

describe('the mark and its label select the same coordinate', () => {
  const at = (c: HTMLElement, sel: string) => [...c.querySelectorAll(sel)]

  it('tapping the label selects what tapping the dot selects', () => {
    // Two elements, one selection. They are siblings rather than nested because
    // a single button cannot both hold the label and sit at the axis extremes
    // without overflowing — but a second element must not become a second
    // mapping, so both carry the same key.
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    const dotKey = at(container, '[data-testid="ladder-dot"]')[1].getAttribute('data-group-key')
    const labelKey = at(container, '[data-testid="ladder-dot-label"]')[1].getAttribute('data-group-key')
    expect(dotKey).toBe(labelKey)

    fireEvent.click(at(container, '[data-testid="ladder-dot-label"]')[1])
    const lit = at(container, '[data-testid="ladder-dot"]').filter(d => d.getAttribute('aria-pressed') === 'true')
    expect(lit).toHaveLength(1)
    expect(lit[0].getAttribute('data-group-price')).toBe('1605')
  })
})

describe('a dense ladder shows marks, and names what you select', () => {
  const SIX = [
    { name: 'Bear', price: 205, probability: null, timeframe: '6 months' },
    { name: 'Base', price: 230, probability: null, timeframe: '12 months' },
    { name: 'Bear', price: 255, probability: null, timeframe: '6 months' },
    { name: 'Bull', price: 285, probability: null, timeframe: '12 months' },
    { name: 'Bull', price: 345, probability: null, timeframe: '12 months' },
    { name: 'Uber Bull', price: 500, probability: null, timeframe: '24 months' },
  ]
  const labels = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-dot-label"]')]
  const dots = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-dot"]')]

  it('labels every coordinate while they fit', () => {
    // Labels stagger across two rows, so at three groups the only pair sharing
    // a row is the two ENDS — measured 74px of clearance at the tightest.
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    expect(labels(container)).toHaveLength(2)
  })

  it('drops to marks only when they would crowd', () => {
    // At six coordinates the same-row gap measured 1px: not overlapping by the
    // rectangle test that let it through review, and unreadable. Printing six
    // names on a 358px line names none of them.
    const { container } = render(<ScenarioLadder price={150} cases={SIX} expected={null} />)
    expect(dots(container)).toHaveLength(6)
    expect(labels(container)).toHaveLength(0)
  })

  it('names the one you select, even when crowded', () => {
    const { container } = render(<ScenarioLadder price={150} cases={SIX} expected={null} />)
    fireEvent.click(dots(container)[5])
    const l = labels(container)
    expect(l).toHaveLength(1)
    expect(l[0].textContent).toContain('Uber Bull')
  })

  it('reserves the readout, so selecting moves nothing', () => {
    // The resting state is one line and a selection is two, and the axis above
    // is centred in what is left — so tapping a case moved the line the reader
    // had just aimed at.
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    const readout = container.querySelector('[data-testid="ladder-readout"]') as HTMLElement
    expect(readout.className).toContain('h-[30px]')
  })
})

describe('close targets still read Bear → Base → Bull', () => {
  // The reported ladder: three targets within $65 of each other, all above the
  // price.
  const CLOSE = [
    { id: 'c1', name: 'Bear', price: 355, probability: null, timeframe: '6 months' },
    { id: 'c2', name: 'Base', price: 370, probability: null, timeframe: '3 months' },
    { id: 'c3', name: 'Bull', price: 390, probability: null, timeframe: '12 months' },
  ]
  const NOW = 274.56
  const labels = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-dot-label"]')]
  const dots = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-dot"]')]
  const leftOf = (el: Element) => parseFloat((el as HTMLElement).style.left)

  it('places the markers in price order, left to right', () => {
    const { container } = render(<ScenarioLadder price={NOW} cases={CLOSE} expected={null} />)
    const l = dots(container).map(leftOf)
    expect(l[0]).toBeLessThan(l[1])
    expect(l[1]).toBeLessThan(l[2])
  })

  it('keeps the labels in the same order as the markers', () => {
    // Rows used to alternate by INDEX, so a tight cluster put Bear and Bull on
    // the top row with Base alone underneath — and the eye reads a row before
    // it reads a column, which scans as "Bear, Bull … Base".
    const { container } = render(<ScenarioLadder price={NOW} cases={CLOSE} expected={null} />)
    const names = labels(container).map(l => l.textContent ?? '')
    expect(names[0]).toContain('Bear')
    expect(names[1]).toContain('Base')
    expect(names[2]).toContain('Bull')
    const l = labels(container).map(leftOf)
    expect(l[0]).toBeLessThan(l[1])
    expect(l[1]).toBeLessThan(l[2])
  })

  it('alternates labels above and below the axis instead of stacking them', () => {
    /**
     * Every label used to sit underneath, in rows 0, 1, 2 — so a three-case
     * ladder drew a column under the line, wasting the whole upper half of the
     * chart and stacking three deep where the two sides of the axis would have
     * held them in one band each.
     *
     * Alternating by ladder RANK gives adjacent cases opposite sides, so two
     * labels a few pixels apart in price never touch at all.
     */
    const { container } = render(<ScenarioLadder price={NOW} cases={CLOSE} expected={null} />)
    const offsets = labels(container).map(l => {
      const m = (l as HTMLElement).style.transform.match(/,\s*(-?\d+)px\)/)
      return m ? Number(m[1]) : 0
    })
    // Both sides are in use.
    expect(offsets.some(o => o > 0), 'no label below the axis').toBe(true)
    expect(offsets.some(o => o < 0), 'no label above the axis').toBe(true)
  })

  it('prices the plotted labels compactly', () => {
    // "$355" rather than "$355.00": narrower labels collide less, and the exact
    // figure is in the selected detail and the Cases pane.
    const { container } = render(<ScenarioLadder price={NOW} cases={CLOSE} expected={null} />)
    expect(labels(container)[0].textContent).toContain('$355')
    expect(labels(container)[0].textContent).not.toContain('.00')
  })

  it('still selects by group identity, whatever row a label sits on', () => {
    const { container } = render(<ScenarioLadder price={NOW} cases={CLOSE} expected={null} />)
    fireEvent.click(labels(container)[2])
    const lit = dots(container).filter(d => d.getAttribute('aria-pressed') === 'true')
    expect(lit).toHaveLength(1)
    expect(lit[0].getAttribute('data-group-price')).toBe('390')
  })

  it('is unaffected by the order the raw cases arrive in', () => {
    const shuffled = [CLOSE[2], CLOSE[0], CLOSE[1]]
    const { container } = render(<ScenarioLadder price={NOW} cases={shuffled} expected={null} />)
    expect(labels(container).map(l => l.textContent ?? '')[0]).toContain('Bear')
    expect(dots(container).map(d => d.getAttribute('data-group-price'))).toEqual(['355', '370', '390'])
  })
})

describe('the ladder shows that the price is outside the modelled range', () => {
  const CLOSE = [
    { id: 'c1', name: 'Bear', price: 355, probability: null, timeframe: '6 months' },
    { id: 'c3', name: 'Bull', price: 390, probability: null, timeframe: '12 months' },
  ]

  it('draws the gap from the price to the nearest case, below', () => {
    // One undifferentiated line meant "the market is outside everything I
    // modelled" — the reason this card exists — had to be reconstructed by
    // comparing a tick's position against where the grey thickened.
    const { container } = render(<ScenarioLadder price={274.56} cases={CLOSE} expected={null} />)
    const gap = container.querySelector('[data-testid="ladder-gap"]') as HTMLElement
    const span = container.querySelector('[data-testid="ladder-modelled"]') as HTMLElement
    expect(gap).toBeTruthy()
    expect(span).toBeTruthy()
    // The gap ends where the modelled range begins.
    expect(parseFloat(gap.style.left) + parseFloat(gap.style.width))
      .toBeCloseTo(parseFloat(span.style.left), 1)
  })

  it('inverts above the range', () => {
    const { container } = render(<ScenarioLadder price={500} cases={CLOSE} expected={null} />)
    const gap = container.querySelector('[data-testid="ladder-gap"]') as HTMLElement
    const span = container.querySelector('[data-testid="ladder-modelled"]') as HTMLElement
    // Now the gap starts where the modelled range ends.
    expect(parseFloat(gap.style.left))
      .toBeCloseTo(parseFloat(span.style.left) + parseFloat(span.style.width), 1)
  })

  it('draws no gap when the price is inside the range', () => {
    const { container } = render(<ScenarioLadder price={370} cases={CLOSE} expected={null} />)
    expect(container.querySelector('[data-testid="ladder-gap"]')).toBeNull()
  })

  it('keeps linear price spacing rather than evening the cases out', () => {
    const spread = [
      { id: 'a', name: 'Bear', price: 355, probability: null, timeframe: null },
      { id: 'b', name: 'Base', price: 370, probability: null, timeframe: null },
      { id: 'c', name: 'Bull', price: 900, probability: null, timeframe: null },
    ]
    const { container } = render(<ScenarioLadder price={274.56} cases={spread} expected={null} />)
    const l = [...container.querySelectorAll('[data-testid="ladder-dot"]')]
      .map(d => parseFloat((d as HTMLElement).style.left))
    // 355→370 is 15 of a 545 range; 370→900 is 530. The gaps must reflect that.
    expect(l[1] - l[0]).toBeLessThan((l[2] - l[1]) / 5)
  })
})

/**
 * The ladder's age, under the axis it describes.
 *
 * It used to be the last sentence of the CARD BODY, which `SignalCardView`
 * clamps to two lines and covers with a "more" affordance the moment it
 * overflows. It overflowed on every scenario_gap fixture at 360px and below,
 * and what "more" hid was the year — so the card printed "Ladder last updated
 * 5 Feb" with a bold "more" pasted where "2026." should have been.
 *
 * The readout below the ladder already reserves two lines and uses one at rest,
 * which is where this now goes: no new height anywhere, and nothing to clip it.
 */
describe('the ladder states how old it is', () => {
  const readout = () => screen.getByTestId('ladder-readout')

  it('prints the date on the reserved second line of the readout, at rest', () => {
    render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} statedOn="5 Feb 2026" />)
    /**
     * ONE line, not two. It was "Tap a case to compare it with the price."
     * above "Ladder last updated 5 Feb 2026." — two sentences of housekeeping
     * under a chart. The instruction drops four words the axis already shows
     * and the provenance drops its verb; a middot joins them because they are
     * two labels, not a sentence.
     */
    expect(screen.getByTestId('ladder-hint').textContent)
      .toBe('Tap a case to compare·Updated 5 Feb 2026')
    expect(screen.getByTestId('ladder-stated-on').textContent).toBe('Updated 5 Feb 2026')
  })

  /**
   * Selecting a case takes the line back, and that is correct: the second line
   * belongs to whatever the reader has asked about, and they have asked about
   * a case. The block is a fixed 30px in both states, so nothing moves.
   */
  it('yields the line to the selected case, without changing the height', () => {
    const { container } = render(
      <ScenarioLadder price={PRICE} cases={CASES} expected={null} statedOn="5 Feb 2026" />,
    )
    fireEvent.click(container.querySelectorAll('[data-testid="ladder-dot"]')[0])
    expect(screen.queryByTestId('ladder-stated-on')).toBeNull()
    expect(readout().className).toContain('h-[30px]')
  })

  it('draws nothing when the builder could not date the ladder', () => {
    render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} statedOn={null} />)
    expect(screen.queryByTestId('ladder-stated-on')).toBeNull()
    // The instruction stands alone, with no orphaned separator after it.
    expect(screen.getByTestId('ladder-hint').textContent).toBe('Tap a case to compare')
  })
})
