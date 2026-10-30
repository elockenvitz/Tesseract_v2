import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TilePriceChart } from '../TilePriceChart'

/**
 * The horizon chips are the chart's control, and sit on the chart's side.
 *
 * ── Why they moved ───────────────────────────────────────────────────────
 *
 * They were flush left. The left edge of a card is where its SUBJECT lives —
 * the ticker, the claim, the state all start there — so a row of chips
 * starting there too read as one more line of what the card says rather than
 * as a knob over the picture beneath it. Right is where the block's other
 * chart furniture already is (the caption and the percentage read
 * bottom-right) and where `PriceContext` has always put its identical row.
 *
 * ── What these cases can see ─────────────────────────────────────────────
 *
 * jsdom computes no layout and compiles no Tailwind, so the pixel alignment
 * is not observable here; a case that claimed to measure it would be
 * decoration. Measured in the running app instead: 16 chip rows across the
 * Decisions, Portfolio and Ideas lenses at 1920, every one with 0px between
 * the last chip and the row's right edge, none wrapping. What IS observable
 * here is the declaration, and that is what silently reverts.
 */

const POINTS = Array.from({ length: 120 }, (_, i) => ({
  date: new Date(Date.now() - (119 - i) * 86_400_000),
  value: 100 + Math.sin(i / 7) * 8,
}))

describe('the horizon chips sit on the right of the card', () => {
  it('pushes the row to the end rather than the start', () => {
    render(<TilePriceChart points={POINTS} height={140} />)
    const row = screen.getByTestId('price-ranges')
    expect(row.className).toContain('justify-end')
    expect(row.className).not.toMatch(/\bjustify-(start|center|between)\b/)
  })

  it('aligns every line the same way when a narrow card wraps them', () => {
    /*
     * `justify-end` rather than `ml-auto` on the last chip, because the row
     * wraps: a margin would right-align only the final line and leave the
     * ones above it hanging off the left.
     */
    render(<TilePriceChart points={POINTS} height={140} />)
    const row = screen.getByTestId('price-ranges')
    expect(row.className).toContain('flex-wrap')
    expect([...row.children].some(c => c.className.includes('ml-auto'))).toBe(false)
  })

  it('is still the row of chips, not an empty aligned box', () => {
    // The alignment must not be bought by dropping the controls.
    render(<TilePriceChart points={POINTS} height={140} />)
    const chips = screen.getByTestId('price-ranges').querySelectorAll('button')
    expect(chips.length).toBeGreaterThan(1)
  })

  it('leaves the chips clickable without opening the record behind them', () => {
    // The tile shell treats an unhandled click as "open this", so a control
    // inside it has to say it is a control. Moving the row must not lose it.
    render(<TilePriceChart points={POINTS} height={140} />)
    expect(screen.getByTestId('price-ranges')).toHaveAttribute('data-no-portal')
  })
})
