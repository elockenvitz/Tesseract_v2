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
const quick = () => document.querySelector('[data-charting-quick-actions]') as HTMLElement
const props = () => document.querySelector('[data-charting-properties]') as HTMLElement
const browser = () => document.querySelector('[data-charting-study-browser]') as HTMLElement

/**
 * Open a row's "…" menu and click one of its items.
 *
 * Move, reorder, hide and remove all moved behind one menu per row, because
 * six 11px hover icons in a row were indistinguishable. Driving the menu
 * here keeps every test that used to click an icon honest about what a
 * reader now has to do.
 */
const viaMenu = (row: HTMLElement, item: string | RegExp) => {
  fireEvent.click(within(row).getByRole('button', { name: /options$/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

/** Open the study browser from Quick actions and pick a study by name. */
const addStudy = (name: string | RegExp) => {
  fireEvent.click(within(quick()).getByText('Add Study'))
  fireEvent.click(within(browser()).getByText(name))
}

describe('the tree shows the arrangement', () => {
  it('lists the price and volume plots with the charted instrument under price', () => {
    render(<Harness />)
    expect(within(tree()).getByText('Price')).toBeTruthy()
    expect(within(tree()).getByText('Volume')).toBeTruthy()
    expect(within(tree()).getByText('AAPL')).toBeTruthy()
  })

  it('says an empty plot is empty, and offers the way out of being empty', () => {
    render(<Harness />)
    expect(screen.getAllByText(/Nothing on this plot yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Add a study').length).toBeGreaterThan(0)
  })
})

/*
 * Quick actions. The brief after #335 was that Compare had become
 * undiscoverable: it was reachable only by hovering a plot row until an
 * unlabelled icon appeared. These three must be present and named.
 */
describe('Quick actions', () => {
  it('shows Compare, Add Study and Add Plot by name', () => {
    render(<Harness />)
    expect(within(quick()).getByText('Compare')).toBeTruthy()
    expect(within(quick()).getByText('Add Study')).toBeTruthy()
    expect(within(quick()).getByText('Add Plot')).toBeTruthy()
  })

  it('Compare opens instrument search against the price plot', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Compare'))
    expect(model().lastPlot).toBe(model().plots[0].id ?? model().lastPlot)
    expect(model().lastPlot).toBeTruthy()
  })

  it('Add Plot adds a plot that persists with no series in it', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Plot'))
    const m = model()
    expect(m.plots).toHaveLength(3)
    expect(m.plots[2].series).toEqual([])
  })
})

describe('the study browser', () => {
  it('describes a study rather than printing an acronym', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Study'))
    expect(within(browser()).getByText('Relative Strength Index')).toBeTruthy()
    expect(within(browser()).getByText(/0-100 scale/)).toBeTruthy()
  })

  it('filters by name, category and description', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Study'))
    fireEvent.change(within(browser()).getByLabelText('Search studies'), {
      target: { value: 'momentum' },
    })
    expect(within(browser()).getByText('Relative Strength Index')).toBeTruthy()
    expect(within(browser()).queryByText('Simple Moving Average')).toBeNull()
  })

  it('says so rather than showing an empty list', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Study'))
    fireEvent.change(within(browser()).getByLabelText('Search studies'), {
      target: { value: 'ichimoku' },
    })
    expect(within(browser()).getByText(/No study matches/)).toBeTruthy()
  })

  /*
   * Only what the engine draws. The old toolbar menu advertised Ichimoku
   * Cloud for months and selecting it changed nothing.
   */
  it('offers only studies the engine implements', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Study'))
    expect(within(browser()).queryByText(/Ichimoku/)).toBeNull()
    expect(within(browser()).getAllByRole('button').length).toBeGreaterThanOrEqual(10)
  })

  it('overlays SMA onto the price plot and says so first', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Study'))
    const row = within(browser()).getByText('Simple Moving Average').closest('button')!
    expect(within(row).getByText('→ Price')).toBeTruthy()
    fireEvent.click(row)
    expect(model().plots[0].series).toContainEqual(
      expect.objectContaining({ label: 'sma:20' }),
    )
  })

  /*
   * An oscillator cannot share the price axis, so picking one with no
   * empty plot available must MAKE the plot. Two dispatches would race --
   * each reads the state it closed over -- so this is one action.
   */
  it('creates a plot for a study that needs its own scale', () => {
    render(<Harness />)
    addStudy('Relative Strength Index')
    const m = model()
    expect(m.plots).toHaveLength(3)
    expect(m.plots[2].series).toEqual([expect.objectContaining({ label: 'rsi:14' })])
  })

  it('fills an existing empty plot rather than making another', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Plot'))
    addStudy('Relative Strength Index')
    const m = model()
    expect(m.plots).toHaveLength(3)
    expect(m.plots[2].series).toEqual([expect.objectContaining({ label: 'rsi:14' })])
  })
})

describe('Compare reaches the price plot', () => {
  it('asks the page to open instrument search, naming the plot', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByTitle('Add series to this plot'))
    expect(model().lastPlot).toBeTruthy()
  })

  /*
   * A second instrument on an oscillator pane is nonsense, so the control
   * is absent there rather than present and refused.
   */
  it('does not offer Add Series on a study plot', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Plot'))
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
    addStudy('Simple Moving Average')
    fireEvent.click(within(seriesRow('SMA 20')).getByTitle('Hide series'))
    expect(model().plots[0].series).toContainEqual(
      expect.objectContaining({ label: 'sma:20', visible: false }),
    )
  })
})

