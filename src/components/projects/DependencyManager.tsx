import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Link2,
  Plus,
  X,
  Lock,
  AlertTriangle,
  CheckCircle,
  Clock,
  Circle,
  AlertCircle,
  Search,
  ArrowRight,
  ArrowLeft
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useProjectDependencies } from '../../hooks/useProjectDependencies'
import type { ProjectStatus, ProjectPriority, ProjectWithAssignments } from '../../types/project'

interface DependencyManagerProps {
  project: ProjectWithAssignments
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
}

export function DependencyManager({ project, onNavigate }: DependencyManagerProps) {
  const { user } = useAuth()
  const {
    blockedBy,
    blocking,
    related,
    isBlocked,
    addDependency,
    removeDependency,
    isAddingDependency,
    isRemovingDependency
  } = useProjectDependencies({ projectId: project.id })

  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dependencyType, setDependencyType] = useState<'blocks' | 'related'>('blocks')

  // Fetch all projects for search
  const { data: allProjects } = useQuery({
    queryKey: ['projects-for-dependencies', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('projects')
        .select('id, title, status, priority')
        .is('deleted_at', null)
        .neq('id', project.id)
        .order('title')

      if (error) throw error
      return data || []
    },
    enabled: showAddModal && !!user?.id
  })

  // Filter projects for search, excluding already linked ones
  const filteredProjects = useMemo(() => {
    if (!allProjects) return []

    const linkedIds = new Set([
      ...blockedBy.map(d => d.depends_on_id),
      ...blocking.map(d => d.project_id),
      ...related.map(d => d.depends_on_id)
    ])

    return allProjects.filter(p => {
      if (linkedIds.has(p.id)) return false
      if (!searchQuery) return true
      return p.title.toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [allProjects, blockedBy, blocking, related, searchQuery])

  const getStatusIcon = (status: ProjectStatus) => {
    switch (status) {
      case 'planning': return <Circle className="w-4 h-4 text-gray-500" />
      case 'in_progress': return <Clock className="w-4 h-4 text-blue-500" />
      case 'blocked': return <AlertCircle className="w-4 h-4 text-red-500" />
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />
      default: return <Circle className="w-4 h-4 text-gray-400" />
    }
  }

  const getStatusColor = (status: ProjectStatus) => {
    switch (status) {
      case 'planning': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      case 'in_progress': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
      case 'blocked': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      case 'completed': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      default: return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
    }
  }

  const getPriorityColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      case 'high': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
      case 'medium': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
      case 'low': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  const handleAddDependency = (dependsOnId: string) => {
    addDependency({ dependsOnId, dependencyType })
    setShowAddModal(false)
    setSearchQuery('')
  }

  const isOwner = project.created_by === user?.id

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      {isBlocked && (
        <Card className={clsx(
          'p-4 border-l-4 border-l-red-500',
          'bg-red-50 dark:bg-red-900/20'
        )}>
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-red-600 dark:text-red-400" />
            <div>
              <h4 className="font-medium text-red-800 dark:text-red-200">
                This project is blocked
              </h4>
              <p className="text-sm text-red-600 dark:text-red-400">
                Complete the blocking dependencies below to unblock this project.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Blocked By Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ArrowLeft className="w-5 h-5 text-red-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Blocked By
            </h3>
            <span className="text-sm text-gray-500">
              ({blockedBy.length})
            </span>
          </div>
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDependencyType('blocks')
                setShowAddModal(true)
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Blocker
            </Button>
          )}
        </div>

        {blockedBy.length > 0 ? (
          <div className="space-y-3">
            {blockedBy.map(dep => (
              <div
                key={dep.id}
                className={clsx(
                  'flex items-center justify-between p-3 rounded-lg border transition-colors',
                  dep.depends_on?.status === 'completed'
                    ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-900/10'
                    : 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10'
                )}
              >
                <div
                  className="flex items-center gap-3 flex-1 cursor-pointer hover:opacity-80"
                  onClick={() => onNavigate?.({
                    id: dep.depends_on?.id || '',
                    title: dep.depends_on?.title || '',
                    type: 'project',
                    data: dep.depends_on
                  })}
                >
                  {getStatusIcon(dep.depends_on?.status as ProjectStatus)}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {dep.depends_on?.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className={clsx('text-xs', getStatusColor(dep.depends_on?.status as ProjectStatus))}>
                        {dep.depends_on?.status?.replace('_', ' ')}
                      </Badge>
                      <Badge className={clsx('text-xs', getPriorityColor(dep.depends_on?.priority as ProjectPriority))}>
                        {dep.depends_on?.priority}
                      </Badge>
                    </div>
                  </div>
                </div>

                {dep.depends_on?.status === 'completed' ? (
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                ) : (
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-red-500" />
                    {isOwner && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeDependency(dep.id)
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        disabled={isRemovingDependency}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Lock className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>No blocking dependencies</p>
            <p className="text-sm">This project can proceed without waiting for others.</p>
          </div>
        )}
      </Card>

      {/* Blocking Section */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <ArrowRight className="w-5 h-5 text-yellow-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Blocking
          </h3>
          <span className="text-sm text-gray-500">
            ({blocking.length})
          </span>
        </div>

        {blocking.length > 0 ? (
          <div className="space-y-3">
            {blocking.map(dep => (
              <div
                key={dep.id}
                className="flex items-center justify-between p-3 rounded-lg border border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-900/10"
              >
                <div
                  className="flex items-center gap-3 flex-1 cursor-pointer hover:opacity-80"
                  onClick={() => onNavigate?.({
                    id: dep.project?.id || '',
                    title: dep.project?.title || '',
                    type: 'project',
                    data: dep.project
                  })}
                >
                  {getStatusIcon(dep.project?.status as ProjectStatus)}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {dep.project?.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className={clsx('text-xs', getStatusColor(dep.project?.status as ProjectStatus))}>
                        {dep.project?.status?.replace('_', ' ')}
                      </Badge>
                      <Badge className={clsx('text-xs', getPriorityColor(dep.project?.priority as ProjectPriority))}>
                        {dep.project?.priority}
                      </Badge>
                    </div>
                  </div>
                </div>

                <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>Not blocking any projects</p>
            <p className="text-sm">No other projects are waiting on this one.</p>
          </div>
        )}
      </Card>

      {/* Related Projects Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-blue-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Related Projects
            </h3>
            <span className="text-sm text-gray-500">
              ({related.length})
            </span>
          </div>
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDependencyType('related')
                setShowAddModal(true)
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Link Project
            </Button>
          )}
        </div>

        {related.length > 0 ? (
          <div className="space-y-3">
            {related.map(dep => (
              <div
                key={dep.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div
                  className="flex items-center gap-3 flex-1 cursor-pointer hover:opacity-80"
                  onClick={() => onNavigate?.({
                    id: dep.depends_on?.id || '',
                    title: dep.depends_on?.title || '',
                    type: 'project',
                    data: dep.depends_on
                  })}
                >
                  {getStatusIcon(dep.depends_on?.status as ProjectStatus)}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {dep.depends_on?.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className={clsx('text-xs', getStatusColor(dep.depends_on?.status as ProjectStatus))}>
                        {dep.depends_on?.status?.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                </div>

                {isOwner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeDependency(dep.id)
                    }}
                    className="text-gray-500 hover:text-red-600"
                    disabled={isRemovingDependency}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Link2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>No related projects</p>
            <p className="text-sm">Link related projects for easy reference.</p>
          </div>
        )}
      </Card>

      {/* Add Dependency Modal */}
      {showAddModal && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowAddModal(false)}
          />
          <div className="fixed inset-x-4 top-[10%] max-w-lg mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-2xl z-50 max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {dependencyType === 'blocks' ? 'Add Blocking Dependency' : 'Link Related Project'}
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAddModal(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {dependencyType === 'blocks'
                  ? 'Select a project that must be completed before this one can proceed.'
                  : 'Select a project to link as related (non-blocking).'}
              </p>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search projects..."
                  className="pl-10"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredProjects.length > 0 ? (
                <div className="space-y-2">
                  {filteredProjects.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleAddDependency(p.id)}
                      disabled={isAddingDependency}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors text-left"
                    >
                      {getStatusIcon(p.status as ProjectStatus)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">
                          {p.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className={clsx('text-xs', getStatusColor(p.status as ProjectStatus))}>
                            {p.status?.replace('_', ' ')}
                          </Badge>
                          <Badge className={clsx('text-xs', getPriorityColor(p.priority as ProjectPriority))}>
                            {p.priority}
                          </Badge>
                        </div>
                      </div>
                      <Plus className="w-4 h-4 text-gray-400" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {searchQuery
                    ? 'No projects match your search'
                    : 'No available projects to link'}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
