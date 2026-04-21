/**
 * Row-expansion detail view — vertical panel list on the left, active
 * panel content filling the right.
 *
 * Only panels RELEVANT to the clicked cell are shown (not all panels every
 * time in a different order). Each column is mapped to a small set of
 * panels that serve it; irrelevant panels are hidden. Panels are also
 * filtered out when their underlying data is empty for this asset.
 *
 * File name preserved for import stability; internally this is no longer a
 * carousel — it's a sidebar-master / main-detail layout.
 */

import React, { useEffect, useMemo, useState } from 'react'
import {
  TrendingUp, TrendingDown, Clock, Calendar, CalendarClock, CalendarDays,
  Target, Users, BarChart3, FileText, Building2, ArrowUpRight,
  History, ListChecks, Flag, Tag as TagIcon, User, Briefcase,
  DollarSign, Check
} from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'
import { formatDistanceToNow, format, parseISO, differenceInCalendarDays, isAfter } from 'date-fns'
import { PriceTargetsSummary } from '../outcomes/PriceTargetsSummary'
import { formatPrice, formatPriceChange, formatRelativeTime } from './tableUtils'
import { useAssetHoldings, type AssetHolding } from '../../hooks/useAssetHoldings'
import { useAssetEvents, type AssetEvent } from '../../hooks/useAssetEvents'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { ChartDataAdapter } from '../charts/utils/dataAdapter'

// Process-stage metadata — mirrored locally from AssetTableView's constant.
// Order matters for the progression viz (left-to-right pipeline).
const STAGE_FLOW = ['monitor', 'prioritized', 'in_progress', 'recommend', 'review', 'action'] as const
const STAGE_META: Record<string, { label: string; dot: string }> = {
  monitor:     { label: 'Monitor',     dot: 'bg-cyan-400' },
  prioritized: { label: 'Prioritized', dot: 'bg-purple-400' },
  in_progress: { label: 'In Progress', dot: 'bg-blue-500' },
  recommend:   { label: 'Recommend',   dot: 'bg-emerald-500' },
  review:      { label: 'Review',      dot: 'bg-amber-500' },
  action:      { label: 'Action',      dot: 'bg-red-500' },
  outdated:    { label: 'Outdated',    dot: 'bg-gray-400' }
}

interface AssetDetailCarouselProps {
  asset: any
  columnId: string
  quote: any
  coverage: any[]
  workflows: any[]
  onOpenAsset?: () => void
}

// ── Panel definitions ──────────────────────────────────────────────────

interface PanelDef {
  id: string
  label: string
  openLabel: string
  Icon: React.ComponentType<{ className?: string }>
  isRelevant: (asset: any, coverage: any[], workflows: any[]) => boolean
  render: (ctx: PanelContext) => React.ReactNode
}

type Timeframe = '1M' | '3M' | '6M' | '1Y' | 'YTD'

const TIMEFRAMES: Array<{ id: Timeframe; label: string }> = [
  { id: '1M',  label: '1M'  },
  { id: '3M',  label: '3M'  },
  { id: '6M',  label: '6M'  },
  { id: '1Y',  label: '1Y'  },
  { id: 'YTD', label: 'YTD' }
]

function daysForTimeframe(tf: Timeframe): number {
  switch (tf) {
    case '1M':  return 30
    case '3M':  return 90
    case '6M':  return 180
    case '1Y':  return 365
    case 'YTD': {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
      return Math.max(1, Math.floor((Date.now() - yearStart) / (1000 * 60 * 60 * 24)))
    }
  }
}

interface PanelContext {
  asset: any
  quote: any
  coverage: any[]
  workflows: any[]
  onOpenAsset?: () => void
  /** Only meaningful for the Price panel; controlled by the carousel. */
  timeframe?: Timeframe
}

const PANELS: Record<string, PanelDef> = {
  price: {
    id: 'price', label: 'Price', openLabel: 'Open chart', Icon: BarChart3,
    isRelevant: (a) => a?.current_price != null || a?.symbol,
    render: PricePanel
  },
  research: {
    id: 'research', label: 'Research', openLabel: 'Open case', Icon: FileText,
    isRelevant: (a) => !!(a?.thesis || a?.where_different || a?.bull_case || a?.bear_case || a?.quick_note),
    render: ResearchPanel
  },
  targets: {
    id: 'targets', label: 'Targets', openLabel: 'Open targets', Icon: Target,
    // PriceTargetsSummary handles its own empty state, so always relevant
    isRelevant: () => true,
    render: TargetsPanel
  },
  profile: {
    id: 'profile', label: 'Profile', openLabel: 'Open profile', Icon: Building2,
    isRelevant: (a) => !!(a?.company_name || a?.sector || a?.industry || a?.description || a?.market_cap),
    render: ProfilePanel
  },
  coverage: {
    id: 'coverage', label: 'Coverage', openLabel: 'Open coverage', Icon: Users,
    isRelevant: (a, cov, wf) => cov.length > 0 || wf.length > 0 || !!a?.process_stage || !!a?.priority,
    render: CoveragePanel
  },
  timeline: {
    id: 'timeline', label: 'Timeline', openLabel: 'Open history', Icon: History,
    isRelevant: (a) => !!(a?.updated_at || a?.created_at || a?.process_stage),
    render: TimelinePanel
  },
  'list-context': {
    id: 'list-context', label: 'List context', openLabel: 'Open row', Icon: ListChecks,
    isRelevant: (a) => !!(
      a?._listNotes || a?._assignee || a?._statusId || a?._dueDate
      || a?._isFlagged || (a?._tags && a._tags.length > 0) || a?._addedBy
    ),
    render: ListContextPanel
  },
  holdings: {
    id: 'holdings', label: 'Holdings', openLabel: 'Open portfolios', Icon: Briefcase,
    // Assume relevant; the panel fetches data and handles empty state internally
    isRelevant: () => true,
    render: HoldingsPanel
  },
  events: {
    id: 'events', label: 'Events', openLabel: 'Open calendar', Icon: CalendarDays,
    isRelevant: () => true,
    render: EventsPanel
  },
  valuation: {
    id: 'valuation', label: 'Valuation', openLabel: 'Open fundamentals', Icon: DollarSign,
    isRelevant: (a) => a?.market_cap != null || a?.current_price != null,
    render: ValuationPanel
  }
}

