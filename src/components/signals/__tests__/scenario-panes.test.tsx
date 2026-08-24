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
