import React, { useState, useEffect, useMemo, useCallback } from 'react'
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
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'
import { useAuth } from '../../hooks/useAuth'
import { ProjectActivityFeed } from '../projects/ProjectActivityFeed'
import { DependencyManager } from '../projects/DependencyManager'
import { DatePicker } from '../ui/DatePicker'
import { useProjectDependencies } from '../../hooks/useProjectDependencies'
import { MentionInput } from '../ui/MentionInput'

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

  const assignments = deliverable.deliverable_assignments || []
  const isOverdue = deliverable.due_date && !deliverable.completed && new Date(deliverable.due_date) < new Date()

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 group hover:border-gray-300 dark:hover:border-gray-600 shadow-sm',
        deliverable.completed && 'bg-gray-50 dark:bg-gray-800/50',
        isJustDropped && 'animate-drop-pop'
      )}
    >
      {/* Drag handle - only show in priority mode for incomplete items */}
      {canManageProject && !deliverable.completed && !isDragDisabled && (
        <button
          {...attributes}
          {...listeners}
          className="flex-shrink-0 p-1 -ml-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 touch-none"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}

      {/* Priority number */}
      {priorityNumber !== null && (
        <span className={clsx(
          'flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center',
          deliverable.completed
            ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
            : 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
        )}>
          {priorityNumber}
        </span>
      )}

      {/* Completion checkbox */}
      <button
        onClick={onToggle}
        disabled={!canCompleteDeliverables}
        className={clsx(
          'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0',
          deliverable.completed
            ? 'bg-primary-500 border-primary-500'
            : 'border-gray-300 dark:border-gray-600 hover:border-primary-500',
          !canCompleteDeliverables && 'opacity-50 cursor-not-allowed'
        )}
      >
        {deliverable.completed && (
          <CheckCircle className="w-3 h-3 text-white" />
        )}
      </button>

      {/* Title */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={clsx(
          'text-sm truncate',
          deliverable.completed
            ? 'line-through text-gray-400 dark:text-gray-500'
            : 'text-gray-900 dark:text-white'
        )}>
          {deliverable.title}
        </span>
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

      <div className="flex items-center gap-2 flex-shrink-0">
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
            'text-xs px-2 py-1 rounded',
            isOverdue
              ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
              : 'text-gray-500 dark:text-gray-400'
          )}>
            {format(new Date(deliverable.due_date), 'MMM d')}
          </span>
        ) : null}

        {/* Delete button */}
        {canManageProject && (
          <button
            onClick={onDelete}
            className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

export function ProjectDetailTab({ project, onNavigate }: ProjectDetailTabProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'deliverables' | 'team' | 'dependencies' | 'comments' | 'activity'>('overview')
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
  const { data: freshProject } = useQuery({
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
        .from('org_chart_nodes')
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
  const [localDueDate, setLocalDueDate] = useState(project.due_date)
  const [localStatus, setLocalStatus] = useState(project.status)
  const [localPriority, setLocalPriority] = useState(project.priority)
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)
  const [showBlockedReasonModal, setShowBlockedReasonModal] = useState(false)
  const [blockedReasonInput, setBlockedReasonInput] = useState(project.blocked_reason || '')

  // Sync local state when project prop changes
  useEffect(() => {
    setLocalDueDate(project.due_date)
    setLocalStatus(project.status)
    setLocalPriority(project.priority)
    setBlockedReasonInput(project.blocked_reason || '')
  }, [project.due_date, project.status, project.priority, project.blocked_reason])

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

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-6 py-4">
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
              <div className="grid grid-cols-3 gap-4">
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
                    setEditedTitle(project.title)
                    setEditedDescription(project.description || '')
                    setEditedStatus(project.status)
                    setEditedPriority(project.priority)
                    setEditedDueDate(project.due_date || '')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <FolderKanban className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{project.title}</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {project.created_at ? `Created ${formatDistanceToNow(new Date(project.created_at), { addSuffix: true })}` : 'Recently created'}
                    </p>
                  </div>
                </div>
                {canManageProject && (
                  <Button variant="outline" onClick={() => setEditingProject(true)}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Project
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-3 mb-4">
                {/* Status - clickable dropdown for managers */}
                {canManageProject ? (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowStatusDropdown(!showStatusDropdown)
                        setShowPriorityDropdown(false)
                      }}
                      className={clsx(
                        'flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium transition-colors hover:ring-2 hover:ring-offset-1',
                        isBlocked
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:ring-red-300'
                          : getStatusColor(localStatus) + ' hover:ring-primary-300'
                      )}
                    >
                      {isBlocked ? (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>Blocked</span>
                        </>
                      ) : (
                        <>
                          {getStatusIcon(localStatus)}
                          <span className="capitalize">{localStatus.replace('_', ' ')}</span>
                        </>
                      )}
                      <ChevronDown className="w-3 h-3 ml-1" />
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
                ) : localStatus && (
                  <Badge className={clsx('flex items-center gap-1', getStatusColor(localStatus))}>
                    {getStatusIcon(localStatus)}
                    <span className="capitalize">{localStatus.replace('_', ' ')}</span>
                  </Badge>
                )}

                {/* Priority - clickable dropdown for managers */}
                {canManageProject ? (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowPriorityDropdown(!showPriorityDropdown)
                        setShowStatusDropdown(false)
                      }}
                      className={clsx(
                        'flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium transition-colors hover:ring-2 hover:ring-offset-1 hover:ring-primary-300',
                        getPriorityColor(localPriority)
                      )}
                    >
                      <span className="capitalize">{localPriority}</span>
                      <ChevronDown className="w-3 h-3 ml-1" />
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
                  <DatePicker
                    value={localDueDate}
                    onChange={(date) => updateProjectDueDateMutation.mutate(date)}
                    placeholder="Set due date"
                    showOverdue
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

              {project.description && (
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {project.description}
                </p>
              )}

              {/* Progress Bar */}
              {totalDeliverables > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-600 dark:text-gray-400">
                      {completedDeliverables} of {totalDeliverables} deliverables completed
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {Math.round(completionPercentage)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all"
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
          <div className="flex border-t border-gray-200 dark:border-gray-700">
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
                onClick={() => setActiveTab(tab.id as any)}
                className={clsx(
                  'flex items-center gap-2 px-6 py-3 border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {!editingProject && (
        <div className={clsx(
          "flex-1 overflow-y-auto",
          activeTab === 'activity' ? 'p-2' : 'p-6'
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
            <div className="space-y-6">
              {/* Overdue Tasks, Upcoming Tasks */}
              <div className="grid grid-cols-2 gap-4">
                {/* Overdue Tasks */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-red-100 dark:bg-red-900/30 rounded">
                      <Flag className="w-4 h-4 text-red-600 dark:text-red-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Overdue Tasks
                    </h3>
                    {overdueTasks.length > 0 && (
                      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs">
                        {overdueTasks.length}
                      </Badge>
                    )}
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
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No overdue tasks</p>
                  )}
                </Card>

                {/* Upcoming Tasks */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded">
                      <Target className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Due This Week
                    </h3>
                    {upcomingTasks.length > 0 && (
                      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs">
                        {upcomingTasks.length}
                      </Badge>
                    )}
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
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No tasks due this week</p>
                  )}
                </Card>
              </div>

              {/* Bottom Row: Team, Dependencies, Org Groups */}
              <div className="grid grid-cols-3 gap-4">
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
                            <span className="text-xs text-gray-500">+{blockedBy.length - 2} more</span>
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
                            <span className="text-xs text-gray-500">+{blocking.length - 2} more</span>
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
                    {/* Priority */}
                    <div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Priority</span>
                      <div className="mt-1">
                        <Badge className={clsx('text-xs', getPriorityColor(project.priority))}>
                          <span className="capitalize">{project.priority}</span>
                        </Badge>
                      </div>
                    </div>
                    {/* Created */}
                    <div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Created</span>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                        {project.created_at ? formatDistanceToNow(new Date(project.created_at), { addSuffix: true }) : 'Unknown'}
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
              {/* Add Deliverable Form - only for managers */}
              {canManageProject && (
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent">
                  <Plus className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    value={newDeliverable}
                    onChange={(e) => setNewDeliverable(e.target.value)}
                    placeholder="Add deliverable..."
                    className="w-80 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none cursor-text"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newDeliverable.trim()) {
                        addDeliverableMutation.mutate()
                      }
                    }}
                  />
                  {/* Assign button with dropdown - only show if there are team members */}
                  {teamMembers && teamMembers.length > 0 && (
                    <div className="relative pl-2 border-l border-gray-200 dark:border-gray-600" data-dropdown>
                      <button
                        type="button"
                        onClick={() => setShowNewDeliverableAssignees(!showNewDeliverableAssignees)}
                        className={clsx(
                          'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors',
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
                </div>
                <button
                  onClick={() => addDeliverableMutation.mutate()}
                  disabled={!newDeliverable.trim()}
                  className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add
                </button>
              </div>
              )}

              {/* Sort Toggle */}
              {sortedDeliverables.length > 0 && (
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">Sort by:</span>
                    <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <button
                        onClick={() => setDeliverableSortMode('priority')}
                        className={clsx(
                          'px-3 py-1.5 text-xs font-medium transition-colors',
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
                          'px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 dark:border-gray-700',
                          deliverableSortMode === 'due_date'
                            ? 'bg-primary-600 text-white'
                            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                        )}
                      >
                        Due Date
                      </button>
                    </div>
                  </div>
                  {deliverableSortMode === 'priority' && canManageProject && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
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
                  <div className="space-y-2 overflow-x-clip">
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

              {/* Associated Org Groups */}
              {projectOrgGroups.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Associated Groups
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      ({projectOrgGroups.length})
                    </span>
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {projectOrgGroups.map((assoc: any) => {
                      const isPendingRemove = pendingRemoveGroupId === assoc.id
                      return (
                        <div
                          key={assoc.id}
                          className={clsx(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors",
                            isPendingRemove
                              ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                              : "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800"
                          )}
                        >
                          <Building2 className={clsx(
                            "w-4 h-4",
                            isPendingRemove
                              ? "text-red-600 dark:text-red-400"
                              : "text-indigo-600 dark:text-indigo-400"
                          )} />
                          <span className={clsx(
                            "text-sm font-medium",
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
              <div className="space-y-3">
                {/* Section Header */}
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Current Team
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      ({(teamMembers?.filter((m: any) => m.assigned_to !== projectData.created_by).length || 0) + (projectData.creator ? 1 : 0)} member{((teamMembers?.filter((m: any) => m.assigned_to !== projectData.created_by).length || 0) + (projectData.creator ? 1 : 0)) !== 1 ? 's' : ''})
                    </span>
                  </h4>
                </div>

                {/* Project Creator (Owner) */}
                {projectData.creator && (
                  <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                          {projectData.creator.first_name?.[0] || projectData.creator.email?.[0]?.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {projectData.creator.first_name && projectData.creator.last_name
                            ? `${projectData.creator.first_name} ${projectData.creator.last_name}`
                            : projectData.creator.email}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Project creator
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
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
                        "flex items-center justify-between px-4 py-3 rounded-lg border transition-all duration-300",
                        isRecentlyAdded
                          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                          : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={clsx(
                          "w-9 h-9 rounded-full flex items-center justify-center transition-colors",
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
            <div>
              {/* New Comment Form */}
              <div className="mb-3">
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
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      Suggest Reprioritization
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-gray-500">Reprioritize:</span>
                      <button
                        onClick={() => {
                          setReprioritizeType('project')
                          setReprioritizeTarget(null)
                        }}
                        className={clsx(
                          'px-2 py-0.5 text-xs rounded-full transition-colors',
                          reprioritizeType === 'project'
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                        className="p-0.5 text-gray-400 hover:text-gray-600 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Filter and sort controls */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
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
                          : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCommentSort(commentSort === 'newest' ? 'oldest' : 'newest')}
                  className="text-xs text-gray-500 hover:text-gray-700"
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
                <div className="text-center py-6 text-gray-500 text-sm">
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
                              className="p-0.5 rounded hover:bg-gray-100 transition-colors"
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
                                <div className={clsx('mt-2 flex items-center gap-3', hasReplies ? 'ml-10' : 'ml-8')}>
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
                                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                                  >
                                    <Reply className="w-3.5 h-3.5" />
                                    Reply
                                  </button>

                                  {/* Edit (owner only) */}
                                  {isOwner && (
                                    <button
                                      onClick={() => {
                                        setEditingCommentId(comment.id)
                                        setEditCommentContent(comment.content)
                                      }}
                                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
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
                                        className="text-xs text-gray-400 hover:text-gray-600"
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
