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
  ArrowLeft,
  FolderKanban,
  CheckSquare,
  Square,
  ChevronRight,
  ChevronDown
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

type SelectionItem = {
  type: 'project' | 'deliverable'
  id: string
  title: string
  projectTitle?: string // For deliverables, the parent project title
  status?: ProjectStatus
  priority?: ProjectPriority
  completed?: boolean
}

export function DependencyManager({ project, onNavigate }: DependencyManagerProps) {
  const { user } = useAuth()
  const {
    blockedBy,
    blocking,
    related,
    isBlocked,
    addMultipleDependencies,
    removeDependency,
    isAddingDependency,
    isRemovingDependency
  } = useProjectDependencies({ projectId: project.id })

  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dependencyType, setDependencyType] = useState<'blocks' | 'related'>('blocks')
  const [selectedItems, setSelectedItems] = useState<SelectionItem[]>([])
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

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

  // Fetch all deliverables for search
  const { data: allDeliverables } = useQuery({
    queryKey: ['deliverables-for-dependencies', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('project_deliverables')
        .select(`
          id,
          title,
          completed,
          project:project_id(
            id,
            title
          )
        `)
        .neq('project_id', project.id)
        .order('title')

      if (error) throw error
      return (data || []).map((d: any) => ({
        id: d.id,
        title: d.title,
        completed: d.completed,
        projectId: d.project?.id,
        projectTitle: d.project?.title
      }))
    },
    enabled: showAddModal && !!user?.id
  })

  // Get already linked IDs
  const linkedProjectIds = useMemo(() => {
    return new Set([
      ...blockedBy.filter(d => d.depends_on_id).map(d => d.depends_on_id!),
      ...blocking.map(d => d.project_id),
      ...related.filter(d => d.depends_on_id).map(d => d.depends_on_id!)
    ])
  }, [blockedBy, blocking, related])

  const linkedDeliverableIds = useMemo(() => {
    return new Set([
      ...blockedBy.filter(d => d.depends_on_deliverable_id).map(d => d.depends_on_deliverable_id!),
      ...related.filter(d => d.depends_on_deliverable_id).map(d => d.depends_on_deliverable_id!)
    ])
  }, [blockedBy, related])

  // Filter projects for search
  const filteredProjects = useMemo(() => {
    if (!allProjects) return []

    return allProjects.filter(p => {
      if (linkedProjectIds.has(p.id)) return false
      if (!searchQuery) return true
      return p.title.toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [allProjects, linkedProjectIds, searchQuery])

  // Filter deliverables for search
  const filteredDeliverables = useMemo(() => {
    if (!allDeliverables) return []

    return allDeliverables.filter((d: any) => {
      if (linkedDeliverableIds.has(d.id)) return false
      if (!searchQuery) return true
      return d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.projectTitle?.toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [allDeliverables, linkedDeliverableIds, searchQuery])

  // Group deliverables by project
  const deliverablesGroupedByProject = useMemo(() => {
    const grouped = new Map<string, { projectId: string; projectTitle: string; deliverables: any[] }>()

    filteredDeliverables.forEach((d: any) => {
      if (!d.projectId) return

      if (!grouped.has(d.projectId)) {
        grouped.set(d.projectId, {
          projectId: d.projectId,
          projectTitle: d.projectTitle,
          deliverables: []
        })
      }
      grouped.get(d.projectId)!.deliverables.push(d)
    })

    return grouped
  }, [filteredDeliverables])

  // Check if project has available deliverables
  const projectHasDeliverables = (projectId: string) => {
    return deliverablesGroupedByProject.has(projectId)
  }

  // Get deliverables for a project
  const getProjectDeliverables = (projectId: string) => {
    return deliverablesGroupedByProject.get(projectId)?.deliverables || []
  }

  // Toggle project expansion
  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  // Check if all deliverables in a project are selected
  const areAllDeliverablesSelected = (projectId: string) => {
    const deliverables = getProjectDeliverables(projectId)
    if (deliverables.length === 0) return false
    return deliverables.every((d: any) => isSelected('deliverable', d.id))
  }

  // Check if some deliverables in a project are selected
  const areSomeDeliverablesSelected = (projectId: string) => {
    const deliverables = getProjectDeliverables(projectId)
    return deliverables.some((d: any) => isSelected('deliverable', d.id)) && !areAllDeliverablesSelected(projectId)
  }

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

  const toggleSelection = (item: SelectionItem) => {
    setSelectedItems(prev => {
      const exists = prev.find(i => i.type === item.type && i.id === item.id)
      if (exists) {
        return prev.filter(i => !(i.type === item.type && i.id === item.id))
      }
      return [...prev, item]
    })
  }

  const isSelected = (type: 'project' | 'deliverable', id: string) => {
    return selectedItems.some(i => i.type === type && i.id === id)
  }

  const handleAddDependencies = () => {
    if (selectedItems.length === 0) return

    addMultipleDependencies({
      dependencies: selectedItems.map(item => ({
        type: item.type,
        id: item.id
      })),
      dependencyType
    })

    setShowAddModal(false)
    setSearchQuery('')
    setSelectedItems([])
    setExpandedProjects(new Set())
  }

  const isOwner = project.created_by === user?.id

  // Helper to render dependency item
  const renderDependencyItem = (dep: any, isBlocker: boolean = true) => {
    const isProject = !!dep.depends_on
    const isDeliverable = !!dep.depends_on_deliverable
    const isComplete = isProject
      ? dep.depends_on?.status === 'completed'
      : dep.depends_on_deliverable?.completed

    return (
      <div
        key={dep.id}
        className={clsx(
          'flex items-center justify-between p-3 rounded-lg border transition-colors',
          isBlocker
            ? isComplete
              ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-900/10'
              : 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10'
            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
        )}
      >
        <div
          className="flex items-center gap-3 flex-1 cursor-pointer hover:opacity-80"
          onClick={() => {
            if (isProject) {
              onNavigate?.({
                id: dep.depends_on?.id || '',
                title: dep.depends_on?.title || '',
                type: 'project',
                data: dep.depends_on
              })
            } else if (isDeliverable) {
              onNavigate?.({
                id: dep.depends_on_deliverable?.project?.id || '',
                title: dep.depends_on_deliverable?.project?.title || '',
                type: 'project',
                data: { id: dep.depends_on_deliverable?.project?.id }
              })
            }
          }}
        >
          {isProject ? (
            <>
              {getStatusIcon(dep.depends_on?.status as ProjectStatus)}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FolderKanban className="w-3.5 h-3.5 text-gray-400" />
                  <p className="font-medium text-gray-900 dark:text-white truncate">
                    {dep.depends_on?.title}
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={clsx('text-xs', getStatusColor(dep.depends_on?.status as ProjectStatus))}>
                    {dep.depends_on?.status?.replace('_', ' ')}
                  </Badge>
                  <Badge className={clsx('text-xs', getPriorityColor(dep.depends_on?.priority as ProjectPriority))}>
                    {dep.depends_on?.priority}
                  </Badge>
                </div>
              </div>
            </>
          ) : isDeliverable ? (
            <>
              {dep.depends_on_deliverable?.completed ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <Circle className="w-4 h-4 text-gray-400" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-3.5 h-3.5 text-gray-400" />
                  <p className="font-medium text-gray-900 dark:text-white truncate">
                    {dep.depends_on_deliverable?.title}
                  </p>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  from {dep.depends_on_deliverable?.project?.title}
                </p>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isBlocker && (
            isComplete ? (
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            ) : (
              <Lock className="w-4 h-4 text-red-500" />
            )
          )}
          {isOwner && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                removeDependency(dep.id)
              }}
              className={clsx(
                isBlocker && !isComplete ? 'text-red-600 hover:text-red-700 hover:bg-red-50' : 'text-gray-500 hover:text-red-600'
              )}
              disabled={isRemovingDependency}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
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
            <span className="text-sm text-gray-400 dark:text-gray-500">
              — Projects or deliverables that must be completed first
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
            {blockedBy.map(dep => renderDependencyItem(dep, true))}
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
          <span className="text-sm text-gray-400 dark:text-gray-500">
            — Projects waiting on this one
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
              Related
            </h3>
            <span className="text-sm text-gray-500">
              ({related.length})
            </span>
            <span className="text-sm text-gray-400 dark:text-gray-500">
              — Non-blocking links for reference
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
              Link Item
            </Button>
          )}
        </div>

        {related.length > 0 ? (
          <div className="space-y-3">
            {related.map(dep => renderDependencyItem(dep, false))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Link2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>No related items</p>
            <p className="text-sm">Link related projects or deliverables for easy reference.</p>
          </div>
        )}
      </Card>

      {/* Add Dependency Modal */}
      {showAddModal && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => {
              setShowAddModal(false)
              setSelectedItems([])
              setExpandedProjects(new Set())
            }}
          />
          <div className="fixed inset-x-4 top-[10%] max-w-lg mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-2xl z-50 max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {dependencyType === 'blocks' ? 'Add Blocking Dependencies' : 'Link Related Items'}
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAddModal(false)
                    setSelectedItems([])
                    setExpandedProjects(new Set())
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {dependencyType === 'blocks'
                  ? 'Select projects or deliverables that must be completed before this project can proceed.'
                  : 'Select projects or deliverables to link as related (non-blocking).'}
              </p>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search projects and deliverables..."
                  className="pl-10"
                  autoFocus
                />
              </div>

              {/* Selected Items Summary */}
              {selectedItems.length > 0 && (
                <div className="mt-4 p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                      {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} selected
                    </span>
                    <button
                      onClick={() => setSelectedItems([])}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedItems.slice(0, 3).map(item => (
                      <Badge key={`${item.type}-${item.id}`} variant="default" className="text-xs">
                        {item.type === 'project' ? <FolderKanban className="w-3 h-3 mr-1" /> : <CheckSquare className="w-3 h-3 mr-1" />}
                        {item.title.length > 20 ? item.title.slice(0, 20) + '...' : item.title}
                      </Badge>
                    ))}
                    {selectedItems.length > 3 && (
                      <Badge variant="default" className="text-xs">
                        +{selectedItems.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredProjects.length > 0 || deliverablesGroupedByProject.size > 0 ? (
                <div className="space-y-2">
                  {/* Render projects that are in filteredProjects */}
                  {filteredProjects.map(p => {
                    const hasDeliverables = projectHasDeliverables(p.id)
                    const isExpanded = expandedProjects.has(p.id)
                    const projectDeliverables = getProjectDeliverables(p.id)

                    return (
                      <div key={p.id}>
                        {/* Project Row */}
                        <div
                          className={clsx(
                            'w-full flex items-center gap-2 p-3 rounded-lg border transition-colors',
                            isSelected('project', p.id)
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          )}
                        >
                          {/* Expand/Collapse Button */}
                          {hasDeliverables ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleProjectExpanded(p.id)
                              }}
                              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-500" />
                              )}
                            </button>
                          ) : (
                            <div className="w-6" /> // Spacer for alignment
                          )}

                          {/* Project Selection */}
                          <button
                            onClick={() => toggleSelection({
                              type: 'project',
                              id: p.id,
                              title: p.title,
                              status: p.status as ProjectStatus,
                              priority: p.priority as ProjectPriority
                            })}
                            className="flex items-center gap-3 flex-1 text-left"
                          >
                            {isSelected('project', p.id) ? (
                              <CheckSquare className="w-5 h-5 text-primary-600" />
                            ) : areSomeDeliverablesSelected(p.id) ? (
                              <div className="w-5 h-5 border-2 border-primary-400 bg-primary-100 dark:bg-primary-900/30 rounded flex items-center justify-center">
                                <div className="w-2 h-0.5 bg-primary-500" />
                              </div>
                            ) : (
                              <Square className="w-5 h-5 text-gray-400" />
                            )}
                            {getStatusIcon(p.status as ProjectStatus)}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <FolderKanban className="w-3.5 h-3.5 text-gray-400" />
                                <p className="font-medium text-gray-900 dark:text-white truncate">
                                  {p.title}
                                </p>
                                {hasDeliverables && (
                                  <span className="text-xs text-gray-400">
                                    ({projectDeliverables.length} deliverable{projectDeliverables.length !== 1 ? 's' : ''})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge className={clsx('text-xs', getStatusColor(p.status as ProjectStatus))}>
                                  {p.status?.replace('_', ' ')}
                                </Badge>
                                <Badge className={clsx('text-xs', getPriorityColor(p.priority as ProjectPriority))}>
                                  {p.priority}
                                </Badge>
                              </div>
                            </div>
                          </button>
                        </div>

                        {/* Expanded Deliverables */}
                        {isExpanded && hasDeliverables && (
                          <div className="ml-8 mt-1 space-y-1">
                            {projectDeliverables.map((d: any) => (
                              <button
                                key={d.id}
                                onClick={() => toggleSelection({
                                  type: 'deliverable',
                                  id: d.id,
                                  title: d.title,
                                  projectTitle: d.projectTitle,
                                  completed: d.completed
                                })}
                                className={clsx(
                                  'w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left',
                                  isSelected('deliverable', d.id)
                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                )}
                              >
                                {isSelected('deliverable', d.id) ? (
                                  <CheckSquare className="w-4 h-4 text-primary-600" />
                                ) : (
                                  <Square className="w-4 h-4 text-gray-400" />
                                )}
                                {d.completed ? (
                                  <CheckCircle className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Circle className="w-4 h-4 text-gray-400" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <CheckSquare className="w-3 h-3 text-gray-400" />
                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                      {d.title}
                                    </p>
                                  </div>
                                </div>
                                {d.completed && (
                                  <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                    Done
                                  </Badge>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Render projects that only have deliverables (not in filteredProjects) */}
                  {Array.from(deliverablesGroupedByProject.entries())
                    .filter(([projectId]) => !filteredProjects.find(p => p.id === projectId))
                    .map(([projectId, group]) => {
                      const isExpanded = expandedProjects.has(projectId)

                      return (
                        <div key={projectId}>
                          {/* Project Header (not selectable, just expandable) */}
                          <div
                            className="w-full flex items-center gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                          >
                            <button
                              onClick={() => toggleProjectExpanded(projectId)}
                              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-500" />
                              )}
                            </button>
                            <FolderKanban className="w-4 h-4 text-gray-400" />
                            <span className="flex-1 font-medium text-gray-700 dark:text-gray-300 truncate">
                              {group.projectTitle}
                            </span>
                            <span className="text-xs text-gray-400">
                              {group.deliverables.length} deliverable{group.deliverables.length !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {/* Expanded Deliverables */}
                          {isExpanded && (
                            <div className="ml-8 mt-1 space-y-1">
                              {group.deliverables.map((d: any) => (
                                <button
                                  key={d.id}
                                  onClick={() => toggleSelection({
                                    type: 'deliverable',
                                    id: d.id,
                                    title: d.title,
                                    projectTitle: d.projectTitle,
                                    completed: d.completed
                                  })}
                                  className={clsx(
                                    'w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left',
                                    isSelected('deliverable', d.id)
                                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                      : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                  )}
                                >
                                  {isSelected('deliverable', d.id) ? (
                                    <CheckSquare className="w-4 h-4 text-primary-600" />
                                  ) : (
                                    <Square className="w-4 h-4 text-gray-400" />
                                  )}
                                  {d.completed ? (
                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                  ) : (
                                    <Circle className="w-4 h-4 text-gray-400" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <CheckSquare className="w-3 h-3 text-gray-400" />
                                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                        {d.title}
                                      </p>
                                    </div>
                                  </div>
                                  {d.completed && (
                                    <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                      Done
                                    </Badge>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {searchQuery
                    ? 'No projects or deliverables match your search'
                    : 'No available projects or deliverables to link'}
                </div>
              )}
            </div>

            {/* Footer with Add Button */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
              <Button
                onClick={handleAddDependencies}
                disabled={selectedItems.length === 0 || isAddingDependency}
                className="w-full"
              >
                {isAddingDependency ? (
                  'Adding...'
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Add {selectedItems.length} {selectedItems.length === 1 ? 'Dependency' : 'Dependencies'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
