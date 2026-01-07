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
  Link2
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
  type: 'thesis' | 'where_different' | 'risks_to_thesis' | 'price_target' | 'reference'
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
// SIMPLE DIFF FUNCTION
// ============================================================================

interface DiffPart {
  type: 'unchanged' | 'added' | 'removed'
  text: string
}

// Helper to get the "base" of a word (alphanumeric only) for comparison
function getWordBase(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

// Check if two words are "similar enough" to be considered the same
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true
  // Consider words the same if their alphanumeric content matches
  return getWordBase(a) === getWordBase(b) && getWordBase(a).length > 0
}

function computeSimpleDiff(oldText: string | null, newText: string | null): DiffPart[] {
  if (!oldText && !newText) return []
  if (!oldText) return [{ type: 'added', text: newText! }]
  if (!newText) return [{ type: 'removed', text: oldText }]

  // Split into words (keeping words only, not whitespace as separate tokens)
  const oldWords = oldText.split(/\s+/).filter(w => w.length > 0)
  const newWords = newText.split(/\s+/).filter(w => w.length > 0)

  const m = oldWords.length
  const n = newWords.length

  // Build LCS table using fuzzy word matching
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

  // Backtrack to find diff
  const parts: DiffPart[] = []
  let i = m, j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsMatch(oldWords[i - 1], newWords[j - 1])) {
      // Words match - use the new version (in case punctuation changed)
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

  // Merge consecutive parts of same type, adding spaces between words
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
// TIMELINE EVENT CARD
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

  // Calculate price target change
  const priceChange = event.type === 'price_target' && event.priceTarget && event.previousPriceTarget
    ? ((event.priceTarget - event.previousPriceTarget) / event.previousPriceTarget) * 100
    : null

  return (
    <div className="py-2 border-b border-gray-100 last:border-b-0">
      {/* Header line: Section · User · Time */}
      <div className="flex items-center gap-1.5 text-xs mb-1 flex-wrap">
        <span className={clsx('font-semibold', config.color)}>{config.label}</span>
        <span className="text-gray-300">·</span>
        {event.isCovering && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
        <span className="font-medium text-gray-600">{event.userName}</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-400" title={format(event.timestamp, 'PPpp')}>
          {formatDistanceToNow(event.timestamp, { addSuffix: true })}
        </span>
      </div>

      {/* Price target display */}
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

      {/* Contribution content with diff view */}
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
// MAIN COMPONENT
// ============================================================================

type HistoryFilter = 'all' | 'thesis' | 'where_different' | 'risks_to_thesis' | 'price_target' | 'reference'

const filterConfig: { value: HistoryFilter; label: string; color: string }[] = [
  { value: 'all', label: 'All', color: 'text-gray-600' },
  { value: 'thesis', label: 'Thesis', color: 'text-primary-600' },
  { value: 'where_different', label: 'Different', color: 'text-purple-600' },
  { value: 'risks_to_thesis', label: 'Risks', color: 'text-amber-600' },
  { value: 'price_target', label: 'Targets', color: 'text-green-600' },
  { value: 'reference', label: 'Docs', color: 'text-blue-600' },
]

export function ThesisHistoryView({ assetId, viewFilter, className }: ThesisHistoryViewProps) {
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

  // Fetch reference history (thesis_references changes)
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
      // Use joined user data first, fall back to lookup
      const userName = h.user
        ? `${h.user.first_name || ''} ${h.user.last_name || ''}`.trim() || 'Unknown'
        : (userLookup[h.changed_by]?.name || 'Unknown')
      const isCovering = coveringIds.has(h.changed_by)

      allEvents.push({
        id: h.id,
        type: h.contribution?.section || 'thesis',
        timestamp: new Date(h.changed_at),
        userId: h.changed_by,
        userName,
        isCovering,
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

    // Add reference (supporting docs) events
    referenceHistory.forEach((rh: any) => {
      const userInfo = userLookup[rh.changed_by] || { name: 'Unknown', isCovering: false }

      allEvents.push({
        id: `ref-${rh.id}`,
        type: 'reference',
        timestamp: new Date(rh.changed_at),
        userId: rh.changed_by,
        userName: userInfo.name,
        isCovering: userInfo.isCovering,
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
  }, [contributionHistory, contributions, priceTargetHistory, referenceHistory, userLookup, coveringIds, viewFilter])

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
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className={clsx('text-center py-4', className)}>
        <p className="text-sm text-gray-400">No history yet</p>
      </div>
    )
  }

  return (
    <div className={clsx('', className)}>
      {/* Filter buttons */}
      <div className="flex items-center gap-1 mb-3 flex-wrap">
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

      {/* Events */}
      {filteredEvents.length > 0 ? (
        filteredEvents.map(event => (
          <TimelineEvent key={event.id} event={event} />
        ))
      ) : (
        <p className="text-sm text-gray-400 text-center py-2">No {typeFilter.replace('_', ' ')} changes</p>
      )}
    </div>
  )
}
