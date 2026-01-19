import { useState, useMemo } from 'react'
import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Briefcase,
  Search,
  Filter,
  Plus,
  Calendar,
  Users,
  User,
  ArrowUpDown,
  Clock,
  CheckCircle,
  AlertCircle,
  Circle,
  Ban,
  ChevronDown,
  X,
  Trash2,
  Tag,
  Star,
  LayoutList,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Zap,
  ArrowUp,
  Minus,
  CalendarRange,
  Square,
  CheckSquare
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Select } from '../components/ui/Select'
import { Input } from '../components/ui/Input'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { EmptyState } from '../components/common/EmptyState'
import { formatDistanceToNow, format, differenceInDays } from 'date-fns'
import { clsx } from 'clsx'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../types/project'
import { CreateProjectModal } from '../components/projects/CreateProjectModal'
import { DeleteProjectModal } from '../components/projects/DeleteProjectModal'
import { ProjectCollectionsSidebar } from '../components/projects/ProjectCollectionsSidebar'
import { EnhancedKanbanBoard } from '../components/projects/EnhancedKanbanBoard'
import { ProjectTimelineView } from '../components/projects/ProjectTimelineView'
import { MyTasksView } from '../components/projects/MyTasksView'
import { useAllProjectDependencies } from '../hooks/useProjectDependencies'
import { DatePicker } from '../components/ui/DatePicker'

interface ProjectsPageProps {
  onProjectSelect?: (project: ProjectWithAssignments) => void
}

