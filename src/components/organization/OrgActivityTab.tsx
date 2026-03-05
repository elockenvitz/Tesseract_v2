/**
 * OrgActivityTab — Narrative activity log with human-readable rows,
 * structured diff/context/audit expanded views, person filter mode toggle,
 * quick filter pills, infinite scroll, and CSV export.
 */

import React, { useState, useCallback, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { csvSanitizeCell } from '../../lib/csv-sanitize'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Filter,
  Clock,
  UserCircle,
  Download,
  Users,
  Building2,
  Briefcase,
  ShieldCheck,
  Settings,
  GitBranch,
  ArrowRight,
  UserCog,
  Crown,
  Shield,
  UserX,
  UserCheck,
  ClipboardCheck,
  Send,
  XCircle,
  FolderPlus,
  FolderMinus,
  Pencil,
  ArrowRightLeft,
  ShieldOff,
  ShieldBan,
  UserPlus,
  UserMinus,
  Archive,
  ArchiveRestore,
  Ban,
  Trash2,
  Palette,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../ui/Button'
import { format } from 'date-fns'
import { ACTION_FORMAT } from '../../lib/org-activity-labels'
import { formatActivityRow, formatActivityDetails } from '../../lib/activity/activityFormatters'
import type {
  OrgActivityEvent,
  OrgActivityEntityType,
  OrgActivitySourceType,
  ActivityTone,
  PersonFilterMode,
  FormattedActivityDetails,
} from '../../types/organization'

const PAGE_SIZE = 30

// ─── Tone → style maps ──────────────────────────────────────────────

const TONE_BORDER: Record<ActivityTone, string> = {
  neutral: 'border-l-gray-300',
  success: 'border-l-emerald-400',
  warning: 'border-l-amber-400',
  danger: 'border-l-red-400',
}

const TONE_ICON_BG: Record<ActivityTone, string> = {
  neutral: 'bg-gray-100',
  success: 'bg-emerald-50',
  warning: 'bg-amber-50',
  danger: 'bg-red-50',
}

const TONE_ICON_TEXT: Record<ActivityTone, string> = {
  neutral: 'text-gray-500',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
}

// ─── Icon name → component map ──────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Activity,
  UserCog,
  Crown,
  Shield,
  UserX,
  UserCheck,
  Clock,
  ClipboardCheck,
  Send,
  XCircle,
  FolderPlus,
  FolderMinus,
  Pencil,
  ArrowRightLeft,
  ShieldCheck,
  ShieldOff,
  ShieldBan,
  UserPlus,
  UserMinus,
  Briefcase,
  Archive,
  ArchiveRestore,
  Ban,
  Trash2,
  Settings,
  Palette,
  Users,
}

// ─── Quick filter groups ─────────────────────────────────────────────

interface QuickFilter {
  label: string
  icon: React.ReactNode
  entityTypes?: OrgActivityEntityType[]
}

const QUICK_FILTERS: QuickFilter[] = [
  {
    label: 'People',
    icon: <Users className="w-3 h-3" />,
    entityTypes: ['org_member'],
  },
  {
    label: 'Structure',
    icon: <Building2 className="w-3 h-3" />,
    entityTypes: ['team_node', 'team_membership'],
  },
  {
    label: 'Portfolios',
    icon: <Briefcase className="w-3 h-3" />,
    entityTypes: ['portfolio', 'portfolio_membership'],
  },
  {
    label: 'Access',
    icon: <ShieldCheck className="w-3 h-3" />,
    entityTypes: ['access_request', 'invite'],
  },
  {
    label: 'Settings',
    icon: <Settings className="w-3 h-3" />,
    entityTypes: ['settings'],
  },
]

const ENTITY_TYPE_OPTIONS: { value: OrgActivityEntityType; label: string }[] = [
  { value: 'org', label: 'Organization' },
  { value: 'org_member', label: 'Members' },
  { value: 'team_node', label: 'Team Nodes' },
  { value: 'team_membership', label: 'Team Membership' },
  { value: 'portfolio', label: 'Portfolios' },
  { value: 'portfolio_membership', label: 'Portfolio Membership' },
  { value: 'access_request', label: 'Access Requests' },
  { value: 'invite', label: 'Invites' },
  { value: 'settings', label: 'Settings' },
]

