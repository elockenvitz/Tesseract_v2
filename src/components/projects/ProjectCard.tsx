import { useState, useRef, useEffect } from 'react'
import {
  Clock, Users, Calendar, Tag, ChevronDown, Check,
  MoreHorizontal, Trash2
} from 'lucide-react'
import { clsx } from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import { Card } from '../ui/Card'
import { DatePicker } from '../ui/DatePicker'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'
import {
  getStatusConfig,
  getPriorityConfig,
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  daysOverdue,
  overdueEmphasis,
} from '../../lib/project-config'

// ── Types ────────────────────────────────────────────────────

interface ProjectCardProps {
  project: ProjectWithAssignments
  currentUserId: string | undefined
  onSelect?: (project: any) => void
  onStatusChange?: (projectId: string, status: ProjectStatus) => void
  onPriorityChange?: (projectId: string, priority: ProjectPriority) => void
  onDueDateChange?: (projectId: string, dueDate: string | null) => void
  onDelete?: (projectId: string, projectTitle: string) => void
  onAddTag?: (projectId: string, tagId: string) => void
  onRemoveTag?: (projectId: string, tagId: string) => void
  onCreateTag?: (name: string, color: string) => void
  allTags?: Array<{ id: string; name: string; color: string }>
  viewFilter?: 'active' | 'archived'
}

// ── Overdue Badge ────────────────────────────────────────────

function OverdueBadge({ dueDate, status, priority }: {
  dueDate: string | null
  status: ProjectStatus
  priority: ProjectPriority
}) {
  const days = daysOverdue(dueDate, status)
  if (days === 0) return null

  const emphasis = overdueEmphasis(dueDate, status, priority)
  return (
    <span
      className={clsx(
        'text-[10px] font-medium',
        emphasis === 'strong' ? 'text-red-600' : 'text-gray-400',
      )}
    >
      {days}d overdue
    </span>
  )
}

// ── Priority Pill with tooltip ───────────────────────────────

function PriorityPill({ priority, onClick }: {
  priority: ProjectPriority
  onClick?: (e: React.MouseEvent) => void
}) {
  const config = getPriorityConfig(priority)
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
        config.pillClasses,
        onClick && 'hover:shadow-sm cursor-pointer'
      )}
      title="Execution urgency"
    >
      {config.label}
      {onClick && <ChevronDown className="w-2.5 h-2.5 opacity-50" />}
    </button>
  )
}

// ── Status Pill ──────────────────────────────────────────────

function StatusPill({ status, onClick }: {
  status: ProjectStatus
  onClick?: (e: React.MouseEvent) => void
}) {
  const config = getStatusConfig(status)
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
        config.pillClasses,
        onClick && 'hover:shadow-sm cursor-pointer'
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', config.dotColor)} />
      {config.label}
      {onClick && <ChevronDown className="w-2.5 h-2.5 opacity-50" />}
    </button>
  )
}

// ── Inline Dropdown ──────────────────────────────────────────

function InlineDropdown<T extends string>({
  open,
  onClose,
  items,
  activeValue,
  onSelect,
  anchorRect,
}: {
  open: boolean
  onClose: () => void
  items: Array<{ id: T; label: string; dotColor?: string }>
  activeValue: T
  onSelect: (value: T) => void
  anchorRect: DOMRect | null
}) {
  if (!open || !anchorRect) return null
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); onClose() }} />
      <div
        className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[140px] z-20"
        style={{ left: `${anchorRect.left}px`, top: `${anchorRect.bottom + 4}px` }}
      >
        {items.map(item => (
          <button
            key={item.id}
            onClick={(e) => { e.stopPropagation(); onSelect(item.id); onClose() }}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-[6px] text-[12px] transition-colors',
              activeValue === item.id ? 'bg-gray-50 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-50'
            )}
          >
            {item.dotColor && <span className={clsx('w-2 h-2 rounded-full', item.dotColor)} />}
            <span className="flex-1">{item.label}</span>
            {activeValue === item.id && <Check className="w-3.5 h-3.5 text-primary-500" />}
          </button>
        ))}
      </div>
    </>
  )
}

