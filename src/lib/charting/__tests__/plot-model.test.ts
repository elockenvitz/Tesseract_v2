/**
 * The plot model's rules.
 *
 * These are mostly REFUSALS, and the refusals are the point. A model that
 * lets any series go on any plot produces charts that are drawn correctly
 * and mean nothing -- RSI's 0-100 against a 350-dollar axis is a flat line
 * along the bottom that looks like an indicator reading zero.
 *
 * So each test below names the thing a reader would be told if the rule
 * were missing, not the branch it covers.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  initialPlots, migrateToPlots, plotReducer, pricePlot, findPlot, findSeries,
  derivePlotSpecs, deriveOverlays, deriveComparisons, volumeVisible,
  seriesLabel, nextColor, SERIES_COLORS, __resetIdCounter,
  deriveDisplayType, deriveScaleMode, deriveIndexBase,
  type PanelPlots,
} from '../plot-model'

let state: PanelPlots
beforeEach(() => {
  __resetIdCounter()
  state = initialPlots('AAPL', 'asset-aapl', 'Apple Inc.')
})

const priceId = (s: PanelPlots) => pricePlot(s)!.id
const volumeId = (s: PanelPlots) => s.plots.find(p => p.kind === 'volume')!.id

describe('what an analyst starts with', () => {
  it('opens on a price plot and a volume plot', () => {
    expect(state.plots.map(p => p.kind)).toEqual(['price', 'volume'])
  })

  it('puts the charted instrument on the price plot as the primary series', () => {
    const s = pricePlot(state)!.series[0]
    expect(s.type).toBe('instrument')
    expect(s.type === 'instrument' && s.primary).toBe(true)
    expect(s.type === 'instrument' && s.symbol).toBe('AAPL')
  })
})

describe('Add Plot means a plot, not an indicator', () => {
  it('creates an EMPTY plot that persists with nothing in it', () => {
    /* If a plot could only exist by adding an indicator, "Add Plot" would
       be a second spelling of "Add Indicator" and the brief's tree would
       be undrawable. */
    const next = plotReducer(state, { type: 'addPlot' })
    const added = next.plots[next.plots.length - 1]
    expect(added.series).toEqual([])
    expect(next.plots).toHaveLength(3)
    expect(derivePlotSpecs(next).some(p => p.id === added.id)).toBe(true)
  })

  it('selects the new plot so the next action has a target', () => {
    const next = plotReducer(state, { type: 'addPlot' })
    expect(next.selectedId).toBe(next.plots[next.plots.length - 1].id)
  })

  it('can then receive an indicator', () => {
    let s = plotReducer(state, { type: 'addPlot' })
    const id = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'addIndicator', plotId: id, kind: 'rsi' })
    expect(findPlot(s, id)!.series).toHaveLength(1)
    expect(seriesLabel(findPlot(s, id)!.series[0])).toBe('RSI 14')
  })
})

describe('the price plot cannot be taken away', () => {
  it('refuses to remove it', () => {
    const next = plotReducer(state, { type: 'removePlot', plotId: priceId(state) })
    expect(pricePlot(next)).toBeDefined()
    expect(next.plots).toHaveLength(2)
  })

  it('refuses to reorder it below a study', () => {
    const withPlot = plotReducer(state, { type: 'addPlot' })
    const next = plotReducer(withPlot, { type: 'movePlot', plotId: priceId(withPlot), direction: 'down' })
    expect(next.plots[0].kind).toBe('price')
  })

  it('refuses to remove the primary instrument series', () => {
    const primary = pricePlot(state)!.series[0]
    const next = plotReducer(state, { type: 'removeSeries', seriesId: primary.id })
    expect(findSeries(next, primary.id)).toBeDefined()
  })
})

