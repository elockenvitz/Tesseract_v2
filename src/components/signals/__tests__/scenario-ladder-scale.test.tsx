import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { ScenarioLadder } from '../ScenarioLadder'

/**
 * One ruler for the whole axis.
 *
 * ── The claim the old scale was making ────────────────────────────────────
 *
 * The cases owned a FIXED band — 22% to 78% whatever their dollar span — and
 * anything outside was `sqrt`-compressed into the margins. On AMZN the
 * modelled range is $90 wide (Bear $90 to Bull $180) and the 52-week range is
 * about $85 wide ($199-$284): two almost identical widths, drawn as a broad
 * framework beside a sliver. Putting both on one axis is an invitation to
 * compare them by eye, and the axis was answering wrongly.
 *
 * These tests assert the property rather than any particular pixel: for any
 * two values on a ladder, pixels-per-dollar must be the same as for any other
 * two. That is what "one quantitative scale" means, and it is the thing that
 * cannot be true of a piecewise scale.
 */

const px = (el: Element) => parseFloat((el as HTMLElement).style.left)

/**
 * The ratio test, run over every pair.
 *
 * Tolerance is generous on purpose: the assertion is "one linear scale", not
 * "these exact percentages". Anything piecewise fails it by a wide margin —
 * the old band put a $90 case span at 56% of the axis and an $85 market span
 * in a `sqrt` margin, which is a ratio difference of several hundred percent,
 * not several.
 */
function expectOneScale(points: { label: string; price: number; pos: number }[]) {
  const pairs: { a: string; b: string; ratio: number }[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dollars = Math.abs(points[i].price - points[j].price)
      if (dollars < 1) continue
      pairs.push({
        a: points[i].label,
        b: points[j].label,
        ratio: Math.abs(points[i].pos - points[j].pos) / dollars,
      })
    }
  }
  expect(pairs.length).toBeGreaterThan(2)
  const first = pairs[0].ratio
  for (const p of pairs) {
    // Within 2% of each other. A linear scale is exact; the slack absorbs
    // floating point and the rounding in the style string.
    expect(Math.abs(p.ratio - first) / first, `${p.a} vs ${p.b}`).toBeLessThan(0.02)
  }
}

const CASES = (...prices: number[]) =>
  prices.map((price, i) => ({
    name: ['Bear', 'Base', 'Bull', 'Bull 2', 'Bull 3', 'Bull 4'][i] ?? `C${i}`,
    price,
    probability: null,
    timeframe: '12 months',
  }))

