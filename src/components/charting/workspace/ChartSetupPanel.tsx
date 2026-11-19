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
  Plus, Eye, EyeOff, X, Check, Search, MoreHorizontal, ArrowLeft,
  GitCompare, Activity, Rows3,
} from 'lucide-react'
import {
  type PanelPlots, type PlotAction, type ChartPlot, type ChartSeries,
  type IndicatorKind, type SeriesDisplayType, type PlotScaleMode,
  type StudyInfo,
  seriesLabel, isOverlay, SERIES_COLORS, STUDY_CATALOG,
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

/*
  `INDICATOR_LABEL` was a second list of names here. It is gone: the study
  browser reads `STUDY_CATALOG`, so a study's name, category and
  description live in one place beside the kinds the engine implements.
*/

export function ChartSetupPanel({ state, dispatch, onAddInstrument, onClose }: ChartSetupPanelProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  /**
   * Which plot the study browser is open for.
   *
   * Opening it with no plot (from Quick actions) targets the plot the
   * model will accept -- the browser shows every implemented study and
   * routes each to a compatible plot, so an analyst never has to know
   * which pane an oscillator belongs in.
   */
  const [studyBrowserFor, setStudyBrowserFor] = useState<string | null | 'any'>(null)

  const selected = state.plots
    .flatMap(p => p.series.map(s => ({ plot: p, series: s })))
    .find(x => x.series.id === state.selectedId)
  const selectedPlot = state.plots.find(p => p.id === state.selectedId)
  const price = state.plots.find(p => p.kind === 'price')

  /*
   * Compare reuses `onAddInstrument`, the SAME path Add Series uses on a
   * plot row. There is deliberately no second comparison state: the brief
   * that removed the toolbar dropdown left Compare hard to find, and the
   * fix for that is a label in an obvious place, not a parallel mechanism
   * with its own copy of the list.
   */
  const compare = () => { if (price) onAddInstrument(price.id) }

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
        <button
          onClick={onClose}
          title="Close panel"
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/*
        AREA A -- Quick actions.

        The three things an analyst does most, each one click from opening
        the panel and each NAMED. Compare was reachable before only by
        hovering a plot row until a "Series" affordance appeared, which is
        not a thing anyone discovers.
      */}
      <div data-charting-quick-actions className="flex gap-1 border-b border-gray-200 px-2 py-2 dark:border-gray-700">
        <QuickAction icon={<GitCompare className="h-3.5 w-3.5" />} label="Compare" onClick={compare} disabled={!price} />
        <QuickAction icon={<Activity className="h-3.5 w-3.5" />} label="Add Study" onClick={() => setStudyBrowserFor('any')} />
        <QuickAction icon={<Rows3 className="h-3.5 w-3.5" />} label="Add Plot" onClick={() => dispatch({ type: 'addPlot' })} />
      </div>

      {/*
        Picking a study TAKES THE BODY rather than opening above the tree.
        Stacked, the browser, the tree and the properties area each fought
        for a 72-wide column's height and the tree was left showing two
        rows -- so choosing a study hid the arrangement you were choosing
        it for. It is a short, focused task; it gets the space.
      */}
      {studyBrowserFor !== null ? (
        <StudyBrowser
          plots={state.plots}
          targetPlotId={studyBrowserFor === 'any' ? null : studyBrowserFor}
          onPick={(kind, plotId) => {
            dispatch({ type: 'addIndicator', plotId, kind })
            setStudyBrowserFor(null)
          }}
          onClose={() => setStudyBrowserFor(null)}
          dispatch={dispatch}
        />
      ) : (
        <>
          {/* AREA B -- Plots & Series. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SectionLabel>Plots &amp; Series</SectionLabel>
            <div data-charting-plot-tree className="px-1 pb-2">
              {state.plots.map((plot, index) => (
                <PlotRow
                  key={plot.id}
                  plot={plot}
                  index={index}
                  total={state.plots.length}
                  plots={state.plots}
                  selectedId={state.selectedId}
                  renaming={renaming === plot.id}
                  draftTitle={draftTitle}
                  onDraftTitle={setDraftTitle}
                  onStartRename={() => { setRenaming(plot.id); setDraftTitle(plot.title) }}
                  onCommitRename={() => {
                    dispatch({ type: 'renamePlot', plotId: plot.id, title: draftTitle })
                    setRenaming(null)
                  }}
                  onAddStudy={() => setStudyBrowserFor(plot.id)}
                  onAddInstrument={() => onAddInstrument(plot.id)}
                  dispatch={dispatch}
                />
              ))}
            </div>
          </div>

          {/* AREA C -- Properties for whatever is selected. */}
          <PropertiesSection
            selectedSeries={selected?.series ?? null}
            selectedPlot={selectedPlot ?? null}
            dispatch={dispatch}
          />
        </>
      )}
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
      {children}
    </h3>
  )
}

