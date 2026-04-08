/**
 * PortfolioRunDetailPanel
 *
 * Portfolio-scoped run detail view.
 * Shows "X Portfolios Remaining" metric + sortable portfolio table.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Inbox, ChevronUp, ChevronDown, ChevronsUpDown, Filter } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { Badge } from '../../ui/Badge'

interface WorkflowStage {
  id: string
  stage_key: string
  stage_label: string
  stage_color: string
  sort_order: number
}

export interface PortfolioRunDetailPanelProps {
  branchId: string
  workflowStages: WorkflowStage[]
  onNavigateToPortfolio?: (portfolioId: string, portfolioName: string, portfolioMnemonic?: string) => void
  isRunEnded?: boolean
}

type FilterMode = 'in_progress' | 'completed'
type SortKey = 'name' | 'stage' | 'status'
type SortDir = 'asc' | 'desc' | null

export function PortfolioRunDetailPanel({
  branchId,
  workflowStages,
  onNavigateToPortfolio,
  isRunEnded = false,
}: PortfolioRunDetailPanelProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('in_progress')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const queryClient = useQueryClient()

  const { data: progressRecords = [], isLoading } = useQuery({
    queryKey: ['run-detail-portfolios', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_workflow_progress')
        .select(`
          id, portfolio_id, workflow_id, current_stage_key,
          is_completed, completed_at, is_started, started_at,
          portfolio:portfolios!portfolio_workflow_progress_portfolio_id_fkey( id, name, portfolio_id )
        `)
        .eq('workflow_id', branchId)
      if (error) throw error
      return data || []
    },
    enabled: !!branchId,
    staleTime: 1000 * 60 * 1,
  })

  const finalStageKey = useMemo(() => {
    if (workflowStages.length === 0) return null
    const sorted = [...workflowStages].sort((a, b) => b.sort_order - a.sort_order)
    return sorted[0]?.stage_key || null
  }, [workflowStages])

  const stageMap = useMemo(() => {
    const map = new Map<string, WorkflowStage>()
    workflowStages.forEach(s => map.set(s.stage_key, s))
    return map
  }, [workflowStages])

  const total = progressRecords.length
  const completed = progressRecords.filter(r => r.is_completed).length
  const remaining = total - completed

  const filtered = useMemo(() => {
    if (filterMode === 'completed') {
      return progressRecords.filter(r => r.is_completed)
    }
    return progressRecords.filter(r => !r.is_completed)
  }, [progressRecords, filterMode])

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered
    return [...filtered].sort((a, b) => {
      const pA = a.portfolio as any
      const pB = b.portfolio as any
      let cmp = 0
      switch (sortKey) {
        case 'name':
          cmp = (pA?.name || '').localeCompare(pB?.name || '')
          break
        case 'stage': {
          const sA = stageMap.get(a.current_stage_key)
          const sB = stageMap.get(b.current_stage_key)
          cmp = (sA?.sort_order ?? -1) - (sB?.sort_order ?? -1)
          break
        }
        case 'status':
          cmp = (a.is_started ? 1 : 0) - (b.is_started ? 1 : 0)
          break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [filtered, sortKey, sortDir, stageMap])

  const markCompleteMutation = useMutation({
    mutationFn: async (progressId: string) => {
      const { error } = await supabase
        .from('portfolio_workflow_progress')
        .update({ is_completed: true, completed_at: new Date().toISOString() })
        .eq('id', progressId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run-detail-portfolios', branchId] })
      queryClient.invalidateQueries({ queryKey: ['active-runs'] })
    },
  })

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc') }
    else if (sortDir === 'asc') { setSortDir('desc') }
    else { setSortKey(null); setSortDir(null) }
  }, [sortKey, sortDir])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col || !sortDir) return <ChevronsUpDown className="w-3 h-3 text-gray-300" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-gray-600" />
      : <ChevronDown className="w-3 h-3 text-gray-600" />
  }

  const thClass = 'text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors'

  return (
    <>
      <Card className="bg-white">
        <div className="p-6 text-center">
          {total === 0 ? (
            <>
              <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <div className="text-sm font-medium text-gray-600">No portfolios assigned</div>
              <div className="text-xs text-gray-400 mt-1">
                Configure portfolio selections in the process template.
              </div>
            </>
          ) : (
            <>
              <div className="text-4xl font-bold text-gray-900">{isRunEnded ? completed : remaining}</div>
              <div className="text-sm text-gray-500 mt-1">{isRunEnded ? 'Portfolios Completed' : 'Portfolios Remaining'}</div>
              <div className="text-xs text-gray-400 mt-1">
                {isRunEnded ? `${remaining} not completed` : `${completed} completed`} &middot; {total} total
              </div>
              <div className="mt-3 max-w-xs mx-auto">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${total > 0 ? Math.round((completed / total) * 100) : 0}%` }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Filter tabs */}
      <div className="flex items-center space-x-2">
        {([
          { mode: 'in_progress' as FilterMode, label: isRunEnded ? 'Not Completed' : 'In Progress', count: remaining },
          { mode: 'completed' as FilterMode, label: 'Completed', count: completed },
        ]).map(tab => (
          <button
            key={tab.mode}
            onClick={() => setFilterMode(tab.mode)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filterMode === tab.mode
                ? 'bg-blue-100 text-blue-800 font-medium'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 animate-pulse space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center space-x-4">
                  <div className="h-4 bg-gray-200 rounded w-40" />
                  <div className="h-4 bg-gray-200 rounded w-20" />
                  <div className="h-4 bg-gray-200 rounded w-24" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Filter className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm font-medium text-gray-600">
                {filterMode === 'in_progress' ? 'All portfolios completed' : 'No completed portfolios yet'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className={thClass} onClick={() => handleSort('name')}>
                    <span className="inline-flex items-center gap-1">Portfolio <SortIcon col="name" /></span>
                  </th>
                  <th className={thClass} onClick={() => handleSort('stage')}>
                    <span className="inline-flex items-center gap-1">Stage <SortIcon col="stage" /></span>
                  </th>
                  <th className={thClass} onClick={() => handleSort('status')}>
                    <span className="inline-flex items-center gap-1">Status <SortIcon col="status" /></span>
                  </th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((record: any) => {
                  const portfolio = record.portfolio as any
                  const stage = stageMap.get(record.current_stage_key)
                  return (
                    <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-medium text-gray-900">
                        {onNavigateToPortfolio && portfolio?.id ? (
                          <button
                            onClick={() => onNavigateToPortfolio(portfolio.id, portfolio.name || 'Portfolio', portfolio.portfolio_id)}
                            className="hover:text-blue-600 transition-colors text-left"
                          >
                            {portfolio.name || '—'}
                          </button>
                        ) : (
                          portfolio?.name || '—'
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        {stage ? (
                          <Badge variant="outline" className="text-xs py-0" style={{ borderColor: stage.stage_color, color: stage.stage_color }}>
                            {stage.stage_label}
                          </Badge>
                        ) : (
                          <span className="text-gray-400 text-xs">{record.current_stage_key || 'Not started'}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`text-xs ${record.is_started ? 'text-blue-600' : 'text-gray-400'}`}>
                          {isRunEnded ? 'Not Completed' : (record.is_started ? 'In Progress' : 'Pending')}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {!isRunEnded && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markCompleteMutation.mutate(record.id)}
                          disabled={markCompleteMutation.isPending}
                          className="text-xs"
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Complete
                        </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </>
  )
}
