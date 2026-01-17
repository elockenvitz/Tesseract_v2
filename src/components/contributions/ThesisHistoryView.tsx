import React, { useMemo, useState } from 'react'
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
  ChevronRight,
  List,
  GitCompare,
  Lightbulb,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useHistoryEvolutionAnalysis, type HistoryEvent, type EvolutionAnalysis } from '../../hooks/useContributions'
import { EvolutionOverview, type EvolutionStats, type Sentiment } from './EvolutionOverview'
import { EvolutionTimeline } from './EvolutionTimeline'
import { VersionComparison } from './VersionComparison'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ThesisHistoryViewProps {
  assetId: string
  viewFilter: 'aggregated' | string
  className?: string
}

type ViewMode = 'timeline' | 'list' | 'compare'
type HistoryFilter = 'all' | 'thesis' | 'where_different' | 'risks_to_thesis' | 'price_target' | 'reference'

// ============================================================================
// CONFIGURATION
// ============================================================================

const filterConfig: { value: HistoryFilter; label: string; color: string }[] = [
  { value: 'all', label: 'All', color: 'text-gray-600' },
  { value: 'thesis', label: 'Thesis', color: 'text-primary-600' },
  { value: 'where_different', label: 'Different', color: 'text-purple-600' },
  { value: 'risks_to_thesis', label: 'Risks', color: 'text-amber-600' },
  { value: 'price_target', label: 'Targets', color: 'text-green-600' },
  { value: 'reference', label: 'Docs', color: 'text-blue-600' },
]

// ============================================================================
// SIMPLE DIFF FUNCTION
// ============================================================================

interface DiffPart {
  type: 'unchanged' | 'added' | 'removed'
  text: string
}

function getWordBase(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true
  return getWordBase(a) === getWordBase(b) && getWordBase(a).length > 0
}

