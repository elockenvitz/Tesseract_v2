/**
 * ProposalQuickModal
 *
 * Quick-launch wrapper for creating a proposal from the Ideas pane.
 * Step 1: Select a trade idea from the current context.
 * Step 2 (embedded): Opens inline ProposalIdeaReviewPane.
 * Step 2 (modal):    Opens the existing ProposalEditorModal.
 */

import { useState, useEffect, useMemo } from 'react'
import { X, FileText, ChevronRight, Search, TrendingUp, ArrowRightLeft } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { ProposalEditorModal } from '../trading/ProposalEditorModal'
import { ProposalIdeaReviewPane } from './ProposalIdeaReviewPane'
import type { TradeQueueItemWithDetails } from '../../types/trading'
import type { CapturedContext } from './ContextSelector'

interface ProposalQuickModalProps {
  isOpen: boolean
  onClose: () => void
  context?: CapturedContext | null
  /** When true, renders as an inline form (no modal overlay) */
  embedded?: boolean
}

const ACTION_COLORS: Record<string, string> = {
  buy: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400',
  add: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400',
  sell: 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400',
  trim: 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400',
}

/** Status sort priority: deciding first, then simulating, then idea */
const STATUS_SORT_ORDER: Record<string, number> = {
  deciding: 0,
  simulating: 1,
  idea: 2,
}

/** A display row — either a single trade idea or a grouped pair trade */
interface DisplayRow {
  key: string
  isPair: boolean
  /** The first leg (used when selecting for ProposalEditorModal) */
  primaryIdea: TradeQueueItemWithDetails
  status: string
  /** For single ideas */
  action?: string
  symbol?: string
  name?: string
  /** For pair trades — legs grouped by action */
  legs?: { action: string; symbols: string[] }[]
  /** Total number of legs in a pair trade */
  legCount?: number
}

