import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'

import { PriceContext } from '../PriceContext'
import { CasePane } from '../CasePane'
import { EvidencePane } from '../EvidencePane'
import { FEED_CHART_PLOT, FULLSCREEN_CHART_PLOT } from '../../../lib/signals/chart-geometry'

/**
 * One chart height, whatever card the chart is on.
 *
 * ── The inconsistency ─────────────────────────────────────────────────────
 *
 * The plot was `flex-1` inside a pane that is `h-full` inside a workspace that
 * owns the card's remainder. So the chart's height was a function of how much
 * chrome its family carried — measured at 390x844, plots of 117px and 384px on
 * the same viewport. A light header produced a chart that took over the card;
 * a Research or Trade Idea header pushed the same component to a strip. Nobody
 * chose either number.
 *
 * jsdom has no layout, so these assert the contract: one token, applied at one
 * place, reached by every feed chart and by no non-chart pane. The pixel
 * convergence was measured against a real renderer.
 */

const SERIES = Array.from({ length: 40 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString().slice(0, 10),
  close: 100 + i * 1.5,
}))

const NOW = new Date('2026-08-31T00:00:00.000Z')

/** The box the plot lives in: the SVG's grandparent. */
function plotBox(container: HTMLElement): HTMLElement {
  const svg = container.querySelector('[data-testid="price-chart"]')!
  return svg.parentElement!.parentElement as HTMLElement
}

describe('the standard is one token, in one place', () => {
  it('states the height once, with the numbers beside it', () => {
    // A class and the numbers behind it in the same module, so a test or a
    // reader can check the rule without a browser and the two cannot drift.
    expect(FEED_CHART_PLOT).toContain('280px')
    expect(FEED_CHART_PLOT).toContain('34svh')
    // `svh`, not `vh`: mobile browser chrome collapses on scroll, and a chart
    // that changed height when the address bar retracted is the jitter this
    // codebase has already paid for twice.
    expect(FEED_CHART_PLOT).not.toMatch(/\d+vh/)
  })

  it('lets a card too short for the standard give height back', () => {
    // The floor of last resort. Without it the x-axis and the pager would be
    // pushed out through the bottom of a pane that cannot fit 280px.
    expect(FEED_CHART_PLOT).toContain('shrink')
    expect(FEED_CHART_PLOT).toContain('min-h-0')
  })

  it('puts no card-family conditional anywhere near the height', () => {
    /**
     * The thing being eliminated: `if research -> 260, if idea -> 240`. The
     * card shell must not know how tall a chart is, and the chart must not know
     * which family it is on.
     */
    const shell = readFileSync(resolve(__dirname, '../SignalCardView.tsx'), 'utf8')
    expect(shell).not.toContain('chart-geometry')
    expect(shell).not.toContain('FEED_CHART_PLOT')

    const pane = readFileSync(resolve(__dirname, '../PricePane.tsx'), 'utf8')
    // The pane resolves the series and the three honest states; it has no
    // opinion on CHART height. Its `min-h-[92px]` floors the loading skeleton
    // and the "no history" message so an empty pane is not a collapsed one —
    // nothing in the plot's range.
    for (const m of pane.match(/h-\[(\d+)px\]/g) ?? []) {
      expect(Number(m.replace(/\D/g, ''))).toBeLessThan(100)
    }
  })
})

describe('every feed chart takes the standard, without being asked', () => {
  it('defaults to it, so a caller that forgets still gets it', () => {
    /**
     * The default matters more than the option. Before this, a new caller
     * inherited whatever vertical slack its card had — which is exactly how
     * the spread appeared without anyone deciding on it.
     */
    const { container } = render(
      <PriceContext symbol="AAPL" series={SERIES} now={NOW} />,
    )
    const box = plotBox(container)
    for (const cls of FEED_CHART_PLOT.split(' ')) {
      expect(box.className).toContain(cls)
    }
    expect(box.className).not.toContain('flex-1')
  })

  it('reaches the pair leg chart and the price pane through the same default', () => {
    // Neither passes `plot`, and that is the point: there is one height and
    // opting out is what has to be explicit.
    const pair = readFileSync(
      resolve(__dirname, '../../mobile/ideas/PairLegsPane.tsx'), 'utf8',
    )
    expect(pair).not.toContain('plot=')
    const pane = readFileSync(resolve(__dirname, '../PricePane.tsx'), 'utf8')
    expect(pane).not.toContain('plot=')
  })
})