function computeSimpleDiff(oldText: string | null, newText: string | null): DiffPart[] {
  if (!oldText && !newText) return []
  if (!oldText) return [{ type: 'added', text: newText! }]
  if (!newText) return [{ type: 'removed', text: oldText }]

  const oldWords = oldText.split(/\s+/).filter(w => w.length > 0)
  const newWords = newText.split(/\s+/).filter(w => w.length > 0)

  const m = oldWords.length
  const n = newWords.length

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (wordsMatch(oldWords[i - 1], newWords[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const parts: DiffPart[] = []
  let i = m, j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsMatch(oldWords[i - 1], newWords[j - 1])) {
      parts.unshift({ type: 'unchanged', text: newWords[j - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      parts.unshift({ type: 'added', text: newWords[j - 1] })
      j--
    } else if (i > 0) {
      parts.unshift({ type: 'removed', text: oldWords[i - 1] })
      i--
    }
  }

  const result: DiffPart[] = []
  for (const part of parts) {
    const last = result[result.length - 1]
    if (last && last.type === part.type) {
      last.text += ' ' + part.text
    } else {
      result.push({ ...part })
    }
  }

  return result
}

// ============================================================================
// DIFF DISPLAY COMPONENT
// ============================================================================

function DiffView({ oldContent, newContent }: { oldContent: string | null; newContent: string | null }) {
  const diff = computeSimpleDiff(oldContent, newContent)

  if (diff.length === 0) {
    return <span className="text-gray-400 italic">No changes</span>
  }

  return (
    <div className="text-sm leading-relaxed">
      {diff.map((part, idx) => {
        const needsSpace = idx > 0
        if (part.type === 'unchanged') {
          return <span key={idx} className="text-gray-700">{needsSpace ? ' ' : ''}{part.text}</span>
        } else if (part.type === 'added') {
          return (
            <span key={idx}>
              {needsSpace ? ' ' : ''}
              <span className="bg-green-100 text-green-800 rounded px-0.5">{part.text}</span>
            </span>
          )
        } else {
          return (
            <span key={idx}>
              {needsSpace ? ' ' : ''}
              <span className="bg-red-100 text-red-800 line-through rounded px-0.5">{part.text}</span>
            </span>
          )
        }
      })}
    </div>
  )
}

// ============================================================================
// LIST VIEW TIMELINE EVENT
// ============================================================================

function TimelineEvent({ event }: { event: HistoryEvent }) {
  const typeConfig = {
    thesis: { color: 'text-primary-600', label: 'Investment Thesis' },
    where_different: { color: 'text-purple-600', label: 'Where Different' },
    risks_to_thesis: { color: 'text-amber-600', label: 'Risks to Thesis' },
    price_target: { color: 'text-green-600', label: 'Price Target' },
    reference: { color: 'text-blue-600', label: 'Supporting Docs' }
  }

  const config = typeConfig[event.type]

  const priceChange = event.type === 'price_target' && event.priceTarget && event.previousPriceTarget
    ? ((event.priceTarget - event.previousPriceTarget) / event.previousPriceTarget) * 100
    : null

  return (
    <div className="py-2 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-1.5 text-xs mb-1 flex-wrap">
        <span className={clsx('font-semibold', config.color)}>{config.label}</span>
        <span className="text-gray-300">·</span>
        <span className="font-medium text-gray-600">{event.userName}</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-400" title={format(event.timestamp, 'PPpp')}>
          {formatDistanceToNow(event.timestamp, { addSuffix: true })}
        </span>
      </div>

      {event.type === 'price_target' && (
        <div className="flex items-center gap-2 text-sm">
          {event.previousPriceTarget && (
            <>
              <span className="text-gray-400">${event.previousPriceTarget}</span>
              <ChevronRight className="w-3 h-3 text-gray-300" />
            </>
          )}
          <span className="font-semibold text-gray-900">${event.priceTarget}</span>
          {priceChange !== null && (
            <span className={clsx(
              'text-xs px-1 rounded',
              priceChange > 0 ? 'text-green-600' : priceChange < 0 ? 'text-red-600' : 'text-gray-500'
            )}>
              {priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {event.type !== 'price_target' && (
        <div className="text-sm">
          {event.previousContent ? (
            <DiffView oldContent={event.previousContent} newContent={event.content || null} />
          ) : event.content ? (
            <span className="bg-green-100 text-green-800 rounded px-0.5">{event.content}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// AI INSIGHTS PANEL
// ============================================================================

interface AIInsightsPanelProps {
  analysis: EvolutionAnalysis | null
  isLoading: boolean
}

function AIInsightsPanel({ analysis, isLoading }: AIInsightsPanelProps) {
  const [expanded, setExpanded] = useState(true)

  if (isLoading) {
    return (
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 animate-pulse">
        <div className="h-4 bg-purple-200 rounded w-1/3 mb-3" />
        <div className="space-y-2">
          <div className="h-3 bg-purple-200 rounded w-full" />
          <div className="h-3 bg-purple-200 rounded w-4/5" />
          <div className="h-3 bg-purple-200 rounded w-3/5" />
        </div>
      </div>
    )
  }

  if (!analysis) return null

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-purple-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-semibold text-purple-900">AI Evolution Insights</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-purple-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-purple-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Thesis Evolution Summary */}
          <div>
            <p className="text-xs font-medium text-purple-700 mb-1">Thesis Evolution</p>
            <p className="text-sm text-purple-900">{analysis.thesisEvolution}</p>
          </div>

          {/* Key Insights */}
          <div>
            <p className="text-xs font-medium text-purple-700 mb-2">Key Insights</p>
            <ul className="space-y-1.5">
              {analysis.insights.map((insight, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-purple-800">
                  <Sparkles className="w-3 h-3 text-purple-500 mt-0.5 flex-shrink-0" />
                  {insight}
                </li>
              ))}
            </ul>
          </div>

          {/* Price Target Summary */}
          {analysis.priceTargetSummary && (
            <div>
              <p className="text-xs font-medium text-purple-700 mb-1">Price Target Evolution</p>
              <p className="text-sm text-purple-800">{analysis.priceTargetSummary}</p>
            </div>
          )}

          {/* Risk Evolution */}
          {analysis.riskEvolution && (
            <div>
              <p className="text-xs font-medium text-purple-700 mb-1">Risk Perception</p>
              <p className="text-sm text-purple-800">{analysis.riskEvolution}</p>
            </div>
          )}

          {/* Conviction Indicators */}
          {analysis.convictionIndicators.length > 0 && (
            <div>
              <p className="text-xs font-medium text-purple-700 mb-2">Conviction Signals</p>
              <div className="flex flex-wrap gap-2">
                {analysis.convictionIndicators.map((indicator, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full"
                  >
                    {indicator}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Generated timestamp */}
          <p className="text-xs text-purple-400 pt-2 border-t border-purple-200">
            Generated {formatDistanceToNow(new Date(analysis.generatedAt), { addSuffix: true })}
          </p>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// VIEW MODE TOGGLE
// ============================================================================

interface ViewModeToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  const modes: { value: ViewMode; label: string; icon: React.ElementType }[] = [
    { value: 'timeline', label: 'Timeline', icon: Clock },
    { value: 'list', label: 'List', icon: List },
    { value: 'compare', label: 'Compare', icon: GitCompare },
  ]

  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
      {modes.map(m => {
        const Icon = m.icon
        return (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors',
              mode === m.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon className="w-3 h-3" />
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ThesisHistoryView({ assetId, viewFilter, className }: ThesisHistoryViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [typeFilter, setTypeFilter] = useState<HistoryFilter>('all')

  // Fetch contribution history
  const { data: contributionHistory = [], isLoading: loadingContributions } = useQuery({
    queryKey: ['contribution-history', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_contribution_history')
        .select(`
          id,
          contribution_id,
          old_content,
          new_content,
          changed_by,
          changed_at,
          user:users!asset_contribution_history_changed_by_fkey(id, first_name, last_name),
          contribution:asset_contributions!inner(section, asset_id)
        `)
        .eq('contribution.asset_id', assetId)
        .order('changed_at', { ascending: false })
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
        .from('asset_contributions')
        .select(`
          id,
          section,
          content,
          created_by,
          updated_at,
          user:users!asset_contributions_created_by_fkey(id, first_name, last_name, full_name)
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

  // Fetch reference history
  const { data: referenceHistory = [] } = useQuery({
    queryKey: ['reference-history', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_field_history')
        .select(`
          id,
          field_name,
          old_value,
          new_value,
          changed_by,
          changed_at,
          user:users!asset_field_history_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .eq('field_name', 'thesis_references')
        .order('changed_at', { ascending: false })
        .limit(50)

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
    referenceHistory.forEach((rh: any) => {
      if (rh.user && rh.changed_by && !lookup[rh.changed_by]) {
        lookup[rh.changed_by] = {
          name: `${rh.user.first_name || ''} ${rh.user.last_name || ''}`.trim() || 'Unknown',
          isCovering: coveringIds.has(rh.changed_by)
        }
      }
    })
    return lookup
  }, [contributions, priceTargetHistory, referenceHistory, coveringIds])

  // Build timeline events
  const events = useMemo(() => {
    const allEvents: HistoryEvent[] = []

    // Add contribution history events
    contributionHistory.forEach((h: any) => {
      const userName = h.user
        ? `${h.user.first_name || ''} ${h.user.last_name || ''}`.trim() || 'Unknown'
        : (userLookup[h.changed_by]?.name || 'Unknown')

      allEvents.push({
        id: h.id,
        type: h.contribution?.section || 'thesis',
        timestamp: new Date(h.changed_at),
        userId: h.changed_by,
        userName,
        content: h.new_content,
        previousContent: h.old_content
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
        priceTarget: pt.target_price,
        previousPriceTarget: previousTarget?.target_price
      })
    })

    // Add reference events
    referenceHistory.forEach((rh: any) => {
      const userInfo = userLookup[rh.changed_by] || { name: 'Unknown', isCovering: false }

      allEvents.push({
        id: `ref-${rh.id}`,
        type: 'reference',
        timestamp: new Date(rh.changed_at),
        userId: rh.changed_by,
        userName: userInfo.name,
        content: rh.new_value,
        previousContent: rh.old_value
      })
    })

    // Filter by viewFilter (user)
    let filtered = allEvents
    if (viewFilter !== 'aggregated') {
      filtered = allEvents.filter(e => e.userId === viewFilter)
    }

    // Sort by timestamp descending
    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }, [contributionHistory, contributions, priceTargetHistory, referenceHistory, userLookup, viewFilter])

  // Compute evolution stats
  const evolutionStats = useMemo((): EvolutionStats => {
    if (events.length === 0) {
      return {
        totalRevisions: 0,
        firstEditDate: null,
        lastEditDate: null,
        thesisChanges: 0,
        riskUpdates: 0,
        priceTargetRevisions: 0,
        whereDifferentChanges: 0,
        referenceChanges: 0,
        sentimentTrajectory: 'unknown'
      }
    }

    const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    const firstEvent = sortedEvents[0]
    const lastEvent = sortedEvents[sortedEvents.length - 1]

    // Detect sentiment from price target changes
    const priceEvents = events.filter(e => e.type === 'price_target' && e.priceTarget)
    let trajectory: EvolutionStats['sentimentTrajectory'] = 'stable'

    if (priceEvents.length >= 2) {
      const firstPrice = priceEvents[priceEvents.length - 1].priceTarget
      const lastPrice = priceEvents[0].priceTarget
      if (firstPrice && lastPrice) {
        const change = (lastPrice - firstPrice) / firstPrice
        if (change > 0.1) trajectory = 'more_bullish'
        else if (change < -0.1) trajectory = 'more_bearish'
      }
    }

    return {
      totalRevisions: events.length,
      firstEditDate: firstEvent.timestamp,
      lastEditDate: lastEvent.timestamp,
      thesisChanges: events.filter(e => e.type === 'thesis').length,
      riskUpdates: events.filter(e => e.type === 'risks_to_thesis').length,
      priceTargetRevisions: events.filter(e => e.type === 'price_target').length,
      whereDifferentChanges: events.filter(e => e.type === 'where_different').length,
      referenceChanges: events.filter(e => e.type === 'reference').length,
      sentimentTrajectory: trajectory
    }
  }, [events])

  // Use evolution analysis hook
  const userId = viewFilter !== 'aggregated' ? viewFilter : undefined
  const {
    analysis: evolutionAnalysis,
    isLoading: isLoadingAnalysis,
    isGenerating: isGeneratingAnalysis,
    isStale: isAnalysisStale,
    generateAnalysis
  } = useHistoryEvolutionAnalysis({
    assetId,
    userId,
    historyEvents: events
  })

  // Apply type filter
  const filteredEvents = useMemo(() => {
    if (typeFilter === 'all') return events
    return events.filter(e => e.type === typeFilter)
  }, [events, typeFilter])

  const isLoading = loadingContributions || loadingTargets

  if (isLoading) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
        <div className="h-32 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className={clsx('text-center py-8', className)}>
        <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No history yet</p>
        <p className="text-xs text-gray-400 mt-1">Changes will be tracked as you edit</p>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Evolution Overview */}
      <EvolutionOverview
        stats={evolutionStats}
        isAnalyzing={isGeneratingAnalysis}
        hasAnalysis={!!evolutionAnalysis}
        isAnalysisStale={isAnalysisStale}
        onAnalyzeEvolution={() => generateAnalysis()}
      />

      {/* AI Insights Panel */}
      <AIInsightsPanel
        analysis={evolutionAnalysis}
        isLoading={isLoadingAnalysis}
      />

      {/* View Mode Toggle & Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />

        {/* Type filter (only show for list/timeline views) */}
        {viewMode !== 'compare' && (
          <div className="flex items-center gap-1 flex-wrap">
            {filterConfig.map(f => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={clsx(
                  'px-2 py-0.5 text-xs rounded-full transition-colors',
                  typeFilter === f.value
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View Content */}
      {viewMode === 'timeline' && (
        <EvolutionTimeline
          events={filteredEvents}
          milestones={evolutionAnalysis?.keyMilestones}
        />
      )}

      {viewMode === 'list' && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="p-4">
            {filteredEvents.length > 0 ? (
              filteredEvents.map(event => (
                <TimelineEvent key={event.id} event={event} />
              ))
            ) : (
              <p className="text-sm text-gray-400 text-center py-2">
                No {typeFilter.replace('_', ' ')} changes
              </p>
            )}
          </div>
        </div>
      )}

      {viewMode === 'compare' && (
        <VersionComparison events={events} />
      )}
    </div>
  )
}
