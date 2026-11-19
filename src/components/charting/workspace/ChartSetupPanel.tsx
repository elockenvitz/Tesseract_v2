/**
 * Chart Setup: everything on the chart, as a tree you can act on.
 *
 * ── The name ─────────────────────────────────────────────────────────────
 *
 * Called Chart Setup, not Analysis. It manages what is DRAWN -- plots,
 * series, studies, formatting. "Analysis" is reserved for research and ACT
 * AI surfaces, which reason about an instrument rather than configure a
 * canvas; using the word here would have spent it on a layout manager.
 *
 * ── Why this replaced the toolbar dropdowns ──────────────────────────────
 *
 * The command bar used to carry Indicators, Compare, Metric and chart-type
 * controls as separate menus. Each could only describe the chart in its own
 * terms, so there was nowhere to express "this RSI, on that plot, at a
 * period of 50, hidden for the moment" -- and nowhere to SEE what was on
 * the chart without opening three menus and holding the answer in your
 * head.
 *
 * Those menus are now gone rather than duplicated. Everything they did is
 * reachable here, beside the object it affects.
 *
 * ── Every row acts on the model ──────────────────────────────────────────
 *
 * There are no decorative controls. Each button dispatches a `PlotAction`
 * and the model decides whether it is allowed -- so the rules live in one
 * tested place rather than in the enabled state of a button. Where an
 * action cannot apply (removing the price plot, moving the primary series)
 * the control is not rendered at all, instead of rendered and ignored.
 *
 * ── Drawings are NOT managed here ────────────────────────────────────────
 *
 * Selecting a drawing opens `AnnotationInspector`, which already owns that
 * job. Re-implementing it in this tree would give a mark two editors that
 * disagree about its style.
 */
import { useState } from 'react'
import { clsx } from 'clsx'
import {
  Plus, Eye, EyeOff, Trash2, ChevronUp, ChevronDown, X, Pencil, Check,
} from 'lucide-react'
import {
  type PanelPlots, type PlotAction, type ChartPlot, type ChartSeries,
  type IndicatorKind, type SeriesDisplayType, type PlotScaleMode,
  seriesLabel, isOverlay, SERIES_COLORS, OVERLAY_INDICATORS, STUDY_INDICATORS,
  INDICATOR_DEFAULTS, DEFAULT_INDEX_BASE,
} from '../../../lib/charting/plot-model'

export interface ChartSetupPanelProps {
  state: PanelPlots
  dispatch: (action: PlotAction) => void
  /** Opens the instrument search so a comparison can be chosen by name. */
  onAddInstrument: (plotId: string) => void
  onClose: () => void
}

const DISPLAY_TYPES: readonly { value: SeriesDisplayType; label: string; short: string }[] = [
  { value: 'line', label: 'Line', short: 'Line' },
  { value: 'candlestick', label: 'Candlestick', short: 'Candle' },
  { value: 'bar', label: 'Bar', short: 'Bar' },
  { value: 'area', label: 'Area', short: 'Area' },
]

const SCALE_MODES: readonly { value: PlotScaleMode; label: string; description: string }[] = [
  { value: 'absolute', label: 'Abs', description: 'Prices as they are' },
  { value: 'indexed', label: 'Index', description: 'Every series restated to a common base' },
  { value: 'relative', label: '% Chg', description: 'Percentage change from the first bar' },
]

const INDICATOR_LABEL: Record<IndicatorKind, string> = {
  sma: 'SMA', ema: 'EMA', bollinger: 'Bollinger Bands', vwap: 'VWAP',
  rsi: 'RSI', macd: 'MACD', stochastic: 'Stochastic',
  atr: 'ATR', obv: 'OBV', adx: 'ADX',
}

