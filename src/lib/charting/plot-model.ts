/**
 * What is on the chart, as data rather than as a set of toggles.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The chart used to be described by `indicators: IndicatorType[]` -- a flat
 * list of names. Everything else was INFERRED from those names at render
 * time: `sma` meant "draw on the price plot", `rsi` meant "make a pane",
 * and the pane's title, range and height were decided by a switch statement
 * in the renderer.
 *
 * That model cannot express most of what an analyst wants to say:
 *
 *   - an empty plot, created deliberately, waiting to be filled
 *   - two RSIs at different periods, because one is the question and the
 *     other is the control
 *   - RSI and MACD in the SAME pane, or in a different order than the one
 *     the switch statement happens to run in
 *   - a series hidden for a moment rather than deleted
 *   - a period of 50 instead of the hardcoded 14
 *
 * None of those are exotic. They were all unreachable because the names
 * were the model. So the model is now the model: a panel owns ordered
 * plots, a plot owns ordered series, and the renderer is told what to draw
 * instead of working it out.
 *
 * ── The invariant that matters ───────────────────────────────────────────
 *
 * The PRICE plot is not deletable and there is exactly one of it. Every
 * other plot derives its time axis from the price series, the drawings are
 * anchored in price coordinates, and the instrument header describes it. A
 * chart without it is not a chart with one fewer plot; it is a blank panel
 * that still claims to be showing AAPL. `removePlot` refuses it, and a test
 * holds that refusal.
 */

export type IndicatorKind =
  | 'sma' | 'ema' | 'bollinger' | 'vwap'
  | 'rsi' | 'macd' | 'stochastic' | 'atr' | 'obv' | 'adx'

/** Indicators that belong ON the price scale, drawn over the bars. */
export const OVERLAY_INDICATORS: readonly IndicatorKind[] = ['sma', 'ema', 'bollinger', 'vwap']

/** Indicators with their own units, which need a plot of their own. */
export const STUDY_INDICATORS: readonly IndicatorKind[] = ['rsi', 'macd', 'stochastic', 'atr', 'obv', 'adx']

export function isOverlay(kind: IndicatorKind): boolean {
  return OVERLAY_INDICATORS.includes(kind)
}

/**
 * The period each indicator is born with, and whether it HAS one.
 *
 * `macd` carries three and `bollinger` two, so a single `period` would be a
 * lie for both. They are listed with `period: null` and edited through
 * their own fields rather than pretending to a single number.
 */
/**
 * What each study IS, for the browser that offers them.
 *
 * Every entry here is a study the engine actually draws. The catalogue is
 * derived from `IndicatorKind`, so a study cannot be advertised without a
 * renderer behind it -- the old toolbar menu listed Ichimoku Cloud for
 * months and selecting it ticked a bullet and changed nothing.
 *
 * `category` groups them for scanning; `blurb` says what the study is for
 * in one line, because "ADX" tells a reader nothing they did not know.
 */
export interface StudyInfo {
  kind: IndicatorKind
  name: string
  category: 'Trend' | 'Momentum' | 'Volatility' | 'Volume'
  blurb: string
  /** Where the model will let it go. Shown so placement is never a surprise. */
  placement: 'price' | 'own'
}