describe('a series goes where its units can be read', () => {
  it('refuses RSI on the price plot', () => {
    /* 0-100 against a 350-dollar axis draws a flat line on the floor. */
    const next = plotReducer(state, { type: 'addIndicator', plotId: priceId(state), kind: 'rsi' })
    expect(pricePlot(next)!.series).toHaveLength(1)
  })

  it('refuses SMA on a study plot', () => {
    let s = plotReducer(state, { type: 'addPlot' })
    const id = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'addIndicator', plotId: id, kind: 'sma' })
    expect(findPlot(s, id)!.series).toEqual([])
  })

  it('accepts SMA on the price plot', () => {
    const next = plotReducer(state, { type: 'addIndicator', plotId: priceId(state), kind: 'sma' })
    expect(deriveOverlays(next).map(s => s.kind)).toEqual(['sma'])
  })

  it('refuses a comparison instrument on a study plot', () => {
    let s = plotReducer(state, { type: 'addPlot' })
    const id = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'addInstrument', plotId: id, symbol: 'MSFT', assetId: 'a', companyName: 'Microsoft' })
    expect(findPlot(s, id)!.series).toEqual([])
  })

  it('does not let a MOVE smuggle a series past the same rule', () => {
    /* A move is an add and a remove. If the add refuses it, so must this. */
    let s = plotReducer(state, { type: 'addIndicator', plotId: priceId(state), kind: 'sma' })
    const sma = pricePlot(s)!.series.find(x => x.type === 'indicator')!
    s = plotReducer(s, { type: 'addPlot' })
    const studyId = s.plots[s.plots.length - 1].id
    const moved = plotReducer(s, { type: 'moveSeries', seriesId: sma.id, toPlotId: studyId })
    expect(findSeries(moved, sma.id)!.plot.kind).toBe('price')
  })
})

describe('comparison series', () => {
  it('adds a second instrument to the price plot', () => {
    const next = plotReducer(state, { type: 'addInstrument', plotId: priceId(state), symbol: 'MSFT', assetId: 'a-msft', companyName: 'Microsoft' })
    expect(deriveComparisons(next).map(s => s.symbol)).toEqual(['MSFT'])
  })

  it('does not add the same instrument twice', () => {
    let s = plotReducer(state, { type: 'addInstrument', plotId: priceId(state), symbol: 'MSFT', assetId: 'a', companyName: 'M' })
    s = plotReducer(s, { type: 'addInstrument', plotId: priceId(s), symbol: 'msft', assetId: 'a', companyName: 'M' })
    expect(deriveComparisons(s)).toHaveLength(1)
  })

  it('gives each series on a plot a different colour', () => {
    let s = plotReducer(state, { type: 'addInstrument', plotId: priceId(state), symbol: 'MSFT', assetId: 'a', companyName: 'M' })
    s = plotReducer(s, { type: 'addInstrument', plotId: priceId(s), symbol: 'SPY', assetId: 'b', companyName: 'S' })
    const colors = pricePlot(s)!.series.map(x => x.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('excludes the primary instrument from the comparison list', () => {
    expect(deriveComparisons(state)).toEqual([])
  })
})

describe('changing the charted instrument keeps the arrangement', () => {
  it('moves the primary series without discarding comparisons or plots', () => {
    let s = plotReducer(state, { type: 'addInstrument', plotId: priceId(state), symbol: 'MSFT', assetId: 'a', companyName: 'M' })
    s = plotReducer(s, { type: 'addPlot' })
    s = plotReducer(s, { type: 'setPrimarySymbol', symbol: 'NVDA', assetId: 'a-nvda', companyName: 'NVIDIA' })
    const primary = pricePlot(s)!.series.find(x => x.type === 'instrument' && x.primary)!
    expect(primary.type === 'instrument' && primary.symbol).toBe('NVDA')
    expect(deriveComparisons(s).map(x => x.symbol)).toEqual(['MSFT'])
    expect(s.plots).toHaveLength(3)
  })
})

describe('hide and show', () => {
  it('keeps a hidden series in the tree but out of the render', () => {
    let s = plotReducer(state, { type: 'addIndicator', plotId: priceId(state), kind: 'sma' })
    const sma = deriveOverlays(s)[0]
    s = plotReducer(s, { type: 'toggleSeries', seriesId: sma.id })
    expect(findSeries(s, sma.id)).toBeDefined()
    expect(deriveOverlays(s)).toEqual([])
  })

  it('keeps a hidden plot in the tree but out of the render', () => {
    let s = plotReducer(state, { type: 'addPlot' })
    const id = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'togglePlot', plotId: id })
    expect(findPlot(s, id)).toBeDefined()
    expect(derivePlotSpecs(s).some(p => p.id === id)).toBe(false)
  })

  it('reports volume hidden when its plot is hidden', () => {
    expect(volumeVisible(state)).toBe(true)
    const s = plotReducer(state, { type: 'togglePlot', plotId: volumeId(state) })
    expect(volumeVisible(s)).toBe(false)
  })
})

describe('indicator parameters', () => {
  it('edits the period and the label follows it', () => {
    let s = plotReducer(state, { type: 'addPlot' })
    const id = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'addIndicator', plotId: id, kind: 'rsi' })
    const rsi = findPlot(s, id)!.series[0]
    s = plotReducer(s, { type: 'setIndicatorPeriod', seriesId: rsi.id, period: 50 })
    expect(seriesLabel(findSeries(s, rsi.id)!.series)).toBe('RSI 50')
  })

  it('refuses a period that would produce no output', () => {
    let s = plotReducer(state, { type: 'addPlot' })
    const id = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'addIndicator', plotId: id, kind: 'rsi' })
    const rsi = findPlot(s, id)!.series[0]
    for (const bad of [0, -5, 1e6, NaN]) {
      const next = plotReducer(s, { type: 'setIndicatorPeriod', seriesId: rsi.id, period: bad })
      expect(findSeries(next, rsi.id)!.series).toMatchObject({ period: 14 })
    }
  })

  it('allows two of the same indicator at different periods', () => {
    /* One is the question, the other is the control. The old flat
       `IndicatorType[]` could not express this at all. */
    let s = plotReducer(state, { type: 'addPlot' })
    const id = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'addIndicator', plotId: id, kind: 'rsi' })
    s = plotReducer(s, { type: 'addIndicator', plotId: id, kind: 'rsi' })
    const [a, b] = findPlot(s, id)!.series
    s = plotReducer(s, { type: 'setIndicatorPeriod', seriesId: b.id, period: 50 })
    expect(findPlot(s, id)!.series.map(x => seriesLabel(x))).toEqual(['RSI 14', 'RSI 50'])
    expect(a.id).not.toBe(b.id)
  })

  it('leaves MACD alone, which has three periods and not one', () => {
    let s = plotReducer(state, { type: 'addPlot' })
    const id = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'addIndicator', plotId: id, kind: 'macd' })
    const macd = findPlot(s, id)!.series[0]
    const next = plotReducer(s, { type: 'setIndicatorPeriod', seriesId: macd.id, period: 30 })
    expect(findSeries(next, macd.id)!.series).toMatchObject({ period: null })
    expect(seriesLabel(findSeries(next, macd.id)!.series)).toBe('MACD (12, 26, 9)')
  })
})

