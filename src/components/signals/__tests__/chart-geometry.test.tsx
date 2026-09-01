import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'

import { PriceContext } from '../PriceContext'
import { CasePane } from '../CasePane'
import { EvidencePane } from '../EvidencePane'
import {
  FEED_CHART_BANDS, FEED_CHART_PLOT, FULLSCREEN_CHART_PLOT, feedChartPlotPx,
} from '../../../lib/signals/chart-geometry'

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
  it('chooses the height from the viewport and nothing else', () => {
    /**
     * The height used to be a CEILING - `min(280px, 34svh)` - over a box that
     * could still shrink. On a tall screen the ceiling bound and every family
     * agreed; on a short one it did not, and the box shrank to whatever the
     * carousel workspace had left, which is `card - header - description -
     * footer`. The header is family-specific, so the chart was too: measured
     * on the real card shells at 400px wide, No Core Thesis carries 105px of
     * header and Case vs Price carries 213, and the diagnostic showed every
     * pixel added to a header taking exactly one pixel off the plot.
     *
     * A ceiling plus shrink is not one rule, it is a rule and an override. The
     * height is now stated outright, per viewport band, before flex
     * distributes anything.
     */
    expect(FEED_CHART_PLOT).toContain('h-[128px]')
    expect(FEED_CHART_PLOT).toContain('[@media(min-height:700px)]:h-[160px]')
    expect(FEED_CHART_PLOT).toContain('[@media(min-height:800px)]:h-[208px]')
    // The ceiling, and the unit that made it one, both gone.
    expect(FEED_CHART_PLOT).not.toContain('max-h-')
    expect(FEED_CHART_PLOT).not.toContain('svh')
    expect(FEED_CHART_PLOT).not.toContain('min(')
  })

  it('resolves each band the way the class does', () => {
    // The table and the class say the same thing, so a test can check a
    // rendered height against the rule rather than against a retyped number.
    expect(feedChartPlotPx(844)).toBe(208)
    expect(feedChartPlotPx(800)).toBe(208)
    expect(feedChartPlotPx(799)).toBe(160)
    expect(feedChartPlotPx(700)).toBe(160)
    expect(feedChartPlotPx(667)).toBe(128)
    expect(feedChartPlotPx(640)).toBe(128)
    for (const band of FEED_CHART_BANDS) {
      expect(FEED_CHART_PLOT).toContain('h-[' + band.plotPx + 'px]')
    }
  })

  it('sizes every band under the HEAVIEST family, not the lightest', () => {
    /**
     * The invariant that keeps the families equal: if one legitimate family
     * cannot fit the standard, the standard comes down for all of them rather
     * than that one shrinking alone.
     *
     * `needsCardPx` is the card height each band requires, measured on the
     * real shells - a Case vs Price card's room for a plot is `card - 450`.
     */
    for (const band of FEED_CHART_BANDS) {
      expect(band.needsCardPx - 450).toBe(band.plotPx)
      // And the band leaves room for the app chrome above the feed.
      if (band.minViewportHeight > 0) {
        expect(band.minViewportHeight - band.needsCardPx).toBeGreaterThanOrEqual(42)
      }
    }
  })

  it('keeps shrink as an emergency, not as the normalizer', () => {
    /**
     * Shrink is what USED to make the chart fit, and making it fit is exactly
     * how it became family-dependent. It stays for a viewport nobody has
     * tested, where clipping the pager would be worse than a smaller chart -
     * at every supported size the band is already under the heaviest family's
     * budget, so it never engages.
     */
    expect(FEED_CHART_PLOT).toContain('shrink')
    expect(FEED_CHART_PLOT).toContain('min-h-0')
    // Spare height in the pane belongs to the composition around the chart.
    expect(FEED_CHART_PLOT).toContain('grow-0')
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
    expect(box.getAttribute('data-plot-geometry')).toBe('feed')
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

describe('the price block composes inside its pane, as one unit', () => {
  /**
   * ── The gulf this closes ────────────────────────────────────────────────
   *
   * The plot has a fixed height per viewport band now, and the carousel
   * workspace still varies with header weight — so a light-header family has
   * surplus room in its Price pane and a heavy-header one has almost none.
   * Top-aligned, all of that surplus collected after the last child. Measured
   * at 400x700 on a 652px card: No Core Thesis had 0px above the block and
   * 151px below it, Case vs Price had 0 and 40. Same pane, two compositions,
   * for a reason invisible to the reader.
   */
  it('centres the whole block rather than stranding it at the top', () => {
    const { container } = render(
      <PriceContext symbol="AAPL" series={SERIES} now={NOW} />,
    )
    const root = container.querySelector('[data-testid="price-context"]')!
    expect(root.className).toContain('[justify-content:safe_center]')
  })

  it('centres SAFELY, so a pane with no room keeps the read-out', () => {
    /**
     * Plain centring clips both ends, and the top end is the price and the
     * range controls. `safe` falls back to start, so a pane too short for its
     * block loses the x-axis rather than the readout — the same reason
     * `HorizonTimeline`, `ResearchStarter` and `ScenarioRespond` use it.
     */
    const { container } = render(
      <PriceContext symbol="AAPL" series={SERIES} now={NOW} />,
    )
    const root = container.querySelector('[data-testid="price-context"]')!
    expect(root.className).not.toMatch(/\bjustify-center\b/)
    expect(root.className).toContain('safe_center')
    expect(root.className).toContain('overflow-hidden')
  })

  it('moves the read-out, the ranges and the plot together', () => {
    // One control. Centring the pieces separately is how a chart stops looking
    // attached to the card that owns it.
    const { container } = render(
      <PriceContext symbol="AAPL" series={SERIES} now={NOW} />,
    )
    const root = container.querySelector('[data-testid="price-context"]')!
    const box = plotBox(container)
    expect(box.parentElement).toBe(root)
    for (const kid of Array.from(root.children)) {
      expect(kid.className).not.toContain('justify-content')
    }
  })

  it('keeps the surplus inside the pane, not in the card column', () => {
    /**
     * A spacer sibling out in the card column would be a second claimant on
     * the workspace's free space — the exact bug 947a97c removed, where the
     * body gap and the carousel band split it and every pane was compressed.
     * The carousel workspace stays the one flexible region out there.
     */
    const shell = readFileSync(resolve(__dirname, '../SignalCardView.tsx'), 'utf8')
    expect(shell.match(/data-slot="body-spacer"/g) ?? []).toHaveLength(1)
    expect(shell).toContain('data-slot="body-spacer" className="h-3.5 shrink-0 grow"')
  })

  it('says nothing about which card it is on', () => {
    // §7. The composition is the standard one; no family, framing or symbol
    // may reach it.
    const src = readFileSync(resolve(__dirname, '../PriceContext.tsx'), 'utf8')
    for (const word of ['no_case', 'framing', 'signalType', 'scenario_gap']) {
      expect(src).not.toContain(word)
    }
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
    expect(box.className).not.toContain('h-[208px]')
    // And says so in the DOM, so a chart of the wrong height can be diagnosed
    // from a dump rather than from reading call sites.
    expect(box.getAttribute('data-plot-geometry')).toBe('fill')
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
    expect(root.className).not.toContain('h-[160px]')
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
    expect(root.className).not.toContain('h-[160px]')
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
