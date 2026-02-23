import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Search, ChevronDown,
  ChevronLeft, ChevronRight,
  LayoutList, LayoutGrid, CalendarRange,
  Plus, User
} from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import type { ProjectStatus, ProjectPriority } from '../../types/project'
import {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  SORT_OPTIONS,
} from '../../lib/project-config'

// ── Types ────────────────────────────────────────────────────

export type ViewMode = 'list' | 'board' | 'timeline'
export type AssignmentFilter = 'all' | 'created' | 'assigned'
export type ViewFilter = 'active' | 'archived'

interface ProjectsFilterToolbarProps {
  // Status
  quickStatusFilter: ProjectStatus | null
  onQuickStatusFilterChange: (status: ProjectStatus | null) => void
  viewFilter: ViewFilter
  onViewFilterChange: (v: ViewFilter) => void

  // Priority
  priorityFilter: 'all' | ProjectPriority
  onPriorityFilterChange: (p: 'all' | ProjectPriority) => void

  // Search
  searchQuery: string
  onSearchQueryChange: (q: string) => void

  // Sort
  sortValue: string
  onSortChange: (field: string, order: 'asc' | 'desc') => void

  // View toggle
  viewMode: ViewMode
  onViewModeChange: (m: ViewMode) => void

  // Assignment / My view
  assignmentFilter: AssignmentFilter
  onAssignmentFilterChange: (a: AssignmentFilter) => void

  // Sidebar toggle
  showSidebar: boolean
  onToggleSidebar: () => void

  // Create
  onCreateProject: () => void

  // Counts
  projectCount: number
}

// ── Helpers ─────────────────────────────────────────────────

type DropdownId = 'status' | 'priority' | 'sort'

const STATUS_OPTIONS: Array<{ id: ProjectStatus | null; label: string; viewFilter: ViewFilter }> = [
  { id: null, label: 'All statuses', viewFilter: 'active' },
  ...PROJECT_STATUSES.filter(s => s.id !== 'cancelled').map(s => ({
    id: s.id as ProjectStatus | null,
    label: s.label,
    viewFilter: 'active' as ViewFilter,
  })),
  { id: null, label: 'Cancelled', viewFilter: 'archived' },
]

// ── Component ────────────────────────────────────────────────