// ── Main Card ────────────────────────────────────────────────

export function ProjectCard({
  project,
  currentUserId,
  onSelect,
  onStatusChange,
  onPriorityChange,
  onDueDateChange,
  onDelete,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  allTags,
  viewFilter = 'active',
}: ProjectCardProps) {
  const [dropdown, setDropdown] = useState<{ type: 'status' | 'priority' | 'tags' | 'kebab'; rect: DOMRect } | null>(null)
  const [tagSearch, setTagSearch] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const kebabRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdown) return
    const handler = (e: MouseEvent) => {
      if (kebabRef.current?.contains(e.target as Node)) return
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdown])

  const priorityConfig = getPriorityConfig(project.priority)
  const totalDeliverables = project.project_deliverables?.length || 0
  const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
  const progressPercent = totalDeliverables > 0 ? Math.round((completedDeliverables / totalDeliverables) * 100) : 0
  const assignmentCount = project.project_assignments?.length || 0
  const isOwner = project.created_by === currentUserId

  const tags = project.project_tag_assignments || []
  const visibleTags = tags.slice(0, 3)
  const overflowCount = tags.length - 3

  const openDropdown = (type: typeof dropdown extends null ? never : NonNullable<typeof dropdown>['type'], e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdown(dropdown?.type === type ? null : { type, rect })
  }

  return (
    <Card
      className={clsx(
        'group relative px-4 py-3 transition-all hover:shadow-md cursor-pointer border-l-2',
        priorityConfig.borderClass,
      )}
      onClick={() => onSelect?.({ id: project.id, title: project.title, type: 'project', data: project })}
    >
      {/* Row 1: Title + Status + Priority + Overdue + Tags + Kebab */}
      <div className="flex items-center gap-2 min-w-0">
        <h3
          className={clsx(
            'text-[14px] leading-tight truncate flex-shrink min-w-0',
            priorityConfig.titleClass
          )}
        >
          {project.title}
        </h3>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusPill
            status={project.status}
            onClick={isOwner ? (e) => openDropdown('status', e) : undefined}
          />
          <PriorityPill
            priority={project.priority}
            onClick={isOwner ? (e) => openDropdown('priority', e) : undefined}
          />
          <OverdueBadge dueDate={project.due_date} status={project.status} priority={project.priority} />
        </div>

        {/* Tags (truncated) */}
        {visibleTags.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0 ml-1">
            {visibleTags.map((a: any) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: a.project_tags.color + '15', color: a.project_tags.color }}
              >
                {a.project_tags.name}
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="text-[10px] text-gray-400 font-medium">+{overflowCount}</span>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Kebab menu */}
        {isOwner && (
          <div className="flex-shrink-0" ref={kebabRef}>
            <button
              onClick={(e) => openDropdown('kebab', e)}
              className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-100 text-gray-400"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Row 2: Description */}
      {project.description && (
        <p className={clsx(
          'text-[12px] mt-1 line-clamp-1',
          priorityConfig.metaClass
        )}>
          {project.description}
        </p>
      )}

      {/* Row 3: Progress + metadata grid */}
      <div className={clsx('flex items-center gap-4 mt-2 text-[11px]', priorityConfig.metaClass)}>
        {/* Progress */}
        {totalDeliverables > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-28 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full rounded-full transition-all duration-300',
                  completedDeliverables === totalDeliverables ? 'bg-emerald-500'
                    : completedDeliverables > 0 ? 'bg-primary-500'
                    : 'bg-gray-300'
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="tabular-nums font-medium">{completedDeliverables}/{totalDeliverables} tasks</span>
          </div>
        )}

        {/* Assignees */}
        {assignmentCount > 0 && (
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>{assignmentCount}</span>
          </div>
        )}

        {/* Due date */}
        {isOwner && onDueDateChange ? (
          <div onClick={(e) => e.stopPropagation()}>
            <DatePicker
              value={project.due_date}
              onChange={(date) => onDueDateChange(project.id, date)}
              placeholder="Set due date"
              variant="inline"
              showOverdue
              isCompleted={project.status === 'completed'}
              allowPastDates
            />
          </div>
        ) : project.due_date ? (
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            <span>{format(new Date(project.due_date), 'MMM d')}</span>
          </div>
        ) : null}

        {/* Updated */}
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{formatDistanceToNow(new Date(project.updated_at || project.created_at), { addSuffix: true })}</span>
        </div>
      </div>

      {/* ── Dropdowns ── */}

      {/* Status dropdown */}
      <InlineDropdown
        open={dropdown?.type === 'status'}
        onClose={() => setDropdown(null)}
        items={PROJECT_STATUSES.filter(s => s.id !== 'cancelled').map(s => ({ id: s.id, label: s.label, dotColor: s.dotColor }))}
        activeValue={project.status}
        onSelect={(s) => onStatusChange?.(project.id, s)}
        anchorRect={dropdown?.type === 'status' ? dropdown.rect : null}
      />

      {/* Priority dropdown */}
      <InlineDropdown
        open={dropdown?.type === 'priority'}
        onClose={() => setDropdown(null)}
        items={PROJECT_PRIORITIES.map(p => ({ id: p.id, label: p.label }))}
        activeValue={project.priority}
        onSelect={(p) => onPriorityChange?.(project.id, p)}
        anchorRect={dropdown?.type === 'priority' ? dropdown.rect : null}
      />

      {/* Kebab menu */}
      {dropdown?.type === 'kebab' && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setDropdown(null) }} />
          <div
            className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] z-20"
            style={{ left: `${dropdown.rect.right - 160}px`, top: `${dropdown.rect.bottom + 4}px` }}
          >
            {/* Add tag */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setDropdown({ type: 'tags', rect: dropdown.rect })
                setTagSearch('')
              }}
              className="w-full flex items-center gap-2 px-3 py-[6px] text-[12px] text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Tag className="w-3.5 h-3.5" />
              Manage tags
            </button>
            {/* Delete */}
            {viewFilter === 'active' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setDropdown(null)
                  onDelete?.(project.id, project.title)
                }}
                className="w-full flex items-center gap-2 px-3 py-[6px] text-[12px] text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Cancel project
              </button>
            )}
          </div>
        </>
      )}

      {/* Tags dropdown */}
      {dropdown?.type === 'tags' && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setDropdown(null) }} />
          <div
            className="fixed bg-white rounded-lg shadow-xl border border-gray-200 p-3 w-60 z-20"
            style={{ left: `${dropdown.rect.left}px`, top: `${dropdown.rect.bottom + 4}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Search tags..."
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-400"
                autoFocus
              />
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {allTags
                  ?.filter(tag => {
                    const q = tagSearch.toLowerCase()
                    const matches = tag.name.toLowerCase().includes(q)
                    const assigned = tags.some((a: any) => a.tag_id === tag.id)
                    return matches && !assigned
                  })
                  .map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => onAddTag?.(project.id, tag.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] hover:bg-gray-50 transition-colors"
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  ))}
              </div>
              <div className="border-t border-gray-100 pt-2 flex gap-1.5">
                <input
                  type="text"
                  placeholder="New tag..."
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTagName.trim()) {
                      onCreateTag?.(newTagName.trim(), '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'))
                      setNewTagName('')
                    }
                  }}
                  className="flex-1 min-w-0 px-2 py-1.5 text-[12px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-400"
                />
                <button
                  onClick={() => {
                    if (newTagName.trim()) {
                      onCreateTag?.(newTagName.trim(), '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'))
                      setNewTagName('')
                    }
                  }}
                  disabled={!newTagName.trim()}
                  className="px-2.5 py-1.5 text-[11px] font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
