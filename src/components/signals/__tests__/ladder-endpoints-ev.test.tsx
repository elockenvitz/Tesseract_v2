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

  /**
   * "52W" was the first line of BOTH stacks — the same word twice, in the
   * smallest type on the card, to name one band. It is said once now, on the
   * band, and the endpoints carry the bound and the price.
   */
  it('names the bound and the price, and says 52W once on the band', () => {
    const c = dash()
    expect([...stack(c, 'high')!.querySelectorAll('span')].map(n => n.textContent))
      .toEqual(['High', '$282'])
    expect([...stack(c, 'low')!.querySelectorAll('span')].map(n => n.textContent))
      .toEqual(['Low', '$147'])
    expect(c.textContent!.match(/52W/g) ?? []).toHaveLength(1)
    const caption = q(c, '[data-testid="ladder-52w-caption"]')
    expect(caption.textContent).toBe('52W')
    // Over the middle of the band it names, and above the axis line.
    const mid = (px(tick(c, 'low')) + px(tick(c, 'high'))) / 2
    expect(px(caption)).toBeCloseTo(mid, 5)
    expect(caption.style.transform).toContain('-20px')
  })

  /**
   * THE RAILS. A label's vertical position is decided by what it IS.
   *
   * The market ends used to be placed into whatever gap the case labels left,
   * which on DASH put the 52-week high one row under Bull, where it read as
   * Bull's own second line.
   */
  it('gives cases and market ends their own rails, below the axis', () => {
    const c = dash()
    const dyOf = (el: HTMLElement) =>
      parseFloat(/,\s*(-?[\d.]+)px\)/.exec(el.style.transform)![1])
    const caseRail = [...c.querySelectorAll('[data-testid="ladder-dot-label"]')]
      .map(n => dyOf(n as HTMLElement))
    const rangeRail = ['low', 'high'].map(b => dyOf(stack(c, b)!))

    // One rail each, and both below the line.
    expect(new Set(caseRail).size, 'cases split across rails').toBe(1)
    expect(new Set(rangeRail).size, 'ends split across rails').toBe(1)
    expect(caseRail[0]).toBeGreaterThan(0)
    // The market is context: it reads BELOW the analyst's own work.
    expect(rangeRail[0]).toBeGreaterThan(caseRail[0])
  })

  it('keeps the upper lane for the tape alone', () => {
    const c = dash()
    const above = [...c.querySelectorAll('[data-testid$="-label"]')]
      .filter(n => /,\s*-/.test((n as HTMLElement).style.transform))
    expect(above.map(n => n.textContent), 'something else is above the axis').toEqual([])
    // The tape's pill is the one thing that reads up there.
    expect(c.textContent).toContain('236.74')
  })

  /** x is the claim. No label may be nudged along the axis to make room. */
  it('centres every case label on its own marker, with no drift', () => {
    for (const draw of [amzn, dash]) {
      const c = draw()
      for (const l of c.querySelectorAll('[data-testid="ladder-dot-label"]')) {
        const el = l as HTMLElement
        const key = el.getAttribute('data-group-key')!
        expect(el.style.transform).toContain('translate(-50%')
        expect(px(el)).toBeCloseTo(
          px(q(c, `[data-testid="ladder-dot"][data-group-key="${key}"]`)), 5)
      }
    }
  })

  /**
   * The ring was the only mark on this axis with nothing to say, and tapping it
   * to find out was the hard part: 13px of circle a few points from Base's dot.
   *
   * The label is the fix for both. It names the value, and it is a button — a
   * wide box of text in empty space, doing the same job as the ring.
   */
  it('names the expectation above the line, under the tape', () => {
    const c = dash()
    const l = q(c, '[data-testid="ladder-expected-label"]')
    expect(l.tagName).toBe('BUTTON')
    expect(l.textContent).toBe('EV$244')
    expect(l.getAttribute('aria-label')).toBe('Expected value $244.00')
    // Anchored to the TOP of the box, under the pill — not hung off the line,
    // which is most of the pane away from the price it is compared against.
    expect(l.style.top).toBe('34px')
    expect(l.style.transform).toContain('translate(-50%')
    // On the expectation's own x.
    expect(px(l)).toBeCloseTo(px(q(c, '[data-testid="ladder-expected-hit"]')), 1)
  })

  it('opens the distribution from the label as well as the ring', () => {
    const c = dash()
    fireEvent.click(q(c, '[data-testid="ladder-expected-label"]'))
    expect(c.querySelectorAll('[data-testid="ladder-bar"]')).toHaveLength(3)
    // ...and the label steps aside, because the status rail states the same
    // number. Faded rather than unmounted, so leaving is a crossfade and not a
    // pop — and inert while it is invisible.
    const l = q(c, '[data-testid="ladder-expected-label"]')
    expect(l.className).toContain('opacity-0')
    expect(l.className).toContain('pointer-events-none')
    expect(q(c, '[data-testid="ladder-ev-leader"]').className).toContain('opacity-0')
  })

  /**
   * The ring is drawn BEFORE the case dots, so at equal depth the dots won the
   * overlap — and on a ladder where the expectation sits a few points from Base,
   * which is most of them, the tap landed on Base and the ring could not be
   * opened at all.
   */
  it('puts the ring above the case dots, so it can be hit', () => {
    const c = dash()
    const hit = q(c, '[data-testid="ladder-expected-hit"]')
    expect(hit.className).toContain('z-20')
    expect(q(c, '[data-testid="ladder-dot"]').className).toContain('z-10')
    // Narrower than a full target, so what it takes back from its neighbour is
    // the half nearest itself.
    expect(hit.className).toContain('w-[32px]')
    expect(hit.className).toContain('h-[44px]')
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
    // 32 wide, not 44: it sits above the case dots now, and a full-width target
    // would take the whole of a neighbouring case with it. The LABEL above the
    // line is the wide target — see 'names the expectation above the line'.
    expect(hit.className).toContain('w-[32px]')
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
    // The close is part of the header now; the reading is the label, the
    // number, and the way out.
    expect(d.textContent).toBe('Expected value$244×')
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
    expect(group(c).style.transform, 'the baseline moved on selection')
      .toBe('translateY(-2%)')
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
    const box = () => q(c, '[data-testid="ladder-axis-box"]').className
    const reserve = () => q(c, '[data-testid="ladder-readout-reserve"]').innerHTML
    const b0 = box(), r0 = reserve()
    open(c)
    expect(box()).toBe(b0)
    expect(reserve()).toBe(r0)
    expect(b0).toContain('min-h-[190px]')
    expect(b0).toContain('max-h-[210px]')
  })

  it('returns to the resting baseline when a case is tapped', () => {
    const c = dash()
    open(c)
    expect(group(c).style.transform, 'the baseline moved on selection')
      .toBe('translateY(-2%)')
    fireEvent.click(c.querySelectorAll('[data-testid="ladder-dot"]')[1])
    expect(group(c).style.transform, 'the baseline moved on selection')
      .toBe('translateY(-2%)')
    expect(q(c, '[data-testid="ladder-readout"]').textContent).toContain('Base')
    // And the ladder context is back.
    expect(q(c, '[data-testid="ladder-tape"]').className).not.toContain('opacity-0')
  })
})

