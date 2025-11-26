import { useState } from 'react'
import { X, Calendar, Tag as TagIcon } from 'lucide-react'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Input } from '../ui/Input'
import type { ProjectStatus, ProjectPriority, ProjectContextType } from '../../types/project'

export interface ProjectFilters {
  status: ProjectStatus | 'all'
  priority: ProjectPriority | 'all'
  assignment: 'all' | 'created' | 'assigned'
  contextType: ProjectContextType | 'all'
  dueDateRange: 'all' | 'overdue' | 'today' | 'this_week' | 'this_month' | 'custom'
  dueDateFrom?: string
  dueDateTo?: string
  hasDeliverables?: boolean
  tags?: string[]
}

interface ProjectFilterPanelProps {
  filters: ProjectFilters
  onFiltersChange: (filters: ProjectFilters) => void
  onClose: () => void
  activeFilterCount: number
}

export function ProjectFilterPanel({
  filters,
  onFiltersChange,
  onClose,
  activeFilterCount
}: ProjectFilterPanelProps) {
  const [localFilters, setLocalFilters] = useState<ProjectFilters>(filters)

  const handleApply = () => {
    onFiltersChange(localFilters)
    onClose()
  }

  const handleClear = () => {
    const clearedFilters: ProjectFilters = {
      status: 'all',
      priority: 'all',
      assignment: 'all',
      contextType: 'all',
      dueDateRange: 'all',
      hasDeliverables: undefined,
      tags: []
    }
    setLocalFilters(clearedFilters)
    onFiltersChange(clearedFilters)
  }

  const updateFilter = <K extends keyof ProjectFilters>(key: K, value: ProjectFilters[K]) => {
    setLocalFilters(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-start justify-center pt-20">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filter Projects</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'} active
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Filter Options */}
        <div className="p-6 space-y-6 max-h-[calc(100vh-300px)] overflow-y-auto">
          {/* Status & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <Select
                value={localFilters.status}
                onChange={(e) => updateFilter('status', e.target.value as ProjectStatus | 'all')}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'planning', label: 'Planning' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'blocked', label: 'Blocked' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'cancelled', label: 'Cancelled' }
                ]}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Priority
              </label>
              <Select
                value={localFilters.priority}
                onChange={(e) => updateFilter('priority', e.target.value as ProjectPriority | 'all')}
                options={[
                  { value: 'all', label: 'All Priorities' },
                  { value: 'urgent', label: 'Urgent' },
                  { value: 'high', label: 'High' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'low', label: 'Low' }
                ]}
              />
            </div>
          </div>

          {/* Assignment & Context Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Assignment
              </label>
              <Select
                value={localFilters.assignment}
                onChange={(e) => updateFilter('assignment', e.target.value as 'all' | 'created' | 'assigned')}
                options={[
                  { value: 'all', label: 'All Projects' },
                  { value: 'created', label: 'Created by Me' },
                  { value: 'assigned', label: 'Assigned to Me' }
                ]}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Context Type
              </label>
              <Select
                value={localFilters.contextType}
                onChange={(e) => updateFilter('contextType', e.target.value as ProjectContextType | 'all')}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'asset', label: 'Asset' },
                  { value: 'portfolio', label: 'Portfolio' },
                  { value: 'theme', label: 'Theme' },
                  { value: 'workflow', label: 'Workflow' },
                  { value: 'general', label: 'General' }
                ]}
              />
            </div>
          </div>

          {/* Due Date Range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <Calendar className="w-4 h-4 inline mr-1" />
              Due Date
            </label>
            <Select
              value={localFilters.dueDateRange}
              onChange={(e) => updateFilter('dueDateRange', e.target.value as ProjectFilters['dueDateRange'])}
              options={[
                { value: 'all', label: 'Any Time' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'today', label: 'Due Today' },
                { value: 'this_week', label: 'Due This Week' },
                { value: 'this_month', label: 'Due This Month' },
                { value: 'custom', label: 'Custom Range' }
              ]}
            />

            {localFilters.dueDateRange === 'custom' && (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    From
                  </label>
                  <Input
                    type="date"
                    value={localFilters.dueDateFrom || ''}
                    onChange={(e) => updateFilter('dueDateFrom', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    To
                  </label>
                  <Input
                    type="date"
                    value={localFilters.dueDateTo || ''}
                    onChange={(e) => updateFilter('dueDateTo', e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Additional Options */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Additional Filters
            </label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localFilters.hasDeliverables === true}
                  onChange={(e) => updateFilter('hasDeliverables', e.target.checked ? true : undefined)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Has deliverables/tasks
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="ghost" onClick={handleClear}>
            Clear All
          </Button>
          <div className="flex space-x-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleApply}>
              Apply Filters
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
