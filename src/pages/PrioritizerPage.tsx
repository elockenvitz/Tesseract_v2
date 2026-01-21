import { useState, useMemo } from 'react'
import {
  Command, ChevronRight, ChevronDown, Plus, Clock,
  AlertCircle, CheckCircle2, TrendingUp, FileCheck, CheckSquare,
  DollarSign, ArrowLeftRight, Circle, MessageCircle,
  X, Zap, CalendarDays, CalendarClock, Inbox, FolderKanban,
  LayoutGrid, Clock3, Layers, History, ListTodo
} from 'lucide-react'
import { format, formatDistanceToNow, isToday, isYesterday, isThisWeek } from 'date-fns'
import { clsx } from 'clsx'
import { Button } from '../components/ui/Button'
import {
  useCommandCenter,
  WorkItem,
  WorkItemType,
  TimeGroup,
  getWorkItemTypeLabel,
  getWorkItemTypeColor
} from '../hooks/useCommandCenter'

interface PrioritizerPageProps {
  onItemSelect?: (item: any) => void
}

type MainTab = 'active' | 'completed'
type ViewMode = 'time' | 'type' | 'source'

const typeIcons: Record<WorkItemType, React.ElementType> = {
  project: FolderKanban,
  deliverable: FileCheck,
  workflow_task: CheckSquare,
  stage_deadline: Clock,
  earnings: DollarSign,
  trade_idea: TrendingUp,
  pair_trade: ArrowLeftRight,
  personal_task: Circle,
  message: MessageCircle
}

const timeGroupConfig: Record<TimeGroup, { label: string; icon: React.ElementType; color: string }> = {
  overdue: { label: 'Overdue', icon: AlertCircle, color: 'text-red-600' },
  today: { label: 'Today', icon: Zap, color: 'text-amber-600' },
  this_week: { label: 'This Week', icon: CalendarDays, color: 'text-blue-600' },
  upcoming: { label: 'Upcoming', icon: CalendarClock, color: 'text-gray-600' },
  no_date: { label: 'No Date', icon: Inbox, color: 'text-gray-400' }
}

