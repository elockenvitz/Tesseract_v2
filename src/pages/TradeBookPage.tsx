/**
 * TradeBookPage — Top-level page for the Trade Book.
 *
 * The SOLE canonical committed-trade surface. All committed trades live here.
 * Two views:
 *   - Trades: individual accepted trades with execution tracking
 *   - Batches: grouped trades with approval workflow (replaces old Trade Plans)
 *
 * trade_batches are the approval/grouping layer. Do not reintroduce Trade Plans.
 * Trade Sheets are snapshot artifacts only and must not mutate decision state.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { BookOpen, Layers, List, Briefcase, ChevronDown, Search, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAcceptedTrades, useTradeBatches } from '../hooks/useAcceptedTrades'
import { AcceptedTradesTable } from '../components/trading/AcceptedTradesTable'
import { BatchListView } from '../components/trading/BatchListView'
import type { ExecutionStatus, ActionContext, TradeAction } from '../types/trading'

// ---------------------------------------------------------------------------
// View toggle type
// ---------------------------------------------------------------------------

type BookView = 'trades' | 'batches'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TradeBookPageProps {
  initialPortfolioId?: string
}

export function TradeBookPage({ initialPortfolioId }: TradeBookPageProps = {}) {
  const { user } = useAuth()
  const [view, setView] = useState<BookView>('trades')
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)

  // Portfolio selector
  const { data: portfolios = [] } = useQuery({
    queryKey: ['portfolios-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('portfolios')
        .select('id, name, portfolio_id')
        .order('name')
      return data || []
    },
    staleTime: 60_000,
  })

  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | undefined>(initialPortfolioId)
  const portfolioId = selectedPortfolioId || portfolios[0]?.id
  const [portfolioDropdownOpen, setPortfolioDropdownOpen] = useState(false)
  const [portfolioSearch, setPortfolioSearch] = useState('')
  const portfolioDropdownRef = useRef<HTMLDivElement>(null)
  const portfolioSearchRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!portfolioDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (portfolioDropdownRef.current && !portfolioDropdownRef.current.contains(e.target as Node)) {
        setPortfolioDropdownOpen(false)
        setPortfolioSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [portfolioDropdownOpen])

  // Auto-focus search on open
  useEffect(() => {
    if (portfolioDropdownOpen) portfolioSearchRef.current?.focus()
  }, [portfolioDropdownOpen])

  const filteredPortfolios = portfolios.filter((p: any) => {
    if (!portfolioSearch) return true
    const q = portfolioSearch.toLowerCase()
    return p.name?.toLowerCase().includes(q) || p.portfolio_id?.toLowerCase().includes(q)
  })

  // Fetch user's role for this portfolio
  const { data: userRole } = useQuery({
    queryKey: ['user-portfolio-role', user?.id, portfolioId],
    queryFn: async () => {
      if (!user?.id || !portfolioId) return null
      const { data } = await supabase
        .from('portfolio_team')
        .select('role')
        .eq('user_id', user.id)
        .eq('portfolio_id', portfolioId)
        .maybeSingle()
      return data?.role as string | null
    },
    enabled: !!user?.id && !!portfolioId,
    staleTime: 60_000,
  })

  const {
    trades,
    isLoading,
    updateExecutionStatus,
    updateSizing,
    revert,
    addComment,
  } = useAcceptedTrades(portfolioId)

  const { batches } = useTradeBatches(portfolioId)

  // Role-based permissions
  const isPM = userRole === 'pm' || userRole === 'admin'
  const isTrader = userRole === 'trader'
  const canEdit = isPM
  const canUpdateExecution = isPM || isTrader
  const canRevert = isPM

  const getContext = useCallback((): ActionContext => ({
    actorId: user!.id,
    actorName: (user as any)?.first_name || user?.email || 'User',
    actorRole: 'pm',
    requestId: `trade-book-${Date.now()}`,
  }), [user])

  const handleUpdateExecutionStatus = useCallback(
    (id: string, status: ExecutionStatus, note: string | null, context: ActionContext) => {
      updateExecutionStatus({ id, status, note, context })
    },
    [updateExecutionStatus]
  )

  const handleUpdateSizing = useCallback(
    (id: string, updates: { sizing_input?: string; action?: TradeAction }, context: ActionContext) => {
      updateSizing({ id, updates, context })
    },
    [updateSizing]
  )

  const handleRevert = useCallback(
    (id: string, reason: string, context: ActionContext) => {
      revert({ id, reason, context })
    },
    [revert]
  )

  const handleAddComment = useCallback(
    (tradeId: string, content: string) => {
      if (!user) return
      addComment({ tradeId, userId: user.id, content })
    },
    [user, addComment]
  )

  const handleSelectBatch = useCallback((batchId: string | null) => {
    setSelectedBatchId(batchId)
  }, [])

  // "View Trades" from batch detail → switch to Trades view filtered to that batch
  const handleViewBatchTrades = useCallback((batchId: string) => {
    setSelectedBatchId(batchId)
    setView('trades')
  }, [])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Trade Book</h1>

          {/* View toggle */}
          <div className="flex items-center ml-4 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => setView('trades')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                view === 'trades'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <List className="w-3.5 h-3.5" />
              Trades
            </button>
            <button
              onClick={() => setView('batches')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                view === 'batches'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              Batches
              {batches.length > 0 && (
                <span className={clsx(
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                  view === 'batches'
                    ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400'
                    : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                )}>
                  {batches.length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Portfolio selector */}
          <div className="relative" ref={portfolioDropdownRef}>
            <button
              onClick={() => setPortfolioDropdownOpen(!portfolioDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
            >
              <Briefcase className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="text-gray-900 dark:text-white font-medium">
                {portfolios.find((p: any) => p.id === portfolioId)?.name || 'Select portfolio'}
              </span>
              <ChevronDown className={clsx("h-4 w-4 text-gray-400 transition-transform", portfolioDropdownOpen && "rotate-180")} />
            </button>

            {portfolioDropdownOpen && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 overflow-hidden">
                {/* Search */}
                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      ref={portfolioSearchRef}
                      type="text"
                      value={portfolioSearch}
                      onChange={e => setPortfolioSearch(e.target.value)}
                      placeholder="Search portfolios..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
                {/* List */}
                <div className="max-h-64 overflow-y-auto">
                  {filteredPortfolios.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">No portfolios found</div>
                  ) : (
                    filteredPortfolios.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPortfolioId(p.id)
                          setPortfolioDropdownOpen(false)
                          setPortfolioSearch('')
                        }}
                        className={clsx(
                          "w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors",
                          p.id === portfolioId
                            ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                            : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        )}
                      >
                        <Briefcase className={clsx("h-4 w-4 flex-shrink-0", p.id === portfolioId ? "text-primary-500" : "text-gray-400")} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{p.name}</div>
                          {p.portfolio_id && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{p.portfolio_id}</div>
                          )}
                        </div>
                        {p.id === portfolioId && <Check className="h-4 w-4 text-primary-500 flex-shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : view === 'batches' ? (
          <BatchListView
            batches={batches}
            trades={trades}
            selectedBatchId={selectedBatchId}
            onSelectBatch={handleSelectBatch}
            onViewBatchTrades={handleViewBatchTrades}
          />
        ) : (
          <AcceptedTradesTable
            trades={trades}
            batches={batches}
            initialBatchFilter={selectedBatchId}
            onUpdateExecutionStatus={handleUpdateExecutionStatus}
            onUpdateSizing={handleUpdateSizing}
            onRevert={handleRevert}
            onAddComment={handleAddComment}
            canEdit={canEdit}
            canUpdateExecution={canUpdateExecution}
            canRevert={canRevert}
          />
        )}
      </div>
    </div>
  )
}
