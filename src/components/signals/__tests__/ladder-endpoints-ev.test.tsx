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
    expect(d.textContent).toContain('Expected value')
    expect(d.textContent).toContain('$244')

    /**
     * The caption is GONE. "Probability-weighted across 3 cases" restated the
     * metric band above — `$244` over `PROBABILITY-WEIGHTED, 3 CASES` — and
     * cost a line under a chart that has none to spare.
     */
    expect(d.textContent).not.toMatch(/probability-weighted across/i)
    expect(d.textContent).not.toMatch(/is calculated by|multiply/i)

    // Three columns, not three full-width rows.
    const grid = d.querySelector('.grid.grid-cols-3')!
    expect(grid).toBeTruthy()
    const cols = [...grid.children].filter(n => !n.className.includes('col-span-3'))
    expect(cols).toHaveLength(3)
    expect(cols.map(n => n.textContent)).toEqual([
      'Bear$180 · 30%', 'Base$250 · 40%', 'Bull$300 · 30%',
    ])
    // Fanned outward, so the strip reads as a span with two ends.
    expect(cols[0].className).toContain('text-left')
    expect(cols[1].className).toContain('text-center')
    expect(cols[2].className).toContain('text-right')
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
 * The strip stays a readout, not a table.
 *
 * Three full-width rows plus a caption ran to about 78px under the chart and
 * read as a second section. The same numbers fit two lines in three columns.
 */
describe('the expected-value strip is compact at any case count', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: ['Bear', 'Base', 'Bull', 'Bull 2', 'Bull 3', 'Uber bull', 'Bull 5'][i] ?? `C${i}`,
      price: 100 + i * 40,
      probability: 10 + i,
      timeframe: '12 months',
    }))

  const open = (cases: ReturnType<typeof many>, ev: number) => {
    const c = render(
      <ScenarioLadder price={150} cases={cases} expected={ev} range52w={{ low: 90, high: 400 }} />,
    ).container
    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    return c
  }

  it('keeps six cases to two rows of three', () => {
    const c = open(many(6), 244)
    const grid = q(c, '[data-testid="ladder-expected-detail"]').querySelector('.grid.grid-cols-3')!
    const cols = [...grid.children].filter(n => !n.className.includes('col-span-3'))
    expect(cols).toHaveLength(6)          // 6 / 3 = exactly two rows
    expect(grid.querySelector('.col-span-3')).toBeNull()  // nothing overflowed
  })

  /** Beyond two rows it counts rather than drawing a third. */
  it('counts the remainder instead of growing a third row', () => {
    const c = open(many(7), 244)
    const d = q(c, '[data-testid="ladder-expected-detail"]')
    const cols = [...d.querySelector('.grid.grid-cols-3')!.children]
      .filter(n => !n.className.includes('col-span-3'))
    expect(cols).toHaveLength(6)
    expect(d.textContent).toContain('+1 more in Cases')
  })

  it('preserves ladder order across the strip', () => {
    const c = open(many(6), 244)
    const cols = [...q(c, '[data-testid="ladder-expected-detail"]')
      .querySelector('.grid.grid-cols-3')!.children]
      .filter(n => !n.className.includes('col-span-3'))
    const prices = cols.map(n => Number(n.textContent!.match(/\$(\d+)/)![1]))
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  /** No borders, no chips — it is a readout, not a component. */
  it('draws no card furniture', () => {
    const d = q(open(many(3), 244), '[data-testid="ladder-expected-detail"]')
    expect(d.innerHTML).not.toMatch(/border-(?!current)/)
    expect(d.innerHTML).not.toMatch(/rounded-(lg|xl|2xl)/)
    expect(d.innerHTML).not.toMatch(/shadow/)
  })

  /**
   * And the RESERVE is the same renderer, so a taller case count reserves its
   * own height and the ladder still cannot move.
   */
  it('reserves with the identical component it renders', () => {
    for (const n of [3, 6, 7]) {
      const c = render(
        <ScenarioLadder price={150} cases={many(n)} expected={244} range52w={{ low: 90, high: 400 }} />,
      ).container
      const before = q(c, '[data-testid="ladder-readout-reserve"]').innerHTML
      fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
      const after = q(c, '[data-testid="ladder-readout-reserve"]').innerHTML
      expect(after, `${n} cases`).toBe(before)
      // The reserve carries the same markup as the visible detail, modulo the
      // testid and the aria-hidden that keep it out of the tree.
      const visible = q(c, '[data-testid="ladder-expected-detail"]').innerHTML
      expect(q(c, '[data-testid="ladder-detail-reserve"]').innerHTML, `${n} cases`).toBe(visible)
    }
  })
})
