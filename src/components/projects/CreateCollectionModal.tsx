import { useState, useEffect } from 'react'
import { X, Save, Filter } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import type { ProjectStatus, ProjectPriority } from '../../types/project'

interface CreateCollectionModalProps {
  isOpen: boolean
  onClose: () => void
  editingCollection?: {
    id: string
    name: string
    filter_criteria: any
  } | null
}

export function CreateCollectionModal({ isOpen, onClose, editingCollection }: CreateCollectionModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState<ProjectStatus[]>([])
  const [selectedPriorities, setSelectedPriorities] = useState<ProjectPriority[]>([])
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'created' | 'assigned'>('all')
  const [daysUntilDeadline, setDaysUntilDeadline] = useState<{
    enabled: boolean
    operator: 'less_than' | 'greater_than' | 'between'
    value1: number
    value2?: number
  }>({
    enabled: false,
    operator: 'less_than',
    value1: 7
  })
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])

  // Fetch all users for the user filter
  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .order('full_name')

      if (error) throw error
      return data || []
    }
  })

  // Load existing collection data when editing
  useEffect(() => {
    if (editingCollection) {
      setName(editingCollection.name)
      const criteria = editingCollection.filter_criteria || {}
      setSelectedStatuses(criteria.statuses || [])
      setSelectedPriorities(criteria.priorities || [])
      setAssignmentFilter(criteria.assignmentFilter || 'all')
      setSelectedUserIds(criteria.userIds || [])
      if (criteria.daysUntilDeadline) {
        setDaysUntilDeadline(criteria.daysUntilDeadline)
      }
    } else {
      // Reset form when creating new
      setName('')
      setSelectedStatuses([])
      setSelectedPriorities([])
      setAssignmentFilter('all')
      setSelectedUserIds([])
      setDaysUntilDeadline({
        enabled: false,
        operator: 'less_than',
        value1: 7
      })
    }
  }, [editingCollection, isOpen])

  // Create/Update collection mutation
  const saveCollectionMutation = useMutation({
    mutationFn: async () => {
      const filter_criteria = {
        statuses: selectedStatuses.length > 0 ? selectedStatuses : undefined,
        priorities: selectedPriorities.length > 0 ? selectedPriorities : undefined,
        assignmentFilter: assignmentFilter !== 'all' ? assignmentFilter : undefined,
        userIds: selectedUserIds.length > 0 ? selectedUserIds : undefined,
        daysUntilDeadline: daysUntilDeadline.enabled ? daysUntilDeadline : undefined
      }

      if (editingCollection) {
        // Update existing collection
        const { error } = await supabase
          .from('project_collections')
          .update({ name, filter_criteria })
          .eq('id', editingCollection.id)

        if (error) throw error
      } else {
        // Create new collection
        const { error } = await supabase
          .from('project_collections')
          .insert({
            name,
            created_by: user?.id,
            filter_criteria
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
      onClose()
    }
  })

  const toggleStatus = (status: ProjectStatus) => {
    setSelectedStatuses(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    )
  }

  const togglePriority = (priority: ProjectPriority) => {
    setSelectedPriorities(prev =>
      prev.includes(priority)
        ? prev.filter(p => p !== priority)
        : [...prev, priority]
    )
  }

  const toggleUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
              <Filter className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingCollection ? 'Edit Collection' : 'Create Collection'}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Set filters to organize your projects
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Collection Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Collection Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., High Priority Projects"
              required
            />
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {(['planning', 'in_progress', 'blocked', 'completed', 'cancelled'] as ProjectStatus[]).map((status) => (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                    selectedStatuses.includes(status)
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Priority Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Priority
            </label>
            <div className="flex flex-wrap gap-2">
              {(['urgent', 'high', 'medium', 'low'] as ProjectPriority[]).map((priority) => (
                <button
                  key={priority}
                  onClick={() => togglePriority(priority)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                    selectedPriorities.includes(priority)
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {priority}
                </button>
              ))}
            </div>
          </div>

          {/* Assignment Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Created/Assigned By
            </label>
            <Select
              value={assignmentFilter}
              onChange={(e) => setAssignmentFilter(e.target.value as any)}
              options={[
                { value: 'all', label: 'All Projects' },
                { value: 'created', label: 'Created by Me' },
                { value: 'assigned', label: 'Assigned to Me' }
              ]}
            />
          </div>

          {/* User Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team Members (show projects with these users)
            </label>
            <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-3 max-h-40 overflow-y-auto">
              {allUsers && allUsers.length > 0 ? (
                <div className="space-y-2">
                  {allUsers.map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-2 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        onChange={() => toggleUser(user.id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-900 dark:text-white">
                        {user.full_name || user.email}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No users found</p>
              )}
            </div>
          </div>

          {/* Days Until Deadline Filter */}
          <div>
            <label className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={daysUntilDeadline.enabled}
                onChange={(e) => setDaysUntilDeadline(prev => ({ ...prev, enabled: e.target.checked }))}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Filter by Days Until Deadline
              </span>
            </label>

            {daysUntilDeadline.enabled && (
              <div className="ml-6 space-y-3">
                <Select
                  value={daysUntilDeadline.operator}
                  onChange={(e) => setDaysUntilDeadline(prev => ({ ...prev, operator: e.target.value as any }))}
                  options={[
                    { value: 'less_than', label: 'Less than' },
                    { value: 'greater_than', label: 'Greater than' },
                    { value: 'between', label: 'Between' }
                  ]}
                />

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={daysUntilDeadline.value1}
                    onChange={(e) => setDaysUntilDeadline(prev => ({ ...prev, value1: parseInt(e.target.value) || 0 }))}
                    placeholder="Days"
                    min="0"
                  />
                  {daysUntilDeadline.operator === 'between' && (
                    <>
                      <span className="text-sm text-gray-500">and</span>
                      <Input
                        type="number"
                        value={daysUntilDeadline.value2 || 0}
                        onChange={(e) => setDaysUntilDeadline(prev => ({ ...prev, value2: parseInt(e.target.value) || 0 }))}
                        placeholder="Days"
                        min="0"
                      />
                    </>
                  )}
                  <span className="text-sm text-gray-500">days</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveCollectionMutation.mutate()}
            disabled={!name.trim() || saveCollectionMutation.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {editingCollection ? 'Update Collection' : 'Create Collection'}
          </Button>
        </div>
      </div>
    </div>
  )
}