describe('reorder and resize', () => {
  it('swaps two study plots', () => {
    let s = plotReducer(state, { type: 'addPlot', title: 'A' })
    s = plotReducer(s, { type: 'addPlot', title: 'B' })
    const b = s.plots[s.plots.length - 1].id
    s = plotReducer(s, { type: 'movePlot', plotId: b, direction: 'up' })
    expect(s.plots.map(p => p.title)).toEqual(['Price', 'Volume', 'B', 'A'])
  })

  it('clamps a resize instead of letting a plot vanish or take the panel', () => {
    const id = volumeId(state)
    expect(findPlot(plotReducer(state, { type: 'resizePlot', plotId: id, heightRatio: 0 }), id)!.heightRatio)
      .toBeGreaterThan(0)
    expect(findPlot(plotReducer(state, { type: 'resizePlot', plotId: id, heightRatio: 5 }), id)!.heightRatio)
      .toBeLessThanOrEqual(0.85)
  })
})

describe('carrying an existing chart into the model', () => {
  /* The path every current user takes the first time they open the panel.
     Losing their chart here would be the worst possible first impression
     of the feature. */
  const legacy = {
    indicators: ['volume', 'sma', 'rsi', 'macd'],
    compareSymbols: [{ symbol: 'MSFT', companyName: 'Microsoft', color: '#dc2626' }],
  }

  it('keeps the overlay on the price plot', () => {
    const s = migrateToPlots('AAPL', 'a', 'Apple Inc.', legacy)
    expect(deriveOverlays(s).map(x => x.kind)).toEqual(['sma'])
  })

  it('keeps the comparison instrument and its colour', () => {
    const s = migrateToPlots('AAPL', 'a', 'Apple Inc.', legacy)
    expect(deriveComparisons(s).map(x => ({ symbol: x.symbol, color: x.color })))
      .toEqual([{ symbol: 'MSFT', color: '#dc2626' }])
  })

  it('gives each study its own plot, as it looked before', () => {
    const s = migrateToPlots('AAPL', 'a', 'Apple Inc.', legacy)
    const specs = derivePlotSpecs(s).filter(p => p.kind === 'study')
    expect(specs.map(p => p.indicators.map(i => i.kind))).toEqual([['rsi'], ['macd']])
  })

  it('treats volume as the volume PLOT, not a series', () => {
    const s = migrateToPlots('AAPL', 'a', 'Apple Inc.', legacy)
    expect(volumeVisible(s)).toBe(true)
    expect(s.plots.find(p => p.kind === 'volume')!.series).toEqual([])
  })

  it('hides the volume plot when volume was not on', () => {
    const s = migrateToPlots('AAPL', 'a', 'Apple Inc.', { indicators: ['sma'] })
    expect(volumeVisible(s)).toBe(false)
  })

  it('drops a name it does not recognise instead of guessing', () => {
    const s = migrateToPlots('AAPL', 'a', 'Apple Inc.', { indicators: ['sma', 'nonsense'] })
    expect(deriveOverlays(s)).toHaveLength(1)
    expect(derivePlotSpecs(s).filter(p => p.kind === 'study')).toHaveLength(0)
  })

  it('still produces a usable chart from nothing at all', () => {
    const s = migrateToPlots('AAPL', 'a', 'Apple Inc.', {})
    expect(pricePlot(s)).toBeDefined()
    expect(pricePlot(s)!.series).toHaveLength(1)
  })
})

