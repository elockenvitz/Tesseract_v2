/**
 * The phone Outcomes chart, rendered with real Recharts.
 *
 * jsdom has no layout, so the plot width is supplied through clientWidth and a
 * ResizeObserver stand-in; everything else — the drawn marker positions, the
 * recorded scrub geometry, the axes — is what Recharts actually produced.
 */
import { useState } from 'react'
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { format, addDays, parseISO } from 'date-fns'
import { PositionChartMobile } from '../PositionChartMobile'
import {
  METRICS, MARKER_HIT_RADIUS, availableRanges, buildPositionChartData, defaultRange, metricAvailability,
  type ChartRange, type OverlayField,
} from '../position-chart-model'
import type { PositionLifecycle, PricePoint, HoldingsTimePoint } from '../../../hooks/usePositionLifecycle'

// ── Layout stand-ins ───────────────────────────────────────────────────
let plotWidth = 358
const observers: Array<() => void> = []

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => plotWidth })
  class ResizeObserverStandIn {
    constructor(cb: () => void) { observers.push(cb) }
    observe() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: ResizeObserverStandIn })
  if (!('PointerEvent' in window)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventPolyfill })
  }
})

// ── Fixture: a real-shaped year of prices, one buy, two holdings points ──
const START = parseISO('2025-08-01')
const priceHistory: PricePoint[] = Array.from({ length: 406 }, (_, i) => ({
  date: format(addDays(START, i), 'yyyy-MM-dd'),
  close: Math.round((100 + i * 0.1 + Math.sin(i / 9) * 3) * 100) / 100,
}))
const LAST = priceHistory[priceHistory.length - 1].date // 2026-09-10

const lifecycle = {
  assetId: 'a-1', assetSymbol: 'AAPL', assetName: 'Apple', portfolioId: 'p-1', portfolioName: 'Growth',
  timeline: [
    { id: 'd', date: '2026-07-01T12:00:00Z', type: 'decision', action: 'buy', price: 135, sharesDelta: null, sharesAfter: null, sourceId: 'tq-1', sourceType: 'trade_queue_item', stage: 'approved', userName: 'PM' },
    { id: 'e', date: '2026-07-20T12:00:00Z', type: 'execution', action: 'add', price: 137, sharesDelta: 500, sharesAfter: 1500, sourceId: 'ev-1', sourceType: 'portfolio_trade_event', userName: null },
  ],
  avgEntryPrice: 135.5, currentPrice: 140, holdingDays: 70, isOpen: true, currentShares: 1500,
  realizedPnl: null, unrealizedPnl: null, totalPnl: null, totalReturnPct: null, annualizedReturnPct: null,
  decisionScores: [],
} as unknown as PositionLifecycle

const holdings: HoldingsTimePoint[] = [
  { date: '2026-07-01', shares: 1000, marketValue: 135000, weightPct: 2.5 },
  { date: '2026-07-20', shares: 1500, marketValue: 205500, weightPct: 3.75 },
]

function Harness(props: {
  holdingsHistory?: HoldingsTimePoint[]
  benchmarkWeightPct?: number | null
  onSelectEvent?: (id: string, type: 'trade_queue_item' | 'portfolio_trade_event') => void
  initialMetric?: OverlayField
}) {
  const [metric, setMetric] = useState<OverlayField>(props.initialMetric ?? 'shares')
  const [range, setRange] = useState<ChartRange | null>(null)
  return (
    <PositionChartMobile
      lifecycle={lifecycle}
      priceHistory={priceHistory}
      holdingsHistory={props.holdingsHistory ?? holdings}
      benchmarkWeightPct={props.benchmarkWeightPct === undefined ? 1 : props.benchmarkWeightPct}
      onSelectEvent={props.onSelectEvent ?? (() => {})}
      symbol="AAPL"
      metric={metric}
      onMetricChange={setMetric}
      range={range}
      onRangeChange={setRange}
    />
  )
}

const layer = () => document.querySelector('[data-slot="chart-scrub-layer"]') as HTMLElement
const tooltip = () => document.querySelector('[data-slot="chart-tooltip"]') as HTMLElement | null
const svg = () => document.querySelector('[data-slot="position-chart-mobile"] svg.recharts-surface') as SVGSVGElement
/** The drawn decision marker: DecisionDot's white circle of radius 7. */
const decisionMarker = () => {
  const c = Array.from(document.querySelectorAll('circle')).find(el => el.getAttribute('r') === '7' && el.getAttribute('fill') === 'white')!
  return { x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) }
}
const radio = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })

function scrub(fromX: number, toX: number, y = 120) {
  fireEvent.pointerDown(layer(), { clientX: fromX, clientY: y, pointerId: 1 })
  fireEvent.pointerMove(layer(), { clientX: (fromX + toX) / 2, clientY: y, pointerId: 1 })
  fireEvent.pointerMove(layer(), { clientX: toX, clientY: y, pointerId: 1 })
}

/** Checks the tooltip against the chart's own rows for the date it names. */
function expectTooltipMatchesRow(metric: OverlayField, benchmark = 1) {
  const tip = tooltip()!
  const dateText = tip.firstElementChild!.textContent!
  const rows = buildPositionChartData(lifecycle, priceHistory, holdings, benchmark)
  const row = rows.find(r => format(parseISO(r.date), 'MMM d, yyyy') === dateText)!
  expect(row).toBeTruthy()
  expect(within(tip).getByText(`$${row.price!.toFixed(2)}`)).toBeTruthy()
  const value = row[METRICS[metric].key] as number
  expect(tip.querySelector('[data-slot="tooltip-metric"]')!.textContent).toBe(METRICS[metric].format(value))
  return { row, tip }
}

describe('phone position chart', () => {
  beforeEach(() => { plotWidth = 358; observers.length = 0 })
  afterEach(cleanup)

  describe('width', () => {
    it('draws at the pane’s measured width and follows it when it changes', () => {
      render(<Harness />)
      expect(svg().getAttribute('width')).toBe('358')
      plotWidth = 300
      act(() => { observers.forEach(cb => cb()) })
      expect(svg().getAttribute('width')).toBe('300')
    })

    it('cannot scroll the page sideways: the plot clips, the legend wraps, the tooltip stays inside', () => {
      render(<Harness />)
      const plot = layer().parentElement!
      expect(plot.className).toContain('overflow-hidden')
      expect(plot.className).toContain('w-full')
      expect(Number(svg().getAttribute('width'))).toBeLessThanOrEqual(plotWidth)
      expect(document.querySelector('[data-slot="chart-legend"]')!.className).toContain('flex-wrap')

      for (const x of [0, plotWidth - 1]) {
        scrub(x, x)
        const left = parseFloat(tooltip()!.style.left)
        const width = parseFloat(tooltip()!.style.width)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(left + width).toBeLessThanOrEqual(plotWidth)
        fireEvent.pointerUp(layer(), { pointerId: 1 })
        fireEvent.pointerDown(document.body)
      }
    })

    it('uses a 250–300px plot', () => {
      render(<Harness />)
      const h = Number(svg().getAttribute('height'))
      expect(h).toBeGreaterThanOrEqual(250)
      expect(h).toBeLessThanOrEqual(300)
    })
  })

  describe('scrub', () => {
    it('shows a crosshair and a tooltip with date, price and shares while the finger moves, and clears on lift', () => {
      render(<Harness />)
      expect(tooltip()).toBeNull()
      scrub(60, 200)
      expect(document.querySelector('[data-slot="chart-crosshair"]')).not.toBeNull()
      const { tip } = expectTooltipMatchesRow('shares')
      expect(tip.querySelector('[data-slot="tooltip-metric"]')!.textContent).toMatch(/ shs$/)

      const crossLeft = parseFloat((document.querySelector('[data-slot="chart-crosshair"]') as HTMLElement).style.left)
      expect(Math.abs(crossLeft - 200)).toBeLessThan(5)

      fireEvent.pointerUp(layer(), { clientX: 200, clientY: 120, pointerId: 1 })
      expect(tooltip()).toBeNull()
      expect(document.querySelector('[data-slot="chart-crosshair"]')).toBeNull()
    })

    it('moves with the finger to a later date', () => {
      render(<Harness />)
      scrub(40, 80)
      const early = tooltip()!.firstElementChild!.textContent!
      fireEvent.pointerMove(layer(), { clientX: 280, clientY: 120, pointerId: 1 })
      const late = tooltip()!.firstElementChild!.textContent!
      expect(new Date(late).getTime()).toBeGreaterThan(new Date(early).getTime())
    })

    it('clears when the browser takes the gesture for a page scroll', () => {
      render(<Harness />)
      scrub(60, 200)
      fireEvent.pointerCancel(layer(), { pointerId: 1 })
      expect(tooltip()).toBeNull()
    })

    it('keeps a tapped tooltip until a tap outside the chart', () => {
      render(<Harness />)
      fireEvent.pointerDown(layer(), { clientX: 150, clientY: 240, pointerId: 1 })
      fireEvent.pointerUp(layer(), { clientX: 150, clientY: 240, pointerId: 1 })
      expect(tooltip()).not.toBeNull()
      fireEvent.pointerDown(document.body)
      expect(tooltip()).toBeNull()
    })
  })

  describe('markers', () => {
    it('selects the decision when the tap lands near, not only on, its marker', () => {
      const onSelectEvent = vi.fn()
      render(<Harness onSelectEvent={onSelectEvent} />)
      const m = decisionMarker()
      const nearby = m.y + MARKER_HIT_RADIUS - 4 // well outside the 7px drawn marker
      fireEvent.pointerDown(layer(), { clientX: m.x, clientY: nearby, pointerId: 1 })
      fireEvent.pointerUp(layer(), { clientX: m.x, clientY: nearby, pointerId: 1 })
      expect(onSelectEvent).toHaveBeenCalledWith('tq-1', 'trade_queue_item')
      expect(tooltip()).toBeNull()
    })

    it('does not select from a tap away from any marker, or from a scrub across one', () => {
      const onSelectEvent = vi.fn()
      render(<Harness onSelectEvent={onSelectEvent} />)
      const m = decisionMarker()
      fireEvent.pointerDown(layer(), { clientX: m.x, clientY: m.y + MARKER_HIT_RADIUS + 30, pointerId: 1 })
      fireEvent.pointerUp(layer(), { pointerId: 1 })
      scrub(m.x - 40, m.x)
      fireEvent.pointerUp(layer(), { pointerId: 1 })
      expect(onSelectEvent).not.toHaveBeenCalled()
    })

    it('keeps the entry line, and names it in the legend instead of a label on the plot', () => {
      render(<Harness />)
      expect(document.querySelector('.recharts-reference-line')).not.toBeNull()
      expect(svg().textContent).not.toMatch(/Entry/)
      expect(screen.getByText('Avg entry $135.50')).toBeTruthy()
      expect(screen.getByText('Buy/Add')).toBeTruthy()
      expect(screen.getByText('Sell/Trim')).toBeTruthy()
    })
  })

  describe('metric', () => {
    const metricTicks = () =>
      Array.from(document.querySelectorAll('.recharts-yAxis.yAxis'))
        .filter(axis => axis.querySelector('.recharts-cartesian-axis-tick') && axis.getAttribute('class')?.includes('yAxis'))
        .map(axis => Array.from(axis.querySelectorAll('.recharts-cartesian-axis-tick-value')).map(t => t.textContent))

    it('Shares plots share history on a share scale', () => {
      render(<Harness />)
      expect(radio('Position metric', 'Shares').getAttribute('aria-checked')).toBe('true')
      const ticks = metricTicks().flat()
      expect(ticks).toContain('1.5k')
      expect(ticks.some(t => t?.includes('%'))).toBe(false)
      scrub(300, 330)
      expectTooltipMatchesRow('shares')
      expect(within(document.querySelector('[data-slot="chart-legend"]') as HTMLElement).getByText('Shares')).toBeTruthy()
    })

    it('Weight plots portfolio weight in percent, not on the share scale', () => {
      render(<Harness />)
      const root = document.querySelector('[data-slot="position-chart-mobile"]')
      fireEvent.click(radio('Position metric', 'Weight'))
      // Same mounted chart, redrawn — nothing reloaded.
      expect(document.querySelector('[data-slot="position-chart-mobile"]')).toBe(root)
      expect(radio('Position metric', 'Weight').getAttribute('aria-checked')).toBe('true')
      const ticks = metricTicks().flat()
      expect(ticks).toContain('3.8%')
      expect(ticks).not.toContain('1.5k')
      scrub(300, 330)
      const { tip } = expectTooltipMatchesRow('weight')
      expect(tip.querySelector('[data-slot="tooltip-metric"]')!.textContent).toBe('3.75%')
      expect(within(document.querySelector('[data-slot="chart-legend"]') as HTMLElement).getByText('Weight')).toBeTruthy()
    })

    it('Active weight plots weight minus the benchmark weight, signed, in percent', () => {
      render(<Harness />)
      fireEvent.click(radio('Position metric', 'Active wt'))
      expect(metricTicks().flat()).toContain('+2.8%')
      scrub(300, 330)
      const { tip } = expectTooltipMatchesRow('active_weight')
      expect(tip.querySelector('[data-slot="tooltip-metric"]')!.textContent).toBe('+2.75%')
      expect(within(tip).getByText('Active weight')).toBeTruthy()
    })

    it('keeps price primary in every mode', () => {
      render(<Harness />)
      for (const name of ['Shares', 'Weight', 'Active wt']) {
        fireEvent.click(radio('Position metric', name))
        expect(document.querySelectorAll('.recharts-line')).toHaveLength(1)
        const priceTicks = Array.from(document.querySelectorAll('.recharts-yAxis')).flatMap(a =>
          Array.from(a.querySelectorAll('.recharts-cartesian-axis-tick-value')).map(t => t.textContent))
        expect(priceTicks.some(t => t?.startsWith('$'))).toBe(true)
      }
    })

    it('switches back and forth immediately', () => {
      render(<Harness />)
      fireEvent.click(radio('Position metric', 'Weight'))
      fireEvent.click(radio('Position metric', 'Shares'))
      scrub(300, 330)
      expect(tooltip()!.querySelector('[data-slot="tooltip-metric"]')!.textContent).toBe('1,500 shs')
    })

    it('disables metrics with no history and draws price only instead of an empty area', () => {
      render(<Harness holdingsHistory={[]} />)
      for (const name of ['Shares', 'Weight', 'Active wt']) {
        expect((radio('Position metric', name) as HTMLButtonElement).disabled).toBe(true)
      }
      expect(screen.getByText('No shares history for this position — showing price only.')).toBeTruthy()
      expect(document.querySelector('.recharts-area')).toBeNull()
      expect(document.querySelector('.recharts-line')).not.toBeNull()
      scrub(100, 200)
      expect(tooltip()!.querySelector('[data-slot="tooltip-metric"]')).toBeNull()
    })

    it('disables only Weight and Active weight when shares exist but weight does not', () => {
      render(<Harness holdingsHistory={holdings.map(h => ({ ...h, weightPct: null }))} />)
      expect((radio('Position metric', 'Shares') as HTMLButtonElement).disabled).toBe(false)
      expect((radio('Position metric', 'Weight') as HTMLButtonElement).disabled).toBe(true)
      expect((radio('Position metric', 'Active wt') as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByText('Weight and Active weight aren’t available for this position.')).toBeTruthy()
      expect(document.querySelector('.recharts-area')).not.toBeNull()
    })

    it('says so when the benchmark weight is unknown and active weight is taken against 0%', () => {
      render(<Harness benchmarkWeightPct={null} initialMetric="active_weight" />)
      expect(screen.getByText('(no benchmark wt, taken as 0%)')).toBeTruthy()
    })
  })

  describe('range', () => {
    it('offers 3M · 6M · 1Y · All and defaults to the shortest that shows entry through today', () => {
      render(<Harness />)
      const group = screen.getByRole('radiogroup', { name: 'Chart range' })
      expect(within(group).getAllByRole('radio').map(r => r.textContent)).toEqual(['3M', '6M', '1Y', 'All'])
      expect(radio('Chart range', '3M').getAttribute('aria-checked')).toBe('true')
      const marker = decisionMarker()
      expect(marker.x).toBeGreaterThan(0)
    })

    it('redraws for All without losing the metric', () => {
      render(<Harness />)
      fireEvent.click(radio('Position metric', 'Weight'))
      fireEvent.click(radio('Chart range', 'All'))
      expect(radio('Chart range', 'All').getAttribute('aria-checked')).toBe('true')
      expect(radio('Position metric', 'Weight').getAttribute('aria-checked')).toBe('true')
      expect(screen.getByText('Aug 25')).toBeTruthy()
    })

    it('only offers ranges the data is longer than', () => {
      const rows = buildPositionChartData(lifecycle, priceHistory.slice(-100), holdings, 1)
      expect(availableRanges(rows)).toEqual(['3M', 'All'])
      expect(availableRanges(rows.slice(-30))).toEqual(['All'])
      expect(defaultRange(buildPositionChartData(lifecycle, priceHistory, holdings, 1), lifecycle)).toBe('3M')
      expect(defaultRange(buildPositionChartData(lifecycle, priceHistory, holdings, 1), { timeline: [] })).toBe('1Y')
      expect(LAST).toBe('2026-09-10')
    })

    it('reports availability from the data it plots', () => {
      const rows = buildPositionChartData(lifecycle, priceHistory, holdings, 1)
      expect(metricAvailability(rows)).toEqual({ shares: true, weight: true, active_weight: true })
    })
  })
})
