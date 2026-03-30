/**
 * GeneralRunDetailPanel
 *
 * General-scoped run detail view.
 * Shows a stage stepper with inline checklists per stage.
 * Advance through stages when all checklist items are done.
 */

import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Circle, ChevronRight, Inbox, Check } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { DecisionItemCard } from '../../ui/checklist/DecisionItemCard'
import { OperationalItemCard } from '../../ui/checklist/OperationalItemCard'
import type { ChecklistItemData } from '../../ui/checklist/types'
import { useAuth } from '../../../hooks/useAuth'

interface WorkflowStage {
  id: string
  stage_key: string
  stage_label: string
  stage_color: string
  sort_order: number
}

export interface GeneralRunDetailPanelProps {
  branchId: string
  workflowStages: WorkflowStage[]
  userId: string
  isRunEnded?: boolean
}

export function GeneralRunDetailPanel({
  branchId,
  workflowStages,
  userId,
  isRunEnded = false,
}: GeneralRunDetailPanelProps) {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  const sortedStages = useMemo(
    () => [...workflowStages].sort((a, b) => a.sort_order - b.sort_order),
    [workflowStages]
  )

  // Fetch single progress row
  const { data: progress, isLoading: isLoadingProgress } = useQuery({
    queryKey: ['run-detail-general', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('general_workflow_progress')
        .select('*')
        .eq('workflow_id', branchId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!branchId,
    staleTime: 1000 * 60 * 1,
  })

  // Fetch checklist items
  const { data: checklistItems = [] } = useQuery({
    queryKey: ['run-detail-general-checklist', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('general_checklist_items')
        .select('*')
        .eq('workflow_id', branchId)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!branchId,
    staleTime: 1000 * 60 * 1,
  })

  const currentStageKey = progress?.current_stage_key
  const isCompleted = progress?.is_completed ?? false
  const currentStageIndex = sortedStages.findIndex(s => s.stage_key === currentStageKey)
  const totalStages = sortedStages.length

  // Group checklist items by stage
  const itemsByStage = useMemo(() => {
    const map = new Map<string, typeof checklistItems>()
    for (const item of checklistItems) {
      const list = map.get(item.stage_id) || []
      list.push(item)
      map.set(item.stage_id, list)
    }
    return map
  }, [checklistItems])

  // Check if current stage checklist is fully complete
  const currentStageItems = currentStageKey ? (itemsByStage.get(currentStageKey) || []) : []
  const allCurrentComplete = currentStageItems.length > 0
    ? currentStageItems.every(i => i.completed)
    : true // No items = can advance

  // Cycle: unchecked → completed → na → unchecked
  const handleToggleItem = (item: any) => {
    const currentStatus = item.status || (item.completed ? 'completed' : 'unchecked')
    let newStatus: 'unchecked' | 'completed' | 'na'
    if (currentStatus === 'unchecked') newStatus = 'completed'
    else if (currentStatus === 'completed') newStatus = 'na'
    else newStatus = 'unchecked'
    const isDone = newStatus === 'completed' || newStatus === 'na'
    toggleItemMutation.mutate({
      itemId: item.id, status: newStatus, completed: newStatus === 'completed',
      completedAt: isDone ? new Date().toISOString() : null,
      completedBy: isDone ? userId : null,
    })
  }

  const toggleItemMutation = useMutation({
    mutationFn: async ({ itemId, status, completed, completedAt, completedBy }: {
      itemId: string; status: string; completed: boolean; completedAt: string | null; completedBy: string | null
    }) => {
      const { error } = await supabase
        .from('general_checklist_items')
        .update({
          completed,
          completed_at: completedAt,
          completed_by: completedBy,
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run-detail-general-checklist', branchId] })
    },
  })

  // Advance to next stage
  const advanceStageMutation = useMutation({
    mutationFn: async () => {
      const nextIndex = currentStageIndex + 1
      if (nextIndex >= totalStages) {
        // Mark complete
        const { error } = await supabase
          .from('general_workflow_progress')
          .update({
            is_completed: true,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('workflow_id', branchId)
        if (error) throw error
      } else {
        const nextStageKey = sortedStages[nextIndex].stage_key
        const { error } = await supabase
          .from('general_workflow_progress')
          .update({
            current_stage_key: nextStageKey,
            updated_at: new Date().toISOString(),
          })
          .eq('workflow_id', branchId)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run-detail-general', branchId] })
      queryClient.invalidateQueries({ queryKey: ['active-runs'] })
    },
  })

  if (isLoadingProgress) {
    return (
      <Card className="bg-white">
        <div className="p-6 animate-pulse space-y-3">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
        </div>
      </Card>
    )
  }

  if (!progress) {
    return (
      <Card className="bg-white">
        <div className="p-6 text-center">
          <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <div className="text-sm font-medium text-gray-600">No progress data</div>
          <div className="text-xs text-gray-400 mt-1">This run has not been initialized.</div>
        </div>
      </Card>
    )
  }

  return (
    <>
      {/* Progress header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          {isCompleted ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-sm font-medium text-green-700">Run Complete</span>
            </>
          ) : (
            <>
              <span className="text-sm text-gray-500">Stage {currentStageIndex + 1} of {totalStages}</span>
              <span className="text-gray-300">·</span>
              <span className="text-sm font-medium text-gray-900">{sortedStages[currentStageIndex]?.stage_label}</span>
            </>
          )}
        </div>
        {!isCompleted && totalStages > 0 && (
          <div className="flex items-center gap-1">
            {sortedStages.map((stage, idx) => (
              <div key={stage.stage_key} className={`h-1.5 flex-1 rounded-full ${
                idx < currentStageIndex ? 'bg-emerald-500'
                : idx === currentStageIndex ? 'bg-blue-500'
                : 'bg-gray-200'
              }`} />
            ))}
          </div>
        )}
      </div>

      {/* All stages with checklists */}
      {sortedStages.map((stage, idx) => {
        const isPast = idx < currentStageIndex
        const isCurrent = idx === currentStageIndex && !isCompleted
        const isFuture = idx > currentStageIndex && !isCompleted
        const stageItems = itemsByStage.get(stage.stage_key) || []
        const stageComplete = stageItems.length > 0 && stageItems.every(i => i.completed)
        const stageDone = stageItems.filter(i => i.completed).length

        return (
          <Card key={stage.stage_key} className={isCurrent ? 'ring-2 ring-blue-200' : ''}>
            <div className="px-5 py-3 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isPast || (isCompleted && true) ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : isCurrent ? (
                    <Circle className="w-4 h-4 text-blue-500" />
                  ) : (
                    <Circle className="w-4 h-4 text-gray-300" />
                  )}
                  <h4 className="text-sm font-semibold text-gray-900">{stage.stage_label}</h4>
                  {isCurrent && <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Current</span>}
                </div>
                {stageItems.length > 0 && (
                  <span className="text-xs text-gray-400">{stageDone}/{stageItems.length}</span>
                )}
              </div>
            </div>
            <div className="p-4">
              {stageItems.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-2">No checklist items</p>
              ) : (
                <div className="space-y-1.5">
                  {stageItems.map(item => {
                    const cardItem: ChecklistItemData = {
                      id: item.item_id || item.id,
                      text: item.item_text || item.item_id,
                      completed: item.completed,
                      status: item.status || (item.completed ? 'completed' : 'unchecked'),
                      completedAt: item.completed_at,
                      completedBy: item.completed_by,
                      dbId: item.id,
                      item_type: item.item_type || 'operational',
                    }
                    const cardProps = {
                      item: cardItem,
                      stageId: stage.stage_key,
                      assetId: branchId,
                      workflowId: branchId,
                      isEditable: !isFuture && !isRunEnded,
                      isExpanded: expandedItemId === item.id,
                      onToggleExpand: () => setExpandedItemId(expandedItemId === item.id ? null : item.id),
                      onToggleStatus: () => handleToggleItem(item),
                      currentUser: currentUser,
                    }
                    return (item.item_type || 'operational') === 'thinking'
                      ? <DecisionItemCard key={item.id} {...cardProps} />
                      : <OperationalItemCard key={item.id} {...cardProps} />
                  })}
                </div>
              )}

              {/* Advance button — only on current stage */}
              {isCurrent && !isRunEnded && (
                <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {allCurrentComplete && stageItems.length > 0 ? 'All items complete' : stageItems.length > 0 ? `${stageDone} of ${stageItems.length} complete` : ''}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => advanceStageMutation.mutate()}
                    disabled={!allCurrentComplete || advanceStageMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {currentStageIndex + 1 >= totalStages ? 'Complete Process ✓' : 'Advance Stage →'}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )
      })}

      {/* Completed state */}
      {isCompleted && (
        <Card>
          <div className="p-6 text-center">
            <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
            <div className="text-sm font-medium text-green-700">Process Complete</div>
            <div className="text-xs text-gray-400 mt-1">All stages finished.</div>
          </div>
        </Card>
      )}
    </>
  )
}