export function PrioritizerPage({ onItemSelect }: PrioritizerPageProps) {
  const { items, completedItems, stats, isLoading, completePersonalTask, completeDeliverable, createPersonalTask } = useCommandCenter()

  const [mainTab, setMainTab] = useState<MainTab>('active')
  const [viewMode, setViewMode] = useState<ViewMode>('time')
  const [selectedType, setSelectedType] = useState<WorkItemType | 'all'>('all')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [showAddTask, setShowAddTask] = useState(false)

  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDueDate, setNewTaskDueDate] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<'medium' | 'high' | 'low' | 'critical'>('medium')

  // Filter items by type
  const filteredItems = useMemo(() => {
    if (selectedType === 'all') return items
    return items.filter(item => item.type === selectedType)
  }, [items, selectedType])

  // Group items by time
  const groupedByTime = useMemo(() => {
    const groups: Record<TimeGroup, WorkItem[]> = {
      overdue: [],
      today: [],
      this_week: [],
      upcoming: [],
      no_date: []
    }

    filteredItems.forEach(item => {
      if (!item.completed) {
        groups[item.timeGroup].push(item)
      }
    })

    return groups
  }, [filteredItems])

  // Group items by type
  const groupedByType = useMemo(() => {
    const groups: Partial<Record<WorkItemType, WorkItem[]>> = {}

    filteredItems.forEach(item => {
      if (!item.completed) {
        if (!groups[item.type]) groups[item.type] = []
        groups[item.type]!.push(item)
      }
    })

    return groups
  }, [filteredItems])

  // Group items by source (project, workflow, asset, personal)
  const groupedBySource = useMemo(() => {
    const groups: Record<string, { name: string; color?: string; items: WorkItem[] }> = {}

    filteredItems.forEach(item => {
      if (!item.completed) {
        const key = item.sourceName || 'Other'
        if (!groups[key]) {
          groups[key] = { name: key, color: item.sourceColor, items: [] }
        }
        groups[key].items.push(item)
      }
    })

    return Object.values(groups).sort((a, b) => b.items.length - a.items.length)
  }, [filteredItems])

  // Group completed items by date
  const groupedCompleted = useMemo(() => {
    const groups: { label: string; items: WorkItem[] }[] = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'This Week', items: [] },
      { label: 'Earlier', items: [] }
    ]

    completedItems.forEach(item => {
      const completedDate = item.completedAt || item.createdAt
      if (isToday(completedDate)) {
        groups[0].items.push(item)
      } else if (isYesterday(completedDate)) {
        groups[1].items.push(item)
      } else if (isThisWeek(completedDate)) {
        groups[2].items.push(item)
      } else {
        groups[3].items.push(item)
      }
    })

    return groups.filter(g => g.items.length > 0)
  }, [completedItems])

  const handleItemClick = (item: WorkItem) => {
    if (item.type === 'project') {
      onItemSelect?.({
        id: item.projectId,
        title: item.projectName,
        type: 'project',
        data: item
      })
    } else if (item.type === 'deliverable' || item.type === 'personal_task') {
      onItemSelect?.({
        id: item.projectId || item.id,
        title: item.projectName || item.title,
        type: item.projectId ? 'project' : 'task',
        data: item
      })
    } else if (item.assetId) {
      onItemSelect?.({
        id: item.assetId,
        title: item.assetSymbol,
        type: 'asset',
        data: item
      })
    } else if (item.type === 'trade_idea' || item.type === 'pair_trade') {
      onItemSelect?.({
        id: item.id,
        title: item.title,
        type: 'trade',
        data: item
      })
    }
  }

  const handleComplete = async (item: WorkItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (item.type === 'personal_task') {
      await completePersonalTask.mutateAsync(item.id)
    } else if (item.type === 'deliverable') {
      await completeDeliverable.mutateAsync(item.id)
    }
  }

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return

    await createPersonalTask.mutateAsync({
      title: newTaskTitle,
      due_date: newTaskDueDate || undefined,
      priority: newTaskPriority
    })

    setNewTaskTitle('')
    setNewTaskDueDate('')
    setNewTaskPriority('medium')
    setShowAddTask(false)
  }

  // Get available type filters based on what's in the data
  const availableTypes = useMemo(() => {
    const types = new Set(items.map(i => i.type))
    return Array.from(types)
  }, [items])

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Command className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Command Center</h1>
              <p className="text-xs text-gray-500">Your unified work hub</p>
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAddTask(true)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Task
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex-shrink-0 px-6 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setMainTab('active')}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all",
                mainTab === 'active'
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              <ListTodo className="w-4 h-4" />
              Active
              {stats?.total ? (
                <span className="px-1.5 py-0.5 text-xs font-semibold bg-primary-100 text-primary-700 rounded-full">
                  {stats.total}
                </span>
              ) : null}
            </button>
            <button
              onClick={() => setMainTab('completed')}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all",
                mainTab === 'completed'
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              <History className="w-4 h-4" />
              Completed
              {completedItems.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs font-semibold bg-green-100 text-green-700 rounded-full">
                  {completedItems.length}
                </span>
              )}
            </button>
          </div>

          {/* View Mode Selector (only for active tab) */}
          {mainTab === 'active' && (
            <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
              <button
                onClick={() => setViewMode('time')}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  viewMode === 'time'
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                )}
              >
                <Clock3 className="w-3.5 h-3.5" />
                By Time
              </button>
              <button
                onClick={() => setViewMode('type')}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  viewMode === 'type'
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                )}
              >
                <Layers className="w-3.5 h-3.5" />
                By Type
              </button>
              <button
                onClick={() => setViewMode('source')}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  viewMode === 'source'
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                By Source
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards (only for active tab) */}
      {mainTab === 'active' && (
        <div className="flex-shrink-0 px-6 py-3 bg-white border-b border-gray-100">
          <div className="flex items-center gap-3">
            {stats?.overdue ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <span className="font-bold text-red-700">{stats.overdue}</span>
                <span className="text-xs text-red-600">Overdue</span>
              </div>
            ) : null}

            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
              <Zap className="w-4 h-4 text-amber-600" />
              <span className="font-bold text-amber-700">{stats?.today || 0}</span>
              <span className="text-xs text-amber-600">Today</span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
              <CalendarDays className="w-4 h-4 text-blue-600" />
              <span className="font-bold text-blue-700">{stats?.thisWeek || 0}</span>
              <span className="text-xs text-blue-600">This Week</span>
            </div>

            {/* Type Filter Pills */}
            <div className="ml-auto flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setSelectedType('all')}
                className={clsx(
                  "px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap",
                  selectedType === 'all'
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                All
              </button>
              {availableTypes.slice(0, 5).map(type => {
                const count = stats?.byType[type] || 0
                if (count === 0) return null
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={clsx(
                      "px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap",
                      selectedType === type
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    )}
                  >
                    {getWorkItemTypeLabel(type)} ({count})
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-20 bg-white rounded-xl border border-gray-200"></div>
              </div>
            ))}
          </div>
        ) : mainTab === 'active' ? (
          // Active Items View
          filteredItems.filter(i => !i.completed).length === 0 ? (
            <EmptyState onAddTask={() => setShowAddTask(true)} />
          ) : viewMode === 'time' ? (
            // By Time View
            <div className="space-y-4">
              {(['overdue', 'today', 'this_week', 'upcoming', 'no_date'] as TimeGroup[]).map(group => {
                const groupItems = groupedByTime[group]
                if (groupItems.length === 0) return null

                const config = timeGroupConfig[group]
                const Icon = config.icon
                const isCollapsed = collapsedSections.has(`time-${group}`)

                return (
                  <div key={group}>
                    <button
                      onClick={() => toggleSection(`time-${group}`)}
                      className="w-full flex items-center gap-2 py-2 hover:bg-gray-100 rounded-lg px-2 -mx-2 transition-colors"
                    >
                      <ChevronRight className={clsx(
                        "w-4 h-4 text-gray-400 transition-transform",
                        !isCollapsed && "rotate-90"
                      )} />
                      <Icon className={clsx("w-5 h-5", config.color)} />
                      <h2 className={clsx("font-semibold", config.color)}>{config.label}</h2>
                      <span className="text-sm text-gray-400">({groupItems.length})</span>
                    </button>

                    {!isCollapsed && (
                      <div className="space-y-2 mt-2">
                        {groupItems.map(item => (
                          <WorkItemCard
                            key={`${item.type}-${item.id}`}
                            item={item}
                            onClick={() => handleItemClick(item)}
                            onComplete={(e) => handleComplete(item, e)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : viewMode === 'type' ? (
            // By Type View
            <div className="space-y-4">
              {Object.entries(groupedByType).map(([type, typeItems]) => {
                if (!typeItems || typeItems.length === 0) return null
                const Icon = typeIcons[type as WorkItemType]
                const isCollapsed = collapsedSections.has(`type-${type}`)

                return (
                  <div key={type}>
                    <button
                      onClick={() => toggleSection(`type-${type}`)}
                      className="w-full flex items-center gap-2 py-2 hover:bg-gray-100 rounded-lg px-2 -mx-2 transition-colors"
                    >
                      <ChevronRight className={clsx(
                        "w-4 h-4 text-gray-400 transition-transform",
                        !isCollapsed && "rotate-90"
                      )} />
                      <div className={clsx(
                        "w-7 h-7 rounded-lg flex items-center justify-center",
                        getWorkItemTypeColor(type as WorkItemType)
                      )}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <h2 className="font-semibold text-gray-900">
                        {getWorkItemTypeLabel(type as WorkItemType)}
                      </h2>
                      <span className="text-sm text-gray-400">({typeItems.length})</span>
                    </button>

                    {!isCollapsed && (
                      <div className="space-y-2 mt-2">
                        {typeItems.map(item => (
                          <WorkItemCard
                            key={`${item.type}-${item.id}`}
                            item={item}
                            onClick={() => handleItemClick(item)}
                            onComplete={(e) => handleComplete(item, e)}
                            showType={false}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            // By Source View
            <div className="space-y-4">
              {groupedBySource.map(group => {
                const isCollapsed = collapsedSections.has(`source-${group.name}`)

                return (
                  <div key={group.name}>
                    <button
                      onClick={() => toggleSection(`source-${group.name}`)}
                      className="w-full flex items-center gap-2 py-2 hover:bg-gray-100 rounded-lg px-2 -mx-2 transition-colors"
                    >
                      <ChevronRight className={clsx(
                        "w-4 h-4 text-gray-400 transition-transform",
                        !isCollapsed && "rotate-90"
                      )} />
                      {group.color && (
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: group.color }} />
                      )}
                      <h2 className="font-semibold text-gray-900">{group.name}</h2>
                      <span className="text-sm text-gray-400">({group.items.length})</span>
                    </button>

                    {!isCollapsed && (
                      <div className="space-y-2 mt-2">
                        {group.items.map(item => (
                          <WorkItemCard
                            key={`${item.type}-${item.id}`}
                            item={item}
                            onClick={() => handleItemClick(item)}
                            onComplete={(e) => handleComplete(item, e)}
                            showSource={false}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : (
          // Completed Items View
          completedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <History className="w-6 h-6 text-gray-400" />
              </div>
              <h3 className="text-sm font-medium text-gray-900">No completed items yet</h3>
              <p className="text-xs text-gray-500 mt-1">Complete some tasks to see them here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedCompleted.map(group => {
                const isCollapsed = collapsedSections.has(`completed-${group.label}`)

                return (
                  <div key={group.label}>
                    <button
                      onClick={() => toggleSection(`completed-${group.label}`)}
                      className="w-full flex items-center gap-2 py-2 hover:bg-gray-100 rounded-lg px-2 -mx-2 transition-colors"
                    >
                      <ChevronRight className={clsx(
                        "w-4 h-4 text-gray-400 transition-transform",
                        !isCollapsed && "rotate-90"
                      )} />
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <h2 className="font-semibold text-gray-700">{group.label}</h2>
                      <span className="text-sm text-gray-400">({group.items.length})</span>
                    </button>

                    {!isCollapsed && (
                      <div className="space-y-2 mt-2">
                        {group.items.map(item => (
                          <CompletedItemCard
                            key={`${item.type}-${item.id}`}
                            item={item}
                            onClick={() => handleItemClick(item)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* Add Task Modal */}
      {showAddTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Add Personal Task</h3>
              <button onClick={() => setShowAddTask(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Task Title</label>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="What do you need to do?"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newTaskDueDate}
                    onChange={(e) => setNewTaskDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <Button variant="outline" onClick={() => setShowAddTask(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleAddTask}
                disabled={!newTaskTitle.trim() || createPersonalTask.isPending}
              >
                {createPersonalTask.isPending ? 'Adding...' : 'Add Task'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Work Item Card Component
function WorkItemCard({
  item,
  onClick,
  onComplete,
  showType = true,
  showSource = true
}: {
  item: WorkItem
  onClick: () => void
  onComplete: (e: React.MouseEvent) => void
  showType?: boolean
  showSource?: boolean
}) {
  const Icon = typeIcons[item.type]
  const canComplete = item.type === 'personal_task' || item.type === 'deliverable' || item.type === 'workflow_task'

  return (
    <div
      onClick={onClick}
      className={clsx(
        "group flex items-center gap-4 p-4 bg-white rounded-xl border transition-all cursor-pointer",
        item.timeGroup === 'overdue'
          ? "border-red-200 hover:border-red-300 hover:shadow-md"
          : "border-gray-200 hover:border-gray-300 hover:shadow-md"
      )}
    >
      {/* Completion checkbox or type icon */}
      {canComplete ? (
        <button
          onClick={onComplete}
          className="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-300 hover:border-primary-500 hover:bg-primary-50 transition-colors flex items-center justify-center"
        >
          <CheckCircle2 className="w-4 h-4 text-transparent group-hover:text-primary-500" />
        </button>
      ) : (
        <div className={clsx(
          "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
          getWorkItemTypeColor(item.type)
        )}>
          <Icon className="w-4 h-4" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-medium text-gray-900 truncate">{item.title}</h3>
          {item.priority === 'critical' && (
            <span className="flex-shrink-0 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
              Critical
            </span>
          )}
          {item.priority === 'high' && (
            <span className="flex-shrink-0 px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded">
              High
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500">
          {/* Type badge */}
          {showType && (
            <span className={clsx(
              "px-1.5 py-0.5 rounded font-medium",
              getWorkItemTypeColor(item.type)
            )}>
              {getWorkItemTypeLabel(item.type)}
            </span>
          )}

          {/* Source/context */}
          {showSource && item.sourceName && item.sourceType !== 'personal' && (
            <span className="flex items-center gap-1">
              {item.sourceColor && (
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.sourceColor }} />
              )}
              {item.sourceName}
            </span>
          )}

          {/* Asset symbol */}
          {item.assetSymbol && item.type !== 'earnings' && (
            <span className="font-medium text-gray-700">{item.assetSymbol}</span>
          )}
        </div>
      </div>

      {/* Date/Time */}
      <div className="flex-shrink-0 text-right">
        {item.dueDate ? (
          <div>
            <div className={clsx(
              "text-sm font-medium",
              item.timeGroup === 'overdue' ? "text-red-600" :
              item.timeGroup === 'today' ? "text-amber-600" :
              "text-gray-600"
            )}>
              {format(item.dueDate, 'MMM d')}
            </div>
            {item.dueTime && (
              <div className="text-xs text-gray-500">{item.dueTime}</div>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-400">No date</div>
        )}
      </div>

      <ChevronRight className="flex-shrink-0 w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
    </div>
  )
}

// Completed Item Card Component
function CompletedItemCard({
  item,
  onClick
}: {
  item: WorkItem
  onClick: () => void
}) {
  const Icon = typeIcons[item.type]

  return (
    <div
      onClick={onClick}
      className="group flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer opacity-75 hover:opacity-100"
    >
      {/* Completed check */}
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-gray-700 truncate line-through">{item.title}</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className={clsx(
            "px-1.5 py-0.5 rounded font-medium",
            getWorkItemTypeColor(item.type)
          )}>
            {getWorkItemTypeLabel(item.type)}
          </span>
          {item.sourceName && item.sourceType !== 'personal' && (
            <span>{item.sourceName}</span>
          )}
        </div>
      </div>

      {/* Completed time */}
      <div className="flex-shrink-0 text-right">
        <div className="text-xs text-gray-500">
          {item.completedAt ? formatDistanceToNow(item.completedAt, { addSuffix: true }) : ''}
        </div>
      </div>

      <ChevronRight className="flex-shrink-0 w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
    </div>
  )
}

// Empty State Component
function EmptyState({ onAddTask }: { onAddTask: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-96 text-center">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center mb-4">
        <CheckCircle2 className="w-8 h-8 text-green-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-1">All caught up!</h3>
      <p className="text-sm text-gray-500 mb-4 max-w-sm">
        No pending tasks, deadlines, or items requiring your attention.
      </p>
      <Button variant="outline" onClick={onAddTask}>
        <Plus className="w-4 h-4 mr-1" />
        Add a personal task
      </Button>
    </div>
  )
}
