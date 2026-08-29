import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'

import { ScenarioLadder } from '../ScenarioLadder'

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
 * The discrete probability view.
 *
 * ── Why there is no curve ────────────────────────────────────────────────
 *
 * Bear, Base and Bull are three scenarios written down with three
 * probabilities, not samples from a continuous distribution. Every smooth
 * rendering of them drew a height at every price BETWEEN the cases, which is
 * information nobody has — and three attempts produced three different curves
 * from the same three numbers, which is the tell that the shape was carrying
 * meaning the data does not.
 *
 * A stem per case says exactly what is known: this price, this weight, and no
 * claim about the space between.
 */
describe('EV mode is a discrete probability view', () => {
  const open = (c: HTMLElement) => fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
  const stems = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-stem"]')]
  const hOf = (el: Element) => parseFloat((el as HTMLElement).style.height)

  it('renders no curve, area or spline of any kind', () => {
    const c = dash()
    open(c)
    expect(c.querySelector('[data-testid="ladder-curve"]')).toBeNull()
    expect(c.querySelectorAll('svg')).toHaveLength(0)
    expect(c.querySelectorAll('path')).toHaveLength(0)
  })

  it('draws one stem per case, at the case own x', () => {
    const c = dash()
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px).sort((a, b) => a - b)
    open(c)
    const s = stems(c)
    expect(s).toHaveLength(3)
    expect(s.map(px).sort((a, b) => a - b)).toEqual(dots)
  })

  /** Probability controls height, and only height. */
  it('makes Base tallest and the two 30% tails equal', () => {
    const c = dash()
    open(c)
    const [bear, base, bull] = stems(c).sort((a, b) => px(a) - px(b)).map(hOf)
    expect(base).toBeGreaterThan(bear)
    expect(base).toBeGreaterThan(bull)
    expect(bear).toBe(bull)
    // 30/40 of the maximum.
    expect(bear / base).toBeCloseTo(0.75, 5)
  })

  /** Not baked in symmetric: move the weight and the tallest stem follows. */
  it('puts the tallest stem over whichever case is heaviest', () => {
    const c = render(
      <ScenarioLadder
        price={236.74} expected={244} range52w={{ low: 147, high: 282 }}
        cases={[
          { name: 'Bear', price: 180, probability: 20, timeframe: '12 months' },
          { name: 'Base', price: 250, probability: 30, timeframe: '12 months' },
          { name: 'Bull', price: 300, probability: 50, timeframe: '12 months' },
        ]}
      />,
    ).container
    open(c)
    const hs = stems(c).sort((a, b) => px(a) - px(b)).map(hOf)
    expect(hs[2]).toBeGreaterThan(hs[1])
    expect(hs[1]).toBeGreaterThan(hs[0])
    expect(hs[0] / hs[2]).toBeCloseTo(0.4, 5)   // 20/50
  })

  it('shows each probability beneath its own case', () => {
    const c = dash()
    open(c)
    expect([...c.querySelectorAll('[data-testid="ladder-dot-weight"]')]
      .map(n => n.textContent)).toEqual(['30%', '40%', '30%'])
  })

  /**
   * The result, on the same axis and in a different shape. Every round mark
   * here is something the analyst wrote down; the expectation is the one thing
   * that was calculated, and a diamond says so before a label is read.
   */
  it('marks the expected value at its own x, as a diamond', () => {
    const c = dash()
    open(c)
    const ev = q(c, '[data-testid="ladder-ev-result"]')
    expect(px(ev)).toBeCloseTo(px(q(c, '[data-testid="ladder-expected-hit"]')), 5)
    expect(ev.className).toContain('rotate-45')
    // Not a scenario dot: different shape, different size, no 11px circle.
    expect(ev.className).not.toContain('rounded-full')
    expect(q(c, '[data-testid="ladder-ev-guide"]')).toBeTruthy()
  })

  it('hides the market context and the resting EV ring', () => {
    const c = dash()
    open(c)
    for (const t of ['ladder-tape', 'ladder-now-leader', 'ladder-52w-span']) {
      expect(q(c, `[data-testid="${t}"]`).className, t).toContain('opacity-0')
    }
    expect(tick(c, 'low').className).toContain('opacity-0')
    expect(stack(c, 'low')!.className).toContain('opacity-0')
    expect(q(c, '[data-testid="ladder-expected"]').className).toContain('opacity-0')
  })

  it('grows the stems from the baseline rather than fading them in', () => {
    const c = dash()
    open(c)
    for (const st of stems(c)) {
      expect(st.className).toContain('origin-bottom')
      expect(st.className).toContain('transition-transform')
      expect(st.className).toContain('motion-reduce:transition-none')
    }
  })

  it('leaves no stems behind on deselect or on a case tap', () => {
    const c = dash()
    open(c); expect(stems(c)).toHaveLength(3)
    open(c); expect(stems(c)).toHaveLength(0)
    open(c); expect(stems(c)).toHaveLength(3)
    fireEvent.click(c.querySelectorAll('[data-testid="ladder-dot"]')[1])
    expect(stems(c)).toHaveLength(0)
    expect(q(c, '[data-testid="ladder-readout"]').textContent).toContain('Base')
    expect(q(c, '[data-testid="ladder-tape"]').className).not.toContain('opacity-0')
  })
})
