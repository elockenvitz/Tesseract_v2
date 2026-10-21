import React, { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Clock, AlertTriangle, Check, X, Edit3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrganization } from '../../contexts/OrganizationContext'
import {
  STAGE_DEADLINE_ORG_SELECT, STAGE_DEADLINE_ORG_FILTER, STAGE_DEADLINE_CONFLICT_TARGET,
  buildStageDeadlineRow, stageDeadlineKey, workflowDeadlinesKey,
} from '../../lib/deadlines/stage-deadlines'
import { Button } from './Button'
import { Badge } from './Badge'

interface StageDeadlineManagerProps {
  assetId: string
  /**
   * The workflow this stage belongs to.
   *
   * Part of the table's unique key, and the row's only route to an
   * organization — `asset_stage_deadlines` has no org column of its own. The
   * component cannot read or write correctly without it.
   */
  workflowId: string
  stageId: string
  stageName: string
  isCurrentStage: boolean
  className?: string
}

interface StageDeadline {
  id: string
  deadline_date: string
  notes?: string
  set_by?: string
  created_at: string
  updated_at: string
}

export function StageDeadlineManager({
  assetId,
  workflowId,
  stageId,
  stageName,
  isCurrentStage,
  className = ''
}: StageDeadlineManagerProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [deadlineDate, setDeadlineDate] = useState('')
  const [notes, setNotes] = useState('')
  const queryClient = useQueryClient()
  /*
   * A deadline's organization is the one that owns its WORKFLOW — the table
   * has no org column, and the asset side is global reference data. So every
   * read filters through the embedded workflow, and the org id leads the query
   * key so switching organizations refetches instead of serving the previous
   * org's deadline from cache. See lib/deadlines/stage-deadlines.ts.
   */
  const { currentOrgId } = useOrganization()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (isEditing) {
          handleCancel()
        }
      }
    }

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isEditing])

  // Query for existing deadline
  const { data: deadline, isLoading } = useQuery({
    queryKey: stageDeadlineKey(currentOrgId, assetId, workflowId, stageId),
    enabled: !!currentOrgId && !!workflowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_stage_deadlines')
        .select(STAGE_DEADLINE_ORG_SELECT)
        .eq(STAGE_DEADLINE_ORG_FILTER, currentOrgId)
        /*
         * maybeSingle: a stage with no deadline set is the normal case — the
         * table holds zero rows today — and `.single()` made every such read
         * an HTTP 406 that the guard below then swallowed.
         *
         * These three filters now cover the WHOLE unique key
         * (asset_id, workflow_id, stage_id), so at most one row can match and
         * PGRST116 can no longer be raised by a legitimate second row. The
         * guard stays anyway: it costs nothing, and it is the difference
         * between a null result and a thrown error if the constraint is ever
         * relaxed.
         */
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .eq('stage_id', stageId)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error
      return data as StageDeadline | null
    }
  })

  // Mutation to save/update deadline
  const saveDeadlineMutation = useMutation({
    mutationFn: async ({ date, notes: deadlineNotes }: { date: string; notes: string }) => {
      const { data: user } = await supabase.auth.getUser()

      if (!currentOrgId) throw new Error('No active organization')

      const deadlineData = buildStageDeadlineRow({
        assetId,
        workflowId,
        stageId,
        deadlineDate: date,
        notes: deadlineNotes,
        setBy: user.user?.id,
      })

      const { data, error } = await supabase
        .from('asset_stage_deadlines')
        .upsert(deadlineData, {
          onConflict: STAGE_DEADLINE_CONFLICT_TARGET
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stageDeadlineKey(currentOrgId, assetId, workflowId, stageId) })
      // The timeline reads its deadlines under this key. The previous
      // invalidation named 'asset-deadlines', which no query uses, so the
      // timeline kept showing the old deadline until something else refetched.
      queryClient.invalidateQueries({ queryKey: workflowDeadlinesKey(currentOrgId, assetId, workflowId) })
      setIsEditing(false)
      setDeadlineDate('')
      setNotes('')
    },
    onError: (error) => {
      console.error('Error saving deadline:', error)
      alert('Failed to save deadline. Please try again.')
    }
  })

  // Mutation to delete deadline
  const deleteDeadlineMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrgId) throw new Error('No active organization')
      if (!workflowId) throw new Error('No workflow for this stage')
      /*
       * Scoped by the full unique key. There is no org filter because the
       * column does not exist — the workflow id is what confines this to one
       * organization's row, and it is supplied by the timeline, which only
       * renders workflows the active org can see.
       */
      const { error } = await supabase
        .from('asset_stage_deadlines')
        .delete()
        .eq('asset_id', assetId)
        .eq('workflow_id', workflowId)
        .eq('stage_id', stageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stageDeadlineKey(currentOrgId, assetId, workflowId, stageId) })
      queryClient.invalidateQueries({ queryKey: workflowDeadlinesKey(currentOrgId, assetId, workflowId) })
    },
    onError: (error) => {
      console.error('Error deleting deadline:', error)
      alert('Failed to delete deadline. Please try again.')
    }
  })

  const handleStartEditing = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isEditing) {
      handleCancel()
    } else {
      setIsEditing(true)
      if (deadline) {
        setDeadlineDate(deadline.deadline_date)
        setNotes(deadline.notes || '')
      }
    }
  }

  const handleSave = () => {
    if (!deadlineDate) return
    saveDeadlineMutation.mutate({ date: deadlineDate, notes })
  }

  const handleCancel = () => {
    setIsEditing(false)
    setDeadlineDate('')
    setNotes('')
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  const getDaysUntilDeadline = (dateString: string) => {
    const deadline = new Date(dateString)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    deadline.setHours(0, 0, 0, 0)

    const diffTime = deadline.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const getDeadlineStatus = (dateString: string) => {
    const daysUntil = getDaysUntilDeadline(dateString)

    if (daysUntil < 0) return { status: 'overdue', color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-200' }
    if (daysUntil === 0) return { status: 'today', color: 'text-orange-600', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' }
    if (daysUntil <= 3) return { status: 'urgent', color: 'text-yellow-600', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200' }
    return { status: 'upcoming', color: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-200' }
  }

  const getStatusText = (dateString: string) => {
    const daysUntil = getDaysUntilDeadline(dateString)

    if (daysUntil < 0) return `${Math.abs(daysUntil)} days overdue`
    if (daysUntil === 0) return 'Due today'
    if (daysUntil === 1) return 'Due tomorrow'
    return `${daysUntil} days remaining`
  }

  if (isLoading) {
    return (
      <div className={`${className}`}>
        <div className="animate-pulse h-4 bg-gray-200 rounded w-24"></div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <>
        {deadline ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-700 dark:text-gray-300">Due: {formatDate(deadline.deadline_date)}</span>
                <Badge
                  variant="secondary"
                  size="sm"
                  className={`${getDeadlineStatus(deadline.deadline_date).color} ${getDeadlineStatus(deadline.deadline_date).bgColor} ${getDeadlineStatus(deadline.deadline_date).borderColor}`}
                >
                  {getStatusText(deadline.deadline_date)}
                </Badge>
              </div>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={(e) => handleStartEditing(e)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded dark:hover:text-gray-300"
                title="Edit deadline"
              >
                <Edit3 className="w-3 h-3" />
              </button>
              <button
                onClick={() => deleteDeadlineMutation.mutate()}
                className="p-1 text-gray-400 hover:text-red-600 rounded"
                title="Remove deadline"
                disabled={deleteDeadlineMutation.isPending}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={(e) => handleStartEditing(e)}
            className="flex items-center space-x-2 text-xs text-gray-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors dark:text-gray-400"
          >
            <Calendar className="w-3 h-3" />
            <span>Set deadline...</span>
          </button>
        )}

        {isEditing && (
          <div ref={dropdownRef} className="absolute z-50 mt-1 right-0 bg-white rounded-lg border border-gray-200 shadow-lg p-3 w-56 dark:border-gray-700 dark:bg-gray-800">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0 dark:text-gray-400" />
                <input
                  type="date"
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:border-gray-700"
                  min={new Date().toISOString().split('T')[0]}
                  autoFocus
                />
              </div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:border-gray-700"
              />
              <div className="flex justify-end space-x-1 pt-1">
                <button
                  onClick={handleCancel}
                  disabled={saveDeadlineMutation.isPending}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded transition-colors dark:hover:text-gray-200 dark:hover:bg-gray-800 dark:text-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!deadlineDate || saveDeadlineMutation.isPending}
                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saveDeadlineMutation.isPending ? 'Saving...' : deadline ? 'Update' : 'Set'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>

      {deadline?.notes && !isEditing && (
        <div className="mt-1 text-xs text-gray-500 italic dark:text-gray-400">
          {deadline.notes}
        </div>
      )}
    </div>
  )
}