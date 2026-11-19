import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useIsMobile } from '../hooks/useMediaQuery'
import {
  LineChart, Search, Plus, ChevronDown, TrendingUp, TrendingDown,
  BarChart3, CandlestickChart, Activity, Layers, Settings, Maximize2,
  Download, Share2, Star, Clock, Grid3X3, LayoutGrid, Calendar, X,
  DollarSign, BarChart2, PieChart, Percent, TrendingUp as TrendIcon,
  Minus, ArrowRight, Square, Circle, Type, Trash2, Undo2, Redo2
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { ProChart, ChartType, TimeFrame, IndicatorType, CustomDateRange } from '../components/charting'
import { InstrumentHeader } from '../components/charting/workspace/InstrumentHeader'
import type { SeriesMeta } from '../components/charting/workspace/series-meta'
import { DrawingPalette } from '../components/charting/workspace/DrawingPalette'
import { AnnotationInspector } from '../components/charting/workspace/AnnotationInspector'
import { armedCaption, toolForKey } from '../components/charting/workspace/drawing-tools'
/*
 * `hooks/useAuth`, NOT `contexts/AuthContext`.
 *
 * There are two useAuth implementations in this codebase and only one of them
 * works at runtime:
 *
 *   hooks/useAuth.ts        a standalone hook; reads the Supabase session
 *                           directly. No provider, no context. 255 call sites.
 *   contexts/AuthContext    a React context whose useAuth THROWS
 *                           'useAuth must be used within an AuthProvider'
 *                           when no provider is above it.
 *
 * `<AuthProvider>` is rendered NOWHERE in this application -- App.tsx mounts
 * QueryClient, Theme, Toast, Capture, Organization and CoverageRelevance, and
 * no AuthProvider. So the context version throws on its first render, always.
 *
 * This file imported the context version, which crashed the whole Charting
 * route the moment it was opened in production. `hooks/useAuth` returns a
 * superset of the same shape, so `{ user }` is unchanged.
 *
 * Enforced by src/pages/__tests__/charting-auth-context.test.tsx, which also
 * checks the general invariant rather than just this one file.
 */
import { useAuth } from '../hooks/useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  chartingWorkspaceKey,
  readChartingWorkspace,
  writeChartingWorkspace,
} from '../lib/charting/workspace-state'
import { useInstrumentSearch } from '../hooks/useInstrumentSearch'
import {
  recordRecentInstrument,
  type RecentInstrument,
} from '../lib/charting/recent-instruments'
import { useRecentInstruments } from '../hooks/useRecentInstruments'
import {
  initialPlots, migrateToPlots, plotReducer, derivePlotSpecs, deriveOverlays,
  deriveComparisons, volumeVisible, type PanelPlots, type PlotAction,
} from '../lib/charting/plot-model'
import { AnalysisPanel } from '../components/charting/workspace/AnalysisPanel'
import {
  CHARTING_WORKSPACE_CODEC,
  type ChartPanel,
  type ChartingWorkspace,
  type DisplayMode,
  type LineStyleOption,
  type MetricType,
  type ViewMode,
} from '../lib/charting/workspace-codec'
import {
  Annotation,
  AnnotationType,
  DEFAULT_ANNOTATION_STYLE,
} from '../components/charting/engine/annotations'
import {
  annotationFromPoints,
  isTwoPointTool,
} from '../lib/charting/annotation-geometry'
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commit as historyCommit,
  createHistory,
  present as historyPresent,
  redo as historyRedo,
  reset as historyReset,
  undo as historyUndo,
} from '../lib/charting/annotation-history'


// Default index base value
const DEFAULT_INDEX_BASE = 100

// Colors for comparison symbols (different from main chart's blue)
const COMPARISON_COLORS = [
  '#dc2626', // red
  '#16a34a', // green
  '#9333ea', // purple
  '#ea580c', // orange
  '#0891b2', // cyan
  '#be185d', // pink
  '#854d0e', // amber
  '#6366f1', // indigo
]

const displayModeOptions: { value: DisplayMode; label: string; description: string }[] = [
  { value: 'absolute', label: 'Absolute', description: 'Show actual stock prices' },
  { value: 'indexed', label: 'Indexed', description: 'All stocks start at 100' },
  { value: 'relative', label: '% Change', description: 'Show % change from start (0%)' },
]

const metricOptions: { value: MetricType; label: string; icon: any; description: string }[] = [
  { value: 'price', label: 'Price', icon: DollarSign, description: 'Stock price (OHLC)' },
  { value: 'volume', label: 'Volume', icon: BarChart2, description: 'Trading volume' },
  { value: 'market_cap', label: 'Market Cap', icon: PieChart, description: 'Market capitalization' },
  { value: 'pe_ratio', label: 'P/E Ratio', icon: Percent, description: 'Price to earnings ratio' },
  { value: 'eps', label: 'EPS', icon: TrendIcon, description: 'Earnings per share' },
  { value: 'revenue', label: 'Revenue', icon: BarChart2, description: 'Quarterly revenue' },
  { value: 'dividend_yield', label: 'Div Yield', icon: Percent, description: 'Dividend yield %' },
]

// Annotation tool options for context menu
const annotationTools: { type: AnnotationType; label: string; icon: any }[] = [
  { type: 'horizontal-line', label: 'Horizontal Line', icon: Minus },
  { type: 'vertical-line', label: 'Vertical Line', icon: Minus },
  { type: 'trend-line', label: 'Trend Line', icon: TrendIcon },
  { type: 'ray', label: 'Ray', icon: ArrowRight },
  { type: 'rectangle', label: 'Rectangle', icon: Square },
  { type: 'ellipse', label: 'Ellipse', icon: Circle },
  { type: 'fibonacci', label: 'Fibonacci', icon: Layers },
  { type: 'text', label: 'Text', icon: Type },
  { type: 'arrow', label: 'Arrow', icon: ArrowRight },
]

/**
 * The style a newly drawn mark carries.
 *
 * Two deliberate differences from the local object this replaces: there is no
 * `fillColor` equal to the stroke colour (a filled shape at full stroke
 * colour hides the series underneath it), and there is no `label`. The old
 * code wrote `label: `$${price.toFixed(2)}`` onto every horizontal line,
 * which hardcodes a currency the asset may not quote in -- a pence-quoted
 * holding got a dollar sign on a hundredfold-wrong figure -- and froze a
 * number the renderer can read off `price` itself.
 */
const NEW_ANNOTATION_STYLE = {
  ...DEFAULT_ANNOTATION_STYLE,
  color: '#2563eb',
  lineWidth: 2,
  fillOpacity: 0.12,
  fontSize: 12,
}

