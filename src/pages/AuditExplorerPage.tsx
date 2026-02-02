/**
 * Activity History Page
 *
 * Provides institutional-grade audit trail visibility across all entities.
 * Displays chronological activity feed with filtering and search.
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Search,
  Filter,
  Calendar,
  User,
  RefreshCw,
  ChevronDown,
  Plus,
  Trash2,
  RotateCcw,
  ArrowRight,
  CheckCircle2,
  Edit2,
  Download,
  UserPlus,
  UserMinus,
  Users,
  Archive,
} from 'lucide-react'
import { formatDistanceToNow, format, subDays, startOfDay, endOfDay } from 'date-fns'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/common/EmptyState'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import type { AuditEvent, EntityType, ActionType } from '../lib/audit'

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  create: Plus,
  delete: Trash2,
  restore: RotateCcw,
  move_stage: ArrowRight,
  set_outcome: CheckCircle2,
  auto_archive: Archive,
  update_field: Edit2,
  update_fields: Edit2,
  coverage_assigned: UserPlus,
  coverage_removed: UserMinus,
  coverage_changed: Users,
  coverage_started: UserPlus,
  coverage_ended: UserMinus,
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  delete: 'bg-red-100 text-red-700',
  restore: 'bg-blue-100 text-blue-700',
  move_stage: 'bg-amber-100 text-amber-700',
  set_outcome: 'bg-purple-100 text-purple-700',
  auto_archive: 'bg-slate-100 text-slate-700',
  update_field: 'bg-gray-100 text-gray-700',
  update_fields: 'bg-gray-100 text-gray-700',
  coverage_assigned: 'bg-teal-100 text-teal-700',
  coverage_removed: 'bg-orange-100 text-orange-700',
  coverage_changed: 'bg-cyan-100 text-cyan-700',
  coverage_started: 'bg-teal-100 text-teal-700',
  coverage_ended: 'bg-orange-100 text-orange-700',
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  trade_idea: 'Trade Idea',
  pair_trade: 'Pair Trade',
  simulation: 'Simulation',
  portfolio: 'Portfolio',
  asset: 'Asset',
  coverage: 'Coverage',
}

const TIME_RANGES = [
  { id: 'today', label: 'Today', getDates: () => ({ start: startOfDay(new Date()), end: endOfDay(new Date()) }) },
  { id: '7d', label: 'Last 7 days', getDates: () => ({ start: startOfDay(subDays(new Date(), 7)), end: endOfDay(new Date()) }) },
  { id: '30d', label: 'Last 30 days', getDates: () => ({ start: startOfDay(subDays(new Date(), 30)), end: endOfDay(new Date()) }) },
  { id: '90d', label: 'Last 90 days', getDates: () => ({ start: startOfDay(subDays(new Date(), 90)), end: endOfDay(new Date()) }) },
  { id: 'all', label: 'All time', getDates: () => ({ start: null, end: null }) },
]

// Unified activity item type that can represent both audit events and coverage history
interface ActivityItem {
  id: string
  occurred_at: string
  actor_id?: string
  actor_name?: string
  actor_email?: string
  entity_type: string
  entity_id: string
  entity_display_name?: string
  action_type: string
  action_category: string
  from_state?: any
  to_state?: any
  changed_fields?: string[]
  metadata?: any
}

function formatEventSummary(event: ActivityItem): string {
  const entityName = event.entity_display_name || `${event.entity_type} ${event.entity_id?.slice(0, 8) || ''}`

  switch (event.action_type) {
    case 'create':
      return `Created ${entityName}`
    case 'delete':
      return `Deleted ${entityName}`
    case 'restore':
      return `Restored ${entityName}`
    case 'move_stage':
      const fromStatus = event.from_state?.status || 'unknown'
      const toStatus = event.to_state?.status || 'unknown'
      return `Moved ${entityName} from ${fromStatus} to ${toStatus}`
    case 'set_outcome':
      return `Set outcome for ${entityName}`
    case 'update_field':
    case 'update_fields':
      const fields = event.changed_fields?.join(', ') || 'fields'
      return `Updated ${fields} on ${entityName}`
    case 'coverage_assigned':
      return `${event.to_state?.analyst_name || 'Analyst'} assigned to cover ${entityName}`
    case 'coverage_removed':
      return `${event.from_state?.analyst_name || 'Analyst'} removed from ${entityName}`
    case 'coverage_changed':
      return `Coverage updated for ${entityName}`
    case 'coverage_started':
      return `${event.to_state?.analyst_name || 'Analyst'} started covering ${entityName}`
    case 'coverage_ended':
      return `${event.from_state?.analyst_name || 'Analyst'} ended coverage of ${entityName}`
    default:
      return `${event.action_type} on ${entityName}`
  }
}

export function AuditExplorerPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTimeRange, setSelectedTimeRange] = useState('7d')
  const [selectedEntityType, setSelectedEntityType] = useState<string>('all')
  const [selectedActionType, setSelectedActionType] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)

  const timeRange = TIME_RANGES.find(t => t.id === selectedTimeRange)
  const { start: startDate, end: endDate } = timeRange?.getDates() || { start: null, end: null }

  // Fetch activity (audit events + coverage history)
  const { data: events, isLoading, error, refetch } = useQuery({
    queryKey: ['activity-history', selectedTimeRange, selectedEntityType, selectedActionType, searchQuery],
    queryFn: async () => {
      const allEvents: ActivityItem[] = []

      // Fetch audit events (unless filtering only for coverage)
      if (selectedEntityType === 'all' || selectedEntityType !== 'coverage') {
        let auditQuery = supabase
          .from('audit_events')
          .select('*')
          .order('occurred_at', { ascending: false })
          .limit(200)

        if (startDate) {
          auditQuery = auditQuery.gte('occurred_at', startDate.toISOString())
        }
        if (endDate) {
          auditQuery = auditQuery.lte('occurred_at', endDate.toISOString())
        }
        if (selectedEntityType !== 'all' && selectedEntityType !== 'coverage') {
          auditQuery = auditQuery.eq('entity_type', selectedEntityType)
        }
        if (selectedActionType !== 'all' && !selectedActionType.startsWith('coverage_')) {
          auditQuery = auditQuery.eq('action_type', selectedActionType)
        }
        if (searchQuery) {
          auditQuery = auditQuery.or(`entity_display_name.ilike.%${searchQuery}%,search_text.ilike.%${searchQuery}%,actor_name.ilike.%${searchQuery}%`)
        }

        const { data: auditData, error: auditError } = await auditQuery
        if (auditError) console.error('Audit events error:', auditError)

        if (auditData) {
          allEvents.push(...auditData.map(e => ({
            ...e,
            action_category: e.action_category || 'lifecycle',
          })))
        }
      }

      // Fetch coverage history (unless filtering for non-coverage entity types)
      if (selectedEntityType === 'all' || selectedEntityType === 'coverage') {
        // Skip coverage if filtering by non-coverage action types
        const isCoverageAction = selectedActionType === 'all' || selectedActionType.startsWith('coverage_')

        if (isCoverageAction) {
          let coverageQuery = supabase
            .from('coverage_history')
            .select(`
              id,
              asset_id,
              change_type,
              old_user_id,
              old_analyst_name,
              old_start_date,
              old_end_date,
              old_is_active,
              new_user_id,
              new_analyst_name,
              new_start_date,
              new_end_date,
              new_is_active,
              changed_by,
              changed_at,
              change_reason,
              assets:asset_id(symbol, name)
            `)
            .order('changed_at', { ascending: false })
            .limit(200)

          if (startDate) {
            coverageQuery = coverageQuery.gte('changed_at', startDate.toISOString())
          }
          if (endDate) {
            coverageQuery = coverageQuery.lte('changed_at', endDate.toISOString())
          }

          const { data: coverageData, error: coverageError } = await coverageQuery
          if (coverageError) console.error('Coverage history error:', coverageError)

          if (coverageData) {
            // Get user names for changed_by
            const userIds = [...new Set(coverageData.map(c => c.changed_by).filter(Boolean))]
            let userMap: Record<string, { full_name: string; email: string }> = {}

            if (userIds.length > 0) {
              const { data: users } = await supabase
                .from('users')
                .select('id, full_name, email')
                .in('id', userIds)

              if (users) {
                userMap = Object.fromEntries(users.map(u => [u.id, { full_name: u.full_name, email: u.email }]))
              }
            }

            // Transform coverage history to ActivityItem format
            for (const c of coverageData) {
              const asset = c.assets as any
              const assetSymbol = asset?.symbol || 'Unknown'
              const assetName = asset?.name || ''
              const changedByUser = c.changed_by ? userMap[c.changed_by] : null

              // Determine action type based on change_type
              let actionType = 'coverage_changed'
              if (c.change_type === 'assigned' || c.change_type === 'created') {
                actionType = 'coverage_assigned'
              } else if (c.change_type === 'removed' || c.change_type === 'deleted') {
                actionType = 'coverage_removed'
              } else if (c.change_type === 'activated' || c.change_type === 'started') {
                actionType = 'coverage_started'
              } else if (c.change_type === 'deactivated' || c.change_type === 'ended') {
                actionType = 'coverage_ended'
              }

              // Apply action type filter for coverage
              if (selectedActionType !== 'all' && selectedActionType !== actionType) {
                continue
              }

              // Apply search filter
              if (searchQuery) {
                const searchLower = searchQuery.toLowerCase()
                const matchesSearch =
                  assetSymbol.toLowerCase().includes(searchLower) ||
                  assetName.toLowerCase().includes(searchLower) ||
                  (c.old_analyst_name || '').toLowerCase().includes(searchLower) ||
                  (c.new_analyst_name || '').toLowerCase().includes(searchLower) ||
                  (changedByUser?.full_name || '').toLowerCase().includes(searchLower)

                if (!matchesSearch) continue
              }

              allEvents.push({
                id: c.id,
                occurred_at: c.changed_at,
                actor_id: c.changed_by,
                actor_name: changedByUser?.full_name,
                actor_email: changedByUser?.email,
                entity_type: 'coverage',
                entity_id: c.asset_id,
                entity_display_name: assetSymbol,
                action_type: actionType,
                action_category: 'coverage',
                from_state: {
                  analyst_name: c.old_analyst_name,
                  user_id: c.old_user_id,
                  start_date: c.old_start_date,
                  end_date: c.old_end_date,
                  is_active: c.old_is_active,
                },
                to_state: {
                  analyst_name: c.new_analyst_name,
                  user_id: c.new_user_id,
                  start_date: c.new_start_date,
                  end_date: c.new_end_date,
                  is_active: c.new_is_active,
                },
                metadata: {
                  change_reason: c.change_reason,
                  asset_name: assetName,
                },
              })
            }
          }
        }
      }

      // Sort all events by occurred_at descending
      allEvents.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

      return allEvents
    },
    staleTime: 30000,
  })

  // Group events by date
  const groupedEvents = useMemo(() => {
    if (!events) return []

    const groups: { date: string; events: ActivityItem[] }[] = []
    let currentDate = ''

    for (const event of events) {
      const eventDate = format(new Date(event.occurred_at), 'yyyy-MM-dd')
      if (eventDate !== currentDate) {
        currentDate = eventDate
        groups.push({ date: eventDate, events: [] })
      }
      groups[groups.length - 1].events.push(event)
    }

    return groups
  }, [events])

  const handleExport = () => {
    if (!events || events.length === 0) return

    const csv = [
      ['Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity', 'From State', 'To State', 'Changed Fields'].join(','),
      ...events.map(e => [
        e.occurred_at,
        e.actor_name || e.actor_email || e.actor_id,
        e.action_type,
        e.entity_type,
        e.entity_display_name || e.entity_id,
        e.from_state?.status || '',
        e.to_state?.status || '',
        (e.changed_fields || []).join(';'),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Activity className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Activity History</h1>
              <p className="text-sm text-gray-500">Track all changes and actions across your workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={!events?.length}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events..."
              className="pl-9"
            />
          </div>

          {/* Time Range */}
          <div className="relative">
            <select
              value={selectedTimeRange}
              onChange={(e) => setSelectedTimeRange(e.target.value)}
              className="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {TIME_RANGES.map(range => (
                <option key={range.id} value={range.id}>{range.label}</option>
              ))}
            </select>
            <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>

          {/* Entity Type Filter */}
          <select
            value={selectedEntityType}
            onChange={(e) => setSelectedEntityType(e.target.value)}
            className="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All entities</option>
            <option value="trade_idea">Trade Ideas</option>
            <option value="pair_trade">Pair Trades</option>
            <option value="simulation">Simulations</option>
            <option value="coverage">Coverage</option>
          </select>

          {/* Action Type Filter */}
          <select
            value={selectedActionType}
            onChange={(e) => setSelectedActionType(e.target.value)}
            className="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All actions</option>
            <option value="create">Created</option>
            <option value="move_stage">Moved</option>
            <option value="delete">Deleted</option>
            <option value="restore">Restored</option>
            <option value="update_field">Updated</option>
            <option value="coverage_assigned">Coverage Assigned</option>
            <option value="coverage_removed">Coverage Removed</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <ListSkeleton count={10} />
        ) : error ? (
          <Card className="p-8 text-center">
            <p className="text-red-500">Failed to load audit events</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-4">
              Try Again
            </Button>
          </Card>
        ) : !events || events.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity found"
            description="No audit events match your current filters. Try adjusting the time range or filters."
          />
        ) : (
          <div className="space-y-6">
            {groupedEvents.map(group => (
              <div key={group.date}>
                <h3 className="text-sm font-medium text-gray-500 mb-3 sticky top-0 bg-gray-50 py-2">
                  {format(new Date(group.date), 'EEEE, MMMM d, yyyy')}
                </h3>
                <Card className="divide-y divide-gray-100">
                  {group.events.map(event => {
                    const Icon = ACTION_ICONS[event.action_type] || Activity
                    const colorClass = ACTION_COLORS[event.action_type] || 'bg-gray-100 text-gray-700'
                    const actor = event.actor_name || event.actor_email?.split('@')[0] || event.actor_role || 'System'

                    return (
                      <div key={event.id} className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', colorClass)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900">
                              {formatEventSummary(event)}
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {actor}
                              </span>
                              <span>
                                {format(new Date(event.occurred_at), 'h:mm a')}
                              </span>
                              <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                                {ENTITY_TYPE_LABELS[event.entity_type] || event.entity_type}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