// ── Column → relevant panels ──────────────────────────────────────────
// Order matters — first entry is the "primary" landing panel.
// Keys are substring matches against the clicked column id.

const COLUMN_PANEL_MAP: Array<{ keys: string[]; panels: string[] }> = [
  // Price-related
  { keys: ['price', 'change', '1d', 'day'],                         panels: ['price', 'targets', 'holdings', 'events'] },
  { keys: ['volume'],                                               panels: ['price', 'events'] },
  { keys: ['mktcap', 'marketcap'],                                  panels: ['price', 'valuation'] },

  // Targets
  { keys: ['target', 'upside', 'downside', 'low', 'base', 'high'],  panels: ['targets', 'price', 'research'] },

  // Valuation / fundamentals
  { keys: ['pe', 'pb', 'peg', 'valuation', 'margin', 'ebitda', 'yield'], panels: ['valuation', 'price'] },

  // Profile / company
  { keys: ['symbol', 'ticker', 'companyname', 'sector', 'industry', 'description', 'country', 'exchange'],
    panels: ['profile', 'price', 'valuation'] },

  // Research
  { keys: ['thesis'],                                               panels: ['research', 'targets', 'price'] },
  { keys: ['bull', 'bear'],                                         panels: ['research'] },
  { keys: ['where_different', 'wheredifferent'],                    panels: ['research', 'price', 'targets'] },
  { keys: ['quicknote', 'quick_note', 'notes'],                     panels: ['research', 'list-context'] },
  { keys: ['risks_to_thesis', 'risks'],                             panels: ['research'] },

  // Coverage / workflow / pipeline stage
  { keys: ['coverage', 'analyst', 'workflow'],                      panels: ['coverage', 'timeline'] },
  { keys: ['process_stage', 'stage'],                               panels: ['coverage', 'timeline'] },
  { keys: ['priority'],                                             panels: ['coverage'] },
  { keys: ['contributor', 'addedby', 'added_by'],                   panels: ['list-context', 'coverage'] },

  // Timeline
  { keys: ['updated', 'created'],                                   panels: ['timeline', 'coverage'] },

  // Events / earnings
  { keys: ['earnings', 'event', 'calendar'],                        panels: ['events', 'timeline'] },

  // Holdings / positions
  { keys: ['holding', 'position', 'shares', 'weight', 'costbasis', 'cost_basis', 'marketvalue', 'market_value'],
    panels: ['holdings', 'price'] },

  // List-scoped
  { keys: ['list_status', 'liststatus'],                            panels: ['list-context', 'research'] },
  { keys: ['list_tags', 'listtags'],                                panels: ['list-context'] },
  { keys: ['list_assignee', 'listassignee', 'assignee'],            panels: ['list-context', 'coverage'] },
  { keys: ['listnote', 'list_note'],                                panels: ['list-context', 'research'] },
  { keys: ['flag', 'flagged'],                                      panels: ['list-context'] },
  { keys: ['due'],                                                  panels: ['list-context', 'timeline'] }
]

// Safe fallback when nothing matches — shows the big-picture views
const FALLBACK_PANELS = ['price', 'research', 'holdings', 'profile']

function pickRelevantPanels(
  columnId: string,
  asset: any,
  coverage: any[],
  workflows: any[]
): PanelDef[] {
  const cid = (columnId || '').toLowerCase()
  let candidateIds: string[]
  if (!cid || cid === 'default') {
    candidateIds = FALLBACK_PANELS
  } else {
    const match = COLUMN_PANEL_MAP.find(entry =>
      entry.keys.some(k => cid.includes(k.toLowerCase()))
    )
    candidateIds = match?.panels ?? FALLBACK_PANELS
  }

  // Keep order; filter out panels whose data is empty for this asset
  const relevant: PanelDef[] = []
  for (const id of candidateIds) {
    const panel = PANELS[id]
    if (!panel) continue
    if (!panel.isRelevant(asset, coverage, workflows)) continue
    relevant.push(panel)
  }

  // If strict filter emptied the list (asset with no data anywhere), show
  // a minimal safe set so the expansion isn't blank
  if (relevant.length === 0) {
    return FALLBACK_PANELS
      .map(id => PANELS[id])
      .filter(p => p && p.isRelevant(asset, coverage, workflows))
  }

  return relevant
}

// ── Main component ─────────────────────────────────────────────────────

