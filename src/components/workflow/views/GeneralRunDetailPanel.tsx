/**
 * GeneralRunDetailPanel
 *
 * General-scoped run detail view.
 * Shows a stage stepper with inline checklists per stage.
 * Advance through stages when all checklist items are done.
 */

import React, { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Circle, ChevronRight, Inbox } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'

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
}

export function GeneralRunDetailPanel({
  branchId,
  workflowStages,
  userId,
}: GeneralRunDetailPanelProps) {
  const queryClient = useQueryClient()

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

  // Toggle checklist item
  const toggleItemMutation = useMutation({
    mutationFn: async ({ itemId, completed }: { itemId: string; completed: boolean }) => {
      const { error } = await supabase
        .from('general_checklist_items')
        .update({
          completed,
          completed_at: completed ? new Date().toISOString() : null,
          completed_by: completed ? userId : null,
          status: completed ? 'checked' : 'unchecked',
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
      {/* Stage progress metric */}
      <Card className="bg-white">
        <div className="p-6 text-center">
          {isCompleted ? (
            <>
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <div className="text-sm font-medium text-green-700">Run Complete</div>
              <div className="text-xs text-gray-400 mt-1">All stages have been completed.</div>
            </>
          ) : (
            <>
              <div className="text-4xl font-bold text-gray-900">
                Stage {currentStageIndex + 1} of {totalStages}
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {sortedStages[currentStageIndex]?.stage_label || 'Unknown'}
              </div>
              <div className="mt-3 max-w-xs mx-auto">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${totalStages > 0 ? Math.round(((currentStageIndex + 1) / totalStages) * 100) : 0}%` }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Stage stepper */}
      <Card>
        <div className="p-4">
          <div className="flex items-center space-x-1 overflow-x-auto pb-2">
            {sortedStages.map((stage, idx) => {
              const isPast = idx < currentStageIndex
              const isCurrent = idx === currentStageIndex && !isCompleted
              const isFuture = idx > currentStageIndex || isCompleted

              return (
                <React.Fragment key={stage.stage_key}>
                  <div
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                      isCurrent
                        ? 'bg-blue-100 text-blue-800 ring-2 ring-blue-300'
                        : isPast
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {isPast ? (
                      <CheckCircle className="w-3.5 h-3.5" />
                    ) : isCurrent ? (
                      <Circle className="w-3.5 h-3.5" />
                    ) : (
                      <Circle className="w-3.5 h-3.5" />
                    )}
                    <span>{stage.stage_label}</span>
                  </div>
                  {idx < sortedStages.length - 1 && (
                    <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${isPast ? 'text-green-400' : 'text-gray-300'}`} />
                  )}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      </Card>

      {/* Current stage checklist */}
      {!isCompleted && currentStageKey && (
        <Card>
          <div className="px-5 py-3 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900">
              {sortedStages[currentStageIndex]?.stage_label} Checklist
            </h4>
          </div>
          <div className="p-4">
            {currentStageItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                No checklist items for this stage.
              </p>
            ) : (
              <div className="space-y-2">
                {currentStageItems.map(item => (
                  <label
                    key={item.id}
                    className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-colors ${
                      item.completed ? 'bg-green-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => toggleItemMutation.mutate({ itemId: item.id, completed: !item.completed })}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className={`text-sm ${item.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                      {item.item_text || item.item_id}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* Advance button */}
            <div className="mt-4 pt-3 border-t border-gray-200">
              <Button
                size="sm"
                onClick={() => advanceStageMutation.mutate()}
                disabled={!allCurrentComplete || advanceStageMutation.isPending}
              >
                {currentStageIndex + 1 >= totalStages ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                    Mark Complete
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 mr-1.5" />
                    Advance to Next Stage
                  </>
                )}
              </Button>
              {!allCurrentComplete && currentStageItems.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  Complete all checklist items to advance.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}
    </>
  )
}