export function ProjectsPage({ onProjectSelect }: ProjectsPageProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | ProjectPriority>('all')
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'created' | 'assigned'>('all')
  const [viewFilter, setViewFilter] = useState<'active' | 'archived'>('active')
  const [sortBy, setSortBy] = useState<'created_at' | 'due_date' | 'priority' | 'title'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; projectId: string; projectTitle: string }>({
    isOpen: false,
    projectId: '',
    projectTitle: ''
  })
  const [openDropdown, setOpenDropdown] = useState<{ projectId: string; type: 'status' | 'priority' | 'tags'; rect: DOMRect } | null>(null)
  const [tagSearchQuery, setTagSearchQuery] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [showCollectionsSidebar, setShowCollectionsSidebar] = useState(true)
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)
  const [collectionFilters, setCollectionFilters] = useState<{ statuses?: ProjectStatus[]; tagIds?: string[]; userIds?: string[]; orgGroupId?: string } | null>(null)
  const [quickStatusFilter, setQuickStatusFilter] = useState<ProjectStatus | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'board' | 'timeline'>('list')
  const [draggedProject, setDraggedProject] = useState<string | null>(null)
  const [draggedOverStatus, setDraggedOverStatus] = useState<ProjectStatus | null>(null)

  // Fetch dependency blocking status for board/timeline views
  const { blockingStatus } = useAllProjectDependencies()

  // Fetch projects user has access to (created or assigned)
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', user?.id, viewFilter],
    queryFn: async () => {
      if (!user?.id) return []

      let query = supabase
        .from('projects')
        .select(`
          *,
          creator:users!created_by(id, email, first_name, last_name),
          project_assignments(
            id,
            assigned_to,
            assigned_by,
            role,
            assigned_at
          ),
          project_deliverables(
            id,
            title,
            completed,
            due_date
          ),
          project_tag_assignments(
            id,
            tag_id,
            project_tags(
              id,
              name,
              color
            )
          )
        `)

      // Filter by active or archived
      if (viewFilter === 'active') {
        query = query.is('deleted_at', null)
      } else {
        query = query.not('deleted_at', 'is', null)
      }

      query = query.order('created_at', { ascending: false })

      const { data, error} = await query

      if (error) throw error
      return (data || []) as ProjectWithAssignments[]
    },
    enabled: !!user?.id,
    staleTime: 30000
  })

  // Fetch collections
  const { data: collections } = useQuery({
    queryKey: ['project-collections', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('project_collections')
        .select('*')
        .eq('created_by', user.id)
        .order('is_pinned', { ascending: false })
        .order('sort_order')
        .order('name')

      if (error) throw error
      return data || []
    },
    enabled: !!user?.id
  })

  // Fetch all available tags
  const { data: allTags } = useQuery({
    queryKey: ['project-tags', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('project_tags')
        .select('*')
        .eq('created_by', user.id)
        .order('name')

      if (error) throw error
      return data || []
    },
    enabled: !!user?.id
  })

  // Create tag mutation
  const createTagMutation = useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      const { data, error } = await supabase
        .from('project_tags')
        .insert({ name, color, created_by: user?.id })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-tags'] })
      setNewTagName('')
    }
  })

  // Add tag to project mutation
  const addTagToProjectMutation = useMutation({
    mutationFn: async ({ projectId, tagId }: { projectId: string; tagId: string }) => {
      const { error } = await supabase
        .from('project_tag_assignments')
        .insert({ project_id: projectId, tag_id: tagId })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Remove tag from project mutation
  const removeTagFromProjectMutation = useMutation({
    mutationFn: async ({ projectId, tagId }: { projectId: string; tagId: string }) => {
      const { error } = await supabase
        .from('project_tag_assignments')
        .delete()
        .eq('project_id', projectId)
        .eq('tag_id', tagId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Create collection mutation
  const createCollectionMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from('project_collections')
        .insert({
          name,
          created_by: user?.id,
          filter_criteria: {
            status: statusFilter !== 'all' ? [statusFilter] : undefined,
            priority: priorityFilter !== 'all' ? [priorityFilter] : undefined,
            assignmentFilter,
            viewFilter
          }
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
      setShowCreateCollection(false)
      setNewCollectionName('')
    }
  })

  // Delete collection mutation
  const deleteCollectionMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      const { error } = await supabase
        .from('project_collections')
        .delete()
        .eq('id', collectionId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
      if (activeCollectionId) {
        setActiveCollectionId(null)
      }
    }
  })

  // Toggle pin collection mutation
  const togglePinCollectionMutation = useMutation({
    mutationFn: async ({ collectionId, isPinned }: { collectionId: string; isPinned: boolean }) => {
      const { error } = await supabase
        .from('project_collections')
        .update({ is_pinned: !isPinned })
        .eq('id', collectionId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-collections'] })
    }
  })

  // Delete project mutation (soft delete)
  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase
        .from('projects')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', projectId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDeleteModal({ isOpen: false, projectId: '', projectTitle: '' })
    }
  })

  // Update project status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ projectId, status }: { projectId: string, status: ProjectStatus }) => {
      const { error } = await supabase
        .from('projects')
        .update({ status })
        .eq('id', projectId)

      if (error) throw error
    },
    onMutate: async ({ projectId, status }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['projects'] })

      // Snapshot previous value
      const previousProjects = queryClient.getQueryData(['projects', user?.id, viewFilter])

      // Optimistically update
      queryClient.setQueryData(['projects', user?.id, viewFilter], (old: any) => {
        if (!old) return old
        return old.map((project: any) =>
          project.id === projectId ? { ...project, status } : project
        )
      })

      return { previousProjects }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(['projects', user?.id, viewFilter], context.previousProjects)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Update project priority mutation
  const updatePriorityMutation = useMutation({
    mutationFn: async ({ projectId, priority }: { projectId: string, priority: ProjectPriority }) => {
      const { error } = await supabase
        .from('projects')
        .update({ priority })
        .eq('id', projectId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  const updateDueDateMutation = useMutation({
    mutationFn: async ({ projectId, dueDate }: { projectId: string, dueDate: string | null }) => {
      const { error } = await supabase
        .from('projects')
        .update({ due_date: dueDate })
        .eq('id', projectId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Toggle deliverable completion mutation
  const toggleDeliverableMutation = useMutation({
    mutationFn: async ({ deliverableId, completed }: { deliverableId: string, completed: boolean }) => {
      const { error } = await supabase
        .from('project_deliverables')
        .update({
          completed: !completed,
          completed_by: !completed ? user?.id : null,
          completed_at: !completed ? new Date().toISOString() : null
        })
        .eq('id', deliverableId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Update deliverable due date mutation
  const updateDeliverableDueDateMutation = useMutation({
    mutationFn: async ({ deliverableId, dueDate }: { deliverableId: string, dueDate: string | null }) => {
      const { error } = await supabase
        .from('project_deliverables')
        .update({ due_date: dueDate })
        .eq('id', deliverableId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Compute "My Tasks" - incomplete deliverables from assigned projects
  const myTasks = useMemo(() => {
    if (!projects || assignmentFilter !== 'assigned') return []

    const tasks: Array<{
      deliverable: { id: string; title: string; completed: boolean; due_date: string | null }
      project: ProjectWithAssignments
    }> = []

    projects.forEach(project => {
      // Only include projects user is assigned to
      const isAssigned = project.project_assignments?.some(a => a.assigned_to === user?.id)
      if (!isAssigned) return

      // Add incomplete deliverables
      project.project_deliverables?.forEach(d => {
        if (!d.completed) {
          tasks.push({ deliverable: d, project })
        }
      })
    })

    // Sort by due date (tasks with due dates first, then by date)
    return tasks.sort((a, b) => {
      if (a.deliverable.due_date && !b.deliverable.due_date) return -1
      if (!a.deliverable.due_date && b.deliverable.due_date) return 1
      if (a.deliverable.due_date && b.deliverable.due_date) {
        return new Date(a.deliverable.due_date).getTime() - new Date(b.deliverable.due_date).getTime()
      }
      return 0
    })
  }, [projects, assignmentFilter, user?.id])

  // Filter and sort projects
  const filteredProjects = useMemo(() => {
    if (!projects) return []

    let filtered = projects.filter(project => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesSearch =
          project.title.toLowerCase().includes(query) ||
          project.description?.toLowerCase().includes(query)
        if (!matchesSearch) return false
      }

      // Status filter
      if (statusFilter !== 'all' && project.status !== statusFilter) {
        return false
      }

      // Priority filter
      if (priorityFilter !== 'all' && project.priority !== priorityFilter) {
        return false
      }

      // Assignment filter
      if (assignmentFilter === 'created') {
        if (project.created_by !== user?.id) return false
      } else if (assignmentFilter === 'assigned') {
        const isAssigned = project.project_assignments?.some(
          a => a.assigned_to === user?.id
        )
        if (!isAssigned) return false
      }

      // Collection filters
      if (collectionFilters) {
        // Status filter from collection
        if (collectionFilters.statuses && collectionFilters.statuses.length > 0) {
          if (!collectionFilters.statuses.includes(project.status)) {
            return false
          }
        }

        // Tag filter from collection
        if (collectionFilters.tagIds && collectionFilters.tagIds.length > 0) {
          const projectTagIds = project.project_tag_assignments?.map((a: any) => a.tag_id) || []
          const hasAllTags = collectionFilters.tagIds.every(tagId => projectTagIds.includes(tagId))
          if (!hasAllTags) {
            return false
          }
        }

        // Org group filter - filter by explicit org_group_id association
        if (collectionFilters.orgGroupId) {
          if (project.org_group_id !== collectionFilters.orgGroupId) {
            return false
          }
        }

        // User filter from collection (teams)
        if (collectionFilters.userIds && collectionFilters.userIds.length > 0) {
          const projectMemberIds = project.project_assignments?.map((a: any) => a.assigned_to) || []
          // Also include the project creator
          if (project.created_by) {
            projectMemberIds.push(project.created_by)
          }
          // Check if any of the filter userIds match project members
          const hasMatchingMember = collectionFilters.userIds.some(userId => projectMemberIds.includes(userId))
          if (!hasMatchingMember) {
            return false
          }
        }
      }

      // Quick status filter (overrides collection status filter)
      if (quickStatusFilter && project.status !== quickStatusFilter) {
        return false
      }

      return true
    })

    // Sort
    filtered.sort((a, b) => {
      let aVal: any
      let bVal: any

      switch (sortBy) {
        case 'title':
          aVal = a.title.toLowerCase()
          bVal = b.title.toLowerCase()
          break
        case 'due_date':
          aVal = a.due_date || '9999-12-31'
          bVal = b.due_date || '9999-12-31'
          break
        case 'priority':
          const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 }
          aVal = priorityOrder[a.priority]
          bVal = priorityOrder[b.priority]
          break
        default:
          aVal = a.created_at
          bVal = b.created_at
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }, [projects, searchQuery, statusFilter, priorityFilter, assignmentFilter, sortBy, sortOrder, user?.id, collectionFilters, quickStatusFilter])

  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setAssignmentFilter('all')
    // Don't reset viewFilter as it's a primary navigation choice
  }

  const getStatusIcon = (status: ProjectStatus) => {
    switch (status) {
      case 'planning':
        return <Circle className="w-4 h-4" />
      case 'in_progress':
        return <Clock className="w-4 h-4" />
      case 'blocked':
        return <AlertCircle className="w-4 h-4" />
      case 'completed':
        return <CheckCircle className="w-4 h-4" />
      case 'cancelled':
        return <Ban className="w-4 h-4" />
    }
  }

  const getStatusColor = (status: ProjectStatus) => {
    switch (status) {
      case 'planning':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      case 'in_progress':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
      case 'blocked':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      case 'completed':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      case 'cancelled':
        return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
    }
  }

  const getPriorityColor = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      case 'high':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
      case 'low':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  const activeFilterCount = [
    statusFilter !== 'all',
    priorityFilter !== 'all',
    assignmentFilter !== 'all'
  ].filter(Boolean).length

  // Apply collection filters
  const applyCollection = (collection: any) => {
    setActiveCollectionId(collection.id)
    const criteria = collection.filter_criteria

    if (criteria.status && criteria.status.length > 0) {
      setStatusFilter(criteria.status[0])
    } else {
      setStatusFilter('all')
    }

    if (criteria.priority && criteria.priority.length > 0) {
      setPriorityFilter(criteria.priority[0])
    } else {
      setPriorityFilter('all')
    }

    if (criteria.assignmentFilter) {
      setAssignmentFilter(criteria.assignmentFilter)
    } else {
      setAssignmentFilter('all')
    }

    if (criteria.viewFilter) {
      setViewFilter(criteria.viewFilter)
    } else {
      setViewFilter('active')
    }
  }

  // Clear all filters and active collection
  const clearAllFilters = () => {
    clearFilters()
    setActiveCollectionId(null)
  }

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-6 h-[calc(100%+3rem)] flex bg-white dark:bg-gray-800">
      {/* Collections Sidebar */}
      {showCollectionsSidebar && (
        <ProjectCollectionsSidebar
          activeCollectionId={activeCollectionId}
          onSelectCollection={(collectionId, filters) => {
            setActiveCollectionId(collectionId)
            setCollectionFilters(filters || null)
          }}
          onSelectView={setViewFilter}
          activeView={viewFilter}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCollectionsSidebar(!showCollectionsSidebar)}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                title={showCollectionsSidebar ? "Hide collections" : "Show collections"}
              >
                {showCollectionsSidebar ? (
                  <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                )}
              </button>
              <FolderKanban className="w-6 h-6 text-primary-600 dark:text-primary-400" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
            </div>
            <div className="flex items-center gap-2">
              {/* My Tasks Toggle */}
              <button
                onClick={() => setAssignmentFilter(assignmentFilter === 'assigned' ? 'all' : 'assigned')}
                className={clsx(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  assignmentFilter === 'assigned'
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                )}
                title="Show only projects assigned to me"
              >
                <User className="w-4 h-4" />
                My Tasks
              </button>

              {/* View Mode Toggle */}
              <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('list')}
                  className={clsx(
                    'p-1.5 rounded transition-colors',
                    viewMode === 'list' && assignmentFilter !== 'assigned'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  )}
                  title="List view"
                >
                  <LayoutList className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setViewMode('board')
                    // Exit My Tasks view when switching to board
                    if (assignmentFilter === 'assigned') {
                      setAssignmentFilter('all')
                    }
                  }}
                  className={clsx(
                    'p-1.5 rounded transition-colors',
                    viewMode === 'board' && assignmentFilter !== 'assigned'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  )}
                  title="Board view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setViewMode('timeline')
                    // Exit My Tasks view when switching to timeline
                    if (assignmentFilter === 'assigned') {
                      setAssignmentFilter('all')
                    }
                  }}
                  className={clsx(
                    'p-1.5 rounded transition-colors',
                    viewMode === 'timeline' && assignmentFilter !== 'assigned'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  )}
                  title="Timeline view"
                >
                  <CalendarRange className="w-4 h-4" />
                </button>
              </div>

              <Button onClick={() => setShowCreateForm(true)} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </div>
          </div>

          {/* Status Quick Filters - Hide in board view since columns represent status */}
          {viewMode !== 'board' && (
          <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Status:</span>
              <button
                onClick={() => {
                  setQuickStatusFilter(null)
                  setViewFilter('active')
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  !quickStatusFilter && viewFilter === 'active'
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                All
              </button>
              <button
                onClick={() => {
                  setQuickStatusFilter('planning')
                  setViewFilter('active')
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  quickStatusFilter === 'planning' && viewFilter === 'active'
                    ? 'bg-yellow-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <Circle className="w-3.5 h-3.5" />
                Planning
              </button>
              <button
                onClick={() => {
                  setQuickStatusFilter('in_progress')
                  setViewFilter('active')
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  quickStatusFilter === 'in_progress' && viewFilter === 'active'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <Clock className="w-3.5 h-3.5" />
                In Progress
              </button>
              <button
                onClick={() => {
                  setQuickStatusFilter('blocked')
                  setViewFilter('active')
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  quickStatusFilter === 'blocked' && viewFilter === 'active'
                    ? 'bg-orange-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                Blocked
              </button>
              <button
                onClick={() => {
                  setQuickStatusFilter('completed')
                  setViewFilter('active')
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  quickStatusFilter === 'completed' && viewFilter === 'active'
                    ? 'bg-green-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Completed
              </button>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
              <button
                onClick={() => {
                  setQuickStatusFilter(null)
                  setViewFilter('archived')
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  viewFilter === 'archived'
                    ? 'bg-red-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <X className="w-3.5 h-3.5" />
                Cancelled
              </button>
            </div>
          )}

          {/* Priority Quick Filters - Show in all views */}
          <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Priority:</span>
              <button
                onClick={() => setPriorityFilter('all')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  priorityFilter === 'all'
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                All
              </button>
              <button
                onClick={() => setPriorityFilter('urgent')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  priorityFilter === 'urgent'
                    ? 'bg-red-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <Zap className="w-3.5 h-3.5" />
                Urgent
              </button>
              <button
                onClick={() => setPriorityFilter('high')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  priorityFilter === 'high'
                    ? 'bg-orange-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <ArrowUp className="w-3.5 h-3.5" />
                High
              </button>
              <button
                onClick={() => setPriorityFilter('medium')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  priorityFilter === 'medium'
                    ? 'bg-yellow-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <Minus className="w-3.5 h-3.5" />
                Medium
              </button>
              <button
                onClick={() => setPriorityFilter('low')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                  priorityFilter === 'low'
                    ? 'bg-gray-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <Circle className="w-3.5 h-3.5" />
                Low
              </button>
            </div>

          {/* Search and Filters - Show in both views */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [field, order] = e.target.value.split('-')
                setSortBy(field as any)
                setSortOrder(order as 'asc' | 'desc')
              }}
              options={[
                { value: 'created_at-desc', label: 'Newest First' },
                { value: 'created_at-asc', label: 'Oldest First' },
                { value: 'due_date-asc', label: 'Due Date (Soonest)' },
                { value: 'due_date-desc', label: 'Due Date (Latest)' },
                { value: 'priority-desc', label: 'Priority (High to Low)' },
                { value: 'priority-asc', label: 'Priority (Low to High)' },
                { value: 'title-asc', label: 'Title (A to Z)' },
                { value: 'title-desc', label: 'Title (Z to A)' }
              ]}
            />
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Status
                  </label>
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
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
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value as any)}
                    options={[
                      { value: 'all', label: 'All Priorities' },
                      { value: 'urgent', label: 'Urgent' },
                      { value: 'high', label: 'High' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'low', label: 'Low' }
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Assignment
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
              </div>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="mt-4"
                >
                  <X className="w-4 h-4 mr-2" />
                  Clear Filters
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Project List/Board View */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        {isLoading || !projects ? (
          <div className="p-4">
            <ListSkeleton count={5} />
          </div>
        ) : assignmentFilter === 'assigned' ? (
          // My Tasks View - show deliverables
          <MyTasksView
            myTasks={myTasks}
            onToggleDeliverable={(deliverableId, completed) =>
              toggleDeliverableMutation.mutate({ deliverableId, completed })
            }
            onUpdateDueDate={(deliverableId, dueDate) =>
              updateDeliverableDueDateMutation.mutate({ deliverableId, dueDate })
            }
            onProjectSelect={onProjectSelect}
            getStatusIcon={getStatusIcon}
            getStatusColor={getStatusColor}
            getPriorityColor={getPriorityColor}
          />
        ) : filteredProjects.length > 0 ? (
          viewMode === 'board' ? (
            // Enhanced Board View with dnd-kit
            <EnhancedKanbanBoard
              projects={filteredProjects}
              onProjectSelect={onProjectSelect}
              wipLimits={{ in_progress: 5 }}
            />
          ) : viewMode === 'timeline' ? (
            // Timeline/Gantt View
            <ProjectTimelineView
              projects={filteredProjects}
              onProjectSelect={onProjectSelect}
              blockingStatus={blockingStatus}
            />
          ) : (
            // List View
            <div className="p-4 space-y-3">
            {filteredProjects.map((project) => {
              const totalDeliverables = project.project_deliverables?.length || 0
              const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
              const assignmentCount = project.project_assignments?.length || 0
              const isOverdue = project.due_date && new Date(project.due_date) < new Date() && project.status !== 'completed'

              return (
                <Card
                  key={project.id}
                  className="p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3
                          className="text-lg font-semibold text-gray-900 dark:text-white cursor-pointer hover:text-primary-600"
                          onClick={() => onProjectSelect?.({
                            id: project.id,
                            title: project.title,
                            type: 'project',
                            data: project
                          })}
                        >
                          {project.title}
                        </h3>

                        {/* Status Badge Dropdown */}
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const rect = e.currentTarget.getBoundingClientRect()
                              setOpenDropdown(
                                openDropdown?.projectId === project.id && openDropdown?.type === 'status'
                                  ? null
                                  : { projectId: project.id, type: 'status', rect }
                              )
                            }}
                            className={clsx(
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                              'hover:shadow-md',
                              getStatusColor(project.status)
                            )}
                          >
                            {getStatusIcon(project.status)}
                            <span className="capitalize">{project.status.replace('_', ' ')}</span>
                            <ChevronDown className="w-3 h-3 opacity-60" />
                          </button>
                          {openDropdown?.projectId === project.id && openDropdown?.type === 'status' && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setOpenDropdown(null)}
                              />
                              <div
                                className="fixed bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[140px] z-20"
                                style={{
                                  left: `${openDropdown.rect.left}px`,
                                  top: `${openDropdown.rect.bottom + 4}px`
                                }}
                              >
                                {(['planning', 'in_progress', 'blocked', 'completed'] as ProjectStatus[]).map((status) => (
                                  <button
                                    key={status}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      updateStatusMutation.mutate({
                                        projectId: project.id,
                                        status
                                      })
                                      setOpenDropdown(null)
                                    }}
                                    className={clsx(
                                      'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                                      project.status === status && 'bg-gray-50 dark:bg-gray-700/50'
                                    )}
                                  >
                                    {getStatusIcon(status)}
                                    <span className="capitalize">{status.replace('_', ' ')}</span>
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Priority Badge Dropdown */}
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const rect = e.currentTarget.getBoundingClientRect()
                              setOpenDropdown(
                                openDropdown?.projectId === project.id && openDropdown?.type === 'priority'
                                  ? null
                                  : { projectId: project.id, type: 'priority', rect }
                              )
                            }}
                            className={clsx(
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                              'hover:shadow-md',
                              getPriorityColor(project.priority)
                            )}
                          >
                            <span className="capitalize">{project.priority}</span>
                            <ChevronDown className="w-3 h-3 opacity-60" />
                          </button>
                          {openDropdown?.projectId === project.id && openDropdown?.type === 'priority' && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setOpenDropdown(null)}
                              />
                              <div
                                className="fixed bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[120px] z-20"
                                style={{
                                  left: `${openDropdown.rect.left}px`,
                                  top: `${openDropdown.rect.bottom + 4}px`
                                }}
                              >
                                {(['urgent', 'high', 'medium', 'low'] as ProjectPriority[]).map((priority) => (
                                  <button
                                    key={priority}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      updatePriorityMutation.mutate({
                                        projectId: project.id,
                                        priority
                                      })
                                      setOpenDropdown(null)
                                    }}
                                    className={clsx(
                                      'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                                      project.priority === priority && 'bg-gray-50 dark:bg-gray-700/50'
                                    )}
                                  >
                                    <span className="capitalize">{priority}</span>
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Tags Display and Management */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {project.project_tag_assignments?.map((assignment: any) => (
                            <button
                              key={assignment.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (project.created_by === user?.id) {
                                  removeTagFromProjectMutation.mutate({
                                    projectId: project.id,
                                    tagId: assignment.tag_id
                                  })
                                }
                              }}
                              className={clsx(
                                'flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all',
                                project.created_by === user?.id && 'hover:line-through hover:opacity-75'
                              )}
                              style={{ backgroundColor: assignment.project_tags.color + '20', color: assignment.project_tags.color }}
                              title={project.created_by === user?.id ? 'Click to remove tag' : ''}
                            >
                              <Tag className="w-3 h-3" />
                              <span>{assignment.project_tags.name}</span>
                            </button>
                          ))}

                          {project.created_by === user?.id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                const rect = e.currentTarget.getBoundingClientRect()
                                setOpenDropdown(
                                  openDropdown?.projectId === project.id && openDropdown?.type === 'tags'
                                    ? null
                                    : { projectId: project.id, type: 'tags', rect }
                                )
                                setTagSearchQuery('')
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add tag</span>
                            </button>
                          )}
                        </div>

                        {/* Tag Dropdown Menu */}
                        {openDropdown?.projectId === project.id && openDropdown?.type === 'tags' && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setOpenDropdown(null)}
                            />
                            <div
                              className="fixed bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3 w-64 z-20"
                              style={{
                                left: `${openDropdown.rect.left}px`,
                                top: `${openDropdown.rect.bottom + 4}px`
                              }}
                            >
                              <div className="space-y-3">
                                <div className="relative">
                                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                  <input
                                    type="text"
                                    placeholder="Search tags..."
                                    value={tagSearchQuery}
                                    onChange={(e) => setTagSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>

                                <div className="max-h-40 overflow-y-auto space-y-1">
                                  {allTags
                                    ?.filter(tag => {
                                      const query = tagSearchQuery.toLowerCase()
                                      const matchesSearch = tag.name.toLowerCase().includes(query)
                                      const alreadyAssigned = project.project_tag_assignments?.some(
                                        (a: any) => a.tag_id === tag.id
                                      )
                                      return matchesSearch && !alreadyAssigned
                                    })
                                    .map(tag => (
                                      <button
                                        key={tag.id}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          addTagToProjectMutation.mutate({
                                            projectId: project.id,
                                            tagId: tag.id
                                          })
                                        }}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                      >
                                        <div
                                          className="w-3 h-3 rounded-full"
                                          style={{ backgroundColor: tag.color }}
                                        />
                                        <span className="text-gray-900 dark:text-white">{tag.name}</span>
                                      </button>
                                    ))}
                                </div>

                                <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                                  <div className="flex gap-2 items-center">
                                    <input
                                      type="text"
                                      placeholder="New tag name..."
                                      value={newTagName}
                                      onChange={(e) => setNewTagName(e.target.value)}
                                      className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newTagName.trim()) {
                                          createTagMutation.mutate({
                                            name: newTagName.trim(),
                                            color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
                                          })
                                        }
                                      }}
                                    />
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (newTagName.trim()) {
                                          createTagMutation.mutate({
                                            name: newTagName.trim(),
                                            color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
                                          })
                                        }
                                      }}
                                      disabled={!newTagName.trim() || createTagMutation.isPending}
                                      className="flex-shrink-0 px-3 py-1.5 bg-primary-600 text-white text-sm rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                    >
                                      Create
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      {project.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                          {project.description}
                        </p>
                      )}

                      {/* Progress Bar & Info Row */}
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        {totalDeliverables > 0 && (
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium flex-shrink-0 w-8 text-right">
                              {Math.round((completedDeliverables / totalDeliverables) * 100)}%
                            </span>
                            <div className="w-40 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex-shrink-0">
                              <div
                                className={clsx(
                                  'h-full rounded-full transition-all duration-300',
                                  completedDeliverables === totalDeliverables
                                    ? 'bg-green-500'
                                    : completedDeliverables > 0
                                    ? 'bg-primary-500'
                                    : 'bg-gray-300 dark:bg-gray-600'
                                )}
                                style={{ width: `${(completedDeliverables / totalDeliverables) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs flex-shrink-0">{completedDeliverables}/{totalDeliverables}</span>
                          </div>
                        )}
                        {assignmentCount > 0 && (
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            <span>{assignmentCount}</span>
                          </div>
                        )}
                        {project.created_by === user?.id ? (
                          <div onClick={(e) => e.stopPropagation()}>
                            <DatePicker
                              value={project.due_date}
                              onChange={(date) => updateDueDateMutation.mutate({ projectId: project.id, dueDate: date })}
                              placeholder="Set due date"
                              variant="inline"
                              showOverdue
                              isCompleted={project.status === 'completed'}
                              allowPastDates
                            />
                          </div>
                        ) : project.due_date ? (
                          <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                            <Calendar className="w-4 h-4" />
                            <span>{format(new Date(project.due_date), 'MMM d')}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          <span>{formatDistanceToNow(new Date(project.created_at), { addSuffix: true })}</span>
                        </div>
                      </div>
                    </div>

                    {/* Delete Button */}
                    {project.created_by === user?.id && viewFilter === 'active' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteModal({
                            isOpen: true,
                            projectId: project.id,
                            projectTitle: project.title
                          })
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Cancel project"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
          )
        ) : projects?.length === 0 ? (
          viewFilter === 'active' ? (
            <EmptyState
              icon={Briefcase}
              title="No projects yet"
              description="Start by creating your first project to organize one-off initiatives."
              action={{
                label: 'Create Project',
                onClick: () => setShowCreateForm(true),
                icon: Plus
              }}
            />
          ) : (
            <EmptyState
              icon={X}
              title="No cancelled projects"
              description="Projects you cancel will appear here."
            />
          )
        ) : (
          <EmptyState
            icon={Search}
            title="No projects match your filters"
            description="Try adjusting your search criteria or clearing filters."
            action={{
              label: 'Clear Filters',
              onClick: clearFilters
            }}
          />
        )}
      </div>

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={showCreateForm}
        onClose={() => setShowCreateForm(false)}
      />

      {/* Delete Project Modal */}
      <DeleteProjectModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, projectId: '', projectTitle: '' })}
        onConfirm={() => deleteProjectMutation.mutate(deleteModal.projectId)}
        projectTitle={deleteModal.projectTitle}
        isDeleting={deleteProjectMutation.isPending}
      />
      </div>
    </div>
  )
}