export function AssetDetailCarousel({
  asset, columnId, quote, coverage, workflows, onOpenAsset
}: AssetDetailCarouselProps) {
  const orderedPanels = useMemo(
    () => pickRelevantPanels(columnId, asset, coverage, workflows),
    [columnId, asset, coverage, workflows]
  )
  const [activeIdx, setActiveIdx] = useState(0)
  const [timeframe, setTimeframe] = useState<Timeframe>('3M')

  // Reset to the primary panel whenever the user opens via a different cell
  // or a different row, OR when the panel list shrinks below current idx.
  useEffect(() => {
    setActiveIdx(0)
  }, [columnId, asset?.id])

  // Safety: if orderedPanels shrunk, clamp active index
  useEffect(() => {
    if (activeIdx >= orderedPanels.length) {
      setActiveIdx(Math.max(0, orderedPanels.length - 1))
    }
  }, [orderedPanels.length, activeIdx])

  // Document-level keyboard navigation (capture phase so we fire before the
  // table's cell-nav keyboard handler)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
      const len = orderedPanels.length
      if (len <= 1) return
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation()
        setActiveIdx(i => Math.max(0, i - 1))
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation()
        setActiveIdx(i => Math.min(len - 1, i + 1))
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [orderedPanels.length])

  if (orderedPanels.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-gray-400 italic">
        Nothing to show for this asset yet.
      </div>
    )
  }

  const activePanel = orderedPanels[activeIdx] ?? orderedPanels[0]
  const ctx: PanelContext = { asset, quote, coverage, workflows, onOpenAsset, timeframe }
  const soloPanel = orderedPanels.length === 1
  const ActivePanelComponent = activePanel.render
  const isPricePanel = activePanel.id === 'price'

  return (
    <div className="h-full flex overflow-hidden min-w-0">
      <style>{ADC_STYLES}</style>

      {/* ── Left navigation ────────────────────────────────────── */}
      {!soloPanel && (
        <nav className="w-36 flex-shrink-0 flex flex-col gap-0.5 py-0.5 pr-2 border-r border-gray-200 dark:border-gray-800 overflow-y-auto overflow-x-hidden">
          {orderedPanels.map((panel, i) => (
            <NavItem
              key={panel.id}
              panel={panel}
              active={i === activeIdx}
              onClick={() => setActiveIdx(i)}
            />
          ))}
        </nav>
      )}

      {/* ── Main area ──────────────────────────────────────────── */}
      <main className={clsx(
        'flex-1 min-w-0 flex flex-col overflow-hidden',
        soloPanel ? '' : 'pl-5'
      )}>
        {/* Header — panel identity | asset identity | open link */}
        <header className="flex items-center gap-4 pb-1.5 flex-shrink-0 min-w-0">
          <div className="flex items-center gap-2 flex-shrink-0">
            <activePanel.Icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              {activePanel.label}
            </h3>
          </div>

          {/* Middle: asset identity + live price — all at the same size */}
          <div className="flex items-center gap-2 min-w-0 flex-1 text-[12px]">
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
              {asset?.symbol}
            </span>
            {asset?.company_name && (
              <span className="text-gray-500 dark:text-gray-400 truncate">
                {asset.company_name}
              </span>
            )}
            {(() => {
              const price = quote?.price ?? asset?.current_price
              if (price == null) return null
              const changeP = quote?.changePercent
              const isUp = changeP !== undefined && changeP >= 0
              const isPrice = activePanel.id === 'price'
              return (
                <span className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                  <span className="text-gray-300 dark:text-gray-700">·</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                    {formatPrice(price)}
                  </span>
                  {changeP !== undefined && (
                    <span className={clsx(
                      'font-medium tabular-nums',
                      isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    )}>
                      {formatPriceChange(changeP)}
                    </span>
                  )}
                  {/* Extra stats only surface on the Price panel so the other
                      panel headers stay clean. */}
                  {isPrice && (
                    <>
                      {quote?.volume != null && (
                        <HeaderStat label="Vol" value={`${(quote.volume / 1e6).toFixed(1)}M`} />
                      )}
                      {quote?.high != null && (
                        <HeaderStat label="H" value={formatPrice(quote.high)} />
                      )}
                      {quote?.low != null && (
                        <HeaderStat label="L" value={formatPrice(quote.low)} />
                      )}
                      {asset?.market_cap != null && (
                        <HeaderStat label="Mkt" value={formatPrice(asset.market_cap)} />
                      )}
                    </>
                  )}
                </span>
              )
            })()}
          </div>

          {/* Right side — timeframe selector (Price panel only) + Open button */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {isPricePanel && TIMEFRAMES.map(tf => {
              const active = timeframe === tf.id
              return (
                <button
                  key={tf.id}
                  onClick={() => setTimeframe(tf.id)}
                  className={clsx(
                    'px-2 py-0.5 rounded-md text-[11px] font-medium tabular-nums transition-colors',
                    active
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
                  )}
                >
                  {tf.label}
                </button>
              )
            })}
            {isPricePanel && onOpenAsset && (
              <span className="mx-1 h-3 w-px bg-gray-200 dark:bg-gray-700" />
            )}
            {(() => {
              // The open button routes differently per panel. Holdings should
              // open the all-portfolios list tab rather than the asset page.
              const handleOpen = () => {
                if (activePanel.id === 'holdings') {
                  window.dispatchEvent(new CustomEvent('open-portfolios-list'))
                  return
                }
                onOpenAsset?.()
              }
              const hasHandler = activePanel.id === 'holdings' || !!onOpenAsset
              if (!hasHandler) return null
              return (
                <button
                  onClick={handleOpen}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:text-primary-700 hover:bg-primary-50 dark:hover:text-primary-300 dark:hover:bg-primary-900/20 rounded-md transition-colors"
                >
                  {activePanel.openLabel}
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              )
            })()}
          </div>
        </header>

        {/* Body — keyed so content cross-fades on switch.
            overflow-x-hidden prevents horizontal scroll inside the tile. */}
        <div
          key={`${asset?.id ?? ''}-${activePanel.id}`}
          className="flex-1 min-h-0 min-w-0 overflow-hidden adc-fade-in"
        >
          <ActivePanelComponent {...ctx} />
        </div>
      </main>
    </div>
  )
}

