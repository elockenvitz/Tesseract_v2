/**
 * The Chart Setup panel's controls do what they say.
 *
 * The brief's words were "Do not ship stub buttons or decorative menus", so
 * these tests drive the real component with a real reducer and assert the
 * MODEL changed -- not that a handler was called, which is the assertion a
 * decorative button would also pass.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { useReducer, useState } from 'react'
import { ChartSetupPanel } from '../ChartSetupPanel'
import {
  initialPlots, plotReducer, type PanelPlots, type PlotAction,
} from '../../../../lib/charting/plot-model'

/** The panel wired to the real reducer, as the page wires it. */
function Harness({ onAddInstrument }: { onAddInstrument?: (id: string) => void }) {
  const [state, dispatch] = useReducer(
    (s: PanelPlots, a: PlotAction) => plotReducer(s, a),
    undefined,
    () => initialPlots('AAPL', 'asset-aapl', 'Apple Inc.'),
  )
  const [lastPlot, setLastPlot] = useState<string | null>(null)
  return (
    <div>
      <ChartSetupPanel
        state={state}
        dispatch={dispatch}
        onAddInstrument={id => { setLastPlot(id); onAddInstrument?.(id) }}
        onClose={() => {}}
      />
      {/* A read-out of the model, so assertions read state rather than pixels. */}
      <pre data-testid="model">{JSON.stringify({
        plots: state.plots.map(p => ({
          title: p.title, kind: p.kind, visible: p.visible,
          scaleMode: p.scaleMode, indexBase: p.indexBase,
          series: p.series.map(s => ({
            label: s.type === 'instrument' ? s.symbol : `${s.kind}:${s.period}`,
            visible: s.visible, color: s.color,
            displayType: s.type === 'instrument' ? s.displayType : undefined,
          })),
        })),
        lastPlot,
      })}</pre>
    </div>
  )
}

const model = () => JSON.parse(screen.getByTestId('model').textContent || '{}')

/*
 * Scoped to the TREE. The format section repeats the selected object's name
 * as its heading, so an unscoped `getByText('Plot 1')` matches twice and the
 * failure looks like a missing row rather than a second legitimate mention.
 */
const tree = () => document.querySelector('[data-charting-plot-tree]') as HTMLElement
const plotRow = (title: string) => within(tree()).getByText(title).closest('div')!
const seriesRow = (label: string) => within(tree()).getByText(label).closest('div')!

describe('the tree shows the arrangement', () => {
  it('lists the price and volume plots with the charted instrument under price', () => {
    render(<Harness />)
    expect(within(tree()).getByText('Price')).toBeTruthy()
    expect(within(tree()).getByText('Volume')).toBeTruthy()
    expect(within(tree()).getByText('AAPL')).toBeTruthy()
  })

  it('says an empty plot is empty rather than looking like a failed click', () => {
    render(<Harness />)
    expect(screen.getAllByText(/Empty/).length).toBeGreaterThan(0)
  })
})

describe('Add Plot', () => {
  it('adds a plot that persists with no series in it', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    const m = model()
    expect(m.plots).toHaveLength(3)
    expect(m.plots[2].series).toEqual([])
  })
})

describe('Add Indicator', () => {
  it('puts RSI on a study plot and it appears in the tree', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.click(within(plotRow('Plot 1')).getByTitle('Add study to this plot'))
    fireEvent.click(screen.getByText('RSI'))
    expect(model().plots[2].series).toEqual([
      expect.objectContaining({ label: 'rsi:14' }),
    ])
  })

  it('offers only price-compatible indicators on the price plot', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByTitle('Add study to this plot'))
    expect(screen.getByText('SMA')).toBeTruthy()
    /* RSI must not be offered where the model would refuse it: a button
       that is ignored is worse than one that is absent. */
    expect(screen.queryByText('RSI')).toBeNull()
  })

  it('overlays SMA on the price plot', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByTitle('Add study to this plot'))
    fireEvent.click(screen.getByText('SMA'))
    expect(model().plots[0].series).toContainEqual(
      expect.objectContaining({ label: 'sma:20' }),
    )
  })
})

describe('Add Series for a security', () => {
  it('asks the page to open instrument search, naming the plot', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByTitle('Add series to this plot'))
    fireEvent.click(screen.getByText('Search securities…'))
    expect(model().lastPlot).toBeTruthy()
  })

  /*
   * Add Series is the Compare dropdown's replacement, so it must exist
   * exactly where a comparison can go -- the price plot -- and nowhere a
   * second instrument would be nonsense.
   */
  it('does not offer Add Series on a study plot', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    expect(
      within(plotRow('Plot 1')).queryByTitle('Add series to this plot'),
    ).toBeNull()
  })

  it('offers Add Series on the price plot', () => {
    render(<Harness />)
    expect(
      within(plotRow('Price')).queryByTitle('Add series to this plot'),
    ).toBeTruthy()
  })
})

describe('hide and show', () => {
  it('hides a plot without removing it', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Volume')).getByTitle('Hide plot'))
    const m = model()
    expect(m.plots[1].visible).toBe(false)
    expect(m.plots).toHaveLength(2)
  })

  it('hides a series without removing it', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByTitle('Add study to this plot'))
    fireEvent.click(screen.getByText('SMA'))
    const smaRow = seriesRow('SMA 20')
    fireEvent.click(within(smaRow).getByTitle('Hide series'))
    expect(model().plots[0].series).toContainEqual(
      expect.objectContaining({ label: 'sma:20', visible: false }),
    )
  })
})

