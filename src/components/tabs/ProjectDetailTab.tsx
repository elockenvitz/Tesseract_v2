import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  FolderKanban,
  Calendar,
  Users,
  CheckCircle,
  Circle,
  Clock,
  AlertCircle,
  Ban,
  Plus,
  Trash2,
  User,
  UserPlus,
  MessageSquare,
  Edit,
  X,
  Activity,
  Search,
  Link2,
  Building2,
  Check,
  UserCheck,
  ChevronDown,
  ChevronLeft,
  MoreHorizontal,
  Crown,
  Users2,
  Reply,
  ChevronRight,
  Heart,
  CheckCheck,
  AtSign,
  Pencil,
  Flag,
  Target,
  Lock,
  ArrowRight,
  GripVertical,
  ArrowUpDown,
  ListPlus,
  CircleCheck,
  Filter
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import { Select } from '../ui/Select'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow, format, differenceInDays, startOfDay, parseISO } from 'date-fns'
import { clsx } from 'clsx'
import { getStatusConfig } from '../../lib/project-config'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'
import { useAuth } from '../../hooks/useAuth'
import { ProjectActivityFeed } from '../projects/ProjectActivityFeed'
import { DependencyManager } from '../projects/DependencyManager'
import { DatePicker } from '../ui/DatePicker'
import { useProjectDependencies } from '../../hooks/useProjectDependencies'
import { MentionInput } from '../ui/MentionInput'
import { OrgSwitchBanner } from '../common/OrgSwitchBanner'
import { useEntityOrgResolver } from '../../hooks/useEntityOrgResolver'

// Project detail tab component

interface ProjectDetailTabProps {
  project: ProjectWithAssignments
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
}

// Sortable deliverable item component
interface SortableDeliverableProps {
  deliverable: any
  priorityNumber: number | null
  canManageProject: boolean
  canCompleteDeliverables: boolean
  onToggle: () => void
  onRename: (title: string) => void
  onDelete: () => void
  onAssigneeClick: () => void
  isAssigneeDropdownOpen: boolean
  teamMembers: any[]
  onAddAssignee: (userId: string) => void
  onRemoveAssignee: (userId: string) => void
  onDueDateChange: (date: string | null) => void
  projectDueDate: string | null
  isDragDisabled?: boolean
  isJustDropped?: boolean
}

