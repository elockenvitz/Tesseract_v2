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

    // Named at the TOP LEFT of the canvas, over the corner the curve's left
    // tail leaves — not under the ladder, which is the last place read on a
    // card whose point in this mode is the shape above.
    const d = c.querySelector('[data-testid="ladder-ev-header"]')!
    expect(d.textContent).toBe('Expected value$244')
    expect(d.textContent).not.toMatch(/probability-weighted across/i)
    expect(d.textContent).not.toMatch(/is calculated by|multiply/i)
    // And no table, grid or per-case row under the chart.
    // And nothing repeats it under the ladder.
    expect(c.querySelector('[data-testid="ladder-expected-detail"]')).toBeNull()
  })

  /**
   * Pressed is announced, and the ring itself steps out of the way.
   *
   * The ring's job is to OFFER the distribution. Once the distribution is the
   * view, a marker sitting on the transformed line would be a third thing
   * claiming to be the answer beside the curve and the readout.
   */
  it('marks itself pressed and hides the ring inside the mode', () => {
    const c = dash()
    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    expect(q(c, '[data-testid="ladder-expected-hit"]').getAttribute('aria-pressed')).toBe('true')
    const ring = q(c, '[data-testid="ladder-expected"]')
    expect(ring.getAttribute('data-selected')).toBe('true')
    expect(ring.className).toContain('opacity-0')
    // Never filled — it is a derived value, not a case.
    expect(ring.className).toContain('bg-white')
  })

  /** One selection at a time, in both directions. */
  it('hands selection between the expectation and a case', () => {
    const c = dash()
    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    expect(c.querySelector('[data-testid="ladder-ev-header"]')).toBeTruthy()

    fireEvent.click(c.querySelectorAll('[data-testid="ladder-dot"]')[1])
    expect(c.querySelector('[data-testid="ladder-ev-header"]')).toBeNull()
    // Uppercased by CSS, so the assertion reads the text as authored.
    expect(q(c, '[data-testid="ladder-readout"]').textContent).toContain('Base')
    expect(q(c, '[data-testid="ladder-expected-hit"]').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    expect(c.querySelector('[data-testid="ladder-ev-header"]')).toBeTruthy()
  })

  it('clears on a second tap', () => {
    const c = dash()
    const hit = q(c, '[data-testid="ladder-expected-hit"]')
    fireEvent.click(hit)
    fireEvent.click(hit)
    expect(c.querySelector('[data-testid="ladder-ev-header"]')).toBeNull()
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

  /**
   * The curve passes THROUGH each case at that case's own x.
   *
   * Price controls x and probability controls y, strictly — so the highest
   * point is the heaviest case and nothing about a case's price can move it
   * vertically. That is the property that makes the shape a statement about
   * weight rather than a statistic drawn near some dots.
   */
  it('puts a knot on every case, at the case own x', () => {
    const geo = buildProbabilityCurve(
      [{ price: 180, probability: 30 }, { price: 250, probability: 40 }, { price: 300, probability: 30 }],
      { min: 4, max: 96 }, p => p, h => 46 - h * 46,
    )!
    expect(geo.knots.map(k => k.price)).toEqual([180, 250, 300])
    // `toX` here is identity, so the knot x IS the price the ladder passed in.
    expect(geo.knots.map(k => k.x)).toEqual([180, 250, 300])
  })

  it('scales height by probability against the heaviest case', () => {
    const geo = buildProbabilityCurve(
      [{ price: 180, probability: 30 }, { price: 250, probability: 40 }, { price: 300, probability: 30 }],
      { min: 4, max: 96 }, p => p, h => h,
    )!
    const [bear, base, bull] = geo.knots
    expect(base.height01).toBe(1)              // the mode reaches the top
    expect(bear.height01).toBeCloseTo(0.75, 5) // 30/40
    expect(bull.height01).toBeCloseTo(0.75, 5)
    expect(bear.height01).toBe(bull.height01)  // equal weights, equal heights
    expect(geo.peakPrice).toBe(250)
  })

  /** Not accidentally symmetric: shift the weight and the peak follows it. */
  it('peaks over whichever case is heaviest', () => {
    const geo = buildProbabilityCurve(
      [{ price: 180, probability: 20 }, { price: 250, probability: 30 }, { price: 300, probability: 50 }],
      { min: 4, max: 96 }, p => p, h => h,
    )!
    expect(geo.peakPrice).toBe(300)
    expect(geo.knots.map(k => k.height01)).toEqual([0.4, 0.6, 1])
  })

  /** Monotone interpolation: no invented weight between the cases. */
  it('never rises above the knots it runs between', () => {
    const geo = buildProbabilityCurve(
      [{ price: 180, probability: 30 }, { price: 250, probability: 40 }, { price: 300, probability: 30 }],
      { min: 0, max: 100 }, p => p, h => h,
    )!
    const ys = [...geo.line.matchAll(/[ML][\d.-]+,([\d.-]+)/g)].map(m => Number(m[1]))
    // `toY` is identity here, so y IS height and 1 is the ceiling.
    expect(Math.max(...ys)).toBeLessThanOrEqual(1.0001)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.0001)
  })

  /** The tails return to the baseline just outside the outer cases. */
  it('spans the cases and returns to the baseline outside them', () => {
    const geo = buildProbabilityCurve(
      [{ price: 20, probability: 30 }, { price: 50, probability: 40 }, { price: 80, probability: 30 }],
      { min: 0, max: 100 }, p => p, h => h,
    )!
    const xs = [...geo.line.matchAll(/[ML]([\d.-]+),/g)].map(m => Number(m[1]))
    expect(Math.min(...xs)).toBeLessThan(20)   // starts left of Bear
    expect(Math.max(...xs)).toBeGreaterThan(80) // ends right of Bull
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(100)
  })

  it('draws no EV marker inside the distribution', () => {
    const c = dash()
    open(c)
    expect(c.querySelector('[data-testid="ladder-ev-line"]')).toBeNull()
    expect(q(c, '[data-testid="ladder-expected"]').className).toContain('opacity-0')
    // Still tappable, so the mode is reversible where it was entered.
    expect(q(c, '[data-testid="ladder-expected-hit"]').className)
      .not.toContain('pointer-events-none')
  })

  it('shows each weight beside its own case', () => {
    const c = dash()
    open(c)
    expect([...c.querySelectorAll('[data-testid="ladder-dot-weight"]')]
      .map(n => n.textContent)).toEqual(['30%', '40%', '30%'])
  })

  it('removes the ladder context while the distribution is up', () => {
    const c = dash()
    open(c)
    // GONE, not dimmed. Dimming leaves a second quantitative story competing
    // at low contrast on an axis that is now telling a different one.
    expect(q(c, '[data-testid="ladder-52w-span"]').className).toContain('opacity-0')
    expect(tick(c, 'low').className).toContain('opacity-0')
    expect(stack(c, 'low')!.className).toContain('opacity-0')
    // And so is the tape: the subject is the framework, not the price.
    expect(q(c, '[data-testid="ladder-tape"]').className).toContain('opacity-0')
    expect(q(c, '[data-testid="ladder-now-leader"]').className).toContain('opacity-0')
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

  it('names the expectation once, at the top of the canvas', () => {
    const c = dash()
    open(c)
    expect(q(c, '[data-testid="ladder-ev-header"]').textContent).toBe('Expected value$244')
    // The readout below is EMPTY in this mode — the header names it once.
    expect(q(c, '[data-testid="ladder-readout"]').textContent).toBe('')
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

/**
 * The baseline moves; the card does not.
 *
 * One group carries the axis line, the modelled span, the gap, the dots, their
 * labels and the curve, and it translates down in probability mode. Everything
 * rides one transform, so there is no second copy of the geometry to drift out
 * of step — and because the shift is a PERCENTAGE of the axis box, it is
 * proportional at the 140px floor and the 220px ceiling rather than a pixel
 * constant that clips on a short card.
 */
describe('the baseline drops inside a fixed footprint', () => {
  const group = (c: HTMLElement) => q(c, '[data-testid="ladder-baseline-group"]')
  const open = (c: HTMLElement) => fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))

  it('sits at the resting baseline until EV is selected', () => {
    expect(group(dash()).className).not.toContain('translate-y-')
  })

  it('translates down, vertically only, when EV is selected', () => {
    const c = dash()
    open(c)
    expect(group(c).className).toContain('translate-y-[26%]')
    // Y only. Nothing here may touch the horizontal scale.
    expect(group(c).className).not.toMatch(/translate-x-/)
  })

  it('animates, and respects a reader who asked for less motion', () => {
    const c = dash()
    const g = group(c)
    expect(g.className).toContain('transition-transform')
    expect(g.className).toContain('duration-300')
    expect(g.className).toContain('motion-reduce:transition-none')
  })

  /** THE requirement: X is identical in both states. */
  it('leaves every horizontal position untouched across the transition', () => {
    const c = dash()
    const xs = () => ({
      dots: [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px),
      ev: px(q(c, '[data-testid="ladder-expected-hit"]')),
      tape: px(q(c, '[data-testid="ladder-tape"]')),
      low: px(tick(c, 'low')), high: px(tick(c, 'high')),
    })
    const resting = xs()
    open(c)
    expect(xs()).toEqual(resting)
    open(c)
    expect(xs()).toEqual(resting)
  })

  /** The outer footprint never changes — that bug does not come back. */
  it('keeps the axis box and the readout reserve fixed', () => {
    const c = dash()
    const box = () => q(c, '[data-testid="scenario-ladder"]').querySelector('.relative')!.className
    const reserve = () => q(c, '[data-testid="ladder-readout-reserve"]').innerHTML
    const b0 = box(), r0 = reserve()
    open(c)
    expect(box()).toBe(b0)
    expect(reserve()).toBe(r0)
    expect(b0).toContain('min-h-[140px]')
    expect(b0).toContain('max-h-[220px]')
  })

  it('returns to the resting baseline when a case is tapped', () => {
    const c = dash()
    open(c)
    expect(group(c).className).toContain('translate-y-[26%]')
    fireEvent.click(c.querySelectorAll('[data-testid="ladder-dot"]')[1])
    expect(group(c).className).not.toContain('translate-y-[26%]')
    expect(q(c, '[data-testid="ladder-readout"]').textContent).toContain('Base')
    // And the ladder context is back.
    expect(q(c, '[data-testid="ladder-tape"]').className).not.toContain('opacity-0')
  })
})

/**
 * The curve and the dots share ONE coordinate system, in the real DOM.
 *
 * The unit tests above prove the primitive puts a knot at whatever `toX`
 * returns. This proves the LADDER passes it `pos`, by comparing the rendered
 * path against the rendered dots — which is the assertion that would have
 * caught a second scale, a normalised index, or equal category spacing.
 */
describe('DASH: the curve is drawn on the ladder own axis', () => {
  const open = (c: HTMLElement) => fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
  /** Sample the rendered path at a given viewBox x. */
  const heightAtX = (d: string, atX: number) => {
    const pts = [...d.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)]
      .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
    const near = pts.reduce((best, p) =>
      Math.abs(p.x - atX) < Math.abs(best.x - atX) ? p : best, pts[0])
    return 46 - near.y   // viewBox is 46 tall, y counts down from the baseline
  }

  it('places a curve knot at each case marker x', () => {
    const c = dash()
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px).sort((a, b) => a - b)
    open(c)
    const d = q(c, '[data-testid="ladder-curve"]').querySelectorAll('path')[1].getAttribute('d')!
    const xs = [...d.matchAll(/[ML]([\d.-]+),/g)].map(m => Number(m[1]))
    // Every dot x falls inside the curve's own x range, and the curve is
    // sampled finely enough that one of its points sits on each.
    for (const dx of dots) {
      expect(Math.min(...xs), `dot ${dx}`).toBeLessThanOrEqual(dx)
      expect(Math.max(...xs), `dot ${dx}`).toBeGreaterThanOrEqual(dx)
      expect(xs.some(x => Math.abs(x - dx) < 1), `knot near dot ${dx}`).toBe(true)
    }
  })

  /** Base is 40% against two 30% tails, so it is the tallest point. */
  it('is highest over Base and equal over Bear and Bull', () => {
    const c = dash()
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px).sort((a, b) => a - b)
    open(c)
    const d = q(c, '[data-testid="ladder-curve"]').querySelectorAll('path')[1].getAttribute('d')!
    const [hBear, hBase, hBull] = dots.map(x => heightAtX(d, x))
    expect(hBase).toBeGreaterThan(hBear)
    expect(hBase).toBeGreaterThan(hBull)
    // Equal weights give equal heights. Compared as a fraction of the full
    // height rather than absolutely: the path is sampled on a fixed grid, so
    // the nearest sample to a dot can sit a fraction of a step to either side.
    expect(Math.abs(hBear - hBull) / hBase).toBeLessThan(0.05)
    // 30/40 of full height, within a sample's rounding.
    expect(hBear / hBase).toBeGreaterThan(0.7)
    expect(hBear / hBase).toBeLessThan(0.8)
  })

  it('spans from left of Bear to right of Bull', () => {
    const c = dash()
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px).sort((a, b) => a - b)
    open(c)
    const d = q(c, '[data-testid="ladder-curve"]').querySelectorAll('path')[1].getAttribute('d')!
    const xs = [...d.matchAll(/[ML]([\d.-]+),/g)].map(m => Number(m[1]))
    expect(Math.min(...xs)).toBeLessThan(dots[0])
    expect(Math.max(...xs)).toBeGreaterThan(dots[2])
  })

  it('renders 30% / 40% / 30% beneath the right cases', () => {
    const c = dash()
    open(c)
    expect([...c.querySelectorAll('[data-testid="ladder-dot-weight"]')]
      .map(n => n.textContent)).toEqual(['30%', '40%', '30%'])
  })

  it('keeps case x identical before, during and after EV mode', () => {
    const c = dash()
    const xs = () => [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px)
    const resting = xs()
    open(c)
    expect(xs()).toEqual(resting)
    open(c)
    expect(xs()).toEqual(resting)
  })
})