/**
 * The distribution, as the discrete thing it is.
 *
 * Bear, Base and Bull are three scenarios an analyst wrote down with three
 * probabilities. They are not samples from a continuous distribution, and every
 * smooth rendering of them drew a height at every price BETWEEN the cases,
 * which is information nobody has — three attempts produced three different
 * curves from the same three numbers, which is the tell that the shape was
 * carrying meaning the data does not.
 *
 * The first honest version was a 1px stem per case, and it was too quiet to be
 * the subject: at that width a quantity reads as chart furniture. These pin the
 * finished model — filled bars, prominent weights, one column per case, and the
 * market range kept underneath rather than thrown away.
 */
describe('EV mode is a discrete probability view', () => {
  const enter = (c: HTMLElement) => {
    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    return c
  }
  const bars = (c: HTMLElement) =>
    [...c.querySelectorAll('[data-testid="ladder-bar"]')] as HTMLElement[]
  const barOf = (c: HTMLElement, key: string) =>
    q(c, `[data-testid="ladder-bar"][data-bar-key="${key}"]`)
  const hOf = (el: HTMLElement) => parseFloat(el.style.height)
  const dy = (el: HTMLElement) =>
    parseFloat(/,\s*(-?\d+(?:\.\d+)?)px\)/.exec(el.style.transform)![1])
  /** The group key behind a case name, so heights can be looked up by label. */
  const keyFor = (c: HTMLElement, label: string) =>
    [...c.querySelectorAll('[data-testid="ladder-dot"]')]
      .find(d => (d.getAttribute('aria-label') ?? '').startsWith(label))!
      .getAttribute('data-group-key')!

  it('draws no curve, no path and no svg of any kind', () => {
    const c = enter(dash())
    expect(c.querySelector('[data-testid="ladder-curve"]')).toBeNull()
    expect(c.querySelector('svg')).toBeNull()
    expect(c.querySelector('path')).toBeNull()
  })

  it('renders filled bars wide enough to compare, not hairlines', () => {
    const c = enter(dash())
    expect(c.querySelector('[data-testid="ladder-stem"]')).toBeNull()
    expect(bars(c)).toHaveLength(3)
    for (const b of bars(c)) {
      const w = parseFloat(b.style.width)
      expect(w).toBeGreaterThanOrEqual(12)
      expect(w).toBeLessThanOrEqual(18)
      expect(b.className).toContain('bg-indigo-500/75')
    }
  })

  it('stands each bar on its own case, at the ladder x', () => {
    const c = enter(dash())
    for (const dot of c.querySelectorAll('[data-testid="ladder-dot"]')) {
      const key = dot.getAttribute('data-group-key')!
      expect(px(barOf(c, key))).toBeCloseTo(px(dot), 5)
    }
  })

  it('makes Base tallest and the two 30% tails equal', () => {
    const c = enter(dash())
    const h = (l: string) => hOf(barOf(c, keyFor(c, l)))
    expect(h('Base')).toBeGreaterThan(h('Bear'))
    expect(h('Base')).toBeGreaterThan(h('Bull'))
    expect(h('Bear')).toBeCloseTo(h('Bull'), 5)
    // Proportional, not merely ordered: 30/40 of the tallest.
    expect(h('Bear') / h('Base')).toBeCloseTo(0.75, 5)
  })

  /** Symmetry is not baked in — the heaviest case wins wherever it sits. */
  it('puts the tallest bar over Bull when Bull carries the weight', () => {
    const skewed = [
      { name: 'Bear', price: 180, probability: 20, timeframe: '12 months' },
      { name: 'Base', price: 250, probability: 30, timeframe: '12 months' },
      { name: 'Bull', price: 300, probability: 50, timeframe: '12 months' },
    ]
    const c = enter(render(
      <ScenarioLadder price={236.74} cases={skewed} expected={253}
        range52w={{ low: 147, high: 282 }} />).container)
    const h = (l: string) => hOf(barOf(c, keyFor(c, l)))
    expect(h('Bull')).toBeGreaterThan(h('Base'))
    expect(h('Base')).toBeGreaterThan(h('Bear'))
    expect(h('Base') / h('Bull')).toBeCloseTo(0.6, 5)
  })

  /**
   * The weights are the finding, so they are typeset like one. They used to be
   * a 9px line under the price — third in a stack of three, which is where
   * metadata goes.
   */
  it('states each weight prominently, just above its own bar', () => {
    const c = enter(dash())
    const weights =
      [...c.querySelectorAll('[data-testid="ladder-dot-weight"]')] as HTMLElement[]
    expect(weights).toHaveLength(3)
    for (const w of weights) {
      expect(w.className).toContain('text-[11px]')
      expect(w.className).toContain('font-bold')
      expect(w.className).toMatch(/text-indigo/)
      const key = w.getAttribute('data-bar-key')!
      // Centred on its own bar horizontally...
      expect(px(w)).toBeCloseTo(px(barOf(c, key)), 5)
    }
    // ...and four pixels above its OWN bar, not on a shared rail. A common
    // height detaches the two shorter numbers from the quantity they describe.
    for (const w of weights) {
      const key = w.getAttribute('data-bar-key')!
      // `calc(50% + h% + 4px)`, which jsdom folds to `calc(58.5% + 4px)` — so
      // the percentages are summed rather than matched as a substring.
      const pcts = [...w.style.bottom.matchAll(/(-?[\d.]+)%/g)]
        .reduce((sum, m) => sum + parseFloat(m[1]), 0)
      expect(pcts).toBeCloseTo(50 + hOf(barOf(c, key)), 5)
    }
    expect(new Set(weights.map(w => w.style.bottom)).size,
      'every weight at the same height').toBe(2)

    const byKey = new Map(weights.map(w => [w.getAttribute('data-bar-key'), w.textContent]))
    expect(byKey.get(keyFor(c, 'Bear'))).toBe('30%')
    expect(byKey.get(keyFor(c, 'Base'))).toBe('40%')
    expect(byKey.get(keyFor(c, 'Bull'))).toBe('30%')
  })

  it('states each weight exactly once', () => {
    const c = enter(dash())
    expect(c.textContent!.match(/40%/g) ?? []).toHaveLength(1)
    expect(c.textContent!.match(/30%/g) ?? []).toHaveLength(2)
  })

  /**
   * One column per case: bar, weight, dot, name, price. Nothing above the line,
   * because above the line is where the distribution is.
   */
  it('puts every case label below the baseline, under its own dot', () => {
    const c = enter(dash())
    for (const label of c.querySelectorAll('[data-testid="ladder-dot-label"]')) {
      const el = label as HTMLElement
      expect(dy(el), el.textContent!).toBeGreaterThan(0)
      // Centred on the coordinate, with no inward nudge.
      expect(el.style.transform).toContain('translate(-50%')
      const key = el.getAttribute('data-group-key')!
      expect(px(el)).toBeCloseTo(
        px(q(c, `[data-testid="ladder-dot"][data-group-key="${key}"]`)), 5)
    }
  })

  it('names each case and its price, and nothing else', () => {
    const c = enter(dash())
    expect(q(c, '[data-testid="ladder-dot-label"]').textContent!)
      .toMatch(/^(Bear|Base|Bull)\$\d+$/)
  })

  // -- The market context that was wrongly removed ---------------------------

  it('keeps the 52-week band and both ticks, quieter', () => {
    const c = enter(dash())
    const band = q(c, '[data-testid="ladder-52w-span"]')
    expect(band.className).toContain('opacity-60')
    expect(band.className).not.toContain('opacity-0')
    for (const b of ['low', 'high']) {
      expect(tick(c, b).className, b).not.toContain('opacity-0')
    }
  })

  it('leaves the range on exactly the coordinates the resting ladder used', () => {
    const before = ['low', 'high'].map(b => px(tick(dash(), b)))
    const c = enter(dash())
    expect(['low', 'high'].map(b => px(tick(c, b)))).toEqual(before)
  })

  it('moves the 52-week labels below the line and drops the 52W line', () => {
    const c = enter(dash())
    for (const b of ['low', 'high']) {
      const l = stack(c, b)!
      expect(dy(l), b).toBeGreaterThan(0)
      expect(l.textContent).not.toContain('52W')
      expect(l.textContent).toContain(b === 'low' ? 'Low' : 'High')
    }
    expect(stack(c, 'low')!.textContent).toContain('$147')
    expect(stack(c, 'high')!.textContent).toContain('$282')
  })

  it('hides NOW, which would be a third marker in a crowded lane', () => {
    const c = enter(dash())
    expect(q(c, '[data-testid="ladder-tape"]').className).toContain('opacity-0')
    expect(q(c, '[data-testid="ladder-now-leader"]').className).toContain('opacity-0')
  })

  // -- The result ------------------------------------------------------------

  it('marks the expectation on the price axis, with no bar of its own', () => {
    const c = enter(dash())
    const ev = q(c, '[data-testid="ladder-ev-result"]')
    expect(ev.className).toContain('rotate-45')
    expect(ev.className).not.toContain('rounded-full')
    // At pos(244): between Bear and Base, and on its own guide.
    const dots =
      [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px).sort((x, y) => x - y)
    expect(px(ev)).toBeGreaterThan(dots[0])
    expect(px(ev)).toBeLessThan(dots[1])
    // No leader. On DASH it ran three pixels from Base's bar and read as a
    // second mark on that case rather than as a line of its own.
    expect(c.querySelector('[data-testid="ladder-ev-guide"]')).toBeNull()
    // No bar stands on it — a bar means "this much weight sits here".
    expect(bars(c).map(px)).not.toContain(px(ev))
    expect(bars(c)).toHaveLength(3)
  })

  /**
   * $244 and Base $250 are ~3% of the axis apart. The header carries the full
   * number, so the marker stays a shape rather than overlapping "BASE $250".
   */
  it('declines the EV caption rather than overlapping the case beside it', () => {
    expect(enter(dash()).querySelector('[data-testid="ladder-ev-tag"]')).toBeNull()
  })

  it('states the expectation once, in the mode header', () => {
    const c = enter(dash())
    const header = q(c, '[data-testid="ladder-ev-header"]')
    expect(header.textContent).toContain('Expected value')
    expect(header.textContent).toContain('$244')
    // The on-axis label still exists in the DOM — it is faded out so that
    // leaving is a crossfade — so "once" is about what is VISIBLE.
    expect(q(c, '[data-testid="ladder-expected-label"]').className).toContain('opacity-0')
  })

  // -- Getting out -----------------------------------------------------------

  /**
   * The ring is hidden in this mode, so tapping it again means aiming at a
   * target the reader can no longer see. The close is the visible way back.
   */
  it('offers a labelled close in the header, and it exits', () => {
    const c = enter(dash())
    const x = q(c, '[data-testid="ladder-ev-close"]')
    expect(x.getAttribute('aria-label')).toBe('Exit expected value view')
    fireEvent.click(x)
    expect(c.querySelector('[data-testid="ladder-bar"]')).toBeNull()
    expect(c.querySelector('[data-testid="ladder-ev-header"]')).toBeNull()
    expect(q(c, '[data-testid="ladder-tape"]').className).not.toContain('opacity-0')
    expect(stack(c, 'low')!.textContent).toBe('Low$147')
  })

  it('still exits on a second tap of the expected value itself', () => {
    const c = enter(dash())
    fireEvent.click(q(c, '[data-testid="ladder-expected-hit"]'))
    expect(c.querySelector('[data-testid="ladder-bar"]')).toBeNull()
  })

  it('leaves the mode and selects the case when a case is tapped', () => {
    const c = enter(dash())
    const bear = q(c, '[data-testid="ladder-dot"]')
    fireEvent.click(bear)
    expect(c.querySelector('[data-testid="ladder-bar"]')).toBeNull()
    expect(bear.getAttribute('aria-pressed')).toBe('true')
  })

  it('restores the resting label layout exactly on exit', () => {
    const geom = (c: HTMLElement) =>
      [...c.querySelectorAll('[data-testid="ladder-dot-label"]')]
        .map(n => `${(n as HTMLElement).style.left}|${(n as HTMLElement).style.transform}`)
    const before = geom(dash())
    const c = enter(dash())
    fireEvent.click(q(c, '[data-testid="ladder-ev-close"]'))
    expect(geom(c)).toEqual(before)
  })

  // -- Motion ----------------------------------------------------------------

  /**
   * A transition needs two values. The bars mount at `scale-y-0` and flip to
   * full height on the next frame, so the growth is real rather than a declared
   * transition that never fires.
   */
  it('grows the bars upward out of the baseline', () => {
    const c = enter(dash())
    for (const b of bars(c)) {
      expect(b.className).toContain('origin-bottom')
      expect(b.className).toContain('transition-[left,transform]')
      expect(b.className).toContain('duration-300')
      expect(b.className).toContain('motion-reduce:transition-none')
      expect(b.style.bottom).toBe('50%')
    }
  })

  it('does not move any x on the way in', () => {
    const before = [...dash().querySelectorAll('[data-testid="ladder-dot"]')].map(px)
    const c = enter(dash())
    expect([...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px)).toEqual(before)
  })
})
