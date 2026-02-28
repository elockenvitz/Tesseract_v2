/**
 * ManageNodeDrawer — unified right-side drawer for all admin node management.
 *
 * Tabs: Details | Members | Coverage | Settings
 *
 * Replaces the old NodeDetailModal (edit mode) and EditNodeModal.
 * One overlay at a time — no modal stacking.
 *
 * Keyboard accessible: ESC closes, focus trapped.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  X,
  Users,
  Shield,
  ShieldOff,
  Plus,
  Trash2,
  Building2,
  Palette,
  Settings,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────

interface OrgChartNode {
  id: string
  organization_id: string
  parent_id: string | null
  node_type: 'division' | 'department' | 'team' | 'portfolio' | 'custom'
  custom_type_label?: string
  name: string
  description?: string
  color: string
  icon: string
  sort_order: number
  settings: any
  is_active: boolean
  is_non_investment?: boolean
  coverage_admin_override?: boolean
  created_at: string
  children?: OrgChartNode[]
}

interface OrgChartNodeMember {
  id: string
  node_id: string
  user_id: string
  role: string
  focus: string | null
  is_coverage_admin?: boolean
  coverage_admin_blocked?: boolean
  created_at: string
  user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url?: string | null
    coverage_admin?: boolean
  }
}

interface AvailableUser {
  user_id: string
  user?: {
    id: string
    email: string
    full_name?: string | null
    first_name?: string
    last_name?: string
  }
}

export interface ManageNodeDrawerProps {
  node: OrgChartNode
  /** Direct members of this node */
  members: OrgChartNodeMember[]
  /** All org members (for the add-member dropdown) */
  availableUsers: AvailableUser[]
  onClose: () => void
  /** Save node details (name, description, color, etc.) */
  onSaveNode: (data: {
    id: string
    name: string
    description?: string
    color: string
    icon: string
    custom_type_label?: string
    is_non_investment?: boolean
  }) => void
  /** Add a member to this node */
  onAddMember: (nodeId: string, userId: string, role?: string, focus?: string) => void
  /** Remove a member by membership id */
  onRemoveMember: (memberId: string) => void
  /** Toggle explicit coverage admin status */
  onToggleCoverageAdmin?: (memberId: string, isCoverageAdmin: boolean) => void
  /** Toggle coverage admin blocked flag */
  onToggleCoverageAdminBlocked?: (memberId: string, isBlocked: boolean) => void
  /** Whether the current user can manage coverage admins for this node */
  canManageCoverageAdmins?: boolean
  /** All org chart nodes (for inherited admin resolution) */
  allOrgChartNodes?: OrgChartNode[]
  /** All node members across org (for inherited admin resolution) */
  allNodeMembers?: OrgChartNodeMember[]
  /** User IDs with global coverage admin flag */
  globalCoverageAdminUserIds?: Set<string>
  /** Save operation in progress */
  isSaving?: boolean
  /** Open to a specific tab */
  initialTab?: DrawerTab
}

type DrawerTab = 'details' | 'members' | 'coverage' | 'settings'

// ─── Constants ──────────────────────────────────────────────────────────

const NODE_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f97316', '#ec4899', '#14b8a6']

