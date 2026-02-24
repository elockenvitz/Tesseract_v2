import { useState, useMemo, useRef, useEffect } from 'react'
import { X, Plus, Search, Users, Building2, ChevronDown, ChevronRight, Check } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { clsx } from 'clsx'
import type { ProjectStatus, ProjectPriority, ProjectContextType, ProjectAssignmentRole } from '../../types/project'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (projectId: string) => void
  /** Pre-populate linked entities when opening from an entity page (e.g. asset). */
  initialContext?: { type: ProjectContextType; id: string; label: string }
}

interface DeliverableInput {
  id: string
  title: string
}

interface User {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
}

interface TeamMemberInput {
  userId: string
  role: ProjectAssignmentRole
}

export function CreateProjectModal({ isOpen, onClose, onSuccess, initialContext }: CreateProjectModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ProjectStatus>('planning')
  const [priority, setPriority] = useState<ProjectPriority>('medium')
  const [dueDate, setDueDate] = useState('')
  const [linkedEntities, setLinkedEntities] = useState<Array<{ type: ProjectContextType; id: string; label: string }>>([])
  const [linkingType, setLinkingType] = useState<ProjectContextType | ''>('')
  const [linkSearchQuery, setLinkSearchQuery] = useState('')
  const [selectedOrgGroupId, setSelectedOrgGroupId] = useState<string>('')
  const [deliverables, setDeliverables] = useState<DeliverableInput[]>([])
  const [newDeliverable, setNewDeliverable] = useState('')
  const [teamMembers, setTeamMembers] = useState<TeamMemberInput[]>([])
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [showTeamSection, setShowTeamSection] = useState(false)
  const [teamTab, setTeamTab] = useState<'users' | 'groups'>('users')
  const [titleError, setTitleError] = useState(false)
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false)
  const [collapsedOrgTypes, setCollapsedOrgTypes] = useState<Set<string>>(new Set(['division', 'department', 'team', 'portfolio']))
  const orgDropdownRef = useRef<HTMLDivElement>(null)

  const titleRef = useRef<HTMLInputElement>(null)
  const deliverableInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus title on open + seed initial context
  useEffect(() => {
    if (isOpen) {
      if (initialContext) {
        setLinkedEntities(prev =>
          prev.some(le => le.type === initialContext.type && le.id === initialContext.id)
            ? prev
            : [{ type: initialContext.type, id: initialContext.id, label: initialContext.label }]
        )
      }
      const timer = setTimeout(() => titleRef.current?.focus(), 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen, initialContext])

  // Close org dropdown on outside click
  useEffect(() => {
    if (!orgDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target as Node)) {
        setOrgDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [orgDropdownOpen])

  // Fetch all users
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('email')
      if (error) throw error
      return data as User[]
    }
  })

  // Fetch org groups with parent info and settings (portfolio nodes have settings.portfolio_id)
  const { data: orgGroups } = useQuery({
    queryKey: ['org-groups-for-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_org_chart_nodes_v')
        .select('id, name, node_type, parent_id, settings')
        .order('name')
      if (error) throw error
      return data || []
    }
  })

  // Fetch org group memberships (non-portfolio nodes)
  const { data: orgMemberships } = useQuery({
    queryKey: ['org-memberships-for-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .select('user_id, node_id')
      if (error) throw error
      return data || []
    }
  })

  // Fetch portfolio_team memberships (portfolio nodes derive members from here)
  const { data: portfolioTeamData } = useQuery({
    queryKey: ['portfolio-team-for-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_team')
        .select('user_id, portfolio_id')
      if (error) throw error
      return data || []
    }
  })

  // Build map of org group -> member user ids (including child nodes)
  // Portfolio-type nodes derive members from portfolio_team via settings.portfolio_id
  const orgGroupMembers = useMemo(() => {
    if (!orgGroups || orgGroups.length === 0) return new Map<string, string[]>()

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

    // Build portfolio_id -> user_ids map from portfolio_team
    const portfolioMembersMap = new Map<string, string[]>()
    for (const pt of (portfolioTeamData || [])) {
      const existing = portfolioMembersMap.get(pt.portfolio_id)
      if (existing) {
        existing.push(pt.user_id)
      } else {
        portfolioMembersMap.set(pt.portfolio_id, [pt.user_id])
      }
    }

    // Build direct members map (node_id -> array of user_ids)
    // For portfolio nodes: use portfolio_team via settings.portfolio_id
    // For other nodes: use org_chart_node_members
    const directMembersMap = new Map<string, string[]>()
    for (const m of (orgMemberships || [])) {
      const existing = directMembersMap.get(m.node_id)
      if (existing) {
        existing.push(m.user_id)
      } else {
        directMembersMap.set(m.node_id, [m.user_id])
      }
    }

    // Overlay portfolio_team members for portfolio-type nodes
    for (const node of orgGroups) {
      if (node.node_type === 'portfolio' && node.settings?.portfolio_id) {
        const ptMembers = portfolioMembersMap.get(node.settings.portfolio_id)
        if (ptMembers) {
          const existing = directMembersMap.get(node.id) || []
          const merged = new Set([...existing, ...ptMembers])
          directMembersMap.set(node.id, Array.from(merged))
        }
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
  }, [orgGroups, orgMemberships, portfolioTeamData])

  // Filter org groups based on search
  const filteredOrgGroups = useMemo(() => {
    if (!orgGroups) return []
    if (!userSearchQuery.trim()) return orgGroups
    const query = userSearchQuery.toLowerCase()
    return orgGroups.filter(g => g.name.toLowerCase().includes(query))
  }, [orgGroups, userSearchQuery])

  // Fetch assets when linking type is 'asset'
  const { data: assets } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .order('symbol')
      if (error) throw error
      return data
    },
    enabled: linkingType === 'asset'
  })

  // Fetch portfolios when linking type is 'portfolio'
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: linkingType === 'portfolio'
  })

  // Fetch themes when linking type is 'theme'
  const { data: themes } = useQuery({
    queryKey: ['themes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_themes_v')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: linkingType === 'theme'
  })

  // Fetch workflows when linking type is 'workflow'
  const { data: workflows } = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_workflows_v')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: linkingType === 'workflow'
  })

  // Fetch asset lists when linking type is 'list'
  const { data: assetLists } = useQuery({
    queryKey: ['asset-lists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_lists')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: linkingType === 'list'
  })

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('User not authenticated')
      if (!title.trim()) throw new Error('Title is required')

      // Use first linked entity for backward compat on project row
      const firstLink = linkedEntities.length > 0 ? linkedEntities[0] : null

      // Create the project
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          created_by: user.id,
          status,
          priority,
          due_date: dueDate || null,
          context_type: firstLink?.type || null,
          context_id: firstLink?.id || null,
          org_group_id: selectedOrgGroupId || null
        })
        .select()
        .single()

      if (projectError) throw projectError

      // Insert project_contexts for all linked entities
      if (linkedEntities.length > 0) {
        const contextRows = linkedEntities.map(le => ({
          project_id: project.id,
          context_type: le.type,
          context_id: le.id,
          created_by: user.id
        }))

        const { error: contextError } = await supabase
          .from('project_contexts')
          .insert(contextRows)

        if (contextError) throw contextError
      }

      // Create assignments (owner + team members)
      const assignments = [
        {
          project_id: project.id,
          assigned_to: user.id,
          assigned_by: user.id,
          role: 'owner' as ProjectAssignmentRole
        },
        ...teamMembers.map(tm => ({
          project_id: project.id,
          assigned_to: tm.userId,
          assigned_by: user.id,
          role: tm.role
        }))
      ]

      const { error: assignmentError } = await supabase
        .from('project_assignments')
        .insert(assignments)

      if (assignmentError) throw assignmentError

      // Create deliverables if any
      if (deliverables.length > 0) {
        const deliverablesData = deliverables.map((d, index) => ({
          project_id: project.id,
          title: d.title,
          display_order: index
        }))

        const { error: deliverablesError } = await supabase
          .from('project_deliverables')
          .insert(deliverablesData)

        if (deliverablesError) throw deliverablesError
      }

      return project.id
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      resetForm()
      onClose()
      onSuccess?.(projectId)
    }
  })

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setStatus('planning')
    setPriority('medium')
    setDueDate('')
    setLinkedEntities([])
    setLinkingType('')
    setLinkSearchQuery('')
    setSelectedOrgGroupId('')
    setDeliverables([])
    setNewDeliverable('')
    setTeamMembers([])
    setUserSearchQuery('')
    setTitleError(false)
  }

  const getUserName = (u?: User) => {
    if (!u) return 'Unknown'
    if (u.first_name && u.last_name) {
      return `${u.first_name} ${u.last_name}`
    }
    return u.email
  }

  const getUserInitials = (u?: User) => {
    if (!u) return '??'
    if (u.first_name && u.last_name) {
      return `${u.first_name[0]}${u.last_name[0]}`.toUpperCase()
    }
    return u.email.substring(0, 2).toUpperCase()
  }

  const filteredUsers = users?.filter(u => {
    if (!userSearchQuery.trim()) return true
    const query = userSearchQuery.toLowerCase()
    const name = getUserName(u).toLowerCase()
    return name.includes(query) || u.email.toLowerCase().includes(query)
  })

  // Get filtered entities for the currently active linking type
  const filteredLinkEntities = useMemo(() => {
    if (!linkingType) return []
    const query = linkSearchQuery.toLowerCase()

    if (linkingType === 'asset') {
      return (assets?.filter(a =>
        a.symbol.toLowerCase().includes(query) ||
        a.company_name?.toLowerCase().includes(query)
      ) || []).map(a => ({ id: a.id, label: `${a.symbol} - ${a.company_name}` }))
    }
    if (linkingType === 'portfolio') {
      return (portfolios?.filter(p => p.name.toLowerCase().includes(query)) || []).map(p => ({ id: p.id, label: p.name }))
    }
    if (linkingType === 'theme') {
      return (themes?.filter(t => t.name.toLowerCase().includes(query)) || []).map(t => ({ id: t.id, label: t.name }))
    }
    if (linkingType === 'workflow') {
      return (workflows?.filter(w => w.name.toLowerCase().includes(query)) || []).map(w => ({ id: w.id, label: w.name }))
    }
    if (linkingType === 'list') {
      return (assetLists?.filter(l => l.name.toLowerCase().includes(query)) || []).map(l => ({ id: l.id, label: l.name }))
    }
    return []
  }, [linkingType, linkSearchQuery, assets, portfolios, themes, workflows, assetLists])

  const isEntityLinked = (type: ProjectContextType, id: string) =>
    linkedEntities.some(le => le.type === type && le.id === id)

  const handleToggleEntity = (id: string, label: string) => {
    if (!linkingType) return
    if (isEntityLinked(linkingType, id)) {
      setLinkedEntities(prev => prev.filter(le => !(le.type === linkingType && le.id === id)))
    } else {
      setLinkedEntities(prev => [...prev, { type: linkingType, id, label }])
    }
  }

  const handleRemoveLinkedEntity = (type: ProjectContextType, id: string) => {
    setLinkedEntities(prev => prev.filter(le => !(le.type === type && le.id === id)))
  }

  const handleAddTeamMember = (userId: string, role: ProjectAssignmentRole) => {
    if (!teamMembers.some(tm => tm.userId === userId)) {
      setTeamMembers([...teamMembers, { userId, role }])
    }
  }

  const handleAddOrgGroup = (groupId: string, role: ProjectAssignmentRole) => {
    const memberIds = orgGroupMembers.get(groupId) || []
    const newMembers = memberIds
      .filter(id => id !== user?.id && !teamMembers.some(tm => tm.userId === id))
      .map(id => ({ userId: id, role }))
    if (newMembers.length > 0) {
      setTeamMembers([...teamMembers, ...newMembers])
    }
  }

  const handleRemoveTeamMember = (userId: string) => {
    setTeamMembers(teamMembers.filter(tm => tm.userId !== userId))
  }

  const handleUpdateTeamMemberRole = (userId: string, role: ProjectAssignmentRole) => {
    setTeamMembers(teamMembers.map(tm =>
      tm.userId === userId ? { ...tm, role } : tm
    ))
  }

  const handleAddDeliverable = () => {
    if (newDeliverable.trim()) {
      setDeliverables([...deliverables, { id: crypto.randomUUID(), title: newDeliverable.trim() }])
      setNewDeliverable('')
      // Re-focus input after adding
      setTimeout(() => deliverableInputRef.current?.focus(), 0)
    }
  }

  const handleRemoveDeliverable = (id: string) => {
    setDeliverables(deliverables.filter(d => d.id !== id))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setTitleError(true)
      titleRef.current?.focus()
      return
    }
    createProjectMutation.mutate()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-auto max-h-[80vh] flex flex-col transform transition-all">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors z-10"
            disabled={createProjectMutation.isPending}
          >
            <X className="h-5 w-5" />
          </button>

          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
            {/* Header — fixed */}
            <div className="px-6 pt-6 pb-4 flex-shrink-0">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-0.5">
                Create New Project
              </h2>
              <p className="text-[13px] text-gray-400 dark:text-gray-500">
                Track execution work tied to research, portfolios, or firm initiatives.
              </p>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-3 min-h-0">

              {/* ── Section: Core ── */}

              {/* Title */}
              <div className="pb-1">
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Title <span className="text-error-600">*</span>
                </label>
                <Input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    if (titleError && e.target.value.trim()) setTitleError(false)
                  }}
                  placeholder="e.g., Q4 Portfolio Rebalance Analysis"
                  required
                  disabled={createProjectMutation.isPending}
                  className={titleError ? 'border-error-400 focus:ring-error-400' : ''}
                />
                {titleError && (
                  <p className="text-[11px] text-error-600 mt-1">Title is required.</p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the project goals and scope..."
                  rows={2}
                  disabled={createProjectMutation.isPending}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-700 dark:text-white resize-none"
                />
              </div>

              {/* ── Section: Execution ── */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                <p className="text-[10px] font-medium text-gray-400/80 uppercase tracking-wider mb-2">Execution</p>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Status
                    </label>
                    <Select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                      disabled={createProjectMutation.isPending}
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
                    <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Priority
                    </label>
                    <Select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as ProjectPriority)}
                      disabled={createProjectMutation.isPending}
                      options={[
                        { value: 'low', label: 'Low' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'high', label: 'High' },
                        { value: 'urgent', label: 'Urgent' }
                      ]}
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Due Date
                    </label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      disabled={createProjectMutation.isPending}
                    />
                  </div>
                </div>
              </div>

              {/* ── Section: Context & Ownership ── */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                <p className="text-[10px] font-medium text-gray-400/80 uppercase tracking-wider mb-2">Context & Ownership</p>

                <div className="space-y-2.5">
                  {/* Linked To — multi-link */}
                  <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-3 bg-gray-50/30 dark:bg-gray-800/30">
                    <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                      Linked To
                    </label>
                    <p className="text-[11px] text-gray-400/70 dark:text-gray-500/70 mb-1.5">
                      Link to one or more assets, portfolios, themes, trade ideas, or lists.
                    </p>

                    {/* Type selector pills */}
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {([
                        { value: 'asset' as ProjectContextType, label: 'Asset' },
                        { value: 'portfolio' as ProjectContextType, label: 'Portfolio' },
                        { value: 'theme' as ProjectContextType, label: 'Theme' },
                        { value: 'workflow' as ProjectContextType, label: 'Trade Idea' },
                        { value: 'list' as ProjectContextType, label: 'List' },
                      ]).map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setLinkingType(linkingType === opt.value ? '' : opt.value)
                            setLinkSearchQuery('')
                          }}
                          disabled={createProjectMutation.isPending}
                          className={clsx(
                            'px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors',
                            linkingType === opt.value
                              ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {/* Selected chips */}
                    {linkedEntities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {linkedEntities.map(le => (
                          <span
                            key={`${le.type}-${le.id}`}
                            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full text-[12px] text-gray-700 dark:text-gray-200"
                          >
                            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase mr-0.5">
                              {le.type === 'workflow' ? 'idea' : le.type}
                            </span>
                            {le.label}
                            <button
                              type="button"
                              onClick={() => handleRemoveLinkedEntity(le.type, le.id)}
                              className="p-0.5 rounded-full text-gray-400 hover:text-error-600 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                              disabled={createProjectMutation.isPending}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Entity search panel — revealed when a type pill is active */}
                    {linkingType && (
                      <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                        <div className="p-2 bg-white dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                            <input
                              type="text"
                              placeholder={`Search ${linkingType === 'workflow' ? 'trade ideas' : linkingType === 'list' ? 'lists' : linkingType + 's'}...`}
                              value={linkSearchQuery}
                              onChange={(e) => setLinkSearchQuery(e.target.value)}
                              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                            />
                          </div>
                        </div>

                        <div className="max-h-[200px] overflow-y-auto bg-white dark:bg-gray-800">
                          {filteredLinkEntities.length > 0 ? (
                            filteredLinkEntities.map(entity => {
                              const selected = isEntityLinked(linkingType, entity.id)
                              return (
                                <button
                                  key={entity.id}
                                  type="button"
                                  onClick={() => handleToggleEntity(entity.id, entity.label)}
                                  className={clsx(
                                    'w-full flex items-center justify-between px-3 py-1.5 transition-colors text-left',
                                    selected
                                      ? 'bg-primary-50/50 dark:bg-primary-900/10'
                                      : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                                  )}
                                >
                                  <p className="text-sm text-gray-900 dark:text-white truncate">
                                    {entity.label}
                                  </p>
                                  {selected && <Check className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400 flex-shrink-0" />}
                                </button>
                              )
                            })
                          ) : (
                            <div className="px-4 py-4 text-center">
                              <p className="text-sm text-gray-400 dark:text-gray-500">
                                No {linkingType === 'workflow' ? 'trade ideas' : linkingType === 'list' ? 'lists' : linkingType + 's'} found
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Org Group */}
                  <div ref={orgDropdownRef} className="relative">
                    <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" />
                        Org Group
                      </span>
                    </label>

                    {orgDropdownOpen && (
                      <div className="absolute left-0 right-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 z-50 max-h-52 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => { setSelectedOrgGroupId(''); setOrgDropdownOpen(false) }}
                          className={clsx(
                            'w-full px-3 py-1.5 text-left text-[12px] transition-colors',
                            !selectedOrgGroupId ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white font-medium' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                          )}
                        >
                          None
                        </button>
                        {(['division', 'department', 'team', 'portfolio'] as const).map(type => {
                          const grouped = orgGroups?.filter(g => g.node_type === type) || []
                          if (grouped.length === 0) return null
                          const typeLabel = type === 'division' ? 'Divisions'
                            : type === 'department' ? 'Departments'
                            : type === 'team' ? 'Teams'
                            : 'Portfolios'
                          const isCollapsed = collapsedOrgTypes.has(type)
                          return (
                            <div key={type}>
                              <button
                                type="button"
                                onClick={() => setCollapsedOrgTypes(prev => {
                                  const next = new Set(prev)
                                  if (next.has(type)) next.delete(type)
                                  else next.add(type)
                                  return next
                                })}
                                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                              >
                                {isCollapsed
                                  ? <ChevronRight className="w-3 h-3" />
                                  : <ChevronDown className="w-3 h-3" />}
                                {typeLabel}
                                <span className="text-gray-300 dark:text-gray-500 ml-auto tabular-nums">{grouped.length}</span>
                              </button>
                              {!isCollapsed && grouped.map(g => (
                                <button
                                  key={g.id}
                                  type="button"
                                  onClick={() => { setSelectedOrgGroupId(g.id); setOrgDropdownOpen(false) }}
                                  className={clsx(
                                    'w-full pl-7 pr-3 py-1.5 text-left text-[12px] transition-colors',
                                    selectedOrgGroupId === g.id
                                      ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white font-medium'
                                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                  )}
                                >
                                  {g.name}
                                </button>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                      disabled={createProjectMutation.isPending}
                      className={clsx(
                        'flex items-center justify-between w-full rounded-lg border px-3 py-2 text-sm text-left transition-colors appearance-none bg-white dark:bg-gray-800',
                        orgDropdownOpen
                          ? 'border-primary-500 ring-1 ring-primary-500'
                          : 'border-gray-300 dark:border-gray-600',
                        'disabled:opacity-50'
                      )}
                    >
                      <span className={selectedOrgGroupId ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
                        {selectedOrgGroupId
                          ? orgGroups?.find(g => g.id === selectedOrgGroupId)?.name ?? 'None'
                          : 'None'}
                      </span>
                      <ChevronDown className={clsx('h-4 w-4 text-gray-400 transition-transform', orgDropdownOpen && 'rotate-180')} />
                    </button>
                  </div>

                  {/* Team Members */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400">
                        Team Members {teamMembers.length > 0 && `(${teamMembers.length})`}
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowTeamSection(!showTeamSection)}
                        className="text-[11px] text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium"
                      >
                        {showTeamSection ? 'Hide' : 'Assign Members'}
                      </button>
                    </div>

                    {/* Selected Team Members */}
                    {teamMembers.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {teamMembers.map((tm) => {
                          const member = users?.find(u => u.id === tm.userId)
                          return (
                            <div key={tm.userId} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-700 rounded-lg">
                              <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                                <span className="text-white text-[9px] font-semibold">
                                  {getUserInitials(member)}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-medium text-gray-900 dark:text-white truncate">
                                  {getUserName(member)}
                                </div>
                              </div>
                              <select
                                value={tm.role}
                                onChange={(e) => handleUpdateTeamMemberRole(tm.userId, e.target.value as ProjectAssignmentRole)}
                                disabled={createProjectMutation.isPending}
                                className="text-[11px] px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              >
                                <option value="contributor">Contributor</option>
                                <option value="reviewer">Reviewer</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => handleRemoveTeamMember(tm.userId)}
                                className="text-gray-400 hover:text-error-600 transition-colors"
                                disabled={createProjectMutation.isPending}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Inline Team Member Selector */}
                    {showTeamSection && (
                      <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                        <div className="p-2 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 space-y-1.5">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setTeamTab('users')}
                              className={clsx(
                                'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
                                teamTab === 'users'
                                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm'
                                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                              )}
                            >
                              <Users className="w-3 h-3" />
                              Users
                            </button>
                            <button
                              type="button"
                              onClick={() => setTeamTab('groups')}
                              className={clsx(
                                'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
                                teamTab === 'groups'
                                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm'
                                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                              )}
                            >
                              <Building2 className="w-3 h-3" />
                              Groups
                            </button>
                          </div>
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                            <input
                              type="text"
                              placeholder={teamTab === 'users' ? 'Search users...' : 'Search groups...'}
                              value={userSearchQuery}
                              onChange={(e) => setUserSearchQuery(e.target.value)}
                              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                            />
                          </div>
                        </div>

                        {teamTab === 'users' && (
                          <div className="max-h-36 overflow-y-auto">
                            {filteredUsers && filteredUsers.length > 0 ? (
                              filteredUsers
                                .filter(u => u.id !== user?.id)
                                .map((u) => {
                                  const isAdded = teamMembers.some(tm => tm.userId === u.id)
                                  return (
                                    <label
                                      key={u.id}
                                      className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isAdded}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            handleAddTeamMember(u.id, 'contributor')
                                          } else {
                                            handleRemoveTeamMember(u.id)
                                          }
                                        }}
                                        className="w-3.5 h-3.5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                                      />
                                      <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                                        <span className="text-white text-[9px] font-semibold">
                                          {getUserInitials(u)}
                                        </span>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-medium text-gray-900 dark:text-white truncate">
                                          {getUserName(u)}
                                        </p>
                                        {u.first_name && u.last_name && (
                                          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate leading-tight">
                                            {u.email}
                                          </p>
                                        )}
                                      </div>
                                    </label>
                                  )
                                })
                            ) : (
                              <div className="px-4 py-4 text-center">
                                <p className="text-sm text-gray-400 dark:text-gray-500">No users found</p>
                              </div>
                            )}
                          </div>
                        )}

                        {teamTab === 'groups' && (
                          <div className="max-h-36 overflow-y-auto">
                            {filteredOrgGroups && filteredOrgGroups.length > 0 ? (
                              filteredOrgGroups.map((group) => {
                                const allMembers = orgGroupMembers.get(group.id) || []
                                // Show only addable count: exclude self (already owner) and already-added members
                                const addableCount = allMembers.filter(
                                  id => id !== user?.id && !teamMembers.some(tm => tm.userId === id)
                                ).length
                                const totalCount = allMembers.filter(id => id !== user?.id).length
                                return (
                                  <button
                                    key={group.id}
                                    type="button"
                                    onClick={() => handleAddOrgGroup(group.id, 'contributor')}
                                    disabled={addableCount === 0}
                                    className={clsx(
                                      'w-full flex items-center gap-2.5 px-3 py-1.5 transition-colors text-left',
                                      addableCount === 0
                                        ? 'opacity-50 cursor-default'
                                        : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                                    )}
                                  >
                                    <div className="w-5 h-5 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                                      <Building2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[13px] font-medium text-gray-900 dark:text-white truncate">
                                        {group.name}
                                      </p>
                                      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                                        {group.node_type} · {totalCount} member{totalCount !== 1 ? 's' : ''}
                                        {addableCount < totalCount && addableCount > 0 && ` (${addableCount} to add)`}
                                        {addableCount === 0 && totalCount > 0 && ' (all added)'}
                                      </p>
                                    </div>
                                    {addableCount > 0 && <Plus className="w-3.5 h-3.5 text-gray-400" />}
                                    {addableCount === 0 && totalCount > 0 && <Check className="w-3.5 h-3.5 text-green-500/70" />}
                                  </button>
                                )
                              })
                            ) : (
                              <div className="px-4 py-4 text-center">
                                <p className="text-sm text-gray-400 dark:text-gray-500">No groups found</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Section: Deliverables ── */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                <p className="text-[10px] font-medium text-gray-400/80 uppercase tracking-wider mb-2">Deliverables</p>

                {/* Add Deliverable Input */}
                <div className="flex gap-2">
                  <Input
                    ref={deliverableInputRef}
                    type="text"
                    value={newDeliverable}
                    onChange={(e) => setNewDeliverable(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddDeliverable()
                      }
                      if (e.key === 'Backspace' && !newDeliverable && deliverables.length > 0) {
                        handleRemoveDeliverable(deliverables[deliverables.length - 1].id)
                      }
                    }}
                    placeholder="Add deliverable"
                    disabled={createProjectMutation.isPending}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddDeliverable}
                    disabled={!newDeliverable.trim() || createProjectMutation.isPending}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Deliverables as removable chips */}
                {deliverables.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-y-auto">
                    {deliverables.map((deliverable) => (
                      <span
                        key={deliverable.id}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full text-[12px] text-gray-700 dark:text-gray-200"
                      >
                        {deliverable.title}
                        <button
                          type="button"
                          onClick={() => handleRemoveDeliverable(deliverable.id)}
                          className="p-0.5 rounded-full text-gray-400 hover:text-error-600 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                          disabled={createProjectMutation.isPending}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Error Message */}
              {createProjectMutation.isError && (
                <div className="p-2.5 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-lg">
                  <p className="text-[13px] text-error-600 dark:text-error-400">
                    {createProjectMutation.error instanceof Error
                      ? createProjectMutation.error.message
                      : 'Failed to create project'}
                  </p>
                </div>
              )}
            </div>

            {/* Footer — sticky */}
            <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetForm()
                  onClose()
                }}
                className="flex-1"
                disabled={createProjectMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1 transition-all hover:-translate-y-px hover:shadow-md disabled:translate-y-0 disabled:shadow-none disabled:opacity-40"
                loading={createProjectMutation.isPending}
                disabled={!title.trim() || createProjectMutation.isPending}
              >
                Create Project
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
