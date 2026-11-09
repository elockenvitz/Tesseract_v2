/**
 * What an instrument is allowed to colour, and what the colour has to mean.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * The Ideas field was reported as bland, and measured it was: all 56 tiles
 * drew `tone="neutral"`, every mark in the range axis, the dumbbell and the
 * weight bar was `bg-gray-900` or `bg-gray-400`, and the only colour anywhere
 * was the headline percentage.
 *
 * Adding colour to fix that is the easy half. The hard half is that
 * `semantic-tone.ts` records this codebase shipping colour-by-severity TWICE
 * and removing it twice -- four stale theses in red on Today, five positions
 * in rose on Portfolio -- because a colour that means "bad" gets attached to
 * everything that is merely unfinished, and then the screen is lying.
 *
 * So the rules below are not about which shade looks better. They are the
 * three ways the new colour could start lying, each pinned so it fails
 * loudly:
 *
 *   1. a case is coloured by its PRICE, not by the word the desk typed
 *   2. a weight is never coloured as a direction
 *   3. the market's own mark is never one of the desk's case colours
 *
 * GEOMETRY is not asserted -- jsdom performs no layout. Colour classes are,
 * because they are exactly what a later edit would change.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ExploreVisualBlock } from '../ExploreVisual'
import type { ExploreVisual } from '../../../lib/mobile/explore-visual'

const fill = (visual: ExploreVisual) => {
  const { container } = render(
    <ExploreVisualBlock visual={visual} density="tile" fill now={Date.UTC(2026, 0, 1)} />,
  )
  const root = container.querySelector('[data-explore-visual]')
  if (!root) throw new Error(`${visual.kind} drew nothing`)
  return root as HTMLElement
}

const cls = (el: Element | null) => el?.className ?? ''
const roleOf = (root: HTMLElement, label: string) =>
  root.querySelector(`[data-scenario-case="${label}"]`)?.getAttribute('data-scenario-role')

describe('a case is coloured by where it sits, not by what it is called', () => {
  /*
   * Desks type these labels by hand -- "Bear", "Downside", "Street low" --
   * so matching the word would colour one desk's ladder and leave the next
   * one's grey. Position in the sorted set is the fact the drawing needs,
   * and it cannot be spelled differently.
   */
  const ladder = (cases: { label: string; price: number }[]): ExploreVisual =>
    ({ kind: 'scenario_range', low: 120, high: 180, current: 150, cases })

  it('reads the ladder from the prices', () => {
    const root = fill(ladder([
      { label: 'Bear', price: 120 },
      { label: 'Base', price: 150 },
      { label: 'Bull', price: 180 },
    ]))
    expect(roleOf(root, 'Bear')).toBe('down')
    expect(roleOf(root, 'Base')).toBe('base')
    expect(roleOf(root, 'Bull')).toBe('up')
  })

  it('ignores the words entirely', () => {
    /* The same three prices under names no keyword list would catch, and
       deliberately in an order that contradicts the labels: whatever the
       cheapest case is called, it is the low end of the ladder. */
    const root = fill(ladder([
      { label: 'Bull', price: 120 },
      { label: 'Street', price: 150 },
      { label: 'Bear', price: 180 },
    ]))
    expect(roleOf(root, 'Bull')).toBe('down')
    expect(roleOf(root, 'Street')).toBe('base')
    expect(roleOf(root, 'Bear')).toBe('up')
  })

  it('gives a lone case no direction', () => {
    /* One number is not a ladder. Colouring it rose or emerald would invent
       a downside or an upside the desk never stated. */
    const root = fill(ladder([{ label: 'Base', price: 150 }]))
    expect(roleOf(root, 'Base')).toBe('base')
  })

  it('has no middle in a two-case ladder', () => {
    const root = fill(ladder([
      { label: 'Low', price: 120 },
      { label: 'High', price: 180 },
    ]))
    expect(roleOf(root, 'Low')).toBe('down')
    expect(roleOf(root, 'High')).toBe('up')
    expect(root.querySelector('[data-scenario-role="base"]')).toBeNull()
  })

  it('labels each mark in its own mark\'s colour', () => {
    const root = fill(ladder([
      { label: 'Bear', price: 120 },
      { label: 'Bull', price: 180 },
    ]))
    expect(cls(root.querySelector('[data-scenario-label="Bear"]'))).toContain('text-rose')
    expect(cls(root.querySelector('[data-scenario-label="Bull"]'))).toContain('text-emerald')
  })
})

