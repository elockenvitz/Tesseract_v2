/**
 * OrgActivityTab — Admin-only audit log viewer with server-side
 * pagination, action filtering, actor filtering, date range, and CSV export.
 */

import React, { useState, useCallback, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { csvSanitizeCell } from '../../lib/csv-sanitize'
import {
  Activity,
  ChevronDown,
  Filter,
  Clock,
  UserCircle,
  Download,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { format } from 'date-fns'
import type { OrgAuditLogEntry } from '../../types/organization'

const PAGE_SIZE = 30

const ACTION_LABELS: Record<string, string> = {
  'membership.status_changed': 'Membership status changed',
  'membership.admin_changed': 'Admin role changed',
  'user.coverage_admin_changed': 'Coverage admin changed',
  'access_request.reviewed': 'Access request reviewed',
  'team_membership.added': 'Team member added',
  'team_membership.removed': 'Team member removed',
  'portfolio_membership.added': 'Portfolio member added',
  'portfolio_membership.removed': 'Portfolio member removed',
  'invite.created': 'Invite sent',
  'invite.accepted': 'Invite accepted',
  'member.deactivated': 'Member deactivated',
  'member.reactivated': 'Member reactivated',
  'member.temporary_access_granted': 'Temp access granted',
  'member.temporary_access_revoked': 'Temp access revoked',
}

/** Quick filter groups for common audit scenarios */
const QUICK_FILTERS: { label: string; actions: string[] }[] = [
  {
    label: 'Lifecycle',
    actions: ['member.deactivated', 'member.reactivated', 'membership.status_changed'],
  },
  {
    label: 'Support',
    actions: ['member.temporary_access_granted', 'member.temporary_access_revoked'],
  },
  {
    label: 'Access',
    actions: ['team_membership.added', 'team_membership.removed', 'portfolio_membership.added', 'portfolio_membership.removed'],
  },
]

const ALL_ACTIONS = Object.keys(ACTION_LABELS)

interface OrgActivityTabProps {
  organizationId: string
  isOrgAdmin: boolean
  /** Map of user_id -> display name for resolving actor names */
  userNameMap: Map<string, string>
}

export function OrgActivityTab({
  organizationId,
  isOrgAdmin,
  userNameMap,
}: OrgActivityTabProps) {
  const [actionFilter, setActionFilter] = useState<string>('')
  const [actorFilter, setActorFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(null)

  // Resolved action filters: quick filter takes precedence over dropdown
  const effectiveActions = useMemo(() => {
    if (activeQuickFilter) {
      const qf = QUICK_FILTERS.find((q) => q.label === activeQuickFilter)
      return qf?.actions || []
    }
    return actionFilter ? [actionFilter] : []
  }, [activeQuickFilter, actionFilter])

  // Build actor options from userNameMap
  const actorOptions = useMemo(() => {
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
    queryKey: ['organization-audit-log', organizationId, actionFilter, activeQuickFilter, actorFilter, dateFrom, dateTo],
    queryFn: async ({ pageParam = 0 }) => {
      let query = supabase
        .from('organization_audit_log')
        .select('*', { count: 'exact' })
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1)

      if (effectiveActions.length === 1) {
        query = query.eq('action', effectiveActions[0])
      } else if (effectiveActions.length > 1) {
        query = query.in('action', effectiveActions)
      }
      if (actorFilter) {
        query = query.eq('actor_id', actorFilter)
      }
      if (dateFrom) {
        query = query.gte('created_at', `${dateFrom}T00:00:00`)
      }
      if (dateTo) {
        query = query.lte('created_at', `${dateTo}T23:59:59`)
      }

      const { data: rows, error, count } = await query
      if (error) throw error
      return {
        rows: (rows || []) as OrgAuditLogEntry[],
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

  const getActorName = useCallback(
    (actorId: string | null) => {
      if (!actorId) return 'System'
      return userNameMap.get(actorId) || actorId.slice(0, 8) + '...'
    },
    [userNameMap]
  )

  // CSV export
  const handleExport = useCallback(() => {
    if (!allEntries.length) return
    const csv = [
      ['Timestamp', 'Actor', 'Action', 'Details'].join(','),
      ...allEntries.map((e) =>
        [
          e.created_at,
          getActorName(e.actor_id),
          ACTION_LABELS[e.action] || e.action,
          JSON.stringify(e.details || {}),
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
  }, [allEntries, getActorName])

  if (!isOrgAdmin) return null

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

  const renderDetails = (entry: OrgAuditLogEntry) => {
    const d = entry.details || {}
    const parts: string[] = []

    if (d.old_status && d.new_status) {
      parts.push(`${d.old_status} → ${d.new_status}`)
    }
    if (d.old_is_org_admin !== undefined) {
      parts.push(d.new_is_org_admin ? 'promoted to admin' : 'demoted from admin')
    }
    if (d.old_coverage_admin !== undefined) {
      parts.push(d.new_coverage_admin ? 'granted coverage admin' : 'revoked coverage admin')
    }
    if (d.email) parts.push(d.email)
    if (d.new_status && !d.old_status) parts.push(d.new_status)
    if (d.request_type) parts.push(d.request_type.replace(/_/g, ' '))
    if (d.reason) parts.push(d.reason)
    if (d.duration_minutes) parts.push(`${d.duration_minutes}min`)
    if (d.expires_at) parts.push(`expires ${new Date(d.expires_at).toLocaleString()}`)

    return parts.length > 0 ? parts.join(' · ') : null
  }

  return (
    <div className="space-y-4">
      {/* Header + Quick Filters + Filters */}
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
                    setActionFilter('')
                  }
                }}
                className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                  activeQuickFilter === qf.label
                    ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {qf.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Actor filter */}
          <div className="relative">
            <select
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              className="text-xs border border-gray-300 rounded-lg pl-7 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All people</option>
              {actorOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <UserCircle className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>

          {/* Action filter */}
          <div className="relative">
            <select
              value={activeQuickFilter ? '' : actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setActiveQuickFilter(null) }}
              className="text-xs border border-gray-300 rounded-lg pl-7 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All actions</option>
              {ALL_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </select>
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
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
            const details = renderDetails(entry)
            return (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-start space-x-3"
              >
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <UserCircle className="w-4 h-4 text-gray-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2 text-sm">
                    <span className="font-medium text-gray-900 truncate">
                      {getActorName(entry.actor_id)}
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-700 rounded whitespace-nowrap">
                      {ACTION_LABELS[entry.action] || entry.action}
                    </span>
                  </div>
                  {details && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {details}
                    </p>
                  )}
                </div>
                <div className="flex items-center text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                  <Clock className="w-3 h-3 mr-1" />
                  {formatTime(entry.created_at)}
                </div>
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