export function ProjectsFilterToolbar({
  quickStatusFilter,
  onQuickStatusFilterChange,
  viewFilter,
  onViewFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  searchQuery,
  onSearchQueryChange,
  sortValue,
  onSortChange,
  viewMode,
  onViewModeChange,
  assignmentFilter,
  onAssignmentFilterChange,
  showSidebar,
  onToggleSidebar,
  onCreateProject,
  projectCount,
}: ProjectsFilterToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [openDd, setOpenDd] = useState<DropdownId | null>(null)
  const filterRowRef = useRef<HTMLDivElement>(null)

  // "/" shortcut to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!openDd) return
    const handler = (e: MouseEvent) => {
      if (filterRowRef.current && !filterRowRef.current.contains(e.target as Node)) {
        setOpenDd(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openDd])

  const toggleDd = useCallback((id: DropdownId) => {
    setOpenDd(prev => prev === id ? null : id)
  }, [])

  // Labels
  const currentStatusLabel = viewFilter === 'archived'
    ? 'Cancelled'
    : quickStatusFilter
      ? PROJECT_STATUSES.find(s => s.id === quickStatusFilter)?.label ?? 'All statuses'
      : 'All statuses'

  const currentPriorityLabel = priorityFilter === 'all'
    ? 'All priorities'
    : PROJECT_PRIORITIES.find(p => p.id === priorityFilter)?.label ?? 'All priorities'

  const selectedSort = SORT_OPTIONS.find(o => o.value === sortValue) ?? SORT_OPTIONS[0]

  // Handlers
  const handleStatusSelect = useCallback((opt: typeof STATUS_OPTIONS[number]) => {
    if (opt.viewFilter === 'archived') {
      onQuickStatusFilterChange(null)
      onViewFilterChange('archived')
    } else {
      onQuickStatusFilterChange(opt.id)
      onViewFilterChange('active')
    }
    setOpenDd(null)
  }, [onQuickStatusFilterChange, onViewFilterChange])

  const handlePrioritySelect = useCallback((id: 'all' | ProjectPriority) => {
    onPriorityFilterChange(id)
    setOpenDd(null)
  }, [onPriorityFilterChange])

  const handleSortSelect = useCallback((opt: typeof SORT_OPTIONS[number]) => {
    onSortChange(opt.field, opt.order)
    setOpenDd(null)
  }, [onSortChange])

  // Active-filter visual hint
  const hasStatusFilter = quickStatusFilter !== null || viewFilter === 'archived'
  const hasPriorityFilter = priorityFilter !== 'all'

  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-white sticky top-0 z-10">
      {/* Row 1: Title + assignment + view mode + create */}
      <div className="px-4 pt-3 pb-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleSidebar}
              className="p-1.5 hover:bg-gray-100 rounded transition-colors"
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              {showSidebar
                ? <ChevronLeft className="w-4 h-4 text-gray-400" />
                : <ChevronRight className="w-4 h-4 text-gray-400" />}
            </button>
            <h1 className="text-[15px] font-semibold text-gray-900">Projects</h1>
            <span className="text-[11px] text-gray-400 tabular-nums">({projectCount})</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Assignment toggle */}
            <div className="flex items-center bg-gray-100 rounded-md p-0.5 text-[12px] font-medium">
              <button
                onClick={() => onAssignmentFilterChange('all')}
                className={clsx(
                  'px-2.5 py-1 rounded transition-colors',
                  assignmentFilter === 'all'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                All
              </button>
              <button
                onClick={() => onAssignmentFilterChange('created')}
                className={clsx(
                  'px-2.5 py-1 rounded transition-colors',
                  assignmentFilter === 'created'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                My Projects
              </button>
              <button
                onClick={() => onAssignmentFilterChange('assigned')}
                className={clsx(
                  'px-2.5 py-1 rounded transition-colors flex items-center gap-1',
                  assignmentFilter === 'assigned'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <User className="w-3 h-3" />
                My Tasks
              </button>
            </div>

            {/* View mode */}
            <div className="flex items-center bg-gray-100 rounded-md p-0.5">
              {([
                { mode: 'list' as ViewMode, icon: LayoutList, title: 'List view' },
                { mode: 'board' as ViewMode, icon: LayoutGrid, title: 'Board view' },
                { mode: 'timeline' as ViewMode, icon: CalendarRange, title: 'Timeline view' },
              ]).map(({ mode, icon: Icon, title }) => (
                <button
                  key={mode}
                  onClick={() => onViewModeChange(mode)}
                  className={clsx(
                    'p-1.5 rounded transition-colors',
                    viewMode === mode && assignmentFilter !== 'assigned'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  )}
                  title={title}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>

            <Button onClick={onCreateProject} size="sm">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New Project
            </Button>
          </div>
        </div>
      </div>

      {/* Row 2: Filter dropdowns + search */}
      <div className="px-4 pb-2.5 flex items-center gap-2" ref={filterRowRef}>
        {/* Status dropdown */}
        {viewMode !== 'board' && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => toggleDd('status')}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border rounded-md transition-colors',
                hasStatusFilter
                  ? 'text-gray-800 border-gray-300 bg-gray-50'
                  : 'text-gray-500 border-gray-200 hover:text-gray-700'
              )}
            >
              {currentStatusLabel}
              <ChevronDown className={clsx('w-3 h-3 transition-transform', openDd === 'status' && 'rotate-180')} />
            </button>
            {openDd === 'status' && (
              <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[150px]">
                {STATUS_OPTIONS.map(opt => {
                  const isArchived = opt.viewFilter === 'archived'
                  const isActive = isArchived
                    ? viewFilter === 'archived'
                    : opt.id === quickStatusFilter && viewFilter === 'active'
                  const isAll = opt.id === null && !isArchived
                  const isAllActive = isAll && !quickStatusFilter && viewFilter === 'active'

                  return (
                    <button
                      key={opt.label}
                      onClick={() => handleStatusSelect(opt)}
                      className={clsx(
                        'w-full px-3 py-[6px] text-left text-[12px] transition-colors',
                        (isActive || isAllActive)
                          ? 'bg-gray-50 text-gray-900 font-medium'
                          : 'text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Priority dropdown */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => toggleDd('priority')}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border rounded-md transition-colors',
              hasPriorityFilter
                ? 'text-gray-800 border-gray-300 bg-gray-50'
                : 'text-gray-500 border-gray-200 hover:text-gray-700'
            )}
          >
            {currentPriorityLabel}
            <ChevronDown className={clsx('w-3 h-3 transition-transform', openDd === 'priority' && 'rotate-180')} />
          </button>
          {openDd === 'priority' && (
            <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
              <button
                onClick={() => handlePrioritySelect('all')}
                className={clsx(
                  'w-full px-3 py-[6px] text-left text-[12px] transition-colors',
                  priorityFilter === 'all'
                    ? 'bg-gray-50 text-gray-900 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                All priorities
              </button>
              {PROJECT_PRIORITIES.map(p => (
                <button
                  key={p.id}
                  onClick={() => handlePrioritySelect(p.id)}
                  className={clsx(
                    'w-full px-3 py-[6px] text-left text-[12px] transition-colors',
                    priorityFilter === p.id
                      ? 'bg-gray-50 text-gray-900 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => toggleDd('sort')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md transition-colors"
          >
            {selectedSort.label}
            <ChevronDown className={clsx('w-3 h-3 transition-transform', openDd === 'sort' && 'rotate-180')} />
          </button>
          {openDd === 'sort' && (
            <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[170px]">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleSortSelect(opt)}
                  className={clsx(
                    'w-full px-3 py-[6px] text-left text-[12px] transition-colors',
                    sortValue === opt.value
                      ? 'bg-gray-50 text-gray-900 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-52 flex-shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search...  /"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 placeholder:text-gray-400"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchQueryChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <span className="sr-only">Clear</span>
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
