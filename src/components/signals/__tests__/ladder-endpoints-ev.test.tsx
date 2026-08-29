import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'

import { ScenarioLadder } from '../ScenarioLadder'
import { buildProbabilityCurve } from '../../../lib/signals/probability-curve'

/**
 * The two ends stay on their ends, and the expectation can be asked about.
 *
 * Real geometry from two cards on the phone:
 *
 *   AMZN  cases 90 / 120 / 180, 52W 199-284, NOW 266.43, no EV
 *   DASH  cases 180 / 250 / 300, 52W 147-282, NOW 236.74, EV 244 (30/40/30)
 *
 * DASH is the crowded one: NOW, EV, Base, 52W high and Bull all sit in the top
 * half of the axis.
 */

type Case = { name: string; price: number; probability: number | null; timeframe: string }
const AMZN: Case[] = [
  { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
  { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
  { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
]
const DASH: Case[] = [
  { name: 'Bear', price: 180, probability: 30, timeframe: '12 months' },
  { name: 'Base', price: 250, probability: 40, timeframe: '12 months' },
  { name: 'Bull', price: 300, probability: 30, timeframe: '12 months' },
]

const px = (el: Element) => parseFloat((el as HTMLElement).style.left)
const q = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement
const tick = (c: HTMLElement, b: string) => q(c, `[data-testid="ladder-52w"][data-bound="${b}"]`)
const stack = (c: HTMLElement, b: string) =>
  c.querySelector(`[data-testid="ladder-52w-label"][data-bound="${b}"]`) as HTMLElement | null

const amzn = () => render(
  <ScenarioLadder price={266.43} cases={AMZN} expected={null} range52w={{ low: 199, high: 284 }} />,
).container
const dash = () => render(
  <ScenarioLadder price={236.74} cases={DASH} expected={244} range52w={{ low: 147, high: 282 }} />,
).container

describe('the 52-week labels are anchored to their own ends', () => {
  for (const [name, draw] of [['AMZN', amzn], ['DASH', dash]] as const) {
    it(`puts each ${name} label exactly on its tick, with no drift`, () => {
      const c = draw()
      // THE rule: the label's anchor IS the tick's position. Not near it, not
      // nudged inward to make room — the same number.
      expect(px(stack(c, 'low')!), 'low').toBeCloseTo(px(tick(c, 'low')), 5)
      expect(px(stack(c, 'high')!), 'high').toBeCloseTo(px(tick(c, 'high')), 5)
    })

    it(`reads inward from each ${name} end`, () => {
      const c = draw()
      // Left edge on the low tick, so the text runs right.
      expect(stack(c, 'low')!.style.transform).toContain('translate(0')
      expect(stack(c, 'low')!.className).toContain('items-start')
      // Right edge on the high tick, so the text runs left.
      expect(stack(c, 'high')!.style.transform).toContain('translate(-100%')
      expect(stack(c, 'high')!.className).toContain('items-end')
    })
  }

  it('stacks 52W over LOW/HIGH over the price', () => {
    const c = dash()
    const lines = [...stack(c, 'high')!.querySelectorAll('span')].map(n => n.textContent)
    expect(lines).toEqual(['52W', 'High', '$282'])
    expect([...stack(c, 'low')!.querySelectorAll('span')].map(n => n.textContent))
      .toEqual(['52W', 'Low', '$147'])
  })

  /**
   * The ticks are the quantitative claim and label layout may not touch them.
   * Asserted against the shared scale rather than a fixed percentage.
   */
  it('leaves the ticks on the same ruler as everything else', () => {
    const c = dash()
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px)
    const perDollar = (Math.max(...dots) - Math.min(...dots)) / (300 - 180)
    const market = Math.abs(px(tick(c, 'high')) - px(tick(c, 'low'))) / (282 - 147)
    expect(Math.abs(market - perDollar) / perDollar).toBeLessThan(0.02)
  })

  /** Collisions move a label to another LANE, never along the axis. */
  it('resolves a crowded end vertically, not horizontally', () => {
    const c = dash()
    const high = stack(c, 'high')!
    // Whatever lane it landed in, the horizontal anchor is still the tick.
    expect(px(high)).toBeCloseTo(px(tick(c, 'high')), 5)
    expect(high.style.transform).toMatch(/translate\(-100%,\s*-?\d+px\)/)
  })
})

describe('the expected value can be asked about', () => {
  it('is a button with a real target and a described value', () => {
    const c = dash()
    const hit = q(c, '[data-testid="ladder-expected-hit"]')
    expect(hit.tagName).toBe('BUTTON')
    expect(hit.getAttribute('aria-label')).toBe('Expected value $244.00')
    expect(hit.className).toContain('h-[44px]')
    expect(hit.className).toContain('w-[44px]')
  })

  /** The 44px target must not have grown the mark. */
  it('keeps the ring 13px and on its true x', () => {
    const c = dash()
    const ring = q(c, '[data-testid="ladder-expected"]')
    expect(ring.className).toContain('h-[13px]')
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px).sort((a, b) => a - b)
    const ev = px(q(c, '[data-testid="ladder-expected-hit"]'))
    // $244 is between Bear $180 and Base $250, so its mark is too.
    expect(ev).toBeGreaterThan(dots[0])
    expect(ev).toBeLessThan(dots[1])
  })

  it('shows the expected-value detail when tapped', () => {
    const c = dash()
    expect(c.querySelector('[data-testid="ladder-expected-detail"]')).toBeNull()
    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))

    const d = c.querySelector('[data-testid="ladder-expected-detail"]')!
    // ONE line. The weighting is drawn on the ladder, not written underneath.
    expect(d.textContent).toBe('Expected value$244')
    expect(d.textContent).not.toMatch(/probability-weighted across/i)
    expect(d.textContent).not.toMatch(/is calculated by|multiply/i)
    // And no table, grid or per-case row under the chart.
    expect(d.querySelector('.grid')).toBeNull()
    expect(c.querySelectorAll('[data-testid="ladder-readout"] [data-testid="ladder-weight-bar"]'))
      .toHaveLength(0)
  })

  it('marks itself pressed and emphasises the ring without filling it', () => {
    const c = dash()
    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    expect(q(c, '[data-testid="ladder-expected-hit"]').getAttribute('aria-pressed')).toBe('true')
    const ring = q(c, '[data-testid="ladder-expected"]')
    expect(ring.getAttribute('data-selected')).toBe('true')
    expect(ring.className).toContain('ring-4')
    // Still hollow — a filled dot is what a SCENARIO looks like.
    expect(ring.className).toContain('bg-white')
  })

  /** One selection at a time, in both directions. */
  it('hands selection between the expectation and a case', () => {
    const c = dash()
    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    expect(c.querySelector('[data-testid="ladder-expected-detail"]')).toBeTruthy()

    fireEvent.click(c.querySelectorAll('[data-testid="ladder-dot"]')[1])
    expect(c.querySelector('[data-testid="ladder-expected-detail"]')).toBeNull()
    // Uppercased by CSS, so the assertion reads the text as authored.
    expect(q(c, '[data-testid="ladder-readout"]').textContent).toContain('Base')
    expect(q(c, '[data-testid="ladder-expected-hit"]').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    expect(c.querySelector('[data-testid="ladder-expected-detail"]')).toBeTruthy()
  })

  it('clears on a second tap', () => {
    const c = dash()
    const hit = q(c, '[data-testid="ladder-expected-hit"]')
    fireEvent.click(hit)
    fireEvent.click(hit)
    expect(c.querySelector('[data-testid="ladder-expected-detail"]')).toBeNull()
    expect(screen.getByTestId('ladder-hint')).toBeTruthy()
  })

  /** NOW and the 52-week ends are context, not choices. */
  it('offers no target on the tape or the market ends', () => {
    const c = dash()
    expect(q(c, '[data-testid="ladder-tape"]').tagName).not.toBe('BUTTON')
    expect(tick(c, 'low').tagName).not.toBe('BUTTON')
    expect(tick(c, 'high').tagName).not.toBe('BUTTON')
  })

  /** No expectation, no marker and nothing to select. */
  it('draws no expected marker when there is none', () => {
    const c = amzn()
    expect(c.querySelector('[data-testid="ladder-expected-hit"]')).toBeNull()
    expect(c.querySelector('[data-testid="ladder-expected"]')).toBeNull()
  })
})

