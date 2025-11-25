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
  ArrowUpDown,
  Clock,
  CheckCircle,
  AlertCircle,
  Circle,
  Ban,
  ChevronDown,
  X
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
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../types/project'

interface ProjectsPageProps {
  onProjectSelect?: (project: ProjectWithAssignments) => void
}

export function ProjectsPage({ onProjectSelect }: ProjectsPageProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [showContent, setShowContent] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | ProjectPriority>('all')
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'created' | 'assigned'>('all')
  const [sortBy, setSortBy] = useState<'created_at' | 'due_date' | 'priority' | 'title'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Delay showing content to prevent flash
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setShowContent(true)
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // Fetch projects user has access to (created or assigned)
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
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
            completed
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as ProjectWithAssignments[]
    },
    enabled: !!user?.id,
    staleTime: 30000
  })

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
  }, [projects, searchQuery, statusFilter, priorityFilter, assignmentFilter, sortBy, sortOrder, user?.id])

  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setAssignmentFilter('all')
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Briefcase className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Manage one-off initiatives and deliverables
                </p>
              </div>
            </div>
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </div>

          {/* Search and Filters */}
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
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className={clsx(
                showFilters && 'bg-gray-100 dark:bg-gray-700'
              )}
            >
              <Filter className="w-4 h-4 mr-2" />
              Filters
              {activeFilterCount > 0 && (
                <Badge className="ml-2">{activeFilterCount}</Badge>
              )}
              <ChevronDown className={clsx(
                'w-4 h-4 ml-2 transition-transform',
                showFilters && 'rotate-180'
              )} />
            </Button>
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="created_at">Created Date</option>
              <option value="due_date">Due Date</option>
              <option value="priority">Priority</option>
              <option value="title">Title</option>
            </Select>
            <Button
              variant="outline"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            >
              <ArrowUpDown className="w-4 h-4" />
            </Button>
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
                  >
                    <option value="all">All Statuses</option>
                    <option value="planning">Planning</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Priority
                  </label>
                  <Select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value as any)}
                  >
                    <option value="all">All Priorities</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Assignment
                  </label>
                  <Select
                    value={assignmentFilter}
                    onChange={(e) => setAssignmentFilter(e.target.value as any)}
                  >
                    <option value="all">All Projects</option>
                    <option value="created">Created by Me</option>
                    <option value="assigned">Assigned to Me</option>
                  </Select>
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

      {/* Project List */}
      <div className="flex-1 overflow-y-auto">
        {!showContent || isLoading ? (
          <div className="p-6">
            <ListSkeleton count={5} />
          </div>
        ) : filteredProjects.length > 0 ? (
          <div className="p-6 space-y-4">
            {filteredProjects.map((project) => {
              const totalDeliverables = project.project_deliverables?.length || 0
              const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
              const assignmentCount = project.project_assignments?.length || 0
              const isOverdue = project.due_date && new Date(project.due_date) < new Date() && project.status !== 'completed'

              return (
                <Card
                  key={project.id}
                  className="p-5 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => onProjectSelect?.(project)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {project.title}
                        </h3>
                        <Badge className={clsx('flex items-center gap-1', getStatusColor(project.status))}>
                          {getStatusIcon(project.status)}
                          <span className="capitalize">{project.status.replace('_', ' ')}</span>
                        </Badge>
                        <Badge className={getPriorityColor(project.priority)}>
                          <span className="capitalize">{project.priority}</span>
                        </Badge>
                      </div>

                      {project.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                          {project.description}
                        </p>
                      )}

                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        {totalDeliverables > 0 && (
                          <div className="flex items-center gap-1">
                            <CheckCircle className="w-4 h-4" />
                            <span>{completedDeliverables}/{totalDeliverables} deliverables</span>
                          </div>
                        )}
                        {assignmentCount > 0 && (
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            <span>{assignmentCount} {assignmentCount === 1 ? 'person' : 'people'}</span>
                          </div>
                        )}
                        {project.due_date && (
                          <div className={clsx(
                            'flex items-center gap-1',
                            isOverdue && 'text-red-600 dark:text-red-400 font-medium'
                          )}>
                            <Calendar className="w-4 h-4" />
                            <span>Due {formatDistanceToNow(new Date(project.due_date), { addSuffix: true })}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          <span>Created {formatDistanceToNow(new Date(project.created_at), { addSuffix: true })}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        ) : projects?.length === 0 ? (
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

      {/* TODO: Add CreateProjectModal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Create Project</h2>
              <p className="text-gray-600 dark:text-gray-400">Project creation form coming soon...</p>
              <Button onClick={() => setShowCreateForm(false)} className="mt-4">Close</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
