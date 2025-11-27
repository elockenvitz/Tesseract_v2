import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp, Filter, SortDesc, ChevronRight, Activity,
  Target, LayoutGrid, List, ListOrdered, Layers, BarChart3,
  Clock, CheckCircle2, Circle, AlertCircle, RefreshCw
} from 'lucide-react'
import { priorityConfig } from '../utils/priorityBadge'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { TabStateManager } from '../lib/tabStateManager'

interface PrioritizerPageProps {
  onItemSelect?: (item: any) => void
}

interface WorkflowAsset {
  id: string
  symbol: string
  company_name: string
  stage: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  last_updated: string
  assigned_to?: string
  due_date?: string
  progress_percentage: number
  is_started: boolean
  completeness: number
  workflow_id?: string
  workflow_name?: string
}

interface Workflow {
  id: string
  name: string
  color: string
  description?: string
}

type PrioritizerView = 'all' | 'in-progress' | 'by-stage' | 'by-priority' | 'by-workflow'
type SortField = 'priority' | 'stage' | 'updated' | 'symbol' | 'progress' | 'completeness'

export function PrioritizerPage({ onItemSelect }: PrioritizerPageProps) {
  // Load initial state from TabStateManager
  const loadedState = TabStateManager.loadTabState('prioritizer')

  // View and filtering state
  const [prioritizerView, setPrioritizerView] = useState<PrioritizerView>(loadedState?.prioritizerView || 'all')
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(loadedState?.selectedWorkflow || null)
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [sortBy, setSortBy] = useState<SortField>(loadedState?.sortBy || 'updated')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(loadedState?.sortOrder || 'desc')
  const [filterByStatus, setFilterByStatus] = useState<'all' | 'in-progress' | 'not-started'>(loadedState?.filterByStatus || 'all')
  const [filterByPriority, setFilterByPriority] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>(loadedState?.filterByPriority || 'all')
  const [filterByStage, setFilterByStage] = useState<string>(loadedState?.filterByStage || 'all')

  // Fetch workflows and their assets
  const { data: workflowData, isLoading: workflowLoading, refetch: refetchWorkflowData } = useQuery({
    queryKey: ['prioritizer-page-workflows'],
    queryFn: async () => {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      if (!userId) return { workflows: [], workflowAssets: {} }

      // Get workflows
      const { data: workflows, error: workflowError } = await supabase
        .from('workflows')
        .select('*')
        .or(`is_public.eq.true,created_by.eq.${userId}`)
        .order('name')

      if (workflowError) throw workflowError

      // Get assets in progress for each workflow
      const workflowAssets: Record<string, WorkflowAsset[]> = {}

      for (const workflow of workflows || []) {
        // First get the workflow stages to calculate progress and get display names
        const { data: workflowStages, error: stagesError } = await supabase
          .from('workflow_stages')
          .select('stage_key, stage_label, sort_order')
          .eq('workflow_id', workflow.id)
          .order('sort_order')

        if (stagesError) continue

        // Create a map for stage position lookup
        const stagePositions = new Map()
        workflowStages?.forEach((stage, index) => {
          stagePositions.set(stage.stage_key, index)
        })
        const totalStages = workflowStages?.length || 1

        // Get only ACTIVE workflow progress assets (is_started = true and not completed)
        const { data: progressAssets, error: progressError } = await supabase
          .from('asset_workflow_progress')
          .select(`
            *,
            assets(id, symbol, company_name, priority, completeness)
          `)
          .eq('workflow_id', workflow.id)
          .eq('is_started', true)
          .eq('is_completed', false)
          .order('asset_id')
          .order('updated_at', { ascending: false })

        if (progressError) continue

        // Get workflow-specific priorities for these assets
        const assetIds = progressAssets?.map(a => a.assets.id) || []
        let workflowPriorities: any[] = []

        if (assetIds.length > 0) {
          const { data: priorities, error: prioritiesError } = await supabase
            .from('asset_workflow_priorities')
            .select('asset_id, priority')
            .eq('workflow_id', workflow.id)
            .in('asset_id', assetIds)

          if (!prioritiesError) {
            workflowPriorities = priorities || []
          }
        }

        // Deduplicate assets - keep the most recent entry for each asset
        const deduplicatedAssets = progressAssets ?
          Object.values(
            progressAssets.reduce((acc, asset) => {
              const assetId = asset.assets.id
              const currentEntry = acc[assetId]
              const shouldReplace = !currentEntry || new Date(asset.updated_at) > new Date(currentEntry.updated_at)

              if (shouldReplace) {
                acc[assetId] = asset
              }
              return acc
            }, {} as Record<string, any>)
          ) : []

        if (deduplicatedAssets.length > 0) {
          workflowAssets[workflow.id] = deduplicatedAssets.map(asset => {
            const workflowPriority = workflowPriorities.find(p => p.asset_id === asset.assets.id)
            const currentStageIndex = stagePositions.get(asset.current_stage_key) ?? 0
            const stageProgressPercentage = Math.round((currentStageIndex / totalStages) * 100)
            const progressPercentage = asset.is_started ? stageProgressPercentage : 0
            const stageDisplayName = workflowStages?.find(s => s.stage_key === asset.current_stage_key)?.stage_label
            const stageName = stageDisplayName || asset.current_stage_key || 'Not Started'

            return {
              id: asset.assets.id,
              symbol: asset.assets.symbol,
              company_name: asset.assets.company_name,
              stage: stageName,
              priority: workflowPriority?.priority || asset.assets.priority || 'medium',
              last_updated: asset.updated_at,
              progress_percentage: progressPercentage,
              is_started: asset.is_started,
              completeness: asset.assets.completeness || 0,
              workflow_id: workflow.id,
              workflow_name: workflow.name
            }
          })
        }
      }

      return { workflows: workflows || [], workflowAssets }
    },
    staleTime: 5000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  })

  // Save state to TabStateManager whenever key state changes
  useEffect(() => {
    const stateToSave = {
      prioritizerView,
      selectedWorkflow,
      sortBy,
      sortOrder,
      filterByStatus,
      filterByPriority,
      filterByStage
    }
    TabStateManager.saveTabState('prioritizer', stateToSave)
  }, [prioritizerView, selectedWorkflow, sortBy, sortOrder, filterByStatus, filterByPriority, filterByStage])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showFilterDropdown) {
        const target = event.target as HTMLElement
        if (!target.closest('.filter-dropdown')) {
          setShowFilterDropdown(false)
        }
      }
      if (showSortDropdown) {
        const target = event.target as HTMLElement
        if (!target.closest('.sort-dropdown')) {
          setShowSortDropdown(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFilterDropdown, showSortDropdown])

  // Get all available stages for filtering
  const getAllStages = () => {
    const stages = new Set<string>()
    Object.values(workflowData?.workflowAssets || {}).forEach(assets => {
      assets.forEach(asset => stages.add(asset.stage))
    })
    return Array.from(stages).sort()
  }

  // Filter and sort assets
  const filterAndSortAssets = (assets: WorkflowAsset[]) => {
    let filtered = [...assets]

    // Apply filters
    if (filterByStatus === 'in-progress') {
      filtered = filtered.filter(asset => asset.is_started)
    } else if (filterByStatus === 'not-started') {
      filtered = filtered.filter(asset => !asset.is_started)
    }

    if (filterByPriority !== 'all') {
      filtered = filtered.filter(asset => asset.priority === filterByPriority)
    }

    if (filterByStage !== 'all') {
      filtered = filtered.filter(asset => asset.stage === filterByStage)
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'priority':
          const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
          comparison = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2)
          break
        case 'stage':
          comparison = a.stage.localeCompare(b.stage)
          break
        case 'updated':
          comparison = new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
          break
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol)
          break
        case 'progress':
          comparison = b.progress_percentage - a.progress_percentage
          break
        case 'completeness':
          comparison = b.completeness - a.completeness
          break
      }
      return sortOrder === 'desc' ? comparison : -comparison
    })

    return filtered
  }

  // Get all assets based on selected workflow
  const getAllAssets = () => {
    if (selectedWorkflow === null) {
      const allAssets: WorkflowAsset[] = []
      Object.entries(workflowData?.workflowAssets || {}).forEach(([workflowId, assets]) => {
        const workflow = workflowData?.workflows.find(w => w.id === workflowId)
        assets.forEach(asset => {
          allAssets.push({
            ...asset,
            workflow_id: workflowId,
            workflow_name: workflow?.name || 'Unknown Workflow'
          })
        })
      })
      return allAssets
    } else {
      return workflowData?.workflowAssets[selectedWorkflow] || []
    }
  }

  // Calculate stats
  const allAssets = getAllAssets()
  const filteredAssets = filterAndSortAssets(allAssets)
  const totalAssets = allAssets.length
  const inProgressCount = allAssets.filter(a => a.is_started).length
  const criticalCount = allAssets.filter(a => a.priority === 'critical').length
  const highPriorityCount = allAssets.filter(a => a.priority === 'high').length

  // Render asset item
  const renderAssetItem = (asset: WorkflowAsset, showWorkflow = false, key?: string) => {
    const workflow = asset.workflow_id
      ? workflowData?.workflows.find(w => w.id === asset.workflow_id)
      : selectedWorkflow
        ? workflowData?.workflows.find(w => w.id === selectedWorkflow)
        : null

    return (
      <div
        key={key || `${asset.id}-${asset.workflow_id || 'default'}`}
        className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
        onClick={() => {
          onItemSelect?.({
            id: asset.id,
            title: asset.symbol,
            type: 'asset',
            data: { ...asset, workflow, workflow_id: workflow?.id }
          })
        }}
      >
        <div className="flex items-center space-x-3">
          <div className={clsx(
            'w-10 h-10 rounded-lg flex items-center justify-center',
            asset.priority === 'critical' && 'bg-red-100 dark:bg-red-900/30',
            asset.priority === 'high' && 'bg-orange-100 dark:bg-orange-900/30',
            asset.priority === 'medium' && 'bg-blue-100 dark:bg-blue-900/30',
            asset.priority === 'low' && 'bg-gray-100 dark:bg-gray-800'
          )}>
            <TrendingUp className={clsx(
              'w-5 h-5',
              asset.priority === 'critical' && 'text-red-600',
              asset.priority === 'high' && 'text-orange-600',
              asset.priority === 'medium' && 'text-blue-600',
              asset.priority === 'low' && 'text-gray-500'
            )} />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-gray-900 dark:text-white">{asset.symbol}</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  priorityConfig[asset.priority as keyof typeof priorityConfig]?.color || priorityConfig['medium'].color
                }`}
              >
                {priorityConfig[asset.priority as keyof typeof priorityConfig]?.label || asset.priority}
              </span>
              {showWorkflow && workflow && (
                <div className="flex items-center space-x-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: workflow.color }}
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{workflow.name}</span>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">{asset.company_name}</p>
            <div className="flex items-center space-x-4 mt-1">
              <div className="flex items-center space-x-1 text-xs text-gray-500">
                <BarChart3 className="w-3 h-3" />
                <span>Progress: {asset.progress_percentage}%</span>
              </div>
              <div className="flex items-center space-x-1 text-xs text-gray-500">
                <Layers className="w-3 h-3" />
                <span>Stage: {asset.stage}</span>
              </div>
              <div className={clsx(
                'flex items-center space-x-1 text-xs font-medium',
                asset.completeness >= 90 ? 'text-green-600' :
                asset.completeness >= 70 ? 'text-blue-600' :
                asset.completeness >= 40 ? 'text-yellow-600' :
                asset.completeness >= 10 ? 'text-orange-600' :
                'text-gray-400'
              )}>
                <Target className="w-3 h-3" />
                <span>Completeness: {asset.completeness}%</span>
              </div>
              <div className="flex items-center space-x-1 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                <span>Updated {formatDistanceToNow(new Date(asset.last_updated), { addSuffix: true })}</span>
              </div>
            </div>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400" />
      </div>
    )
  }

  // Render grouped view
  const renderGroupedView = () => {
    if (prioritizerView === 'by-stage') {
      const groupedByStage = filteredAssets.reduce((acc, asset) => {
        const stage = asset.stage
        if (!acc[stage]) acc[stage] = []
        acc[stage].push(asset)
        return acc
      }, {} as Record<string, WorkflowAsset[]>)

      return (
        <div className="space-y-4">
          {Object.entries(groupedByStage).map(([stage, stageAssets]) => (
            <Card key={stage} className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Layers className="w-5 h-5 text-gray-500" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">{stage}</h3>
                  </div>
                  <Badge variant="outline" size="sm">{stageAssets.length} assets</Badge>
                </div>
                <div className="space-y-2">
                  {stageAssets.map((asset, index) => renderAssetItem(asset, selectedWorkflow === null, `stage-${stage}-${asset.symbol}-${index}`))}
                </div>
              </div>
            </Card>
          ))}
          {Object.keys(groupedByStage).length === 0 && (
            <Card className="p-12 text-center">
              <Layers className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">No assets match the current filters</p>
            </Card>
          )}
        </div>
      )
    }

    if (prioritizerView === 'by-priority') {
      const groupedByPriority = filteredAssets.reduce((acc, asset) => {
        const priority = asset.priority
        if (!acc[priority]) acc[priority] = []
        acc[priority].push(asset)
        return acc
      }, {} as Record<string, WorkflowAsset[]>)

      const priorityOrder = ['critical', 'high', 'medium', 'low']
      const priorityIcons: Record<string, React.ReactNode> = {
        critical: <AlertCircle className="w-5 h-5 text-red-500" />,
        high: <AlertCircle className="w-5 h-5 text-orange-500" />,
        medium: <Circle className="w-5 h-5 text-blue-500" />,
        low: <Circle className="w-5 h-5 text-gray-400" />
      }

      return (
        <div className="space-y-4">
          {priorityOrder.map(priority => {
            const priorityAssets = groupedByPriority[priority]
            if (!priorityAssets || priorityAssets.length === 0) return null

            return (
              <Card key={priority} className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {priorityIcons[priority]}
                      <h3 className="font-semibold text-gray-900 dark:text-white capitalize">{priority} Priority</h3>
                    </div>
                    <Badge variant="outline" size="sm">{priorityAssets.length} assets</Badge>
                  </div>
                  <div className="space-y-2">
                    {priorityAssets.map((asset, index) => renderAssetItem(asset, selectedWorkflow === null, `priority-${priority}-${asset.symbol}-${index}`))}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )
    }

    if (prioritizerView === 'by-workflow') {
      return (
        <div className="space-y-4">
          {workflowData?.workflows.map(workflow => {
            const workflowAssets = filterAndSortAssets(workflowData?.workflowAssets[workflow.id] || [])
            if (workflowAssets.length === 0) return null

            return (
              <Card key={workflow.id} className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: workflow.color }}
                      />
                      <h3 className="font-semibold text-gray-900 dark:text-white">{workflow.name}</h3>
                    </div>
                    <Badge variant="outline" size="sm">{workflowAssets.length} assets</Badge>
                  </div>
                  <div className="space-y-2">
                    {workflowAssets.map((asset, index) => renderAssetItem(asset, false, `workflow-${workflow.id}-${asset.symbol}-${index}`))}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )
    }

    if (prioritizerView === 'in-progress') {
      const inProgressAssets = filteredAssets.filter(asset => asset.is_started)
      const notStartedAssets = filteredAssets.filter(asset => !asset.is_started)

      return (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">In Progress</h3>
                </div>
                <Badge variant="outline" size="sm">{inProgressAssets.length} assets</Badge>
              </div>
              <div className="space-y-2">
                {inProgressAssets.map((asset, index) => renderAssetItem(asset, selectedWorkflow === null, `in-progress-${asset.symbol}-${index}`))}
              </div>
              {inProgressAssets.length === 0 && (
                <div className="text-center py-8 text-gray-500">No assets in progress</div>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Circle className="w-5 h-5 text-gray-400" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">Not Started</h3>
                </div>
                <Badge variant="outline" size="sm">{notStartedAssets.length} assets</Badge>
              </div>
              <div className="space-y-2">
                {notStartedAssets.map((asset, index) => renderAssetItem(asset, selectedWorkflow === null, `not-started-${asset.symbol}-${index}`))}
              </div>
              {notStartedAssets.length === 0 && (
                <div className="text-center py-8 text-gray-500">No assets waiting to start</div>
              )}
            </div>
          </Card>
        </div>
      )
    }

    // Default: All view
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {selectedWorkflow === null ? 'All Assets' : workflowData?.workflows.find(w => w.id === selectedWorkflow)?.name}
            </h3>
            <Badge variant="outline" size="sm">{filteredAssets.length} assets</Badge>
          </div>
          <div className="space-y-2">
            {filteredAssets.map((asset, index) => renderAssetItem(asset, selectedWorkflow === null, `all-${asset.symbol}-${index}`))}
          </div>
          {filteredAssets.length === 0 && (
            <div className="text-center py-8 text-gray-500">No assets match the current filters</div>
          )}
        </div>
      </Card>
    )
  }

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <ListOrdered className="h-6 w-6 text-primary-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Prioritizer</h1>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Workflow-based task management for all your active investments
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchWorkflowData()}
          disabled={workflowLoading}
        >
          <RefreshCw className={clsx('h-4 w-4 mr-2', workflowLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Assets</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalAssets}</p>
            </div>
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <LayoutGrid className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">In Progress</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{inProgressCount}</p>
            </div>
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-green-600" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Critical</p>
              <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
            </div>
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">High Priority</p>
              <p className="text-2xl font-bold text-orange-600">{highPriorityCount}</p>
            </div>
            <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-orange-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Controls Row */}
      <div className="flex items-center justify-between">
        {/* View Selector */}
        <div className="flex items-center space-x-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {[
            { key: 'all', label: 'All', icon: List },
            { key: 'in-progress', label: 'Status', icon: Activity },
            { key: 'by-stage', label: 'Stage', icon: Layers },
            { key: 'by-priority', label: 'Priority', icon: AlertCircle },
            { key: 'by-workflow', label: 'Workflow', icon: Activity },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setPrioritizerView(key as PrioritizerView)}
              className={clsx(
                'flex items-center space-x-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                prioritizerView === key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          {/* Filter Dropdown */}
          <div className="relative filter-dropdown">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className={clsx(
                filterByStatus !== 'all' || filterByPriority !== 'all' || filterByStage !== 'all'
                  ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700'
                  : ''
              )}
            >
              <Filter className="w-4 h-4 mr-2" />
              Filter
              {(filterByStatus !== 'all' || filterByPriority !== 'all' || filterByStage !== 'all') && (
                <div className="w-2 h-2 bg-blue-500 rounded-full ml-1"></div>
              )}
            </Button>

            {showFilterDropdown && (
              <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
                    <select
                      value={filterByStatus}
                      onChange={(e) => setFilterByStatus(e.target.value as any)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All</option>
                      <option value="in-progress">In Progress</option>
                      <option value="not-started">Not Started</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Priority</label>
                    <select
                      value={filterByPriority}
                      onChange={(e) => setFilterByPriority(e.target.value as any)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Priorities</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Stage</label>
                    <select
                      value={filterByStage}
                      onChange={(e) => setFilterByStage(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Stages</option>
                      {getAllStages().map(stage => (
                        <option key={stage} value={stage}>{stage}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => {
                        setFilterByStatus('all')
                        setFilterByPriority('all')
                        setFilterByStage('all')
                      }}
                      className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={() => setShowFilterDropdown(false)}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sort Dropdown */}
          <div className="relative sort-dropdown">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSortDropdown(!showSortDropdown)}
            >
              <SortDesc className="w-4 h-4 mr-2" />
              Sort
            </Button>

            {showSortDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Sort By</label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortField)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="updated">Last Updated</option>
                      <option value="priority">Priority</option>
                      <option value="stage">Stage</option>
                      <option value="symbol">Symbol</option>
                      <option value="progress">Progress</option>
                      <option value="completeness">Completeness</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Order</label>
                    <select
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="desc">Descending</option>
                      <option value="asc">Ascending</option>
                    </select>
                  </div>

                  <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => setShowSortDropdown(false)}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Tabs */}
      <div className="flex space-x-2 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedWorkflow(null)}
          className={clsx(
            'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors',
            selectedWorkflow === null
              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
        >
          <Activity className="w-4 h-4" />
          <span>All Workflows</span>
        </button>
        {workflowData?.workflows.map((workflow) => (
          <button
            key={workflow.id}
            onClick={() => setSelectedWorkflow(workflow.id)}
            className={clsx(
              'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors',
              selectedWorkflow === workflow.id
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
            )}
          >
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: workflow.color }}
            />
            <span>{workflow.name}</span>
            <Badge variant="outline" size="sm">
              {workflowData?.workflowAssets[workflow.id]?.length || 0}
            </Badge>
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {workflowLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg mb-4"></div>
                <div className="space-y-2">
                  {[...Array(3)].map((_, j) => (
                    <div key={j} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-lg"></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          renderGroupedView()
        )}
      </div>
    </div>
  )
}