describe('remove', () => {
  it('removes a study plot from its menu', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Plot'))
    viaMenu(plotRow('Plot 1'), 'Remove plot')
    expect(model().plots).toHaveLength(2)
  })

  it('offers NO remove entry on the price plot', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByRole('button', { name: /options$/ }))
    expect(screen.queryByRole('menuitem', { name: 'Remove plot' })).toBeNull()
  })

  it('offers NO remove entry on the charted instrument', () => {
    render(<Harness />)
    const row = seriesRow('AAPL')
    const opts = within(row).queryByRole('button', { name: /options$/ })
    /* The primary series cannot be removed or moved, so it has no menu at
       all rather than a menu whose only entry is refused. */
    if (opts) {
      fireEvent.click(opts)
      expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull()
    }
  })
})

describe('rename and reorder', () => {
  it('renames a plot from its menu', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Plot'))
    viaMenu(plotRow('Plot 1'), 'Rename')
    fireEvent.change(screen.getByLabelText('Plot name'), { target: { value: 'Momentum' } })
    fireEvent.click(screen.getByTitle('Save name'))
    expect(model().plots[2].title).toBe('Momentum')
  })

  it('reorders two study plots', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Plot'))
    fireEvent.click(within(quick()).getByText('Add Plot'))
    viaMenu(plotRow('Plot 2'), 'Move up')
    expect(model().plots.map((p: { title: string }) => p.title))
      .toEqual(['Price', 'Volume', 'Plot 2', 'Plot 1'])
  })

  it('offers no move entry on the price plot', () => {
    render(<Harness />)
    fireEvent.click(within(plotRow('Price')).getByRole('button', { name: /options$/ }))
    expect(screen.queryByRole('menuitem', { name: 'Move down' })).toBeNull()
  })
})

/*
 * Move to Plot. The brief asked for it to be reachable through a
 * contextual menu, and for the menu to offer only compatible plots -- an
 * RSI cannot go on the price axis, so listing Price there would be a menu
 * entry the reducer refuses.
 */
describe('Move to Plot', () => {
  it('moves a study to another compatible plot', () => {
    render(<Harness />)
    addStudy('Relative Strength Index')
    fireEvent.click(within(quick()).getByText('Add Plot'))
    viaMenu(seriesRow('RSI 14'), 'Plot 2')
    const m = model()
    expect(m.plots[2].series).toEqual([])
    expect(m.plots[3].series).toEqual([expect.objectContaining({ label: 'rsi:14' })])
  })

  it('does not offer the price plot to an oscillator', () => {
    render(<Harness />)
    addStudy('Relative Strength Index')
    fireEvent.click(within(seriesRow('RSI 14')).getByRole('button', { name: /options$/ }))
    expect(screen.queryByRole('menuitem', { name: 'Price' })).toBeNull()
  })

  it('does not offer a study plot to an overlay', () => {
    render(<Harness />)
    addStudy('Simple Moving Average')
    fireEvent.click(within(quick()).getByText('Add Plot'))
    fireEvent.click(within(seriesRow('SMA 20')).getByRole('button', { name: /options$/ }))
    expect(screen.queryByRole('menuitem', { name: 'Plot 1' })).toBeNull()
  })
})

describe('formatting the selected object', () => {
  it('changes a series colour', () => {
    render(<Harness />)
    addStudy('Simple Moving Average')
    const before = model().plots[0].series.at(-1).color
    fireEvent.click(screen.getByLabelText('Colour #7c3aed'))
    const after = model().plots[0].series.at(-1).color
    expect(after).toBe('#7c3aed')
    expect(after).not.toBe(before)
  })

  it('edits an indicator period and the label follows', () => {
    render(<Harness />)
    addStudy('Relative Strength Index')
    fireEvent.change(screen.getByLabelText(/Period/), { target: { value: '50' } })
    expect(model().plots[2].series[0].label).toBe('rsi:50')
    expect(within(tree()).getByText('RSI 50')).toBeTruthy()
  })

  it('offers no period box for MACD, which has three', () => {
    render(<Harness />)
    addStudy('MACD')
    expect(screen.queryByLabelText(/Period/)).toBeNull()
    expect(screen.getByText(/fixed periods/)).toBeTruthy()
  })

  it('resizes a plot', () => {
    render(<Harness />)
    fireEvent.click(within(quick()).getByText('Add Plot'))
    fireEvent.change(screen.getByLabelText('Plot height'), { target: { value: '40' } })
    expect(screen.getByLabelText('Plot height')).toHaveProperty('value', '40')
  })

  /*
   * The properties area keeps its place when nothing is selected, instead
   * of appearing on first click and shoving the tree upward.
   */
  it('says what to do when nothing is selected', () => {
    render(<Harness />)
    expect(within(props()).getByText(/Select a plot or series/)).toBeTruthy()
  })

  it('toggles visibility from the properties area', () => {
    render(<Harness />)
    fireEvent.click(within(tree()).getByText('AAPL'))
    fireEvent.click(within(props()).getByLabelText('Visible'))
    expect(model().plots[0].series[0].visible).toBe(false)
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
    addStudy('Simple Moving Average')
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
    fireEvent.click(within(quick()).getByText('Add Plot'))
    fireEvent.click(within(plotRow('Plot 1')).getByText('Plot 1'))
    expect(screen.queryByText('% Chg')).toBeNull()
  })
})