/**
 * The ladder is pinned. Selection changes words, never geometry.
 *
 * ── The shift this pins ──────────────────────────────────────────────────
 *
 * The readout grew for the expected-value detail and stayed a fixed 30px
 * otherwise. The axis above it is `flex-1` between 140px and 220px, so it gave
 * the height back and the whole ladder rose the moment EV was tapped — the
 * chart moving out from under the tap that selected it.
 *
 * The reserve is now the EV detail rendered invisibly, with the real content
 * laid over it out of flow. jsdom reports no layout, so these assert the
 * STRUCTURE that guarantees it: one reserve whose content never varies with
 * selection, and content that is absolutely positioned and therefore cannot
 * push anything.
 */
describe('selecting anything leaves the ladder where it was', () => {
  const readout = (c: HTMLElement) => q(c, '[data-testid="ladder-readout"]')
  const reserve = (c: HTMLElement) => q(c, '[data-testid="ladder-readout-reserve"]')

  const states = (c: HTMLElement) => [
    { name: 'resting', act: () => {} },
    { name: 'Base selected', act: () => fireEvent.click(c.querySelectorAll('[data-testid="ladder-dot"]')[1]) },
    { name: 'EV selected', act: () => fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]')) },
  ]

  it('reserves the same height in every state', () => {
    const c = dash()
    const first = reserve(c).innerHTML
    for (const s of states(c)) {
      s.act()
      // The reserve is the tallest state, always rendered, never varying.
      expect(reserve(c).innerHTML, s.name).toBe(first)
      expect(reserve(c).className, s.name).toContain('invisible')
    }
  })

  it('keeps the readout container free of any selection-dependent height', () => {
    const c = dash()
    for (const s of states(c)) {
      s.act()
      const cls = readout(c).className
      expect(cls, s.name).not.toMatch(/h-\[\d+px\]/)
      expect(cls, s.name).not.toMatch(/min-h-\[/)
    }
  })

  it('takes the visible content out of flow so it cannot push the axis', () => {
    const c = dash()
    for (const s of states(c)) {
      s.act()
      const overlay = readout(c).querySelector('.absolute.inset-0')
      expect(overlay, s.name).toBeTruthy()
      // Opacity only. Never height, margin, padding or translation.
      expect(overlay!.className, s.name).toContain('transition-opacity')
      expect(overlay!.className, s.name).not.toContain('transition-all')
    }
  })

  /** And every mark is where it was, in all three states. */
  it('moves no mark between resting, a case and the expectation', () => {
    const c = dash()
    const snapshot = () => ({
      dots: [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px),
      ev: px(q(c, '[data-testid="ladder-expected-hit"]')),
      tape: px(q(c, '[data-testid="ladder-tape"]')),
      low: px(tick(c, 'low')),
      high: px(tick(c, 'high')),
      lowLabel: px(stack(c, 'low')!),
      highLabel: px(stack(c, 'high')!),
    })
    const before = snapshot()
    for (const s of states(c)) {
      s.act()
      expect(snapshot(), s.name).toEqual(before)
    }
  })

  /** A ladder with no expectation reserves only the two lines it needs. */
  it('reserves just the case readout when there is no expectation', () => {
    const c = amzn()
    expect(reserve(c).firstElementChild?.className).toContain('h-[30px]')
    expect(c.querySelector('[data-testid="ladder-detail-reserve"]')).toBeNull()
  })
})

/**
 * Probability mode: the same framework, seen as a shape.
 *
 * A silhouette drawn INSIDE the ladder's own axis — not bars, and not a second
 * chart underneath. The bars this replaces answered "how big is each weight"
 * one at a time; the question is the shape of the whole framework and where
 * the market stands against it.
 */
describe('selecting EV draws a distribution on the ladder', () => {
  const open = (c: HTMLElement) => fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
  const curve = (c: HTMLElement) => c.querySelector('[data-testid="ladder-curve"]')

  it('draws nothing until EV is selected', () => {
    expect(curve(dash())).toBeNull()
  })

  it('draws a filled silhouette, and no bars', () => {
    const c = dash()
    open(c)
    const svg = curve(c)!
    expect(svg).toBeTruthy()
    expect(svg.querySelectorAll('path')).toHaveLength(2)   // area + line
    // THE correction: columns are gone.
    expect(c.querySelectorAll('[data-testid="ladder-weight-bar"]')).toHaveLength(0)
    expect(c.querySelectorAll('rect')).toHaveLength(0)
  })

  /**
   * One x-scale. The viewBox is 0..100 and `pos()` returns a percentage, so a
   * point plotted at Bear's price lands on Bear's dot by construction.
   */
  it('plots the curve on the ladder own axis', () => {
    const c = dash()
    open(c)
    const svg = curve(c)!
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 46')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
    // The area spans the axis, not some inner sub-range.
    const d = svg.querySelector('path')!.getAttribute('d')!
    const xs = [...d.matchAll(/[ML](-?[\d.]+),/g)].map(m => Number(m[1]))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(100)
  })

  /** Base carries 40% against two 30% tails, so the peak is over Base. */
  it('peaks at the heaviest case, not at the mean', () => {
    const geo = buildProbabilityCurve(
      [{ price: 180, probability: 30 }, { price: 250, probability: 40 }, { price: 300, probability: 30 }],
      { min: 140, max: 340 }, p => p, h => h,
    )!
    expect(geo.peakPrice).toBeGreaterThan(230)
    expect(geo.peakPrice).toBeLessThan(270)
    // And the EV of that framework is $244 — a different number from the mode.
    expect(geo.peakPrice).not.toBeCloseTo(244, 0)
  })

  it('marks the expectation at its true x, through the area', () => {
    const c = dash()
    open(c)
    const line = q(c, '[data-testid="ladder-ev-line"]')
    // The MEAN, not the drawn peak.
    expect(px(line)).toBeCloseTo(px(q(c, '[data-testid="ladder-expected-hit"]')), 5)
  })

  it('shows each weight beside its own case', () => {
    const c = dash()
    open(c)
    expect([...c.querySelectorAll('[data-testid="ladder-dot-weight"]')]
      .map(n => n.textContent)).toEqual(['30%', '40%', '30%'])
  })

  it('fades the 52-week context while the distribution is up', () => {
    const c = dash()
    open(c)
    expect(q(c, '[data-testid="ladder-52w-span"]').className).toContain('opacity-30')
    expect(tick(c, 'low').className).toContain('opacity-30')
    expect(stack(c, 'low')!.className).toContain('opacity-30')
    // NOW is NOT faded — comparing it to the distribution is the point.
    expect(q(c, '[data-testid="ladder-tape"]').className).not.toContain('opacity-30')
  })

  /** Zero extra height, and nothing repositioned. */
  it('moves no mark and adds no height', () => {
    const c = dash()
    const snap = () => ({
      dots: [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px),
      tape: px(q(c, '[data-testid="ladder-tape"]')),
      ev: px(q(c, '[data-testid="ladder-expected-hit"]')),
      low: px(tick(c, 'low')), high: px(tick(c, 'high')),
      lowLabel: px(stack(c, 'low')!), highLabel: px(stack(c, 'high')!),
      reserve: q(c, '[data-testid="ladder-readout-reserve"]').innerHTML,
    })
    const before = snap()
    open(c)
    expect(snap()).toEqual(before)
    // The curve is an overlay: it cannot receive the taps meant for the dots.
    expect(curve(c)!.getAttribute('class')).toContain('pointer-events-none')
  })

  it('keeps one compact line underneath, and no table', () => {
    const c = dash()
    open(c)
    expect(q(c, '[data-testid="ladder-expected-detail"]').textContent).toBe('Expected value$244')
    expect(c.querySelector('[data-testid="ladder-readout"] .grid')).toBeNull()
  })

  it('leaves the mode when a case is tapped, and on a second EV tap', () => {
    const c = dash()
    open(c)
    fireEvent.click(c.querySelectorAll('[data-testid="ladder-dot"]')[1])
    expect(curve(c)).toBeNull()
    expect(q(c, '[data-testid="ladder-readout"]').textContent).toContain('Base')
    open(c); open(c)
    expect(curve(c)).toBeNull()
  })

  it('is deterministic across renders', () => {
    const d = () => { const c = dash(); open(c); return curve(c)!.querySelector('path')!.getAttribute('d') }
    expect(d()).toBe(d())
  })
})