export const STUDY_CATALOG: readonly StudyInfo[] = [
  { kind: 'sma', name: 'Simple Moving Average', category: 'Trend', placement: 'price',
    blurb: 'Average close over N bars. The plainest trend line.' },
  { kind: 'ema', name: 'Exponential Moving Average', category: 'Trend', placement: 'price',
    blurb: 'Weighted to recent bars, so it turns sooner than an SMA.' },
  { kind: 'bollinger', name: 'Bollinger Bands', category: 'Volatility', placement: 'price',
    blurb: 'Two standard deviations either side of a moving average.' },
  { kind: 'vwap', name: 'VWAP', category: 'Volume', placement: 'price',
    blurb: 'Volume-weighted average price. A common execution benchmark.' },
  { kind: 'rsi', name: 'Relative Strength Index', category: 'Momentum', placement: 'own',
    blurb: 'Momentum on a 0-100 scale. Conventionally 30 and 70 are the bands.' },
  { kind: 'macd', name: 'MACD', category: 'Momentum', placement: 'own',
    blurb: 'Two moving averages converging and diverging, with a histogram.' },
  { kind: 'stochastic', name: 'Stochastic Oscillator', category: 'Momentum', placement: 'own',
    blurb: 'Where the close sits within its recent high-low range.' },
  { kind: 'atr', name: 'Average True Range', category: 'Volatility', placement: 'own',
    blurb: 'Typical bar range. Often used to size a position or a stop.' },
  { kind: 'obv', name: 'On-Balance Volume', category: 'Volume', placement: 'own',
    blurb: 'Running total of volume signed by the day’s direction.' },
  { kind: 'adx', name: 'Average Directional Index', category: 'Trend', placement: 'own',
    blurb: 'How strong a trend is, without saying which way it goes.' },
]

export const INDICATOR_DEFAULTS: Record<IndicatorKind, { period: number | null; label: (p: number | null) => string }> = {
  sma: { period: 20, label: p => `SMA ${p}` },
  ema: { period: 20, label: p => `EMA ${p}` },
  bollinger: { period: 20, label: p => `Bollinger ${p}` },
  vwap: { period: null, label: () => 'VWAP' },
  rsi: { period: 14, label: p => `RSI ${p}` },
  macd: { period: null, label: () => 'MACD (12, 26, 9)' },
  stochastic: { period: 14, label: p => `Stochastic ${p}` },
  atr: { period: 14, label: p => `ATR ${p}` },
  obv: { period: null, label: () => 'OBV' },
  adx: { period: 14, label: p => `ADX ${p}` },
}

export type PlotKind = 'price' | 'volume' | 'study'

/** How a price series is drawn. Mirrors the engine's `ChartType`. */
export type SeriesDisplayType = 'line' | 'candlestick' | 'bar' | 'area'

/** How several instruments on one plot are made comparable. */
export type PlotScaleMode = 'absolute' | 'indexed' | 'relative'

export const DEFAULT_INDEX_BASE = 100

export interface InstrumentSeries {
  id: string
  type: 'instrument'
  symbol: string
  /** The asset row's id. Identity is the id, never the ticker. */
  assetId: string | null
  companyName: string | null
  /** True for the panel's own instrument, which cannot be removed. */
  primary: boolean
  color: string
  visible: boolean
  /**
   * Candles, a line, bars or an area.
   *
   * On the SERIES rather than the panel, because it describes how this
   * instrument is drawn. Only the primary one is honoured today -- a
   * comparison is always a line, since candles for two instruments on one
   * axis cannot be told apart -- but storing it per series is what lets the
   * selector live beside the series it affects instead of in the toolbar.
   */
  displayType?: SeriesDisplayType
}

export interface IndicatorSeries {
  id: string
  type: 'indicator'
  kind: IndicatorKind
  period: number | null
  color: string
  visible: boolean
}

export type ChartSeries = InstrumentSeries | IndicatorSeries

export interface ChartPlot {
  id: string
  kind: PlotKind
  title: string
  /** Share of the panel's height. Normalised on read, never on write. */
  heightRatio: number
  visible: boolean
  series: ChartSeries[]
  /**
   * How this plot's instruments are made comparable, for a price plot.
   *
   * A plot property rather than a panel one: it is a statement about the
   * AXIS, and only a plot carrying more than one instrument has anything
   * to decide. `absolute` plots the prices as they are, `indexed` restates
   * each series to a common base, `relative` to percentage change.
   */
  scaleMode?: PlotScaleMode
  /** The common starting value for `indexed`. */
  indexBase?: number
}