export function ChartSetupPanel({ state, dispatch, onAddInstrument, onClose }: ChartSetupPanelProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  /** Which plot has its add menu open, and which of the two it is showing. */
  const [addingTo, setAddingTo] = useState<{ plotId: string; mode: 'series' | 'study' } | null>(null)

  const selected = state.plots
    .flatMap(p => p.series.map(s => ({ plot: p, series: s })))
    .find(x => x.series.id === state.selectedId)
  const selectedPlot = state.plots.find(p => p.id === state.selectedId)

  return (
    <aside
      data-charting-analysis
      aria-label="Chart setup"
      className="flex h-full w-72 shrink-0 flex-col border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
    >
      <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Chart Setup
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => dispatch({ type: 'addPlot' })}
            title="Add plot"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            title="Close panel"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div data-charting-plot-tree className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {state.plots.map((plot, index) => (
          <PlotRow
            key={plot.id}
            plot={plot}
            index={index}
            total={state.plots.length}
            selectedId={state.selectedId}
            renaming={renaming === plot.id}
            draftTitle={draftTitle}
            addingMode={addingTo?.plotId === plot.id ? addingTo.mode : null}
            onDraftTitle={setDraftTitle}
            onStartRename={() => { setRenaming(plot.id); setDraftTitle(plot.title) }}
            onCommitRename={() => {
              dispatch({ type: 'renamePlot', plotId: plot.id, title: draftTitle })
              setRenaming(null)
            }}
            onToggleAdd={mode => setAddingTo(
              addingTo?.plotId === plot.id && addingTo.mode === mode
                ? null
                : { plotId: plot.id, mode })}
            onAddInstrument={() => { setAddingTo(null); onAddInstrument(plot.id) }}
            dispatch={dispatch}
          />
        ))}
      </div>

      {(selected || selectedPlot) && (
        <FormatSection
          selectedSeries={selected?.series ?? null}
          selectedPlot={selectedPlot ?? null}
          dispatch={dispatch}
        />
      )}
    </aside>
  )
}

interface PlotRowProps {
  plot: ChartPlot
  index: number
  total: number
  selectedId: string | null
  renaming: boolean
  draftTitle: string
  addingMode: 'series' | 'study' | null
  onDraftTitle: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onToggleAdd: (mode: 'series' | 'study') => void
  onAddInstrument: () => void
  dispatch: (a: PlotAction) => void
}