function SortableDeliverableItem({
  deliverable,
  priorityNumber,
  canManageProject,
  canCompleteDeliverables,
  onToggle,
  onRename,
  onDelete,
  onAssigneeClick,
  isAssigneeDropdownOpen,
  teamMembers,
  onAddAssignee,
  onRemoveAssignee,
  onDueDateChange,
  projectDueDate,
  isDragDisabled = false,
  isJustDropped = false
}: SortableDeliverableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: deliverable.id,
    disabled: isDragDisabled || deliverable.completed
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ? 'transform 150ms ease' : undefined,
    opacity: isDragging ? 0 : 1
  }

  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(deliverable.title)

  const assignments = deliverable.deliverable_assignments || []
  const isOverdue = deliverable.due_date && !deliverable.completed && new Date(deliverable.due_date) < new Date()

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        /* One divided list on a phone, not a stack of cards.

           Each row was its own bordered, shadowed, rounded card with 8px of
           air between them, so four deliverables read as four objects with
           three gaps rather than as a list — and the borders at that density
           are visual noise competing with the task text. On a phone the card
           chrome comes off and a single hairline divides the rows; the list's
           container carries the one border. Desktop keeps the cards. */
        'flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 sm:py-3 bg-white dark:bg-gray-800 group',
        'max-sm:border-b max-sm:border-gray-100 dark:max-sm:border-gray-700/60 max-sm:last:border-b-0',
        'sm:rounded-lg sm:border sm:border-gray-200 dark:sm:border-gray-700 sm:hover:border-gray-300 dark:sm:hover:border-gray-600 sm:shadow-sm',
        deliverable.completed && 'bg-gray-50 dark:bg-gray-800/50',
        isJustDropped && 'animate-drop-pop'
      )}
    >
      {/* Drag handle - only show in priority mode for incomplete items */}
      {canManageProject && !deliverable.completed && !isDragDisabled && (
        <button
          {...attributes}
          {...listeners}
          aria-label={`Reorder "${deliverable.title}"`}
          /* `no-touch-target` + `tap-pad`: the grip was a 44px block on a
             phone, which is an eighth of the row spent on a handle. The
             thumb target stays; the drawn icon is 14px. */
          className="no-touch-target tap-pad flex-shrink-0 p-0.5 -ml-1 sm:p-1 sm:-ml-2 cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 touch-none"
        >
          <GripVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      )}

      {/* Priority number */}
      {/* The ordinal restates the row's own position, which a list already
          shows. Desktop keeps it; a phone spends the width on the task. */}
      {priorityNumber !== null && (
        <span className={clsx(
          'hidden sm:flex flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold items-center justify-center',
          deliverable.completed
            ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
            : 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
        )}>
          {priorityNumber}
        </span>
      )}

      {/* Completion checkbox */}
      {/* Completion.

          Two problems, both about the control saying nothing: the
          coarse-pointer rule inflated it into a 44px circle that dominated
          the row, and a bare ring with no label does not say it means "done"
          or that it toggles back. `no-touch-target` + `tap-pad` keeps the
          44px thumb around an 18px ring, and the label says which way the
          tap goes — so it reads as a checkbox, which is what it is. */}
      <button
        onClick={onToggle}
        disabled={!canCompleteDeliverables}
        role="checkbox"
        aria-checked={deliverable.completed}
        aria-label={deliverable.completed ? `Mark "${deliverable.title}" not done` : `Mark "${deliverable.title}" done`}
        title={deliverable.completed ? 'Mark not done' : 'Mark done'}
        /* `!` on the size: `index.css` gives every button a 44px minimum on
           a coarse pointer, and `no-touch-target` opts out of that — but the
           opt-out only removes the minimum, it does not stop anything else
           from sizing the box. Stating the size as important is what makes
           the drawn circle 16px on a real phone rather than something that
           merely should be. `tap-pad` keeps the thumb target. */
        /* A rounded square with a filled ground and a visible border, not a
           thin ring.

           Shrinking the circle to 16px with a 1.5px gray-300 outline made it
           effectively disappear on white — the complaint went from "massive
           circles" straight to "I don't see how to complete one", which is
           the same control failing in the opposite direction. A square with
           a border and a tinted ground reads as a checkbox at a glance, and
           a faint tick showing on hover/idle says what it will do. 20px
           drawn, 44px thumb via `tap-pad`. */
        className={clsx(
          'no-touch-target tap-pad !w-5 !h-5 !min-w-0 !min-h-0 rounded-[6px] border flex items-center justify-center transition-colors flex-shrink-0 p-0',
          deliverable.completed
            ? 'bg-primary-500 border-primary-500'
            : 'bg-gray-50 dark:bg-gray-700/60 border-gray-300 dark:border-gray-500 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20',
          !canCompleteDeliverables && 'opacity-50 cursor-not-allowed'
        )}
      >
        <Check
          className={clsx(
            'w-3.5 h-3.5',
            deliverable.completed
              ? 'text-white'
              : 'text-gray-300 dark:text-gray-500'
          )}
        />
      </button>

      {/* Title */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => {
              const next = renameValue.trim()
              if (next && next !== deliverable.title) onRename(next)
              setIsRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.currentTarget.blur() }
              if (e.key === 'Escape') { setRenameValue(deliverable.title); setIsRenaming(false) }
            }}
            className="flex-1 min-w-0 bg-transparent border-b border-primary-400 text-[13px] sm:text-sm text-gray-900 dark:text-white focus:outline-none"
          />
        ) : (
          <span
            onClick={() => {
              if (!canManageProject || deliverable.completed) return
              setRenameValue(deliverable.title)
              setIsRenaming(true)
            }}
            title={canManageProject && !deliverable.completed ? 'Tap to rename' : undefined}
            className={clsx(
              'text-[13px] sm:text-sm truncate',
              canManageProject && !deliverable.completed && 'cursor-text',
              deliverable.completed
                ? 'line-through text-gray-400 dark:text-gray-500'
                : 'text-gray-900 dark:text-white'
            )}
          >
            {deliverable.title}
          </span>
        )}
        {/* Link indicator for deliverables from comments */}
        {deliverable.source_comment_id && (
          <span
            className="flex-shrink-0 text-gray-400 dark:text-gray-500"
            title="Created from comment"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        {/* Assignees */}
        {teamMembers && teamMembers.length > 0 && (
          <div className="relative" data-dropdown>
            {canManageProject ? (
              <button
                onClick={onAssigneeClick}
                className="flex items-center"
              >
                {assignments.length > 0 ? (
                  <div className="flex gap-1">
                    {assignments.slice(0, 3).map((assignment: any) => {
                      const initials = (assignment.user?.first_name?.[0] || '') + (assignment.user?.last_name?.[0] || '') || assignment.user?.email?.[0]?.toUpperCase()
                      return (
                        <div
                          key={assignment.id}
                          className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-[10px] font-medium flex items-center justify-center"
                          title={`${assignment.user?.first_name || ''} ${assignment.user?.last_name || ''}`.trim() || assignment.user?.email}
                        >
                          {initials}
                        </div>
                      )
                    })}
                    {assignments.length > 3 && (
                      <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 text-[10px] font-medium flex items-center justify-center">
                        +{assignments.length - 3}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    <UserPlus className="w-3.5 h-3.5" />
                  </div>
                )}
              </button>
            ) : (
              assignments.length > 0 && (
                <div className="flex gap-1">
                  {assignments.slice(0, 3).map((assignment: any) => {
                    const initials = (assignment.user?.first_name?.[0] || '') + (assignment.user?.last_name?.[0] || '') || assignment.user?.email?.[0]?.toUpperCase()
                    return (
                      <div
                        key={assignment.id}
                        className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-[10px] font-medium flex items-center justify-center"
                        title={`${assignment.user?.first_name || ''} ${assignment.user?.last_name || ''}`.trim() || assignment.user?.email}
                      >
                        {initials}
                      </div>
                    )
                  })}
                </div>
              )
            )}

            {/* Assignee dropdown */}
            {canManageProject && isAssigneeDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[200px]">
                <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  Assign to
                </div>
                {teamMembers.map((member: any) => {
                  const isAssigned = assignments.some((a: any) => a.user_id === member.assigned_to)
                  const initials = (member.user?.first_name?.[0] || '') + (member.user?.last_name?.[0] || '') || member.user?.email?.[0]?.toUpperCase()
                  const fullName = `${member.user?.first_name || ''} ${member.user?.last_name || ''}`.trim() || member.user?.email?.split('@')[0]
                  return (
                    <button
                      key={member.assigned_to}
                      type="button"
                      onClick={() => {
                        if (isAssigned) {
                          onRemoveAssignee(member.assigned_to)
                        } else {
                          onAddAssignee(member.assigned_to)
                        }
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <div className={clsx(
                        'w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0',
                        isAssigned
                          ? 'bg-primary-600 border-primary-600'
                          : 'border-gray-300 dark:border-gray-600'
                      )}>
                        {isAssigned && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 text-[10px] font-medium flex items-center justify-center flex-shrink-0">
                        {initials}
                      </span>
                      <span className={clsx(
                        'truncate',
                        isAssigned ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-700 dark:text-gray-300'
                      )}>
                        {fullName}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Due date */}
        {canManageProject ? (
          <DatePicker
            value={deliverable.due_date}
            onChange={onDueDateChange}
            placeholder="Due"
            variant="inline"
            compact
            maxDate={projectDueDate}
            projectDueDate={projectDueDate}
            isCompleted={deliverable.completed}
          />
        ) : deliverable.due_date ? (
          <span className={clsx(
            'text-[11px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded shrink-0',
            isOverdue
              ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
              : 'text-gray-500 dark:text-gray-400'
          )}>
            {format(new Date(deliverable.due_date), 'MMM d')}
          </span>
        ) : null}

        {/* Delete. Quiet and small: it is the least-used control in the row
            and was taking the same 44px as the task's own affordances. The
            phone layer reveals it (there is no hover to reveal it with), so
            it is deliberately low-contrast rather than hidden. */}
        {canManageProject && (
          <button
            onClick={onDelete}
            aria-label={`Delete "${deliverable.title}"`}
            className="no-touch-target tap-pad p-0.5 text-gray-300 dark:text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * An empty section that does not ask for attention.
 *
 * "No overdue tasks" was rendering in the same 4-padded card, with the same
 * icon chip and the same heading weight, as three genuinely overdue tasks —
 * so a healthy project and a project in trouble looked equally busy, and on a
 * phone two of these filled the screen before anything real. Good news gets
 * one line.
 */
function QuietEmpty({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-3 py-2 text-[13px] text-gray-400 dark:text-gray-500">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {label}
    </div>
  )
}

export function ProjectDetailTab({ project, onNavigate }: ProjectDetailTabProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'deliverables' | 'team' | 'dependencies' | 'comments' | 'activity'>('overview')
  const tabRailRef = useRef<HTMLDivElement>(null)

  /**
   * Whether the phone shows the full project summary or the one-line version.
   *
   * The summary is permanent chrome above six reports, and at ~180px it was
   * taking a fifth of the viewport away from whichever report the user came
   * to read. Collapsed it is one line — name, state, progress — which is
   * enough to know where you are, and the report gets the screen.
   *
   * Explicit, and remembered per project for the life of the tab. It is one
   * boolean over ONE rendering of the summary, not a second compact copy:
   * every field below is the same element either way, shown or hidden. A
   * duplicate would be two things to keep in sync and two announcements to a
   * screen reader.
   *
   * Desktop never reads this — the summary is always expanded there.
   */
  const [summaryCollapsed, setSummaryCollapsed] = useState(false)

  /**
   * Which comment has its secondary actions showing, on a phone.
   *
   * Six actions in a comment's action row do not fit 390px. Wrapping them
   * stopped the clipping but gave Edit and Delete the same weight as Reply,
   * on a row that repeats under every comment. Like, Reply and Resolve stay
   * inline; Edit, Delete and + Task sit behind `⋯`. One id, so opening one
   * comment's menu closes another's.
   */
  const [openCommentActions, setOpenCommentActions] = useState<string | null>(null)

  /**
   * Keep the selected tab fully on screen, centred where there is room.
   *
   * The rail is wider than a phone, so the tab you are on can be the one that
   * is half cut off — which is the opposite of what a rail is for. This runs
   * on selection and on mount, so arriving on a tab deep in the strip (a
   * dependency link lands on `dependencies`) shows it whole rather than
   * leaving the user to scroll to find where they are.
   *
   * `scroll-px-4` on the container is what keeps a centred-by-clamping tab
   * off the bezel when it is first or last. `inline: 'center'` is a no-op on
   * a desktop, where the rail does not overflow.
   */
  useLayoutEffect(() => {
    const rail = tabRailRef.current
    if (!rail || rail.scrollWidth <= rail.clientWidth) return
    const current = rail.querySelector<HTMLElement>(`[data-tab-id="${activeTab}"]`)
    current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeTab])

  const [newDeliverable, setNewDeliverable] = useState('')
  const [newDeliverableDueDate, setNewDeliverableDueDate] = useState<string | null>(null)
  const [newDeliverableAssignees, setNewDeliverableAssignees] = useState<string[]>([])
  const [openAssigneeDropdown, setOpenAssigneeDropdown] = useState<string | null>(null)
  const [showNewDeliverableAssignees, setShowNewDeliverableAssignees] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [commentMentions, setCommentMentions] = useState<string[]>([])
  const [commentReferences, setCommentReferences] = useState<Array<{ type: string; id: string; text: string }>>([])
  const [reprioritizeType, setReprioritizeType] = useState<'none' | 'project' | 'deliverable'>('none')
  const [reprioritizeTarget, setReprioritizeTarget] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [replyMentions, setReplyMentions] = useState<string[]>([])
  const [replyReferences, setReplyReferences] = useState<Array<{ type: string; id: string; text: string }>>([])
  const [replyReprioritizeType, setReplyReprioritizeType] = useState<'none' | 'project' | 'deliverable'>('none')
  const [replyReprioritizeTarget, setReplyReprioritizeTarget] = useState<string | null>(null)
  const [collapsedComments, setCollapsedComments] = useState<Set<string>>(new Set())
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentContent, setEditCommentContent] = useState('')
  const [commentFilter, setCommentFilter] = useState<'all' | 'unresolved' | 'mentions' | 'actionable' | 'mine'>('all')
  const [commentSort, setCommentSort] = useState<'newest' | 'oldest'>('newest')
  const [convertToDeliverableModal, setConvertToDeliverableModal] = useState<{
    commentId: string
    title: string
    description: string
    dueDate: string
    assignees: string[]
    showAssigneeDropdown: boolean
  } | null>(null)
  const [editingProject, setEditingProject] = useState(false)
  const [editedTitle, setEditedTitle] = useState(project.title)
  const [editedDescription, setEditedDescription] = useState(project.description || '')
  const [editedStatus, setEditedStatus] = useState(project.status)
  const [editedPriority, setEditedPriority] = useState(project.priority)
  const [editedDueDate, setEditedDueDate] = useState(project.due_date || '')
  const [showAddMemberForm, setShowAddMemberForm] = useState(false)
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const [teamTab, setTeamTab] = useState<'users' | 'groups'>('users')
  const [pendingRemoveMemberId, setPendingRemoveMemberId] = useState<string | null>(null)
  const [pendingRemoveGroupId, setPendingRemoveGroupId] = useState<string | null>(null)
  const [openRoleDropdown, setOpenRoleDropdown] = useState<string | null>(null)
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Set<string>>(new Set())
  const [deliverableSortMode, setDeliverableSortMode] = useState<'priority' | 'due_date'>('priority')
  const [activeDeliverableId, setActiveDeliverableId] = useState<string | null>(null)
  const [optimisticOrder, setOptimisticOrder] = useState<any[] | null>(null)
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null)

  // Fetch fresh project data to ensure we have the latest creator info
  const { data: freshProject, isError: freshProjectError } = useQuery({
    queryKey: ['project-detail', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          creator:users!created_by(id, email, first_name, last_name)
        `)
        .eq('id', project.id)
        .single()

      if (error) throw error
      return data
    }
  })

  // Deep-link safety: if fresh fetch fails (RLS), check if project belongs to another org
  const { targetOrg: projectTargetOrg } = useEntityOrgResolver(
    'projects',
    project.id,
    freshProjectError
  )

  // Merge fresh project data with prop data (fresh takes precedence)
  const projectData = freshProject ? { ...project, ...freshProject } : project

  // Fetch deliverables with multiple assignees
  const { data: deliverables } = useQuery({
    queryKey: ['project-deliverables', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_deliverables')
        .select(`
          *,
          deliverable_assignments(
            id,
            user_id,
            assigned_at,
            user:users!user_id(id, first_name, last_name, email)
          )
        `)
        .eq('project_id', project.id)
        .order('display_order', { ascending: true })

      if (error) throw error
      return data || []
    }
  })

  // Fetch comments with reactions
  const { data: comments, error: commentsError } = useQuery({
    queryKey: ['project-comments', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_comments')
        .select(`
          *,
          user:users!user_id(id, first_name, last_name, email),
          project_comment_reactions(id, user_id, reaction_type)
        `)
        .eq('project_id', project.id)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data || []
    }
  })

  // Log comments error for debugging
  if (commentsError) {
    console.error('Error fetching comments:', commentsError)
  }

  // Organize comments into tree structure
  const commentTree = useMemo(() => {
    if (!comments) return []

    // Apply filter first
    const filteredComments = comments.filter((comment: any) => {
      switch (commentFilter) {
        case 'unresolved':
          return !comment.resolved_at
        case 'mentions':
          return comment.metadata?.mentions?.length > 0
        case 'actionable':
          return comment.metadata?.reprioritize || comment.metadata?.mentions?.length > 0
        case 'mine':
          return comment.user_id === user?.id
        default:
          return true
      }
    })

    const commentMap = new Map()
    const rootComments: any[] = []

    // First pass: create map of all comments
    filteredComments.forEach((comment: any) => {
      commentMap.set(comment.id, { ...comment, replies: [] })
    })

    // Second pass: build tree structure
    filteredComments.forEach((comment: any) => {
      const commentWithReplies = commentMap.get(comment.id)
      if (comment.parent_id) {
        const parent = commentMap.get(comment.parent_id)
        if (parent) {
          parent.replies.push(commentWithReplies)
        }
      } else {
        rootComments.push(commentWithReplies)
      }
    })

    // Sort root comments
    rootComments.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime()
      const dateB = new Date(b.created_at).getTime()
      return commentSort === 'newest' ? dateB - dateA : dateA - dateB
    })

    return rootComments
  }, [comments, commentFilter, commentSort, user?.id])

  // Fetch team members with user details
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['project-team', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_assignments')
        .select(`
          *,
          user:users!assigned_to(id, first_name, last_name, email),
          assigner:users!assigned_by(id, first_name, last_name, email)
        `)
        .eq('project_id', project.id)

      if (error) {
        console.error('Error fetching team members:', error)
        throw error
      }
      return data || []
    }
  })

  // Check if user can manage the project (owner or lead)
  // Owners and leads can: add/edit/delete deliverables, change due dates, manage team, assign people
  // Collaborators can only: view project and mark deliverables as complete
  const canManageProject = useMemo(() => {
    if (!user) return false
    // Project creator is always a manager
    if (projectData.created_by === user.id) return true
    // Check if user is a lead
    const userAssignment = teamMembers.find((m: any) => m.assigned_to === user.id)
    return userAssignment?.role === 'lead'
  }, [user, projectData.created_by, teamMembers])

  // Check if user can complete deliverables (any team member can)
  const canCompleteDeliverables = useMemo(() => {
    if (!user) return false
    // Project creator can always complete
    if (projectData.created_by === user.id) return true
    // Any team member can complete deliverables
    return teamMembers.some((m: any) => m.assigned_to === user.id)
  }, [user, projectData.created_by, teamMembers])

  // Fetch all users for team member search
  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users-for-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('is_active', true)
        .order('first_name')

      if (error) throw error
      return data || []
    }
  })

  // Fetch org groups with parent info - always fetch to have data ready
  const { data: orgGroups = [] } = useQuery({
    queryKey: ['org-groups-for-project-team'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_org_chart_nodes_v')
        .select('id, name, node_type, parent_id')
        .order('name')
      if (error) throw error
      return data || []
    }
  })

  // Fetch org group memberships - always fetch to have data ready
  const { data: orgMemberships = [] } = useQuery({
    queryKey: ['org-memberships-for-project-team'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .select('user_id, node_id')
      if (error) throw error
      return data || []
    }
  })

  // Fetch org groups associated with this project
  const { data: projectOrgGroups = [] } = useQuery({
    queryKey: ['project-org-groups', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_org_groups')
        .select(`
          id,
          org_group_id,
          added_at,
          org_group:org_chart_nodes(id, name, node_type)
        `)
        .eq('project_id', project.id)
      if (error) {
        console.error('Error fetching project org groups:', error)
        throw error
      }
      return data || []
    }
  })

  // Fetch project dependencies for overview
  const { blockedBy, blocking, isBlocked } = useProjectDependencies({ projectId: project.id })

  // Build map of org group -> member user ids (including child nodes)
  const orgGroupMembers = useMemo(() => {
    if (orgGroups.length === 0) return new Map<string, string[]>()

    // Build parent-child map (parent_id -> array of child node ids)
    const childrenMap = new Map<string, string[]>()
    for (const node of orgGroups) {
      if (node.parent_id) {
        const existing = childrenMap.get(node.parent_id)
        if (existing) {
          existing.push(node.id)
        } else {
          childrenMap.set(node.parent_id, [node.id])
        }
      }
    }

    // Build direct members map (node_id -> array of user_ids)
    const directMembersMap = new Map<string, string[]>()
    for (const m of orgMemberships) {
      const existing = directMembersMap.get(m.node_id)
      if (existing) {
        existing.push(m.user_id)
      } else {
        directMembersMap.set(m.node_id, [m.user_id])
      }
    }

    // Recursively get all members including from child nodes
    const getAllMembers = (nodeId: string): string[] => {
      const members = new Set<string>()

      // Add direct members of this node
      const direct = directMembersMap.get(nodeId)
      if (direct) {
        for (const userId of direct) {
          members.add(userId)
        }
      }

      // Recursively add members from all child nodes
      const children = childrenMap.get(nodeId)
      if (children) {
        for (const childId of children) {
          const childMembers = getAllMembers(childId)
          for (const userId of childMembers) {
            members.add(userId)
          }
        }
      }

      return Array.from(members)
    }

    // Build final map with hierarchical members for each node
    const map = new Map<string, string[]>()
    for (const node of orgGroups) {
      map.set(node.id, getAllMembers(node.id))
    }

    return map
  }, [orgGroups, orgMemberships])

  // Filter org groups based on search and exclude already associated groups
  const filteredOrgGroups = useMemo(() => {
    if (!orgGroups) return []
    const associatedGroupIds = projectOrgGroups.map((pg: any) => pg.org_group_id)
    let filtered = orgGroups.filter(g => !associatedGroupIds.includes(g.id))
    if (memberSearchQuery.trim()) {
      const query = memberSearchQuery.toLowerCase()
      filtered = filtered.filter(g => g.name.toLowerCase().includes(query))
    }
    return filtered
  }, [orgGroups, memberSearchQuery, projectOrgGroups])

  // Filter users based on search and exclude existing members
  const availableUsers = useMemo(() => {
    if (allUsers.length === 0) return []
    const existingMemberIds = teamMembers?.map((m: any) => m.assigned_to) || []
    // Also exclude the project creator
    const excludeIds = [...existingMemberIds, projectData.created_by].filter(Boolean)
    return allUsers.filter(u => {
      if (excludeIds.includes(u.id)) return false
      if (!memberSearchQuery) return true
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase()
      const email = u.email?.toLowerCase() || ''
      const query = memberSearchQuery.toLowerCase()
      return fullName.includes(query) || email.includes(query)
    })
  }, [allUsers, teamMembers, memberSearchQuery, projectData.created_by])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setOpenAssigneeDropdown(null)
        setShowNewDeliverableAssignees(false)
        setOpenRoleDropdown(null)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Add team member mutation
  const addTeamMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      // Check if already a member to avoid duplicate insert
      const existingMemberIds = teamMembers?.map((m: any) => m.assigned_to) || []
      if (existingMemberIds.includes(userId)) {
        return { skipped: true, userId }
      }

      const { error } = await supabase
        .from('project_assignments')
        .insert({
          project_id: project.id,
          assigned_to: userId,
          assigned_by: user?.id,
          role: 'collaborator'
        })

      if (error) {
        // Handle duplicate key error (409 Conflict)
        if (error.code === '23505') {
          return { skipped: true, userId }
        }
        throw error
      }
      return { skipped: false, userId }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['project-team', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setMemberSearchQuery('')
      // Track recently added for visual feedback
      if (result && !result.skipped) {
        setRecentlyAddedIds(prev => new Set([...prev, result.userId]))
        setTimeout(() => {
          setRecentlyAddedIds(prev => {
            const next = new Set(prev)
            next.delete(result.userId)
            return next
          })
        }, 2000)
      }
    }
  })

  // Add org group to project (creates association AND adds members)
  const addOrgGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      // First, create the project-org group association
      const { error: assocError } = await supabase
        .from('project_org_groups')
        .insert({
          project_id: project.id,
          org_group_id: groupId,
          added_by: user?.id
        })

      if (assocError) {
        console.error('Error associating org group:', assocError)
        // If it's a duplicate, continue to add members
        if (assocError.code !== '23505') {
          throw assocError
        }
      }

      // Then add the group members as team members
      const memberIds = orgGroupMembers.get(groupId) || []
      const existingMemberIds = teamMembers?.map((m: any) => m.assigned_to) || []
      const newMemberIds = memberIds.filter(id => !existingMemberIds.includes(id))

      if (newMemberIds.length > 0) {
        const assignments = newMemberIds.map(userId => ({
          project_id: project.id,
          assigned_to: userId,
          assigned_by: user?.id,
          role: 'collaborator'
        }))

        const { error } = await supabase
          .from('project_assignments')
          .insert(assignments)

        if (error && error.code !== '23505') {
          console.error('Error adding group members:', error)
          throw error
        }
      }

      return { groupId, addedCount: newMemberIds.length, addedIds: newMemberIds }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['project-team', project.id] })
      queryClient.invalidateQueries({ queryKey: ['project-org-groups', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setMemberSearchQuery('')
      // Track recently added for visual feedback
      if (result && result.addedIds && result.addedIds.length > 0) {
        setRecentlyAddedIds(prev => new Set([...prev, ...result.addedIds]))
        setTimeout(() => {
          setRecentlyAddedIds(prev => {
            const next = new Set(prev)
            result.addedIds?.forEach((id: string) => next.delete(id))
            return next
          })
        }, 2000)
      }
    },
    onError: (error) => {
      console.error('Failed to add group members:', error)
    }
  })

  // Remove org group association mutation
  const removeOrgGroupMutation = useMutation({
    mutationFn: async (associationId: string) => {
      const { error } = await supabase
        .from('project_org_groups')
        .delete()
        .eq('id', associationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-org-groups', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Remove team member mutation
  const removeTeamMemberMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from('project_assignments')
        .delete()
        .eq('id', assignmentId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-team', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Update team member role mutation
  const updateTeamMemberRoleMutation = useMutation({
    mutationFn: async ({ assignmentId, role }: { assignmentId: string; role: string }) => {
      const { error } = await supabase
        .from('project_assignments')
        .update({ role })
        .eq('id', assignmentId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-team', project.id] })
    }
  })

  // Update project mutation
  const updateProjectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('projects')
        .update({
          title: editedTitle,
          description: editedDescription,
          status: editedStatus,
          priority: editedPriority,
          due_date: editedDueDate || null
        })
        .eq('id', project.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setEditingProject(false)
    }
  })

  // Local state for due date, status, priority (to show immediate feedback since project prop may not update)
  // Use projectData which includes freshProject data, with fallbacks for when only id is passed
  const [localDueDate, setLocalDueDate] = useState(project.due_date)
  const [localStatus, setLocalStatus] = useState<ProjectStatus | undefined>(project.status)
  const [localPriority, setLocalPriority] = useState(project.priority)
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)
  const [showBlockedReasonModal, setShowBlockedReasonModal] = useState(false)
  const [blockedReasonInput, setBlockedReasonInput] = useState(project.blocked_reason || '')

  // Sync local state when project prop or freshProject changes
  useEffect(() => {
    const data = freshProject || project
    if (data.due_date !== undefined) setLocalDueDate(data.due_date)
    if (data.status !== undefined) setLocalStatus(data.status)
    if (data.priority !== undefined) setLocalPriority(data.priority)
    setBlockedReasonInput(data.blocked_reason || '')
  }, [project.due_date, project.status, project.priority, project.blocked_reason, freshProject])

  // Update project due date inline
  const updateProjectDueDateMutation = useMutation({
    mutationFn: async (dueDate: string | null) => {
      const { data, error } = await supabase
        .from('projects')
        .update({ due_date: dueDate })
        .eq('id', project.id)
        .select()

      if (error) {
        console.error('Error updating due date:', error)
        throw error
      }
      return data
    },
    onMutate: (dueDate) => {
      // Optimistically update local state
      setLocalDueDate(dueDate)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (error, _, context) => {
      console.error('Due date mutation failed:', error)
      // Revert on error
      setLocalDueDate(project.due_date)
    }
  })

  // Update project status inline
  const updateProjectStatusMutation = useMutation({
    mutationFn: async ({ status, blockedReason }: { status: ProjectStatus; blockedReason?: string | null }) => {
      const updateData: { status: ProjectStatus; blocked_reason?: string | null } = { status }

      // Only update blocked_reason if status is blocked, otherwise clear it
      if (status === 'blocked') {
        updateData.blocked_reason = blockedReason || null
      } else {
        updateData.blocked_reason = null
      }

      const { data, error } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', project.id)
        .select()

      if (error) {
        console.error('Error updating status:', error)
        throw error
      }
      return data
    },
    onMutate: ({ status }) => {
      setLocalStatus(status)
      setShowStatusDropdown(false)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project-detail', project.id] })
    },
    onError: (error) => {
      console.error('Status mutation failed:', error)
      setLocalStatus(project.status)
    }
  })

  // Update project priority inline
  const updateProjectPriorityMutation = useMutation({
    mutationFn: async (priority: ProjectPriority) => {
      const { data, error } = await supabase
        .from('projects')
        .update({ priority })
        .eq('id', project.id)
        .select()

      if (error) {
        console.error('Error updating priority:', error)
        throw error
      }
      return data
    },
    onMutate: (priority) => {
      setLocalPriority(priority)
      setShowPriorityDropdown(false)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project-detail', project.id] })
    },
    onError: (error) => {
      console.error('Priority mutation failed:', error)
      setLocalPriority(project.priority)
    }
  })

  // Add deliverable mutation
  const addDeliverableMutation = useMutation({
    mutationFn: async () => {
      // Create the deliverable first
      const { data: newDel, error } = await supabase
        .from('project_deliverables')
        .insert({
          project_id: project.id,
          title: newDeliverable,
          completed: false,
          due_date: newDeliverableDueDate
        })
        .select('id')
        .single()

      if (error) throw error

      // Add assignments if any assignees selected
      if (newDeliverableAssignees.length > 0 && newDel) {
        const assignments = newDeliverableAssignees.map(userId => ({
          deliverable_id: newDel.id,
          user_id: userId,
          assigned_by: user?.id
        }))

        const { error: assignError } = await supabase
          .from('deliverable_assignments')
          .insert(assignments)

        if (assignError) console.error('Error adding assignees:', assignError)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setNewDeliverable('')
      setNewDeliverableDueDate(null)
      setNewDeliverableAssignees([])
      setShowNewDeliverableAssignees(false)
    }
  })

  // Toggle deliverable completion mutation
  const toggleDeliverableMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string, completed: boolean }) => {
      const { error } = await supabase
        .from('project_deliverables')
        .update({ completed: !completed })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  /**
   * Rename a deliverable.
   *
   * There was no way to do this. A deliverable could be completed, assigned,
   * dated, reordered and deleted, but its title was fixed at creation — so a
   * typo meant deleting the task and losing its assignees and due date to
   * retype the name. Tapping the title opens it for editing; Enter or blur
   * commits, Escape abandons.
   */
  const renameDeliverableMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { error } = await supabase
        .from('project_deliverables')
        .update({ title })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  // Delete deliverable mutation
  const deleteDeliverableMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('project_deliverables')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Reorder deliverables mutation
  const reorderDeliverablesMutation = useMutation({
    mutationFn: async (updates: { id: string; display_order: number }[]) => {
      // Batch update all display_orders
      const promises = updates.map(({ id, display_order }) =>
        supabase
          .from('project_deliverables')
          .update({ display_order })
          .eq('id', id)
      )
      await Promise.all(promises)
    },
    onSuccess: async () => {
      // Refetch data first, then clear optimistic order
      await queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      setOptimisticOrder(null)
    },
    onError: () => {
      // On error, clear optimistic order to revert to original
      setOptimisticOrder(null)
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
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Add deliverable assignee mutation
  const addDeliverableAssigneeMutation = useMutation({
    mutationFn: async ({ deliverableId, userId }: { deliverableId: string, userId: string }) => {
      const { error } = await supabase
        .from('deliverable_assignments')
        .insert({
          deliverable_id: deliverableId,
          user_id: userId,
          assigned_by: user?.id
        })

      if (error && error.code !== '23505') throw error // Ignore duplicate key errors
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
    }
  })

  // Remove deliverable assignee mutation
  const removeDeliverableAssigneeMutation = useMutation({
    mutationFn: async ({ deliverableId, userId }: { deliverableId: string, userId: string }) => {
      const { error } = await supabase
        .from('deliverable_assignments')
        .delete()
        .eq('deliverable_id', deliverableId)
        .eq('user_id', userId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
    }
  })

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async (parentId?: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      const content = parentId ? replyContent : newComment
      const mentions = parentId ? replyMentions : commentMentions
      const reprioType = parentId ? replyReprioritizeType : reprioritizeType
      const reprioTarget = parentId ? replyReprioritizeTarget : reprioritizeTarget

      // Build reprioritization prefix if set
      let finalContent = content
      if (reprioType !== 'none') {
        const targetName = reprioType === 'project'
          ? 'this project'
          : deliverables?.find(d => d.id === reprioTarget)?.title || 'deliverable'
        finalContent = `🔄 **Reprioritization Suggestion** for ${targetName}:\n\n${content}`
      }

      const { error } = await supabase
        .from('project_comments')
        .insert({
          project_id: project.id,
          user_id: user.id,
          content: finalContent,
          parent_id: parentId || null,
          metadata: mentions.length > 0 || reprioType !== 'none' ? {
            mentions,
            reprioritize: reprioType !== 'none' ? { type: reprioType, target: reprioTarget } : null
          } : null
        })

      if (error) throw error
    },
    onSuccess: async (_, parentId) => {
      // Use refetchQueries to wait for the actual data to be fetched, not just invalidated
      await queryClient.refetchQueries({ queryKey: ['project-comments', project.id] })
      if (parentId) {
        setReplyContent('')
        setReplyingTo(null)
        setReplyMentions([])
        setReplyReferences([])
        setReplyReprioritizeType('none')
        setReplyReprioritizeTarget(null)
      } else {
        setNewComment('')
        setCommentMentions([])
        setCommentReferences([])
        setReprioritizeType('none')
        setReprioritizeTarget(null)
      }
    },
    onError: (error) => {
      console.error('Failed to add comment:', error)
    }
  })

  // Toggle reaction on comment (like, acknowledge)
  const toggleReactionMutation = useMutation({
    mutationFn: async ({ commentId, reactionType }: { commentId: string; reactionType: 'like' | 'acknowledge' }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Check if user already reacted
      const { data: existingReaction } = await supabase
        .from('project_comment_reactions')
        .select('id')
        .eq('comment_id', commentId)
        .eq('user_id', user.id)
        .eq('reaction_type', reactionType)
        .single()

      if (existingReaction) {
        // Remove reaction if already exists (toggle off)
        const { error } = await supabase
          .from('project_comment_reactions')
          .delete()
          .eq('id', existingReaction.id)
        if (error) throw error
      } else {
        // Add new reaction
        const { error } = await supabase
          .from('project_comment_reactions')
          .insert({
            comment_id: commentId,
            user_id: user.id,
            reaction_type: reactionType
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] })
    }
  })

  // Edit comment mutation
  const editCommentMutation = useMutation({
    mutationFn: async ({ commentId, content }: { commentId: string; content: string }) => {
      const { error } = await supabase
        .from('project_comments')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', commentId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] })
      setEditingCommentId(null)
      setEditCommentContent('')
    }
  })

  // Delete comment mutation
  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase
        .from('project_comments')
        .delete()
        .eq('id', commentId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] })
    }
  })

  // Toggle comment resolved status
  const toggleResolvedMutation = useMutation({
    mutationFn: async ({ commentId, resolved }: { commentId: string; resolved: boolean }) => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('project_comments')
        .update({
          resolved_at: resolved ? new Date().toISOString() : null,
          resolved_by: resolved ? user.id : null
        })
        .eq('id', commentId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] })
    },
    onError: (error) => {
      console.error('Failed to toggle resolved status:', error)
    }
  })

  // Convert comment to deliverable
  const convertToDeliverableMutation = useMutation({
    mutationFn: async ({
      commentId,
      title,
      description,
      dueDate,
      assignees
    }: {
      commentId: string
      title: string
      description?: string
      dueDate?: string
      assignees?: string[]
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Get the next display_order
      const { data: existingDeliverables } = await supabase
        .from('project_deliverables')
        .select('display_order')
        .eq('project_id', project.id)
        .order('display_order', { ascending: false })
        .limit(1)

      const nextOrder = (existingDeliverables?.[0]?.display_order ?? -1) + 1

      const { data: newDeliverable, error } = await supabase
        .from('project_deliverables')
        .insert({
          project_id: project.id,
          title,
          description: description || null,
          due_date: dueDate || null,
          source_comment_id: commentId,
          completed: false,
          display_order: nextOrder
        })
        .select('id')
        .single()

      if (error) throw error

      // Add assignees if any
      if (assignees && assignees.length > 0 && newDeliverable) {
        const assignmentRows = assignees.map(userId => ({
          deliverable_id: newDeliverable.id,
          user_id: userId
        }))
        const { error: assignError } = await supabase
          .from('deliverable_assignments')
          .insert(assignmentRows)
        if (assignError) console.error('Error adding assignees:', assignError)
      }

      // Mark the comment as resolved after converting
      await supabase
        .from('project_comments')
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by: user.id
        })
        .eq('id', commentId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] })
      queryClient.invalidateQueries({ queryKey: ['project-deliverables', project.id] })
    },
    onError: (error) => {
      console.error('Failed to convert comment to deliverable:', error)
    }
  })

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

  const isOverdue = localDueDate && new Date(localDueDate) < new Date() && project.status !== 'completed'
  const totalDeliverables = deliverables?.length || 0
  const completedDeliverables = deliverables?.filter(d => d.completed).length || 0
  const completionPercentage = totalDeliverables > 0 ? (completedDeliverables / totalDeliverables) * 100 : 0

  // DnD sensors for deliverable reordering
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  // Sort deliverables: incomplete first (by priority or due date), then completed at bottom
  const baseSortedDeliverables = useMemo(() => {
    if (!deliverables) return []

    const incomplete = deliverables.filter(d => !d.completed)
    const completed = deliverables.filter(d => d.completed)

    // Sort incomplete based on mode
    if (deliverableSortMode === 'due_date') {
      incomplete.sort((a, b) => {
        // Items without due date go to end
        if (!a.due_date && !b.due_date) return (a.display_order || 0) - (b.display_order || 0)
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      })
    } else {
      // Priority mode - sort by display_order
      incomplete.sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    }

    // Completed items sorted by completion time (most recent first) or display_order
    completed.sort((a, b) => (a.display_order || 0) - (b.display_order || 0))

    return [...incomplete, ...completed]
  }, [deliverables, deliverableSortMode])

  // Use optimistic order during drag, otherwise use base sorted order
  const sortedDeliverables = optimisticOrder || baseSortedDeliverables

  // Get the active deliverable for drag overlay
  const activeDeliverable = useMemo(() => {
    if (!activeDeliverableId) return null
    return sortedDeliverables.find(d => d.id === activeDeliverableId) || null
  }, [activeDeliverableId, sortedDeliverables])

  // Handle drag start
  const handleDeliverableDragStart = useCallback((event: DragStartEvent) => {
    setActiveDeliverableId(event.active.id as string)
    // Initialize optimistic order on drag start
    setOptimisticOrder(baseSortedDeliverables)
  }, [baseSortedDeliverables])

  // Handle drag over for real-time reordering
  const handleDeliverableDragOver = useCallback((event: any) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setOptimisticOrder(currentOrder => {
      const list = currentOrder || baseSortedDeliverables
      const oldIndex = list.findIndex(d => d.id === active.id)
      const newIndex = list.findIndex(d => d.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return list

      // Don't allow dragging completed items or into completed section
      if (list[oldIndex]?.completed || list[newIndex]?.completed) return list

      return arrayMove(list, oldIndex, newIndex)
    })
  }, [baseSortedDeliverables])

  // Handle drag end for deliverable reordering
  const handleDeliverableDragEnd = useCallback((event: DragEndEvent) => {
    const { active } = event
    setActiveDeliverableId(null)

    // Trigger drop animation
    setJustDroppedId(active.id as string)
    setTimeout(() => setJustDroppedId(null), 300)

    // Use the current optimistic order for persistence
    if (optimisticOrder) {
      const incompleteItems = optimisticOrder.filter(d => !d.completed)

      // Generate new display_order values
      const updates = incompleteItems.map((item, index) => ({
        id: item.id,
        display_order: index
      }))

      reorderDeliverablesMutation.mutate(updates)
    } else {
      // No change, clear any state
      setOptimisticOrder(null)
    }
  }, [optimisticOrder, reorderDeliverablesMutation])

  // If project belongs to a different org, show switch banner
  if (projectTargetOrg) {
    return (
      <div className="h-full flex items-start justify-center p-8 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-lg w-full">
          <OrgSwitchBanner targetOrg={projectTargetOrg} entityLabel="This project" />
        </div>
      </div>
    )
  }

  return (
    /* The shell wraps a phone tab in `px-3 py-4`, which put ~16px of dead
       white between the app header and "← Projects" and inset the header's
       own rule from both edges. The page reclaims it the way ProjectsPage
       does — cancel the padding, then grow by the same amount so `h-full`
       still resolves. Desktop keeps the shell's padding untouched. */
    <div className="h-full max-sm:-mx-3 max-sm:-my-4 max-sm:h-[calc(100%+2rem)] flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-3 sm:px-6 pt-1.5 pb-2 sm:py-4">
          {editingProject ? (
            <div className="space-y-4">
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="text-2xl font-bold"
                placeholder="Project title"
              />
              <TextArea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                rows={3}
                placeholder="Project description"
              />
              {/* Status / priority / date across three columns is ~120px each
                  at 390px — a select cannot render its own label in that. */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Status
                  </label>
                  <Select
                    value={editedStatus}
                    onChange={(e) => setEditedStatus(e.target.value as ProjectStatus)}
                    options={[
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
                    value={editedPriority}
                    onChange={(e) => setEditedPriority(e.target.value as ProjectPriority)}
                    options={[
                      { value: 'urgent', label: 'Urgent' },
                      { value: 'high', label: 'High' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'low', label: 'Low' }
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Due Date
                  </label>
                  <Input
                    type="date"
                    value={editedDueDate}
                    onChange={(e) => setEditedDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => updateProjectMutation.mutate()}>
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingProject(false)
                    setEditedTitle(projectData.title || '')
                    setEditedDescription(projectData.description || '')
                    setEditedStatus(projectData.status)
                    setEditedPriority(projectData.priority)
                    setEditedDueDate(projectData.due_date || '')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Back to Projects. A project detail tab can be opened from
                  search, from the feed or from a dependency link, so on a
                  phone there was no way out of it except the tab bar. Phone
                  only: on a desktop the tab strip is the way back. */}
              <button
                type="button"
                onClick={() => onNavigate?.({ id: 'projects-list', title: 'Projects', type: 'projects-list' })}
                className="no-touch-target tap-pad sm:hidden -ml-1 mb-1.5 flex items-center gap-0.5 py-0 leading-none text-[11px] font-medium text-primary-600 dark:text-primary-400"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Projects
              </button>

              {/* `items-center` on a phone, not `items-start`.

                  The gap under the title was the row being taller than the
                  title: the collapse chevron carries `p-1` around a 16px
                  icon, so the row is 24px while the heading's line box is
                  ~20px — and `items-start` pinned the heading to the top and
                  left the difference sitting underneath it, looking like a
                  margin that no margin rule could remove. Centring shares
                  that 4px above and below instead. */}
              <div className="flex items-start justify-between gap-2 sm:gap-3 mb-0 sm:mb-4">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <FolderKanban className="hidden sm:block w-5 h-5 sm:w-6 sm:h-6 text-primary-600 dark:text-primary-400 shrink-0" />
                  <div className="min-w-0">
                    {/* A project title is a sentence, not a ticker — it needs
                        to wrap rather than push the Edit button off the row.
                        Collapsed, it stays on one line so the summary holds
                        its height. */}
                    {/* The pencil sits with the name it edits, inline, so it
                        reads as "edit this" rather than as a second action
                        competing with the title for the row. */}
                    {/* The size does not change with the state — only whether
                        it wraps. A title that resized on collapse read as a
                        different heading for a different thing. */}
                    {/* `leading-tight`: the gap under the title was not a
                        margin — `text-base` carries a 1.5 line-height, so a
                        16px title sits in a 24px line with 4px of dead space
                        above and below it. Removing margins could not reach
                        that; the line box had to come down. */}
                    {/* Measured at 390px: the margin between this and the
                        chip run below is already 0px. What reads as
                        whitespace is the line boxes — 16px text in a 20px
                        line here, 12px text in a 20px line there, so ~10px
                        of the gap is leading, not spacing. `leading-none`
                        with a pixel of padding for descenders is the only
                        thing that actually closes it. */}
                    <h1 className={clsx(
                      'text-base sm:text-2xl font-bold text-gray-900 dark:text-white max-sm:leading-none max-sm:pb-px sm:leading-normal',
                      summaryCollapsed ? 'truncate' : 'break-words'
                    )}>
                      {projectData.title || 'Loading...'}
                      {canManageProject && (
                        <button
                          type="button"
                          onClick={() => setEditingProject(true)}
                          aria-label="Edit project"
                          title="Edit project"
                          className="no-touch-target sm:hidden ml-1.5 -mb-0.5 inline-flex text-gray-400 hover:text-primary-600 dark:hover:text-primary-400"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </h1>
                    {/* Created-date repeats above all six tabs and answers
                        none of the three questions the header exists for. It
                        lives in Overview → Details on a phone. */}
                    <p className="hidden sm:block text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                      {projectData.created_at ? `Created ${formatDistanceToNow(new Date(projectData.created_at), { addSuffix: true })}` : 'Recently created'}
                    </p>
                    {/* The collapsed line. Status, priority and progress as
                        text — enough to know where you are without the three
                        editable controls that carry the same facts. */}
                    {summaryCollapsed && (
                      <p className="sm:hidden mt-0.5 truncate text-[12px] text-gray-500 dark:text-gray-400">
                        <span className="capitalize">{(localStatus || '').replace('_', ' ')}</span>
                        {localPriority && <> · <span className="capitalize">{localPriority}</span></>}
                        {totalDeliverables > 0 && <> · {completedDeliverables}/{totalDeliverables}</>}
                        {isOverdue && <span className="text-red-600 dark:text-red-400"> · overdue</span>}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                {/* Desktop keeps the labelled button; the phone's pencil is
                    inline with the title above. */}
                {canManageProject && (
                  <Button variant="outline" onClick={() => setEditingProject(true)} className="hidden sm:inline-flex shrink-0">
                    <Edit className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Edit Project</span>
                  </Button>
                )}
                {/* Collapse handle, pinned to the right edge of the header.

                    No `tap-pad`: `items-start` keeps it on the title's first
                    line rather than centring against a wrapped block, and a
                    fixed 20px box means the thing that is drawn is the thing
                    that is hit — the pad was covering the title's line and
                    winning taps meant for the name. */}
                <button
                  type="button"
                  onClick={() => setSummaryCollapsed(v => !v)}
                  aria-expanded={!summaryCollapsed}
                  aria-label={summaryCollapsed ? 'Expand project summary' : 'Collapse project summary'}
                  /* `h-4` is not arbitrary: the title is 16px at
                     `leading-none`, so its line box is exactly 16px. Matching
                     that height means `items-start` aligns the two tops AND
                     their centres, so the chevron sits on the title's line
                     instead of 2px below it. A 20px box missed by exactly
                     that difference. */
                  className="no-touch-target sm:hidden shrink-0 flex h-4 w-6 items-center justify-center text-gray-400 dark:text-gray-500"
                >
                  <ChevronDown className={clsx('w-4 h-4 transition-transform', !summaryCollapsed && 'rotate-180')} />
                </button>
                </div>
              </div>

              {/* Status, priority, dates and owner — a chip run that is wider
                  than a phone, so it wraps rather than overflowing. Hidden on
                  a phone when the summary is collapsed; the same facts are on
                  the one-line version above. */}
              <div className={clsx(
                'flex-wrap items-center gap-x-3 gap-y-1 sm:gap-3 mt-1 sm:mt-0 mb-1 sm:mb-4 max-sm:leading-none',
                summaryCollapsed ? 'hidden sm:flex' : 'flex'
              )}>
                {/* Status - clickable dropdown for managers */}
                {canManageProject ? (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowStatusDropdown(!showStatusDropdown)
                        setShowPriorityDropdown(false)
                      }}
                      className={clsx(
                        // Status and priority keep their tinted pill: the
                        // colour IS the information. What separates them
                        // from a read-only badge is the caret, which only
                        // these carry. `tap-pad` holds the 44px thumb while
                        // the drawn pill stays small — without it the
                        // coarse-pointer rule turns three chips into a band.
                        /* Phone drops the filled capsule entirely.

                           A capsule is a box: padding on four sides, a
                           background, a radius and a 16px icon, all to carry
                           one short word. Three of them across a 390px header
                           is a band of boxes. A coloured dot says the same
                           thing in 6px, the label carries itself, and the
                           caret is the only affordance needed — so the
                           control is text-height instead of box-height and
                           the run reads as a line of state rather than as a
                           toolbar. Desktop keeps the pills. */
                        /* No `tap-pad` here. Its hit region reaches 6px above
                           the control, and this row sits directly under the
                           project title — so the pad covered the bottom of
                           the title's line, which both looked like stray
                           white space and ate taps meant for the name. Real
                           height instead: what is drawn is what is hit. */
                        'no-touch-target flex items-center transition-colors',
                        'max-sm:gap-1 max-sm:h-7 max-sm:text-[12px] max-sm:font-medium max-sm:bg-transparent max-sm:px-0 max-sm:[&>svg:first-child]:hidden',
                        'sm:gap-1 sm:h-8 sm:px-2.5 sm:rounded-full sm:text-sm sm:font-medium sm:hover:ring-2 sm:hover:ring-offset-1',
                        isBlocked
                          ? 'max-sm:text-red-600 dark:max-sm:text-red-400 sm:bg-red-100 sm:text-red-700 dark:sm:bg-red-900/30 dark:sm:text-red-300 sm:hover:ring-red-300'
                          /* `getStatusColor` returns unprefixed classes and
                             they cannot be rewritten at runtime — Tailwind
                             only emits class names it finds literally in the
                             source. So the desktop colours stay as they are
                             and the `max-sm:` overrides above neutralise them
                             on a phone, which they win because a media-query
                             variant is emitted after the base utility. */
                          : localStatus
                          ? 'max-sm:text-gray-700 dark:max-sm:text-gray-200 ' + getStatusColor(localStatus)
                          : 'max-sm:text-gray-400 sm:bg-gray-100 sm:text-gray-500 dark:sm:text-gray-400 dark:sm:bg-gray-800'
                      )}
                    >
                      {/* The dot is the phone's whole colour cue. */}
                      <span
                        aria-hidden="true"
                        className={clsx(
                          'sm:hidden h-1.5 w-1.5 rounded-full shrink-0',
                          isBlocked ? 'bg-red-500' : localStatus ? getStatusConfig(localStatus).dotColor : 'bg-gray-300'
                        )}
                      />
                      {isBlocked ? (
                        <>
                          <Lock className="w-4 h-4 max-sm:hidden" />
                          <span>Blocked</span>
                        </>
                      ) : (
                        <>
                          <span className="max-sm:hidden inline-flex">{localStatus && getStatusIcon(localStatus)}</span>
                          <span className="capitalize">{localStatus?.replace('_', ' ') || 'Loading...'}</span>
                        </>
                      )}
                      <ChevronDown className="w-3 h-3 sm:ml-1 opacity-50 shrink-0" />
                    </button>
                    {showStatusDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowStatusDropdown(false)} />
                        <div className="absolute left-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[140px]">
                          {(['planning', 'in_progress', 'blocked', 'completed', 'cancelled'] as ProjectStatus[]).map(status => (
                            <button
                              key={status}
                              onClick={() => {
                                if (status === 'blocked') {
                                  setShowStatusDropdown(false)
                                  setBlockedReasonInput(projectData.blocked_reason || '')
                                  setShowBlockedReasonModal(true)
                                } else {
                                  updateProjectStatusMutation.mutate({ status })
                                }
                              }}
                              className={clsx(
                                'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                                localStatus === status && 'bg-gray-50 dark:bg-gray-700/50'
                              )}
                            >
                              {getStatusIcon(status)}
                              <span className="capitalize">{status.replace('_', ' ')}</span>
                              {localStatus === status && <Check className="w-4 h-4 ml-auto text-primary-500" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : isBlocked ? (
                  <Badge className="flex items-center gap-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    <Lock className="w-4 h-4" />
                    <span>Blocked</span>
                  </Badge>
                ) : localStatus ? (
                  <Badge className={clsx('flex items-center gap-1', getStatusColor(localStatus))}>
                    {getStatusIcon(localStatus)}
                    <span className="capitalize">{localStatus.replace('_', ' ')}</span>
                  </Badge>
                ) : null}

                {/* Priority - clickable dropdown for managers */}
                {canManageProject ? (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowPriorityDropdown(!showPriorityDropdown)
                        setShowStatusDropdown(false)
                      }}
                      className={clsx(
                        // Same flat treatment as status: dot, label, caret.
                        'no-touch-target flex items-center transition-colors',
                        'max-sm:gap-1 max-sm:h-7 max-sm:text-[12px] max-sm:font-medium max-sm:bg-transparent max-sm:px-0 max-sm:text-gray-700 dark:max-sm:text-gray-200',
                        'sm:gap-1 sm:h-8 sm:px-2.5 sm:rounded-full sm:text-sm sm:font-medium sm:hover:ring-2 sm:hover:ring-offset-1 sm:hover:ring-primary-300',
                        getPriorityColor(localPriority)
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={clsx(
                          'sm:hidden h-1.5 w-1.5 rounded-full shrink-0',
                          localPriority === 'urgent' ? 'bg-red-500'
                            : localPriority === 'high' ? 'bg-orange-500'
                            : localPriority === 'medium' ? 'bg-amber-400'
                            : 'bg-gray-300'
                        )}
                      />
                      <span className="capitalize">{localPriority}</span>
                      <ChevronDown className="w-3 h-3 sm:ml-1 opacity-50 shrink-0" />
                    </button>
                    {showPriorityDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowPriorityDropdown(false)} />
                        <div className="absolute left-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[120px]">
                          {(['low', 'medium', 'high', 'urgent'] as ProjectPriority[]).map(priority => (
                            <button
                              key={priority}
                              onClick={() => updateProjectPriorityMutation.mutate(priority)}
                              className={clsx(
                                'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                                localPriority === priority && 'bg-gray-50 dark:bg-gray-700/50'
                              )}
                            >
                              <span className={clsx('w-2 h-2 rounded-full',
                                priority === 'urgent' ? 'bg-red-500' :
                                priority === 'high' ? 'bg-orange-500' :
                                priority === 'medium' ? 'bg-yellow-500' : 'bg-gray-400'
                              )} />
                              <span className="capitalize">{priority}</span>
                              {localPriority === priority && <Check className="w-4 h-4 ml-auto text-primary-500" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : localPriority && (
                  <Badge className={getPriorityColor(localPriority)}>
                    <span className="capitalize">{localPriority}</span>
                  </Badge>
                )}
                {canManageProject ? (
                  /* `showClear` put an × beside "237 days overdue", which
                     read as "dismiss this warning" — overdue is project
                     state, not a notice you can close, and the × actually
                     cleared the due date. Clearing still lives inside the
                     picker panel, where it is unambiguous. */
                  <DatePicker
                    value={localDueDate}
                    onChange={(date) => updateProjectDueDateMutation.mutate(date)}
                    placeholder="Set due date"
                    showOverdue
                    showClear={false}
                    isCompleted={project.status === 'completed'}
                    allowPastDates
                  />
                ) : localDueDate ? (
                  <Badge className={clsx(
                    'flex items-center gap-1',
                    isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                  )}>
                    <Calendar className="w-4 h-4" />
                    Due {formatDistanceToNow(new Date(localDueDate), { addSuffix: true })}
                  </Badge>
                ) : null}
              </div>

              {/* The description is prose of arbitrary length sitting above
                  every tab. It belongs to the project, not to the state of
                  it, so on a phone it reads in Overview → Details. */}
              {projectData.description && (
                <p className="hidden sm:block text-gray-600 dark:text-gray-400 mb-4">
                  {projectData.description}
                </p>
              )}

              {/* Progress Bar. Collapsed, the count rides on the one-line
                  summary instead. */}
              {totalDeliverables > 0 && (
                <div className={clsx(summaryCollapsed && 'hidden sm:block')}>
                  <div className="flex items-center justify-between text-[13px] sm:text-sm mb-1 sm:mb-2">
                    <span className="text-gray-600 dark:text-gray-400">
                      {completedDeliverables} of {totalDeliverables}
                      <span className="hidden sm:inline"> deliverables completed</span>
                      <span className="sm:hidden"> deliverables</span>
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {Math.round(completionPercentage)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 sm:h-2">
                    <div
                      className="bg-primary-500 h-full rounded-full transition-all"
                      style={{ width: `${completionPercentage}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Dependency Status Banners */}
        {!editingProject && (isBlocked || localStatus === 'blocked' || (blocking && blocking.length > 0)) && (
          <div className="px-6 py-3 space-y-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
            {/* Manually blocked with reason */}
            {localStatus === 'blocked' && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <Lock className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-red-800 dark:text-red-200">
                    This project is blocked
                  </p>
                  {projectData.blocked_reason && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {projectData.blocked_reason}
                    </p>
                  )}
                </div>
                {canManageProject && (
                  <button
                    onClick={() => {
                      setBlockedReasonInput(projectData.blocked_reason || '')
                      setShowBlockedReasonModal(true)
                    }}
                    className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg transition-colors flex-shrink-0"
                  >
                    Edit Reason
                  </button>
                )}
              </div>
            )}
            {/* Blocked by dependencies (only show if not manually blocked to avoid duplicate banners) */}
            {isBlocked && localStatus !== 'blocked' && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <Lock className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-red-800 dark:text-red-200">
                    This project is blocked by dependencies
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Waiting on {blockedBy?.length || 0} item{(blockedBy?.length || 0) !== 1 ? 's' : ''} to be completed before this can proceed.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('dependencies')}
                  className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg transition-colors flex-shrink-0"
                >
                  View Dependencies
                </button>
              </div>
            )}
            {blocking && blocking.length > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <ArrowRight className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    This project is blocking others
                  </p>
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    {blocking.length} project{blocking.length !== 1 ? 's are' : ' is'} waiting for this to be completed.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('dependencies')}
                  className="px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 rounded-lg transition-colors flex-shrink-0"
                >
                  View Dependencies
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        {!editingProject && (
          /* Six tabs at px-6 are ~700px. The strip scrolls sideways on a
             phone rather than widening the page.

             "A partly-visible tab is its own affordance" was true of the
             chips it was copied from and false here: the selected tab could
             itself be the half-cut one. Landing on Activity showed a sliver
             of Comments on the left and a truncated "Activi" against the
             right edge — the rail said where you were not. `scroll-px`
             reserves a gutter so a tab never sits flush to an edge, and the
             active tab is centred on selection and on arrival. */
          <div
            ref={tabRailRef}
            className="flex border-t border-gray-200 dark:border-gray-700 overflow-x-auto no-scrollbar scroll-smooth scroll-px-3 sm:scroll-px-0 px-3 sm:px-0"
          >
            {[
              { id: 'overview', label: 'Overview', icon: FolderKanban },
              { id: 'deliverables', label: 'Deliverables', icon: CheckCircle },
              { id: 'team', label: 'Team', icon: Users },
              { id: 'dependencies', label: 'Dependencies', icon: Link2 },
              { id: 'comments', label: 'Comments', icon: MessageSquare },
              { id: 'activity', label: 'Activity', icon: Activity }
            ].map((tab) => (
              <button
                key={tab.id}
                data-tab-id={tab.id}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id as any)}
                className={clsx(
                  // Tighter horizontal padding on a phone: six labels at
                  // px-4 are ~700px, and the icons were the first thing to
                  // be cut in half at the edges. Labels stay whole.
                  'shrink-0 whitespace-nowrap flex items-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-2.5 sm:py-3 border-b-2 transition-colors text-[13px] sm:text-sm',
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}
              >
                <tab.icon className="w-4 h-4 shrink-0" />
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {!editingProject && (
        /* Comments manages its own height on a phone: the composer is pinned
           to the bottom and the thread scrolls above it, which needs one
           scroller, not this one nested outside it. */
        <div className={clsx(
          "flex-1 overscroll-contain",
          activeTab === 'comments'
            ? 'max-sm:overflow-hidden max-sm:p-0 overflow-y-auto p-3 sm:p-6'
            : 'overflow-y-auto',
          activeTab === 'activity' ? 'p-2' : activeTab !== 'comments' && 'p-3 sm:p-6'
        )}>
          {activeTab === 'overview' && (() => {
            // Calculate upcoming and overdue tasks using startOfDay for consistency
            const today = startOfDay(new Date())
            const upcomingTasks = deliverables?.filter(d => {
              if (d.completed || !d.due_date) return false
              const dueDate = startOfDay(parseISO(d.due_date))
              const daysUntilDue = differenceInDays(dueDate, today)
              return daysUntilDue >= 0 && daysUntilDue <= 7
            }).sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()) || []

            const overdueTasks = deliverables?.filter(d => {
              if (d.completed || !d.due_date) return false
              const dueDate = startOfDay(parseISO(d.due_date))
              return differenceInDays(dueDate, today) < 0
            }).sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()) || []

            // Calculate days until project due date
            const projectDueDate = project.due_date ? startOfDay(parseISO(project.due_date)) : null
            const daysUntilProjectDue = projectDueDate
              ? differenceInDays(projectDueDate, today)
              : null

            return (
            <div className="space-y-3 sm:space-y-6">
              {/* Overdue Tasks, Upcoming Tasks */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                {/* Overdue Tasks. Nothing overdue is good news and should
                    read as one quiet line, not as a card the same size as
                    three real overdue tasks. */}
                {overdueTasks.length === 0 ? (
                  <QuietEmpty icon={Flag} label="No overdue tasks" />
                ) : (
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-red-100 dark:bg-red-900/30 rounded">
                      <Flag className="w-4 h-4 text-red-600 dark:text-red-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Overdue Tasks
                    </h3>
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs">
                      {overdueTasks.length}
                    </Badge>
                  </div>
                  {overdueTasks.length > 0 ? (
                    <ul className="space-y-2">
                      {overdueTasks.slice(0, 3).map(task => (
                        <li key={task.id} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">
                            {task.title}
                          </span>
                          <span className="text-xs text-red-600 dark:text-red-400 flex-shrink-0">
                            {formatDistanceToNow(new Date(task.due_date!), { addSuffix: true })}
                          </span>
                        </li>
                      ))}
                      {overdueTasks.length > 3 && (
                        <li className="text-xs text-gray-500 dark:text-gray-400 pt-1">
                          +{overdueTasks.length - 3} more overdue
                        </li>
                      )}
                    </ul>
                  ) : null}
                </Card>
                )}

                {/* Due This Week — same treatment. */}
                {upcomingTasks.length === 0 ? (
                  <QuietEmpty icon={Target} label="Nothing due this week" />
                ) : (
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded">
                      <Target className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Due This Week
                    </h3>
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs">
                      {upcomingTasks.length}
                    </Badge>
                  </div>
                  {upcomingTasks.length > 0 ? (
                    <ul className="space-y-2">
                      {upcomingTasks.slice(0, 3).map(task => (
                        <li key={task.id} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">
                            {task.title}
                          </span>
                          <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0">
                            {format(new Date(task.due_date!), 'EEE, MMM d')}
                          </span>
                        </li>
                      ))}
                      {upcomingTasks.length > 3 && (
                        <li className="text-xs text-gray-500 dark:text-gray-400 pt-1">
                          +{upcomingTasks.length - 3} more this week
                        </li>
                      )}
                    </ul>
                  ) : null}
                </Card>
                )}
              </div>

              {/* Bottom Row: Team, Dependencies, Org Groups */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 [&>*]:max-sm:!p-3">
                {/* Team Members */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-gray-400" />
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team</h3>
                    </div>
                    <button
                      onClick={() => setActiveTab('team')}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  {teamMembers && teamMembers.length > 0 ? (
                    <div className="space-y-2">
                      {teamMembers.slice(0, 4).map((member: any) => (
                        <div key={member.id} className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-xs font-medium text-primary-700 dark:text-primary-300">
                            {(member.user?.first_name?.[0] || member.user?.email?.[0] || '?').toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 dark:text-white truncate">
                              {member.user?.first_name
                                ? `${member.user.first_name} ${member.user.last_name || ''}`
                                : member.user?.email || 'Unknown'}
                            </p>
                          </div>
                          {member.role === 'owner' && (
                            <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                          )}
                          {member.role === 'lead' && (
                            <UserCheck className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          )}
                        </div>
                      ))}
                      {teamMembers.length > 4 && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          +{teamMembers.length - 4} more
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No team members</p>
                  )}

                  {/* Associated Groups */}
                  {projectOrgGroups && projectOrgGroups.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2 mb-2">
                        <Building2 className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Groups</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {projectOrgGroups.slice(0, 3).map((assoc: any) => (
                          <Badge
                            key={assoc.id}
                            className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 text-xs"
                          >
                            {assoc.org_group?.name || 'Unknown'}
                          </Badge>
                        ))}
                        {projectOrgGroups.length > 3 && (
                          <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 text-xs">
                            +{projectOrgGroups.length - 3}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </Card>

                {/* Dependencies */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-gray-400" />
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Dependencies</h3>
                    </div>
                    <button
                      onClick={() => setActiveTab('dependencies')}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-3">
                    {/* Blocked By */}
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <Lock className="w-3 h-3" />
                        <span>Blocked by</span>
                      </div>
                      {blockedBy && blockedBy.length > 0 ? (
                        <div className="space-y-1">
                          {blockedBy.slice(0, 2).map((dep: any) => (
                            <div
                              key={dep.id}
                              className={clsx(
                                'text-xs px-2 py-1 rounded truncate',
                                dep.depends_on?.status === 'completed'
                                  ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                                  : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                              )}
                            >
                              {dep.depends_on?.title || 'Unknown'}
                            </div>
                          ))}
                          {blockedBy.length > 2 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">+{blockedBy.length - 2} more</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">None</span>
                      )}
                    </div>
                    {/* Blocking */}
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <ArrowRight className="w-3 h-3" />
                        <span>Blocking</span>
                      </div>
                      {blocking && blocking.length > 0 ? (
                        <div className="space-y-1">
                          {blocking.slice(0, 2).map((dep: any) => (
                            <div
                              key={dep.id}
                              className="text-xs px-2 py-1 rounded truncate bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                            >
                              {dep.project?.title || 'Unknown'}
                            </div>
                          ))}
                          {blocking.length > 2 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">+{blocking.length - 2} more</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">None</span>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Org Groups & Meta */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="w-4 h-4 text-gray-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Details</h3>
                  </div>
                  <div className="space-y-3">
                    {/* Description. The header carries it on a desktop; on a
                        phone it was prose above all six tabs, so it reads
                        here instead — the one place it is not repeated. */}
                    {projectData.description && (
                      <div className="sm:hidden">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Description</span>
                        <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {projectData.description}
                        </p>
                      </div>
                    )}
                    {/* Org Groups */}
                    {projectOrgGroups && projectOrgGroups.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Groups</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {projectOrgGroups.map((assoc: any) => (
                            <Badge
                              key={assoc.id}
                              className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-xs"
                            >
                              {assoc.org_group?.name || 'Unknown'}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Priority — the phone header already shows it two
                        inches above this, so it is desktop-only here. */}
                    <div className="hidden sm:block">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Priority</span>
                      <div className="mt-1">
                        {projectData.priority ? (
                          <Badge className={clsx('text-xs', getPriorityColor(projectData.priority))}>
                            <span className="capitalize">{projectData.priority}</span>
                          </Badge>
                        ) : (
                          <span className="text-xs text-gray-400">Loading...</span>
                        )}
                      </div>
                    </div>
                    {/* Created */}
                    <div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Created</span>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                        {projectData.created_at ? formatDistanceToNow(new Date(projectData.created_at), { addSuffix: true }) : 'Unknown'}
                      </p>
                    </div>
                    {/* Comments */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Comments</span>
                      <button
                        onClick={() => setActiveTab('comments')}
                        className="flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        {comments?.length || 0}
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
            )
          })()}

          {activeTab === 'deliverables' && (
            <div>
              {/* Add Deliverable Form - only for managers.

                  Four controls on one 390px row put a text field, two buttons
                  and a submit into ~90px each. Wrapping them fixed the
                  cramping and created a new problem: Assign and Due sat
                  loose under the field, reading as unrelated controls that
                  happened to be nearby.

                  So the box holds all of it. The field is the top row, the
                  pickers and Add share a divided row beneath it inside the
                  same border, and the whole thing is one control that looks
                  like one control. Desktop keeps the single horizontal row. */}
              {canManageProject && (
              <div className="flex flex-col sm:inline-flex sm:flex-row sm:items-center gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                <div className="flex flex-col sm:flex-row sm:flex-nowrap sm:items-center sm:gap-2 sm:px-3 sm:py-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent overflow-hidden">
                  <Plus className="hidden sm:block w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    value={newDeliverable}
                    onChange={(e) => setNewDeliverable(e.target.value)}
                    placeholder="Add a deliverable…"
                    className="w-full sm:w-80 min-w-0 bg-transparent px-2.5 py-2 sm:p-0 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none cursor-text"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newDeliverable.trim()) {
                        addDeliverableMutation.mutate()
                      }
                    }}
                  />
                  {/* The pickers-and-submit row, inside the same border. */}
                  <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-700/30 sm:contents sm:border-0 sm:bg-transparent sm:p-0">
                  {/* Assign button with dropdown - only show if there are team members */}
                  {teamMembers && teamMembers.length > 0 && (
                    <div className="relative sm:pl-2 sm:border-l border-gray-200 dark:border-gray-600" data-dropdown>
                      <button
                        type="button"
                        onClick={() => setShowNewDeliverableAssignees(!showNewDeliverableAssignees)}
                        className={clsx(
                          'no-touch-target tap-pad flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] font-medium transition-colors',
                          newDeliverableAssignees.length > 0
                            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        )}
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        {newDeliverableAssignees.length > 0 ? (
                          <span>{newDeliverableAssignees.length} assigned</span>
                        ) : (
                          <span>Assign</span>
                        )}
                      </button>
                      {showNewDeliverableAssignees && (
                        <div className="absolute left-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[200px]">
                          <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                            Assign to
                          </div>
                          {teamMembers.map((member: any) => {
                            const isSelected = newDeliverableAssignees.includes(member.assigned_to)
                            const initials = (member.user?.first_name?.[0] || '') + (member.user?.last_name?.[0] || '') || member.user?.email?.[0]?.toUpperCase()
                            const fullName = `${member.user?.first_name || ''} ${member.user?.last_name || ''}`.trim() || member.user?.email?.split('@')[0]
                            return (
                              <button
                                key={member.assigned_to}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setNewDeliverableAssignees(prev => prev.filter(id => id !== member.assigned_to))
                                  } else {
                                    setNewDeliverableAssignees(prev => [...prev, member.assigned_to])
                                  }
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                              >
                                <div className={clsx(
                                  'w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0',
                                  isSelected
                                    ? 'bg-primary-600 border-primary-600'
                                    : 'border-gray-300 dark:border-gray-600'
                                )}>
                                  {isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 text-[10px] font-medium flex items-center justify-center flex-shrink-0">
                                  {initials}
                                </span>
                                <span className={clsx(
                                  'truncate',
                                  isSelected ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-700 dark:text-gray-300'
                                )}>
                                  {fullName}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <DatePicker
                    value={newDeliverableDueDate}
                    onChange={setNewDeliverableDueDate}
                    placeholder="Due"
                    variant="inline"
                    compact
                    maxDate={project.due_date}
                    projectDueDate={project.due_date}
                  />
                  <button
                    onClick={() => addDeliverableMutation.mutate()}
                    disabled={!newDeliverable.trim()}
                    className="no-touch-target tap-pad ml-auto sm:ml-0 sm:hidden h-7 px-3 rounded-md bg-primary-600 text-white text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Add
                  </button>
                  </div>
                </div>
                {/* Desktop's Add sits outside the field, as it did. */}
                <button
                  onClick={() => addDeliverableMutation.mutate()}
                  disabled={!newDeliverable.trim()}
                  className="hidden sm:block px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add
                </button>
              </div>
              )}

              {/* Sort Toggle */}
              {sortedDeliverables.length > 0 && (
                <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <ArrowUpDown className="hidden sm:block w-4 h-4 text-gray-400" />
                    <span className="hidden sm:inline text-sm text-gray-500 dark:text-gray-400">Sort by:</span>
                    <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <button
                        onClick={() => setDeliverableSortMode('priority')}
                        className={clsx(
                          'no-touch-target tap-pad h-7 px-2.5 text-[12px] font-medium transition-colors',
                          deliverableSortMode === 'priority'
                            ? 'bg-primary-600 text-white'
                            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                        )}
                      >
                        Priority
                      </button>
                      <button
                        onClick={() => setDeliverableSortMode('due_date')}
                        className={clsx(
                          'no-touch-target tap-pad h-7 px-2.5 text-[12px] font-medium transition-colors border-l border-gray-200 dark:border-gray-700',
                          deliverableSortMode === 'due_date'
                            ? 'bg-primary-600 text-white'
                            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                        )}
                      >
                        Due Date
                      </button>
                    </div>
                  </div>
                  {/* The grip on each row is the affordance; this is a
                      desktop hint, and on a phone it was competing with the
                      sort control for a row that has no width to spare. */}
                  {deliverableSortMode === 'priority' && canManageProject && (
                    <span className="hidden sm:inline text-xs text-gray-400 dark:text-gray-500">
                      Drag to reorder
                    </span>
                  )}
                </div>
              )}

              {/* Deliverables List */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDeliverableDragStart}
                onDragOver={handleDeliverableDragOver}
                onDragEnd={handleDeliverableDragEnd}
              >
                <SortableContext
                  items={sortedDeliverables.map(d => d.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {/* The phone list is one bordered container with hairline
                      dividers; the desktop list stays a stack of cards. */}
                  <div className="space-y-2 max-sm:space-y-0 max-sm:rounded-lg max-sm:border max-sm:border-gray-200 dark:max-sm:border-gray-700 max-sm:overflow-hidden overflow-x-clip">
                    {sortedDeliverables.map((deliverable, index) => {
                      // Calculate priority number (only for incomplete items)
                      const incompleteItems = sortedDeliverables.filter(d => !d.completed)
                      const priorityNumber = deliverable.completed
                        ? null
                        : incompleteItems.findIndex(d => d.id === deliverable.id) + 1

                      return (
                        <SortableDeliverableItem
                          key={deliverable.id}
                          deliverable={deliverable}
                          priorityNumber={priorityNumber}
                          canManageProject={canManageProject}
                          canCompleteDeliverables={canCompleteDeliverables}
                          onToggle={() => toggleDeliverableMutation.mutate({
                            id: deliverable.id,
                            completed: deliverable.completed
                          })}
                          onRename={(title) => renameDeliverableMutation.mutate({
                            id: deliverable.id,
                            title
                          })}
                          onDelete={() => {
                            if (window.confirm('Delete this deliverable?')) {
                              deleteDeliverableMutation.mutate(deliverable.id)
                            }
                          }}
                          onAssigneeClick={() => setOpenAssigneeDropdown(
                            openAssigneeDropdown === deliverable.id ? null : deliverable.id
                          )}
                          isAssigneeDropdownOpen={openAssigneeDropdown === deliverable.id}
                          teamMembers={teamMembers || []}
                          onAddAssignee={(userId) => addDeliverableAssigneeMutation.mutate({
                            deliverableId: deliverable.id,
                            userId
                          })}
                          onRemoveAssignee={(userId) => removeDeliverableAssigneeMutation.mutate({
                            deliverableId: deliverable.id,
                            userId
                          })}
                          onDueDateChange={(date) => updateDeliverableDueDateMutation.mutate({
                            deliverableId: deliverable.id,
                            dueDate: date
                          })}
                          projectDueDate={project.due_date}
                          isDragDisabled={deliverableSortMode === 'due_date'}
                          isJustDropped={justDroppedId === deliverable.id}
                        />
                      )
                    })}

                    {/* Completed section divider */}
                    {sortedDeliverables.some(d => d.completed) && sortedDeliverables.some(d => !d.completed) && (
                      <div className="flex items-center gap-3 py-2">
                        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                        <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                          Completed ({sortedDeliverables.filter(d => d.completed).length})
                        </span>
                        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                      </div>
                    )}
                  </div>
                </SortableContext>

                {/* Drag overlay for smooth visual feedback */}
                <DragOverlay>
                  {activeDeliverable ? (
                    <div className="bg-white dark:bg-gray-800 border border-blue-400 rounded-lg shadow-xl p-3 opacity-95">
                      <div className="flex items-center gap-3">
                        <GripVertical className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        {!activeDeliverable.completed && (
                          <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-medium flex-shrink-0">
                            {sortedDeliverables.filter(d => !d.completed).findIndex(d => d.id === activeDeliverable.id) + 1}
                          </div>
                        )}
                        <span className={clsx(
                          "font-medium truncate",
                          activeDeliverable.completed && "line-through text-gray-400"
                        )}>
                          {activeDeliverable.title}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>

              {(!sortedDeliverables || sortedDeliverables.length === 0) && (
                <div className="text-center py-12">
                  <CheckCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    No deliverables yet. Add your first one above.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'team' && (
            <div>
              {/* Add Team Member Section - managers only */}
              {canManageProject && (
                <div className="mb-4">
                  {!showAddMemberForm ? (
                    <Button size="sm" onClick={() => setShowAddMemberForm(true)}>
                      <UserPlus className="w-4 h-4 mr-2" />
                      Add Member
                    </Button>
                  ) : (
                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                      {/* Header with tabs and search */}
                      <div className="p-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 space-y-2">
                        <div className="flex items-center justify-between">
                          {/* Tabs */}
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setTeamTab('users')}
                              className={clsx(
                                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                                teamTab === 'users'
                                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm'
                                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                              )}
                            >
                              <Users className="w-3.5 h-3.5" />
                              Users
                            </button>
                            <button
                              type="button"
                              onClick={() => setTeamTab('groups')}
                              className={clsx(
                                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                                teamTab === 'groups'
                                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm'
                                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                              )}
                            >
                              <Building2 className="w-3.5 h-3.5" />
                              Groups
                            </button>
                          </div>
                          <button
                            onClick={() => {
                              setShowAddMemberForm(false)
                              setMemberSearchQuery('')
                              setTeamTab('users')
                            }}
                            className="px-3 py-1 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                          >
                            Done
                          </button>
                        </div>
                        {/* Search */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={memberSearchQuery}
                            onChange={(e) => setMemberSearchQuery(e.target.value)}
                            placeholder={teamTab === 'users' ? 'Search users...' : 'Search groups...'}
                            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                          />
                        </div>
                      </div>

                      {/* User List */}
                      {teamTab === 'users' && (
                        <div>
                          {availableUsers.length > 0 ? (
                            availableUsers.slice(0, 15).map((u) => (
                              <button
                                key={u.id}
                                onClick={() => addTeamMemberMutation.mutate(u.id)}
                                disabled={addTeamMemberMutation.isPending}
                                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0 text-left disabled:opacity-50 disabled:cursor-wait"
                              >
                                <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center flex-shrink-0">
                                  <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                                    {u.first_name?.[0] || u.email[0].toUpperCase()}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {u.first_name && u.last_name
                                      ? `${u.first_name} ${u.last_name}`
                                      : u.email}
                                  </p>
                                </div>
                                <Plus className="w-4 h-4 text-gray-400" />
                              </button>
                            ))
                          ) : (
                            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                              {memberSearchQuery
                                ? `No users found matching "${memberSearchQuery}"`
                                : allUsers?.length === 0
                                ? 'No users available'
                                : 'All users are already team members'}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Groups List */}
                      {teamTab === 'groups' && (
                        <div>
                          {filteredOrgGroups.length > 0 ? (
                            filteredOrgGroups.map((group) => {
                              const memberCount = orgGroupMembers.get(group.id)?.length || 0
                              return (
                                <button
                                  key={group.id}
                                  onClick={() => addOrgGroupMutation.mutate(group.id)}
                                  disabled={addOrgGroupMutation.isPending}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0 text-left disabled:opacity-50 disabled:cursor-wait"
                                >
                                  <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                                    <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                      {group.name}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      {memberCount} member{memberCount !== 1 ? 's' : ''}
                                    </p>
                                  </div>
                                  <Plus className="w-4 h-4 text-gray-400" />
                                </button>
                              )
                            })
                          ) : (
                            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                              {memberSearchQuery ? `No groups found matching "${memberSearchQuery}"` : 'No organization groups available'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Associated Org Groups. A section label over a chip run —
                  one or two group names do not need a card of their own. */}
              {projectOrgGroups.length > 0 && (
                <div className="mb-3 sm:mb-4">
                  <h4 className="text-[11px] sm:text-sm font-semibold uppercase sm:normal-case tracking-wider sm:tracking-normal text-gray-400 sm:text-gray-700 dark:sm:text-gray-300 mb-1.5 sm:mb-2">
                    Groups
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({projectOrgGroups.length})
                    </span>
                  </h4>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {projectOrgGroups.map((assoc: any) => {
                      const isPendingRemove = pendingRemoveGroupId === assoc.id
                      return (
                        <div
                          key={assoc.id}
                          /* A group name is a chip, not a card: it was
                             `px-3 py-1.5` with a 16px icon and a 14px label,
                             so two of them filled a phone row. Sized to sit
                             beside Add Member rather than dwarf it. */
                          className={clsx(
                            "flex items-center gap-1.5 h-7 px-2 sm:px-3 sm:py-1.5 sm:h-auto rounded-md sm:rounded-lg border transition-colors",
                            isPendingRemove
                              ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                              : "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800"
                          )}
                        >
                          <Building2 className={clsx(
                            "w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0",
                            isPendingRemove
                              ? "text-red-600 dark:text-red-400"
                              : "text-indigo-600 dark:text-indigo-400"
                          )} />
                          <span className={clsx(
                            "text-[12px] sm:text-sm font-medium truncate max-w-[9rem] sm:max-w-none",
                            isPendingRemove
                              ? "text-red-700 dark:text-red-300"
                              : "text-indigo-700 dark:text-indigo-300"
                          )}>
                            {assoc.org_group?.name || 'Unknown Group'}
                          </span>
                          {canManageProject && (
                            isPendingRemove ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    removeOrgGroupMutation.mutate(assoc.id)
                                    setPendingRemoveGroupId(null)
                                  }}
                                  className="p-1 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                                  title="Confirm remove"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => setPendingRemoveGroupId(null)}
                                  className="p-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                                  title="Cancel"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setPendingRemoveGroupId(assoc.id)}
                                className="p-0.5 rounded text-indigo-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                title="Remove group"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Team Members List */}
              <div className="space-y-1.5 sm:space-y-3">
                {/* Section Header */}
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] sm:text-sm font-semibold uppercase sm:normal-case tracking-wider sm:tracking-normal text-gray-400 sm:text-gray-700 dark:sm:text-gray-300">
                    <span className="sm:hidden">Members</span>
                    <span className="hidden sm:inline">Current Team</span>
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({(teamMembers?.filter((m: any) => m.assigned_to !== projectData.created_by).length || 0) + (projectData.creator ? 1 : 0)} member{((teamMembers?.filter((m: any) => m.assigned_to !== projectData.created_by).length || 0) + (projectData.creator ? 1 : 0)) !== 1 ? 's' : ''})
                    </span>
                  </h4>
                </div>

                {/* Project Creator (Owner) */}
                {projectData.creator && (
                  /* Member rows scan as a list on a phone: tighter padding
                     and a smaller avatar, so several fit a viewport instead
                     of two. Desktop keeps the roomier card. */
                  <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                          {projectData.creator.first_name?.[0] || projectData.creator.email?.[0]?.toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm sm:text-base font-medium text-gray-900 dark:text-white">
                          {projectData.creator.first_name && projectData.creator.last_name
                            ? `${projectData.creator.first_name} ${projectData.creator.last_name}`
                            : projectData.creator.email}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          Project creator
                        </p>
                      </div>
                    </div>
                    <Badge className="shrink-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                      Owner
                    </Badge>
                  </div>
                )}

                {/* Other Team Members */}
                {teamMembers?.filter((m: any) => m.assigned_to !== projectData.created_by).map((member: any) => {
                  const isRecentlyAdded = recentlyAddedIds.has(member.assigned_to)
                  const isPendingRemove = pendingRemoveMemberId === member.id

                  return (
                    <div
                      key={member.id}
                      className={clsx(
                        "flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-3 rounded-lg border transition-all duration-300",
                        isRecentlyAdded
                          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                          : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                      )}
                    >
                      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <div className={clsx(
                          "w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-full flex items-center justify-center transition-colors",
                          isRecentlyAdded
                            ? "bg-green-100 dark:bg-green-900/30"
                            : "bg-primary-100 dark:bg-primary-900"
                        )}>
                          {isRecentlyAdded ? (
                            <UserCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
                          ) : (
                            <span className="text-sm font-semibold text-primary-600 dark:text-primary-400">
                              {member.user?.first_name?.[0] || member.user?.email?.[0]?.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {member.user?.first_name && member.user?.last_name
                              ? `${member.user.first_name} ${member.user.last_name}`
                              : member.user?.email || 'Unknown User'}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {isRecentlyAdded ? 'Just added' : `Added ${formatDistanceToNow(new Date(member.assigned_at), { addSuffix: true })}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {canManageProject ? (
                          <div className="relative" data-dropdown>
                            <button
                              onClick={() => setOpenRoleDropdown(openRoleDropdown === member.id ? null : member.id)}
                              className={clsx(
                                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                                member.role === 'lead'
                                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                                  : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                              )}
                            >
                              {member.role === 'lead' ? (
                                <Crown className="w-3 h-3" />
                              ) : (
                                <Users2 className="w-3 h-3" />
                              )}
                              <span className="capitalize">{member.role}</span>
                              <ChevronDown className="w-3 h-3 opacity-60" />
                            </button>
                            {openRoleDropdown === member.id && (
                              <div className="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[180px]">
                                <button
                                  onClick={() => {
                                    updateTeamMemberRoleMutation.mutate({ assignmentId: member.id, role: 'lead' })
                                    setOpenRoleDropdown(null)
                                  }}
                                  className={clsx(
                                    'w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-start gap-2.5',
                                    member.role === 'lead' && 'bg-amber-50 dark:bg-amber-900/20'
                                  )}
                                >
                                  <Crown className={clsx(
                                    'w-4 h-4 mt-0.5 flex-shrink-0',
                                    member.role === 'lead' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'
                                  )} />
                                  <div>
                                    <p className={clsx(
                                      'font-medium',
                                      member.role === 'lead' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-white'
                                    )}>Lead</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Can manage project settings</p>
                                  </div>
                                  {member.role === 'lead' && <Check className="w-4 h-4 text-amber-600 dark:text-amber-400 ml-auto mt-0.5" />}
                                </button>
                                <button
                                  onClick={() => {
                                    updateTeamMemberRoleMutation.mutate({ assignmentId: member.id, role: 'collaborator' })
                                    setOpenRoleDropdown(null)
                                  }}
                                  className={clsx(
                                    'w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-start gap-2.5',
                                    member.role === 'collaborator' && 'bg-blue-50 dark:bg-blue-900/20'
                                  )}
                                >
                                  <Users2 className={clsx(
                                    'w-4 h-4 mt-0.5 flex-shrink-0',
                                    member.role === 'collaborator' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'
                                  )} />
                                  <div>
                                    <p className={clsx(
                                      'font-medium',
                                      member.role === 'collaborator' ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-white'
                                    )}>Collaborator</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Can complete deliverables</p>
                                  </div>
                                  {member.role === 'collaborator' && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 ml-auto mt-0.5" />}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className={clsx(
                            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium',
                            member.role === 'lead'
                              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                              : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                          )}>
                            {member.role === 'lead' ? (
                              <Crown className="w-3 h-3" />
                            ) : (
                              <Users2 className="w-3 h-3" />
                            )}
                            <span className="capitalize">{member.role}</span>
                          </div>
                        )}
                        {canManageProject && (
                          isPendingRemove ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  removeTeamMemberMutation.mutate(member.id)
                                  setPendingRemoveMemberId(null)
                                }}
                                className="p-1.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                                title="Confirm remove"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setPendingRemoveMemberId(null)}
                                className="p-1.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setPendingRemoveMemberId(member.id)}
                              className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Remove member"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )
                })}

                {(!teamMembers || teamMembers.filter((m: any) => m.assigned_to !== projectData.created_by).length === 0) && !projectData.creator && !showAddMemberForm && (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400 mb-4">
                      No team members assigned yet.
                    </p>
                    {canManageProject && (
                      <Button onClick={() => setShowAddMemberForm(true)}>
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add Your First Team Member
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            /* On a phone the composer sits at the bottom and the thread
               scrolls above it — the shape every messaging surface uses, and
               the one that keeps the box reachable without scrolling past the
               comments to find it. `order` does it with one DOM: the composer
               stays first in source (it is the primary action, and that is the
               right reading order) and is painted last. Desktop keeps the
               composer above the thread. */
            <div className="max-sm:flex max-sm:flex-col max-sm:h-full">
              {/* New Comment Form */}
              <div className="mb-3 max-sm:order-last max-sm:mb-0 max-sm:shrink-0 max-sm:border-t max-sm:border-gray-200 dark:max-sm:border-gray-700 max-sm:bg-white dark:max-sm:bg-gray-800 max-sm:px-3 max-sm:py-2 max-sm:pb-safe">
                <div className="flex gap-2 mb-2">
                  <div className="flex-1">
                    <MentionInput
                      value={newComment}
                      onChange={(value, mentions, refs) => {
                        setNewComment(value)
                        setCommentMentions(mentions)
                        setCommentReferences(refs)
                      }}
                      placeholder="Add a comment..."
                      rows={1}
                      className="!py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      hideHelper
                    />
                  </div>
                  <Button
                    onClick={() => addCommentMutation.mutate()}
                    disabled={!newComment.trim()}
                    size="sm"
                  >
                    Post
                  </Button>
                </div>
                {/* Reprioritize option */}
                <div className="flex items-center gap-2">
                  {reprioritizeType === 'none' ? (
                    <button
                      onClick={() => setReprioritizeType('project')}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors dark:hover:bg-gray-700 dark:text-gray-400"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      Suggest Reprioritization
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Reprioritize:</span>
                      <button
                        onClick={() => {
                          setReprioritizeType('project')
                          setReprioritizeTarget(null)
                        }}
                        className={clsx(
                          'px-2 py-0.5 text-xs rounded-full transition-colors',
                          reprioritizeType === 'project'
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:bg-gray-800'
                        )}
                      >
                        Project
                      </button>
                      {deliverables?.filter(d => !d.completed).slice(0, 3).map(d => (
                        <button
                          key={d.id}
                          onClick={() => {
                            setReprioritizeType('deliverable')
                            setReprioritizeTarget(d.id)
                          }}
                          className={clsx(
                            'px-2 py-0.5 text-xs rounded-full transition-colors max-w-[100px] truncate',
                            reprioritizeType === 'deliverable' && reprioritizeTarget === d.id
                              ? 'bg-amber-500 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:bg-gray-800'
                          )}
                          title={d.title}
                        >
                          {d.title}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          setReprioritizeType('none')
                          setReprioritizeTarget(null)
                        }}
                        className="p-0.5 text-gray-400 hover:text-gray-600 rounded dark:hover:text-gray-300"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Filters and thread — the scrolling half on a phone. The
                  filter row is sticky inside it, so All / Open / Mentions /
                  Mine stay reachable as the thread scrolls instead of
                  disappearing after the first two comments. */}
              <div className="max-sm:order-first max-sm:flex-1 max-sm:min-h-0 max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:px-3 max-sm:pt-1 [&>*:first-of-type]:max-sm:sticky [&>*:first-of-type]:max-sm:top-0 [&>*:first-of-type]:max-sm:z-10 [&>*:first-of-type]:max-sm:bg-white dark:[&>*:first-of-type]:max-sm:bg-gray-900 [&>*:first-of-type]:max-sm:py-1.5">
              {/* Filter and sort controls. Four filters and a sort toggle on
                  one 390px row left each filter about 60px. The sort drops to
                  its own line on a phone rather than competing for width the
                  filters need to stay readable. */}
              <div className="flex flex-wrap items-center justify-between gap-y-1 mb-2">
                <div className="flex items-center gap-1 min-w-0">
                  {[
                    { value: 'all', label: 'All' },
                    { value: 'unresolved', label: 'Open' },
                    { value: 'mentions', label: 'Mentions' },
                    { value: 'mine', label: 'Mine' },
                  ].map(filter => (
                    <button
                      key={filter.value}
                      onClick={() => setCommentFilter(filter.value as typeof commentFilter)}
                      className={clsx(
                        'px-2 py-1 text-xs rounded transition-colors',
                        commentFilter === filter.value
                          ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white font-medium'
                          : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400'
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCommentSort(commentSort === 'newest' ? 'oldest' : 'newest')}
                  className="no-touch-target tap-pad basis-full sm:basis-auto text-left text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400"
                >
                  {commentSort === 'newest' ? 'Newest first' : 'Oldest first'}
                </button>
              </div>

              {/* Comments Thread */}
              {commentsError && (
                <div className="text-center py-6 text-red-500 text-sm">
                  Error loading comments. Please refresh.
                </div>
              )}
              {!commentsError && commentTree.length === 0 && (
                <div className="text-center py-6 text-gray-500 text-sm dark:text-gray-400">
                  {commentFilter === 'all' ? 'No comments yet' : 'No matching comments'}
                </div>
              )}
              <div className="max-h-[400px] overflow-y-auto overflow-x-hidden">
                {commentTree.map((comment: any) => {
                  const renderComment = (comment: any, depth: number = 0) => {
                    const reactions = comment.project_comment_reactions || []
                    const likes = reactions.filter((r: any) => r.reaction_type === 'like')
                    const acknowledges = reactions.filter((r: any) => r.reaction_type === 'acknowledge')
                    const userLiked = likes.some((r: any) => r.user_id === user?.id)
                    const userAcknowledged = acknowledges.some((r: any) => r.user_id === user?.id)
                    const isCollapsed = collapsedComments.has(comment.id)
                    const hasReplies = comment.replies && comment.replies.length > 0
                    const isOwner = comment.user_id === user?.id
                    const isEditing = editingCommentId === comment.id
                    const isResolved = !!comment.resolved_at
                    // A comment is "actionable" if it has reprioritization metadata or mentions
                    const isActionable = !!(comment.metadata?.reprioritize || comment.metadata?.mentions?.length)
                    const initials = ((comment.user?.first_name?.[0] || '') + (comment.user?.last_name?.[0] || '')) || comment.user?.email?.[0]?.toUpperCase() || '?'
                    const displayName = comment.user?.first_name && comment.user?.last_name
                      ? `${comment.user.first_name} ${comment.user.last_name}`
                      : comment.user?.email?.split('@')[0] || 'Anonymous'

                    // Parse @ mentions in content
                    const renderContent = (content: string) => {
                      const mentionRegex = /@(\w+(?:\s+\w+)?)/g
                      const parts = content.split(mentionRegex)
                      return parts.map((part, i) => {
                        if (i % 2 === 1) {
                          return <span key={i} className="text-primary-600 dark:text-primary-400 font-medium">@{part}</span>
                        }
                        return part
                      })
                    }

                    return (
                      <div key={comment.id} className={clsx(
                        'py-2 border-b border-gray-100 dark:border-gray-800',
                        depth > 0 && 'ml-8 border-l-2 border-l-gray-200 dark:border-l-gray-700 pl-3'
                      )}>
                        {/* Comment Header */}
                        <div className="flex items-center gap-2 mb-1">
                          {hasReplies && (
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedComments)
                                if (isCollapsed) {
                                  newCollapsed.delete(comment.id)
                                } else {
                                  newCollapsed.add(comment.id)
                                }
                                setCollapsedComments(newCollapsed)
                              }}
                              className="p-0.5 rounded hover:bg-gray-100 transition-colors dark:hover:bg-gray-700"
                            >
                              <ChevronRight className={clsx(
                                'w-4 h-4 text-gray-400 transition-transform',
                                !isCollapsed && 'rotate-90'
                              )} />
                            </button>
                          )}
                          <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-medium text-primary-600 dark:text-primary-400">
                              {initials}
                            </span>
                          </div>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {displayName}
                          </span>
                          <span className="text-xs text-gray-400">
                            {comment.created_at ? formatDistanceToNow(new Date(comment.created_at), { addSuffix: true }) : ''}
                          </span>
                          {isResolved && (
                            <span className="flex items-center gap-1 text-xs text-green-600">
                              <CircleCheck className="w-3.5 h-3.5" />
                              Resolved
                            </span>
                          )}
                        </div>

                        {/* Comment Content */}
                        {!isCollapsed && (
                          <>
                            <div className={clsx(hasReplies ? 'ml-10' : 'ml-8')}>
                              {isEditing ? (
                                <div className="space-y-2">
                                  <TextArea
                                    value={editCommentContent}
                                    onChange={(e) => setEditCommentContent(e.target.value)}
                                    rows={2}
                                    className="text-sm"
                                  />
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => editCommentMutation.mutate({ commentId: comment.id, content: editCommentContent })}
                                      disabled={!editCommentContent.trim()}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setEditingCommentId(null)
                                        setEditCommentContent('')
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                                ) : (
                                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                    {renderContent(comment.content)}
                                  </p>
                                )}
                              </div>

                              {/* Comment Actions */}
                              {!isEditing && (
                                /* Up to six actions — Like, Reply, Edit,
                                   Delete, Resolve, + Task — in a row that did
                                   not wrap, indented 32-40px, on a 390px
                                   screen: the last two ran off the right
                                   edge with nothing to scroll. They wrap
                                   instead, so every action stays reachable
                                   and nothing clips. */
                                <div className={clsx('mt-2 flex flex-wrap items-center gap-x-3 gap-y-1', hasReplies ? 'ml-6 sm:ml-10' : 'ml-5 sm:ml-8')}>
                                  {/* Like */}
                                  <button
                                    onClick={() => toggleReactionMutation.mutate({ commentId: comment.id, reactionType: 'like' })}
                                    className={clsx(
                                      'flex items-center gap-1 text-xs transition-colors',
                                      userLiked ? 'text-red-500' : 'text-gray-400 hover:text-red-500'
                                    )}
                                  >
                                    <Heart className={clsx('w-3.5 h-3.5', userLiked && 'fill-current')} />
                                    {likes.length > 0 ? likes.length : 'Like'}
                                  </button>

                                  {/* Reply */}
                                  <button
                                    onClick={() => {
                                      setReplyingTo(replyingTo === comment.id ? null : comment.id)
                                      setReplyContent('')
                                    }}
                                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
                                  >
                                    <Reply className="w-3.5 h-3.5" />
                                    Reply
                                  </button>

                                  {/* The `⋯` that gates the three secondary
                                      actions below on a phone. */}
                                  <button
                                    onClick={() => setOpenCommentActions(
                                      openCommentActions === comment.id ? null : comment.id
                                    )}
                                    aria-expanded={openCommentActions === comment.id}
                                    aria-label="More comment actions"
                                    className="no-touch-target tap-pad sm:hidden text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </button>

                                  {/* Edit, Delete and + Task — inline on a
                                      desktop, behind the `⋯` on a phone. One
                                      copy of each, shown or hidden. */}
                                  <span className={clsx(
                                    'items-center gap-x-3 gap-y-1 flex-wrap',
                                    openCommentActions === comment.id ? 'flex' : 'hidden sm:flex'
                                  )}>

                                  {/* Edit (owner only) */}
                                  {isOwner && (
                                    <button
                                      onClick={() => {
                                        setEditingCommentId(comment.id)
                                        setEditCommentContent(comment.content)
                                      }}
                                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
                                    >
                                      Edit
                                    </button>
                                  )}

                                  {/* Delete (owner only) */}
                                  {isOwner && (
                                    <button
                                      onClick={() => {
                                        if (window.confirm('Delete this comment?')) {
                                          deleteCommentMutation.mutate(comment.id)
                                        }
                                      }}
                                      className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                      Delete
                                    </button>
                                  )}

                                  {/* Resolve (only for actionable) */}
                                  {(isActionable || isResolved) && (
                                    <button
                                      onClick={() => toggleResolvedMutation.mutate({ commentId: comment.id, resolved: !isResolved })}
                                      disabled={toggleResolvedMutation.isPending}
                                      className={clsx(
                                        'text-xs transition-colors',
                                        isResolved ? 'text-green-600' : 'text-gray-400 hover:text-green-600'
                                      )}
                                    >
                                      {isResolved ? 'Unresolve' : 'Resolve'}
                                    </button>
                                  )}

                                  {/* To Task */}
                                  {!isResolved && (
                                    <button
                                      onClick={() => {
                                        const lines = comment.content.split('\n')
                                        const title = lines[0].replace(/^\*\*.*?\*\*\s*/, '').replace(/^🔄\s*/, '').slice(0, 100) || 'New Deliverable'
                                        const description = lines.slice(1).join('\n').trim()
                                        setConvertToDeliverableModal({
                                          commentId: comment.id,
                                          title,
                                          description,
                                          dueDate: '',
                                          assignees: [],
                                          showAssigneeDropdown: false
                                        })
                                      }}
                                      disabled={convertToDeliverableMutation.isPending}
                                      className="text-xs text-gray-400 hover:text-primary-600 transition-colors"
                                    >
                                      + Task
                                    </button>
                                  )}
                                  </span>
                                </div>
                              )}

                              {/* Reply Form */}
                              {replyingTo === comment.id && (
                                <div className={clsx('mt-2', hasReplies ? 'ml-10' : 'ml-8')}>
                                  <div className="flex gap-2">
                                    <TextArea
                                      value={replyContent}
                                      onChange={(e) => setReplyContent(e.target.value)}
                                      placeholder={`Reply to ${displayName}...`}
                                      rows={1}
                                      className="flex-1 text-sm"
                                    />
                                    <div className="flex flex-col gap-1">
                                      <Button
                                        size="sm"
                                        onClick={() => addCommentMutation.mutate(comment.id)}
                                        disabled={!replyContent.trim()}
                                      >
                                        Reply
                                      </Button>
                                      <button
                                        onClick={() => {
                                          setReplyingTo(null)
                                          setReplyContent('')
                                        }}
                                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Nested Replies */}
                              {hasReplies && !isCollapsed && (
                                <div className="mt-2">
                                  {comment.replies.map((reply: any) => renderComment(reply, depth + 1))}
                                </div>
                              )}
                            </>
                          )}

                          {/* Collapsed indicator */}
                          {isCollapsed && hasReplies && (
                            <div className={clsx('text-xs text-gray-400 mt-1', hasReplies ? 'ml-10' : 'ml-8')}>
                              {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'} hidden
                            </div>
                          )}
                      </div>
                    )
                  }

                  return renderComment(comment)
                })}

                {(!commentTree || commentTree.length === 0) && (
                  <div className="text-center py-12">
                    <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400 mb-1">
                      No comments yet
                    </p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      Be the first to share your thoughts
                    </p>
                  </div>
                )}
              </div>
              </div>
            </div>
          )}

          {/* Dependencies Tab */}
          {activeTab === 'dependencies' && (
            <DependencyManager project={project} onNavigate={onNavigate} />
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <ProjectActivityFeed projectId={project.id} />
          )}
        </div>
      )}

      {/* Blocked Reason Modal */}
      {showBlockedReasonModal && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowBlockedReasonModal(false)}
          />
          <div className="fixed inset-x-4 top-[20%] max-w-md mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-2xl z-50">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Mark as Blocked
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Describe why this project is blocked
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4">
              <TextArea
                value={blockedReasonInput}
                onChange={(e) => setBlockedReasonInput(e.target.value)}
                placeholder="e.g., Waiting for client approval, Budget review pending, Dependency on external team..."
                rows={3}
                autoFocus
              />
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowBlockedReasonModal(false)
                  setBlockedReasonInput(projectData.blocked_reason || '')
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  updateProjectStatusMutation.mutate({
                    status: 'blocked',
                    blockedReason: blockedReasonInput.trim() || null
                  })
                  setShowBlockedReasonModal(false)
                }}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Lock className="w-4 h-4 mr-2" />
                Mark as Blocked
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Convert to Deliverable Modal */}
      {convertToDeliverableModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setConvertToDeliverableModal(null)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full mx-auto transform transition-all">
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <ListPlus className="w-5 h-5 text-primary-600" />
                    Create Deliverable
                  </h3>
                  <button
                    onClick={() => setConvertToDeliverableModal(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Create a new deliverable from this comment. The comment will be marked as resolved.
                </p>

                {/* Form */}
                <div className="space-y-4">
                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Title <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={convertToDeliverableModal.title}
                      onChange={(e) => setConvertToDeliverableModal({
                        ...convertToDeliverableModal,
                        title: e.target.value
                      })}
                      placeholder="Deliverable title"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Description
                    </label>
                    <TextArea
                      value={convertToDeliverableModal.description}
                      onChange={(e) => setConvertToDeliverableModal({
                        ...convertToDeliverableModal,
                        description: e.target.value
                      })}
                      placeholder="Optional description"
                      rows={3}
                    />
                  </div>

                  {/* Due Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Due Date
                    </label>
                    <Input
                      type="date"
                      value={convertToDeliverableModal.dueDate}
                      onChange={(e) => setConvertToDeliverableModal({
                        ...convertToDeliverableModal,
                        dueDate: e.target.value
                      })}
                    />
                  </div>

                  {/* Assignees - Multi-select */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Assignees
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setConvertToDeliverableModal({
                          ...convertToDeliverableModal,
                          showAssigneeDropdown: !convertToDeliverableModal.showAssigneeDropdown
                        })}
                        className={clsx(
                          'w-full h-10 flex items-center justify-between px-3 rounded-lg border text-left text-sm transition-colors',
                          convertToDeliverableModal.assignees.length > 0
                            ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
                        )}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          {convertToDeliverableModal.assignees.length > 0 ? (
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex -space-x-1">
                                {convertToDeliverableModal.assignees.slice(0, 3).map((userId, idx) => {
                                  const member = teamMembers?.find((m: any) => m.assigned_to === userId)
                                  const memberUser = member?.user
                                  const initials = (memberUser?.first_name?.[0] || '') + (memberUser?.last_name?.[0] || '') || memberUser?.email?.[0]?.toUpperCase() || '?'
                                  return (
                                    <span
                                      key={userId}
                                      className="w-5 h-5 rounded-full bg-primary-200 dark:bg-primary-700 border border-white dark:border-gray-700 text-[9px] font-medium text-primary-700 dark:text-primary-200 flex items-center justify-center"
                                      style={{ zIndex: 3 - idx }}
                                    >
                                      {initials}
                                    </span>
                                  )
                                })}
                                {convertToDeliverableModal.assignees.length > 3 && (
                                  <span className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600 border border-white dark:border-gray-700 text-[9px] font-medium text-gray-600 dark:text-gray-300 flex items-center justify-center">
                                    +{convertToDeliverableModal.assignees.length - 3}
                                  </span>
                                )}
                              </div>
                              <span className="text-gray-700 dark:text-gray-300 truncate">
                                {convertToDeliverableModal.assignees.length} selected
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">Select assignees...</span>
                          )}
                        </div>
                        <ChevronDown className={clsx(
                          'w-4 h-4 text-gray-400 transition-transform flex-shrink-0',
                          convertToDeliverableModal.showAssigneeDropdown && 'rotate-180'
                        )} />
                      </button>

                      {/* Dropdown with click-away backdrop */}
                      {convertToDeliverableModal.showAssigneeDropdown && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setConvertToDeliverableModal({
                              ...convertToDeliverableModal,
                              showAssigneeDropdown: false
                            })}
                          />
                          <div className="absolute left-0 right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 max-h-48 overflow-y-auto">
                          {teamMembers && teamMembers.length > 0 ? (
                            teamMembers.map((member: any) => {
                              const isSelected = convertToDeliverableModal.assignees.includes(member.assigned_to)
                              const memberUser = member.user
                              const initials = (memberUser?.first_name?.[0] || '') + (memberUser?.last_name?.[0] || '') || memberUser?.email?.[0]?.toUpperCase() || '?'
                              const fullName = `${memberUser?.first_name || ''} ${memberUser?.last_name || ''}`.trim() || memberUser?.email?.split('@')[0] || 'Unknown'
                              return (
                                <button
                                  key={member.assigned_to}
                                  type="button"
                                  onClick={() => {
                                    if (isSelected) {
                                      setConvertToDeliverableModal({
                                        ...convertToDeliverableModal,
                                        assignees: convertToDeliverableModal.assignees.filter(id => id !== member.assigned_to)
                                      })
                                    } else {
                                      setConvertToDeliverableModal({
                                        ...convertToDeliverableModal,
                                        assignees: [...convertToDeliverableModal.assignees, member.assigned_to]
                                      })
                                    }
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                >
                                  <div className={clsx(
                                    'w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0',
                                    isSelected
                                      ? 'bg-primary-600 border-primary-600'
                                      : 'border-gray-300 dark:border-gray-600'
                                  )}>
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                  <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 text-[10px] font-medium flex items-center justify-center flex-shrink-0">
                                    {initials}
                                  </span>
                                  <span className={clsx(
                                    'truncate',
                                    isSelected ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-700 dark:text-gray-300'
                                  )}>
                                    {fullName}
                                  </span>
                                </button>
                              )
                            })
                          ) : (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                              No team members available
                            </div>
                          )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-6">
                  <Button
                    variant="outline"
                    onClick={() => setConvertToDeliverableModal(null)}
                    className="flex-1"
                    disabled={convertToDeliverableMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (convertToDeliverableModal.title.trim()) {
                        convertToDeliverableMutation.mutate({
                          commentId: convertToDeliverableModal.commentId,
                          title: convertToDeliverableModal.title.trim(),
                          description: convertToDeliverableModal.description.trim() || undefined,
                          dueDate: convertToDeliverableModal.dueDate || undefined,
                          assignees: convertToDeliverableModal.assignees.length > 0 ? convertToDeliverableModal.assignees : undefined
                        })
                        setConvertToDeliverableModal(null)
                      }
                    }}
                    className="flex-1"
                    disabled={!convertToDeliverableModal.title.trim() || convertToDeliverableMutation.isPending}
                    loading={convertToDeliverableMutation.isPending}
                  >
                    Create Deliverable
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
