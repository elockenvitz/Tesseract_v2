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
import { FilterSelect } from './FilterSelect'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { DatePicker } from '../ui/DatePicker'
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
  neutral: 'bg-gray-100 dark:bg-gray-800',
  success: 'bg-emerald-50',
  warning: 'bg-amber-50',
  danger: 'bg-red-50',
}

const TONE_ICON_TEXT: Record<ActivityTone, string> = {
  neutral: 'text-gray-500 dark:text-gray-400',
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

  const isMobile = useIsMobile()

  /** The category rail, so a restored filter can be scrolled into view. */
  const railRef = React.useRef<HTMLDivElement>(null)

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
        {/* Title and the category rail stack on a phone, so the rail gets the
            full width to scroll in rather than starting halfway across. */}
        <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-gray-700 flex items-center dark:text-gray-300">
              <Activity className="w-4 h-4 mr-1.5 text-indigo-500" />
              Activity Log
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded dark:text-gray-400 dark:bg-gray-800">
                {totalCount}
              </span>
            </h3>
            {/* Export sits in the top-right on a phone, out of the filter
                stack entirely — it is an action on the log, not a filter of
                it. Rendered here or in the filter row, never both. */}
            {/* Not the shared Button here: its `sm` size is still `px-3 py-1.5
                text-sm`, and the coarse-pointer rule in index.css floors every
                button at 44px, so beside a 20px heading it read as the loudest
                thing on the screen. This is the same outline treatment at the
                scale of the filter controls; `tap-pad` keeps the touch target
                without the height. */}
            {isMobile && (
              <button
                type="button"
                onClick={handleExport}
                disabled={!allEntries.length}
                className="no-touch-target tap-pad inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                <Download className="h-3 w-3" />
                CSV
              </button>
            )}
          </div>

          {/* Quick filter pills — a swipeable rail on a phone, where four
              pills plus the title clipped at both edges.

              `scroll-px-3` matches the inset so a pill scrolled to either end
              stops clear of the edge instead of half under it, and the active
              pill is scrolled into view on selection — picking a category off
              the right edge otherwise left it invisible. */}
          {/* The category pills group the same `entity_type` the Object
              dropdown filters directly, so on a phone they were a second
              control for one field — and the pair could disagree on screen.
              Desktop keeps them: there is room there for the shortcut. */}
          {!isMobile && (
          <div
            ref={railRef}
            data-slot="activity-category-rail"
            className="flex items-center gap-1 -mx-3 px-3 scroll-px-3 overflow-x-auto no-scrollbar sm:mx-0 sm:px-0 sm:ml-2 sm:overflow-visible"
          >
            {QUICK_FILTERS.map((qf) => (
              <button
                key={qf.label}
                data-active={activeQuickFilter === qf.label ? 'true' : undefined}
                onClick={(e) => {
                  if (activeQuickFilter === qf.label) {
                    setActiveQuickFilter(null)
                  } else {
                    setActiveQuickFilter(qf.label)
                    setEntityTypeFilter('')
                    e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
                  }
                }}
                className={`no-touch-target tap-pad shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                  activeQuickFilter === qf.label
                    ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700 dark:hover:text-gray-200 dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800'
                }`}
              >
                {qf.icon}
                {qf.label}
              </button>
            ))}
          </div>
          )}
        </div>

        {/* Filters. Full width each on a phone rather than a stack of
            half-width fragments floating in whitespace. */}
        <div className="flex w-full items-center gap-2 flex-wrap sm:w-auto">
          {/* Person filter + mode toggle */}
          <div className="flex w-full items-center gap-0.5 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <FilterSelect
                value={personFilter}
                onChange={setPersonFilter}
                ariaLabel="Filter activity by person"
                sheetTitle="Filter by person"
                options={[{ value: '', label: 'All people' }, ...personOptions.map(a => ({ value: a.id, label: a.name }))]}
                className="w-full text-xs border border-gray-300 rounded-lg pl-7 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:border-gray-600 dark:bg-gray-800"
                buttonClassName="w-full"
              />
              <UserCircle className="hidden sm:block absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <ChevronDown className="hidden sm:block absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
            {personFilter && (
              <div className="flex rounded-md border border-gray-300 overflow-hidden ml-1 dark:border-gray-600">
                <button
                  onClick={() => setPersonFilterMode('target')}
                  className={`px-1.5 py-1 text-[10px] font-medium transition-colors ${
                    personFilterMode === 'target'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-white text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-400 dark:bg-gray-800'
                  }`}
                >
                  Target
                </button>
                <button
                  onClick={() => setPersonFilterMode('initiator')}
                  className={`px-1.5 py-1 text-[10px] font-medium border-l border-gray-300 transition-colors ${
                    personFilterMode === 'initiator'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-white text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-400 dark:bg-gray-800'
                  }`}
                >
                  Initiator
                </button>
              </div>
            )}
          </div>

          {/* Object and How-it-happened share one line on a phone. Both hold
              short values, and stacking them full-width pushed the events
              another row down for no gain in legibility. */}
          <div className="flex w-full items-center gap-2 sm:contents">
            {/* Entity type filter */}
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <FilterSelect
                value={activeQuickFilter ? '' : entityTypeFilter}
                onChange={(v) => { setEntityTypeFilter(v); setActiveQuickFilter(null) }}
                ariaLabel="Filter activity by object"
                sheetTitle="Filter by object"
                options={[{ value: '', label: 'All objects' }, ...ENTITY_TYPE_OPTIONS]}
                className="text-xs border border-gray-300 rounded-lg pl-7 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:border-gray-600 dark:bg-gray-800"
                buttonClassName="w-full justify-between"
              />
              {/* The decorations belong to the native select's padding; the
                  phone button draws its own chevron. */}
              <Filter className="hidden sm:block absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <ChevronDown className="hidden sm:block absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Source type filter */}
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <FilterSelect
                value={sourceTypeFilter}
                onChange={setSourceTypeFilter}
                ariaLabel="Filter activity by how it happened"
                sheetTitle="How it happened"
                options={[{ value: '', label: 'How it happened' }, ...SOURCE_TYPE_OPTIONS]}
                className="text-xs border border-gray-300 rounded-lg pl-7 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:border-gray-600 dark:bg-gray-800"
                buttonClassName="w-full justify-between"
              />
              <GitBranch className="hidden sm:block absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <ChevronDown className="hidden sm:block absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Date range.

              Was a pair of raw `<input type="date">`, which a phone renders
              as its own native `mm/dd/yyyy` field — a different height, a
              different type scale and a placeholder in a different grey from
              every other control in this row. The repo already has a
              DatePicker, so this uses it in a `filter` variant that matches
              the selects. Same values, same `yyyy-MM-dd` strings, same
              queries; `allowPastDates` because activity is by definition
              historical and the picker otherwise disables it. */}
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="min-w-0 flex-1 sm:flex-none">
              <DatePicker
                value={dateFrom || null}
                onChange={(v) => setDateFrom(v || '')}
                placeholder="Start date"
                variant="filter"
                allowPastDates
                className="w-full"
              />
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <DatePicker
                value={dateTo || null}
                onChange={(v) => setDateTo(v || '')}
                placeholder="End date"
                variant="filter"
                allowPastDates
                className="w-full"
              />
            </div>
          </div>

          {/* On a phone only Clear lands here — export moved to the header,
              so this no longer costs a row above the events. */}
          <div className="flex items-center gap-2 max-sm:w-full">
            {activeFilterCount > 1 && (
              <button
                onClick={clearFilters}
                className="no-touch-target tap-pad text-[11px] text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                Clear filters
              </button>
            )}

            {/* CSV export */}
            {!isMobile && (
              <Button size="sm" variant="outline" onClick={handleExport} disabled={!allEntries.length}>
                <Download className="w-3.5 h-3.5 mr-1" />
                CSV
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Entries */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading activity...</p>
        </div>
      ) : allEntries.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg dark:bg-gray-900">
          <Activity className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No activity recorded yet</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 dark:border-gray-700 dark:divide-gray-800 dark:bg-gray-800">
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

                  {/* Title + subtitle.

                      The title is the event. Truncating it to one line turned
                      "Colin Knox was reactivated" into "Colin Knox was
                      reactiv…", which means opening the row to learn what the
                      row says. Two lines on a phone costs little and usually
                      removes the need to expand at all; the subtitle stays
                      secondary and still truncates. */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 line-clamp-2 sm:truncate dark:text-white">
                      {row.title}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate dark:text-gray-400">
                      {row.subtitle}
                    </p>
                  </div>

                  {/* Right side: chips + time + chevron */}
                  <div className="flex items-start gap-2 flex-shrink-0 sm:items-center">
                    {row.chips?.map((chip) => (
                      <span
                        key={chip}
                        className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded whitespace-nowrap dark:text-gray-400 dark:bg-gray-800"
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
                    summary={row.title}
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

/**
 * The expanded event, human-readable before technical.
 *
 * Activity explains an event; Audit exposes the record. Opening a row here
 * used to reach event IDs, entity IDs, canonical action names and two raw
 * JSON blobs within a couple of lines of the summary, which reads as a
 * developer console rather than a log an administrator can act on.
 *
 * So the order is now: what happened, then the change, then the context a
 * person can read — and the record itself only behind "Technical details",
 * still collapsed, still carrying exactly the same fields. Nothing is
 * removed, and no context is manufactured: the summary is the same formatted
 * title the collapsed row shows, and every field below comes from the event.
 *
 * There is no per-event Audit deep link to hand off to — the Audit explorer
 * opens at list level only and takes no event argument — so the disclosure
 * stays here rather than linking somewhere that cannot receive it.
 */
function ExpandedActivityDetails({
  entry,
  details,
  summary,
}: {
  entry: OrgActivityEvent
  details: FormattedActivityDetails
  summary: string
}) {
  const [showAudit, setShowAudit] = useState(false)

  return (
    /* Flatter than it was: sections separated by spacing and hairlines
       instead of a card holding a card holding a panel. The indent is
       smaller on a phone, where 56px of gutter is most of the text column. */
    <div className="px-4 pb-3 pl-4 sm:pl-14">
      <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-xs dark:bg-gray-900">
        {/* 1. What happened — the event in words, first. */}
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            What happened
          </span>
          <p className="mt-1 break-words text-sm text-gray-900 dark:text-white">{summary}</p>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            {format(new Date(entry.created_at), 'MMM d, yyyy · h:mm a')}
          </p>
        </div>

        {/* 2. Change (diff) block */}
        {details.diff && details.diff.length > 0 && (
          <div className="mt-2.5 border-t border-gray-200 pt-2.5 dark:border-gray-800">
            <span className="text-gray-500 font-medium text-[11px] uppercase tracking-wide dark:text-gray-400">Change</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {details.diff.map((d) => (
                <div
                  key={d.label}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded border border-gray-200 dark:border-gray-700 dark:bg-gray-800"
                >
                  <span className="text-[11px] text-gray-500 font-medium dark:text-gray-400">{d.label}:</span>
                  <span className="text-[11px] text-gray-400 line-through">{d.left}</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <span className="text-[11px] text-gray-900 font-semibold dark:text-white">{d.right}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Context block — one column on a phone, where two columns of
               label-and-value left neither enough room to sit on one line. */}
        {details.context && details.context.length > 0 && (
          <div className="mt-2.5 border-t border-gray-200 pt-2.5 dark:border-gray-800">
            <span className="text-gray-500 font-medium text-[11px] uppercase tracking-wide dark:text-gray-400">Context</span>
            <div className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {details.context.map((c) => (
                <Detail key={c.label} label={c.label} value={c.value} />
              ))}
            </div>
          </div>
        )}

        {/* 4. The audit record — collapsed, and named for what it is. */}
        <div className="mt-2.5 border-t border-gray-200 pt-2.5 dark:border-gray-800">
          <button
            onClick={() => setShowAudit((v) => !v)}
            aria-expanded={showAudit}
            data-slot="activity-technical-toggle"
            className="no-touch-target tap-pad text-[11px] text-gray-500 hover:text-gray-700 font-medium transition-colors flex items-center gap-1 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {showAudit ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Technical details
          </button>

          {showAudit && (
            <div
              data-slot="activity-technical-body"
              className="mt-2 grid grid-cols-1 gap-y-1.5 bg-white rounded border border-gray-200 p-2.5 dark:border-gray-700 dark:bg-gray-800"
            >
              {details.audit.map((a) => {
                const isJson = a.label.includes('JSON')
                return (
                  <div key={a.label} className="min-w-0">
                    <span className="text-gray-500 text-[11px] dark:text-gray-400">{a.label}:</span>{' '}
                    {isJson ? (
                      /* `break-all` alone still let a long unbroken token push
                         the page sideways; the scroller is the container's,
                         not the page's. */
                      <pre className="mt-0.5 max-w-full overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded bg-gray-50 p-1.5 font-mono text-[10px] text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                        {a.value}
                      </pre>
                    ) : (
                      /* Monospace only for the identifiers themselves. */
                      <span className="font-mono text-[11px] font-medium text-gray-700 [overflow-wrap:anywhere] dark:text-gray-300">{a.value}</span>
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
    <div className="min-w-0">
      <span className="text-gray-500 dark:text-gray-400">{label}:</span>{' '}
      <span className="text-gray-700 font-medium [overflow-wrap:anywhere] dark:text-gray-300">{value}</span>
    </div>
  )
}