// ── Nav item ───────────────────────────────────────────────────────────

function NavItem({
  panel, active, onClick
}: {
  panel: PanelDef
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative flex items-center gap-2 pl-3 pr-2 py-1.5 text-[12px] font-medium rounded-md transition-colors duration-150 text-left',
        active
          ? 'text-gray-900 dark:text-gray-50 bg-gray-100 dark:bg-gray-800'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-800 dark:hover:text-gray-200'
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-primary-500 dark:bg-primary-400"
        />
      )}
      <panel.Icon className={clsx('h-3.5 w-3.5 flex-shrink-0', active ? '' : 'opacity-70')} />
      <span className="truncate">{panel.label}</span>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Panels
// ═══════════════════════════════════════════════════════════════════════

function PricePanel({ asset, timeframe }: PanelContext) {
  // Timeframe state is lifted into the carousel so the selector can live
  // inline on the header row. This component is chart-only.
  return (
    <div className="h-full min-w-0">
      <InteractivePriceChart
        symbol={asset.symbol}
        days={daysForTimeframe(timeframe ?? '3M')}
      />
    </div>
  )
}

/**
 * Lightweight interactive chart for the expansion panel.
 *   • X + Y axes with price / date ticks
 *   • Tooltip on hover with a highlighted data point
 *   • Fills the parent height via ResponsiveContainer (no fixed px)
 *
 * Kept inline here rather than reusing the heavyweight FinancialChart
 * because FinancialChart ships its own header/indicator/stats chrome
 * we don't want in this inline surface.
 */
function InteractivePriceChart({ symbol, days }: { symbol: string; days: number }) {
  const { data: quote, isLoading } = useQuery({
    queryKey: ['expansion-chart-quote', symbol],
    queryFn: () => financialDataService.getQuote(symbol),
    refetchInterval: 30_000,
    staleTime: 15_000
  })

  const data = useMemo(() => {
    if (!quote) return []
    return ChartDataAdapter.generateHistoricalData(symbol, quote, days)
  }, [symbol, quote, days])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
        Loading chart…
      </div>
    )
  }

  if (!quote || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
        No chart data available
      </div>
    )
  }

  const isPositive = (quote.change ?? 0) >= 0
  const strokeColor = isPositive ? '#10b981' : '#ef4444'

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#e5e7eb"
          vertical={false}
        />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={{ stroke: '#e5e7eb' }}
          minTickGap={40}
        />
        <YAxis
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          width={44}
          orientation="right"
        />
        <Tooltip
          contentStyle={{
            fontSize: 11,
            padding: '6px 10px',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            background: '#fff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
          }}
          labelStyle={{ color: '#6b7280', fontWeight: 500, marginBottom: 2 }}
          labelFormatter={(v) => new Date(v as string).toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
          })}
          formatter={(v: number) => [`$${v.toFixed(2)}`, 'Price']}
          cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={strokeColor}
          strokeWidth={1.8}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: strokeColor }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 flex-shrink-0">
      <span className="text-gray-300 dark:text-gray-700">·</span>
      <span className="text-gray-400 dark:text-gray-500 uppercase tracking-wider text-[10px]">
        {label}
      </span>
      <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
        {value}
      </span>
    </span>
  )
}

function TargetsPanel({ asset, quote }: PanelContext) {
  const price = quote?.price ?? asset.current_price
  // Current price is shown in the carousel header's summary line,
  // so the panel body goes straight to the targets.
  return (
    <div className="h-full min-w-0">
      <PriceTargetsSummary
        assetId={asset.id}
        currentPrice={price}
        hideHeader
        className="!border-gray-100 dark:!border-gray-800 !shadow-none !rounded-md"
      />
    </div>
  )
}

