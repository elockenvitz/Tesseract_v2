import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { ScenarioLadder } from '../ScenarioLadder'
import { buildScenarioGapCard } from '../../../lib/signals/builders/scenarioGap'
import { judgmentPresentationFor, judgmentIsDeclaredInline } from '../../../lib/signals/content-registry'

/**
 * One card type, one shell — and two different findings inside it.
 *
 * Measured on two real cards:
 *
 *   AMZN  $266.43 against Bear 90 / Base 120 / Bull 180. Outside the
 *         framework, `critical`, hero "+48% above your highest case of $180".
 *   DASH  $236.74 against Bear 180 / Base 250 / Bull 300, weighted 30/40/30.
 *         At its expected value, `informational`, hero "$244
 *         probability-weighted, 3 cases".
 *
 * The CONTENT should differ — that is the product working. The interaction
 * system should not, and it did: DASH was downgraded to `on_engage` by
 * severity and grew a second navigation model.
 */

type Case = { name: string; price: number; probability: number | null; timeframe: string }
const CASES_AMZN: Case[] = [
  { name: 'Bear', price: 90, probability: null, timeframe: '12 months' },
  { name: 'Base', price: 120, probability: null, timeframe: '12 months' },
  { name: 'Bull', price: 180, probability: null, timeframe: '12 months' },
]
const CASES_DASH: Case[] = [
  { name: 'Bear', price: 180, probability: 30, timeframe: '12 months' },
  { name: 'Base', price: 250, probability: 40, timeframe: '12 months' },
  { name: 'Bull', price: 300, probability: 30, timeframe: '12 months' },
]

const build = (price: number, cases: Case[]) => {
  const r = buildScenarioGapCard({
    assetId: 'a1', symbol: 'X', companyName: 'X Inc',
    price, priceAsOf: new Date().toISOString(),
    cases, heldIn: [], statedAt: '2026-08-23T19:13:53Z',
  })
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

describe('A. one shell, whatever the finding', () => {
  const amzn = build(266.43, CASES_AMZN)
  const dash = build(236.74, CASES_DASH)

  it('produces both states from the same builder and type', () => {
    expect(amzn.type).toBe('scenario_gap')
    expect(dash.type).toBe('scenario_gap')
    expect(amzn.headline).toContain('above every case')
    expect(dash.headline).toContain('expected value')
  })

  /** The severities that used to fork the architecture. */
  it('still differs in severity, which is the input that used to fork it', () => {
    expect(amzn.severity).toBe('critical')
    expect(dash.severity).toBe('informational')
  })

  /**
   * THE regression. A declared-inline type that supplies its own multi-pane
   * shell keeps that shell at every severity, so there is no "Your view" and
   * no "< Evidence" on one card and not the other.
   */
  it('keeps the same presentation for both, given its own shell', () => {
    expect(judgmentIsDeclaredInline('scenario_gap')).toBe(true)
    // The raw rule still downgrades on severity...
    expect(judgmentPresentationFor(amzn)).toBe('inline')
    expect(judgmentPresentationFor(dash)).toBe('on_engage')
    // ...and `SignalCardView` overrides it for a card with its own shell.
    // Asserted end to end in SignalCardView.judgment.test.tsx.
  })
})

describe('C. the intentional differences survive', () => {
  it('keeps each state its own hero', () => {
    const amzn = build(266.43, CASES_AMZN)
    expect(amzn.metric!.value).toBe('+48%')
    expect(amzn.metric!.label).toContain('highest case of $180')
    expect(amzn.prompt).toBe('Has the investment view changed?')

    const dash = build(236.74, CASES_DASH)
    expect(dash.metric!.value).toBe('$244')
    expect(dash.metric!.label).toContain('Probability-weighted')
    expect(dash.metric!.label).toContain('3 cases')
    expect(dash.prompt).toBe('Is holding this still a deliberate choice?')
  })

  /**
   * F. The body must fit the two-line clamp. The expected-value branch ran to
   * 191 characters and rendered as "…your 3 scenarios. Your own workmore…" —
   * a word cut in half with the truncation control fused onto it.
   */
  it('keeps every body short enough not to clamp', () => {
    for (const c of [build(266.43, CASES_AMZN), build(236.74, CASES_DASH)]) {
      expect(c.body.length, c.headline).toBeLessThanOrEqual(100)
      expect(c.body).not.toContain('  ')
      expect(c.body.trim()).toBe(c.body)
    }
  })
})

// ── B / C / D. Ladder geometry under the two real layouts ───────────────────

const px = (el: Element) => parseFloat((el as HTMLElement).style.left)
const boxes = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid$="-label"], [data-testid="ladder-52w-label"]')]