const SOURCE_TYPE_OPTIONS: { value: OrgActivitySourceType; label: string }[] = [
  { value: 'direct', label: 'Direct' },
  { value: 'via_team', label: 'Via Team' },
  { value: 'system', label: 'System' },
]

// ─── Component ───────────────────────────────────────────────────────

interface OrgActivityTabProps {
  organizationId: string
  isOrgAdmin: boolean
  userNameMap: Map<string, string>
}

export function OrgActivityTab({
  organizationId,
  isOrgAdmin,
  userNameMap,
}: OrgActivityTabProps) {
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(null)
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('')
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('')
  const [personFilter, setPersonFilter] = useState<string>('')
  const [personFilterMode, setPersonFilterMode] = useState<PersonFilterMode>('target')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Resolved entity type filters from quick filter
  const effectiveEntityTypes = useMemo(() => {
    if (activeQuickFilter) {
      const qf = QUICK_FILTERS.find((q) => q.label === activeQuickFilter)
      return qf?.entityTypes || []
    }
    return entityTypeFilter ? [entityTypeFilter] : []
  }, [activeQuickFilter, entityTypeFilter])

  // Person options sorted by name
  const personOptions = useMemo(() => {
    const entries: { id: string; name: string }[] = []
    userNameMap.forEach((name, id) => entries.push({ id, name }))
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }, [userNameMap])

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: [
      'organization-audit-log', organizationId,
      activeQuickFilter, entityTypeFilter, sourceTypeFilter,
      personFilter, personFilterMode, dateFrom, dateTo,
    ],
    queryFn: async ({ pageParam = 0 }) => {
      let query = supabase
        .from('organization_audit_log')
        .select('*', { count: 'exact' })
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1)

      // Entity type filter
      if (effectiveEntityTypes.length === 1) {
        query = query.eq('entity_type', effectiveEntityTypes[0])
      } else if (effectiveEntityTypes.length > 1) {
        query = query.in('entity_type', effectiveEntityTypes)
      }

      // Source type filter
      if (sourceTypeFilter) {
        query = query.eq('source_type', sourceTypeFilter)
      }

      // Person filter with mode
      if (personFilter) {
        if (personFilterMode === 'initiator') {
          query = query.eq('initiator_user_id', personFilter)
        } else {
          query = query.or(`target_user_id.eq.${personFilter},actor_id.eq.${personFilter}`)
        }
      }

      if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`)
      if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`)

      const { data: rows, error, count } = await query
      if (error) throw error
      return {
        rows: (rows || []) as OrgActivityEvent[],
        totalCount: count ?? 0,
        nextOffset: pageParam + PAGE_SIZE,
      }
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.nextOffset >= lastPage.totalCount) return undefined
      return lastPage.nextOffset
    },
    initialPageParam: 0,
    enabled: isOrgAdmin,
  })

  const allEntries = data?.pages.flatMap((p) => p.rows) ?? []
  const totalCount = data?.pages[0]?.totalCount ?? 0

  const getUserName = useCallback(
    (userId: string | null) => {
      if (!userId) return 'System'
      return userNameMap.get(userId) || userId.slice(0, 8) + '...'
    },
    [userNameMap]
  )

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Relative time formatting
  const formatTime = (ts: string) => {
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHrs = Math.floor(diffMins / 60)
    if (diffHrs < 24) return `${diffHrs}h ago`
    const diffDays = Math.floor(diffHrs / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  }

  // CSV export with initiator column (unchanged)
  const handleExport = useCallback(() => {
    if (!allEntries.length) return
    const headers = [
      'Timestamp', 'Initiator', 'Actor', 'Action', 'Entity Type', 'Action Type',
      'Target User', 'Source Type', 'Source ID', 'Details', 'Metadata',
    ]
    const csv = [
      headers.join(','),
      ...allEntries.map((e) =>
        [
          e.created_at,
          getUserName(e.initiator_user_id ?? e.actor_id),
          getUserName(e.actor_id),
          (ACTION_FORMAT[e.action]?.title) || e.action,
          e.entity_type || '',
          e.action_type || '',
          e.target_user_id ? getUserName(e.target_user_id) : '',
          e.source_type || '',
          e.source_id || '',
          JSON.stringify(e.details || {}),
          JSON.stringify(e.metadata || {}),
        ]
          .map(csvSanitizeCell)
          .join(',')
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [allEntries, getUserName])

  // Active filters count for clear button
  const activeFilterCount = [
    activeQuickFilter, entityTypeFilter, sourceTypeFilter,
    personFilter, dateFrom, dateTo,
  ].filter(Boolean).length

  const clearFilters = () => {
    setActiveQuickFilter(null)
    setEntityTypeFilter('')
    setSourceTypeFilter('')
    setPersonFilter('')
    setDateFrom('')
    setDateTo('')
  }

  if (!isOrgAdmin) return null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-700 flex items-center">
            <Activity className="w-4 h-4 mr-1.5 text-indigo-500" />
            Activity Log
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
              {totalCount}
            </span>
          </h3>

          {/* Quick filter pills */}
          <div className="flex items-center gap-1 ml-2">
            {QUICK_FILTERS.map((qf) => (
              <button
                key={qf.label}
                onClick={() => {
                  if (activeQuickFilter === qf.label) {
                    setActiveQuickFilter(null)
                  } else {
                    setActiveQuickFilter(qf.label)
                    setEntityTypeFilter('')
                  }
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                  activeQuickFilter === qf.label
                    ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {qf.icon}
                {qf.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Person filter + mode toggle */}
          <div className="flex items-center gap-0.5">
            <div className="relative">
              <select
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
                className="text-xs border border-gray-300 rounded-lg pl-7 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="">All people</option>
                {personOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <UserCircle className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
            {personFilter && (
              <div className="flex rounded-md border border-gray-300 overflow-hidden ml-1">
                <button
                  onClick={() => setPersonFilterMode('target')}
                  className={`px-1.5 py-1 text-[10px] font-medium transition-colors ${
                    personFilterMode === 'target'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  Target
                </button>
                <button
                  onClick={() => setPersonFilterMode('initiator')}
                  className={`px-1.5 py-1 text-[10px] font-medium border-l border-gray-300 transition-colors ${
                    personFilterMode === 'initiator'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  Initiator
                </button>
              </div>
            )}
          </div>

          {/* Entity type filter */}
          <div className="relative">
            <select
              value={activeQuickFilter ? '' : entityTypeFilter}
              onChange={(e) => { setEntityTypeFilter(e.target.value); setActiveQuickFilter(null) }}
              className="text-xs border border-gray-300 rounded-lg pl-7 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All objects</option>
              {ENTITY_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>

          {/* Source type filter */}
          <div className="relative">
            <select
              value={sourceTypeFilter}
              onChange={(e) => setSourceTypeFilter(e.target.value)}
              className="text-xs border border-gray-300 rounded-lg pl-7 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">How it happened</option>
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <GitBranch className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>

          {/* Date range */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            title="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            title="To date"
          />

          {activeFilterCount > 1 && (
            <button
              onClick={clearFilters}
              className="text-[11px] text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              Clear
            </button>
          )}

          {/* CSV export */}
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!allEntries.length}>
            <Download className="w-3.5 h-3.5 mr-1" />
            CSV
          </Button>
        </div>
      </div>

      {/* Entries */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading activity...</p>
        </div>
      ) : allEntries.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Activity className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No activity recorded yet</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {allEntries.map((entry) => {
            const row = formatActivityRow(entry, userNameMap)
            const isExpanded = expandedIds.has(entry.id)
            const avatarUserId = entry.actor_id || entry.initiator_user_id || null
            const IconComponent = ICON_MAP[row.iconKey] || Activity

            return (
              <div key={entry.id}>
                {/* Main row — narrative */}
                <div
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/50 transition-colors border-l-[3px] ${TONE_BORDER[row.tone]}`}
                  onClick={() => toggleExpanded(entry.id)}
                >
                  {/* Icon circle */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${TONE_ICON_BG[row.tone]}`}>
                    {avatarUserId ? (
                      <span className={`text-[10px] font-semibold ${TONE_ICON_TEXT[row.tone]}`}>
                        {getUserName(avatarUserId).charAt(0).toUpperCase()}
                      </span>
                    ) : (
                      <IconComponent className={`w-3.5 h-3.5 ${TONE_ICON_TEXT[row.tone]}`} />
                    )}
                  </div>

                  {/* Title + subtitle */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {row.title}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                      {row.subtitle}
                    </p>
                  </div>

                  {/* Right side: chips + time + chevron */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {row.chips?.map((chip) => (
                      <span
                        key={chip}
                        className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded whitespace-nowrap"
                      >
                        {chip}
                      </span>
                    ))}
                    <span
                      className="text-xs text-gray-400 whitespace-nowrap"
                      title={new Date(entry.created_at).toLocaleString()}
                    >
                      {formatTime(entry.created_at)}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <ExpandedActivityDetails
                    entry={entry}
                    details={formatActivityDetails(entry, userNameMap)}
                  />
                )}
              </div>
            )
          })}

          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full px-4 py-2.5 text-sm text-primary-600 hover:bg-primary-50 transition-colors font-medium"
            >
              {isFetchingNextPage
                ? 'Loading...'
                : `Show more (${totalCount - allEntries.length} remaining)`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Expanded details sub-component ─────────────────────────────────

function ExpandedActivityDetails({
  entry: _entry,
  details,
}: {
  entry: OrgActivityEvent
  details: FormattedActivityDetails
}) {
  const [showAudit, setShowAudit] = useState(false)

  return (
    <div className="px-4 pb-3 pl-14">
      <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-3">
        {/* 1. Change (diff) block */}
        {details.diff && details.diff.length > 0 && (
          <div>
            <span className="text-gray-500 font-medium text-[11px] uppercase tracking-wide">Change</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {details.diff.map((d) => (
                <div
                  key={d.label}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded border border-gray-200"
                >
                  <span className="text-[11px] text-gray-500 font-medium">{d.label}:</span>
                  <span className="text-[11px] text-gray-400 line-through">{d.left}</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <span className="text-[11px] text-gray-900 font-semibold">{d.right}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. Context block */}
        {details.context && details.context.length > 0 && (
          <div>
            <span className="text-gray-500 font-medium text-[11px] uppercase tracking-wide">Context</span>
            <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1.5">
              {details.context.map((c) => (
                <Detail key={c.label} label={c.label} value={c.value} />
              ))}
            </div>
          </div>
        )}

        {/* 3. Audit payload — collapsed by default */}
        <div>
          <button
            onClick={() => setShowAudit((v) => !v)}
            className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium transition-colors flex items-center gap-1"
          >
            {showAudit ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            {showAudit ? 'Hide audit payload' : 'View audit payload'}
          </button>

          {showAudit && (
            <div className="mt-2 grid grid-cols-1 gap-y-1.5 bg-white rounded border border-gray-200 p-2.5">
              {details.audit.map((a) => {
                const isJson = a.label.includes('JSON')
                return (
                  <div key={a.label}>
                    <span className="text-gray-500 text-[11px]">{a.label}:</span>{' '}
                    {isJson ? (
                      <pre className="mt-0.5 text-[10px] text-gray-700 font-mono bg-gray-50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
                        {a.value}
                      </pre>
                    ) : (
                      <span className="text-gray-700 font-medium text-[11px] font-mono">{a.value}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Detail row helper ───────────────────────────────────────────────

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-gray-500">{label}:</span>{' '}
      <span className="text-gray-700 font-medium">{value}</span>
    </div>
  )
}
