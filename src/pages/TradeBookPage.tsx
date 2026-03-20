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

import { useState, useCallback } from 'react'
import { BookOpen, Layers, List } from 'lucide-react'
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

export function TradeBookPage() {
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

  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | undefined>(undefined)
  const portfolioId = selectedPortfolioId || portfolios[0]?.id

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
          <select
            value={portfolioId || ''}
            onChange={e => setSelectedPortfolioId(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            {portfolios.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.portfolio_id || p.name}
              </option>
            ))}
          </select>
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