function ProfilePanel({ asset }: PanelContext) {
  return (
    <div className="h-full flex flex-col gap-4 min-w-0">
      {/* Symbol + name */}
      <div className="flex-shrink-0 min-w-0">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {asset.symbol}
          </span>
          {asset.company_name && (
            <span className="text-sm text-gray-500 dark:text-gray-400 truncate min-w-0">
              {asset.company_name}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {asset.sector && (
            <span className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {asset.sector}
            </span>
          )}
          {asset.industry && (
            <span className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {asset.industry}
            </span>
          )}
        </div>
      </div>

      {/* Meta grid — uses fields the DB actually carries */}
      <div className="grid grid-cols-4 gap-4 flex-shrink-0">
        <Stat label="Mkt Cap" value={asset.market_cap ? formatPrice(asset.market_cap) : '—'} />
        <Stat label="Exchange" value={asset.exchange ?? '—'} />
        <Stat label="Country" value={asset.country ?? '—'} />
        <Stat label="Current" value={asset.current_price != null ? formatPrice(asset.current_price) : '—'} />
      </div>

      {/* Description */}
      {asset.description ? (
        <div className="flex-1 min-h-0 min-w-0">
          <FieldLabel>About</FieldLabel>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed break-words">
            {asset.description}
          </p>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400 dark:text-gray-600 italic">
          No description on file
        </div>
      )}
    </div>
  )
}

function ResearchPanel({ asset }: PanelContext) {
  const thesis = (asset.thesis ?? '').trim()
  const whereDifferent = (asset.where_different ?? '').trim()
  const risks = (asset.risks_to_thesis ?? '').trim()
  const quickNote = (asset.quick_note ?? '').trim()

  const hasAny = thesis || whereDifferent || risks || quickNote

  if (!hasAny) {
    return (
      <div className="h-full flex items-center justify-center text-center">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">No research captured yet</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
            Open the case to add thesis, where-different, and risks.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-w-0">
      <div className="space-y-4">
        {thesis && (
          <div>
            <FieldLabel>Thesis</FieldLabel>
            <p className="text-[15px] text-gray-800 dark:text-gray-100 leading-relaxed whitespace-pre-wrap break-words">
              {thesis}
            </p>
          </div>
        )}

        {whereDifferent && (
          <div className="rounded-md border-l-2 border-primary-400 dark:border-primary-500 bg-primary-50/50 dark:bg-primary-900/10 pl-3 py-2 pr-3 min-w-0">
            <FieldLabel>Where different</FieldLabel>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
              {whereDifferent}
            </p>
          </div>
        )}

        {risks && (
          <div className="rounded-md border border-red-200/70 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/20 p-3 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingDown className="h-3 w-3 text-red-600 dark:text-red-400" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-red-700 dark:text-red-400">Risks to thesis</span>
            </div>
            <p className="text-sm text-red-900 dark:text-red-200 leading-relaxed whitespace-pre-wrap break-words">{risks}</p>
          </div>
        )}

        {quickNote && (
          <div>
            <FieldLabel>Quick note</FieldLabel>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap break-words">{quickNote}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function CoveragePanel({ asset, coverage, workflows }: PanelContext) {
  const hasCoverage = coverage.length > 0
  const hasWorkflows = workflows.length > 0

  return (
    <div className="h-full flex flex-col gap-5 min-w-0">
      {/* Stage progression pipeline */}
      {asset.process_stage && (
        <StagePipeline current={asset.process_stage} />
      )}

      {asset.priority && (
        <div className="flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
            Priority · {asset.priority}
          </span>
        </div>
      )}

      {hasCoverage && (
        <div className="flex-shrink-0 min-w-0">
          <FieldLabel>
            Analysts <span className="text-gray-400 font-normal normal-case tracking-normal">· {coverage.length}</span>
          </FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {coverage.slice(0, 12).map((c: any, i: number) => {
              const first = c.user?.first_name ?? ''
              const last = c.user?.last_name ?? ''
              const email = c.user?.email ?? ''
              const name = (first && last) ? `${first} ${last}` : (first || email || c.name || `Analyst ${i + 1}`)
              const initials = (first[0] ?? email[0] ?? '?').toUpperCase()
              return (
                <span
                  key={c.id ?? i}
                  className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-gray-50 dark:bg-gray-800/70 text-[11px] text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                >
                  <span className="w-4 h-4 rounded-full bg-primary-500 text-white flex items-center justify-center text-[9px] font-semibold flex-shrink-0">
                    {initials}
                  </span>
                  <span className="truncate max-w-[140px]">{name}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {hasWorkflows && (
        <div className="min-w-0">
          <FieldLabel>
            Workflows <span className="text-gray-400 font-normal normal-case tracking-normal">· {workflows.length}</span>
          </FieldLabel>
          <div className="space-y-1">
            {workflows.slice(0, 5).map((w: any, i: number) => (
              <div key={w.id ?? i} className="text-sm text-gray-700 dark:text-gray-300 truncate">
                {w.name ?? 'Workflow'}
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasCoverage && !hasWorkflows && !asset.process_stage && !asset.priority && (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-600 italic">
          No coverage or workflows assigned
        </div>
      )}
    </div>
  )
}

function TimelinePanel({ asset }: PanelContext) {
  const events: Array<{ label: string; when: string | null; Icon: React.ComponentType<{ className?: string }>; tint?: string }> = []

  if (asset.updated_at) {
    events.push({ label: 'Last updated', when: asset.updated_at, Icon: Clock })
  }
  if (asset.process_stage) {
    // Synthetic event for stage — no timestamp, just a snapshot
    events.push({ label: `Stage: ${asset.process_stage}`, when: null, Icon: Target })
  }
  if (asset.created_at) {
    events.push({ label: 'Created', when: asset.created_at, Icon: Calendar })
  }

  if (events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400 italic">
        No timeline data yet
      </div>
    )
  }

  return (
    <div className="h-full min-w-0">
      <ol className="relative border-l border-gray-200 dark:border-gray-800 ml-1.5 pl-5 space-y-4">
        {events.map((e, i) => (
          <li key={i} className="relative">
            <span
              aria-hidden
              className="absolute -left-[21px] top-0.5 w-2.5 h-2.5 rounded-full bg-white dark:bg-gray-900 ring-2 ring-primary-400 dark:ring-primary-500"
            />
            <div className="flex items-start gap-2 min-w-0">
              <e.Icon className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {e.label}
                </div>
                {e.when && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {formatRelativeTime(e.when)} <span className="text-gray-300 dark:text-gray-600">·</span>{' '}
                    <span className="tabular-nums">{formatDistanceToNow(new Date(e.when), { addSuffix: true })}</span>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ListContextPanel({ asset }: PanelContext) {
  const assignee = asset._assignee
  const status = asset._status
  const tags = (asset._tags ?? []) as Array<{ id: string; name: string; color: string }>
  const due = asset._dueDate
  const flagged = !!asset._isFlagged
  const note = (asset._listNotes ?? '').trim()
  const addedByUser = asset._addedByUser
  const addedAt = asset._addedAt

  const hasAny = assignee || status || tags.length > 0 || due || flagged || note || addedByUser || addedAt

  if (!hasAny) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400 italic">
        No list-scoped data on this row yet
      </div>
    )
  }

  return (
    <div className="h-full min-w-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Assignee */}
        <MetaRow icon={<User className="h-3.5 w-3.5" />} label="Assignee">
          {assignee ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-800 dark:text-gray-200">
              <span className="w-5 h-5 rounded-full bg-primary-500 text-white flex items-center justify-center text-[10px] font-semibold">
                {initialsOf(assignee)}
              </span>
              {displayNameOf(assignee)}
            </span>
          ) : <EmptyDash />}
        </MetaRow>

        {/* Status */}
        <MetaRow icon={<Target className="h-3.5 w-3.5" />} label="Status">
          {status ? (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-full border"
              style={{
                backgroundColor: `${status.color}18`,
                color: status.color,
                borderColor: `${status.color}40`
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
              {status.name}
            </span>
          ) : <EmptyDash />}
        </MetaRow>

        {/* Due date */}
        <MetaRow icon={<CalendarClock className="h-3.5 w-3.5" />} label="Due">
          {due ? (
            <span className="text-sm text-gray-800 dark:text-gray-200 tabular-nums">
              {formatRelativeTime(due)}
            </span>
          ) : <EmptyDash />}
        </MetaRow>

        {/* Flagged */}
        <MetaRow icon={<Flag className={clsx('h-3.5 w-3.5', flagged && 'fill-current')} />} label="Flagged">
          {flagged ? (
            <span className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
              <Flag className="h-3 w-3 fill-current" />
              Flagged for discussion
            </span>
          ) : <EmptyDash />}
        </MetaRow>

        {/* Tags — full-width on narrow, span both columns */}
        <div className="md:col-span-2">
          <MetaRow icon={<TagIcon className="h-3.5 w-3.5" />} label="Tags">
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tags.map(t => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border"
                    style={{
                      backgroundColor: `${t.color}18`,
                      color: t.color,
                      borderColor: `${t.color}40`
                    }}
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            ) : <EmptyDash />}
          </MetaRow>
        </div>

        {/* Added by / when */}
        {(addedByUser || addedAt) && (
          <MetaRow icon={<Clock className="h-3.5 w-3.5" />} label="Added">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {addedByUser ? <span className="font-medium">{displayNameOf(addedByUser)}</span> : 'Someone'}
              {addedAt && (
                <span className="text-gray-400 dark:text-gray-500">
                  {' '}· {formatDistanceToNow(new Date(addedAt), { addSuffix: true })}
                </span>
              )}
            </span>
          </MetaRow>
        )}

        {/* Note — full-width */}
        {note && (
          <div className="md:col-span-2">
            <FieldLabel>Note</FieldLabel>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
              {note}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Holdings / Events / Valuation
// ═══════════════════════════════════════════════════════════════════════

function HoldingsPanel({ asset }: PanelContext) {
  const { data: holdings = [], isLoading } = useAssetHoldings(asset?.id)

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading holdings…</div>
  }

  if (holdings.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Not held in any portfolio</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
            When this asset appears in a portfolio snapshot, shares and P&amp;L will show here.
          </p>
        </div>
      </div>
    )
  }

  // Sort largest-value first so the dominant position is on top.
  const sorted = [...holdings].sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
  const maxWeight = Math.max(1, ...sorted.map(h => Number(h.weight_pct ?? 0)))

  // Totals across portfolios
  const totalShares = sorted.reduce((s, h) => s + (h.shares ?? 0), 0)
  const totalValue  = sorted.reduce((s, h) => s + (h.market_value ?? 0), 0)
  const totalCost   = sorted.reduce((s, h) => s + (h.cost_basis ?? 0), 0)
  const totalPnl    = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : null
  const isProfit    = totalPnl >= 0

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* Inline totals strip — matches the PricePanel header style */}
      <div className="flex items-center gap-4 flex-shrink-0 text-[11px] border-b border-gray-100 dark:border-gray-800 pb-2 mb-2 flex-wrap">
        <HoldingTotal label="Shares"   value={totalShares.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
        <HoldingTotal label="Mkt Val"  value={totalValue ? formatPrice(totalValue) : '—'} />
        <HoldingTotal label="Cost"     value={totalCost ? formatPrice(totalCost) : '—'} />
        <HoldingTotal
          label="P&amp;L"
          tone={totalCost > 0 ? (isProfit ? 'up' : 'down') : undefined}
          value={totalCost > 0
            ? `${isProfit ? '+' : ''}${formatPrice(totalPnl)}${totalPnlPct != null ? ` (${isProfit ? '+' : ''}${totalPnlPct.toFixed(1)}%)` : ''}`
            : '—'
          }
        />
        <span className="ml-auto text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {sorted.length} {sorted.length === 1 ? 'portfolio' : 'portfolios'}
        </span>
      </div>

      {/* Data grid — portfolio × metrics */}
      <div className="min-w-0 flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Column header */}
        <div className="grid grid-cols-[minmax(0,1.4fr)_80px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_70px] gap-3 items-center px-2 py-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span>Portfolio</span>
          <span className="text-right">Weight</span>
          <span className="text-right">Shares</span>
          <span className="text-right">Mkt Val</span>
          <span className="text-right">Cost</span>
          <span className="text-right">P&amp;L</span>
        </div>
        {/* Rows */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {sorted.map(h => (
            <HoldingRow key={h.id} h={h} maxWeight={maxWeight} />
          ))}
        </div>
      </div>
    </div>
  )
}

function HoldingTotal({
  label, value, tone
}: {
  label: string
  value: string
  tone?: 'up' | 'down'
}) {
  return (
    <span className="flex items-baseline gap-1.5 flex-shrink-0">
      <span className="text-gray-400 dark:text-gray-500 uppercase tracking-wider text-[10px] font-medium">
        {label}
      </span>
      <span className={clsx(
        'font-semibold tabular-nums',
        tone === 'up'   ? 'text-emerald-600 dark:text-emerald-400'
        : tone === 'down' ? 'text-red-600 dark:text-red-400'
        : 'text-gray-900 dark:text-gray-100'
      )}>
        {value}
      </span>
    </span>
  )
}

function HoldingRow({ h, maxWeight }: { h: AssetHolding; maxWeight: number }) {
  const value = h.market_value ?? 0
  const cost = h.cost_basis ?? 0
  const pnl = value - cost
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : null
  const isProfit = pnl >= 0
  const weight = h.weight_pct != null ? Number(h.weight_pct) : null
  const weightRel = weight != null ? Math.min(100, (weight / maxWeight) * 100) : 0

  const rawName = h.portfolio_name?.trim() ?? ''
  const hasName = rawName.length > 0

  const openPortfolio = () => {
    if (!h.portfolio_id) return
    window.dispatchEvent(new CustomEvent('open-portfolio', {
      detail: { id: h.portfolio_id, name: rawName || 'Portfolio' }
    }))
  }

  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_80px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_70px] gap-3 items-center px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-[12px] border-b border-gray-50 dark:border-gray-900 last:border-b-0">
      {/* Portfolio name — clickable when we have a name to navigate to */}
      {h.portfolio_id && hasName ? (
        <button
          onClick={openPortfolio}
          title={`Open ${rawName}`}
          className="truncate text-left font-medium text-gray-800 dark:text-gray-200 hover:text-primary-700 dark:hover:text-primary-400 hover:underline underline-offset-2 transition-colors"
        >
          {rawName}
        </button>
      ) : (
        <span
          title="You don't have access to this portfolio (archived or in another team)"
          className="truncate italic text-gray-400 dark:text-gray-500"
        >
          Restricted portfolio
        </span>
      )}

      {/* Weight — bar + number */}
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="flex-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gray-400 dark:bg-gray-500"
            style={{ width: `${weightRel}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400 w-8 text-right flex-shrink-0">
          {weight != null ? `${weight.toFixed(1)}%` : '—'}
        </span>
      </div>

      {/* Shares */}
      <span className="text-right tabular-nums text-gray-600 dark:text-gray-400">
        {h.shares != null ? h.shares.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
      </span>

      {/* Mkt Val */}
      <span className="text-right tabular-nums text-gray-800 dark:text-gray-200 font-medium">
        {value ? formatPrice(value) : '—'}
      </span>

      {/* Cost */}
      <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">
        {cost ? formatPrice(cost) : '—'}
      </span>

      {/* P&L — $ on top, % below, color-coded */}
      <div className={clsx(
        'text-right tabular-nums font-medium leading-tight',
        cost > 0 ? (isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') : 'text-gray-400'
      )}>
        {cost > 0 ? (
          <>
            <div>{`${isProfit ? '+' : ''}${formatPrice(pnl)}`}</div>
            <div className="text-[10px] opacity-80">
              {`${isProfit ? '+' : ''}${(pnlPct ?? 0).toFixed(1)}%`}
            </div>
          </>
        ) : '—'}
      </div>
    </div>
  )
}

function EventsPanel({ asset }: PanelContext) {
  const { data: events = [], isLoading } = useAssetEvents(asset?.id, 12)

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading events…</div>
  }

  if (events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">No scheduled events</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
            Earnings dates and asset-scoped calendar entries will surface here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-w-0">
      <div className="space-y-2">
        {events.map(e => <EventRow key={e.id} event={e} />)}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: AssetEvent }) {
  const when = event.start_date ? parseISO(event.start_date) : null
  const isUpcoming = when ? isAfter(when, new Date()) : false
  const days = when ? differenceInCalendarDays(when, new Date()) : null
  const isEarnings = event.kind === 'earnings'

  return (
    <div className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors min-w-0">
      {/* Date block */}
      <div className={clsx(
        'flex-shrink-0 w-12 flex flex-col items-center justify-center py-1 rounded-md text-[10px] leading-tight',
        isUpcoming
          ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
          : 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
      )}>
        <span className="uppercase tracking-wider">{when ? format(when, 'MMM') : '—'}</span>
        <span className="text-[16px] font-bold leading-none">{when ? format(when, 'd') : '?'}</span>
      </div>

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {isEarnings ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 rounded flex-shrink-0">
              {event.is_estimated ? 'Est.' : 'Earnings'}
            </span>
          ) : event.event_type ? (
            <span className="inline-flex items-center px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 rounded flex-shrink-0">
              {event.event_type}
            </span>
          ) : null}
          <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{event.title}</span>
        </div>
        {when && (
          <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums mt-0.5">
            {format(when, 'EEE, MMM d, yyyy')}
            {days !== null && (
              <span className="text-gray-400 dark:text-gray-500">
                {' '}· {days === 0 ? 'today' : days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ValuationPanel({ asset }: PanelContext) {
  // Honest about what the DB actually carries. market_cap + current_price
  // are the only hard numbers; everything else is stubbed until a
  // fundamentals feed is wired.
  const marketCap = asset?.market_cap
  const price = asset?.current_price

  return (
    <div className="h-full flex flex-col gap-4 min-w-0">
      {/* Primary: what we actually have */}
      <div className="grid grid-cols-2 gap-4 flex-shrink-0">
        <Stat label="Market Cap" value={marketCap ? formatPrice(marketCap) : '—'} />
        <Stat label="Current Price" value={price != null ? formatPrice(price) : '—'} />
      </div>

      {/* Known-unknown section — clear about missing data */}
      <div className="min-w-0">
        <FieldLabel>Fundamentals</FieldLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
          <MissingMetric label="P/E" />
          <MissingMetric label="P/B" />
          <MissingMetric label="EV / EBITDA" />
          <MissingMetric label="Dividend Yield" />
          <MissingMetric label="Gross Margin" />
          <MissingMetric label="FCF Yield" />
        </div>
      </div>

      {/* Honest empty-state explainer */}
      <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-800 p-3 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed flex-shrink-0">
        Detailed valuation metrics require a fundamentals data feed (e.g. Polygon, Alpha
        Vantage, Refinitiv). Once ingested, ratios, margins, and yields will populate here.
      </div>
    </div>
  )
}

function MissingMetric({ label }: { label: string }) {
  return (
    <div className="rounded-md bg-gray-50 dark:bg-gray-800/40 px-3 py-2 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500 truncate">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums text-gray-400 dark:text-gray-600">
        —
      </div>
    </div>
  )
}

// ── Stage progression pipeline (used by CoveragePanel) ────────────────

function StagePipeline({ current }: { current: string }) {
  const currentIdx = STAGE_FLOW.indexOf(current as any)
  const isOutdated = current === 'outdated'

  return (
    <div className="flex-shrink-0 min-w-0">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500 mb-2">
        <span>Stage</span>
        <span className="normal-case tracking-normal text-gray-600 dark:text-gray-300">
          {STAGE_META[current]?.label ?? current}
        </span>
      </div>

      {isOutdated ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="w-2 h-2 rounded-full bg-gray-400" />
          Outdated — stage pipeline not applicable
        </div>
      ) : (
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          {STAGE_FLOW.map((stage, i) => {
            const isActive = i === currentIdx
            const isPassed = currentIdx > -1 && i < currentIdx
            const meta = STAGE_META[stage]
            return (
              <React.Fragment key={stage}>
                <div
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                    isActive && 'bg-gray-900 text-white dark:bg-white dark:text-gray-900',
                    isPassed && 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                    !isActive && !isPassed && 'text-gray-400 dark:text-gray-600'
                  )}
                  title={meta.label}
                >
                  {isPassed
                    ? <Check className="h-3 w-3" />
                    : <span className={clsx('w-1.5 h-1.5 rounded-full', meta.dot, isActive ? 'opacity-100' : 'opacity-60')} />
                  }
                  <span className="truncate">{meta.label}</span>
                </div>
                {i < STAGE_FLOW.length - 1 && (
                  <span
                    aria-hidden
                    className={clsx(
                      'h-px w-3 flex-shrink-0',
                      i < currentIdx ? 'bg-gray-300 dark:bg-gray-600' : 'bg-gray-200 dark:bg-gray-800'
                    )}
                  />
                )}
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Small shared bits ──────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500 mb-1.5">
      {children}
    </div>
  )
}

function Stat({
  label, value, tone
}: {
  label: string
  value: React.ReactNode
  tone?: 'up' | 'down'
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500 mb-1">
        {label}
      </div>
      <div className={clsx(
        'text-sm font-semibold tabular-nums truncate',
        tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'down' && 'text-red-600 dark:text-red-400',
        !tone && 'text-gray-800 dark:text-gray-200'
      )}>
        {value}
      </div>
    </div>
  )
}

function MetaRow({
  icon, label, children
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500 mb-1">
        {icon}
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function EmptyDash() {
  return <span className="text-sm text-gray-400 dark:text-gray-600">—</span>
}

function initialsOf(u: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!u) return '?'
  if (u.first_name && u.last_name) return `${u.first_name[0]}${u.last_name[0]}`.toUpperCase()
  if (u.first_name) return u.first_name[0].toUpperCase()
  if (u.email) return u.email[0].toUpperCase()
  return '?'
}

function displayNameOf(u: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!u) return 'Unknown'
  if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
  if (u.first_name) return u.first_name
  return u.email ?? 'Unknown'
}

// ── Animation ──────────────────────────────────────────────────────────

const ADC_STYLES = `
@keyframes adcFadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}
.adc-fade-in { animation: adcFadeIn 160ms ease-out; }
`
