import React, { useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Clock,
  Target,
  Sparkles,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  Star,
  User,
  ChevronRight
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface ThesisHistoryViewProps {
  assetId: string
  viewFilter: 'aggregated' | string
  className?: string
}

interface HistoryEvent {
  id: string
  type: 'thesis' | 'where_different' | 'risks_to_thesis' | 'price_target'
  timestamp: Date
  userId: string
  userName: string
  isCovering: boolean
  // For contributions
  content?: string
  previousContent?: string
  // For price targets
  priceTarget?: number
  previousPriceTarget?: number
  sentiment?: 'bullish' | 'neutral' | 'bearish'
}

// ============================================================================
// TIMELINE EVENT CARD
// ============================================================================

function TimelineEvent({ event }: { event: HistoryEvent }) {
  const typeConfig = {
    thesis: { icon: Target, color: 'text-primary-600', bg: 'bg-primary-50', label: 'Investment Thesis' },
    where_different: { icon: Sparkles, color: 'text-purple-600', bg: 'bg-purple-50', label: 'Where Different' },
    risks_to_thesis: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Risks' },
    price_target: { icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50', label: 'Price Target' }
  }

  const config = typeConfig[event.type]
  const Icon = config.icon

  // Calculate price target change
  const priceChange = event.type === 'price_target' && event.priceTarget && event.previousPriceTarget
    ? ((event.priceTarget - event.previousPriceTarget) / event.previousPriceTarget) * 100
    : null

  return (
    <div className="relative pl-8 pb-6 last:pb-0">
      {/* Timeline connector */}
      <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200 last:hidden" />

      {/* Timeline dot */}
      <div className={clsx(
        'absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center',
        config.bg
      )}>
        <Icon className={clsx('w-3 h-3', config.color)} />
      </div>

      {/* Event content */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded', config.bg, config.color)}>
              {config.label}
            </span>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              {event.isCovering && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
              <span className="font-medium text-gray-700">{event.userName}</span>
            </div>
          </div>
          <span className="text-xs text-gray-400" title={format(event.timestamp, 'PPpp')}>
            {formatDistanceToNow(event.timestamp, { addSuffix: true })}
          </span>
        </div>

        {/* Price target specific display */}
        {event.type === 'price_target' && (
          <div className="flex items-center gap-3">
            {event.previousPriceTarget && (
              <>
                <span className="text-sm text-gray-400">${event.previousPriceTarget}</span>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </>
            )}
            <span className="text-lg font-semibold text-gray-900">${event.priceTarget}</span>
            {priceChange !== null && (
              <span className={clsx(
                'text-xs font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5',
                priceChange > 0 ? 'bg-green-50 text-green-600' : priceChange < 0 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'
              )}>
                {priceChange > 0 ? <TrendingUp className="w-3 h-3" /> : priceChange < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                {priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%
              </span>
            )}
          </div>
        )}

        {/* Contribution content */}
        {event.type !== 'price_target' && event.content && (
          <p className="text-sm text-gray-700 leading-relaxed">{event.content}</p>
        )}

        {/* Previous content (if changed) */}
        {event.previousContent && event.content !== event.previousContent && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">Previous:</span>
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{event.previousContent}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ThesisHistoryView({ assetId, viewFilter, className }: ThesisHistoryViewProps) {
  // Fetch contribution history
  const { data: contributionHistory = [], isLoading: loadingContributions } = useQuery({
    queryKey: ['contribution-history', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contribution_history')
        .select(`
          id,
          contribution_id,
          content,
          created_by,
          created_at,
          contributions!inner(section, asset_id)
        `)
        .eq('contributions.asset_id', assetId)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  // Fetch current contributions for user names
  const { data: contributions = [] } = useQuery({
    queryKey: ['contributions-all', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contributions')
        .select(`
          id,
          section,
          content,
          created_by,
          updated_at,
          user:users!contributions_created_by_fkey(id, first_name, last_name, full_name)
        `)
        .eq('asset_id', assetId)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  // Fetch price target history
  const { data: priceTargetHistory = [], isLoading: loadingTargets } = useQuery({
    queryKey: ['price-target-history', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_targets')
        .select(`
          id,
          target_price,
          created_by,
          created_at,
          updated_at,
          user:users!price_targets_created_by_fkey(id, first_name, last_name, full_name)
        `)
        .eq('asset_id', assetId)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  // Fetch coverage data
  const { data: coverageData = [] } = useQuery({
    queryKey: ['coverage', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('user_id')
        .eq('asset_id', assetId)
        .eq('is_active', true)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: Infinity
  })

  const coveringIds = new Set(coverageData.map(c => c.user_id).filter(Boolean))

  // Build user lookup
  const userLookup = useMemo(() => {
    const lookup: Record<string, { name: string; isCovering: boolean }> = {}
    contributions.forEach((c: any) => {
      if (c.user) {
        lookup[c.created_by] = {
          name: c.user.full_name || `${c.user.first_name} ${c.user.last_name}`,
          isCovering: coveringIds.has(c.created_by)
        }
      }
    })
    priceTargetHistory.forEach((pt: any) => {
      if (pt.user && !lookup[pt.created_by]) {
        lookup[pt.created_by] = {
          name: pt.user.full_name || `${pt.user.first_name} ${pt.user.last_name}`,
          isCovering: coveringIds.has(pt.created_by)
        }
      }
    })
    return lookup
  }, [contributions, priceTargetHistory, coveringIds])

  // Build timeline events
  const events = useMemo(() => {
    const allEvents: HistoryEvent[] = []

    // Add contribution history events
    contributionHistory.forEach((h: any) => {
      const contrib = contributions.find((c: any) => c.id === h.contribution_id)
      const userInfo = userLookup[h.created_by] || { name: 'Unknown', isCovering: false }

      allEvents.push({
        id: h.id,
        type: h.contributions?.section || 'thesis',
        timestamp: new Date(h.created_at),
        userId: h.created_by,
        userName: userInfo.name,
        isCovering: userInfo.isCovering,
        content: h.content,
        previousContent: undefined // Would need to look up previous in history
      })
    })

    // Add current contributions as latest events (if not in history)
    contributions.forEach((c: any) => {
      const hasHistory = contributionHistory.some((h: any) => h.contribution_id === c.id)
      if (!hasHistory) {
        const userInfo = userLookup[c.created_by] || { name: 'Unknown', isCovering: false }
        allEvents.push({
          id: `current-${c.id}`,
          type: c.section,
          timestamp: new Date(c.updated_at),
          userId: c.created_by,
          userName: userInfo.name,
          isCovering: userInfo.isCovering,
          content: c.content
        })
      }
    })

    // Add price target events
    priceTargetHistory.forEach((pt: any, idx: number) => {
      const userInfo = userLookup[pt.created_by] || { name: 'Unknown', isCovering: false }
      const previousTarget = priceTargetHistory[idx + 1]

      allEvents.push({
        id: `pt-${pt.id}`,
        type: 'price_target',
        timestamp: new Date(pt.updated_at || pt.created_at),
        userId: pt.created_by,
        userName: userInfo.name,
        isCovering: userInfo.isCovering,
        priceTarget: pt.target_price,
        previousPriceTarget: previousTarget?.target_price
      })
    })

    // Filter by viewFilter
    let filtered = allEvents
    if (viewFilter !== 'aggregated') {
      filtered = allEvents.filter(e => e.userId === viewFilter)
    }

    // Sort by timestamp descending
    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }, [contributionHistory, contributions, priceTargetHistory, userLookup, viewFilter])

  const isLoading = loadingContributions || loadingTargets

  if (isLoading) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className={clsx('bg-gray-50 border border-gray-200 rounded-lg p-6 text-center', className)}>
        <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No history available</p>
        <p className="text-xs text-gray-400 mt-1">Changes to thesis and price targets will appear here</p>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          <h4 className="text-sm font-semibold text-gray-900">Thesis History</h4>
        </div>
        <span className="text-xs text-gray-500">{events.length} event{events.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Timeline */}
      <div className="relative">
        {events.map(event => (
          <TimelineEvent key={event.id} event={event} />
        ))}
      </div>
    </div>
  )
}