export interface PanelPlots {
  plots: ChartPlot[]
  /** The object the Analysis panel is formatting, if any. */
  selectedId: string | null
}

/*
 * A fixed wheel rather than random colours: a reader who adds MSFT, removes
 * it and adds it again should get the same line back. `usedColors` keeps two
 * series on one plot from colliding.
 */
export const SERIES_COLORS = [
  '#2563eb', '#dc2626', '#059669', '#d97706',
  '#7c3aed', '#0891b2', '#be185d', '#65a30d',
] as const

export function nextColor(used: readonly string[]): string {
  return SERIES_COLORS.find(c => !used.includes(c)) ?? SERIES_COLORS[used.length % SERIES_COLORS.length]
}

let counter = 0
/** Ids are generated, never derived from a symbol or an indicator name. */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

/** Mostly for tests: makes ids reproducible within one run. */
export function __resetIdCounter(): void {
  counter = 0
}

export function createPriceSeries(
  symbol: string,
  assetId: string | null,
  companyName: string | null,
  opts?: { primary?: boolean; color?: string },
): InstrumentSeries {
  return {
    id: newId('series'),
    type: 'instrument',
    symbol: symbol.toUpperCase(),
    assetId,
    companyName,
    primary: opts?.primary ?? false,
    color: opts?.color ?? SERIES_COLORS[0],
    visible: true,
  }
}

export function createIndicatorSeries(kind: IndicatorKind, color: string, period?: number | null): IndicatorSeries {
  return {
    id: newId('ind'),
    type: 'indicator',
    kind,
    period: period === undefined ? INDICATOR_DEFAULTS[kind].period : period,
    color,
    visible: true,
  }
}

export function seriesLabel(s: ChartSeries): string {
  return s.type === 'instrument' ? s.symbol : INDICATOR_DEFAULTS[s.kind].label(s.period)
}

/**
 * The chart an analyst gets before touching anything: price and volume.
 *
 * Volume is a plot rather than a flag on the price plot because it has its
 * own units and its own scale, and because the brief's own tree names it as
 * one. It starts visible since every previous version of this chart drew it.
 */
export function initialPlots(symbol: string, assetId: string | null, companyName: string | null): PanelPlots {
  const price = createPriceSeries(symbol, assetId, companyName, { primary: true, color: SERIES_COLORS[0] })
  return {
    selectedId: null,
    plots: [
      {
        id: newId('plot'), kind: 'price', title: 'Price', heightRatio: 0.6,
        visible: true, series: [price],
        scaleMode: 'absolute', indexBase: DEFAULT_INDEX_BASE,
      },
      { id: newId('plot'), kind: 'volume', title: 'Volume', heightRatio: 0.18, visible: true, series: [] },
    ],
  }
}

/**
 * The arrangement a panel already had, carried into the plot model.
 *
 * Opening the Analysis panel must not silently throw away the chart the
 * analyst is looking at. The old flat `indicators` list and `compareSymbols`
 * are translated once, here:
 *
 *   - overlay names join the price plot
 *   - study names each get their OWN plot, which is what they looked like
 *     before, so the chart does not rearrange itself on first open
 *   - `volume` toggles the volume plot rather than becoming a series,
 *     because it was never a series
 *
 * An unrecognised name is dropped rather than guessed at.
 */