function QuickAction({ icon, label, onClick, disabled }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex flex-1 flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[10px] font-medium transition-colors',
        disabled
          ? 'cursor-not-allowed border-gray-200 text-gray-300 dark:border-gray-800 dark:text-gray-700'
          : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-blue-500/10',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * A searchable browser for the studies the engine implements.
 *
 * Replaces a flat row of abbreviations. "ADX" is not a description, and a
 * reader deciding between ATR and ADX got no help from a menu that printed
 * only the acronyms.
 *
 * Placement is decided HERE rather than by the analyst: an overlay goes on
 * the price plot, a study on a compatible one, and if the browser was
 * opened from a plot row that plot is preferred when it will accept the
 * study. The model would refuse a wrong pairing anyway -- this just means
 * the refusal never has to happen.
 */
function StudyBrowser({ plots, targetPlotId, onPick, onClose, dispatch }: {
  plots: readonly ChartPlot[]
  targetPlotId: string | null
  onPick: (kind: IndicatorKind, plotId: string) => void
  onClose: () => void
  dispatch: (a: PlotAction) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const matches = STUDY_CATALOG.filter(s =>
    !q || s.name.toLowerCase().includes(q) || s.kind.includes(q)
    || s.category.toLowerCase().includes(q) || s.blurb.toLowerCase().includes(q))

  const price = plots.find(p => p.kind === 'price')
  const target = targetPlotId ? plots.find(p => p.id === targetPlotId) : null

  /**
   * Where a study would land, and whether a new plot has to be made.
   *
   * Returning the decision rather than acting on it lets the row SAY where
   * the study is going before the analyst commits to it.
   */
  const destination = (info: StudyInfo): { plotId: string | null; label: string } => {
    if (info.placement === 'price') {
      return price ? { plotId: price.id, label: price.title } : { plotId: null, label: 'Price' }
    }
    if (target && target.kind === 'study') return { plotId: target.id, label: target.title }
    /*
     * Only a STUDY plot counts as free space. The volume plot is also
     * non-price and also carries no series -- volume is drawn from the
     * bars themselves -- so testing `kind !== 'price'` quietly routed
     * every oscillator into the volume pane.
     */
    const empty = plots.find(p => p.kind === 'study' && p.series.length === 0)
    if (empty) return { plotId: empty.id, label: empty.title }
    return { plotId: null, label: 'a new plot' }
  }

  return (
    <div
      data-charting-study-browser
      className="flex min-h-0 flex-1 flex-col px-2 py-2"
    >
      <div className="mb-2 flex items-center gap-1">
        <button onClick={onClose} title="Back to plots" className="rounded p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search studies"
            aria-label="Search studies"
            className="w-full rounded border border-gray-300 bg-white py-1 pl-7 pr-2 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {matches.length === 0 && (
          <p className="px-1 py-2 text-[11px] italic text-gray-400">
            No study matches “{query}”.
          </p>
        )}
        {matches.map(info => {
          const dest = destination(info)
          return (
            <button
              key={info.kind}
              onClick={() => {
                if (dest.plotId) { onPick(info.kind, dest.plotId); return }
                /* Needs a pane of its own. One action, because two
                   dispatches in this handler would both read the state as
                   it was and the second would discard the first. */
                dispatch({ type: 'addStudyPlot', kind: info.kind })
                onClose()
              }}
              className="mb-0.5 block w-full rounded px-2 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-blue-500/10"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-gray-900 dark:text-white">
                  {info.name}
                </span>
                <span className="shrink-0 text-[9px] uppercase tracking-wide text-gray-400">
                  {info.category}
                </span>
              </span>
              <span className="mt-0.5 block text-[10px] leading-snug text-gray-500 dark:text-gray-400">
                {info.blurb}
              </span>
              <span className="mt-0.5 block text-[10px] text-gray-400">
                → {dest.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface PlotRowProps {
  plot: ChartPlot
  index: number
  total: number
  plots: readonly ChartPlot[]
  selectedId: string | null
  renaming: boolean
  draftTitle: string
  onDraftTitle: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onAddStudy: () => void
  onAddInstrument: () => void
  dispatch: (a: PlotAction) => void
}

function PlotRow({
  plot, index, total, plots, selectedId, renaming, draftTitle,
  onDraftTitle, onStartRename, onCommitRename, onAddStudy, onAddInstrument, dispatch,
}: PlotRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  /*
   * Add Series and Add Study are separate ideas: a series is another
   * INSTRUMENT to compare against, a study is a CALCULATION over one.
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

        <div className="flex shrink-0 items-center gap-0.5">
          {renaming ? (
            <button onClick={onCommitRename} title="Save name" className="rounded p-0.5 text-gray-500 hover:text-gray-900">
              <Check className="h-3.5 w-3.5" />
            </button>
          ) : (
            <>
              {canAddSeries && (
                <button
                  onClick={onAddInstrument}
                  title="Add series to this plot"
                  className="rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-blue-600 group-hover:opacity-100 focus:opacity-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
              {/*
                One menu instead of five hover icons. The row carried
                rename, up, down, Series, Study and remove, which at 11px
                is a row of targets nobody can tell apart, all of them
                invisible until hover.
              */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(v => !v)}
                  title={`${plot.title} options`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      <MenuItem onClick={() => { onAddStudy(); setMenuOpen(false) }}>Add study…</MenuItem>
                      <MenuItem onClick={() => { onStartRename(); setMenuOpen(false) }}>Rename</MenuItem>
                      {canMoveUp && (
                        <MenuItem onClick={() => { dispatch({ type: 'movePlot', plotId: plot.id, direction: 'up' }); setMenuOpen(false) }}>
                          Move up
                        </MenuItem>
                      )}
                      {canMoveDown && (
                        <MenuItem onClick={() => { dispatch({ type: 'movePlot', plotId: plot.id, direction: 'down' }); setMenuOpen(false) }}>
                          Move down
                        </MenuItem>
                      )}
                      <MenuItem onClick={() => { dispatch({ type: 'togglePlot', plotId: plot.id }); setMenuOpen(false) }}>
                        {plot.visible ? 'Hide plot' : 'Show plot'}
                      </MenuItem>
                      {/* No remove entry at all on the price plot, rather
                          than one the reducer silently ignores. */}
                      {canRemove && (
                        <MenuItem danger onClick={() => { dispatch({ type: 'removePlot', plotId: plot.id }); setMenuOpen(false) }}>
                          Remove plot
                        </MenuItem>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="ml-6">
        {plot.series.length === 0 && (
          /* An empty plot says so, and offers the way out of being empty,
             rather than looking like a failed click. */
          <div className="px-2 py-1">
            <p className="text-[11px] italic text-gray-400">Nothing on this plot yet</p>
            <button
              onClick={onAddStudy}
              className="mt-0.5 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Add a study
            </button>
          </div>
        )}
        {plot.series.map(series => (
          <SeriesRow
            key={series.id}
            series={series}
            plot={plot}
            plots={plots}
            selected={selectedId === series.id}
            dispatch={dispatch}
          />
        ))}
      </div>
    </div>
  )
}

function MenuItem({ children, onClick, danger }: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={clsx(
        'block w-full px-3 py-1.5 text-left text-xs',
        danger
          ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10'
          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700',
      )}
    >
      {children}
    </button>
  )
}

function SeriesRow({ series, plot, plots, selected, dispatch }: {
  series: ChartSeries
  plot: ChartPlot
  plots: readonly ChartPlot[]
  selected: boolean
  dispatch: (a: PlotAction) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const removable = !(series.type === 'instrument' && series.primary)

  /*
   * The plots this series could actually move to.
   *
   * An overlay belongs on a price scale and a study on its own, so the
   * list is filtered by the same rule the reducer enforces. Offering an
   * incompatible plot and then refusing the move is how a menu teaches an
   * analyst to distrust it.
   */
  const moveTargets = series.type === 'indicator'
    ? plots.filter(p => p.id !== plot.id
        && (isOverlay(series.kind) ? p.kind === 'price' : p.kind === 'study'))
    : []

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
      {(removable || moveTargets.length > 0) && (
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen(v => !v)}
            title={`${seriesLabel(series)} options`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <MenuItem onClick={() => { dispatch({ type: 'toggleSeries', seriesId: series.id }); setMenuOpen(false) }}>
                  {series.visible ? 'Hide' : 'Show'}
                </MenuItem>
                {moveTargets.length > 0 && (
                  <>
                    <p className="px-3 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                      Move to plot
                    </p>
                    {moveTargets.map(t => (
                      <MenuItem
                        key={t.id}
                        onClick={() => {
                          dispatch({ type: 'moveSeries', seriesId: series.id, toPlotId: t.id })
                          setMenuOpen(false)
                        }}
                      >
                        {t.title}
                      </MenuItem>
                    ))}
                  </>
                )}
                {removable && (
                  <MenuItem danger onClick={() => { dispatch({ type: 'removeSeries', seriesId: series.id }); setMenuOpen(false) }}>
                    Remove
                  </MenuItem>
                )}
              </div>
            </>
          )}
        </div>
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
function PropertiesSection({ selectedSeries, selectedPlot, dispatch }: {
  selectedSeries: ChartSeries | null
  selectedPlot: ChartPlot | null
  dispatch: (a: PlotAction) => void
}) {
  /*
   * The area keeps its place when nothing is selected, rather than
   * appearing and shoving the tree upward the first time a row is clicked.
   */
  if (!selectedSeries && !selectedPlot) {
    return (
      <div data-charting-properties className="border-t border-gray-200 px-3 py-3 dark:border-gray-700">
        <p className="text-[11px] italic text-gray-400">
          Select a plot or series to see its properties.
        </p>
      </div>
    )
  }

  return (
    <div data-charting-properties className="max-h-[45%] overflow-y-auto border-t border-gray-200 px-3 py-2 dark:border-gray-700">
      <h3 className="mb-2 truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400" title={selectedSeries ? seriesLabel(selectedSeries) : selectedPlot?.title}>
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

          {/*
            A comparison says what it is and where its scale is set, rather
            than leaving an analyst to work out why MSFT at $400 and AAPL
            at $350 share an axis. The control itself stays on the plot,
            because the scale belongs to the axis, not to one series.
          */}
          {selectedSeries.type === 'instrument' && !selectedSeries.primary && (
            <p className="mt-2 text-[11px] text-gray-400">
              Comparison series. Set Absolute, Indexed or % Change on the plot.
            </p>
          )}

          <label className="mt-3 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={selectedSeries.visible}
              onChange={() => dispatch({ type: 'toggleSeries', seriesId: selectedSeries.id })}
              className="h-3 w-3"
            />
            Visible
          </label>
        </>
      )}

      {!selectedSeries && selectedPlot && (
        <>
          <p className="mb-2 text-[11px] text-gray-400">
            {selectedPlot.kind === 'price'
              ? 'Price plot. Instruments and overlays share its scale.'
              : 'Study plot. Drawn on its own scale.'}
          </p>

          <label className="mb-2 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={selectedPlot.visible}
              onChange={() => dispatch({ type: 'togglePlot', plotId: selectedPlot.id })}
              className="h-3 w-3"
            />
            Visible
          </label>

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
