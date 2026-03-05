/**
 * NewPortfolioModal — Multi-step modal for deliberate portfolio creation.
 *
 * Steps:
 *   1. Portfolio details (name, benchmark, description, status)
 *   2. Link teams (optional, multi-select org chart team nodes, lead designation)
 *   3. Assign initial access (optional, portfolio roles only)
 *   4. Review & Create
 *
 * Gated by Org Admin / Coverage Admin in the parent.
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, ChevronRight, ChevronLeft, Briefcase, Users, UserPlus, ClipboardCheck,
  Check, Star, AlertCircle, Loader2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { logOrgActivity } from '../../lib/org-activity-log'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { SearchableSelect } from '../ui/SearchableSelect'
import { ROLE_OPTIONS, getFocusOptionsForRole } from '../../lib/roles-config'
import type { OrgChartNode } from '../../types/organization'

// ─── Types ──────────────────────────────────────────────────────────────

interface NewPortfolioModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated?: (portfolioId: string) => void
}

interface TeamSelection {
  nodeId: string
  name: string
  isLead: boolean
}

interface MemberAssignment {
  id: string // temp key
  userId: string
  userName: string
  email: string
  role: string
  focus: string
}

type Step = 1 | 2 | 3 | 4

const STEP_LABELS: Record<Step, { label: string; icon: React.ReactNode }> = {
  1: { label: 'Details', icon: <Briefcase className="w-4 h-4" /> },
  2: { label: 'Teams', icon: <Users className="w-4 h-4" /> },
  3: { label: 'Access', icon: <UserPlus className="w-4 h-4" /> },
  4: { label: 'Review', icon: <ClipboardCheck className="w-4 h-4" /> },
}

// ─── Component ──────────────────────────────────────────────────────────

export function NewPortfolioModal({ isOpen, onClose, onCreated }: NewPortfolioModalProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  // Step state
  const [step, setStep] = useState<Step>(1)

  // Step 1: Details
  const [name, setName] = useState('')
  const [benchmark, setBenchmark] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Step 2: Teams
  const [selectedTeams, setSelectedTeams] = useState<TeamSelection[]>([])

  // Step 3: Access
  const [members, setMembers] = useState<MemberAssignment[]>([])
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberUserId, setNewMemberUserId] = useState<string | null>(null)
  const [newMemberRole, setNewMemberRole] = useState('')
  const [newMemberFocus, setNewMemberFocus] = useState('')

  // Error state
  const [error, setError] = useState<string | null>(null)

  // ─── Queries ────────────────────────────────────────────────────────

  // Fetch team nodes for step 2
  const { data: teamNodes = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['org-chart-team-nodes', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, color, icon, is_active')
        .eq('organization_id', currentOrgId!)
        .in('node_type', ['team', 'department'])
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data || []) as Pick<OrgChartNode, 'id' | 'name' | 'node_type' | 'color' | 'icon' | 'is_active'>[]
    },
    enabled: isOpen && !!currentOrgId,
  })

  // Fetch all users for step 3 (same pattern as AddTeamMemberModal)
  const { data: orgUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: isOpen,
    staleTime: 0,
  })

  // Duplicate name check
  const { data: existingNames = [] } = useQuery({
    queryKey: ['portfolio-names', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('name')
      if (error) throw error
      return (data || []).map((p: any) => p.name.toLowerCase())
    },
    enabled: isOpen,
  })

  const isDuplicateName = useMemo(
    () => name.trim().length > 0 && existingNames.includes(name.trim().toLowerCase()),
    [name, existingNames],
  )

  // ─── Helpers ────────────────────────────────────────────────────────

  const getUserDisplayName = useCallback((u: { first_name: string; last_name: string; email: string }) => {
    if (u.first_name || u.last_name) return `${u.first_name} ${u.last_name}`.trim()
    return u.email?.split('@')[0] || 'Unknown'
  }, [])

  const userOptions = useMemo(() => {
    const assignedIds = new Set(members.map(m => m.userId))
    return orgUsers
      .filter(u => !assignedIds.has(u.id))
      .map(u => ({
        value: u.id,
        label: getUserDisplayName(u),
        email: u.email,
        ...u,
      }))
  }, [orgUsers, members, getUserDisplayName])

  // ─── Team toggle ────────────────────────────────────────────────────

  const toggleTeam = useCallback((nodeId: string, nodeName: string) => {
    setSelectedTeams(prev => {
      const exists = prev.find(t => t.nodeId === nodeId)
      if (exists) return prev.filter(t => t.nodeId !== nodeId)
      return [...prev, { nodeId, name: nodeName, isLead: false }]
    })
  }, [])

  const toggleLeadTeam = useCallback((nodeId: string) => {
    setSelectedTeams(prev => prev.map(t => ({
      ...t,
      isLead: t.nodeId === nodeId ? !t.isLead : false,
    })))
  }, [])

  // ─── Member management ──────────────────────────────────────────────

  const handleAddMember = useCallback(() => {
    if (!newMemberUserId || !newMemberRole) return
    const u = orgUsers.find(u => u.id === newMemberUserId)
    if (!u) return

    setMembers(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        userId: u.id,
        userName: getUserDisplayName(u),
        email: u.email,
        role: newMemberRole,
        focus: newMemberFocus,
      },
    ])
    setNewMemberUserId(null)
    setNewMemberRole('')
    setNewMemberFocus('')
    setAddingMember(false)
  }, [newMemberUserId, newMemberRole, newMemberFocus, orgUsers, getUserDisplayName])

  const removeMember = useCallback((id: string) => {
    setMembers(prev => prev.filter(m => m.id !== id))
  }, [])

  // ─── Validation ─────────────────────────────────────────────────────

  const step1Valid = name.trim().length > 0
  const step4Valid = step1Valid // Only name is required to create

  // ─── Create mutation ────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrgId) throw new Error('No organization selected')

      // 1. Insert portfolio
      const { data: portfolio, error: portfolioError } = await supabase
        .from('portfolios')
        .insert({
          name: name.trim(),
          benchmark: benchmark.trim() || null,
          description: description.trim() || null,
          is_active: isActive,
          organization_id: currentOrgId,
          portfolio_type: 'long_short',
        })
        .select('id')
        .single()

      if (portfolioError) throw new Error(`Failed to create portfolio: ${portfolioError.message}`)
      const portfolioId = portfolio.id

      // 2. Insert portfolio_team_links (if any teams selected)
      if (selectedTeams.length > 0) {
        const links = selectedTeams.map(t => ({
          organization_id: currentOrgId,
          portfolio_id: portfolioId,
          team_node_id: t.nodeId,
          is_lead: t.isLead,
        }))

        const { error: linkError } = await supabase
          .from('portfolio_team_links')
          .insert(links)

        if (linkError) {
          // Best-effort: portfolio is created but links failed
          console.error('Failed to link teams:', linkError.message)
          throw new Error(`Portfolio created but team linking failed: ${linkError.message}`)
        }
      }

      // 3. Insert portfolio_team rows for initial members (if any)
      if (members.length > 0) {
        const memberRows = members.map(m => ({
          portfolio_id: portfolioId,
          user_id: m.userId,
          role: m.role,
          focus: m.focus || null,
          source_team_node_id: null, // direct grants
        }))

        const { error: memberError } = await supabase
          .from('portfolio_team')
          .insert(memberRows)

        if (memberError) {
          console.error('Failed to assign members:', memberError.message)
          throw new Error(`Portfolio created but member assignment failed: ${memberError.message}`)
        }
      }

      return portfolioId
    },
    onSuccess: async (portfolioId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['all-portfolios'] }),
        queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] }),
        queryClient.invalidateQueries({ queryKey: ['portfolio-team-links'] }),
      ])
      if (currentOrgId) {
        logOrgActivity({
          organizationId: currentOrgId,
          action: 'portfolio.created',
          targetType: 'portfolio',
          targetId: portfolioId,
          details: { name: name.trim(), benchmark: benchmark.trim() || null },
          entityType: 'portfolio',
          actionType: 'created',
        })
      }
      onCreated?.(portfolioId)
      handleClose()
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  // ─── Navigation ─────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    setStep(1)
    setName('')
    setBenchmark('')
    setDescription('')
    setIsActive(true)
    setSelectedTeams([])
    setMembers([])
    setAddingMember(false)
    setNewMemberUserId(null)
    setNewMemberRole('')
    setNewMemberFocus('')
    setError(null)
    onClose()
  }, [onClose])

  const goNext = useCallback(() => setStep(s => Math.min(s + 1, 4) as Step), [])
  const goBack = useCallback(() => setStep(s => Math.max(s - 1, 1) as Step), [])

  // ─── Render ─────────────────────────────────────────────────────────

  if (!isOpen) return null

  const focusOptions = getFocusOptionsForRole(newMemberRole)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={handleClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">New Portfolio</h2>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-1 mt-4">
              {([1, 2, 3, 4] as Step[]).map(s => (
                <button
                  key={s}
                  onClick={() => { if (s < step || (s === 2 && step1Valid) || (s === 3 && step1Valid) || (s === 4 && step1Valid)) setStep(s) }}
                  disabled={s > step && !step1Valid}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                    s === step
                      ? 'bg-indigo-100 text-indigo-700'
                      : s < step
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {s < step ? <Check className="w-3 h-3" /> : STEP_LABELS[s].icon}
                  <span className="hidden sm:inline">{STEP_LABELS[s].label}</span>
                  <span className="sm:hidden">{s}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Error</p>
                  <p>{error}</p>
                </div>
                <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Step 1: Details */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Portfolio Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Global Growth Equity"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    autoFocus
                  />
                  {isDuplicateName && (
                    <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      A portfolio with this name already exists
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Benchmark</label>
                  <input
                    type="text"
                    value={benchmark}
                    onChange={e => setBenchmark(e.target.value)}
                    placeholder="e.g. S&P 500, MSCI World"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Brief description of the portfolio's mandate or strategy..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700">Status</label>
                  <button
                    type="button"
                    onClick={() => setIsActive(!isActive)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      isActive ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isActive ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className={`text-sm ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                    {isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            )}

            {/* Step 2: Link Teams */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600 mb-3">
                    Link organizational teams to this portfolio for ownership and reporting.
                    Access is still assigned per-person in the next step.
                  </p>
                  {selectedTeams.length > 0 && (
                    <p className="text-xs text-gray-500 mb-2">
                      {selectedTeams.length} team{selectedTeams.length > 1 ? 's' : ''} selected
                      {selectedTeams.find(t => t.isLead) && (
                        <> &middot; Lead: <span className="font-medium">{selectedTeams.find(t => t.isLead)?.name}</span></>
                      )}
                    </p>
                  )}
                </div>

                {teamsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : teamNodes.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-500">
                    No teams found in your organization. You can link teams later.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {teamNodes.map(node => {
                      const selected = selectedTeams.find(t => t.nodeId === node.id)
                      return (
                        <div
                          key={node.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            selected
                              ? 'border-indigo-200 bg-indigo-50/50'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                          onClick={() => toggleTeam(node.id, node.name)}
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${node.color}20` }}
                          >
                            <Users className="w-4 h-4" style={{ color: node.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{node.name}</p>
                            <p className="text-xs text-gray-500 capitalize">{node.node_type}</p>
                          </div>
                          {selected && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation()
                                  toggleLeadTeam(node.id)
                                }}
                                title={selected.isLead ? 'Lead team' : 'Set as lead team'}
                                className={`p-1 rounded transition-colors ${
                                  selected.isLead
                                    ? 'text-amber-500 bg-amber-50'
                                    : 'text-gray-300 hover:text-amber-400 hover:bg-amber-50'
                                }`}
                              >
                                <Star className={`w-4 h-4 ${selected.isLead ? 'fill-current' : ''}`} />
                              </button>
                              <Check className="w-4 h-4 text-indigo-500" />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Initial Access */}
            {step === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Assign initial portfolio roles. Roles are portfolio-specific and do not include team roles.
                </p>

                {/* Existing members */}
                {members.length > 0 && (
                  <div className="space-y-1.5">
                    {members.map(m => (
                      <div
                        key={m.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white"
                      >
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                          <span className="text-xs font-medium text-indigo-600">
                            {m.userName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{m.userName}</p>
                          <p className="text-xs text-gray-500">
                            {m.role}{m.focus ? ` · ${m.focus}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => removeMember(m.id)}
                          className="text-gray-300 hover:text-red-500 transition-colors p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add member form */}
                {addingMember ? (
                  <div className="space-y-3 p-4 rounded-lg border border-indigo-200 bg-indigo-50/30">
                    <SearchableSelect
                      label="Select User"
                      placeholder="Search by name or email..."
                      options={userOptions}
                      value={userOptions.find(o => o.value === newMemberUserId) || null}
                      onChange={(option: any) => setNewMemberUserId(option?.value || null)}
                      loading={usersLoading}
                      disabled={usersLoading}
                      displayKey="label"
                      autocomplete="off"
                    />

                    <Select
                      label="Portfolio Role"
                      value={newMemberRole}
                      onChange={e => {
                        setNewMemberRole(e.target.value)
                        setNewMemberFocus('')
                      }}
                      options={[
                        { value: '', label: 'Select Role' },
                        ...ROLE_OPTIONS.map(r => ({ value: r, label: r })),
                      ]}
                    />

                    {newMemberRole && focusOptions.length > 0 && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Focus</label>
                        <div className="flex flex-wrap gap-1">
                          {focusOptions.map(f => {
                            const currentFocuses = newMemberFocus ? newMemberFocus.split(', ').filter(Boolean) : []
                            const isSelected = currentFocuses.includes(f)
                            return (
                              <button
                                key={f}
                                type="button"
                                onClick={() => {
                                  const next = isSelected
                                    ? currentFocuses.filter(x => x !== f)
                                    : [...currentFocuses, f]
                                  setNewMemberFocus(next.join(', '))
                                }}
                                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                                  isSelected
                                    ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                }`}
                              >
                                {f}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setAddingMember(false)
                          setNewMemberUserId(null)
                          setNewMemberRole('')
                          setNewMemberFocus('')
                        }}
                        className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleAddMember}
                        disabled={!newMemberUserId || !newMemberRole}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingMember(true)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors border border-dashed border-indigo-300"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add team member
                  </button>
                )}

                {members.length === 0 && !addingMember && (
                  <p className="text-xs text-gray-400 mt-2">
                    No members assigned yet. You can add members after creation.
                  </p>
                )}
              </div>
            )}

            {/* Step 4: Review */}
            {step === 4 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Review Portfolio</h3>

                {/* Details card */}
                <div className="rounded-lg border border-gray-200 p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Briefcase className="w-4 h-4 text-indigo-500" />
                    <span className="text-sm font-semibold text-gray-900">{name}</span>
                    <span className={`ml-auto px-2 py-0.5 text-[11px] font-medium rounded-full ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-gray-100 text-gray-500 border border-gray-200'
                    }`}>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {benchmark && (
                    <div className="text-xs text-gray-500">
                      <span className="font-medium text-gray-600">Benchmark:</span> {benchmark}
                    </div>
                  )}
                  {description && (
                    <div className="text-xs text-gray-500">
                      <span className="font-medium text-gray-600">Description:</span> {description}
                    </div>
                  )}
                </div>

                {/* Teams card */}
                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">
                      {selectedTeams.length} team{selectedTeams.length !== 1 ? 's' : ''} linked
                    </span>
                  </div>
                  {selectedTeams.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTeams.map(t => (
                        <span
                          key={t.nodeId}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                            t.isLead
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}
                        >
                          {t.isLead && <Star className="w-3 h-3 fill-current" />}
                          {t.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No teams linked</p>
                  )}
                </div>

                {/* Members card */}
                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <UserPlus className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">
                      {members.length} initial member{members.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {members.length > 0 ? (
                    <div className="space-y-1">
                      {members.map(m => (
                        <div key={m.id} className="text-xs text-gray-600">
                          <span className="font-medium">{m.userName}</span>
                          <span className="text-gray-400"> &middot; </span>
                          <span>{m.role}</span>
                          {m.focus && <span className="text-gray-400"> ({m.focus})</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No initial members</p>
                  )}
                </div>

                {isDuplicateName && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    A portfolio with the name "{name}" already exists. You can still create it, but consider using a unique name.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl shrink-0">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">
                Step {step} of 4
              </div>
              <div className="flex gap-2">
                {step > 1 && (
                  <button
                    onClick={goBack}
                    disabled={createMutation.isPending}
                    className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                )}
                {step === 1 && (
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                )}
                {step < 4 ? (
                  <button
                    onClick={goNext}
                    disabled={step === 1 && !step1Valid}
                    className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {step === 2 || step === 3 ? 'Next' : 'Continue'}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => createMutation.mutate()}
                    disabled={!step4Valid || createMutation.isPending}
                    className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Create Portfolio
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