describe('remove', () => {
  it('removes a study plot', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.click(within(plotRow('Plot 1')).getByTitle('Remove plot'))
    expect(model().plots).toHaveLength(2)
  })

  it('offers NO remove control on the price plot', () => {
    render(<Harness />)
    expect(within(plotRow('Price')).queryByTitle('Remove plot')).toBeNull()
  })

  it('offers NO remove control on the charted instrument', () => {
    render(<Harness />)
    const row = seriesRow('AAPL')
    expect(within(row).queryByTitle('Remove series')).toBeNull()
  })
})

describe('rename and reorder', () => {
  it('renames a plot', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.click(within(plotRow('Plot 1')).getByTitle('Rename plot'))
    fireEvent.change(screen.getByLabelText('Plot name'), { target: { value: 'Momentum' } })
    fireEvent.click(screen.getByTitle('Save name'))
    expect(model().plots[2].title).toBe('Momentum')
  })

  it('reorders two study plots', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.click(within(plotRow('Plot 2')).getByTitle('Move plot up'))
    expect(model().plots.map((p: { title: string }) => p.title))
      .toEqual(['Price', 'Volume', 'Plot 2', 'Plot 1'])
  })

  it('offers no move control on the price plot', () => {
    render(<Harness />)
    expect(within(plotRow('Price')).queryByTitle('Move plot down')).toBeNull()
  })
})

describe('formatting the selected object', () => {
  it('changes a series colour', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByTitle('Add study to this plot'))
    fireEvent.click(screen.getByText('SMA'))
    const before = model().plots[0].series.at(-1).color
    fireEvent.click(screen.getByLabelText('Colour #7c3aed'))
    const after = model().plots[0].series.at(-1).color
    expect(after).toBe('#7c3aed')
    expect(after).not.toBe(before)
  })

  it('edits an indicator period and the label follows', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.click(within(plotRow('Plot 1')).getByTitle('Add study to this plot'))
    fireEvent.click(screen.getByText('RSI'))
    fireEvent.change(screen.getByLabelText(/Period/), { target: { value: '50' } })
    expect(model().plots[2].series[0].label).toBe('rsi:50')
    expect(within(tree()).getByText('RSI 50')).toBeTruthy()
  })

  it('offers no period box for MACD, which has three', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.click(within(plotRow('Plot 1')).getByTitle('Add study to this plot'))
    fireEvent.click(screen.getByText('MACD'))
    expect(screen.queryByLabelText(/Period/)).toBeNull()
    expect(screen.getByText(/fixed periods/)).toBeTruthy()
  })

  it('resizes a plot', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.change(screen.getByLabelText('Plot height'), { target: { value: '40' } })
    expect(screen.getByLabelText('Plot height')).toHaveProperty('value', '40')
  })
})

/*
 * These two groups cover the controls that were DELETED from the top bar.
 * If any of them fails, a toolbar button was removed without a working
 * replacement -- which is the specific regression this change risks.
 */
describe('the chart-type selector that replaced the toolbar buttons', () => {
  it('offers it on the primary series and changes the model', () => {
    render(<Harness />)
    fireEvent.click(within(tree()).getByText('AAPL'))
    fireEvent.click(screen.getByLabelText('Candlestick'))
    expect(model().plots[0].series[0].displayType).toBe('candlestick')
  })

  it('defaults to line when nothing has been chosen', () => {
    render(<Harness />)
    fireEvent.click(within(tree()).getByText('AAPL'))
    expect(screen.getByLabelText('Line').getAttribute('aria-pressed')).toBe('true')
  })

  /* A comparison is drawn as a line whatever is chosen, so offering the
     control on one would be offering a setting that is ignored. */
  it('does not offer it on an indicator series', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByTitle('Add study to this plot'))
    fireEvent.click(screen.getByText('SMA'))
    expect(screen.queryByLabelText('Candlestick')).toBeNull()
  })
})

describe('the scale mode that replaced the Compare submenu', () => {
  it('changes the price plot scale', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByText('Price'))
    fireEvent.click(screen.getByText('Index'))
    expect(model().plots[0].scaleMode).toBe('indexed')
  })

  it('reveals the index base only for indexed, and sets it', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByText('Price'))
    expect(screen.queryByLabelText(/Index base/)).toBeNull()
    fireEvent.click(screen.getByText('Index'))
    fireEvent.change(screen.getByLabelText(/Index base/), { target: { value: '1000' } })
    expect(model().plots[0].indexBase).toBe(1000)
  })

  /* A base of zero divides every point by nothing and draws an empty
     plot, so the reducer must refuse it rather than render nothing. */
  it('refuses a base of zero', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByText('Price'))
    fireEvent.click(screen.getByText('Index'))
    fireEvent.change(screen.getByLabelText(/Index base/), { target: { value: '0' } })
    expect(model().plots[0].indexBase).toBe(100)
  })

  it('is not offered on a study plot, whose scale its indicators decide', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Add plot'))
    fireEvent.click(within(plotRow('Plot 1')).getByText('Plot 1'))
    expect(screen.queryByText('% Chg')).toBeNull()
  })
})