const NODE_TYPE_LABELS: Record<string, string> = {
  division: 'Division',
  department: 'Department',
  team: 'Team',
  portfolio: 'Portfolio',
  custom: 'Custom',
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

// ─── Component ──────────────────────────────────────────────────────────

export function ManageNodeDrawer({
  node,
  members,
  availableUsers,
  onClose,
  onSaveNode,
  onAddMember,
  onRemoveMember,
  onToggleCoverageAdmin,
  onToggleCoverageAdminBlocked,
  canManageCoverageAdmins = false,
  allOrgChartNodes = [],
  allNodeMembers = [],
  globalCoverageAdminUserIds = new Set(),
  isSaving = false,
  initialTab = 'details',
}: ManageNodeDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const lastActiveElementRef = useRef<Element | null>(null)
  const [activeTab, setActiveTab] = useState<DrawerTab>(initialTab)

  // ── Details tab state ──
  const [editName, setEditName] = useState(node.name)
  const [editDescription, setEditDescription] = useState(node.description || '')
  const [editColor, setEditColor] = useState(node.color)
  const [editCustomTypeLabel, setEditCustomTypeLabel] = useState(node.custom_type_label || '')
  const [editIsNonInvestment, setEditIsNonInvestment] = useState(node.is_non_investment || false)

  // ── Members tab state ──
  const [showAddMember, setShowAddMember] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [memberRole, setMemberRole] = useState('')
  const [memberFocus, setMemberFocus] = useState('')

  // Reset state when node changes
  useEffect(() => {
    setEditName(node.name)
    setEditDescription(node.description || '')
    setEditColor(node.color)
    setEditCustomTypeLabel(node.custom_type_label || '')
    setEditIsNonInvestment(node.is_non_investment || false)
    setShowAddMember(false)
    setSelectedUserId('')
    setMemberRole('')
    setMemberFocus('')
  }, [node.id])

  // Focus management
  useEffect(() => {
    lastActiveElementRef.current = document.activeElement
    return () => {
      const el = lastActiveElementRef.current
      if (el && el instanceof HTMLElement) {
        requestAnimationFrame(() => el.focus())
      }
    }
  }, [])

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [node.id])

  // ESC to close + focus trap
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Tab' && drawerRef.current) {
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── Derived ──

  const typeLabel = node.node_type === 'custom' && node.custom_type_label
    ? node.custom_type_label
    : NODE_TYPE_LABELS[node.node_type] || node.node_type

  const hasDetailsChanged =
    editName !== node.name ||
    editDescription !== (node.description || '') ||
    editColor !== node.color ||
    editCustomTypeLabel !== (node.custom_type_label || '') ||
    editIsNonInvestment !== (node.is_non_investment || false)

  const canSaveDetails = editName.trim().length > 0 &&
    (node.node_type !== 'custom' || editCustomTypeLabel.trim().length > 0) &&
    hasDetailsChanged

  // Coverage admin status resolution
  type AdminStatus = 'explicit' | 'inherited' | 'global' | 'blocked' | 'none'

  const getMemberAdminStatus = (member: OrgChartNodeMember): { status: AdminStatus; source?: string } => {
    if (member.coverage_admin_blocked) return { status: 'blocked' }
    if (member.is_coverage_admin) return { status: 'explicit' }
    if (globalCoverageAdminUserIds.has(member.user_id)) return { status: 'global' }

    const nodeMap = new Map(allOrgChartNodes.map(n => [n.id, n]))
    let current = nodeMap.get(node.parent_id || '')
    while (current) {
      const parentMember = allNodeMembers.find(m =>
        m.node_id === current!.id &&
        m.user_id === member.user_id &&
        m.is_coverage_admin &&
        !m.coverage_admin_blocked
      )
      if (parentMember) return { status: 'inherited', source: current.name }
      if (current.coverage_admin_override) break
      current = current.parent_id ? nodeMap.get(current.parent_id) : undefined
    }

    return { status: 'none' }
  }

  // Get all members from this node and descendants for coverage section
  const allDescendantNodeIds = (() => {
    const ids = new Set<string>([node.id])
    const addDescendants = (parentId: string) => {
      allOrgChartNodes
        .filter(n => n.parent_id === parentId)
        .forEach(child => { ids.add(child.id); addDescendants(child.id) })
    }
    addDescendants(node.id)
    return ids
  })()

  const membersWithDescendants = (() => {
    const memberMap = new Map<string, OrgChartNodeMember>()
    allNodeMembers
      .filter(m => allDescendantNodeIds.has(m.node_id))
      .forEach(m => {
        if (!memberMap.has(m.user_id)) {
          memberMap.set(m.user_id, m)
        } else if (m.is_coverage_admin && !memberMap.get(m.user_id)?.is_coverage_admin) {
          memberMap.set(m.user_id, m)
        }
      })
    return Array.from(memberMap.values())
  })()

  // ── Handlers ──

  const handleSaveDetails = () => {
    if (!canSaveDetails) return
    onSaveNode({
      id: node.id,
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      color: editColor,
      icon: node.icon,
      custom_type_label: node.node_type === 'custom' ? editCustomTypeLabel.trim() : undefined,
      is_non_investment: editIsNonInvestment,
    })
  }

  const handleAddMember = () => {
    if (!selectedUserId) return
    onAddMember(node.id, selectedUserId, memberRole || undefined, memberFocus || undefined)
    setSelectedUserId('')
    setMemberRole('')
    setMemberFocus('')
    setShowAddMember(false)
  }

  const handleRemoveMember = (memberId: string) => {
    if (!window.confirm('Remove this member?')) return
    onRemoveMember(memberId)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-[60]"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-label={`Manage ${node.name}`}
        tabIndex={-1}
        className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-[60] flex flex-col outline-none animate-in slide-in-from-right duration-200"
      >
        {/* ── Header ── */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{typeLabel}</div>
              <h2 className="text-base font-semibold text-gray-900 truncate">{node.name}</h2>
            </div>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors shrink-0"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1">
            {(['details', 'members', 'coverage', 'settings'] as DrawerTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
                  activeTab === tab
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'details' && (
            <DetailsTab
              node={node}
              editName={editName}
              editDescription={editDescription}
              editCustomTypeLabel={editCustomTypeLabel}
              onNameChange={setEditName}
              onDescriptionChange={setEditDescription}
              onCustomTypeLabelChange={setEditCustomTypeLabel}
            />
          )}

          {activeTab === 'members' && (
            <MembersTab
              node={node}
              members={members}
              availableUsers={availableUsers}
              showAddMember={showAddMember}
              selectedUserId={selectedUserId}
              memberRole={memberRole}
              memberFocus={memberFocus}
              onToggleAddMember={() => setShowAddMember(v => !v)}
              onSelectUser={setSelectedUserId}
              onRoleChange={setMemberRole}
              onFocusChange={setMemberFocus}
              onAddMember={handleAddMember}
              onRemoveMember={handleRemoveMember}
              onCancelAdd={() => setShowAddMember(false)}
            />
          )}

          {activeTab === 'coverage' && (
            <CoverageTab
              node={node}
              membersWithDescendants={membersWithDescendants}
              getMemberAdminStatus={getMemberAdminStatus}
              canManageCoverageAdmins={canManageCoverageAdmins}
              globalCoverageAdminUserIds={globalCoverageAdminUserIds}
              onToggleCoverageAdmin={onToggleCoverageAdmin}
              onToggleCoverageAdminBlocked={onToggleCoverageAdminBlocked}
              allNodeMembers={allNodeMembers}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              node={node}
              editColor={editColor}
              editIsNonInvestment={editIsNonInvestment}
              onColorChange={setEditColor}
              onNonInvestmentChange={setEditIsNonInvestment}
            />
          )}
        </div>

        {/* ── Footer (save details/settings changes) ── */}
        {(activeTab === 'details' || activeTab === 'settings') && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveDetails}
              disabled={!canSaveDetails || isSaving}
              className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Details Tab ─────────────────────────────────────────────────────────

function DetailsTab({
  node,
  editName,
  editDescription,
  editCustomTypeLabel,
  onNameChange,
  onDescriptionChange,
  onCustomTypeLabelChange,
}: {
  node: OrgChartNode
  editName: string
  editDescription: string
  editCustomTypeLabel: string
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onCustomTypeLabelChange: (v: string) => void
}) {
  return (
    <div className="space-y-5">
      {node.node_type === 'custom' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type Label *</label>
          <input
            type="text"
            value={editCustomTypeLabel}
            onChange={(e) => onCustomTypeLabelChange(e.target.value)}
            placeholder="e.g., Business Unit, Region"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
        <input
          type="text"
          value={editName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Enter name"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          value={editDescription}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Optional description..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm resize-y"
          rows={3}
        />
      </div>
    </div>
  )
}

// ─── Members Tab ─────────────────────────────────────────────────────────

function MembersTab({
  node,
  members,
  availableUsers,
  showAddMember,
  selectedUserId,
  memberRole,
  memberFocus,
  onToggleAddMember,
  onSelectUser,
  onRoleChange,
  onFocusChange,
  onAddMember,
  onRemoveMember,
  onCancelAdd,
}: {
  node: OrgChartNode
  members: OrgChartNodeMember[]
  availableUsers: AvailableUser[]
  showAddMember: boolean
  selectedUserId: string
  memberRole: string
  memberFocus: string
  onToggleAddMember: () => void
  onSelectUser: (id: string) => void
  onRoleChange: (v: string) => void
  onFocusChange: (v: string) => void
  onAddMember: () => void
  onRemoveMember: (id: string) => void
  onCancelAdd: () => void
}) {
  const isPortfolio = node.node_type === 'portfolio'

  return (
    <div className="space-y-4">
      {/* Header with add button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Direct Members ({members.length})</h3>
        <button
          onClick={onToggleAddMember}
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add member
        </button>
      </div>

      {/* Add member form */}
      {showAddMember && (
        <div className="bg-indigo-50 rounded-lg p-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Select User</label>
            <select
              value={selectedUserId}
              onChange={(e) => onSelectUser(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">Choose a user...</option>
              {availableUsers.map(u => {
                const name = u.user?.full_name || u.user?.email?.split('@')[0] || 'Unknown'
                return <option key={u.user_id} value={u.user_id}>{name}</option>
              })}
            </select>
          </div>
          {isPortfolio && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select
                  value={memberRole}
                  onChange={(e) => onRoleChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">Select role...</option>
                  <option value="Portfolio Manager">Portfolio Manager</option>
                  <option value="Analyst">Analyst</option>
                  <option value="Trader">Trader</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Focus</label>
                <input
                  type="text"
                  value={memberFocus}
                  onChange={(e) => onFocusChange(e.target.value)}
                  placeholder="e.g., Technology, Healthcare"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onCancelAdd} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button
              onClick={onAddMember}
              disabled={!selectedUserId}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Member list */}
      {members.length > 0 ? (
        <div className="divide-y divide-gray-100">
          {members.map(member => {
            const name = member.user?.full_name || member.user?.email || 'Unknown'
            const initial = name.charAt(0).toUpperCase()
            return (
              <div key={member.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                    style={{ backgroundColor: node.color }}
                  >
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{name}</div>
                    {member.role && <div className="text-xs text-gray-500">{member.role}{member.focus ? ` — ${member.focus}` : ''}</div>}
                  </div>
                </div>
                <button
                  onClick={() => onRemoveMember(member.id)}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0 transition-colors"
                  title="Remove member"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No direct members assigned</p>
      )}
    </div>
  )
}

// ─── Coverage Tab ─────────────────────────────────────────────────────────

function CoverageTab({
  node,
  membersWithDescendants,
  getMemberAdminStatus,
  canManageCoverageAdmins,
  globalCoverageAdminUserIds,
  onToggleCoverageAdmin,
  onToggleCoverageAdminBlocked,
  allNodeMembers,
}: {
  node: OrgChartNode
  membersWithDescendants: OrgChartNodeMember[]
  getMemberAdminStatus: (m: OrgChartNodeMember) => { status: string; source?: string }
  canManageCoverageAdmins: boolean
  globalCoverageAdminUserIds: Set<string>
  onToggleCoverageAdmin?: (memberId: string, isCoverageAdmin: boolean) => void
  onToggleCoverageAdminBlocked?: (memberId: string, isBlocked: boolean) => void
  allNodeMembers: OrgChartNodeMember[]
}) {
  if (node.is_non_investment) {
    return (
      <div className="text-sm text-gray-500 italic">
        Non-investment node — coverage admin management is not applicable.
      </div>
    )
  }

  if (membersWithDescendants.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No members in this node or its descendants. Add members first to manage coverage admin rights.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Manage coverage admin rights for members of this node and its descendants.
      </p>

      <div className="divide-y divide-gray-100">
        {membersWithDescendants.map(member => {
          const name = member.user?.full_name || member.user?.email || 'Unknown'
          const initial = name.charAt(0).toUpperCase()
          const adminStatus = getMemberAdminStatus(member)

          const hasInheritedOrGlobalAdmin =
            adminStatus.status === 'global' ||
            adminStatus.status === 'inherited' ||
            (adminStatus.status === 'blocked' && (
              globalCoverageAdminUserIds.has(member.user_id) ||
              allNodeMembers.some(m =>
                m.user_id === member.user_id &&
                m.node_id !== node.id &&
                m.is_coverage_admin &&
                !m.coverage_admin_blocked
              )
            ))

          return (
            <div key={member.id} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                  style={{ backgroundColor: node.color }}
                >
                  {initial}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{name}</div>
                  {/* Admin status badge */}
                  {adminStatus.status === 'explicit' && (
                    <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">Admin</span>
                  )}
                  {adminStatus.status === 'global' && (
                    <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded font-medium" title="Has global coverage admin rights">Global</span>
                  )}
                  {adminStatus.status === 'inherited' && (
                    <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium" title={`Inherited from ${adminStatus.source}`}>Inherited</span>
                  )}
                  {adminStatus.status === 'blocked' && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium" title="Admin access blocked for this node">Blocked</span>
                  )}
                </div>
              </div>

              {canManageCoverageAdmins && (
                <div className="flex items-center gap-1 shrink-0">
                  {(adminStatus.status === 'none' || adminStatus.status === 'explicit') && onToggleCoverageAdmin && (
                    <button
                      onClick={() => onToggleCoverageAdmin(member.id, !member.is_coverage_admin)}
                      className={clsx(
                        'p-1.5 rounded transition-colors',
                        adminStatus.status === 'explicit'
                          ? 'text-indigo-600 hover:bg-indigo-50'
                          : 'text-gray-400 hover:bg-gray-100 hover:text-indigo-600',
                      )}
                      title={adminStatus.status === 'explicit' ? 'Remove admin' : 'Grant admin'}
                    >
                      <Shield className="w-4 h-4" />
                    </button>
                  )}
                  {hasInheritedOrGlobalAdmin && onToggleCoverageAdminBlocked && (
                    <button
                      onClick={() => onToggleCoverageAdminBlocked(member.id, !member.coverage_admin_blocked)}
                      className={clsx(
                        'p-1.5 rounded transition-colors',
                        member.coverage_admin_blocked
                          ? 'text-amber-600 hover:bg-amber-50'
                          : 'text-gray-400 hover:bg-gray-100 hover:text-amber-600',
                      )}
                      title={member.coverage_admin_blocked ? 'Unblock admin access' : 'Block inherited/global admin'}
                    >
                      <ShieldOff className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Settings Tab ─────────────────────────────────────────────────────────

function SettingsTab({
  node,
  editColor,
  editIsNonInvestment,
  onColorChange,
  onNonInvestmentChange,
}: {
  node: OrgChartNode
  editColor: string
  editIsNonInvestment: boolean
  onColorChange: (v: string) => void
  onNonInvestmentChange: (v: boolean) => void
}) {
  return (
    <div className="space-y-5">
      {/* Color */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          <Palette className="w-3.5 h-3.5 inline mr-1.5" />
          Color
        </label>
        <div className="flex flex-wrap gap-2">
          {NODE_COLORS.map(c => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              className={clsx(
                'w-8 h-8 rounded-full border-2 transition-all',
                editColor === c ? 'border-gray-800 scale-110 shadow-sm' : 'border-transparent hover:scale-105',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Non-Investment Checkbox */}
      <div className="flex items-start gap-3 pt-3 border-t border-gray-100">
        <input
          type="checkbox"
          id="manageIsNonInvestment"
          checked={editIsNonInvestment}
          onChange={(e) => onNonInvestmentChange(e.target.checked)}
          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded mt-0.5"
        />
        <label htmlFor="manageIsNonInvestment" className="text-sm text-gray-700">
          <span className="font-medium">Non-investment team</span>
          <p className="text-xs text-gray-500 mt-0.5">Exclude from coverage filters (e.g., Operations, HR, IT)</p>
        </label>
      </div>
    </div>
  )
}
