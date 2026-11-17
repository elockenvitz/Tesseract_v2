/**
 * What the Overview actually draws for a scenario ladder.
 *
 * The arithmetic is covered in `lib/asset-workspace/__tests__/valuation.test.ts`.
 * This file asserts the things only the rendered component can get wrong:
 * that a refusal is SHOWN rather than left blank, that prices carry the right
 * unit, and that an unknown currency produces a bare number instead of a
 * dollar sign.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ValuationLadder } from '../ValuationLadder'
import { buildValuation, type ValuationInput } from '../../../lib/asset-workspace/valuation'

const t = (
  name: string,
  price: number,
  probability: number | null,
  timeframe: string | null,
): ValuationInput => ({ id: `${name}-${price}`, name, price, probability, timeframe })

/** TSLA as it stands in production: weighted, one horizon. */
const TSLA = [
  t('Bull', 400, 75, '6 months'),
  t('Base', 375, 15, '6 months'),
  t('Bear', 325, 10, '6 months'),
]
/** AAPL as it stands in production: weighted, but horizons disagree. */
const AAPL = [
  t('Bull', 450, 62, '12 months'),
  t('Base', 400, 19, '6 months'),
  t('Bear', 205, 12, '6 months'),
  t('Uber Bull', 500, 7, '12 months'),
]

describe('a weighted, single-horizon ladder', () => {
  it('draws every rung, lowest first', () => {
    render(<ValuationLadder valuation={buildValuation(TSLA, 350)} currency="USD" />)
    const rungs = screen.getAllByTestId('valuation-rung')
    expect(rungs.map(r => r.getAttribute('data-scenario'))).toEqual(['Bear', 'Base', 'Bull'])
  })

  it('shows each weight, and the expected value with its horizon', () => {
    render(<ValuationLadder valuation={buildValuation(TSLA, 350)} currency="USD" />)
    expect(screen.getAllByTestId('valuation-weight').map(n => n.textContent))
      .toEqual(['10%', '15%', '75%'])
    const expected = screen.getByTestId('valuation-expected')
    expect(expected.textContent).toContain('$388.75')
    expect(expected.textContent).toContain('6 months')
  })

  it('signs the implied move against spot', () => {
    render(<ValuationLadder valuation={buildValuation(TSLA, 350)} currency="USD" />)
    const bear = screen.getAllByTestId('valuation-rung')[0]
    // 325 against a 350 spot.
    expect(bear.textContent).toContain('-7.1%')
    const expected = screen.getByTestId('valuation-expected')
    expect(expected.textContent).toContain('+11.1%')
  })
})

describe('a refusal is drawn, not hidden', () => {
  it('states that the horizons disagree instead of leaving a blank', () => {
    render(<ValuationLadder valuation={buildValuation(AAPL, 270)} currency="USD" />)
    expect(screen.queryByTestId('valuation-expected')).toBeNull()
    const blocker = screen.getByTestId('valuation-blocker')
    expect(blocker.getAttribute('data-blocker')).toBe('mixed_horizons')
    expect(blocker.textContent).toContain('different horizons')
    /* The rungs are still all there: the refusal is about the average. */
    expect(screen.getAllByTestId('valuation-rung')).toHaveLength(4)
  })

  it('shows n/a for an unweighted rung rather than a zero', () => {
    const v = buildValuation([t('Bull', 180, null, '1y'), t('Bear', 90, null, '1y')], 120)
    render(<ValuationLadder valuation={v} currency="USD" />)
    expect(screen.getAllByTestId('valuation-weight').map(n => n.textContent))
      .toEqual(['n/a', 'n/a'])
    expect(screen.getByTestId('valuation-blocker').textContent)
      .toContain('No scenario carries a probability.')
  })

  it('says so when there are no targets at all', () => {
    render(<ValuationLadder valuation={buildValuation([], 100)} />)
    expect(screen.getByText('No scenario targets set')).toBeTruthy()
    expect(screen.queryByTestId('valuation-rung')).toBeNull()
  })
})

describe('units', () => {
  it('renders a bare number when the currency is unknown', () => {
    /*
     * The defect this guards: the Overview's `money()` helper hardcodes `$`,
     * so a London price read as `$2,847.50` -- wrong about the currency AND
     * wrong by a hundredfold, with nothing on screen to notice. An unknown
     * currency must produce a number a reader can see they do not know the
     * unit of.
     */
    render(<ValuationLadder valuation={buildValuation(TSLA, 350)} currency={null} />)
    const expected = screen.getByTestId('valuation-expected')
    expect(expected.textContent).toContain('388.75')
    expect(expected.textContent).not.toContain('$')
  })

  it('converts a pence quote to pounds rather than labelling pence as GBP', () => {
    /*
     * `GBp` is pence and `GBP` is pounds, and they differ only by case. A
     * ladder quoted in pence must not come out with a pound sign on the pence
     * figure.
     */
    const pence = TSLA.map(s => ({ ...s, price: s.price * 100 }))
    render(<ValuationLadder valuation={buildValuation(pence, 35000)} currency="GBp" />)
    const expected = screen.getByTestId('valuation-expected')
    expect(expected.textContent).toContain('388.75')
    expect(expected.textContent).not.toContain('38,875')
    /* The percentage is unaffected by the unit, and must still be right. */
    expect(expected.textContent).toContain('+11.1%')
  })

  it('does not put a dollar sign on a euro ladder', () => {
    render(<ValuationLadder valuation={buildValuation(TSLA, 350)} currency="EUR" />)
    expect(screen.getByTestId('valuation-expected').textContent).not.toContain('$')
  })
})
