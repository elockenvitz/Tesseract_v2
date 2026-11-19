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
      { id: newId('plot'), kind: 'price', title: 'Price', heightRatio: 0.6, visible: true, series: [price] },
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
  },
): PanelPlots {
  const base = initialPlots(symbol, assetId, companyName)
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
      if (!wantsPrice && plot.kind === 'price') return state
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
        if (!wantsPrice && target.kind === 'price') return state
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

export function volumeVisible(state: PanelPlots): boolean {
  const v = state.plots.find(p => p.kind === 'volume')
  return !!v && v.visible
}
