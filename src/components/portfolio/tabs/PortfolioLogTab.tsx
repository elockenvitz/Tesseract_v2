import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, isToday, isThisWeek, isThisMonth } from 'date-fns'
import {
  MessageCircle, Lightbulb, TrendingUp, ClipboardList,
  FileText, BookOpen, BarChart3, MessageSquare,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'

// ---------------------------------------------------------------------------
// Activity event types — decision lifecycle
// ---------------------------------------------------------------------------

interface ActivityEvent {
  id: string
  eventType: string
  title: string
  description: string | null
  assetSymbol: string | null
  actorName: string | null
  occurredAt: string
}

interface EventTypeCfg {
  label: string
  icon: React.ElementType
  iconColor: string
  textColor: string
}

const EVENT_CONFIG: Record<string, EventTypeCfg> = {
  // Thoughts — portfolio-level observations
  observation:      { label: 'Observation',      icon: MessageCircle,  iconColor: 'text-gray-400',    textColor: 'text-gray-500' },
  // Ideas — investment ideas
  idea:             { label: 'Idea',             icon: Lightbulb,      iconColor: 'text-amber-500',   textColor: 'text-amber-600' },
  // Trades — trade pipeline
  trade_sized:      { label: 'Trade Sized',      icon: TrendingUp,     iconColor: 'text-emerald-500', textColor: 'text-emerald-600' },
  trade_sheet:      { label: 'Trade Sheet',      icon: ClipboardList,  iconColor: 'text-violet-500',  textColor: 'text-violet-600' },
  trade_rationale:  { label: 'Trade Rationale',  icon: FileText,       iconColor: 'text-orange-500',  textColor: 'text-orange-600' },
  // Research — asset & theme research
  thesis_update:    { label: 'Thesis Update',    icon: BookOpen,       iconColor: 'text-blue-500',    textColor: 'text-blue-600' },
  earnings_note:    { label: 'Earnings Note',    icon: BarChart3,      iconColor: 'text-emerald-500', textColor: 'text-emerald-600' },
  research_note:    { label: 'Research Note',    icon: MessageSquare,  iconColor: 'text-indigo-500',  textColor: 'text-indigo-600' },
}

const DEFAULT_CFG: EventTypeCfg = {
  label: 'Event', icon: FileText, iconColor: 'text-gray-400', textColor: 'text-gray-500',
}

// ---------------------------------------------------------------------------
// Note type → event type mapping
// ---------------------------------------------------------------------------

const NOTE_TYPE_MAP: Record<string, string> = {
  // Thoughts
  general:           'observation',
  market_commentary: 'observation',
  analysis:          'observation',
  risk_review:       'observation',
  risk:              'observation',
  // Trades
  trade_rationale:   'trade_rationale',
  idea:              'trade_rationale',
  // Research
  thesis_update:     'thesis_update',
  thesis:            'thesis_update',
  earnings:          'earnings_note',
  earnings_prep:     'earnings_note',
  meeting:           'research_note',
  call:              'research_note',
  research:          'research_note',
}

// ---------------------------------------------------------------------------
// Filters — decision lifecycle
// ---------------------------------------------------------------------------

interface FilterDef { key: string; label: string; match: string[] }

const FILTERS: FilterDef[] = [
  { key: 'all',       label: 'All',       match: [] },
  { key: 'thoughts',  label: 'Thoughts',  match: ['observation'] },
  { key: 'ideas',     label: 'Ideas',     match: ['idea'] },
  { key: 'trades',    label: 'Trades',    match: ['idea', 'trade_sized', 'trade_sheet', 'trade_rationale'] },
  { key: 'research',  label: 'Research',  match: ['thesis_update', 'earnings_note', 'research_note'] },
]

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

type TimeBucket = 'Today' | 'This Week' | 'This Month' | 'Older'
const BUCKET_ORDER: TimeBucket[] = ['Today', 'This Week', 'This Month', 'Older']

function timeBucket(dateStr: string): TimeBucket {
  const d = new Date(dateStr)
  if (isToday(d)) return 'Today'
  if (isThisWeek(d, { weekStartsOn: 1 })) return 'This Week'
  if (isThisMonth(d)) return 'This Month'
  return 'Older'
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr)
  if (isToday(d)) return format(d, 'h:mm a')
  return format(d, 'MMM d')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null
  return s.length > max ? s.slice(0, max) + '...' : s
}

// ---------------------------------------------------------------------------
// Data fetching + normalization
// ---------------------------------------------------------------------------