export function migrateToPlots(
  symbol: string,
  assetId: string | null,
  companyName: string | null,
  legacy: {
    indicators?: readonly string[]
    compareSymbols?: readonly { symbol: string; companyName?: string; color?: string }[]
    /* Carried from the toolbar controls this replaced, so an analyst who
       was looking at candles indexed to 100 still is. */
    chartType?: string
    displayMode?: string
    indexBase?: number
  },
): PanelPlots {
  const base = initialPlots(symbol, assetId, companyName)
  const DISPLAY_TYPES: readonly string[] = ['line', 'candlestick', 'bar', 'area']
  const SCALE_MODES: readonly string[] = ['absolute', 'indexed', 'relative']
  if (legacy.chartType && DISPLAY_TYPES.includes(legacy.chartType)) {
    const primary = base.plots[0].series[0]
    if (primary.type === 'instrument') primary.displayType = legacy.chartType as SeriesDisplayType
  }
  if (legacy.displayMode && SCALE_MODES.includes(legacy.displayMode)) {
    base.plots[0].scaleMode = legacy.displayMode as PlotScaleMode
  }
  if (typeof legacy.indexBase === 'number' && legacy.indexBase > 0) {
    base.plots[0].indexBase = legacy.indexBase
  }
  const names = (legacy.indicators ?? []).map(n => n.toLowerCase())
  const known = new Set<string>([...OVERLAY_INDICATORS, ...STUDY_INDICATORS])

  const price = base.plots[0]
  const volume = base.plots[1]
  volume.visible = names.includes('volume')

  for (const cs of legacy.compareSymbols ?? []) {
    price.series.push(createPriceSeries(cs.symbol, null, cs.companyName ?? null, {
      color: cs.color ?? nextColor(price.series.map(s => s.color)),
    }))
  }

  const studies: ChartPlot[] = []
  for (const name of names) {
    if (!known.has(name)) continue
    const kind = name as IndicatorKind
    if (isOverlay(kind)) {
      price.series.push(createIndicatorSeries(kind, nextColor(price.series.map(s => s.color))))
    } else {
      studies.push({
        id: newId('plot'),
        kind: 'study',
        title: INDICATOR_DEFAULTS[kind].label(INDICATOR_DEFAULTS[kind].period),
        heightRatio: 0.15,
        visible: true,
        series: [createIndicatorSeries(kind, SERIES_COLORS[0])],
      })
    }
  }

  return { ...base, plots: [price, volume, ...studies] }
}

export function findPlot(state: PanelPlots, plotId: string): ChartPlot | undefined {
  return state.plots.find(p => p.id === plotId)
}

export function pricePlot(state: PanelPlots): ChartPlot | undefined {
  return state.plots.find(p => p.kind === 'price')
}

/** Every series on every plot, with the plot it belongs to. */
export function allSeries(state: PanelPlots): Array<{ plot: ChartPlot; series: ChartSeries }> {
  return state.plots.flatMap(plot => plot.series.map(series => ({ plot, series })))
}

export function findSeries(state: PanelPlots, seriesId: string): { plot: ChartPlot; series: ChartSeries } | undefined {
  return allSeries(state).find(x => x.series.id === seriesId)
}

// ── actions ───────────────────────────────────────────────────────────────

export type PlotAction =
  | { type: 'addPlot'; kind?: PlotKind; title?: string }
  | { type: 'removePlot'; plotId: string }
  | { type: 'togglePlot'; plotId: string }
  | { type: 'renamePlot'; plotId: string; title: string }
  | { type: 'movePlot'; plotId: string; direction: 'up' | 'down' }
  | { type: 'resizePlot'; plotId: string; heightRatio: number }
  | { type: 'addIndicator'; plotId: string; kind: IndicatorKind }
  | { type: 'addInstrument'; plotId: string; symbol: string; assetId: string | null; companyName: string | null }
  | { type: 'removeSeries'; seriesId: string }
  | { type: 'toggleSeries'; seriesId: string }
  | { type: 'setSeriesColor'; seriesId: string; color: string }
  | { type: 'setIndicatorPeriod'; seriesId: string; period: number }
  | { type: 'moveSeries'; seriesId: string; toPlotId: string }
  /**
   * Make a plot and put a study on it, as ONE action.
   *
   * Not `addPlot` then `addIndicator`: the page's dispatcher derives the
   * next state from the panel it closed over, so two dispatches in one
   * handler both read the state as it was and the second discards the
   * first. A study that needs its own pane has to arrive atomically.
   */
  | { type: 'addStudyPlot'; kind: IndicatorKind }
  | { type: 'setSeriesDisplayType'; seriesId: string; displayType: SeriesDisplayType }
  | { type: 'setPlotScaleMode'; plotId: string; scaleMode: PlotScaleMode }
  | { type: 'setPlotIndexBase'; plotId: string; indexBase: number }
  | { type: 'select'; id: string | null }
  | { type: 'setPrimarySymbol'; symbol: string; assetId: string | null; companyName: string | null }