describe('colour assignment', () => {
  it('reuses a freed colour rather than drifting', () => {
    expect(nextColor([])).toBe(SERIES_COLORS[0])
    expect(nextColor([SERIES_COLORS[0]])).toBe(SERIES_COLORS[1])
    expect(nextColor([SERIES_COLORS[1]])).toBe(SERIES_COLORS[0])
  })
})

/*
 * Display type and scale mode moved here OUT of the top toolbar. The
 * renderer still takes them as flat props, so these derivations are the
 * seam -- if one returns the wrong thing the control looks dead.
 */
describe('display type, now a property of the primary series', () => {
  it('defaults to line', () => {
    expect(deriveDisplayType(state)).toBe('line')
  })

  it('follows the primary series', () => {
    const primary = pricePlot(state)!.series[0]
    const next = plotReducer(state, {
      type: 'setSeriesDisplayType', seriesId: primary.id, displayType: 'candlestick',
    })
    expect(deriveDisplayType(next)).toBe('candlestick')
  })

  /*
   * A comparison is always drawn as a line, so setting a type on one must
   * not change how the PRIMARY instrument is drawn.
   *
   * The comparison is put FIRST in the array deliberately. Appended after
   * the primary, a derivation that simply takes the first instrument it
   * finds still returns the right answer, and this test passes while the
   * rule it names is absent.
   */
  it('reads the primary, not merely the first instrument', () => {
    const priceId = pricePlot(state)!.id
    let next = plotReducer(state, {
      type: 'addInstrument', plotId: priceId,
      symbol: 'MSFT', assetId: 'a2', companyName: 'Microsoft',
    })
    const compare = pricePlot(next)!.series.find(s => s.type === 'instrument' && !s.primary)!
    next = plotReducer(next, {
      type: 'setSeriesDisplayType', seriesId: compare.id, displayType: 'bar',
    })
    const primary = pricePlot(next)!.series.find(s => s.type === 'instrument' && s.primary)!
    next = plotReducer(next, {
      type: 'setSeriesDisplayType', seriesId: primary.id, displayType: 'candlestick',
    })

    /* Reorder so the comparison sits ahead of the primary. */
    next = {
      ...next,
      plots: next.plots.map(p => p.id === priceId
        ? { ...p, series: [...p.series].reverse() }
        : p),
    }
    expect(pricePlot(next)!.series[0].id).toBe(compare.id)
    expect(deriveDisplayType(next)).toBe('candlestick')
  })
})