describe('every mark on the ladder uses the same pixels per dollar', () => {
  /**
   * FIXTURE 1 — the reported case. A ~$90 case span and a ~$85 market span
   * must look comparable, because they are.
   */
  it('draws a 52-week span and a case span of similar width similarly', () => {
    const { container } = render(
      <ScenarioLadder
        price={232.99}
        cases={CASES(90, 120, 180)}
        expected={null}
        range52w={{ low: 199, high: 284 }}
      />,
    )
    const dots = [...container.querySelectorAll('[data-testid="ladder-dot"]')]
    const lowTick = container.querySelector('[data-testid="ladder-52w"][data-bound="low"]')!
    const highTick = container.querySelector('[data-testid="ladder-52w"][data-bound="high"]')!

    const caseWidth = Math.abs(px(dots[dots.length - 1]) - px(dots[0]))   // $90
    const marketWidth = Math.abs(px(highTick) - px(lowTick))              // $85

    // $90 vs $85 is a 5.9% difference in dollars. The drawn widths must agree.
    const dollarRatio = 85 / 90
    expect(marketWidth / caseWidth).toBeGreaterThan(dollarRatio - 0.03)
    expect(marketWidth / caseWidth).toBeLessThan(dollarRatio + 0.03)
  })

  it('holds one ratio across cases, the tape and both market ends', () => {
    const { container } = render(
      <ScenarioLadder
        price={232.99}
        cases={CASES(90, 120, 180)}
        expected={null}
        range52w={{ low: 199, high: 284 }}
      />,
    )
    const points = [
      { label: '52w low', price: 199, pos: px(container.querySelector('[data-bound="low"][data-testid="ladder-52w"]')!) },
      { label: '52w high', price: 284, pos: px(container.querySelector('[data-bound="high"][data-testid="ladder-52w"]')!) },
      { label: 'tape', price: 232.99, pos: px(container.querySelector('[data-testid="ladder-tape"]')!) },
      ...[...container.querySelectorAll('[data-testid="ladder-dot"]')].map((d, i) => ({
        label: `case ${[90, 120, 180][i]}`, price: [90, 120, 180][i], pos: px(d),
      })),
    ]
    expectOneScale(points)
  })

  /** FIXTURE 2 — the market range much wider than the framework. */
  it('holds the ratio when the 52-week range dwarfs the cases', () => {
    const { container } = render(
      <ScenarioLadder
        price={150}
        cases={CASES(148, 150, 152)}
        expected={null}
        range52w={{ low: 60, high: 400 }}
      />,
    )
    expectOneScale([
      { label: '52w low', price: 60, pos: px(container.querySelector('[data-bound="low"][data-testid="ladder-52w"]')!) },
      { label: '52w high', price: 400, pos: px(container.querySelector('[data-bound="high"][data-testid="ladder-52w"]')!) },
      { label: 'tape', price: 150, pos: px(container.querySelector('[data-testid="ladder-tape"]')!) },
    ])
  })

  /** FIXTURE 3 — the framework much wider than the market range. */
  it('holds the ratio when the cases dwarf the 52-week range', () => {
    const { container } = render(
      <ScenarioLadder
        price={300}
        cases={CASES(100, 300, 900)}
        expected={null}
        range52w={{ low: 290, high: 310 }}
      />,
    )
    const dots = [...container.querySelectorAll('[data-testid="ladder-dot"]')]
    expectOneScale([
      ...dots.map((d, i) => ({ label: `case ${[100, 300, 900][i]}`, price: [100, 300, 900][i], pos: px(d) })),
      { label: '52w low', price: 290, pos: px(container.querySelector('[data-bound="low"][data-testid="ladder-52w"]')!) },
      { label: '52w high', price: 310, pos: px(container.querySelector('[data-bound="high"][data-testid="ladder-52w"]')!) },
    ])
  })

  /** FIXTURE 4 — the price outside both, which is what this card is about. */
  it('keeps the price on the axis, at its true position, when it is outside everything', () => {
    const { container } = render(
      <ScenarioLadder
        price={900}
        cases={CASES(100, 150, 200)}
        expected={null}
        range52w={{ low: 120, high: 260 }}
      />,
    )
    const tape = container.querySelector('[data-testid="ladder-tape"]')!
    // At the top of the domain because it IS the top — short of the 96% frame
    // by the 8% padding, which exists so an endpoint has room for its label.
    expect(px(tape)).toBeGreaterThan(85)
    expect(px(tape)).toBeLessThanOrEqual(96)
    expectOneScale([
      { label: 'tape', price: 900, pos: px(tape) },
      ...[...container.querySelectorAll('[data-testid="ladder-dot"]')]
        .map((d, i) => ({ label: `case`, price: [100, 150, 200][i], pos: px(d) })),
    ])
  })

  /** FIXTURE 5 — dense. Six cases must still share the ruler. */
  it('holds the ratio on a six-case ladder', () => {
    const prices = [205, 230, 255, 285, 345, 500]
    const { container } = render(
      <ScenarioLadder
        price={150}
        cases={CASES(...prices)}
        expected={null}
        range52w={{ low: 142, high: 260 }}
      />,
    )
    expectOneScale(
      [...container.querySelectorAll('[data-testid="ladder-dot"]')]
        .map((d, i) => ({ label: `case ${prices[i]}`, price: prices[i], pos: px(d) })),
    )
  })

  /**
   * The NOW pill may clamp inward to stay on the card; the TICK may not move.
   * Reading the price off the axis has to give the price.
   */
  it('clamps the pill without moving the tick', () => {
    const { container } = render(
      <ScenarioLadder price={284} cases={CASES(90, 120, 180)} expected={null}
        range52w={{ low: 199, high: 284 }} />,
    )
    const tape = px(container.querySelector('[data-testid="ladder-tape"]')!)
    const leader = px(container.querySelector('[data-testid="ladder-now-leader"]')!)
    // The leader is drawn from the true position, never from the clamped label.
    expect(leader).toBeCloseTo(tape, 5)
    // And the tape sits at the top of the domain, where $284 belongs.
    expect(tape).toBeGreaterThan(85)
  })

  it('survives a degenerate ladder without drawing off the card', () => {
    const { container } = render(
      <ScenarioLadder price={100} cases={CASES(100, 100)} expected={null} range52w={null} />,
    )
    container.querySelectorAll('[style*="left"]').forEach(el => {
      const p = px(el)
      if (Number.isFinite(p)) {
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThanOrEqual(100)
      }
    })
  })
})
