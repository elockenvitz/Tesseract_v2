/**
 * AssetRunDetailPanel
 *
 * Asset-scoped run detail view (extracted from RunDetailPanel).
 * Shows "X Assets Remaining" metric + filterable, sortable asset table.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Filter, Inbox, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
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

export interface AssetRunDetailPanelProps {
  branchId: string
  workflowStages: WorkflowStage[]
  userId: string
  onNavigate?: (result: { id: string; title: string; type: string; data?: any }) => void
  isRunEnded?: boolean
}

type FilterMode = 'in_progress' | 'mine' | 'completed'
type SortKey = 'symbol' | 'name' | 'stage' | 'status'
type SortDir = 'asc' | 'desc' | null

export function AssetRunDetailPanel({
  branchId,
  workflowStages,
  userId,
  onNavigate,
  isRunEnded = false,
}: AssetRunDetailPanelProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('in_progress')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const queryClient = useQueryClient()

  const { data: progressRecords = [], isLoading: isLoadingProgress } = useQuery({
    queryKey: ['run-detail-assets', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_workflow_progress')
        .select(`
          id, asset_id, workflow_id, current_stage_key,
          is_completed, completed_at, is_started, started_at,
          asset:asset_id ( id, symbol, company_name, sector )
        `)
        .eq('workflow_id', branchId)
      if (error) throw error
      return data || []
    },
    enabled: !!branchId,
    staleTime: 1000 * 60 * 1,
  })

  const { data: coverageData = [] } = useQuery({
    queryKey: ['user-coverage', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('asset_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('asset_id', { ascending: true })
      if (error) return []
      return data || []
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  })

  const coverageAssetIds = useMemo(
    () => new Set(coverageData.map(c => c.asset_id)),
    [coverageData]
  )

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

  const totalAssets = progressRecords.length
  const completedAssets = progressRecords.filter(r => r.is_completed).length
  const remainingAssets = totalAssets - completedAssets

  const filteredAssets = useMemo(() => {
    switch (filterMode) {
      case 'completed':
        return progressRecords.filter(r => r.is_completed)
      case 'mine':
        return progressRecords.filter(r => !r.is_completed && coverageAssetIds.has(r.asset_id))
      case 'in_progress':
      default:
        return progressRecords.filter(r => !r.is_completed)
    }
  }, [progressRecords, filterMode, coverageAssetIds])

  const sortedAssets = useMemo(() => {
    if (!sortKey || !sortDir) return filteredAssets
    return [...filteredAssets].sort((a, b) => {
      const assetA = a.asset as any
      const assetB = b.asset as any
      let cmp = 0
      switch (sortKey) {
        case 'symbol':
          cmp = (assetA?.symbol || '').localeCompare(assetB?.symbol || '')
          break
        case 'name':
          cmp = (assetA?.company_name || '').localeCompare(assetB?.company_name || '')
          break
        case 'stage': {
          const stageA = stageMap.get(a.current_stage_key)
          const stageB = stageMap.get(b.current_stage_key)
          cmp = (stageA?.sort_order ?? -1) - (stageB?.sort_order ?? -1)
          break
        }
        case 'status':
          cmp = (a.is_started ? 1 : 0) - (b.is_started ? 1 : 0)
          break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [filteredAssets, sortKey, sortDir, stageMap])

  const mineCount = useMemo(
    () => progressRecords.filter(r => !r.is_completed && coverageAssetIds.has(r.asset_id)).length,
    [progressRecords, coverageAssetIds]
  )

  const markCompleteMutation = useMutation({
    mutationFn: async (progressId: string) => {
      const { error } = await supabase
        .from('asset_workflow_progress')
        .update({ is_completed: true, completed_at: new Date().toISOString() })
        .eq('id', progressId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run-detail-assets', branchId] })
      queryClient.invalidateQueries({ queryKey: ['active-runs'] })
    },
  })

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc') }
    else if (sortDir === 'asc') { setSortDir('desc') }
    else { setSortKey(null); setSortDir(null) }
  }, [sortKey, sortDir])

  const handleAssetClick = useCallback((record: any) => {
    const asset = record.asset as any
    if (!asset?.id || !onNavigate) return
    onNavigate({
      id: asset.id,
      title: asset.symbol || asset.company_name || 'Asset',
      type: 'asset',
      data: { ...asset, data: { workflowId: branchId } },
    })
  }, [onNavigate, branchId])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col || !sortDir) return <ChevronsUpDown className="w-3 h-3 text-gray-300" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-gray-600" />
      : <ChevronDown className="w-3 h-3 text-gray-600" />
  }

  const thClass = 'text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors'

  return (
    <>
      {/* Big metric card */}
      <Card className="bg-white">
        <div className="p-6 text-center">
          {totalAssets === 0 ? (
            <>
              <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <div className="text-sm font-medium text-gray-600">No assets assigned</div>
              <div className="text-xs text-gray-400 mt-1">
                Add assets from the process universe to start tracking progress.
              </div>
            </>
          ) : (
            <>
              <div className="text-4xl font-bold text-gray-900">{isRunEnded ? completedAssets : remainingAssets}</div>
              <div className="text-sm text-gray-500 mt-1">{isRunEnded ? 'Assets Completed' : 'Assets Remaining'}</div>
              <div className="text-xs text-gray-400 mt-1">
                {isRunEnded ? `${remainingAssets} not completed` : `${completedAssets} completed`} &middot; {totalAssets} total
              </div>
              <div className="mt-3 max-w-xs mx-auto">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${Math.round((completedAssets / totalAssets) * 100)}%` }}
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
          { mode: 'in_progress' as FilterMode, label: isRunEnded ? 'Not Completed' : 'In Progress', count: remainingAssets },
          ...(!isRunEnded ? [{ mode: 'mine' as FilterMode, label: 'Mine', count: mineCount }] : []),
          { mode: 'completed' as FilterMode, label: 'Completed', count: completedAssets },
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

      {/* Asset table */}
      <Card>
        <div className="overflow-x-auto">
          {isLoadingProgress ? (
            <div className="p-6 animate-pulse space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center space-x-4">
                  <div className="h-4 bg-gray-200 rounded w-16" />
                  <div className="h-4 bg-gray-200 rounded w-40" />
                  <div className="h-4 bg-gray-200 rounded w-20" />
                  <div className="h-4 bg-gray-200 rounded w-24" />
                </div>
              ))}
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Filter className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm font-medium text-gray-600">
                {filterMode === 'in_progress'
                  ? 'All assets completed'
                  : filterMode === 'mine'
                  ? 'No remaining assets in your coverage'
                  : 'No completed assets yet'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className={thClass} onClick={() => handleSort('symbol')}>
                    <span className="inline-flex items-center gap-1">Symbol <SortIcon col="symbol" /></span>
                  </th>
                  <th className={thClass} onClick={() => handleSort('name')}>
                    <span className="inline-flex items-center gap-1">Name <SortIcon col="name" /></span>
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
                {sortedAssets.map((record: any) => {
                  const asset = record.asset as any
                  const stage = stageMap.get(record.current_stage_key)
                  return (
                    <tr
                      key={record.id}
                      className={`border-b border-gray-100 hover:bg-gray-50 ${onNavigate ? 'cursor-pointer' : ''}`}
                      onClick={() => handleAssetClick(record)}
                    >
                      <td className="py-2.5 px-4 font-medium text-gray-900">{asset?.symbol || '—'}</td>
                      <td className="py-2.5 px-4 text-gray-600 truncate max-w-[200px]">{asset?.company_name || '—'}</td>
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
                          onClick={(e) => { e.stopPropagation(); markCompleteMutation.mutate(record.id) }}
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