const MIN_RATIO = 0.06
const MAX_RATIO = 0.85

export function plotReducer(state: PanelPlots, action: PlotAction): PanelPlots {
  switch (action.type) {
    case 'addPlot': {
      /*
       * A deliberately EMPTY plot. The brief is explicit that a plot must
       * be able to exist before it has anything in it -- otherwise "Add
       * Plot" is just a second spelling of "Add Indicator".
       */
      const kind = action.kind ?? 'study'
      const n = state.plots.filter(p => p.kind === 'study').length + 1
      const plot: ChartPlot = {
        id: newId('plot'),
        kind,
        title: action.title ?? `Plot ${n}`,
        heightRatio: 0.15,
        visible: true,
        series: [],
      }
      return { ...state, plots: [...state.plots, plot], selectedId: plot.id }
    }

    case 'addStudyPlot': {
      /* Only for studies that need their own scale; an overlay belongs on
         the price plot and making it a pane would be a different chart. */
      if (isOverlay(action.kind)) return state
      const n = state.plots.filter(p => p.kind === 'study').length + 1
      const series = createIndicatorSeries(action.kind, SERIES_COLORS[0])
      const plot: ChartPlot = {
        id: newId('plot'),
        kind: 'study',
        title: `Plot ${n}`,
        heightRatio: 0.15,
        visible: true,
        series: [series],
      }
      return { ...state, plots: [...state.plots, plot], selectedId: series.id }
    }

    case 'removePlot': {
      const plot = findPlot(state, action.plotId)
      /* The price plot carries the time axis, the drawings and the header.
         Removing it would leave a panel that still claims to show AAPL. */
      if (!plot || plot.kind === 'price') return state
      return {
        ...state,
        plots: state.plots.filter(p => p.id !== action.plotId),
        selectedId: state.selectedId === action.plotId ? null : state.selectedId,
      }
    }

    case 'togglePlot':
      return {
        ...state,
        plots: state.plots.map(p => (p.id === action.plotId ? { ...p, visible: !p.visible } : p)),
      }

    case 'renamePlot':
      return {
        ...state,
        plots: state.plots.map(p =>
          p.id === action.plotId ? { ...p, title: action.title.trim() || p.title } : p),
      }

    case 'movePlot': {
      const i = state.plots.findIndex(p => p.id === action.plotId)
      if (i < 0) return state
      const j = action.direction === 'up' ? i - 1 : i + 1
      if (j < 0 || j >= state.plots.length) return state
      /* The price plot stays first: everything below it reads its time
         axis, and a study above the prices would be read as the subject. */
      if (state.plots[i].kind === 'price' || state.plots[j].kind === 'price') return state
      const plots = [...state.plots]
      ;[plots[i], plots[j]] = [plots[j], plots[i]]
      return { ...state, plots }
    }

    case 'resizePlot':
      return {
        ...state,
        plots: state.plots.map(p =>
          p.id === action.plotId
            ? { ...p, heightRatio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, action.heightRatio)) }
            : p),
      }

    case 'addIndicator': {
      const plot = findPlot(state, action.plotId)
      if (!plot) return state
      /*
       * An overlay on a study plot, or an oscillator on the price plot,
       * would be drawn against a scale it has no relation to -- RSI's 0-100
       * on a 350-dollar axis is a flat line at the bottom. The series goes
       * where its units can be read.
       */
      const wantsPrice = isOverlay(action.kind)
      if (wantsPrice && plot.kind !== 'price') return state
      /* A STUDY plot, not merely a non-price one: the volume plot is also
         non-price, and an oscillator put there would never be drawn. */
      if (!wantsPrice && plot.kind !== 'study') return state
      const used = plot.series.map(s => s.color)
      const series = createIndicatorSeries(action.kind, nextColor(used))
      return {
        ...state,
        selectedId: series.id,
        plots: state.plots.map(p => (p.id === plot.id ? { ...p, series: [...p.series, series] } : p)),
      }
    }

    case 'addInstrument': {
      const plot = findPlot(state, action.plotId)
      if (!plot || plot.kind !== 'price') return state
      const already = plot.series.some(
        s => s.type === 'instrument' && s.symbol === action.symbol.toUpperCase())
      if (already) return state
      const used = plot.series.map(s => s.color)
      const series = createPriceSeries(action.symbol, action.assetId, action.companyName, { color: nextColor(used) })
      return {
        ...state,
        selectedId: series.id,
        plots: state.plots.map(p => (p.id === plot.id ? { ...p, series: [...p.series, series] } : p)),
      }
    }

    case 'removeSeries': {
      const found = findSeries(state, action.seriesId)
      /* The panel's own instrument is what the chart IS. Removing it is
         done by charting something else, not by deleting a row. */
      if (!found || (found.series.type === 'instrument' && found.series.primary)) return state
      return {
        ...state,
        selectedId: state.selectedId === action.seriesId ? null : state.selectedId,
        plots: state.plots.map(p => ({ ...p, series: p.series.filter(s => s.id !== action.seriesId) })),
      }
    }

    case 'toggleSeries':
      return {
        ...state,
        plots: state.plots.map(p => ({
          ...p,
          series: p.series.map(s => (s.id === action.seriesId ? { ...s, visible: !s.visible } : s)),
        })),
      }

    case 'setSeriesColor':
      return {
        ...state,
        plots: state.plots.map(p => ({
          ...p,
          series: p.series.map(s => (s.id === action.seriesId ? { ...s, color: action.color } : s)),
        })),
      }

    case 'setIndicatorPeriod': {
      const period = Math.round(action.period)
      if (!Number.isFinite(period) || period < 1 || period > 400) return state
      return {
        ...state,
        plots: state.plots.map(p => ({
          ...p,
          series: p.series.map(s =>
            s.id === action.seriesId && s.type === 'indicator' && s.period !== null
              ? { ...s, period }
              : s),
        })),
      }
    }

    case 'moveSeries': {
      const found = findSeries(state, action.seriesId)
      const target = findPlot(state, action.toPlotId)
      if (!found || !target || found.plot.id === target.id) return state
      const s = found.series
      /* Same compatibility rule as adding. A move is an add and a remove,
         and it must not be a way around the rule the add enforces. */
      if (s.type === 'instrument' && target.kind !== 'price') return state
      if (s.type === 'instrument' && s.primary) return state
      if (s.type === 'indicator') {
        const wantsPrice = isOverlay(s.kind)
        if (wantsPrice && target.kind !== 'price') return state
        /* A study needs a STUDY plot, not merely a non-price one. The
           volume plot is non-price and carries no series of its own --
           volume is drawn from the bars -- so `!== 'price'` let an RSI be
           moved into the volume pane, where nothing would draw it. */
        if (!wantsPrice && target.kind !== 'study') return state
      }
      return {
        ...state,
        plots: state.plots.map(p => {
          if (p.id === found.plot.id) return { ...p, series: p.series.filter(x => x.id !== s.id) }
          if (p.id === target.id) return { ...p, series: [...p.series, s] }
          return p
        }),
      }
    }

    case 'setSeriesDisplayType':
      return {
        ...state,
        plots: state.plots.map(p => ({
          ...p,
          series: p.series.map(s =>
            s.id === action.seriesId && s.type === 'instrument'
              ? { ...s, displayType: action.displayType }
              : s),
        })),
      }

    case 'setPlotScaleMode': {
      const plot = findPlot(state, action.plotId)
      /* Only a price plot has instruments to make comparable. A study
         plot's scale is decided by its indicators' own units. */
      if (!plot || plot.kind !== 'price') return state
      return {
        ...state,
        plots: state.plots.map(p =>
          p.id === action.plotId ? { ...p, scaleMode: action.scaleMode } : p),
      }
    }

    case 'setPlotIndexBase': {
      const base = Number(action.indexBase)
      /* A base of zero divides every point by nothing and draws an empty
         plot; a negative one inverts every series silently. */
      if (!Number.isFinite(base) || base <= 0) return state
      return {
        ...state,
        plots: state.plots.map(p =>
          p.id === action.plotId ? { ...p, indexBase: base } : p),
      }
    }

    case 'select':
      return { ...state, selectedId: action.id }

    case 'setPrimarySymbol': {
      /*
       * The panel changed instrument. The primary series follows it and
       * everything else -- comparisons, indicators, plot layout -- stays,
       * because the analyst arranged it and changing the subject is not a
       * request to tear it down.
       */
      return {
        ...state,
        plots: state.plots.map(p => ({
          ...p,
          series: p.series.map(s =>
            s.type === 'instrument' && s.primary
              ? { ...s, symbol: action.symbol.toUpperCase(), assetId: action.assetId, companyName: action.companyName }
              : s),
        })),
      }
    }

    default:
      return state
  }
}

