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
 * Probability mode: the same framework, viewed by weight.
 *
 * Not a second chart below the ladder — there is no vertical room on the card
 * for one, and two charts would carry two x-scales that disagree about where
 * $250 is. The distribution is drawn ON the ladder, at the same positions.
 *
 * `ScenarioDistribution`'s visual language travels — bar length is probability
 * against the largest weight, colour is the side of the tape — while its
 * layout does not.
 */
describe('selecting EV turns the ladder into a distribution', () => {
  const open = (c: HTMLElement) => fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
  const bars = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="ladder-weight-bar"]')]

  it('draws no weight bars until EV is selected', () => {
    expect(bars(dash())).toHaveLength(0)
  })

  it('draws one bar per case, at that case own x', () => {
    const c = dash()
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px)
    open(c)
    const b = bars(c)
    expect(b).toHaveLength(3)
    // THE requirement: one x-scale. Each bar stands over its own dot.
    expect(b.map(px).sort((x, y) => x - y)).toEqual(dots.sort((x, y) => x - y))
  })

  it('encodes probability as height, against the largest weight', () => {
    const c = dash()
    open(c)
    const h = (i: number) => parseFloat((bars(c)[i] as HTMLElement).style.height)
    // 30 / 40 / 30 — Base is the tallest and the two tails match.
    expect(h(1)).toBeGreaterThan(h(0))
    expect(h(0)).toBeCloseTo(h(2), 5)
    // Base carries the max weight, so it reaches the cap.
    expect(h(1)).toBeCloseTo(44, 5)
  })

  it('colours by the side of the tape, as the distribution pane does', () => {
    const c = dash()
    open(c)
    // NOW is $236.74: Bear $180 is below it, Base $250 and Bull $300 above.
    expect(bars(c)[0].className).toContain('rose')
    expect(bars(c)[1].className).toContain('emerald')
    expect(bars(c)[2].className).toContain('emerald')
  })

  it('prints each weight on its bar', () => {
    const c = dash()
    open(c)
    expect([...c.querySelectorAll('[data-testid="ladder-weight-label"]')]
      .map(n => n.textContent)).toEqual(['30%', '40%', '30%'])
  })

  /** The market range yields while the weight is being read. */
  it('fades the 52-week range and its labels', () => {
    const c = dash()
    open(c)
    expect(q(c, '[data-testid="ladder-52w-span"]').className).toContain('opacity-30')
    expect(tick(c, 'low').className).toContain('opacity-30')
    expect(stack(c, 'low')!.className).toContain('opacity-30')
  })

  /** NOW stays, because comparing it to the weight is the point. */
  it('keeps NOW and every mark exactly where it was', () => {
    const c = dash()
    const snap = () => ({
      dots: [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px),
      tape: px(q(c, '[data-testid="ladder-tape"]')),
      ev: px(q(c, '[data-testid="ladder-expected-hit"]')),
      low: px(tick(c, 'low')), high: px(tick(c, 'high')),
      lowLabel: px(stack(c, 'low')!), highLabel: px(stack(c, 'high')!),
    })
    const before = snap()
    open(c)
    expect(snap()).toEqual(before)
    expect(q(c, '[data-testid="ladder-tape"]')).toBeTruthy()
  })

  it('leaves probability mode when a case is tapped', () => {
    const c = dash()
    open(c)
    expect(bars(c)).toHaveLength(3)
    fireEvent.click(c.querySelectorAll('[data-testid="ladder-dot"]')[1])
    expect(bars(c)).toHaveLength(0)
    expect(q(c, '[data-testid="ladder-readout"]').textContent).toContain('Base')
  })

  it('leaves probability mode on a second tap of EV', () => {
    const c = dash()
    open(c); open(c)
    expect(bars(c)).toHaveLength(0)
    expect(screen.getByTestId('ladder-hint')).toBeTruthy()
  })

  /** Six cases is six columns on one axis — no wrapping, no second row. */
  it('scales to more than three cases without new layout', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `C${i}`, price: 100 + i * 40, probability: 10 + i * 5, timeframe: '12 months',
    }))
    const c = render(
      <ScenarioLadder price={150} cases={many} expected={244} range52w={{ low: 90, high: 400 }} />,
    ).container
    open(c)
    expect(bars(c)).toHaveLength(6)
    // Still one line underneath, whatever the case count.
    expect(q(c, '[data-testid="ladder-expected-detail"]').textContent).toBe('Expected value$244')
  })
})
