import React, { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
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
  ArrowRight
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { TextArea } from '../ui/TextArea'
import { Select } from '../ui/Select'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow, format } from 'date-fns'
import { clsx } from 'clsx'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'
import { useAuth } from '../../hooks/useAuth'
import { ProjectActivityFeed } from '../projects/ProjectActivityFeed'
import { DependencyManager } from '../projects/DependencyManager'
import { DatePicker } from '../ui/DatePicker'
import { useProjectDependencies } from '../../hooks/useProjectDependencies'

// Project detail tab component

interface ProjectDetailTabProps {
  project: ProjectWithAssignments
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
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
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [collapsedComments, setCollapsedComments] = useState<Set<string>>(new Set())
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentContent, setEditCommentContent] = useState('')
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
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    }
  })

  // Fetch comments with reactions
  const { data: comments } = useQuery({
    queryKey: ['project-comments', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_comments')
        .select(`
          *,
          user:users(id, first_name, last_name, email),
          project_comment_reactions(id, user_id, reaction_type)
        `)
        .eq('project_id', project.id)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data || []
    }
  })

  // Organize comments into tree structure
  const commentTree = useMemo(() => {
    if (!comments) return []

    const commentMap = new Map()
    const rootComments: any[] = []

    // First pass: create map of all comments
    comments.forEach((comment: any) => {
      commentMap.set(comment.id, { ...comment, replies: [] })
    })

    // Second pass: build tree structure
    comments.forEach((comment: any) => {
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

    return rootComments
  }, [comments])

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

  // Local state for due date (to show immediate feedback since project prop may not update)
  const [localDueDate, setLocalDueDate] = useState(project.due_date)

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

      const { error } = await supabase
        .from('project_comments')
        .insert({
          project_id: project.id,
          user_id: user.id,
          content,
          parent_id: parentId || null
        })

      if (error) throw error
    },
    onSuccess: (_, parentId) => {
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] })
      if (parentId) {
        setReplyContent('')
        setReplyingTo(null)
      } else {
        setNewComment('')
      }
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

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
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
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
                    <FolderKanban className="w-5 h-5 text-white" />
                  </div>
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
                {project.status && (
                  <Badge className={clsx('flex items-center gap-1', getStatusColor(project.status))}>
                    {getStatusIcon(project.status)}
                    <span className="capitalize">{project.status.replace('_', ' ')}</span>
                  </Badge>
                )}
                {project.priority && (
                  <Badge className={getPriorityColor(project.priority)}>
                    <span className="capitalize">{project.priority}</span>
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
            // Calculate upcoming and overdue tasks
            const now = new Date()
            const upcomingTasks = deliverables?.filter(d => {
              if (d.completed || !d.due_date) return false
              const dueDate = new Date(d.due_date)
              const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
              return daysUntilDue >= 0 && daysUntilDue <= 7
            }).sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()) || []

            const overdueTasks = deliverables?.filter(d => {
              if (d.completed || !d.due_date) return false
              return new Date(d.due_date) < now
            }).sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()) || []

            // Calculate days until project due date
            const projectDueDate = project.due_date ? new Date(project.due_date) : null
            const daysUntilProjectDue = projectDueDate
              ? Math.ceil((projectDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
              : null

            return (
            <div className="space-y-6">
              {/* Top Row: Status, Progress, Due Date */}
              <div className="grid grid-cols-3 gap-4">
                {/* Status Card */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</span>
                    {canManageProject && (
                      <button
                        onClick={() => setEditingProject(true)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <Badge className={clsx('flex items-center gap-1.5 w-fit text-sm', getStatusColor(project.status))}>
                    {getStatusIcon(project.status)}
                    <span className="capitalize">{project.status.replace('_', ' ')}</span>
                  </Badge>
                  {isBlocked && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-red-600 dark:text-red-400">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Blocked by {blockedBy?.length || 0} project{(blockedBy?.length || 0) !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </Card>

                {/* Progress Card */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Progress</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {Math.round(completionPercentage)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2">
                    <div
                      className={clsx(
                        'h-2.5 rounded-full transition-all duration-300',
                        completionPercentage === 100 ? 'bg-green-500' : 'bg-primary-500'
                      )}
                      style={{ width: `${completionPercentage}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{completedDeliverables} of {totalDeliverables} tasks</span>
                    {totalDeliverables > 0 && completedDeliverables === totalDeliverables && (
                      <span className="text-green-600 dark:text-green-400 font-medium">Complete!</span>
                    )}
                  </div>
                </Card>

                {/* Due Date Card */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Due Date</span>
                    <Calendar className="w-4 h-4 text-gray-400" />
                  </div>
                  {project.due_date ? (
                    <>
                      <div className={clsx(
                        'text-sm font-semibold',
                        isOverdue ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                      )}>
                        {format(new Date(project.due_date), 'MMM d, yyyy')}
                      </div>
                      <div className={clsx(
                        'text-xs mt-1',
                        isOverdue ? 'text-red-500' : daysUntilProjectDue !== null && daysUntilProjectDue <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'
                      )}>
                        {isOverdue ? (
                          <span className="flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Overdue by {Math.abs(daysUntilProjectDue!)} day{Math.abs(daysUntilProjectDue!) !== 1 ? 's' : ''}
                          </span>
                        ) : daysUntilProjectDue === 0 ? (
                          'Due today'
                        ) : daysUntilProjectDue === 1 ? (
                          'Due tomorrow'
                        ) : (
                          `${daysUntilProjectDue} days remaining`
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-500 dark:text-gray-400">No due date set</div>
                  )}
                </Card>
              </div>

              {/* Description */}
              {project.description && (
                <Card className="p-4">
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Description</h3>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {project.description}
                  </p>
                </Card>
              )}

              {/* Middle Row: Overdue Tasks, Upcoming Tasks */}
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

              {/* Deliverables List */}
              <div className="space-y-3">
                {deliverables?.map((deliverable) => {
                  const assignments = deliverable.deliverable_assignments || []
                  const assignedUserIds = assignments.map((a: any) => a.user_id)

                  return (
                    <div
                      key={deliverable.id}
                      className="flex items-center gap-4 px-4 py-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 group hover:border-gray-300 dark:hover:border-gray-600 shadow-sm"
                    >
                      <button
                        onClick={() => toggleDeliverableMutation.mutate({
                          id: deliverable.id,
                          completed: deliverable.completed
                        })}
                        className={clsx(
                          'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0',
                          deliverable.completed
                            ? 'bg-primary-500 border-primary-500'
                            : 'border-gray-300 dark:border-gray-600 hover:border-primary-500'
                        )}
                      >
                        {deliverable.completed && (
                          <CheckCircle className="w-3 h-3 text-white" />
                        )}
                      </button>

                      <span className={clsx(
                        'flex-1 text-sm',
                        deliverable.completed
                          ? 'line-through text-gray-400 dark:text-gray-500'
                          : 'text-gray-900 dark:text-white'
                      )}>
                        {deliverable.title}
                      </span>

                      <div className="flex items-center gap-2">
                        {/* Assignees - only show if there are team members */}
                        {teamMembers && teamMembers.length > 0 && (
                          <div className="relative" data-dropdown>
                            {/* Stacked avatars or assign button - click to open dropdown (managers only) */}
                            {canManageProject ? (
                              <button
                                onClick={() => setOpenAssigneeDropdown(openAssigneeDropdown === deliverable.id ? null : deliverable.id)}
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
                              // Read-only view for non-managers
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
                                  {assignments.length > 3 && (
                                    <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 text-[10px] font-medium flex items-center justify-center">
                                      +{assignments.length - 3}
                                    </div>
                                  )}
                                </div>
                              )
                            )}
                            {/* Dropdown on click with checkboxes - managers only */}
                            {canManageProject && openAssigneeDropdown === deliverable.id && (
                              <div className="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[200px]">
                                <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                                  Assign to
                                </div>
                                {teamMembers.map((member: any) => {
                                  const isAssigned = assignedUserIds.includes(member.assigned_to)
                                  const initials = (member.user?.first_name?.[0] || '') + (member.user?.last_name?.[0] || '') || member.user?.email?.[0]?.toUpperCase()
                                  const fullName = `${member.user?.first_name || ''} ${member.user?.last_name || ''}`.trim() || member.user?.email?.split('@')[0]
                                  return (
                                    <button
                                      key={member.assigned_to}
                                      onClick={() => {
                                        if (isAssigned) {
                                          removeDeliverableAssigneeMutation.mutate({
                                            deliverableId: deliverable.id,
                                            userId: member.assigned_to
                                          })
                                        } else {
                                          addDeliverableAssigneeMutation.mutate({
                                            deliverableId: deliverable.id,
                                            userId: member.assigned_to
                                          })
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

                        {/* Due date - editable for managers, read-only for others */}
                        {canManageProject ? (
                          <DatePicker
                            value={deliverable.due_date}
                            onChange={(date) => updateDeliverableDueDateMutation.mutate({ deliverableId: deliverable.id, dueDate: date })}
                            placeholder="Due"
                            variant="inline"
                            compact
                            showOverdue
                            isCompleted={deliverable.completed}
                            maxDate={project.due_date}
                            projectDueDate={project.due_date}
                          />
                        ) : deliverable.due_date ? (
                          <span className={clsx(
                            'text-xs flex items-center gap-1',
                            !deliverable.completed && new Date(deliverable.due_date) < new Date()
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-500 dark:text-gray-400'
                          )}>
                            <Calendar className="w-3 h-3" />
                            {format(new Date(deliverable.due_date), 'MMM d')}
                          </span>
                        ) : null}

                        {/* Delete button - managers only */}
                        {canManageProject && (
                          <button
                            onClick={() => {
                              if (window.confirm('Delete this deliverable?')) {
                                deleteDeliverableMutation.mutate(deliverable.id)
                              }
                            }}
                            className="p-1 rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}

                {(!deliverables || deliverables.length === 0) && (
                  <div className="text-center py-12">
                    <CheckCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">
                      No deliverables yet. Add your first one above.
                    </p>
                  </div>
                )}
              </div>
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
              <div className="mb-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex gap-2">
                  <TextArea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    rows={1}
                    className="flex-1 !py-2 resize-none"
                  />
                  <Button
                    onClick={() => addCommentMutation.mutate()}
                    disabled={!newComment.trim()}
                    size="sm"
                    className="self-end"
                  >
                    Post
                  </Button>
                </div>
              </div>

              {/* Comments Thread */}
              <div className="space-y-0">
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
                      <div key={comment.id} className={clsx(depth > 0 && 'ml-6 pl-4 border-l-2 border-gray-200 dark:border-gray-700')}>
                        <div className="py-2">
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
                                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {comment.created_at ? formatDistanceToNow(new Date(comment.created_at), { addSuffix: true }) : ''}
                            </span>
                            {comment.updated_at && comment.updated_at !== comment.created_at && (
                              <span className="text-xs text-gray-400 italic">(edited)</span>
                            )}
                          </div>

                          {/* Comment Content */}
                          {!isCollapsed && (
                            <>
                              <div className="ml-8 mb-2">
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
                                <div className="ml-8 flex items-center gap-1 flex-wrap">
                                  {/* Like Button */}
                                  <button
                                    onClick={() => toggleReactionMutation.mutate({ commentId: comment.id, reactionType: 'like' })}
                                    className={clsx(
                                      'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
                                      userLiked
                                        ? 'text-red-500 bg-red-50 dark:bg-red-900/20'
                                        : 'text-gray-500 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    )}
                                  >
                                    <Heart className={clsx('w-3.5 h-3.5', userLiked && 'fill-current')} />
                                    {likes.length > 0 && <span>{likes.length}</span>}
                                    {likes.length === 0 && 'Like'}
                                  </button>

                                  {/* Acknowledge Button */}
                                  <button
                                    onClick={() => toggleReactionMutation.mutate({ commentId: comment.id, reactionType: 'acknowledge' })}
                                    className={clsx(
                                      'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
                                      userAcknowledged
                                        ? 'text-green-600 bg-green-50 dark:bg-green-900/20'
                                        : 'text-gray-500 hover:text-green-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    )}
                                  >
                                    <CheckCheck className="w-3.5 h-3.5" />
                                    {acknowledges.length > 0 && <span>{acknowledges.length}</span>}
                                    {acknowledges.length === 0 && 'Acknowledge'}
                                  </button>

                                  {/* Reply Button */}
                                  <button
                                    onClick={() => {
                                      setReplyingTo(replyingTo === comment.id ? null : comment.id)
                                      setReplyContent('')
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
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
                                      className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
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
                                      className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Delete
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Reply Form */}
                              {replyingTo === comment.id && (
                                <div className="ml-8 mt-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                                  <TextArea
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                    placeholder={`Reply to ${displayName}...`}
                                    rows={2}
                                    className="mb-2"
                                  />
                                  <div className="flex items-center gap-2 justify-end">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setReplyingTo(null)
                                        setReplyContent('')
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => addCommentMutation.mutate(comment.id)}
                                      disabled={!replyContent.trim()}
                                    >
                                      Reply
                                    </Button>
                                  </div>
                                </div>
                              )}

                              {/* Nested Replies */}
                              {hasReplies && (
                                <div className="mt-2">
                                  {comment.replies.map((reply: any) => renderComment(reply, depth + 1))}
                                </div>
                              )}
                            </>
                          )}

                          {/* Collapsed indicator */}
                          {isCollapsed && hasReplies && (
                            <div className="ml-8 text-xs text-gray-500 dark:text-gray-400">
                              {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'} hidden
                            </div>
                          )}
                        </div>
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
    </div>
  )
}