// ── derivation for the renderer ───────────────────────────────────────────

export interface DerivedPlotSpec {
  id: string
  kind: PlotKind
  title: string
  heightRatio: number
  indicators: Array<{ id: string; kind: IndicatorKind; period: number | null; color: string }>
}

/**
 * What the renderer is handed.
 *
 * Hidden plots and hidden series are dropped HERE rather than in the
 * renderer, so "hidden" means one thing in one place. An empty plot is kept:
 * it was created on purpose and must hold its space, or Add Plot would look
 * like it had failed.
 */
export function derivePlotSpecs(state: PanelPlots): DerivedPlotSpec[] {
  return state.plots
    .filter(p => p.visible && p.kind !== 'price')
    .map(p => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      heightRatio: p.heightRatio,
      indicators: p.series
        .filter((s): s is IndicatorSeries => s.type === 'indicator' && s.visible)
        .map(s => ({ id: s.id, kind: s.kind, period: s.period, color: s.color })),
    }))
}

/** Overlay indicators for the price plot, in the order the analyst added them. */
export function deriveOverlays(state: PanelPlots): IndicatorSeries[] {
  const price = pricePlot(state)
  if (!price || !price.visible) return []
  return price.series.filter((s): s is IndicatorSeries => s.type === 'indicator' && s.visible)
}

/** Comparison instruments on the price plot, excluding the panel's own. */
export function deriveComparisons(state: PanelPlots): InstrumentSeries[] {
  const price = pricePlot(state)
  if (!price || !price.visible) return []
  return price.series.filter(
    (s): s is InstrumentSeries => s.type === 'instrument' && !s.primary && s.visible)
}

/** How the primary instrument is drawn, for the renderer's `chartType`. */
export function deriveDisplayType(state: PanelPlots): SeriesDisplayType {
  const price = pricePlot(state)
  const primary = price?.series.find(
    (s): s is InstrumentSeries => s.type === 'instrument' && s.primary)
  return primary?.displayType ?? 'line'
}

/** The price plot's comparison mode, for the renderer's `displayMode`. */
export function deriveScaleMode(state: PanelPlots): PlotScaleMode {
  return pricePlot(state)?.scaleMode ?? 'absolute'
}

export function deriveIndexBase(state: PanelPlots): number {
  return pricePlot(state)?.indexBase ?? DEFAULT_INDEX_BASE
}

export function volumeVisible(state: PanelPlots): boolean {
  const v = state.plots.find(p => p.kind === 'volume')
  return !!v && v.visible
}