describe('B. label layout never moves a mark', () => {
  /** DASH: NOW 237, EV 244, Base 250, 52W high 282, Bull 300 all on the right. */
  const dash = () => render(
    <ScenarioLadder price={236.74} cases={CASES_DASH} expected={244}
      range52w={{ low: 147, high: 282 }} />,
  ).container

  it('keeps one ruler across cases, EV, the tape and both market ends', () => {
    const c = dash()
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px)
    const lo = px(c.querySelector('[data-bound="low"][data-testid="ladder-52w"]')!)
    const hi = px(c.querySelector('[data-bound="high"][data-testid="ladder-52w"]')!)
    const ev = px(c.querySelector('[data-testid="ladder-expected"]')!)
    const tape = px(c.querySelector('[data-testid="ladder-tape"]')!)

    const perDollar = (Math.max(...dots) - Math.min(...dots)) / (300 - 180)
    const check = (a: number, b: number, dollars: number, what: string) =>
      expect(Math.abs(Math.abs(a - b) / dollars - perDollar) / perDollar, what)
        .toBeLessThan(0.02)

    check(hi, lo, 282 - 147, '52w span')
    check(ev, Math.min(...dots), 244 - 180, 'EV from Bear')
    check(tape, Math.min(...dots), 236.74 - 180, 'tape from Bear')
  })

  /** The EV ring is at its true x whether or not it earned a label. */
  it('places the expected-value ring quantitatively, label or not', () => {
    const c = dash()
    expect(c.querySelector('[data-testid="ladder-expected"]')).toBeTruthy()
    const ev = px(c.querySelector('[data-testid="ladder-expected"]')!)
    const dots = [...c.querySelectorAll('[data-testid="ladder-dot"]')].map(px)
    // $244 sits between Bear $180 and Base $250, so its mark must too.
    expect(ev).toBeGreaterThan(Math.min(...dots))
    expect(ev).toBeLessThan(dots.sort((a, b) => a - b)[1])
  })

  /** The NOW leader is drawn from the true x, never the clamped pill. */
  it('anchors the NOW leader to the marker, not the label', () => {
    const c = dash()
    expect(px(c.querySelector('[data-testid="ladder-now-leader"]')!))
      .toBeCloseTo(px(c.querySelector('[data-testid="ladder-tape"]')!), 5)
  })
})

describe('C. crowded labels resolve into lanes without overlapping', () => {
  for (const [name, price, cases, expected, range] of [
    ['AMZN', 266.43, CASES_AMZN, null, { low: 199, high: 284 }],
    ['DASH', 236.74, CASES_DASH, 244, { low: 147, high: 282 }],
  ] as const) {
    it(`separates every label box on the ${name} layout`, () => {
      const { container } = render(
        <ScenarioLadder price={price} cases={cases as never} expected={expected}
          range52w={range} />,
      )
      // Group by lane (side + row) from the transform, then check overlap
      // within each lane — labels in different lanes cannot collide.
      const byLane = new Map<string, { left: number; half: number }[]>()
      for (const el of boxes(container)) {
        const style = (el as HTMLElement).style
        const lane = style.transform.replace(/translate\([^,]+,\s*/, '')
        const left = parseFloat(style.left)
        if (!Number.isFinite(left)) continue
        const list = byLane.get(lane) ?? []
        list.push({ left, half: 6 })
        byLane.set(lane, list)
      }
      for (const [lane, items] of byLane) {
        const sorted = items.sort((a, b) => a.left - b.left)
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].left - sorted[i - 1].left, `${name} lane ${lane}`)
            .toBeGreaterThan(0)
        }
      }
    })
  }

  it('draws a complete DASH ladder with no range at all', () => {
    const { container } = render(
      <ScenarioLadder price={236.74} cases={CASES_DASH} expected={244} range52w={null} />,
    )
    expect(container.querySelectorAll('[data-testid="ladder-dot"]')).toHaveLength(3)
    expect(container.querySelector('[data-testid="ladder-expected"]')).toBeTruthy()
  })
})