async function fetchPortfolioActivity(portfolioId: string): Promise<ActivityEvent[]> {
  // Parallel queries for all sources
  const [tqiRes, lvRes, tsRes, pnRes] = await Promise.all([
    // Trade ideas (investment ideas)
    supabase
      .from('trade_queue_items')
      .select('id, asset_id, action, rationale, stage, created_by, created_at')
      .eq('portfolio_id', portfolioId)
      .is('deleted_at', null)
      .or('visibility_tier.is.null,visibility_tier.eq.active')
      .order('created_at', { ascending: false })
      .limit(30),

    // Lab variants (sized trades)
    supabase
      .from('lab_variants')
      .select('id, asset_id, action, sizing_input, computed, created_by, created_at')
      .eq('portfolio_id', portfolioId)
      .not('sizing_input', 'is', null)
      .is('deleted_at', null)
      .or('visibility_tier.is.null,visibility_tier.eq.active')
      .order('created_at', { ascending: false })
      .limit(30),

    // Trade sheets
    supabase
      .from('trade_sheets')
      .select('id, name, status, total_trades, net_weight_change, created_by, created_at')
      .eq('portfolio_id', portfolioId)
      .or('visibility_tier.is.null,visibility_tier.eq.active')
      .order('created_at', { ascending: false })
      .limit(15),

    // Portfolio notes
    supabase
      .from('portfolio_notes')
      .select('id, title, content_preview, note_type, updated_by, created_by, created_at, updated_at')
      .eq('portfolio_id', portfolioId)
      .neq('is_deleted', true)
      .order('updated_at', { ascending: false })
      .limit(30),
  ])

  // Batch-fetch users and assets for all rows
  const allRows = [
    ...(tqiRes.data || []),
    ...(lvRes.data || []),
    ...(tsRes.data || []),
    ...(pnRes.data || []),
  ]

  const userIds = [...new Set(
    allRows.flatMap((r: any) => [r.created_by, r.updated_by]).filter(Boolean),
  )]
  const assetIds = [...new Set(
    allRows.map((r: any) => r.asset_id).filter(Boolean),
  )]

  const [usersRes, assetsRes] = await Promise.all([
    userIds.length > 0
      ? supabase.from('users').select('id, first_name, email').in('id', userIds)
      : Promise.resolve({ data: [] as any[] }),
    assetIds.length > 0
      ? supabase.from('assets').select('id, symbol, company_name').in('id', assetIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const userMap = new Map<string, string>(
    (usersRes.data || []).map((u: any) => [u.id, u.first_name || u.email?.split('@')[0] || '']),
  )
  const assetMap = new Map<string, { symbol: string; name: string }>(
    (assetsRes.data || []).map((a: any) => [a.id, { symbol: a.symbol, name: a.company_name }]),
  )

  // Normalize each source
  const events: ActivityEvent[] = []

  // Investment ideas (trade_queue_items)
  for (const r of tqiRes.data || []) {
    const asset = assetMap.get(r.asset_id)
    events.push({
      id: `tqi-${r.id}`,
      eventType: 'idea',
      title: `${capitalize(r.action || 'Trade')} ${asset?.symbol || 'Unknown'}`,
      description: truncate(r.rationale, 120),
      assetSymbol: asset?.symbol || null,
      actorName: userMap.get(r.created_by) || null,
      occurredAt: r.created_at,
    })
  }

  // Sized trades (lab_variants)
  for (const r of lvRes.data || []) {
    const asset = assetMap.get(r.asset_id)
    const computed = r.computed as any
    const deltaWeight = computed?.delta_weight
    const desc = deltaWeight != null
      ? `${deltaWeight >= 0 ? '+' : ''}${Number(deltaWeight).toFixed(2)}% portfolio weight`
      : r.sizing_input ? `Size: ${r.sizing_input}` : null
    events.push({
      id: `lv-${r.id}`,
      eventType: 'trade_sized',
      title: `${capitalize(r.action || 'Trade')} ${asset?.symbol || 'Unknown'}`,
      description: desc,
      assetSymbol: asset?.symbol || null,
      actorName: userMap.get(r.created_by) || null,
      occurredAt: r.created_at,
    })
  }

  // Trade sheets
  for (const r of tsRes.data || []) {
    events.push({
      id: `ts-${r.id}`,
      eventType: 'trade_sheet',
      title: r.name || 'Trade Sheet',
      description: `${r.total_trades || 0} trades \u00b7 ${capitalize(r.status || 'draft')}`,
      assetSymbol: null,
      actorName: userMap.get(r.created_by) || null,
      occurredAt: r.created_at,
    })
  }

  // Portfolio notes (mapped by note_type)
  for (const r of pnRes.data || []) {
    const eventType = NOTE_TYPE_MAP[r.note_type] || 'observation'
    events.push({
      id: `pn-${r.id}`,
      eventType,
      title: r.title || 'Untitled',
      description: truncate(r.content_preview, 120),
      assetSymbol: null,
      actorName: userMap.get(r.updated_by || r.created_by) || null,
      occurredAt: r.updated_at || r.created_at,
    })
  }

  events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
  return events
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PortfolioLogTabProps {
  portfolio: any
  portfolioId: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortfolioLogTab({ portfolio, portfolioId }: PortfolioLogTabProps) {
  const [activeFilter, setActiveFilter] = useState('all')

  const { data: events, isLoading } = useQuery({
    queryKey: ['portfolio-activity', portfolioId],
    enabled: !!portfolioId,
    queryFn: () => fetchPortfolioActivity(portfolioId),
    staleTime: 60_000,
  })

  // ── Filtered ──────────────────────────────────────────────

  const filteredEvents = useMemo(() => {
    if (!events) return []
    if (activeFilter === 'all') return events
    const filter = FILTERS.find(f => f.key === activeFilter)
    if (!filter || filter.match.length === 0) return events
    return events.filter(e => filter.match.includes(e.eventType))
  }, [events, activeFilter])

  // ── Grouped by time bucket ────────────────────────────────

  const grouped = useMemo(() => {
    const map = new Map<TimeBucket, ActivityEvent[]>()
    for (const entry of filteredEvents) {
      const bucket = timeBucket(entry.occurredAt)
      if (!map.has(bucket)) map.set(bucket, [])
      map.get(bucket)!.push(entry)
    }
    return BUCKET_ORDER.filter(b => map.has(b)).map(b => ({ bucket: b, entries: map.get(b)! }))
  }, [filteredEvents])

  // ── Loading state ─────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <p className="text-[11px] text-gray-400">Loading activity...</p>
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────

  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[13px] font-semibold text-gray-900">Portfolio Log</h3>
        </div>
        <div className="border border-dashed border-gray-200 rounded-lg py-12 px-6">
          <div className="max-w-sm mx-auto text-center">
            <p className="text-[12px] text-gray-500 leading-relaxed">
              Portfolio activity will appear here as trades, ideas, research updates, and decisions occur across the platform.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Main timeline view ────────────────────────────────────

  return (
    <div className="flex flex-col">

      {/* ─── HEADER ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-gray-900">Portfolio Log</h3>
          <span className="text-[10px] text-gray-400 tabular-nums">{events.length}</span>
        </div>
      </div>

      {/* ─── FILTERS ────────────────────────────────────────── */}
      <div className="inline-flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg mb-3">
        {FILTERS.map(f => {
          const isActive = activeFilter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-all duration-100 ${
                isActive
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* ─── TIMELINE ───────────────────────────────────────── */}
      {grouped.length > 0 ? (
        <div className="flex flex-col">
          {grouped.map(({ bucket, entries }) => (
            <div key={bucket}>
              {/* Bucket header */}
              <div className="flex items-center gap-2 pt-3 pb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{bucket}</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              {/* Entries */}
              <div className="flex flex-col divide-y divide-gray-100">
                {entries.map(entry => {
                  const cfg = EVENT_CONFIG[entry.eventType] || DEFAULT_CFG
                  const Icon = cfg.icon
                  const ts = formatTimestamp(entry.occurredAt)

                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-2.5 py-2.5 px-1"
                    >
                      {/* Icon */}
                      <div className="shrink-0 pt-[2px]">
                        <Icon className={`h-3.5 w-3.5 ${cfg.iconColor}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-px">
                          <span className={`text-[9px] font-semibold uppercase tracking-wider ${cfg.textColor}`}>
                            {cfg.label}
                          </span>
                          {entry.assetSymbol && (
                            <span className="text-[9px] font-medium text-gray-400 bg-gray-100 px-1.5 py-px rounded">
                              {entry.assetSymbol}
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] font-semibold text-gray-900 leading-tight truncate">
                          {entry.title}
                        </p>
                        {entry.description && (
                          <p className="text-[11px] text-gray-400 leading-snug mt-0.5 line-clamp-1">
                            {entry.description}
                          </p>
                        )}
                      </div>

                      {/* Actor + timestamp */}
                      <div className="shrink-0 text-right pt-[2px]">
                        <span className="text-[10px] text-gray-400 tabular-nums">{ts}</span>
                        {entry.actorName && (
                          <p className="text-[10px] text-gray-400 mt-px">{entry.actorName}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center">
          <p className="text-[11px] text-gray-400">No activity matches this filter.</p>
        </div>
      )}
    </div>
  )
}