/** Ids are minted here; the geometry module stays pure and has no clock. */
function newAnnotationId(): string {
  return `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

interface ChartingPageProps {
  onItemSelect?: (item: any) => void
  initialSymbol?: string
  /**
   * The tab this workspace belongs to.
   *
   * Part of the persistence key, so two Charting tabs keep separate
   * selections. Optional because a caller that does not supply one gets the
   * old behaviour — a fresh workspace each mount — rather than silently
   * sharing one slot with every other caller.
   */
  workspaceId?: string
}

/*
 * `ViewMode`, `ChartPanel` and `ChartingWorkspace` moved to
 * `lib/charting/workspace-codec`, together with the codec that restores
 * them from storage. The codec is defined over these types, and a `.tsx`
 * file cannot export it without breaking Fast Refresh.
 */

// Context menu state
interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  chartX: number  // Position in chart coordinates (time)
  chartY: number  // Position in chart coordinates (price)
}

// Line context menu state
interface LineContextMenuState {
  visible: boolean
  x: number
  y: number
  symbol: string
  isMainSymbol: boolean
}


const LINE_COLORS = [
  { value: '#dc2626', label: 'Red' },
  { value: '#16a34a', label: 'Green' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#9333ea', label: 'Purple' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#0891b2', label: 'Cyan' },
  { value: '#be185d', label: 'Pink' },
  { value: '#854d0e', label: 'Amber' },
]

const LINE_WIDTHS = [1, 2, 3, 4]
const LINE_STYLES: { value: LineStyleOption; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
]

/**
 * Available bar width below which the secondary controls collapse into the
 * Analysis panel.
 *
 * The right-hand group is 1063px intrinsic and the symbol search side is
 * ~192px, so the bar needs about 1255px to lay out flat. 1280 is the first
 * round number above that, which means the collapse happens just BEFORE the
 * overflow rather than during it.
 */
export const TOOLBAR_COMPACT_PX = 1280

/**
 * Below this, the eight timeframe buttons also collapse to a select.
 *
 * With the secondary controls already in the Analysis panel the bar is
 * search + timeframe pill + chart type + Analysis, roughly 192 + 492 + 132 +
 * 110 = 926px of content. 960 is where that stops fitting.
 */
export const TOOLBAR_TIGHT_PX = 960

/**
 * Below this, the instrument block drops its provenance chips.
 *
 * Measured on the integrated build at 390px of toolbar: the left group
 * wants 603px and is given 358, so it overflowed by 245. The chips --
 * "262 bars · 1wk", the provider, the freshness -- are about 230 of that
 * 603, and the company name truncates to absorb the rest.
 *
 * 720 rather than `TOOLBAR_TIGHT_PX`: at 768 and at 960 the full block
 * still FITS, and a chip that fits is not worth hiding. 600 was the first
 * measured width that overflowed (by 35px), so the threshold sits just
 * above it.
 *
 * The basis chip is deliberately not included. See `InstrumentHeader`.
 */
export const TOOLBAR_META_PX = 720

// Frequency/Interval configuration
type FrequencyType =
  | '1min' | '3min' | '5min' | '10min' | '15min' | '30min' | '60min' | '120min' | '240min'
  | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

interface FrequencyConfig {
  label: string
  intervals: string[]
  apiInterval: string // Yahoo Finance interval mapping
}

/*
 * ── Every option now asks for its own bar size ───────────────────────────
 *
 * Six of these used to ask for a DIFFERENT size than their label, and said
 * so in a trailing comment:
 *
 *   '3 Min'     apiInterval: '5m'   // Closest available
 *   '10 Min'    apiInterval: '15m'  // Closest available
 *   '120 Min'   apiInterval: '1h'   // Will aggregate
 *   '240 Min'   apiInterval: '1h'   // Will aggregate
 *   'Quarterly' apiInterval: '1mo'  // Will aggregate
 *   'Yearly'    apiInterval: '1mo'  // Will aggregate
 *
 * The aggregation those comments promised was never written. Picking
 * "240 Min" drew hourly bars while the control went on reading 240 Min, and
 * a reader measuring a move against the wrong bar width has nothing on
 * screen to tell them. All six are exact multiples of a published size, and
 * `lib/market-data/resample` now builds all six, so each one asks for
 * itself.
 *
 * 'Tick' is gone. EODHD publishes no tick stream and a 1m bar is not a tick
 * at any multiple, so there was nothing to build it from -- it was being
 * served minute bars under a label promising individual trades. Removing an
 * option is the honest form of not having it.
 */
const historicalFrequencies: Record<string, FrequencyConfig> = {
  daily: { label: 'Daily', intervals: ['3M', '6M', '1Y', '2Y', '3Y', '5Y'], apiInterval: '1d' },
  weekly: { label: 'Weekly', intervals: ['1Y', '2Y', '3Y', '4Y', '5Y', '10Y'], apiInterval: '1wk' },
  monthly: { label: 'Monthly', intervals: ['5Y', '10Y', '15Y', '20Y', '25Y', '30Y'], apiInterval: '1mo' },
  quarterly: { label: 'Quarterly', intervals: ['10Y', '20Y', '30Y', '40Y', '50Y'], apiInterval: '1q' },
  yearly: { label: 'Yearly', intervals: ['10Y', '20Y', '30Y', '40Y', '50Y'], apiInterval: '1y' }
}

const intradayFrequencies: Record<string, FrequencyConfig> = {
  '1min': { label: '1 Min', intervals: ['1D', '2D', '3D', '4D', '5D'], apiInterval: '1m' },
  '3min': { label: '3 Min', intervals: ['1D', '2D', '3D', '4D', '5D', '10D'], apiInterval: '3m' },
  '5min': { label: '5 Min', intervals: ['1D', '2D', '3D', '4D', '5D', '10D'], apiInterval: '5m' },
  '10min': { label: '10 Min', intervals: ['3D', '4D', '5D', '10D', '20D', '30D'], apiInterval: '10m' },
  '15min': { label: '15 Min', intervals: ['3D', '4D', '5D', '10D', '20D', '30D'], apiInterval: '15m' },
  '30min': { label: '30 Min', intervals: ['10D', '20D', '30D', '60D', '3M', '6M'], apiInterval: '30m' },
  '60min': { label: '60 Min', intervals: ['10D', '20D', '30D', '60D', '3M', '6M'], apiInterval: '1h' },
  '120min': { label: '120 Min', intervals: ['10D', '20D', '30D', '60D', '3M', '6M'], apiInterval: '2h' },
  '240min': { label: '240 Min', intervals: ['10D', '20D', '30D', '60D', '3M', '6M'], apiInterval: '4h' }
}

// Convert interval string to days/months for date calculation
function parseIntervalToDays(interval: string): number {
  const value = parseInt(interval)
  if (interval.endsWith('D')) return value
  if (interval.endsWith('M')) return value * 30
  if (interval.endsWith('Y')) return value * 365
  return 30 // Default
}


// Get fresh default state, used only when nothing was stored for this tab.
function getDefaultChartingState(): ChartingWorkspace {
  return {
    panels: [{ id: '1', symbol: '', companyName: '', chartType: 'line' as ChartType, timeFrame: '1M' as TimeFrame, indicators: [] as string[], metric: 'price' as MetricType, annotations: [] as Annotation[], compareSymbols: [], displayMode: 'absolute' as DisplayMode, indexBase: DEFAULT_INDEX_BASE }],
    activePanel: '1',
    viewMode: 'single' as ViewMode
  }
}

// `onItemSelect` stays in the props -- DashboardPage passes it -- but it is
// not destructured, because nothing in this page reads it. That was already
// true before this change; adding a parameter beside it is what made the
// lint rule attribute it to a new line.
export function ChartingPage({ initialSymbol, workspaceId }: ChartingPageProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  /*
   * The workspace key carries the principal, so a different account or
   * organization reads a different entry and cannot see this one's symbols
   * or comparisons. Partitioned by construction rather than by remembering
   * to clear — though the principal change clears the map too.
   */
  const workspaceKey = chartingWorkspaceKey(user?.id, currentOrgId, workspaceId)

  /*
   * Re-checked against live authorization, not merely read off disk. The
   * stored list was authorized when it was WRITTEN; access can be withdrawn
   * afterwards, and localStorage would never know. See
   * `useRecentInstruments` -- it fails closed.
   *
   * `recordedRecents` holds what this session has just selected, so a pick
   * appears in the list immediately instead of waiting for the next
   * validation round trip.
   */
  /*
   * Declared HERE, immediately before the derivation that reads it.
   *
   * It first sat with the other `useState` calls further down, which put it
   * in the temporal dead zone of the `const recents = ...` line above --
   * "Cannot access 'recordedRecents' before initialization", thrown on every
   * render of the page. A `const` is not hoisted the way a `var` is, and the
   * charting route test caught it. This codebase has shipped that exact
   * error in banner code before; keeping the declaration adjacent to its
   * only consumer is what stops it recurring.
   *
   * Null rather than [] so "nothing recorded yet" stays distinguishable
   * from "recorded, and the result was empty".
   */
  const [recordedRecents, setRecordedRecents] = useState<RecentInstrument[] | null>(null)

  /*
   * ── The toolbar measures ITSELF, not the window ─────────────────────────
   *
   * Measured at a 1920px viewport, the right-hand control group is 1063px
   * intrinsic: timeframe pill 492, chart type 132, metric 90, indicators
   * 105, compare 100, view mode 68, add 28, plus gaps. Below roughly 1250px
   * of available bar it has nowhere to go and overflows.
   *
   * The breakpoints are driven by a `ResizeObserver` on the bar rather than
   * by a media query because this page is a TAB inside a workspace. A
   * viewport query cannot see a sidebar opening or a split pane narrowing
   * the tab, so it would keep the wide layout in a container that no longer
   * fits -- which is the defect being fixed, not a smaller version of it.
   */
  const [toolbarWidth, setToolbarWidth] = useState(0)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = toolbarRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setToolbarWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setToolbarWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  /*
   * Zero means "not measured yet". Treating it as narrow would flash the
   * collapsed toolbar on every mount before the observer's first callback,
   * which is the same class of layout jump this work exists to remove.
   */
  const compactControls = toolbarWidth > 0 && toolbarWidth < TOOLBAR_COMPACT_PX
  const compactTimeframe = toolbarWidth > 0 && toolbarWidth < TOOLBAR_TIGHT_PX
  const denseInstrument = toolbarWidth > 0 && toolbarWidth < TOOLBAR_META_PX
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false)

  /*
   * There is deliberately NO effect closing this at wide widths any more.
   *
   * It used to close itself whenever the toolbar was wide enough to show
   * the secondary controls inline, because the flag then meant "the
   * overflow popover is open" and a popover with nothing in it would have
   * lit the button for no reason.
   *
   * The flag now means "the Analysis panel is open", and that panel is the
   * only route to Add Plot and Add Series. Closing it on a wide screen
   * made the button do nothing at exactly the sizes an analyst works at.
   */
  const { recents: authorizedRecents } = useRecentInstruments(user?.id, currentOrgId)
  const recents = recordedRecents ?? authorizedRecents

  /*
   * Restored, not reset.
   *
   * This page is unmounted outright whenever another tab becomes active, so
   * a `useState` default meant the selected asset, timeframe and indicators
   * were rebuilt from scratch on every return. Reading the stored workspace
   * first is the whole fix for that.
   */
  const [initialState] = useState<ChartingWorkspace>(
    () => readChartingWorkspace<ChartingWorkspace>(workspaceKey, CHARTING_WORKSPACE_CODEC)
      ?? getDefaultChartingState(),
  )

  // Track symbols that have been added via initialSymbol to avoid duplicates
  const [addedSymbols, setAddedSymbols] = useState<Set<string>>(new Set())

  const [searchQuery, setSearchQuery] = useState('')
  /*
   * The recents panel opens on FOCUS with an empty box, so focus has to be
   * state rather than a CSS `:focus-within` — the panel has to survive the
   * click that lands on one of its own rows.
   */
  const [searchFocused, setSearchFocused] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(initialState.viewMode)
  // The chart is the surface; on a phone the toolbar has to yield to it.
  const isMobileViewport = useIsMobile()
  const [panels, setPanels] = useState<ChartPanel[]>(initialState.panels)
  const [activePanel, setActivePanel] = useState(initialState.activePanel)
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false)
  const [showFreqPicker, setShowFreqPicker] = useState(false)
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false)
  const [showMetricMenu, setShowMetricMenu] = useState(false)
  const [showCompareMenu, setShowCompareMenu] = useState(false)
  const [compareSearchQuery, setCompareSearchQuery] = useState('')
  const [showDisplayModeMenu, setShowDisplayModeMenu] = useState(false)

  /*
   * Persist on every change, so an unmount needs no warning.
   *
   * An unmount-time save would be the obvious alternative and is the wrong
   * shape: React does not guarantee an effect cleanup runs with the latest
   * state when a parent stops rendering the child, and this page is removed
   * by exactly that. Writing as the state changes means the stored copy is
   * already current whenever the page disappears.
   *
   * The open/closed state of the menus above is deliberately NOT stored. A
   * reopened tab showing the indicator menu already open would be restoring
   * a transient, not a choice.
   */
  useEffect(() => {
    writeChartingWorkspace<ChartingWorkspace>(
      workspaceKey,
      { panels, activePanel, viewMode },
      CHARTING_WORKSPACE_CODEC,
    )
  }, [workspaceKey, panels, activePanel, viewMode])

  // Context menu state for right-click annotations
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    chartX: 0,
    chartY: 0
  })
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null)
  /*
   * What the chart last drew: last close, bar count, interval, feed, basis.
   * Reported up by ProChart because only the fetch knows it. Cleared when
   * the symbol changes, so the header cannot show one instrument's price
   * beside another instrument's name while the new series loads.
   */
  const [seriesMeta, setSeriesMeta] = useState<SeriesMeta | null>(null)

  /**
   * The drawing tool in hand, or null for an ordinary pointer.
   *
   * Only a two-point tool is ever armed. A horizontal line, a vertical line
   * and a text note are each fully described by the single point the reader
   * right-clicked, so those still commit immediately from the context menu
   * -- arming them would ask for a drag that carries no information.
   */
  const [activeTool, setActiveTool] = useState<AnnotationType | null>(null)

  /**
   * Undo history for the ACTIVE panel's marks.
   *
   * There was none: `grep -rniE "undo|redo"` over this file and all of
   * `components/charting` returned nothing, so the only way back from a
   * misplaced mark was "Clear All Annotations", which takes every other mark
   * on the panel with it.
   *
   * `panels` stays the single source of truth for what is drawn; this holds
   * snapshots beside it. The invariant -- that `present(history)` equals the
   * active panel's annotations -- is maintained by routing every mutation
   * through `setAnnotations` below, and restored by `historyReset` whenever
   * the panel or its symbol changes.
   */
  const [history, setHistory] = useState(() =>
    createHistory<Annotation[]>(
      initialState.panels.find(p => p.id === initialState.activePanel)?.annotations ?? [],
    ),
  )

  // Line context menu state for formatting lines
  const [lineContextMenu, setLineContextMenu] = useState<LineContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    symbol: '',
    isMainSymbol: false
  })

  // Selected line state for left-click selection
  const [selectedLine, setSelectedLine] = useState<string | null>(null)

  // Custom date picker state
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [customInterval, setCustomInterval] = useState<CustomDateRange['interval']>('1d')

  // Handle initial symbol - add it as a panel when provided
  useEffect(() => {
    if (!initialSymbol || addedSymbols.has(initialSymbol)) return

    // Mark this symbol as added to prevent duplicates
    setAddedSymbols(prev => new Set(prev).add(initialSymbol))

    // Fetch asset data to get company name
    const fetchAssetAndAddPanel = async () => {
      let companyName = ''
      try {
        /* The generated Supabase types do not describe `assets`, so an
           unannotated destructure infers `never`. Same cast as the recents
           authorization path uses, for the same reason. */
        const { data } = (await supabase
          .from('assets')
          .select('company_name')
          .eq('symbol', initialSymbol)
          .single()) as { data: { company_name: string | null } | null }
        if (data) {
          companyName = data.company_name || ''
        }
      } catch (error) {
        console.warn('Could not fetch asset data for symbol:', initialSymbol)
      }

      setPanels(currentPanels => {
        // Check if this symbol is already in a panel
        const existingPanel = currentPanels.find(p => p.symbol === initialSymbol)
        if (existingPanel) {
          // Just activate the existing panel
          setActivePanel(existingPanel.id)
          return currentPanels
        }

        // Check if the first panel is empty (no symbol set)
        const firstPanel = currentPanels[0]
        if (firstPanel && !firstPanel.symbol) {
          // Update the empty first panel with this symbol
          setActivePanel(firstPanel.id)
          return currentPanels.map(p =>
            p.id === firstPanel.id
              ? { ...p, symbol: initialSymbol, companyName }
              : p
          )
        } else {
          // Add a new panel
          const newId = String(Date.now())
          setActivePanel(newId)
          return [...currentPanels, {
            id: newId,
            symbol: initialSymbol,
            companyName,
            chartType: 'line' as ChartType,
            timeFrame: '1M' as TimeFrame,
            indicators: [],
            metric: 'price' as MetricType,
            annotations: [],
            compareSymbols: [],
            displayMode: 'absolute' as DisplayMode,
            indexBase: DEFAULT_INDEX_BASE
          }]
        }
      })
    }

    fetchAssetAndAddPanel()
  }, [initialSymbol, addedSymbols])

  /*
   * Debounced, rank-ordered, and fetched so the exact ticker is actually in
   * the result set. The previous query ranked by arrival order and let the
   * DATABASE apply the limit, so "CAT" offered Zoom Video Communi-CAT-ions
   * above Caterpillar and "V" put Visa fifth. See `useInstrumentSearch`.
   */
  const { results: searchResults } = useInstrumentSearch(searchQuery)

  /*
   * The comparison picker had the identical defect and now shares the
   * identical fix. Two copies of this query is how they drifted apart in
   * the first place.
   */
  const { results: compareSearchResults } = useInstrumentSearch(compareSearchQuery)

  const timeFrames: TimeFrame[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', 'ALL']


  const chartTypes: { value: ChartType; label: string; icon: any }[] = [
    { value: 'line', label: 'Line', icon: LineChart },
    { value: 'candlestick', label: 'Candlestick', icon: CandlestickChart },
    { value: 'bar', label: 'Bar', icon: BarChart3 },
    { value: 'area', label: 'Area', icon: Activity }
  ]

  const indicators = [
    { id: 'sma', name: 'SMA', category: 'Moving Averages' },
    { id: 'ema', name: 'EMA', category: 'Moving Averages' },
    { id: 'bollinger', name: 'Bollinger Bands', category: 'Moving Averages' },
    { id: 'rsi', name: 'RSI', category: 'Oscillators' },
    { id: 'macd', name: 'MACD', category: 'Oscillators' },
    { id: 'stochastic', name: 'Stochastic', category: 'Oscillators' },
    { id: 'volume', name: 'Volume', category: 'Volume' },
    { id: 'obv', name: 'OBV', category: 'Volume' },
    { id: 'vwap', name: 'VWAP', category: 'Volume' },
    { id: 'atr', name: 'ATR', category: 'Volatility' },
    { id: 'adx', name: 'ADX', category: 'Trend' },
    { id: 'ichimoku', name: 'Ichimoku Cloud', category: 'Trend' }
  ]

  const updatePanel = useCallback((panelId: string, updates: Partial<ChartPanel>) => {
    setPanels(prev => prev.map(p => p.id === panelId ? { ...p, ...updates } : p))
  }, [])

  const addPanel = () => {
    const newId = String(Date.now())
    setPanels([...panels, {
      id: newId,
      symbol: '',
      companyName: '',
      chartType: 'line',
      timeFrame: '1M',
      indicators: [],
      metric: 'price',
      annotations: [],
      compareSymbols: [],
      displayMode: 'absolute',
      indexBase: DEFAULT_INDEX_BASE
    }])
    setActivePanel(newId)
  }

  // Context menu handlers
  const handleChartContextMenu = useCallback((e: React.MouseEvent, chartTime: number, chartPrice: number) => {
    e.preventDefault()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      chartX: chartTime,
      chartY: chartPrice
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  /**
   * The ONE way the active panel's marks change.
   *
   * Every path -- drawing, deleting, clearing -- goes through here, which is
   * what keeps the undo history and the drawn marks from drifting apart. A
   * second writer that skipped this would leave Ctrl+Z restoring a state the
   * chart was never in.
   */
  const setAnnotations = useCallback((next: Annotation[]) => {
    updatePanel(activePanel, { annotations: next })
    setHistory(h => historyCommit(h, next))
  }, [activePanel, updatePanel])

  /**
   * Pick a tool from the context menu.
   *
   * A one-point mark commits where it was right-clicked, because that click
   * is the whole gesture. A two-point mark instead ARMS the tool: the reader
   * then drags on the chart and the mark is built from the two points they
   * actually indicated. Before this, a two-point mark was stamped at the
   * click with its far end derived by arithmetic -- every trend line thirty
   * days long and up exactly 5%, with no way to drag it afterwards.
   */
  const addAnnotation = useCallback((type: AnnotationType) => {
    if (isTwoPointTool(type)) {
      setActiveTool(type)
      closeContextMenu()
      return
    }

    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    const at = { time: contextMenu.chartX, price: contextMenu.chartY }
    const created = annotationFromPoints(type, at, at, NEW_ANNOTATION_STYLE, newAnnotationId())
    if (created) setAnnotations([...panel.annotations, created])
    closeContextMenu()
  }, [activePanel, panels, contextMenu, setAnnotations, closeContextMenu])

  /**
   * A mark is mid-drag: redraw it, but record nothing.
   *
   * Deliberately NOT routed through `setAnnotations`. A drag emits a frame
   * per mouse move, and recording each would fill the undo history with a
   * hundred near-identical states, so one Ctrl+Z would appear to do nothing
   * and fifty would be needed to get back.
   */
  const previewAnnotation = useCallback((next: Annotation) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return
    updatePanel(activePanel, {
      annotations: panel.annotations.map(a => (a.id === next.id ? next : a)),
    })
  }, [activePanel, panels, updatePanel])

  /** The drag ended: this is the one undoable step for the whole gesture. */
  const commitAnnotationChange = useCallback((next: Annotation) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return
    setAnnotations(panel.annotations.map(a => (a.id === next.id ? next : a)))
  }, [activePanel, panels, setAnnotations])

  /** A two-point tool finished its drag; the mark is already built. */
  const handleAnnotationDraw = useCallback((annotation: Annotation) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return
    setAnnotations([...panel.annotations, annotation])
    /*
     * One mark per selection, then back to the pointer.
     *
     * A tool that stayed armed turns the next pan into another mark, and
     * because a drawing suppresses panning there is no feedback that the
     * chart has stopped responding the way it did a moment ago.
     */
    setActiveTool(null)
  }, [activePanel, panels, setAnnotations])

  const deleteAnnotation = useCallback((annotationId: string) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    setAnnotations(panel.annotations.filter(a => a.id !== annotationId))
    setSelectedAnnotation(null)
  }, [activePanel, panels, setAnnotations])

  const clearAllAnnotations = useCallback(() => {
    setAnnotations([])
    closeContextMenu()
  }, [setAnnotations, closeContextMenu])

  const undoAnnotations = useCallback(() => {
    setHistory(h => {
      if (!historyCanUndo(h)) return h
      const back = historyUndo(h)
      updatePanel(activePanel, { annotations: historyPresent(back) })
      return back
    })
    setSelectedAnnotation(null)
  }, [activePanel, updatePanel])

  const redoAnnotations = useCallback(() => {
    setHistory(h => {
      if (!historyCanRedo(h)) return h
      const forward = historyRedo(h)
      updatePanel(activePanel, { annotations: historyPresent(forward) })
      return forward
    })
  }, [activePanel, updatePanel])

  /**
   * A change of panel or symbol starts a new undo context.
   *
   * Without this, Ctrl+Z after switching the panel to another asset would
   * restore the PREVIOUS asset's marks onto this one -- a cross-asset trend
   * line that looks like analysis and is not. `historyReset` replaces the
   * present without recording a step and drops any pending redo.
   *
   * The guard on `lastContextRef` is what lets `panels` stay in the
   * dependency list honestly: the effect re-runs on every mark drawn, and
   * without the key comparison it would reset the history each time and
   * undo would never do anything.
   */
  const lastContextRef = useRef<string>('')
  useEffect(() => {
    const panel = panels.find(p => p.id === activePanel)
    const key = `${activePanel}:${panel?.symbol ?? ''}`
    if (key === lastContextRef.current) return
    lastContextRef.current = key
    setHistory(historyReset<Annotation[]>(panel?.annotations ?? []))
    setActiveTool(null)
  }, [activePanel, panels])

  /* Ctrl/Cmd+Z to undo, with Shift to redo; Escape puts the tool down. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      /*
       * Escape puts down the tool, and failing that drops the selection --
       * in that order, because a reader with a tool in hand who presses
       * Escape means "stop drawing", not "deselect something else".
       */
      if (e.key === 'Escape') {
        if (activeTool) setActiveTool(null)
        else setSelectedAnnotation(null)
        return
      }

      /* Delete removes the selected mark, which until now could only be
         removed by clearing every mark on the panel. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotation) {
        const target = e.target as HTMLElement | null
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return
        }
        e.preventDefault()
        deleteAnnotation(selectedAnnotation)
        return
      }
      /*
       * A bare letter arms a tool, the way every professional chart does.
       *
       * Guarded three ways, in this order. No modifier, because Ctrl+S is the
       * browser's and Alt+H may be the operating system's. No typing target,
       * because the page carries a symbol search and an `H` typed into it
       * must stay an `H` -- the same guard the undo shortcut below already
       * applies, for the same reason. And no unknown key, so the handler
       * passes everything it does not claim straight through.
       */
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
        const typing = e.target as HTMLElement | null
        if (
          typing &&
          (typing.tagName === 'INPUT' ||
            typing.tagName === 'TEXTAREA' ||
            typing.isContentEditable)
        ) {
          return
        }
        const tool = toolForKey(e.key)
        if (tool) {
          e.preventDefault()
          setActiveTool(tool.type)
          /* Picking up a tool drops the selection: the next press is going to
             draw, not move what was selected, and leaving a mark lit would
             say otherwise. */
          if (tool.type) setSelectedAnnotation(null)
          return
        }
      }

      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      /*
       * Never steal the shortcut from a field being typed in. The page
       * carries a symbol search and the note editor, where Ctrl+Z means undo
       * the TEXT -- and taking it would silently remove a chart mark instead,
       * somewhere the reader is not looking.
       */
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      if (e.shiftKey) redoAnnotations()
      else undoAnnotations()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoAnnotations, redoAnnotations, activeTool, selectedAnnotation, deleteAnnotation])

  // Line context menu handlers
  const handleLineContextMenu = useCallback((e: React.MouseEvent, symbol: string, isMainSymbol: boolean) => {
    e.preventDefault()
    setLineContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      symbol,
      isMainSymbol
    })
  }, [])

  const closeLineContextMenu = useCallback(() => {
    setLineContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // Close line context menu when clicking outside
  useEffect(() => {
    if (!lineContextMenu.visible) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Check if click is inside the context menu
      if (target.closest('[data-line-context-menu]')) return
      closeLineContextMenu()
    }

    // Use mousedown so it fires before contextmenu
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [lineContextMenu.visible, closeLineContextMenu])

  // Handle left-click on line to select it
  const handleLineClick = useCallback((symbol: string, isMainSymbol: boolean) => {
    // Toggle selection - if already selected, deselect; otherwise select
    setSelectedLine(prev => prev === symbol ? null : symbol)
  }, [])

  const updateCompareSymbolStyle = useCallback((symbolToUpdate: string, updates: { color?: string; lineWidth?: number; lineStyle?: LineStyleOption }) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== activePanel || !p.compareSymbols) return p
      return {
        ...p,
        compareSymbols: p.compareSymbols.map(cs =>
          cs.symbol === symbolToUpdate ? { ...cs, ...updates } : cs
        )
      }
    }))
  }, [activePanel])

  const updateMainSymbolStyle = useCallback((updates: { color?: string; lineWidth?: number; lineStyle?: LineStyleOption }) => {
    setPanels(prev => prev.map(p => {
      if (p.id !== activePanel) return p
      return {
        ...p,
        mainSymbolStyle: { ...(p.mainSymbolStyle || {}), ...updates }
      }
    }))
  }, [activePanel])

  const removePanel = (panelId: string) => {
    if (panels.length > 1) {
      const newPanels = panels.filter(p => p.id !== panelId)
      setPanels(newPanels)
      if (activePanel === panelId) {
        setActivePanel(newPanels[0].id)
      }
    }
  }

  const selectAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    const panel = panels.find(p => p.id === activePanel)
    /*
     * Changing the instrument moves the PRIMARY series and leaves the rest
     * of the arrangement alone. An analyst who built four plots and then
     * looked at a different name did not ask for their plots back.
     */
    const nextPlots = panel?.plots
      ? plotReducer(panel.plots, {
          type: 'setPrimarySymbol',
          symbol: asset.symbol,
          assetId: asset.id,
          companyName: asset.company_name,
        })
      : undefined
    updatePanel(activePanel, {
      symbol: asset.symbol,
      companyName: asset.company_name,
      assetId: asset.id,
      ...(nextPlots ? { plots: nextPlots } : {}),
    })
    setSearchQuery('')
    setSearchFocused(false)
    /*
     * Recorded here because this is the ONE funnel every chart symbol
     * passes through — the typed search, a recents click, and a symbol
     * opened from elsewhere all land on it. Recording at the dropdown's
     * click handler instead would have missed the other routes in.
     */
    setRecordedRecents(recordRecentInstrument(user?.id, currentOrgId, {
      id: asset.id,
      symbol: asset.symbol,
      companyName: asset.company_name,
    }))
  }

  const addCompareSymbol = (asset: { id: string; symbol: string; company_name: string }) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    // Don't add if it's the main symbol or already in comparison
    if (asset.symbol === panel.symbol) return
    if (panel.compareSymbols?.some(s => s.symbol === asset.symbol)) return

    const usedColors = panel.compareSymbols?.map(s => s.color) || []
    const nextColor = COMPARISON_COLORS.find(c => !usedColors.includes(c)) || COMPARISON_COLORS[0]

    updatePanel(activePanel, {
      compareSymbols: [
        ...(panel.compareSymbols || []),
        { symbol: asset.symbol, companyName: asset.company_name, color: nextColor }
      ]
    })
    setCompareSearchQuery('')
  }

  const removeCompareSymbol = (symbol: string) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    updatePanel(activePanel, {
      compareSymbols: panel.compareSymbols?.filter(s => s.symbol !== symbol) || []
    })
  }

  const setDisplayMode = (mode: DisplayMode) => {
    updatePanel(activePanel, { displayMode: mode })
    setShowDisplayModeMenu(false)
  }

  const toggleIndicator = (indicatorId: string) => {
    const panel = panels.find(p => p.id === activePanel)
    if (!panel) return

    const newIndicators = panel.indicators.includes(indicatorId)
      ? panel.indicators.filter(i => i !== indicatorId)
      : [...panel.indicators, indicatorId]

    updatePanel(activePanel, { indicators: newIndicators })
  }

  const applyFrequencySelection = (frequencyKey: string, intervalStr: string, isIntraday: boolean) => {
    const freqConfig = isIntraday
      ? intradayFrequencies[frequencyKey]
      : historicalFrequencies[frequencyKey]

    if (!freqConfig) {
      console.error('No frequency config found for:', frequencyKey)
      return
    }

    const days = parseIntervalToDays(intervalStr)
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)


    updatePanel(activePanel, {
      timeFrame: 'CUSTOM',
      customRange: {
        startDate,
        endDate,
        interval: freqConfig.apiInterval as CustomDateRange['interval']
      },
      selectedFreq: {
        frequencyKey,
        interval: intervalStr,
        isIntraday
      }
    })
    setShowFreqPicker(false)
  }

  const applyCustomDateRange = () => {
    const startDate = new Date(customStartDate)
    const endDate = new Date(customEndDate)

    if (startDate >= endDate) {
      alert('Start date must be before end date')
      return
    }

    updatePanel(activePanel, {
      timeFrame: 'CUSTOM',
      customRange: {
        startDate,
        endDate,
        interval: customInterval
      },
      selectedFreq: undefined  // Clear freq selection when using custom date picker
    })
    setShowCustomDatePicker(false)
  }

  const currentPanel = panels.find(p => p.id === activePanel) || panels[0]

  /*
   * The plot arrangement for the active panel.
   *
   * Built from the symbol when the panel has none -- a workspace stored
   * before plots existed, or a panel that has only just been given an
   * instrument. `useMemo` rather than state: the panel IS the state, and a
   * second copy here would be a second answer to what is on the chart.
   */
  const plotState: PanelPlots = useMemo(() => {
    if (currentPanel?.plots) return currentPanel.plots
    return initialPlots(
      currentPanel?.symbol || '',
      currentPanel?.assetId ?? null,
      currentPanel?.companyName ?? null,
    )
  }, [currentPanel?.plots, currentPanel?.symbol, currentPanel?.assetId, currentPanel?.companyName])

  const dispatchPlot = useCallback((action: PlotAction) => {
    if (!currentPanel) return
    const base = currentPanel.plots ?? initialPlots(
      currentPanel.symbol || '',
      currentPanel.assetId ?? null,
      currentPanel.companyName ?? null,
    )
    updatePanel(currentPanel.id, { plots: plotReducer(base, action) })
  }, [currentPanel, updatePanel])

  /* What the renderer is handed. Hidden things are already gone from these. */
  const derivedPlotSpecs = useMemo(() => derivePlotSpecs(plotState), [plotState])
  const derivedOverlays = useMemo(() => deriveOverlays(plotState), [plotState])
  const derivedComparisons = useMemo(() => deriveComparisons(plotState), [plotState])
  const derivedShowVolume = useMemo(() => volumeVisible(plotState), [plotState])

  /*
   * The plot model owns the chart only once the panel actually carries one.
   * Until then the legacy `indicators`/`compareSymbols` path renders, so a
   * stored workspace from before this change opens exactly as it did.
   */
  const usePlotModel = !!currentPanel?.plots

  /*
   * Add Series, for a security.
   *
   * The plot is remembered rather than guessed, because the panel can ask
   * from any price plot and "the selected one" changes under you as soon as
   * the search box takes focus.
   */
  const [addSeriesPlotId, setAddSeriesPlotId] = useState<string | null>(null)
  const handleAddInstrumentToPlot = useCallback((plotId: string) => {
    setCompareSearchQuery('')
    setAddSeriesPlotId(plotId)
  }, [])

  const addInstrumentToPlot = useCallback((asset: { id: string; symbol: string; company_name: string | null }) => {
    if (!addSeriesPlotId) return
    dispatchPlot({
      type: 'addInstrument',
      plotId: addSeriesPlotId,
      symbol: asset.symbol,
      assetId: asset.id,
      companyName: asset.company_name,
    })
    setAddSeriesPlotId(null)
    setCompareSearchQuery('')
  }, [addSeriesPlotId, dispatchPlot])

  /*
   * Opening the Analysis panel on a panel that has no arrangement yet gives
   * it one. Done here rather than on mount so a workspace that never opens
   * the panel is never rewritten, and the legacy render path stays exact.
   */
  const openAnalysisPanel = useCallback(() => {
    if (currentPanel && !currentPanel.plots) {
      /* Carry the chart they are looking at into the model, rather than
         resetting to price and volume the moment the panel is opened. */
      updatePanel(currentPanel.id, {
        plots: migrateToPlots(
          currentPanel.symbol || '',
          currentPanel.assetId ?? null,
          currentPanel.companyName ?? null,
          { indicators: currentPanel.indicators, compareSymbols: currentPanel.compareSymbols },
        ),
      })
    }
    setShowAnalysisPanel(true)
  }, [currentPanel, updatePanel])

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden dark:bg-gray-800">
      {/* Header Toolbar */}
      <div className="bg-gray-50 border-b border-gray-200 px-2 sm:px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
        {/*
          The command bar's row must be decided by the VIEWPORT, never by
          data that arrives later.

          Measured before this change, at 1920px with AAPL loaded: hiding the
          instrument meta block -- 264px of "301 bars · 1mo · eodhd · just
          now · split-adjusted" -- moved the timeframe controls UP 42px, from
          a second row onto the search row. So the controls sat beside the
          search box while the chart loaded and jumped down a row the moment
          the meta arrived. The basis badge alone changes width again between
          "raw" (with its warning icon) and "split-adjusted", so even a
          reserved placeholder would not have held the line.

          `min-w-0 flex-1` lets the left group SHRINK instead of pushing, and
          `shrink-0` keeps the controls at their natural width. The two stay
          on one row until the controls alone no longer fit, which depends
          on the window and not on whether a fetch has returned.
        */}
        <div
          ref={toolbarRef}
          className="relative flex flex-wrap items-center justify-between gap-y-2"
        >
          {/* Left: Symbol Search & Info */}
          <div className="flex min-w-0 flex-1 items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                /*
                 * Closed on a DELAY, because a row's click fires after the
                 * input's blur. Closing immediately would unmount the row
                 * under the pointer and swallow the selection.
                 */
                onBlur={() => window.setTimeout(() => setSearchFocused(false), 150)}
                onKeyDown={(e) => { if (e.key === 'Escape') setSearchFocused(false) }}
                /* Gives up width before any control does: a narrower box
                   still accepts a ticker, whereas a wrapped toolbar moves
                   every button. */
                className={`pl-10 pr-4 py-1.5 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:border-gray-600 dark:text-white dark:bg-gray-800 ${compactTimeframe ? 'w-32' : 'w-48'}`}
              />
              {/*
                Recents, offered only when the box is focused and EMPTY.
                Once a query is typed the results below take the panel over,
                so the two can never both be open and disagree.
              */}
              {searchFocused && !searchQuery && recents.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-64 overflow-auto dark:border-gray-700 dark:bg-gray-800">
                  <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                    Recent
                  </div>
                  {recents.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => selectAsset({
                        id: item.id,
                        symbol: item.symbol,
                        company_name: item.companyName ?? '',
                      })}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between dark:hover:bg-gray-700"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">{item.symbol}</span>
                      {item.companyName && (
                        <span className="text-xs text-gray-500 truncate ml-2 dark:text-gray-400">
                          {item.companyName}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {/* Search Results Dropdown */}
              {searchQuery && searchResults.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-64 overflow-auto dark:border-gray-700 dark:bg-gray-800">
                  {searchResults.map((asset: any) => (
                    <button
                      key={asset.id}
                      onClick={() => selectAsset(asset)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between dark:hover:bg-gray-700"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">{asset.symbol}</span>
                      <span className="text-xs text-gray-500 truncate ml-2 dark:text-gray-400">{asset.company_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {currentPanel.symbol && (
              <InstrumentHeader
                symbol={currentPanel.symbol}
                companyName={currentPanel.companyName}
                meta={seriesMeta}
                dense={denseInstrument}
              />
            )}
          </div>

          {/*
            Right: Time Frame + Chart Type & Actions.

            At the tight breakpoint the group is allowed to WRAP. Search +
            timeframe select + chart type + Analysis is about 448px and a
            390px phone gives the bar 358 -- measured as 85px of overflow
            before this. A second row on a phone is legible; 85 pixels
            hanging off the side is not.

            `shrink-0` on the wide branch is #327's: it is what stops the
            controls being pushed onto a second row the moment the
            instrument meta arrives and widens the left group. It is
            deliberately NOT on the wrapping branch, where a second row is
            the intended outcome rather than the defect.
          */}
          <div className={compactTimeframe
            ? 'flex min-w-0 flex-wrap items-center gap-2'
            : 'flex shrink-0 items-center space-x-2'}>
            {/* Time Frame Selector */}
          <div className="flex items-center space-x-1 bg-gray-200 rounded-lg p-1">
            {/*
              Eight buttons at 492px, 46% of the whole right-hand group and
              its single largest item. Below `TOOLBAR_TIGHT_PX` they collapse
              to a native select -- about 80px -- which keeps every timeframe
              reachable in one tap instead of hiding seven of them.

              A select rather than another popover because this is the
              control a touch reader uses most, and the platform picker is
              the one thing on this bar that is already thumb-sized.
            */}
            {compactTimeframe ? (
              <select
                aria-label="Time frame"
                value={currentPanel.selectedFreq ? '' : currentPanel.timeFrame}
                onChange={(e) => updatePanel(activePanel, {
                  timeFrame: e.target.value as TimeFrame,
                  customRange: undefined,
                  selectedFreq: undefined,
                })}
                className="rounded bg-transparent px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none dark:text-gray-300"
              >
                {currentPanel.selectedFreq && <option value="">Custom</option>}
                {timeFrames.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            ) : timeFrames.map((tf) => (
              <button
                key={tf}
                onClick={() => updatePanel(activePanel, { timeFrame: tf, customRange: undefined, selectedFreq: undefined })}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  currentPanel.timeFrame === tf && !currentPanel.selectedFreq
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300 dark:hover:text-white dark:text-gray-400'
                }`}
              >
                {tf}
              </button>
            ))}

            {/* Freq Button (inside selector) */}
            <div className="relative">
              <button
                onClick={() => setShowFreqPicker(!showFreqPicker)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors flex items-center space-x-1 ${
                  showFreqPicker || currentPanel.selectedFreq
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300 dark:hover:text-white dark:text-gray-400'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>Freq</span>
              </button>

              {/* Frequency Picker Dropdown */}
              {showFreqPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowFreqPicker(false)} />
                  <div className="absolute left-0 top-full mt-2 bg-gradient-to-b from-white to-gray-50 border border-gray-200 rounded-xl shadow-2xl z-50 p-4 backdrop-blur-sm dark:border-gray-700">
                    {/* Long Term Section */}
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-4 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full" />
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider dark:text-gray-300">Long Term</span>
                      </div>
                      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden dark:border-gray-800 dark:bg-gray-800">
                        <table className="w-full">
                          <tbody>
                            {Object.entries(historicalFrequencies).map(([key, config], idx) => (
                              <tr key={key} className={idx % 2 === 0 ? 'bg-gray-50/50' : 'bg-white dark:bg-gray-800'}>
                                <td className="py-1.5 pl-3 pr-4 text-xs font-medium text-gray-600 whitespace-nowrap dark:text-gray-400">
                                  {config.label}
                                </td>
                                {config.intervals.map((interval) => {
                                  const isSelected = currentPanel.selectedFreq?.frequencyKey === key &&
                                    currentPanel.selectedFreq?.interval === interval &&
                                    !currentPanel.selectedFreq?.isIntraday
                                  return (
                                    <td key={interval} className="py-1 px-0.5">
                                      <button
                                        onClick={() => applyFrequencySelection(key, interval, false)}
                                        className={`w-full px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 text-center border ${
                                          isSelected
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-gradient-to-b from-gray-50 to-gray-100 hover:from-emerald-50 hover:to-emerald-100 hover:text-emerald-700 text-gray-600 border-gray-200 hover:border-emerald-300 hover:shadow-sm dark:border-gray-700 dark:text-gray-400'
                                        }`}
                                      >
                                        {interval}
                                      </button>
                                    </td>
                                  )
                                })}
                                {Array.from({ length: 6 - config.intervals.length }).map((_, i) => (
                                  <td key={`empty-${i}`} className="py-1 px-0.5" />
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Short Term Section */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-4 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full" />
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider dark:text-gray-300">Short Term</span>
                      </div>
                      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden dark:border-gray-800 dark:bg-gray-800">
                        <table className="w-full">
                          <tbody>
                            {Object.entries(intradayFrequencies).map(([key, config], idx) => (
                              <tr key={key} className={idx % 2 === 0 ? 'bg-gray-50/50' : 'bg-white dark:bg-gray-800'}>
                                <td className="py-1.5 pl-3 pr-4 text-xs font-medium text-gray-600 whitespace-nowrap dark:text-gray-400">
                                  {config.label}
                                </td>
                                {config.intervals.map((interval) => {
                                  const isSelected = currentPanel.selectedFreq?.frequencyKey === key &&
                                    currentPanel.selectedFreq?.interval === interval &&
                                    currentPanel.selectedFreq?.isIntraday
                                  return (
                                    <td key={interval} className="py-1 px-0.5">
                                      <button
                                        onClick={() => applyFrequencySelection(key, interval, true)}
                                        className={`w-full px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 text-center border ${
                                          isSelected
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-gradient-to-b from-gray-50 to-gray-100 hover:from-blue-50 hover:to-blue-100 hover:text-blue-700 text-gray-600 border-gray-200 hover:border-blue-300 hover:shadow-sm dark:border-gray-700 dark:text-gray-400'
                                        }`}
                                      >
                                        {interval}
                                      </button>
                                    </td>
                                  )
                                })}
                                {Array.from({ length: 6 - config.intervals.length }).map((_, i) => (
                                  <td key={`empty-${i}`} className="py-1 px-0.5" />
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Custom Date Range Button */}
            <div className={isMobileViewport ? "hidden" : "relative"}>
              <button
                onClick={() => setShowCustomDatePicker(!showCustomDatePicker)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors flex items-center space-x-1 ${
                  currentPanel.timeFrame === 'CUSTOM' && !currentPanel.selectedFreq
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300 dark:hover:text-white dark:text-gray-400'
                }`}
              >
                <Calendar className="w-3 h-3" />
                <span>Custom</span>
              </button>

              {/* Custom Date Picker Dropdown */}
              {showCustomDatePicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCustomDatePicker(false)} />
                  <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-xl z-50 p-4 dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-medium text-gray-900 text-sm dark:text-white">Custom Date Range</h3>
                      <button
                        onClick={() => setShowCustomDatePicker(false)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      {/* Start Date */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">
                          Start Date
                        </label>
                        <input
                          type="date"
                          value={customStartDate}
                          onChange={(e) => setCustomStartDate(e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
                        />
                      </div>

                      {/* End Date */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">
                          End Date
                        </label>
                        <input
                          type="date"
                          value={customEndDate}
                          onChange={(e) => setCustomEndDate(e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
                        />
                      </div>

                      {/* Interval/Frequency */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">
                          Frequency
                        </label>
                        <select
                          value={customInterval}
                          onChange={(e) => setCustomInterval(e.target.value as CustomDateRange['interval'])}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
                        >
                          <option value="1m">1 Minute</option>
                          <option value="5m">5 Minutes</option>
                          <option value="15m">15 Minutes</option>
                          <option value="30m">30 Minutes</option>
                          <option value="1h">1 Hour</option>
                          <option value="1d">Daily</option>
                          <option value="1wk">Weekly</option>
                          <option value="1mo">Monthly</option>
                        </select>
                      </div>

                      {/* Apply Button */}
                      <button
                        onClick={applyCustomDateRange}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

            {/* Chart Type Selector */}
            <div className="flex items-center space-x-1 bg-gray-200 rounded-lg p-1">
              {chartTypes.map((ct) => {
                const Icon = ct.icon
                return (
                  <button
                    key={ct.value}
                    onClick={() => updatePanel(activePanel, { chartType: ct.value })}
                    title={ct.label}
                    className={`p-1.5 rounded transition-colors ${
                      currentPanel.chartType === ct.value
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300 dark:hover:text-white dark:text-gray-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                )
              })}
            </div>

            {/*
              Secondary controls: metric, indicators, compare, view mode, add
              panel. Measured at 1920px they are 90 + 105 + 100 + 68 + 28 plus
              gaps -- about 430 of the right group's 1063px.

              Below `TOOLBAR_COMPACT_PX` this same markup stops being a row
              and becomes a panel under the Analysis button. It is ONE copy
              either way: rendering a second set inside a popover would mean
              two elements owning the same dropdown state, which is how a menu
              ends up open in one place and shut in the other.
            */}
            <div className={compactControls
              ? `absolute right-0 top-full z-50 mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-800 ${showAnalysisPanel ? '' : 'hidden'}`
              : 'flex items-center space-x-2'}>
            {/* Metric Selector */}
            <div className={isMobileViewport ? "hidden" : "relative"}>
              <button
                onClick={() => setShowMetricMenu(!showMetricMenu)}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  showMetricMenu ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 hover:text-gray-900 dark:hover:text-white dark:text-gray-400'
                }`}
              >
                {(() => {
                  const metric = metricOptions.find(m => m.value === currentPanel.metric)
                  const Icon = metric?.icon || DollarSign
                  return <Icon className="w-4 h-4" />
                })()}
                <span>{metricOptions.find(m => m.value === currentPanel.metric)?.label || 'Price'}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {showMetricMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMetricMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-50 dark:border-gray-700 dark:bg-gray-800">
                    <div className="p-2">
                      <div className="text-xs font-medium text-gray-500 uppercase px-2 py-1 dark:text-gray-400">Select Metric</div>
                      {metricOptions.map((metric) => {
                        const Icon = metric.icon
                        const isSelected = currentPanel.metric === metric.value
                        return (
                          <button
                            key={metric.value}
                            onClick={() => {
                              updatePanel(activePanel, { metric: metric.value })
                              setShowMetricMenu(false)
                            }}
                            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md transition-colors ${
                              isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100 text-gray-700 dark:hover:bg-gray-700 dark:text-gray-300'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            <div className="text-left">
                              <div className="text-sm font-medium">{metric.label}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{metric.description}</div>
                            </div>
                            {isSelected && <div className="ml-auto w-2 h-2 bg-blue-600 rounded-full" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Indicators */}
            <div className={isMobileViewport ? "hidden" : "relative"}>
              <button
                onClick={() => setShowIndicatorMenu(!showIndicatorMenu)}
                className="flex items-center space-x-1 px-3 py-1.5 bg-gray-200 text-gray-600 hover:text-gray-900 rounded-lg text-sm transition-colors dark:hover:text-white dark:text-gray-400"
              >
                <Layers className="w-4 h-4" />
                <span>Indicators</span>
                {currentPanel.indicators.length > 0 && (
                  <span className="bg-blue-600 text-white text-xs px-1.5 rounded-full">
                    {currentPanel.indicators.length}
                  </span>
                )}
              </button>

              {showIndicatorMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowIndicatorMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-80 overflow-auto dark:border-gray-700 dark:bg-gray-800">
                    {['Moving Averages', 'Oscillators', 'Volume', 'Volatility', 'Trend'].map((category) => (
                      <div key={category}>
                        <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide bg-gray-50 dark:text-gray-400 dark:bg-gray-900">
                          {category}
                        </div>
                        {indicators.filter(i => i.category === category).map((indicator) => (
                          <button
                            key={indicator.id}
                            onClick={() => toggleIndicator(indicator.id)}
                            className="w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between dark:hover:bg-gray-700"
                          >
                            <span className="text-sm text-gray-700 dark:text-gray-300">{indicator.name}</span>
                            {currentPanel.indicators.includes(indicator.id) && (
                              <span className="w-2 h-2 bg-blue-500 rounded-full" />
                            )}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Compare Symbols */}
            <div className={isMobileViewport ? "hidden" : "relative"}>
              <button
                onClick={() => setShowCompareMenu(!showCompareMenu)}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  showCompareMenu || (currentPanel.compareSymbols?.length || 0) > 0
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600 hover:text-gray-900 dark:hover:text-white dark:text-gray-400'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Compare</span>
                {(currentPanel.compareSymbols?.length || 0) > 0 && (
                  <span className="bg-white/20 text-white text-xs px-1.5 rounded-full">
                    {currentPanel.compareSymbols?.length}
                  </span>
                )}
              </button>

              {showCompareMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCompareMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-xl z-50 dark:border-gray-700 dark:bg-gray-800">
                    <div className="p-3 border-b border-gray-100 dark:border-gray-800">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Add symbol to compare..."
                          value={compareSearchQuery}
                          onChange={(e) => setCompareSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900"
                          autoFocus
                        />
                      </div>
                      {compareSearchQuery && compareSearchResults.length > 0 && (
                        <div className="mt-2 max-h-40 overflow-auto border border-gray-200 rounded-lg dark:border-gray-700">
                          {compareSearchResults.map((asset: any) => (
                            <button
                              key={asset.id}
                              onClick={() => addCompareSymbol(asset)}
                              disabled={asset.symbol === currentPanel.symbol || currentPanel.compareSymbols?.some(s => s.symbol === asset.symbol)}
                              className="w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed dark:hover:bg-gray-700"
                            >
                              <span className="font-medium text-gray-900 dark:text-white">{asset.symbol}</span>
                              <span className="text-xs text-gray-500 truncate ml-2 dark:text-gray-400">{asset.company_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Current comparisons */}
                    {currentPanel.compareSymbols && currentPanel.compareSymbols.length > 0 && (
                      <div className="p-2">
                        <div className="text-xs font-medium text-gray-500 uppercase px-2 py-1 dark:text-gray-400">Comparing</div>
                        {currentPanel.compareSymbols.map((s) => (
                          <div
                            key={s.symbol}
                            className="flex items-center justify-between px-2 py-1.5 hover:bg-gray-50 rounded dark:hover:bg-gray-800"
                          >
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{s.symbol}</span>
                              <span className="text-xs text-gray-400">{s.companyName}</span>
                            </div>
                            <button
                              onClick={() => removeCompareSymbol(s.symbol)}
                              className="text-gray-400 hover:text-red-500 p-1"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Display Mode */}
                    <div className="p-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="text-xs font-medium text-gray-500 uppercase px-2 py-1 dark:text-gray-400">Display Mode</div>
                      <div className="flex gap-1 px-2">
                        {displayModeOptions.map((mode) => (
                          <button
                            key={mode.value}
                            onClick={() => setDisplayMode(mode.value)}
                            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                              currentPanel.displayMode === mode.value
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:bg-gray-800'
                            }`}
                            title={mode.description}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                      {/* Index base input - shown when Indexed mode is selected */}
                      {currentPanel.displayMode === 'indexed' && (
                        <div className="mt-2 px-2">
                          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                            <span>Index to:</span>
                            <input
                              type="number"
                              value={currentPanel.indexBase || DEFAULT_INDEX_BASE}
                              onChange={(e) => updatePanel(activePanel, { indexBase: Number(e.target.value) || DEFAULT_INDEX_BASE })}
                              className="w-20 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600"
                              min="1"
                              step="1"
                            />
                            <span className="text-gray-400">at start</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center space-x-1 bg-gray-200 rounded-lg p-1">
              <button
                onClick={() => setViewMode('single')}
                title="Single Chart"
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'single'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300 dark:hover:text-white dark:text-gray-400'
                }`}
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                title="Grid View"
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300 dark:hover:text-white dark:text-gray-400'
                }`}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
            </div>

            {/* Add Panel */}
            <button
              onClick={addPanel}
              className="p-1.5 bg-gray-200 text-gray-600 hover:text-gray-900 rounded-lg transition-colors dark:hover:text-white dark:text-gray-400"
              title="Add Chart Panel"
            >
              <Plus className="w-4 h-4" />
            </button>
            </div>

            {/*
              The one control that REPLACES the group rather than joining it.
              Rendered only when the group is collapsed, so a wide toolbar is
              unchanged and nothing is hidden behind a menu that had room to
              be shown.
            */}
            {/*
              Always present now, at every width.

              It used to appear only when the toolbar collapsed, because it
              opened a popover holding the controls the bar had no room for.
              It now opens the Analysis panel -- the place those controls
              live -- so hiding it on a wide screen would hide the only way
              to reach Add Plot and Add Series.
            */}
            {(
              <button
                onClick={() => (showAnalysisPanel ? setShowAnalysisPanel(false) : openAnalysisPanel())}
                title="Analysis controls"
                className={`flex shrink-0 items-center space-x-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  showAnalysisPanel
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span className="hidden sm:inline">Analysis</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Panel Tabs (if multiple panels) */}
      {panels.length > 1 && (
        <div className="bg-gray-100 border-b border-gray-200 px-4 py-1 flex items-center space-x-1 dark:border-gray-700 dark:bg-gray-800">
          {panels.map((panel) => (
            <div
              key={panel.id}
              className={`flex items-center space-x-2 px-3 py-1 rounded-t text-sm cursor-pointer transition-colors ${
                activePanel === panel.id
                  ? 'bg-white text-gray-900 border-t border-l border-r border-gray-200 dark:border-gray-700 dark:text-white dark:bg-gray-800'
                  : 'bg-gray-200 text-gray-600 hover:text-gray-900 dark:hover:text-white dark:text-gray-400'
              }`}
              onClick={() => setActivePanel(panel.id)}
            >
              <span>{panel.symbol || 'New Chart'}</span>
              {panels.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removePanel(panel.id)
                  }}
                  className="text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main Chart Area */}
      <div className="flex-1 flex overflow-hidden" onClick={() => { closeContextMenu(); closeLineContextMenu(); }}>
        {/*
          The drawing tools, stated.
          Every tool here already worked and was reachable only by
          right-clicking empty canvas, which nothing on the page mentioned.
          See `workspace/drawing-tools.ts`.
        */}
        <DrawingPalette
          activeTool={activeTool}
          onSelectTool={type => {
            setActiveTool(type)
            if (type) setSelectedAnnotation(null)
          }}
          onUndo={undoAnnotations}
          onRedo={redoAnnotations}
          canUndo={historyCanUndo(history)}
          canRedo={historyCanRedo(history)}
          onClearAll={clearAllAnnotations}
          markCount={currentPanel.annotations.length}
        />
        {/* Chart Canvas */}
        <div className="flex-1 overflow-hidden relative">
          {/*
            * An armed tool changes what a press does: it draws instead of
            * panning. That has to be visible, or the chart simply stops
            * responding the way it did a moment ago with nothing on the page
            * to explain it. The strip also carries the two controls that are
            * otherwise keyboard-only.
            */}
          {/*
            * Reduced to the one thing the rail cannot say.
            *
            * Undo, redo and the selection used to live here. Undo and redo
            * are on the palette now, where they sit beside the tools they
            * reverse; the selection is in the inspector, which can state the
            * mark's anchors rather than just its name. What is left is the
            * instruction, and it has to be HERE rather than on the button:
            * the reader is looking at the canvas, which is where their next
            * press has to land.
            *
            * `armedCaption` is used rather than a sentence built here,
            * because the sentence differs by tool. "Drag to draw horizontal
            * line" was wrong -- a horizontal line is placed by a click, and
            * dragging to make one produces nothing at all.
            */}
          {activeTool && (
            <div className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gray-200/80 bg-white/95 px-3 py-1 shadow-sm backdrop-blur dark:border-white/10 dark:bg-gray-900/95">
              <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200">
                {armedCaption(activeTool)}
              </span>
              <button
                type="button"
                onClick={() => setActiveTool(null)}
                className="rounded-full px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
              >
                Cancel · Esc
              </button>
            </div>
          )}
          {viewMode === 'single' ? (
            /*
              The Analysis panel sits BESIDE the canvas, not over it. A
              floating panel would cover the right price axis, which is the
              column a reader checks while changing what is drawn.

              `min-w-0` on the chart side is what lets it actually give the
              width back when the panel closes: without it the canvas keeps
              its measured width and the freed space becomes a gap.
            */
            <div className="relative flex h-full bg-white dark:bg-gray-800">
            <div className="min-w-0 flex-1">
              {currentPanel.symbol ? (
                <ProChart
                  symbol={currentPanel.symbol}
                  chartType={currentPanel.chartType}
                  timeFrame={currentPanel.timeFrame}
                  customRange={currentPanel.customRange}
                  showVolume={usePlotModel ? derivedShowVolume : currentPanel.indicators.includes('volume')}
                  indicators={usePlotModel
                    ? (derivedOverlays.map(s => s.kind) as IndicatorType[])
                    : currentPanel.indicators.filter(i => i !== 'volume') as IndicatorType[]}
                  plotSpecs={usePlotModel ? derivedPlotSpecs : undefined}
                  annotations={currentPanel.annotations}
                  compareSymbols={usePlotModel
                    ? derivedComparisons.map(s => ({
                        symbol: s.symbol,
                        companyName: s.companyName ?? undefined,
                        color: s.color,
                      }))
                    : currentPanel.compareSymbols}
                  displayMode={currentPanel.displayMode}
                  indexBase={currentPanel.indexBase}
                  selectedLine={selectedLine}
                  mainSymbolStyle={currentPanel.mainSymbolStyle}
                  onSeriesMeta={setSeriesMeta}
                  onContextMenu={handleChartContextMenu}
                  onLineContextMenu={handleLineContextMenu}
                  onLineClick={handleLineClick}
                  activeTool={activeTool}
                  annotationStyle={NEW_ANNOTATION_STYLE}
                  onAnnotationDraw={handleAnnotationDraw}
                  onAnnotationSelect={setSelectedAnnotation}
                  onAnnotationChange={previewAnnotation}
                  onAnnotationCommit={commitAnnotationChange}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <LineChart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-500 mb-2 dark:text-gray-400">No Symbol Selected</h3>
                    <p className="text-gray-400 text-sm">
                      Search for a symbol above
                    </p>
                  </div>
                </div>
              )}
            </div>
            {/*
              Add Series search. Anchored over the panel rather than the
              canvas: the reader's attention is in the tree, and covering
              the chart to choose a comparison hides the thing being
              compared against.
            */}
            {addSeriesPlotId && (
              <div className="absolute right-72 top-16 z-50 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                <input
                  autoFocus
                  value={compareSearchQuery}
                  onChange={e => setCompareSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setAddSeriesPlotId(null) }}
                  placeholder="Add security to plot…"
                  aria-label="Add security to plot"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
                <div className="mt-1 max-h-64 overflow-y-auto">
                  {compareSearchResults.map(asset => (
                    <button
                      key={asset.id}
                      onClick={() => addInstrumentToPlot(asset)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-blue-50 dark:hover:bg-gray-700"
                    >
                      <span className="font-semibold text-gray-900 dark:text-white">{asset.symbol}</span>
                      <span className="truncate text-xs text-gray-500">{asset.company_name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {showAnalysisPanel && currentPanel.symbol && (
              <AnalysisPanel
                state={plotState}
                dispatch={dispatchPlot}
                onAddInstrument={handleAddInstrumentToPlot}
                onClose={() => setShowAnalysisPanel(false)}
              />
            )}
            </div>
          ) : (
            <div className="h-full grid grid-cols-2 gap-px bg-gray-200">
              {panels.map((panel) => (
                <div
                  key={panel.id}
                  onClick={() => setActivePanel(panel.id)}
                  className={`bg-white transition-colors cursor-pointer relative ${
                    activePanel === panel.id
                      ? 'ring-2 ring-inset ring-blue-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {panel.symbol ? (
                    <ProChart
                      symbol={panel.symbol}
                      chartType={panel.chartType}
                      timeFrame={panel.timeFrame}
                      customRange={panel.customRange}
                      showVolume={panel.indicators.includes('volume')}
                      indicators={panel.indicators.filter(i => i !== 'volume') as IndicatorType[]}
                      annotations={panel.annotations}
                      compareSymbols={panel.compareSymbols}
                      displayMode={panel.displayMode}
                      indexBase={panel.indexBase}
                      selectedLine={panel.id === activePanel ? selectedLine : null}
                      mainSymbolStyle={panel.mainSymbolStyle}
                      onContextMenu={panel.id === activePanel ? handleChartContextMenu : undefined}
                      onLineContextMenu={panel.id === activePanel ? handleLineContextMenu : undefined}
                      onLineClick={panel.id === activePanel ? handleLineClick : undefined}
                      /* Drawing follows the active panel, exactly as the
                         handlers above already do -- the context menu that
                         arms a tool is only offered there, so an inactive
                         panel can never be mid-drawing. */
                      activeTool={panel.id === activePanel ? activeTool : null}
                      annotationStyle={NEW_ANNOTATION_STYLE}
                      onAnnotationDraw={panel.id === activePanel ? handleAnnotationDraw : undefined}
                      onAnnotationSelect={panel.id === activePanel ? setSelectedAnnotation : undefined}
                      onAnnotationChange={panel.id === activePanel ? previewAnnotation : undefined}
                      onAnnotationCommit={panel.id === activePanel ? commitAnnotationChange : undefined}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <Plus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">Add Symbol</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {/*
          The inspector, which takes no width until a mark is picked up.
          It edits through `commitAnnotationChange`, the same undoable path a
          drag ends on, so a colour change is one Ctrl+Z like everything else.
        */}
        <AnnotationInspector
          annotation={currentPanel.annotations.find(a => a.id === selectedAnnotation) ?? null}
          onChange={commitAnnotationChange}
          onDelete={deleteAnnotation}
          onClose={() => setSelectedAnnotation(null)}
        />
      </div>

      {/* Right-Click Context Menu for Annotations */}
      {contextMenu.visible && (
        <>
          <div className="fixed inset-0 z-50" onClick={closeContextMenu} />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-2 min-w-[200px] dark:border-gray-700 dark:bg-gray-800"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {/* Drawing Tools Section */}
            <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-gray-400">
              Add Annotation
            </div>
            {annotationTools.map((tool) => {
              const Icon = tool.icon
              return (
                <button
                  key={tool.type}
                  onClick={() => addAnnotation(tool.type)}
                  className="w-full flex items-center space-x-3 px-3 py-2 hover:bg-gray-100 transition-colors text-left dark:hover:bg-gray-700"
                >
                  <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{tool.label}</span>
                </button>
              )
            })}

            {/* Divider */}
            <div className="my-2 border-t border-gray-200 dark:border-gray-700" />

            {/* Actions */}
            {currentPanel.annotations.length > 0 && (
              <>
                <button
                  onClick={clearAllAnnotations}
                  className="w-full flex items-center space-x-3 px-3 py-2 hover:bg-red-50 transition-colors text-left text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="text-sm">Clear All Annotations</span>
                </button>
              </>
            )}

            {/* Price/Time at cursor */}
            <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-200 mt-2 dark:border-gray-700 dark:text-gray-400">
              <div>Price: ${contextMenu.chartY.toFixed(2)}</div>
              <div>Time: {new Date(contextMenu.chartX * 1000).toLocaleDateString()}</div>
            </div>
          </div>
        </>
      )}

      {/* Right-Click Context Menu for Line Formatting */}
      {lineContextMenu.visible && (
          <div
            data-line-context-menu
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-2 min-w-[220px] dark:border-gray-700 dark:bg-gray-800"
            style={{ left: lineContextMenu.x, top: lineContextMenu.y }}
          >
            {/* Header */}
            <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-100 mb-1 dark:border-gray-800 dark:text-gray-400">
              Format: {lineContextMenu.symbol}
            </div>

            {/* Color Selection */}
            <div className="px-3 py-2">
              <div className="text-xs font-medium text-gray-600 mb-2 dark:text-gray-400">Color</div>
              <div className="flex flex-wrap gap-1.5">
                {LINE_COLORS.map((color) => {
                  const currentStyle = lineContextMenu.isMainSymbol
                    ? currentPanel.mainSymbolStyle
                    : currentPanel.compareSymbols?.find(cs => cs.symbol === lineContextMenu.symbol)
                  const defaultColor = lineContextMenu.isMainSymbol ? '#3b82f6' : '#666666'
                  const isSelected = (currentStyle?.color || defaultColor) === color.value
                  return (
                    <button
                      key={color.value}
                      onClick={() => {
                        if (lineContextMenu.isMainSymbol) {
                          updateMainSymbolStyle({ color: color.value })
                        } else {
                          updateCompareSymbolStyle(lineContextMenu.symbol, { color: color.value })
                        }
                      }}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        isSelected ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-110'
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  )
                })}
              </div>
            </div>

            {/* Line Width */}
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs font-medium text-gray-600 mb-2 dark:text-gray-400">Line Width</div>
              <div className="flex gap-1">
                {LINE_WIDTHS.map((width) => {
                  const currentStyle = lineContextMenu.isMainSymbol
                    ? currentPanel.mainSymbolStyle
                    : currentPanel.compareSymbols?.find(cs => cs.symbol === lineContextMenu.symbol)
                  const isSelected = (currentStyle?.lineWidth || 2) === width
                  return (
                    <button
                      key={width}
                      onClick={() => {
                        if (lineContextMenu.isMainSymbol) {
                          updateMainSymbolStyle({ lineWidth: width })
                        } else {
                          updateCompareSymbolStyle(lineContextMenu.symbol, { lineWidth: width })
                        }
                      }}
                      className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:bg-gray-800'
                      }`}
                    >
                      {width}px
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Line Style */}
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs font-medium text-gray-600 mb-2 dark:text-gray-400">Line Style</div>
              <div className="flex gap-1">
                {LINE_STYLES.map((style) => {
                  const currentStyle = lineContextMenu.isMainSymbol
                    ? currentPanel.mainSymbolStyle
                    : currentPanel.compareSymbols?.find(cs => cs.symbol === lineContextMenu.symbol)
                  const isSelected = (currentStyle?.lineStyle || 'solid') === style.value
                  return (
                    <button
                      key={style.value}
                      onClick={() => {
                        if (lineContextMenu.isMainSymbol) {
                          updateMainSymbolStyle({ lineStyle: style.value })
                        } else {
                          updateCompareSymbolStyle(lineContextMenu.symbol, { lineStyle: style.value })
                        }
                      }}
                      className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:bg-gray-800'
                      }`}
                    >
                      {style.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Remove Line - only for comparison symbols */}
            {!lineContextMenu.isMainSymbol && (
              <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => {
                    removeCompareSymbol(lineContextMenu.symbol)
                    closeLineContextMenu()
                  }}
                  className="w-full py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition-colors"
                >
                  Remove from Chart
                </button>
              </div>
            )}
          </div>
      )}
    </div>
  )
}