describe('scale mode, now a property of the price plot', () => {
  it('defaults to absolute at 100', () => {
    expect(deriveScaleMode(state)).toBe('absolute')
    expect(deriveIndexBase(state)).toBe(100)
  })

  it('follows the price plot', () => {
    const next = plotReducer(state, {
      type: 'setPlotScaleMode', plotId: pricePlot(state)!.id, scaleMode: 'relative',
    })
    expect(deriveScaleMode(next)).toBe('relative')
  })

  /* A study plot's scale is decided by its indicators' own units -- RSI is
     0-100 whatever an analyst picks -- so the action must not take. */
  it('refuses a scale mode on a study plot', () => {
    let next = plotReducer(state, { type: 'addPlot' })
    const studyId = next.plots.at(-1)!.id
    next = plotReducer(next, {
      type: 'setPlotScaleMode', plotId: studyId, scaleMode: 'indexed',
    })
    expect(findPlot(next, studyId)!.scaleMode).toBeUndefined()
  })

  it('accepts a positive index base', () => {
    const next = plotReducer(state, {
      type: 'setPlotIndexBase', plotId: pricePlot(state)!.id, indexBase: 1000,
    })
    expect(deriveIndexBase(next)).toBe(1000)
  })

  /* Zero divides every point by nothing and draws an empty plot; a
     negative base inverts every series without saying so. */
  it.each([0, -50, Number.NaN])('refuses a base of %s', base => {
    const next = plotReducer(state, {
      type: 'setPlotIndexBase', plotId: pricePlot(state)!.id, indexBase: base,
    })
    expect(deriveIndexBase(next)).toBe(100)
  })
})

/*
 * The volume plot is non-price AND carries no series of its own -- volume
 * is drawn from the bars themselves. Every compatibility check that asked
 * "is this plot not the price plot?" therefore treated it as free space
 * for an oscillator, which would never have been drawn.
 */
describe('the volume plot is not a study plot', () => {
  const volumeId = () => state.plots.find(p => p.kind === 'volume')!.id

  it('refuses a study added to it', () => {
    const next = plotReducer(state, { type: 'addIndicator', plotId: volumeId(), kind: 'rsi' })
    expect(findPlot(next, volumeId())!.series).toEqual([])
  })

  it('refuses a study moved into it', () => {
    let next = plotReducer(state, { type: 'addStudyPlot', kind: 'rsi' })
    const rsi = next.plots.at(-1)!.series[0]
    next = plotReducer(next, { type: 'moveSeries', seriesId: rsi.id, toPlotId: volumeId() })
    expect(findPlot(next, volumeId())!.series).toEqual([])
    expect(next.plots.at(-1)!.series).toHaveLength(1)
  })
})

describe('addStudyPlot arrives atomically', () => {
  it('creates the plot and the study in one action', () => {
    const next = plotReducer(state, { type: 'addStudyPlot', kind: 'rsi' })
    expect(next.plots).toHaveLength(3)
    expect(next.plots[2].series).toHaveLength(1)
    expect(seriesLabel(next.plots[2].series[0])).toBe('RSI 14')
  })

  /* An overlay belongs on the price plot; giving it a pane would be a
     different chart, so the action refuses rather than guessing. */
  it('refuses an overlay, which has a plot already', () => {
    const next = plotReducer(state, { type: 'addStudyPlot', kind: 'sma' })
    expect(next.plots).toHaveLength(2)
  })
})

describe('migration carries the toolbar settings it replaced', () => {
  it('keeps candles, indexed scale and a custom base', () => {
    const migrated = migrateToPlots('AAPL', 'a1', 'Apple', {
      indicators: [], compareSymbols: [],
      chartType: 'candlestick', displayMode: 'indexed', indexBase: 50,
    })
    expect(deriveDisplayType(migrated)).toBe('candlestick')
    expect(deriveScaleMode(migrated)).toBe('indexed')
    expect(deriveIndexBase(migrated)).toBe(50)
  })

  /* A stored workspace can carry anything. An unknown value must fall back
     rather than reach the renderer as a chart type it cannot draw. */
  it('falls back on an unrecognised stored value', () => {
    const migrated = migrateToPlots('AAPL', 'a1', 'Apple', {
      indicators: [], compareSymbols: [],
      chartType: 'heikin-ashi', displayMode: 'log', indexBase: 0,
    })
    expect(deriveDisplayType(migrated)).toBe('line')
    expect(deriveScaleMode(migrated)).toBe('absolute')
    expect(deriveIndexBase(migrated)).toBe(100)
  })
})
