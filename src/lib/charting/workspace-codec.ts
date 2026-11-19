/**
 * The shape of a chart workspace, and how it survives storage.
 *
 * ── Why this is not in ChartingPage.tsx ──────────────────────────────────
 *
 * It was. A `.tsx` file that exports anything other than a component breaks
 * Fast Refresh (`react-refresh/only-export-components`), and the codec is
 * the kind of thing a test should be able to import without dragging the
 * whole page in with it. The types come along because the codec is defined
 * over them.
 *
 * ── What a codec is for ──────────────────────────────────────────────────
 *
 * `CustomDateRange.startDate` and `.endDate` are real `Date` objects, and a
 * `Date` does not survive `JSON.parse(JSON.stringify(d))` -- it comes back a
 * string. Handing `ProChart` a string where it expects a Date throws on
 * `.getTime()` the moment the chart fetches, so restoring a stored workspace
 * naively would reload a person who last used a custom frequency straight
 * into a broken chart: a worse outcome than the lost state it is fixing.
 *
 * A blanket "revive anything shaped like a date" walker would be worse
 * still, because it would also rewrite fields that are legitimately strings.
 * Only the owner of the shape knows which is which, so the owner says.
 *
 * ── Why it validates rather than casts ───────────────────────────────────
 *
 * A stored entry is untrusted input: stale from an older build, truncated,
 * or hand-edited. `fromJSON` returns null for anything it does not
 * recognise and the page starts from its default, which is the behaviour
 * before any of this existed.
 */
import type { Annotation } from '../../components/charting/engine/annotations'
import type { ChartType, CustomDateRange, TimeFrame } from '../../components/charting'
import type { WorkspaceCodec } from './workspace-state'

/** Metric types for charting. */
export type MetricType = 'price' | 'volume' | 'market_cap' | 'pe_ratio' | 'eps' | 'revenue' | 'dividend_yield'

/** Display modes for comparison. */
export type DisplayMode = 'absolute' | 'indexed' | 'relative'

/** Line style, matching the renderer. */
export type LineStyleOption = 'solid' | 'dashed' | 'dotted'

/** How many charts are shown at once. */
export type ViewMode = 'single' | 'grid'

export interface ChartPanel {
  id: string
  symbol: string
  companyName?: string
  chartType: ChartType
  timeFrame: TimeFrame
  customRange?: CustomDateRange
  indicators: string[]
  metric: MetricType
  annotations: Annotation[]
  // Track selected frequency for highlighting
  selectedFreq?: {
    frequencyKey: string
    interval: string
    isIntraday: boolean
  }
  // Main symbol styling
  mainSymbolStyle?: {
    color?: string
    lineWidth?: number
    lineStyle?: LineStyleOption
  }
  // Comparison symbols
  compareSymbols?: { symbol: string; companyName?: string; color?: string; lineWidth?: number; lineStyle?: LineStyleOption }[]
  // Display mode: absolute prices, indexed, or relative to first symbol
  displayMode?: DisplayMode
  // Base value for indexed mode (default 100)
  indexBase?: number
}

/**
 * What survives a tab switch and a reload.
 *
 * These are the fields a person chose and would have to choose again. The
 * open/closed state of the page's menus is deliberately not among them: a
 * restored tab showing the indicator menu already open would be restoring a
 * transient, not a choice.
 */
export interface ChartingWorkspace {
  panels: ChartPanel[]
  activePanel: string
  viewMode: ViewMode
}

export const CHARTING_WORKSPACE_CODEC: WorkspaceCodec<ChartingWorkspace> = {
  toJSON: (state) => state,

  fromJSON: (raw) => {
    if (!raw || typeof raw !== 'object') return null
    const candidate = raw as Partial<ChartingWorkspace>
    if (!Array.isArray(candidate.panels) || candidate.panels.length === 0) return null
    if (typeof candidate.activePanel !== 'string') return null

    const panels: ChartPanel[] = []
    for (const panel of candidate.panels as unknown[]) {
      const restored = revivePanel(panel)
      if (!restored) return null
      panels.push(restored)
    }

    // The active panel must still exist, or the page renders a toolbar
    // controlling nothing.
    if (!panels.some(p => p.id === candidate.activePanel)) return null

    return {
      panels,
      activePanel: candidate.activePanel,
      // Anything that is not a known layout falls back rather than being
      // cast through: a 'grid-4' stored by a future build must not reach the
      // renderer as a layout it has no branch for.
      viewMode: candidate.viewMode === 'grid' ? 'grid' : 'single',
    }
  },
}

/** One panel, or null if it is not one. */
function revivePanel(raw: unknown): ChartPanel | null {
  if (!raw || typeof raw !== 'object') return null
  const panel = raw as Partial<ChartPanel> & { customRange?: unknown }
  if (typeof panel.id !== 'string' || typeof panel.symbol !== 'string') return null

  const customRange = reviveCustomRange(panel.customRange)
  /*
   * A custom range that did not survive drops the range AND the timeframe
   * that depends on it. Keeping `timeFrame: 'CUSTOM'` with no range leaves
   * the page asking the provider for a window it has not got.
   */
  const timeFrame = panel.timeFrame === 'CUSTOM' && !customRange
    ? '1M' as TimeFrame
    : (panel.timeFrame ?? '1M') as TimeFrame

  return {
    ...(panel as ChartPanel),
    timeFrame,
    customRange,
    /*
     * An older build's panel may not carry these at all, and the page maps
     * over both unconditionally -- so a missing one is a crash, while the
     * symbol and timeframe beside it are still worth restoring.
     */
    indicators: Array.isArray(panel.indicators) ? panel.indicators : [],
    annotations: Array.isArray(panel.annotations) ? panel.annotations : [],
  }
}

/** The two Dates, back from their ISO strings, or undefined. */
function reviveCustomRange(raw: unknown): CustomDateRange | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const range = raw as { startDate?: unknown; endDate?: unknown; interval?: unknown }

  const startDate = new Date(range.startDate as string)
  const endDate = new Date(range.endDate as string)
  // An unparseable date is NaN, and a NaN window silently returns no bars.
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return undefined
  // The fetch path needs the bar size; a range without one cannot be asked for.
  if (typeof range.interval !== 'string') return undefined

  return { ...(raw as CustomDateRange), startDate, endDate }
}
