import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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

describe('the ladder legend lists coordinates, not records', () => {
  it('shows one entry per price, with the shared cases named together', () => {
    // "BASE $800 · BEAR $800 · BULL $1605" read as three levels on a ladder
    // that has two, and gave two indistinguishable tap targets at one point.
    const { container } = render(<ScenarioLadder price={PRICE} cases={CASES} expected={null} />)
    const items = [...container.querySelectorAll('[data-testid="ladder-legend-item"]')]
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Bear / Base')
    expect(items[0].textContent).toContain('800')
    expect(items[1].textContent).toContain('Bull')
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
