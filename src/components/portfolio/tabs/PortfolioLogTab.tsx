import React, { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, isToday, isThisWeek, isThisMonth } from 'date-fns'
import { clsx } from 'clsx'
import {
  Lightbulb, BookOpen, BarChart3, MessageSquare,
  FileText, Users, Phone, User, Eye, HelpCircle, Send,
  ChevronRight, ChevronDown, ArrowRight, Plus,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { usePortfolioLogChains, SOURCE_TO_LINKABLE } from '../../../hooks/usePortfolioLogChains'
import type { SourceObjectType } from '../../../hooks/usePortfolioLogChains'
import { usePendingLineageStore } from '../../../stores/pendingLineageStore'
import { useSidebarStore } from '../../../stores/sidebarStore'

// ---------------------------------------------------------------------------
// Portfolio Log — the portfolio's decision lineage
//
// This is a DERIVED READ SURFACE. It renders real platform objects
// and their lineage relationships (via object_links, link_type='results_in').
// It does NOT create objects.
//
// "Next step" actions launch NATIVE creation flows:
//   Thought    → openThoughtsCapture event → right-hand pane
//   Prompt     → openThoughtsCapture event (captureType='prompt')
//   Note       → note-editor tab navigation
//   Trade Idea → openThoughtsCapture event (captureType='trade_idea')
//
// Lineage linking happens automatically via pendingLineageStore:
//   1. Portfolio Log sets pending lineage (parentType, parentId)
//   2. Dispatches native launcher
//   3. Native creator creates real object
//   4. Native creator's onSuccess auto-links via object_links
// ---------------------------------------------------------------------------

type EntryCategory = 'idea' | 'research' | 'observation' | 'question' | 'proposal'

interface LogEntry {
  id: string
  sourceObjectType: SourceObjectType
  sourceObjectId: string
  category: EntryCategory
  subLabel: string | null
  title: string
  body: string | null
  assetSymbols: string[]
  actorName: string | null
  occurredAt: string
  sentiment: string | null
}

interface ResolvedChain {
  root: LogEntry
  children: LogEntry[]
}

type DisplayItem =
  | { kind: 'standalone'; entry: LogEntry }
  | { kind: 'chain'; chain: ResolvedChain }

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

interface CategoryConfig {
  label: string
  icon: React.ElementType
  border: string
  dot: string
  labelColor: string
  labelBg: string
}

const CATEGORY: Record<EntryCategory, CategoryConfig> = {
  idea: {
    label: 'Idea', icon: Lightbulb,
    border: 'border-l-amber-400 dark:border-l-amber-500',
    dot: 'bg-amber-400 dark:bg-amber-500',
    labelColor: 'text-amber-700 dark:text-amber-300',
    labelBg: 'bg-amber-50 dark:bg-amber-900/30',
  },
  research: {
    label: 'Research', icon: BookOpen,
    border: 'border-l-blue-400 dark:border-l-blue-500',
    dot: 'bg-blue-400 dark:bg-blue-500',
    labelColor: 'text-blue-700 dark:text-blue-300',
    labelBg: 'bg-blue-50 dark:bg-blue-900/30',
  },
  observation: {
    label: 'Observation', icon: Eye,
    border: 'border-l-violet-400 dark:border-l-violet-500',
    dot: 'bg-violet-400 dark:bg-violet-500',
    labelColor: 'text-violet-700 dark:text-violet-300',
    labelBg: 'bg-violet-50 dark:bg-violet-900/30',
  },
  question: {
    label: 'Question', icon: HelpCircle,
    border: 'border-l-teal-400 dark:border-l-teal-500',
    dot: 'bg-teal-400 dark:bg-teal-500',
    labelColor: 'text-teal-700 dark:text-teal-300',
    labelBg: 'bg-teal-50 dark:bg-teal-900/30',
  },
  proposal: {
    label: 'Recommendation', icon: Send,
    border: 'border-l-emerald-400 dark:border-l-emerald-500',
    dot: 'bg-emerald-400 dark:bg-emerald-500',
    labelColor: 'text-emerald-700 dark:text-emerald-300',
    labelBg: 'bg-emerald-50 dark:bg-emerald-900/30',
  },
}

// Next step types — each launches a NATIVE creation flow
const NEXT_STEP_ACTIONS = [
  { key: 'thought',    label: 'Thought',    icon: Eye        },
  { key: 'prompt',     label: 'Prompt',     icon: HelpCircle },
  { key: 'note',       label: 'Note',       icon: BookOpen   },
  { key: 'trade_idea', label: 'Trade Idea', icon: Lightbulb  },
] as const

type NextStepKey = typeof NEXT_STEP_ACTIONS[number]['key']

// ---------------------------------------------------------------------------
// Note sub-labels + research icons
// ---------------------------------------------------------------------------

const NOTE_SUB_LABELS: Record<string, string> = {
  research: 'Research', analysis: 'Analysis', earnings: 'Earnings',
  earnings_prep: 'Earnings', model_valuation: 'Valuation', thesis: 'Thesis',
  thesis_update: 'Thesis', decision: 'Decision', risk: 'Risk',
  risk_review: 'Risk', general: 'General', market_commentary: 'Commentary',
  idea: 'Idea', meeting: 'Meeting', meeting_notes: 'Meeting',
  call: 'Call', trade_rationale: 'Rationale',
}

const RESEARCH_ICON: Record<string, React.ElementType> = {
  Earnings: BarChart3, Meeting: Users, Call: Phone,
  Analysis: FileText, Thesis: BookOpen, Research: MessageSquare,
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

interface FilterDef { key: string; label: string; category: EntryCategory | null }

const FILTERS: FilterDef[] = [
  { key: 'all',          label: 'All',          category: null },
  { key: 'ideas',        label: 'Ideas',        category: 'idea' },
  { key: 'research',     label: 'Research',     category: 'research' },
  { key: 'observations', label: 'Observations', category: 'observation' },
  { key: 'questions',    label: 'Questions',    category: 'question' },
  { key: 'proposals',    label: 'Recommendations', category: 'proposal' },
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
// Data fetching — derives entries from real platform objects
// ---------------------------------------------------------------------------

async function fetchPortfolioLog(portfolioId: string): Promise<LogEntry[]> {
  const [tqiRes, pnRes, qtRes, tpRes] = await Promise.all([
    supabase
      .from('trade_queue_items')
      .select('id, asset_id, action, rationale, stage, created_by, created_at')
      .eq('portfolio_id', portfolioId)
      .is('deleted_at', null)
      .or('visibility_tier.is.null,visibility_tier.eq.active')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('portfolio_notes')
      .select('id, title, content_preview, note_type, updated_by, created_by, created_at, updated_at')
      .eq('portfolio_id', portfolioId)
      .neq('is_deleted', true)
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('quick_thoughts')
      .select('id, content, idea_type, sentiment, asset_id, created_by, created_at')
      .eq('portfolio_id', portfolioId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('decision_requests')
      .select(`
        id, trade_queue_item_id, requested_by, requested_action, submission_snapshot, created_at,
        trade_queue_item:trade_queue_item_id (asset_id, action)
      `)
      .eq('portfolio_id', portfolioId)
      .in('status', ['pending', 'under_review', 'needs_discussion'])
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  const allRows = [
    ...(tqiRes.data || []), ...(pnRes.data || []),
    ...(qtRes.data || []), ...(tpRes.data || []),
  ]
  const userIds = [...new Set(
    allRows.flatMap((r: any) => [r.created_by, r.updated_by, r.user_id, r.requested_by]).filter(Boolean),
  )]
  const assetIds = [...new Set(
    allRows.map((r: any) => r.asset_id || (r as any).trade_queue_items?.asset_id || (r as any).trade_queue_item?.asset_id).filter(Boolean),
  )]

  const [usersRes, assetsRes] = await Promise.all([
    userIds.length > 0
      ? supabase.from('users').select('id, first_name, last_name, email').in('id', userIds)
      : Promise.resolve({ data: [] as any[] }),
    assetIds.length > 0
      ? supabase.from('assets').select('id, symbol, company_name').in('id', assetIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const userMap = new Map<string, string>(
    (usersRes.data || []).map((u: any) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ')
      return [u.id, name || u.email?.split('@')[0] || '']
    }),
  )
  const assetMap = new Map<string, { symbol: string; name: string }>(
    (assetsRes.data || []).map((a: any) => [a.id, { symbol: a.symbol, name: a.company_name }]),
  )

  const entries: LogEntry[] = []

  for (const r of tqiRes.data || []) {
    const asset = assetMap.get(r.asset_id)
    entries.push({
      id: `tqi-${r.id}`, sourceObjectType: 'trade_queue_item', sourceObjectId: r.id,
      category: 'idea', subLabel: r.stage ? capitalize(r.stage) : null,
      title: `${capitalize(r.action || 'Trade')} ${asset?.symbol || 'Unknown'}`,
      body: truncate(r.rationale, 180), assetSymbols: asset ? [asset.symbol] : [],
      actorName: userMap.get(r.created_by) || null, occurredAt: r.created_at, sentiment: null,
    })
  }

  for (const r of pnRes.data || []) {
    entries.push({
      id: `pn-${r.id}`, sourceObjectType: 'portfolio_note', sourceObjectId: r.id,
      category: 'research', subLabel: NOTE_SUB_LABELS[r.note_type] || null,
      title: r.title || 'Untitled', body: truncate(r.content_preview, 180),
      assetSymbols: [], actorName: userMap.get(r.updated_by || r.created_by) || null,
      occurredAt: r.updated_at || r.created_at, sentiment: null,
    })
  }

  for (const r of qtRes.data || []) {
    const asset = r.asset_id ? assetMap.get(r.asset_id) : null
    const ideaType = (r as any).idea_type
    const isPrompt = ideaType === 'prompt'
    entries.push({
      id: `qt-${r.id}`, sourceObjectType: 'quick_thought', sourceObjectId: r.id,
      category: isPrompt ? 'question' : 'observation',
      subLabel: ideaType === 'research_idea' ? 'Research Idea' : ideaType === 'thesis' ? 'Thesis' : null,
      title: truncate(r.content, 100) || (isPrompt ? 'Question' : 'Observation'),
      body: r.content.length > 100 ? truncate(r.content, 180) : null,
      assetSymbols: asset ? [asset.symbol] : [],
      actorName: userMap.get(r.created_by) || null, occurredAt: r.created_at,
      sentiment: r.sentiment || null,
    })
  }

  for (const r of tpRes.data || []) {
    const tqi = (r as any).trade_queue_item
    const snap = (r as any).submission_snapshot as Record<string, any> | null
    const asset = tqi?.asset_id ? assetMap.get(tqi.asset_id) : null
    const action = snap?.action ? capitalize(snap.action) : tqi?.action ? capitalize(tqi.action) : 'Trade'
    const weight = snap?.weight ?? null
    const shares = snap?.shares ?? null
    const sizing = weight != null ? `${weight}% weight` : shares != null ? `${shares} shares` : null
    const notes = snap?.notes ?? null
    entries.push({
      id: `dr-${r.id}`, sourceObjectType: 'decision_request', sourceObjectId: r.id,
      category: 'proposal', subLabel: sizing,
      title: `${action} ${snap?.symbol || asset?.symbol || 'Unknown'}${sizing ? ` — ${sizing}` : ''}`,
      body: truncate(notes, 180), assetSymbols: asset ? [asset.symbol] : snap?.symbol ? [snap.symbol] : [],
      actorName: snap?.requester_name || userMap.get((r as any).requested_by) || null,
      occurredAt: r.created_at, sentiment: null,
    })
  }

  entries.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
  return entries
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PortfolioLogTabProps {
  portfolio: any
  portfolioId: string
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PortfolioLogTab({ portfolio, portfolioId }: PortfolioLogTabProps) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set())

  const { data: allEntries, isLoading: entriesLoading } = useQuery({
    queryKey: ['portfolio-log', portfolioId],
    enabled: !!portfolioId,
    queryFn: () => fetchPortfolioLog(portfolioId),
    staleTime: 60_000,
  })

  // Collect all source object IDs for chain query
  const entryObjectIds = useMemo(
    () => (allEntries || []).map(e => e.sourceObjectId),
    [allEntries],
  )

  const {
    parentOf, childrenOf, isLoading: chainsLoading,
  } = usePortfolioLogChains(portfolioId, entryObjectIds)

  const isLoading = entriesLoading || chainsLoading
  const openInspector = useSidebarStore(s => s.openInspector)

  // ── Navigate to underlying object ──────────────────────────

  const navigateToObject = useCallback((entry: LogEntry) => {
    const pName = portfolio?.name || 'Portfolio'

    switch (entry.sourceObjectType) {
      case 'quick_thought':
        openInspector('quick_thought', entry.sourceObjectId)
        break
      case 'portfolio_note':
        window.dispatchEvent(new CustomEvent('decision-engine-action', {
          detail: {
            id: `portfolio-notes-${portfolioId}`,
            title: `${pName} Notes`,
            type: 'note',
            data: { entityType: 'portfolio', entityId: portfolioId, portfolioId, portfolioName: pName, id: entry.sourceObjectId },
          },
        }))
        break
      case 'trade_queue_item':
        openInspector('trade_idea', entry.sourceObjectId)
        break
      case 'trade_proposal':
      case 'decision_request':
        openInspector('trade_idea', entry.sourceObjectId)
        break
    }
  }, [portfolioId, portfolio?.name, openInspector])

  // ── Build entry lookup by sourceObjectId ────────────────────

  const entryByObjectId = useMemo(() => {
    const m = new Map<string, LogEntry>()
    for (const e of allEntries || []) m.set(e.sourceObjectId, e)
    return m
  }, [allEntries])

  // ── Build chains from lineage edges ─────────────────────────

  const displayItems = useMemo((): DisplayItem[] => {
    if (!allEntries) return []

    // Collect all descendants recursively (breadth-first, oldest → newest).
    // Includes a visited set to guard against cycles in the data.
    const collectDescendants = (rootId: string): LogEntry[] => {
      const result: LogEntry[] = []
      const visited = new Set<string>([rootId])
      const queue = [...(childrenOf.get(rootId) || [])]
      while (queue.length > 0) {
        const childId = queue.shift()!
        if (visited.has(childId)) continue // cycle guard
        visited.add(childId)
        const entry = entryByObjectId.get(childId)
        if (entry) result.push(entry)
        const grandchildren = childrenOf.get(childId) || []
        queue.push(...grandchildren)
      }
      // Sort oldest → newest so reasoning reads forward
      result.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
      return result
    }

    const chainedIds = new Set<string>()

    // Build chains: find root entries (no parent in this log) that have children.
    // An entry whose parent exists in the edge set but is NOT in the current
    // log entries (deleted/cross-portfolio) is treated as a root, not hidden.
    const chains: ResolvedChain[] = []
    for (const entry of allEntries) {
      const objId = entry.sourceObjectId
      const hasChildren = (childrenOf.get(objId) || []).length > 0
      const parentId = parentOf.get(objId)
      const parentInLog = parentId ? entryByObjectId.has(parentId) : false

      if (parentInLog) {
        // This entry's parent is visible in the log — it will appear as a child
        chainedIds.add(objId)
        continue
      }

      if (hasChildren) {
        const children = collectDescendants(objId)
        for (const c of children) chainedIds.add(c.sourceObjectId)
        chains.push({ root: entry, children })
      }
    }

    const items: DisplayItem[] = []
    for (const chain of chains) items.push({ kind: 'chain', chain })
    for (const entry of allEntries) {
      if (!chainedIds.has(entry.sourceObjectId)) {
        const isChainRoot = chains.some(c => c.root.sourceObjectId === entry.sourceObjectId)
        if (!isChainRoot) {
          items.push({ kind: 'standalone', entry })
        }
      }
    }

    items.sort((a, b) => {
      const ta = a.kind === 'chain'
        ? Math.max(
            new Date(a.chain.root.occurredAt).getTime(),
            ...a.chain.children.map(e => new Date(e.occurredAt).getTime()),
          )
        : new Date(a.entry.occurredAt).getTime()
      const tb = b.kind === 'chain'
        ? Math.max(
            new Date(b.chain.root.occurredAt).getTime(),
            ...b.chain.children.map(e => new Date(e.occurredAt).getTime()),
          )
        : new Date(b.entry.occurredAt).getTime()
      return tb - ta
    })

    return items
  }, [allEntries, parentOf, childrenOf, entryByObjectId])

  // ── Counts + filters ──────────────────────────────────────

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 }
    if (!allEntries) return c
    c.all = allEntries.length
    for (const e of allEntries) {
      const key = e.category + 's'
      c[key] = (c[key] || 0) + 1
    }
    return c
  }, [allEntries])

  const visibleFilters = useMemo(() => {
    return FILTERS.filter(f => {
      if (f.key === 'all') return true
      if (f.key === 'ideas' || f.key === 'research' || f.key === 'observations') return true
      return (counts[f.key] || 0) > 0
    })
  }, [counts])

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return displayItems
    const filter = FILTERS.find(f => f.key === activeFilter)
    if (!filter?.category) return displayItems
    return displayItems.filter(item => {
      if (item.kind === 'standalone') return item.entry.category === filter.category
      return item.chain.root.category === filter.category ||
        item.chain.children.some(e => e.category === filter.category)
    })
  }, [displayItems, activeFilter])

  const grouped = useMemo(() => {
    const map = new Map<TimeBucket, DisplayItem[]>()
    for (const item of filteredItems) {
      const ts = item.kind === 'chain'
        ? item.chain.root.occurredAt
        : item.entry.occurredAt
      const bucket = timeBucket(ts)
      if (!map.has(bucket)) map.set(bucket, [])
      map.get(bucket)!.push(item)
    }
    return BUCKET_ORDER.filter(b => map.has(b)).map(b => ({ bucket: b, items: map.get(b)! }))
  }, [filteredItems])

  // ── Chain expand/collapse ──────────────────────────────────

  const toggleChain = useCallback((rootId: string) => {
    setExpandedChains(prev => {
      const next = new Set(prev)
      if (next.has(rootId)) next.delete(rootId)
      else next.add(rootId)
      return next
    })
  }, [])

  // ── Launch native creator for "Next step" ──────────────────
  // Sets pending lineage in the store, then dispatches the native launcher.
  // The native creator's onSuccess will auto-link via pendingLineageStore.

  const launchNextStep = useCallback((key: NextStepKey, fromEntry: LogEntry) => {
    const parentType = SOURCE_TO_LINKABLE[fromEntry.sourceObjectType]
    usePendingLineageStore.getState().setPending({
      parentType,
      parentId: fromEntry.sourceObjectId,
      portfolioId,
    })

    const pName = portfolio?.name || 'Portfolio'

    switch (key) {
      case 'thought':
        window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
          detail: { contextType: 'portfolio', contextId: portfolioId, contextTitle: pName, captureType: 'idea' },
        }))
        break
      case 'prompt':
        window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
          detail: { contextType: 'portfolio', contextId: portfolioId, contextTitle: pName, captureType: 'prompt' },
        }))
        break
      case 'note':
        window.dispatchEvent(new CustomEvent('decision-engine-action', {
          detail: { id: `portfolio-notes-${portfolioId}`, title: `${pName} Notes`, type: 'note', data: { entityType: 'portfolio', entityId: portfolioId, portfolioId, portfolioName: pName, isNew: true } },
        }))
        break
      case 'trade_idea':
        window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
          detail: { contextType: 'portfolio', contextId: portfolioId, contextTitle: pName, captureType: 'trade_idea' },
        }))
        break
    }
  }, [portfolioId, portfolio?.name])

  // ── Loading ──────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col">
        <LogHeader count={0} />
        <div className="space-y-1 mt-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-16" />
              <div className="h-3.5 bg-gray-100 dark:bg-gray-700 rounded flex-1 max-w-xs" />
              <div className="h-3 bg-gray-50 dark:bg-gray-800 rounded w-12 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Empty ────────────────────────────────────────────────

  if (!allEntries || allEntries.length === 0) {
    return (
      <div className="flex flex-col">
        <LogHeader count={0} />
        <div className="border border-dashed border-gray-200 dark:border-gray-700 rounded-lg py-14 px-6 mt-4">
          <div className="max-w-sm mx-auto text-center">
            <BookOpen className="w-7 h-7 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Investment ideas, research, and observations will appear here
              as your team works across the platform.
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2.5">
              Executed trades and rationale live in the <span className="font-medium text-gray-500 dark:text-gray-400">Trade Journal</span>.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Main view ────────────────────────────────────────────

  return (
    <div className="flex flex-col">
      <LogHeader count={allEntries.length} />

      {/* Filters */}
      <div className="inline-flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg mt-3 mb-4 self-start">
        {visibleFilters.map(f => {
          const isActive = activeFilter === f.key
          const count = counts[f.key] ?? 0
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={clsx(
                'text-[11px] px-2.5 py-1 rounded-md font-medium transition-all duration-100 flex items-center gap-1.5',
                isActive
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              )}
            >
              {f.label}
              {count > 0 && (
                <span className={clsx(
                  'text-[10px] font-semibold tabular-nums px-1.5 py-px rounded-full',
                  isActive
                    ? 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                    : 'bg-gray-200/60 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
                )}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Grouped display items */}
      {grouped.length > 0 ? (
        <div className="flex flex-col gap-5">
          {grouped.map(({ bucket, items }) => (
            <div key={bucket}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 shrink-0">
                  {bucket}
                </span>
                <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
              </div>

              <div className="flex flex-col gap-2">
                {items.map(item => {
                  if (item.kind === 'standalone') {
                    return (
                      <StandaloneRow
                        key={item.entry.id}
                        entry={item.entry}
                        onNextStep={(key, entry) => launchNextStep(key, entry)}
                        onNavigate={navigateToObject}
                      />
                    )
                  }
                  return (
                    <ChainGroup
                      key={item.chain.root.id}
                      chain={item.chain}
                      isExpanded={expandedChains.has(item.chain.root.sourceObjectId)}
                      onToggle={() => toggleChain(item.chain.root.sourceObjectId)}
                      onNextStep={(key, entry) => launchNextStep(key, entry)}
                      onNavigate={navigateToObject}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-10 text-center">
          <p className="text-[13px] text-gray-400 dark:text-gray-500">No entries match this filter.</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function LogHeader({ count }: { count: number }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <h3 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">Portfolio Log</h3>
      {count > 0 && (
        <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">{count}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Standalone entry row
// ---------------------------------------------------------------------------

function StandaloneRow({ entry, onNextStep, onNavigate }: {
  entry: LogEntry
  onNextStep: (key: NextStepKey, entry: LogEntry) => void
  onNavigate: (entry: LogEntry) => void
}) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="group">
      <EntryRow
        entry={entry}
        onNavigate={onNavigate}
        trailing={
          <NextStepMenu
            isOpen={showMenu}
            onToggle={() => setShowMenu(v => !v)}
            onSelect={(key) => { onNextStep(key, entry); setShowMenu(false) }}
            onClose={() => setShowMenu(false)}
          />
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chain group — decision lineage chain
// ---------------------------------------------------------------------------

function ChainGroup({ chain, isExpanded, onToggle, onNextStep, onNavigate }: {
  chain: ResolvedChain
  isExpanded: boolean
  onToggle: () => void
  onNextStep: (key: NextStepKey, entry: LogEntry) => void
  onNavigate: (entry: LogEntry) => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const { root, children } = chain

  // Summary rule: show the most recently created descendant.
  // Children are sorted oldest→newest, so the last entry is the latest.
  // For branching chains this is the latest descendant across all branches.
  const latest = children.length > 0 ? children[children.length - 1] : null
  const latestCat = latest ? CATEGORY[latest.category] : null

  // Cap dots at 8 to prevent overflow on long chains
  const MAX_DOTS = 8
  const dotEntries = children.length > MAX_DOTS ? children.slice(-MAX_DOTS) : children
  const hiddenCount = children.length - dotEntries.length

  return (
    <div className="relative">
      {/* Root entry — always visible */}
      <EntryRow
        entry={root}
        onNavigate={onNavigate}
        trailing={
          <NextStepMenu
            isOpen={showMenu}
            onToggle={() => setShowMenu(v => !v)}
            onSelect={(key) => { onNextStep(key, root); setShowMenu(false) }}
            onClose={() => setShowMenu(false)}
          />
        }
      />

      {/* Chain summary — collapsed or expanded */}
      {children.length > 0 && (
        <div className="relative ml-5 border-l-2 border-gray-200 dark:border-gray-700">
          {/* Collapsed/expanded toggle bar */}
          <button
            onClick={onToggle}
            className={clsx(
              'w-full flex items-center gap-2 pl-4 pr-3.5 py-1.5 text-left',
              'hover:bg-gray-50/80 dark:hover:bg-gray-800/60 transition-colors rounded-b',
            )}
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
            )}

            {/* Category dots (capped to prevent overflow) */}
            <div className="flex items-center gap-0.5">
              {hiddenCount > 0 && (
                <span className="text-[9px] text-gray-400 dark:text-gray-500 mr-0.5">&hellip;</span>
              )}
              {dotEntries.map((e, i) => {
                const c = CATEGORY[e.category]
                return <div key={i} className={clsx('w-1.5 h-1.5 rounded-full', c?.dot || 'bg-gray-300')} />
              })}
            </div>

            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {children.length} {children.length === 1 ? 'step' : 'steps'}
            </span>

            {/* Latest step preview */}
            {latestCat && latest && (
              <>
                <span className="text-[10px] text-gray-300 dark:text-gray-600">&mdash;</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">latest:</span>
                <span className={clsx('text-[10px] font-medium', latestCat.labelColor)}>
                  {latestCat.label}
                </span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                  {latest.title}
                </span>
              </>
            )}

            <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto tabular-nums shrink-0">
              {latest ? formatTimestamp(latest.occurredAt) : ''}
            </span>
          </button>

          {/* Expanded children */}
          {isExpanded && (
            <div className="flex flex-col">
              {children.map((entry) => (
                <ChildRow
                  key={entry.id}
                  entry={entry}
                  onNextStep={onNextStep}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Child row — expanded chain child with compact "Next step" affordance
// ---------------------------------------------------------------------------

function ChildRow({ entry, onNextStep, onNavigate }: {
  entry: LogEntry
  onNextStep: (key: NextStepKey, entry: LogEntry) => void
  onNavigate: (entry: LogEntry) => void
}) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="relative group">
      {/* Horizontal connector from chain line */}
      <div className="absolute left-0 top-4 w-3 h-px bg-gray-200 dark:bg-gray-700" />
      <div className="ml-4">
        <EntryRow
          entry={entry}
          onNavigate={onNavigate}
          compact
          trailing={
            <NextStepMenu
              compact
              isOpen={showMenu}
              onToggle={() => setShowMenu(v => !v)}
              onSelect={(key) => { onNextStep(key, entry); setShowMenu(false) }}
              onClose={() => setShowMenu(false)}
            />
          }
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entry row — clickable display unit for any platform object
// ---------------------------------------------------------------------------

function EntryRow({ entry, onNavigate, trailing, compact }: {
  entry: LogEntry
  onNavigate?: (entry: LogEntry) => void
  trailing?: React.ReactNode
  compact?: boolean
}) {
  const cat = CATEGORY[entry.category] || CATEGORY.observation
  const Icon = RESEARCH_ICON[entry.subLabel || ''] || cat.icon
  const ts = formatTimestamp(entry.occurredAt)
  const showBody = !compact && entry.category !== 'observation' && entry.category !== 'question' && entry.body

  return (
    <div
      className={clsx(
        'group/row flex items-start gap-3 border-l-[3px] bg-white dark:bg-gray-900/30',
        compact ? 'px-3 py-2' : 'px-3.5 py-2.5',
        onNavigate && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/80',
        !onNavigate && 'hover:bg-gray-50/50 dark:hover:bg-gray-800/40',
        cat.border,
        'transition-colors',
      )}
      onClick={onNavigate ? () => onNavigate(entry) : undefined}
      role={onNavigate ? 'button' : undefined}
    >
      <div className={clsx('shrink-0', compact ? 'pt-px' : 'pt-0.5')}>
        <Icon className={clsx(compact ? 'w-3 h-3' : 'w-3.5 h-3.5', cat.labelColor)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={clsx(
            'font-bold uppercase tracking-wider px-1.5 py-px rounded shrink-0',
            compact ? 'text-[8px]' : 'text-[9px]',
            cat.labelBg, cat.labelColor,
          )}>
            {cat.label}
          </span>
          {entry.subLabel && (
            <span className={clsx('text-gray-400 dark:text-gray-500 shrink-0', compact ? 'text-[9px]' : 'text-[10px]')}>
              {entry.subLabel}
            </span>
          )}
          <span className={clsx(
            'font-medium text-gray-900 dark:text-gray-100 truncate',
            compact ? 'text-[12px]' : 'text-[13px]',
            onNavigate && 'group-hover/row:text-primary-600 dark:group-hover/row:text-primary-400',
          )}>
            {entry.title}
          </span>
          {/* Navigation hint */}
          {onNavigate && (
            <ArrowRight className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity" />
          )}
        </div>

        {showBody && (
          <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5 line-clamp-1">
            {entry.body}
          </p>
        )}

        {!compact && (
          <div className="flex items-center gap-2 mt-1">
            {entry.assetSymbols.length > 0 && (
              <div className="flex items-center gap-1">
                {entry.assetSymbols.map(sym => (
                  <span key={sym} className="inline-flex items-center px-1.5 py-px rounded bg-gray-100 dark:bg-gray-700 text-[10px] font-bold text-gray-600 dark:text-gray-300 tracking-wide">
                    {sym}
                  </span>
                ))}
              </div>
            )}
            {entry.sentiment && (
              <span className={clsx(
                'text-[9px] font-semibold uppercase tracking-wide px-1.5 py-px rounded',
                entry.sentiment === 'bullish' && 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
                entry.sentiment === 'bearish' && 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
                entry.sentiment === 'curious' && 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
                entry.sentiment === 'concerned' && 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
                !['bullish', 'bearish', 'curious', 'concerned'].includes(entry.sentiment) && 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
              )}>
                {entry.sentiment}
              </span>
            )}
            {entry.actorName && (
              <span className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 ml-auto shrink-0">
                <User className="w-2.5 h-2.5" />
                {entry.actorName}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 pt-0.5" onClick={e => e.stopPropagation()}>
        {trailing}
        <span className={clsx('text-gray-400 dark:text-gray-500 tabular-nums', compact ? 'text-[9px]' : 'text-[10px]')}>
          {ts}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Next step menu — dropdown for creating the next step in reasoning.
// Used on standalone rows, chain roots, and expanded chain children.
// `compact` renders a smaller trigger suitable for nested child rows.
// ---------------------------------------------------------------------------

function NextStepMenu({ isOpen, onToggle, onSelect, onClose, compact }: {
  isOpen: boolean
  onToggle: () => void
  onSelect: (key: NextStepKey) => void
  onClose: () => void
  compact?: boolean
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={clsx(
          'flex items-center gap-1 font-medium rounded transition-all',
          compact ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5',
          isOpen
            ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 opacity-0 group-hover/row:opacity-100 group-hover:opacity-100',
        )}
      >
        <Plus className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
        Next step
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />

          <div className={clsx(
            'absolute right-0 top-full mt-1 z-50',
            'w-44 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700',
            'py-1 animate-in fade-in slide-in-from-top-1 duration-100',
          )}>
            {NEXT_STEP_ACTIONS.map(fa => {
              const cat = CATEGORY[
                fa.key === 'thought' ? 'observation'
                  : fa.key === 'prompt' ? 'question'
                  : fa.key === 'note' ? 'research'
                  : 'idea'
              ]
              return (
                <button
                  key={fa.key}
                  onClick={() => onSelect(fa.key)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
                >
                  <div className={clsx('w-5 h-5 rounded flex items-center justify-center', cat.labelBg)}>
                    <fa.icon className={clsx('w-3 h-3', cat.labelColor)} />
                  </div>
                  <span className="text-[12px] font-medium text-gray-900 dark:text-gray-100">{fa.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