describe('the market is not one of the desk\'s cases', () => {
  const at = (current: number): ExploreVisual => ({
    kind: 'scenario_range', low: 120, high: 180, current,
    cases: [{ label: 'Bear', price: 120 }, { label: 'Bull', price: 180 }],
  })

  it('draws the last price in ink while it sits inside the range', () => {
    /*
     * The one mark on the axis the desk did NOT choose. Given a case colour
     * it would read as a fourth case -- the reader would see three coloured
     * ticks and have no way to tell which one is the market.
     */
    const mark = fill(at(150)).querySelector('[data-scenario-current]')
    expect(cls(mark)).toMatch(/bg-gray-900|dark:bg-white/)
    expect(cls(mark)).not.toContain('emerald')
    expect(cls(mark)).not.toContain('rose')
  })

  it('takes the breach colour only once it has actually broken out', () => {
    expect(cls(fill(at(249)).querySelector('[data-scenario-current]'))).toContain('emerald')
    expect(cls(fill(at(90)).querySelector('[data-scenario-current]'))).toContain('rose')
  })
})

describe('a weight is a size, never a verdict', () => {
  /*
   * ── The bug this is here to prevent a third time ────────────────────────
   *
   * `semantic-tone.ts`: "A 28.2% position with no written case is the most
   * IMPORTANT thing on the screen and is still only `review`; it is not
   * broken, it is unfinished."
   *
   * A concentrated position is the obvious thing to "helpfully" turn red,
   * and doing so is exactly the defect that shipped twice. The exposure bar
   * carries `scale` -- the one colour in the vocabulary that makes no claim
   * -- at every weight.
   */
  const weigh = (weightPct: number): ExploreVisual =>
    ({ kind: 'exposure', weightPct, portfolioName: 'Core Equity' })

  it.each([[0.4], [3.4], [12], [28.2], [95]])('draws a %s percent weight in the same neutral scale', pct => {
    const bar = fill(weigh(pct)).querySelector('[data-exposure-fill]')
    expect(cls(bar)).toContain('indigo')
    expect(cls(bar)).not.toContain('rose')
    expect(cls(bar)).not.toContain('emerald')
    expect(cls(bar)).not.toContain('amber')
  })

  it('gives the bar a ruler rather than just a fill', () => {
    /* A lone filled bar says "some" and nothing else. The quarter ticks are
       what make it a measurement a reader can place a number on. */
    const root = fill(weigh(12))
    expect(root.querySelectorAll('[data-exposure-tick]')).toHaveLength(3)
  })
})

describe('an absence reads as work, not as a disabled control', () => {
  it('draws a missing price target in review amber', () => {
    /*
     * Measured on the live field: ALL twelve `target_compare` tiles had no
     * target, so every one drew a dashed grey run to a grey chip -- 21% of
     * the field saying "this part of the card is inactive". A target nobody
     * has set is `review` in the shared vocabulary: unfinished, not broken,
     * and frequently the most useful thing on the card.
     */
    const root = fill({ kind: 'target_compare', current: 210, target: null })
    expect(cls(root.querySelector('[data-target-empty]'))).toContain('amber')
    expect(cls(root.querySelector('[data-target-empty]'))).not.toContain('gray-400')
  })

  it('points the dumbbell the way the claim points, when there is one', () => {
    const up = fill({ kind: 'target_compare', current: 210, target: 260 })
    expect(up.querySelector('[data-target-dot]')?.getAttribute('data-target-dot')).toBe('up')
    const down = fill({ kind: 'target_compare', current: 210, target: 160 })
    expect(down.querySelector('[data-target-dot]')?.getAttribute('data-target-dot')).toBe('down')
  })

  it('gives a target equal to the price no direction at all', () => {
    /* A zero-length claim has no direction, and colouring it either way
       would state one the numbers do not support. */
    const flat = fill({ kind: 'target_compare', current: 210, target: 210 })
    const dot = flat.querySelector('[data-target-dot]')
    expect(dot).toBeTruthy()
    expect(dot?.getAttribute('data-target-dot')).toBe('none')
    expect(cls(dot)).not.toContain('emerald')
    expect(cls(dot)).not.toContain('rose')
  })
})