describe('the fullscreen chart is exempt, explicitly', () => {
  it('asks to fill, and gets a different geometry', () => {
    const { container } = render(
      <PriceContext symbol="AAPL" series={SERIES} now={NOW} plot="fill" />,
    )
    const box = plotBox(container)
    for (const cls of FULLSCREEN_CHART_PLOT.split(' ')) {
      expect(box.className).toContain(cls)
    }
    expect(box.className).not.toContain('280px')
  })

  it('is the only caller that opts out', () => {
    /**
     * Expanding a chart is a request for more of it. The standard is about the
     * FEED, where a chart shares a card with a headline, a metric, a judgment
     * and a footer — none of which is on the overlay.
     */
    const fs = readFileSync(resolve(__dirname, '../FullscreenChart.tsx'), 'utf8')
    expect(fs).toContain('plot="fill"')
  })
})

describe('the standard is about charts, not about panes', () => {
  it('leaves the case pane on the full carousel workspace', () => {
    // §16/§18. The workspace correction is not being undone: a fact table with
    // the thesis rows, exposure and coverage must not be squeezed into a box
    // sized for a chart.
    const { container } = render(
      <CasePane
        present={['thesis', 'where_different', 'risks_to_thesis']}
        caseWrittenAt="2026-02-20T00:00:00.000Z"
        daysSinceWritten={192}
        held portfolioName="Vision Fund 10K" weightPct={4.1}
        coverageOwners={['John Homler']}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-full')
    expect(root.className).not.toContain('280px')
  })

  it('leaves the evidence pane on the full carousel workspace', () => {
    const { container } = render(
      <EvidencePane
        items={[{
          id: 'n1', at: '2026-08-01T00:00:00.000Z', kind: 'note',
          title: 'This company is on fire', authorName: 'Eric Lockenvitz',
          preview: 'Gross margin inflected two quarters early.',
        }]}
        reviewAnchor="2026-02-20T00:00:00.000Z"
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-full')
    expect(root.className).not.toContain('280px')
    expect(container.querySelector('ul')!.className).toContain('flex-1')
  })
})

describe('what the height change must not have touched', () => {
  const src = readFileSync(resolve(__dirname, '../PriceContext.tsx'), 'utf8')

  it('still draws the line, the wash and the gradient from one tone', () => {
    // The fill regression is a permanent hazard here: `currentColor` in a
    // `<stop>` resolves against the GRADIENT, not the shape. Three consumers,
    // one value.
    expect(src.match(/className=\{plotTone\}/g) ?? []).toHaveLength(3)
    expect(src).toMatch(/<linearGradient[^>]*className=\{plotTone\}/)
    expect(src).toContain('const gradientId = useId()')
  })

  it('renders the same plot for the same series at either height', () => {
    /**
     * Presentation only. The viewBox is fixed in chart units and the SVG is
     * stretched to whatever box it is in, so the path, the markers and the
     * numbers are identical — the only thing that changed is how many CSS
     * pixels one unit is worth.
     */
    const feed = render(<PriceContext symbol="AAPL" series={SERIES} now={NOW} />)
    const full = render(<PriceContext symbol="AAPL" series={SERIES} now={NOW} plot="fill" />)
    const path = (c: HTMLElement) =>
      c.querySelector('[data-testid="price-area"]')!.getAttribute('points')
    expect(path(feed.container)).toBe(path(full.container))
    const readout = (c: HTMLElement) =>
      c.querySelector('[data-testid="price-readout"]')!.textContent
    expect(readout(feed.container)).toBe(readout(full.container))
  })
})