function PlotRow({
  plot, index, total, selectedId, renaming, draftTitle, addingMode,
  onDraftTitle, onStartRename, onCommitRename, onToggleAdd, onAddInstrument, dispatch,
}: PlotRowProps) {
  /*
   * Which indicators this plot can actually take. The model refuses the
   * rest, so offering them would be offering a button that does nothing.
   */
  const offerable = plot.kind === 'price' ? OVERLAY_INDICATORS : STUDY_INDICATORS
  /*
   * Add Series and Add Study are separate actions, because they are
   * separate ideas: a series is another INSTRUMENT to compare against, a
   * study is a CALCULATION over one. Collapsing them into one "+" made the
   * price plot offer four moving averages under a label that sounded like
   * it meant securities.
   */
  const canAddSeries = plot.kind === 'price'
  const canRemove = plot.kind !== 'price'
  const canMoveUp = index > 0 && plot.kind !== 'price'
  const canMoveDown = index < total - 1 && plot.kind !== 'price'

  return (
    <div className="mb-1">
      <div
        className={clsx(
          'group flex items-center gap-1 rounded px-2 py-1.5 text-sm',
          selectedId === plot.id ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800',
        )}
      >
        <button
          onClick={() => dispatch({ type: 'togglePlot', plotId: plot.id })}
          title={plot.visible ? 'Hide plot' : 'Show plot'}
          className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          {plot.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>

        {renaming ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={e => onDraftTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onCommitRename() }}
            aria-label="Plot name"
            className="min-w-0 flex-1 rounded border border-blue-400 px-1 text-sm dark:bg-gray-800 dark:text-white"
          />
        ) : (
          <button
            onClick={() => dispatch({ type: 'select', id: plot.id })}
            className={clsx(
              'min-w-0 flex-1 truncate text-left font-medium',
              plot.visible ? 'text-gray-900 dark:text-white' : 'text-gray-400 line-through',
            )}
          >
            {plot.title}
          </button>
        )}

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {renaming ? (
            <button onClick={onCommitRename} title="Save name" className="rounded p-0.5 text-gray-500 hover:text-gray-900">
              <Check className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button onClick={onStartRename} title="Rename plot" className="rounded p-0.5 text-gray-400 hover:text-gray-900 dark:hover:text-white">
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {canMoveUp && (
            <button onClick={() => dispatch({ type: 'movePlot', plotId: plot.id, direction: 'up' })} title="Move plot up" className="rounded p-0.5 text-gray-400 hover:text-gray-900 dark:hover:text-white">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          )}
          {canMoveDown && (
            <button onClick={() => dispatch({ type: 'movePlot', plotId: plot.id, direction: 'down' })} title="Move plot down" className="rounded p-0.5 text-gray-400 hover:text-gray-900 dark:hover:text-white">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          )}
          {canAddSeries && (
            <button onClick={() => onToggleAdd('series')} title="Add series to this plot" className="rounded px-1 py-0.5 text-[10px] font-medium text-gray-400 hover:text-gray-900 dark:hover:text-white">
              Series
            </button>
          )}
          <button onClick={() => onToggleAdd('study')} title="Add study to this plot" className="rounded px-1 py-0.5 text-[10px] font-medium text-gray-400 hover:text-gray-900 dark:hover:text-white">
            Study
          </button>
          {/*
            No remove control on the price plot at all, rather than one that
            is rendered and then ignored by the reducer.
          */}
          {canRemove && (
            <button onClick={() => dispatch({ type: 'removePlot', plotId: plot.id })} title="Remove plot" className="rounded p-0.5 text-gray-400 hover:text-rose-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {addingMode === 'series' && (
        <div className="mb-1 ml-6 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
          {/*
            Compare lives here now. It was a toolbar dropdown of its own,
            which meant adding MSFT to the price plot and adding SMA to the
            price plot were two different gestures in two different places.
          */}
          <button
            onClick={onAddInstrument}
            className="w-full rounded bg-white px-2 py-1 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 dark:bg-gray-900 dark:text-blue-300"
          >
            Search securities…
          </button>
        </div>
      )}

      {addingMode === 'study' && (
        <div className="mb-1 ml-6 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap gap-1">
            {offerable.map(kind => (
              <button
                key={kind}
                onClick={() => dispatch({ type: 'addIndicator', plotId: plot.id, kind })}
                className="rounded bg-white px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:bg-gray-900 dark:text-gray-300"
              >
                {INDICATOR_LABEL[kind]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ml-6">
        {plot.series.length === 0 && !addingMode && (
          /* An empty plot says so, rather than looking like a failed click. */
          <p className="px-2 py-1 text-[11px] italic text-gray-400">Empty — add a series</p>
        )}
        {plot.series.map(series => (
          <SeriesRow
            key={series.id}
            series={series}
            selected={selectedId === series.id}
            dispatch={dispatch}
          />
        ))}
      </div>
    </div>
  )
}

function SeriesRow({ series, selected, dispatch }: {
  series: ChartSeries
  selected: boolean
  dispatch: (a: PlotAction) => void
}) {
  const removable = !(series.type === 'instrument' && series.primary)
  return (
    <div
      className={clsx(
        'group flex items-center gap-1.5 rounded px-2 py-1 text-xs',
        selected ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800',
      )}
    >
      <button
        onClick={() => dispatch({ type: 'toggleSeries', seriesId: series.id })}
        title={series.visible ? 'Hide series' : 'Show series'}
        className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        {series.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      </button>
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: series.color, opacity: series.visible ? 1 : 0.35 }}
      />
      <button
        onClick={() => dispatch({ type: 'select', id: series.id })}
        className={clsx(
          'min-w-0 flex-1 truncate text-left',
          series.visible ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 line-through',
        )}
      >
        {seriesLabel(series)}
        {series.type === 'instrument' && series.primary && (
          <span className="ml-1 text-[10px] uppercase text-gray-400">main</span>
        )}
      </button>
      {removable && (
        <button
          onClick={() => dispatch({ type: 'removeSeries', seriesId: series.id })}
          title="Remove series"
          className="shrink-0 text-gray-400 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

/**
 * Formatting for whatever is selected.
 *
 * Contextual rather than a global "line formatting" menu: the old menu had
 * to ask which line you meant, and the answer was already on screen.
 */
function FormatSection({ selectedSeries, selectedPlot, dispatch }: {
  selectedSeries: ChartSeries | null
  selectedPlot: ChartPlot | null
  dispatch: (a: PlotAction) => void
}) {
  return (
    <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-700">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {selectedSeries ? seriesLabel(selectedSeries) : selectedPlot?.title}
      </h3>

      {selectedSeries && (
        <>
          {/*
            The chart-type selector, beside the series it draws.
            It was four icon buttons sitting permanently in the command bar,
            which is a lot of width for a control most readers set once.
            Only the primary instrument offers it: a comparison is always a
            line, because two sets of candles on one axis cannot be read.
          */}
          {selectedSeries.type === 'instrument' && selectedSeries.primary && (
            <>
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">Display</label>
              <div className="mb-2 grid grid-cols-4 gap-1">
                {DISPLAY_TYPES.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => dispatch({
                      type: 'setSeriesDisplayType',
                      seriesId: selectedSeries.id,
                      displayType: opt.value,
                    })}
                    title={opt.label}
                    aria-label={opt.label}
                    aria-pressed={(selectedSeries.displayType ?? 'line') === opt.value}
                    className={clsx(
                      'rounded px-1 py-1 text-[10px]',
                      (selectedSeries.displayType ?? 'line') === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300',
                    )}
                  >
                    {opt.short}
                  </button>
                ))}
              </div>
            </>
          )}

          <label className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">Colour</label>
          <div className="mb-2 flex flex-wrap gap-1">
            {SERIES_COLORS.map(c => (
              <button
                key={c}
                onClick={() => dispatch({ type: 'setSeriesColor', seriesId: selectedSeries.id, color: c })}
                aria-label={`Colour ${c}`}
                className={clsx(
                  'h-5 w-5 rounded border-2',
                  selectedSeries.color === c ? 'border-gray-900 dark:border-white' : 'border-transparent',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          {/*
            A period field only where a period is the whole parameter. MACD
            has three and Bollinger two, so they are listed with `period:
            null` and a single box would be a lie about what it edits.
          */}
          {selectedSeries.type === 'indicator' && selectedSeries.period !== null && (
            <label className="block text-[11px] text-gray-500 dark:text-gray-400">
              Period
              <input
                type="number"
                min={1}
                max={400}
                value={selectedSeries.period}
                onChange={e => dispatch({
                  type: 'setIndicatorPeriod',
                  seriesId: selectedSeries.id,
                  period: Number(e.target.value),
                })}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
          )}

          {selectedSeries.type === 'indicator' && selectedSeries.period === null && (
            <p className="text-[11px] italic text-gray-400">
              {INDICATOR_DEFAULTS[selectedSeries.kind].label(null)} uses fixed periods.
            </p>
          )}

          {selectedSeries.type === 'indicator' && (
            <p className="mt-2 text-[11px] text-gray-400">
              {isOverlay(selectedSeries.kind) ? 'Drawn on the price scale.' : 'Drawn on its own scale.'}
            </p>
          )}
        </>
      )}

      {!selectedSeries && selectedPlot && (
        <>
          <label className="block text-[11px] text-gray-500 dark:text-gray-400">
            Height
            <input
              type="range"
              min={6}
              max={85}
              value={Math.round(selectedPlot.heightRatio * 100)}
              onChange={e => dispatch({
                type: 'resizePlot',
                plotId: selectedPlot.id,
                heightRatio: Number(e.target.value) / 100,
              })}
              aria-label="Plot height"
              className="mt-1 w-full"
            />
          </label>

          {/*
            The comparison scale, on the plot whose axis it governs. This
            was a submenu inside the Compare dropdown, so it was only
            reachable while adding a security -- which is the one moment an
            analyst is not yet looking at the comparison they want to scale.
          */}
          {selectedPlot.kind === 'price' && (
            <div className="mt-2">
              <label className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">Scale</label>
              <div className="grid grid-cols-3 gap-1">
                {SCALE_MODES.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => dispatch({
                      type: 'setPlotScaleMode',
                      plotId: selectedPlot.id,
                      scaleMode: opt.value,
                    })}
                    title={opt.description}
                    aria-pressed={(selectedPlot.scaleMode ?? 'absolute') === opt.value}
                    className={clsx(
                      'rounded px-1 py-1 text-[10px]',
                      (selectedPlot.scaleMode ?? 'absolute') === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {(selectedPlot.scaleMode ?? 'absolute') === 'indexed' && (
                <label className="mt-2 block text-[11px] text-gray-500 dark:text-gray-400">
                  Index base
                  <input
                    type="number"
                    min={1}
                    value={selectedPlot.indexBase ?? DEFAULT_INDEX_BASE}
                    onChange={e => dispatch({
                      type: 'setPlotIndexBase',
                      plotId: selectedPlot.id,
                      indexBase: Number(e.target.value),
                    })}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  />
                </label>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