export function ProposalQuickModal({ isOpen, onClose, context, embedded = false }: ProposalQuickModalProps) {
  const { user } = useAuth()
  const [selectedIdea, setSelectedIdea] = useState<TradeQueueItemWithDetails | null>(null)
  const [search, setSearch] = useState('')

  // Reset when reopening
  useEffect(() => {
    if (isOpen) {
      setSelectedIdea(null)
      setSearch('')
    }
  }, [isOpen])

  // Fetch trade ideas the user can propose on
  const { data: tradeIdeas = [], isLoading } = useQuery({
    queryKey: ['trade-ideas-for-proposal', user?.id, 'v2'],
    queryFn: async () => {
      if (!user?.id) return []

      const query = supabase
        .from('trade_queue_items')
        .select(`
          id, action, urgency, status, stage, created_at, pair_id,
          asset:assets(id, symbol, company_name, sector)
        `)
        .in('stage', ['idea', 'simulating', 'deciding'])
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50)

      const { data, error } = await query
      if (error) {
        console.error('Failed to fetch trade ideas:', error)
        return []
      }
      return (data || []) as unknown as (TradeQueueItemWithDetails & { pair_id?: string | null })[]
    },
    enabled: isOpen && !!user?.id,
  })

  // Group pair trades into single display rows
  const displayRows = useMemo<DisplayRow[]>(() => {
    const ideas = tradeIdeas as (TradeQueueItemWithDetails & { pair_id?: string | null })[]
    const pairMap = new Map<string, typeof ideas>()
    const singles: typeof ideas = []

    for (const idea of ideas) {
      if (idea.pair_id) {
        const group = pairMap.get(idea.pair_id) || []
        group.push(idea)
        pairMap.set(idea.pair_id, group)
      } else {
        singles.push(idea)
      }
    }

    const rows: DisplayRow[] = []

    // Add pair trade rows
    for (const [pairId, legs] of pairMap) {
      // Group legs by action
      const byAction = new Map<string, string[]>()
      for (const leg of legs) {
        const asset = leg.asset as any
        const symbol = asset?.symbol || 'Unknown'
        const action = leg.action
        const list = byAction.get(action) || []
        // Deduplicate symbols within the same action
        if (!list.includes(symbol)) list.push(symbol)
        byAction.set(action, list)
      }

      const legGroups = Array.from(byAction.entries()).map(([action, symbols]) => ({
        action,
        symbols,
      }))

      rows.push({
        key: `pair-${pairId}`,
        isPair: true,
        primaryIdea: legs[0],
        status: legs[0].stage || legs[0].status,
        legs: legGroups,
        legCount: legs.length,
      })
    }

    // Add single trade rows
    for (const idea of singles) {
      const asset = idea.asset as any
      rows.push({
        key: idea.id,
        isPair: false,
        primaryIdea: idea,
        status: idea.stage || idea.status,
        action: idea.action,
        symbol: asset?.symbol || 'Unknown',
        name: asset?.company_name || '',
      })
    }

    // Sort: deciding → simulating → idea
    rows.sort((a, b) => (STATUS_SORT_ORDER[a.status] ?? 9) - (STATUS_SORT_ORDER[b.status] ?? 9))

    return rows
  }, [tradeIdeas])

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return displayRows
    const q = search.toLowerCase()
    return displayRows.filter(row => {
      if (row.isPair && row.legs) {
        return row.legs.some(leg => leg.symbols.some(s => s.toLowerCase().includes(q)))
      }
      return (row.symbol || '').toLowerCase().includes(q) || (row.name || '').toLowerCase().includes(q)
    })
  }, [displayRows, search])

  if (!isOpen) return null

  // Step 2: If a trade idea is selected, branch by mode
  if (selectedIdea) {
    // Embedded mode → inline review pane (no modal)
    if (embedded) {
      return (
        <ProposalIdeaReviewPane
          tradeIdea={selectedIdea}
          onBack={() => setSelectedIdea(null)}
          onClose={onClose}
        />
      )
    }

    // Modal mode → full ProposalEditorModal
    return (
      <ProposalEditorModal
        isOpen={true}
        onClose={() => {
          setSelectedIdea(null)
          onClose()
        }}
        tradeIdea={selectedIdea}
        onSaved={() => {
          setSelectedIdea(null)
          onClose()
        }}
      />
    )
  }

  // -- Shared selector content --
  const selectorContent = (
    <>
      {/* Search */}
      <div className={embedded ? 'mb-2' : 'px-5 py-3 border-b border-gray-100 dark:border-gray-700'}>
        {!embedded && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            Select a trade idea to build your proposal on.
          </p>
        )}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by symbol or name..."
            autoFocus
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Trade ideas list */}
      <div className={embedded ? 'overflow-y-auto -mx-1' : 'flex-1 overflow-y-auto px-2 py-2'}>
        {isLoading ? (
          <div className="space-y-2 px-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-3 py-3">
                <div className="w-10 h-5 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center">
            <TrendingUp className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {search ? 'No matching trade ideas' : 'No active trade ideas'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map(row => {
              if (row.isPair && row.legs) {
                // Pair trade row
                return (
                  <button
                    key={row.key}
                    onClick={() => setSelectedIdea(row.primaryIdea)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left group"
                  >
                    <ArrowRightLeft className="h-4 w-4 text-violet-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {row.legs.map(leg => (
                          <span key={leg.action} className="inline-flex items-center gap-1">
                            <span className={`text-[10px] font-bold uppercase px-1 py-0 rounded ${ACTION_COLORS[leg.action] || 'text-gray-500 bg-gray-100'}`}>
                              {leg.action}
                            </span>
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              {leg.symbols.join(', ')}
                            </span>
                          </span>
                        ))}
                      </div>
                      {row.legCount && row.legCount > 1 && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                          Multi-asset · {row.legCount} legs
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 capitalize">{row.status}</span>
                    <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </button>
                )
              }

              // Single trade row
              return (
                <button
                  key={row.key}
                  onClick={() => setSelectedIdea(row.primaryIdea)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left group"
                >
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${ACTION_COLORS[row.action || ''] || 'text-gray-500 bg-gray-100'}`}>
                    {row.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {row.symbol}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {row.name}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 capitalize">{row.status}</span>
                  <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )

  // -- Embedded mode: plain content, no overlay --
  if (embedded) {
    return selectorContent
  }

  // -- Modal mode --
  // Step 1: Trade idea selector
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Create Proposal
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {selectorContent}
      </div>
    </div>
  )
}
