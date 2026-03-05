/**
 * OrgNodeDetailsModal — unified "Node Profile" modal with sliding pages.
 *
 * Two internal pages:
 *   Profile (view-first): KPI row, Members, Coverage Admins, Governance, Coverage stats
 *   Manage (admin actions): Tabs — Details | Members | Coverage | Settings
 *
 * Horizontal slide transition between pages (translateX).
 * Deep-linking: Profile CTAs slide to specific manage tabs.
 * Unsaved changes warning when navigating away from manage page.
 * Focus trap scoped to active page. ESC always closes.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  X,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Check,
  Search,
  Settings,
  Plus,
  Trash2,
  Edit3,
  Shield,
  ShieldOff,
  Palette,
} from 'lucide-react'
import { HealthPill } from './HealthPill'
import { RiskFlagBadge, RiskCountBadge } from './RiskBadge'
import type { OrgGraphNode, RawNodeMember } from '../../lib/org-graph'
import { ROLE_OPTIONS, getFocusOptionsForRole, TEAM_ROLE_OPTIONS, TEAM_FUNCTION_OPTIONS } from '../../lib/roles-config'
import { ConfirmDialog } from '../ui/ConfirmDialog'

// ─── Types ──────────────────────────────────────────────────────────────

export type ManageTab = 'details' | 'members' | 'coverage' | 'settings'

/** Raw org chart node shape (subset) for coverage admin tree traversal */
export interface RawOrgChartNode {
  id: string
  parent_id: string | null
  name: string
  coverage_admin_override?: boolean
}

export interface AvailableUser {
  user_id: string
  user?: {
    id: string
    email: string
    full_name?: string | null
    first_name?: string
    last_name?: string
  }
}

export interface OrgNodeDetailsModalProps {
  node: OrgGraphNode
  members: RawNodeMember[]
  /** Ancestor breadcrumb nodes (from root -> parent) */
  breadcrumb: { id: string; name: string }[]
  onClose: () => void
  /** Navigate to a different node (modal stays open, content updates) */
  onNavigateNode?: (nodeId: string) => void
  /** Whether current user can edit structure (shows Manage button) */
  canManageOrgStructure?: boolean
  /** When true, shows governance & risk section (collapsed) + health pill */
  showGovernanceSignals?: boolean

  // ── Page control ──
  /** Which page to show initially (default: 'profile') */
  initialPage?: 'profile' | 'manage'
  /** Which manage tab to show initially (default: 'details') */
  initialManageTab?: ManageTab

  // ── Manage page callbacks (optional — only needed when canManageOrgStructure) ──
  /** All org members (for the add-member dropdown) */
  availableUsers?: AvailableUser[]
  /** Available portfolios for portfolio ID resolution (mnemonic ↔ UUID) */
  availablePortfolios?: { id: string; portfolio_id: string; name: string }[]
  /** Save node details (name, description, color, etc.) */
  onSaveNode?: (data: {
    id: string
    name: string
    description?: string
    color: string
    icon: string
    custom_type_label?: string
    is_non_investment?: boolean
    portfolio_id?: string
  }) => void
  /** Add a member to this node */
  onAddMember?: (nodeId: string, userId: string, role?: string, focus?: string) => void
  /** Remove a member by membership id */
  onRemoveMember?: (memberId: string) => void
  /** Update a member's role/focus */
  onUpdateMember?: (memberId: string, role: string, focus: string | null) => void
  /** Toggle explicit coverage admin status */
  onToggleCoverageAdmin?: (memberId: string, isCoverageAdmin: boolean) => void
  /** Toggle coverage admin blocked flag */
  onToggleCoverageAdminBlocked?: (memberId: string, isBlocked: boolean) => void
  /** Whether the current user can manage coverage admins for this node */
  canManageCoverageAdmins?: boolean
  /** All org chart nodes (for inherited admin resolution) */
  allOrgChartNodes?: RawOrgChartNode[]
  /** All node members across org (for inherited admin resolution) */
  allNodeMembers?: RawNodeMember[]
  /** User IDs with global coverage admin flag */
  globalCoverageAdminUserIds?: Set<string>
  /** Save operation in progress */
  isSaving?: boolean
}

// ─── Constants ──────────────────────────────────────────────────────────

const NODE_TYPE_LABELS: Record<string, string> = {
  division: 'Division',
  department: 'Department',
  team: 'Team',
  portfolio: 'Portfolio',
  custom: 'Custom',
}

const NODE_TYPE_COLORS: Record<string, string> = {
  division: 'bg-indigo-50 text-indigo-700',
  department: 'bg-blue-50 text-blue-700',
  team: 'bg-emerald-50 text-emerald-700',
  portfolio: 'bg-amber-50 text-amber-700',
  custom: 'bg-gray-100 text-gray-600',
}

const NODE_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f97316', '#ec4899', '#14b8a6']

type DiagSeverity = 'high' | 'medium' | 'info'

const DIAG_BADGE_STYLES: Record<DiagSeverity, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  info: 'bg-blue-50 text-blue-600',
}

const DIAG_BADGE_LABELS: Record<DiagSeverity, string> = {
  high: 'High',
  medium: 'Med',
  info: 'Info',
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

/** Team-like nodes skip the node-member role selector — portfolio roles are set in AssignPortfolioRolesModal. */
function isTeamLikeNodeType(nodeType: string): boolean {
  return nodeType === 'team' || nodeType === 'division' || nodeType === 'department'
}

const SLIDE_TRANSITION = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)'

// ─── Component ──────────────────────────────────────────────────────────

export function OrgNodeDetailsModal({
  node,
  members,
  breadcrumb,
  onClose,
  onNavigateNode,
  canManageOrgStructure = false,
  showGovernanceSignals = false,
  initialPage = 'profile',
  initialManageTab = 'details',
  availableUsers = [],
  availablePortfolios = [],
  onSaveNode,
  onAddMember,
  onRemoveMember,
  onUpdateMember,
  onToggleCoverageAdmin,
  onToggleCoverageAdminBlocked,
  canManageCoverageAdmins = false,
  allOrgChartNodes = [],
  allNodeMembers = [],
  globalCoverageAdminUserIds = new Set(),
  isSaving = false,
}: OrgNodeDetailsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const profilePageRef = useRef<HTMLDivElement>(null)
  const managePageRef = useRef<HTMLDivElement>(null)
  const profileCloseRef = useRef<HTMLButtonElement>(null)
  const manageCloseRef = useRef<HTMLButtonElement>(null)
  const lastActiveElementRef = useRef<Element | null>(null)
  const prevNodeId = useRef(node.id)

  // ── Page & tab state ──
  const [modalPage, setModalPage] = useState<'profile' | 'manage'>(initialPage)
  const [manageTab, setManageTab] = useState<ManageTab>(initialManageTab)

  // ── Profile state ──
  const [governanceOpen, setGovernanceOpen] = useState(false)
  const [showScoringDetails, setShowScoringDetails] = useState(false)

  // ── Manage state: edit fields ──
  const [editName, setEditName] = useState(node.name)
  const [editDescription, setEditDescription] = useState(node.description || '')
  const [editColor, setEditColor] = useState(node.color)
  const [editCustomTypeLabel, setEditCustomTypeLabel] = useState(node.customTypeLabel || '')
  const [editIsNonInvestment, setEditIsNonInvestment] = useState(node.isNonInvestment)
  // Resolve UUID → mnemonic for display
  const initialMnemonic = (() => {
    const uuid = node.settings?.portfolio_id
    if (!uuid) return ''
    const match = availablePortfolios.find(p => p.id === uuid)
    return match?.portfolio_id || ''
  })()
  const [editPortfolioId, setEditPortfolioId] = useState(initialMnemonic)

  // ── Confirm dialog state ──
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<string | null>(null)

  // ── Manage state: members tab ──
  const teamLike = isTeamLikeNodeType(node.nodeType)
  const [showAddMember, setShowAddMember] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [memberRole, setMemberRole] = useState(teamLike ? 'Member' : '')
  const [memberFocus, setMemberFocus] = useState('')
  const [memberTeamFunction, setMemberTeamFunction] = useState('')

  // ── Reset state when node changes (via breadcrumb navigation) ──
  useEffect(() => {
    if (prevNodeId.current !== node.id) {
      prevNodeId.current = node.id
      setModalPage('profile')
      setManageTab('details')
      setGovernanceOpen(false)
      setShowScoringDetails(false)
      // Reset edit fields
      setEditName(node.name)
      setEditDescription(node.description || '')
      setEditColor(node.color)
      setEditCustomTypeLabel(node.customTypeLabel || '')
      setEditIsNonInvestment(node.isNonInvestment)
      {
        const uuid = node.settings?.portfolio_id
        const match = uuid ? availablePortfolios.find(p => p.id === uuid) : null
        setEditPortfolioId(match?.portfolio_id || '')
      }
      setShowAddMember(false)
      setSelectedUserId('')
      setMemberRole(isTeamLikeNodeType(node.nodeType) ? 'Member' : '')
      setMemberFocus('')
      setMemberTeamFunction('')
    }
  }, [node.id, node.name, node.description, node.color, node.customTypeLabel, node.isNonInvestment])

  // ── Focus restore on unmount ──
  useEffect(() => {
    lastActiveElementRef.current = document.activeElement
    return () => {
      const el = lastActiveElementRef.current
      if (el && el instanceof HTMLElement) {
        requestAnimationFrame(() => el.focus())
      }
    }
  }, [])

  // ── Focus close button on open / node change ──
  useEffect(() => {
    if (modalPage === 'profile') {
      profileCloseRef.current?.focus()
    } else {
      manageCloseRef.current?.focus()
    }
  }, [node.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Focus management on page slide ──
  useEffect(() => {
    const timer = setTimeout(() => {
      if (modalPage === 'profile') {
        profileCloseRef.current?.focus()
      } else {
        manageCloseRef.current?.focus()
      }
    }, 220) // slightly after slide animation (200ms)
    return () => clearTimeout(timer)
  }, [modalPage])

  // ── ESC to close + focus trap (scoped to active page) ──
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Tab') {
      const activePage = modalPage === 'profile' ? profilePageRef.current : managePageRef.current
      if (!activePage) return
      const focusable = Array.from(
        activePage.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
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
  }, [onClose, modalPage])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── Unsaved changes detection ──
  const hasUnsavedChanges = useCallback(() => {
    return (
      editName !== node.name ||
      editDescription !== (node.description || '') ||
      editColor !== node.color ||
      editCustomTypeLabel !== (node.customTypeLabel || '') ||
      editIsNonInvestment !== node.isNonInvestment ||
      editPortfolioId !== initialMnemonic
    )
  }, [editName, editDescription, editColor, editCustomTypeLabel, editIsNonInvestment, editPortfolioId, initialMnemonic, node])

  // ── Navigation helpers ──

  const slideToManage = useCallback((tab?: ManageTab) => {
    if (tab) setManageTab(tab)
    setModalPage('manage')
  }, [])

  const slideToProfile = useCallback(() => {
    if (hasUnsavedChanges()) {
      setDiscardConfirmOpen(true)
      return
    }
    setModalPage('profile')
  }, [hasUnsavedChanges])

  const handleConfirmDiscard = useCallback(() => {
    setDiscardConfirmOpen(false)
    setEditName(node.name)
    setEditDescription(node.description || '')
    setEditColor(node.color)
    setEditCustomTypeLabel(node.customTypeLabel || '')
    setEditIsNonInvestment(node.isNonInvestment)
    setEditPortfolioId(initialMnemonic)
    setModalPage('profile')
  }, [node, initialMnemonic])

  // ── Derived data (profile page) ──

  const isPortfolioNode = node.nodeType === 'portfolio'
  const uniqueUserIds = new Set(members.map(m => m.user_id))
  const uniqueMemberCount = uniqueUserIds.size
  const isTeamOrPortfolio = node.nodeType === 'team' || node.nodeType === 'portfolio'

  // Build node name lookup for portfolio role labels
  const nodeNameMap = new Map(allOrgChartNodes.map(n => [n.id, n.name]))

  const typeBadgeColor = NODE_TYPE_COLORS[node.nodeType] || NODE_TYPE_COLORS.custom

  const highCount = node.riskFlags.filter(f => f.severity === 'high').length
  const medCount = node.riskFlags.filter(f => f.severity === 'medium').length
  const lowCount = node.riskFlags.filter(f => f.severity === 'low').length

  // ── Derived data (manage page) ──

  const hasDetailsChanged =
    editName !== node.name ||
    editDescription !== (node.description || '') ||
    editColor !== node.color ||
    editCustomTypeLabel !== (node.customTypeLabel || '') ||
    editIsNonInvestment !== node.isNonInvestment ||
    editPortfolioId !== initialMnemonic

  const canSaveDetails = editName.trim().length > 0 &&
    (node.nodeType !== 'custom' || editCustomTypeLabel.trim().length > 0) &&
    hasDetailsChanged

  // Coverage admin status resolution
  type AdminStatus = 'explicit' | 'inherited' | 'global' | 'blocked' | 'none'

  const getMemberAdminStatus = (member: RawNodeMember): { status: AdminStatus; source?: string } => {
    if (member.coverage_admin_blocked) return { status: 'blocked' }
    if (member.is_coverage_admin) return { status: 'explicit' }
    if (globalCoverageAdminUserIds.has(member.user_id)) return { status: 'global' }

    const nodeMap = new Map(allOrgChartNodes.map(n => [n.id, n]))
    let current = nodeMap.get(node.parentId || '')
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

  // Coverage admins includes explicit, global, and inherited (used by profile page)
  const coverageAdmins = (() => {
    const seen = new Set<string>()
    return members.filter(m => {
      if (seen.has(m.user_id)) return false
      const status = getMemberAdminStatus(m).status
      if (status === 'explicit' || status === 'global' || status === 'inherited') {
        seen.add(m.user_id)
        return true
      }
      return false
    })
  })()

  // All members from this node and descendants (for coverage tab)
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
    const memberMap = new Map<string, RawNodeMember>()
    const addMember = (m: RawNodeMember) => {
      if (!memberMap.has(m.user_id)) {
        memberMap.set(m.user_id, m)
      } else if (m.is_coverage_admin && !memberMap.get(m.user_id)?.is_coverage_admin) {
        memberMap.set(m.user_id, m)
      }
    }
    // Include members prop (covers linked portfolio members not in parent_id tree)
    members.forEach(addMember)
    // Include descendant node members from the full org member list
    allNodeMembers
      .filter(m => allDescendantNodeIds.has(m.node_id))
      .forEach(addMember)
    return Array.from(memberMap.values())
  })()

  // ── Manage page handlers ──

  const handleSaveDetails = () => {
    if (!canSaveDetails || !onSaveNode) return
    // Resolve mnemonic → UUID for portfolio_id
    let resolvedPortfolioUuid: string | undefined
    if (isPortfolioNode) {
      const trimmed = editPortfolioId.trim().toUpperCase()
      if (trimmed) {
        const match = availablePortfolios.find(p => p.portfolio_id?.toUpperCase() === trimmed)
        resolvedPortfolioUuid = match?.id || undefined
      } else {
        resolvedPortfolioUuid = '' // clear the link
      }
    }

    onSaveNode({
      id: node.id,
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      color: editColor,
      icon: node.icon,
      custom_type_label: node.nodeType === 'custom' ? editCustomTypeLabel.trim() : undefined,
      is_non_investment: editIsNonInvestment,
      portfolio_id: resolvedPortfolioUuid,
    })
  }

  const handleAddMember = () => {
    if (!selectedUserId || !onAddMember) return
    const effectiveFocus = teamLike ? memberTeamFunction : memberFocus
    onAddMember(node.id, selectedUserId, memberRole || undefined, effectiveFocus || undefined)
    setSelectedUserId('')
    setMemberRole(teamLike ? 'Member' : '')
    setMemberFocus('')
    setMemberTeamFunction('')
    setShowAddMember(false)
  }

  const handleRemoveMember = (memberId: string) => {
    if (!onRemoveMember) return
    setRemoveMemberConfirm(memberId)
  }

  const handleConfirmRemoveMember = useCallback(() => {
    if (removeMemberConfirm && onRemoveMember) {
      onRemoveMember(removeMemberConfirm)
    }
    setRemoveMemberConfirm(null)
  }, [removeMemberConfirm, onRemoveMember])

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal positioning */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={modalRef}
          role="dialog"
          aria-label={`Details for ${node.name}`}
          tabIndex={-1}
          className="pointer-events-auto w-full max-w-[640px] h-[85vh] bg-white rounded-lg shadow-2xl overflow-hidden outline-none animate-in fade-in zoom-in-95 duration-150"
        >
          {/* ── Sliding container ── */}
          <div
            className="flex h-full"
            style={{
              width: '200%',
              transform: `translateX(${modalPage === 'manage' ? '-50%' : '0%'})`,
              transition: SLIDE_TRANSITION,
            }}
          >
            {/* ════════════════════════════════════════════════════════════ */}
            {/* PROFILE PAGE                                               */}
            {/* ════════════════════════════════════════════════════════════ */}
            <div
              ref={profilePageRef}
              data-testid="profile-page"
              className="w-1/2 flex flex-col min-h-0"
              aria-hidden={modalPage !== 'profile'}
            >
              {/* Profile header */}
              <div className="px-6 pt-4 pb-3 border-b border-gray-200 shrink-0">
                {/* Breadcrumb */}
                {breadcrumb.length > 0 && (
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-1 overflow-hidden">
                    {breadcrumb.map((ancestor, i) => (
                      <span key={ancestor.id} className="flex items-center gap-1 shrink-0">
                        {i > 0 && <ChevronRight className="w-2.5 h-2.5" />}
                        {onNavigateNode ? (
                          <button
                            onClick={() => onNavigateNode(ancestor.id)}
                            className="hover:text-indigo-600 hover:underline truncate max-w-[120px]"
                          >
                            {ancestor.name}
                          </button>
                        ) : (
                          <span className="truncate max-w-[120px]">{ancestor.name}</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {/* Name row + actions */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 truncate">{node.name}</h2>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${typeBadgeColor}`}>
                      {node.customTypeLabel || NODE_TYPE_LABELS[node.nodeType] || node.nodeType}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {showGovernanceSignals && (
                      <HealthPill score={node.healthScore} size="md" showLabel showTooltip />
                    )}
                    {canManageOrgStructure && (
                      <button
                        onClick={() => slideToManage()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                        title="Manage node"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Manage
                      </button>
                    )}
                    <button
                      ref={profileCloseRef}
                      onClick={onClose}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="Close (Esc)"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Description */}
                {node.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{node.description}</p>
                )}
              </div>

              {/* Profile body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 min-h-0">
                {/* KPI Row */}
                <KpiRow
                  totalMembers={Math.max(node.totalMemberCount, uniqueMemberCount)}
                  childNodes={node.childIds.length}
                  descendants={node.totalNodeCount > 1 ? node.totalNodeCount - 1 : 0}
                  adminCoverage={coverageAdmins.length > 0}
                  showAdminCoverage={showGovernanceSignals}
                />

                {/* Members Card */}
                <MembersCard
                  key={node.id}
                  members={members}
                  currentNodeId={node.id}
                  nodeNameMap={nodeNameMap}
                  isPortfolioNode={isPortfolioNode}
                />

                {/* Coverage Admins (read-only) */}
                <CoverageAdminsSection
                  admins={coverageAdmins}
                  adminStatusMap={new Map(coverageAdmins.map(m => [m.id, getMemberAdminStatus(m)]))}
                  canManage={canManageOrgStructure}
                  onSlideToManage={() => slideToManage('coverage')}
                />

                {/* Governance & Risk (admin only, collapsed) */}
                {showGovernanceSignals && (
                  <GovernanceRiskCollapsible
                    node={node}
                    memberCount={uniqueMemberCount}
                    highCount={highCount}
                    medCount={medCount}
                    lowCount={lowCount}
                    isOpen={governanceOpen}
                    onToggle={() => setGovernanceOpen(v => !v)}
                    showScoringDetails={showScoringDetails}
                    onToggleScoringDetails={() => setShowScoringDetails(v => !v)}
                  />
                )}

              </div>
            </div>

            {/* ════════════════════════════════════════════════════════════ */}
            {/* MANAGE PAGE                                                */}
            {/* ════════════════════════════════════════════════════════════ */}
            <div
              ref={managePageRef}
              data-testid="manage-page"
              className="w-1/2 flex flex-col min-h-0"
              aria-hidden={modalPage !== 'manage'}
            >
              {/* Manage header */}
              <div className="px-5 pt-4 pb-3 border-b border-gray-200 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={slideToProfile}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors shrink-0"
                      title="Back to profile"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                        {node.customTypeLabel || NODE_TYPE_LABELS[node.nodeType] || node.nodeType}
                      </div>
                      <h2 className="text-base font-semibold text-gray-900 truncate">{node.name}</h2>
                    </div>
                  </div>
                  <button
                    ref={manageCloseRef}
                    onClick={onClose}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors shrink-0"
                    title="Close (Esc)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Tab bar */}
                <div className="flex gap-1">
                  {(['details', 'members', 'coverage', 'settings'] as ManageTab[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setManageTab(tab)}
                      className={clsx(
                        'px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
                        manageTab === tab
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Manage body */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 min-h-0">
                {manageTab === 'details' && (
                  <ManageDetailsTab
                    node={node}
                    editName={editName}
                    editDescription={editDescription}
                    editCustomTypeLabel={editCustomTypeLabel}
                    editPortfolioId={editPortfolioId}
                    onNameChange={setEditName}
                    onDescriptionChange={setEditDescription}
                    onCustomTypeLabelChange={setEditCustomTypeLabel}
                    onPortfolioIdChange={setEditPortfolioId}
                  />
                )}

                {manageTab === 'members' && (
                  <ManageMembersTab
                    node={node}
                    members={members}
                    nodeNameMap={nodeNameMap}
                    availableUsers={availableUsers}
                    showAddMember={showAddMember}
                    selectedUserId={selectedUserId}
                    memberRole={memberRole}
                    memberFocus={memberFocus}
                    memberTeamFunction={memberTeamFunction}
                    isTeamLike={teamLike}
                    onToggleAddMember={() => setShowAddMember(v => !v)}
                    onSelectUser={setSelectedUserId}
                    onRoleChange={setMemberRole}
                    onFocusChange={setMemberFocus}
                    onTeamFunctionChange={setMemberTeamFunction}
                    onAddMember={handleAddMember}
                    onRemoveMember={handleRemoveMember}
                    onUpdateMember={onUpdateMember}
                    onCancelAdd={() => setShowAddMember(false)}
                  />
                )}

                {manageTab === 'coverage' && (
                  <ManageCoverageTab
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

                {manageTab === 'settings' && (
                  <ManageSettingsTab
                    editColor={editColor}
                    editIsNonInvestment={editIsNonInvestment}
                    onColorChange={setEditColor}
                    onNonInvestmentChange={setEditIsNonInvestment}
                  />
                )}
              </div>

              {/* Manage footer (save button, details/settings tabs only) */}
              {(manageTab === 'details' || manageTab === 'settings') && (
                <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 shrink-0">
                  <button
                    onClick={slideToProfile}
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
          </div>
        </div>
      </div>

      {/* Discard changes confirmation */}
      <ConfirmDialog
        isOpen={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        onConfirm={handleConfirmDiscard}
        title="Discard unsaved changes?"
        message="You have unsaved changes that will be lost if you go back."
        confirmText="Discard"
        cancelText="Keep editing"
        variant="warning"
      />

      {/* Remove member confirmation */}
      <ConfirmDialog
        isOpen={removeMemberConfirm !== null}
        onClose={() => setRemoveMemberConfirm(null)}
        onConfirm={handleConfirmRemoveMember}
        title="Remove member?"
        message="This member will be removed from this node. This action can be undone by re-adding them."
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
      />
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE PAGE SUBCOMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── KPI Row ────────────────────────────────────────────────────────────

function KpiRow({
  totalMembers,
  childNodes,
  descendants,
  adminCoverage,
  showAdminCoverage,
}: {
  totalMembers: number
  childNodes: number
  descendants: number
  adminCoverage: boolean
  showAdminCoverage: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="kpi-row">
      <KpiChip label="Members" value={totalMembers} />
      {childNodes > 0 && <KpiChip label="Child Nodes" value={childNodes} />}
      {descendants > 0 && <KpiChip label="Descendants" value={descendants} />}
      {showAdminCoverage && <KpiChip label="Admin Coverage" value={adminCoverage ? 'Yes' : 'No'} />}
    </div>
  )
}

function KpiChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-md px-3 py-1.5">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-gray-900 tabular-nums">{value}</div>
    </div>
  )
}

// ─── Members Card with grouped roles ─────────────────────────────────────

interface MemberGroup {
  userId: string
  displayName: string
  initial: string
  entries: RawNodeMember[]
  isCoverageAdmin: boolean
}

function MembersCard({
  members,
  currentNodeId,
  nodeNameMap,
  isPortfolioNode,
}: {
  members: RawNodeMember[]
  currentNodeId: string
  nodeNameMap: Map<string, string>
  isPortfolioNode: boolean
}) {
  const [searchQuery, setSearchQuery] = useState('')

  // Group members by user_id
  const groups: MemberGroup[] = (() => {
    const map = new Map<string, RawNodeMember[]>()
    for (const m of members) {
      if (!map.has(m.user_id)) map.set(m.user_id, [])
      map.get(m.user_id)!.push(m)
    }
    const result: MemberGroup[] = []
    for (const [userId, entries] of map) {
      const first = entries[0]
      const name = first.user?.full_name || first.user?.email || userId
      result.push({
        userId,
        displayName: name,
        initial: name.charAt(0).toUpperCase(),
        entries,
        isCoverageAdmin: entries.some(e => e.is_coverage_admin && !e.coverage_admin_blocked),
      })
    }
    return result
  })()

  const showSearch = groups.length > 5
  const lowerQuery = searchQuery.toLowerCase()

  const filteredGroups = searchQuery
    ? groups.filter(g => {
        const name = g.displayName.toLowerCase()
        const email = g.entries[0]?.user?.email?.toLowerCase() || ''
        const roles = g.entries.map(e => e.role?.toLowerCase() || '').join(' ')
        return name.includes(lowerQuery) || email.includes(lowerQuery) || roles.includes(lowerQuery)
      })
    : groups

  const getRoleLabel = (entry: RawNodeMember) => {
    const raw = entry.role || 'Member'
    const role = raw.charAt(0).toUpperCase() + raw.slice(1)
    const isFromChild = entry.node_id !== currentNodeId
    const nodeName = isFromChild ? nodeNameMap.get(entry.node_id) : null
    const sourcePart = nodeName ? ` on ${nodeName}` : ''
    const focusPart = entry.focus ? ` — ${entry.focus}` : ''
    return `${role}${sourcePart}${focusPart}`
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-600">Members</span>
        <span className="text-[10px] text-gray-400 font-medium">{groups.length}</span>
      </div>

      <div className="px-4 py-3">
        {showSearch && (
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search members..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300"
            />
          </div>
        )}

        {filteredGroups.length > 0 ? (
          <div className="max-h-64 overflow-y-auto -mr-2 pr-2 custom-scrollbar">
            <div className="space-y-1">
              {filteredGroups.map(g => (
                  <div key={g.userId} className="rounded-lg hover:bg-gray-50 transition-colors px-1.5 py-1.5">
                    {/* Person row */}
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-[10px] font-semibold text-gray-600 shrink-0"
                        title={g.displayName}
                      >
                        {g.initial}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-gray-800 truncate block">
                          {g.displayName}
                        </span>
                        {g.entries.map(entry => (
                          <span key={entry.id} className="text-[10px] text-gray-400 leading-tight block truncate">
                            {getRoleLabel(entry)}
                          </span>
                        ))}
                      </div>
                      {g.isCoverageAdmin && (
                        <span className="text-[9px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-medium shrink-0">
                          Cov Admin
                        </span>
                      )}
                    </div>
                  </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic py-2 text-center">
            {searchQuery ? 'No matching members' : 'No members'}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Coverage Admins Section (read-only) ────────────────────────────────

function CoverageAdminsSection({
  admins,
  adminStatusMap,
  canManage,
  onSlideToManage,
}: {
  admins: RawNodeMember[]
  adminStatusMap: Map<string, { status: string; source?: string }>
  canManage: boolean
  onSlideToManage: () => void
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Coverage Admins</div>
      {admins.length > 0 ? (
        <div className="space-y-1.5">
          {admins.map(m => {
            const adminInfo = adminStatusMap.get(m.id)
            const statusLabel = adminInfo?.status === 'global'
              ? 'Global'
              : adminInfo?.status === 'inherited'
                ? `via ${adminInfo.source}`
                : null
            return (
              <div key={m.id} className="flex items-center gap-2">
                <div
                  className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center text-[9px] font-medium text-indigo-700 shrink-0"
                >
                  {(m.user?.full_name || m.user?.email || '?').charAt(0).toUpperCase()}
                </div>
                <span className="text-xs text-gray-700">{m.user?.full_name || m.user?.email || m.user_id}</span>
                {statusLabel && (
                  <span className="text-[10px] text-gray-400">{statusLabel}</span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">
          No coverage admins assigned
          {canManage && (
            <>
              {' — '}
              <button
                onClick={onSlideToManage}
                className="text-indigo-600 hover:text-indigo-700 font-medium not-italic"
              >
                assign in Manage
              </button>
            </>
          )}
        </p>
      )}
    </div>
  )
}

// ─── Governance & Risk Collapsible ──────────────────────────────────────

function GovernanceRiskCollapsible({
  node,
  memberCount,
  highCount,
  medCount,
  lowCount,
  isOpen,
  onToggle,
  showScoringDetails,
  onToggleScoringDetails,
}: {
  node: OrgGraphNode
  memberCount: number
  highCount: number
  medCount: number
  lowCount: number
  isOpen: boolean
  onToggle: () => void
  showScoringDetails: boolean
  onToggleScoringDetails: () => void
}) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        aria-expanded={isOpen}
      >
        <span className="text-xs font-semibold text-gray-600">Governance & Risk</span>
        <div className="flex items-center gap-2">
          {!isOpen && (highCount + medCount + lowCount > 0) && (
            <span className="text-[10px] text-gray-400">{highCount + medCount + lowCount} flags</span>
          )}
          <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
        </div>
      </button>

      {isOpen && (
        <div className="px-4 py-3 space-y-3">
          {/* Risk severity summary */}
          <div className="flex items-center gap-2" data-testid="risk-summary">
            <RiskCountBadge severity="high" count={highCount} showZero />
            <RiskCountBadge severity="medium" count={medCount} showZero />
            <RiskCountBadge severity="low" count={lowCount} showZero />
          </div>

          {/* Risk flag banners */}
          {node.riskFlags.length > 0 && (
            <div className="space-y-1.5">
              {node.riskFlags.map((flag, i) => (
                <div
                  key={i}
                  className={clsx(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-xs border-l-2',
                    flag.severity === 'high' && 'bg-red-50 border-l-red-500 text-red-800',
                    flag.severity === 'medium' && 'bg-amber-50 border-l-amber-500 text-amber-800',
                    flag.severity === 'low' && 'bg-gray-50 border-l-gray-400 text-gray-700',
                  )}
                >
                  <RiskFlagBadge flag={flag} size="sm" showLabel={false} />
                  <span>{flag.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Health diagnostics */}
          <HealthDiagnostics
            node={node}
            memberCount={memberCount}
            showScoringDetails={showScoringDetails}
            onToggleScoringDetails={onToggleScoringDetails}
          />

          {/* Non-investment callout */}
          {node.isNonInvestment && (
            <div className="text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded">
              Non-investment node — excluded from coverage health
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Health Diagnostics ──────────────────────────────────────────────────

function HealthDiagnostics({
  node,
  memberCount,
  showScoringDetails,
  onToggleScoringDetails,
}: {
  node: OrgGraphNode
  memberCount: number
  showScoringDetails: boolean
  onToggleScoringDetails: () => void
}) {
  if (node.isNonInvestment) {
    return <div className="text-xs text-gray-400 italic">Non-investment — always 100%</div>
  }

  const isTeam = node.nodeType === 'team'
  const hCount = node.riskFlags.filter(f => f.severity === 'high').length
  const mCount = node.riskFlags.filter(f => f.severity === 'medium').length

  const checks: { label: string; pass: boolean; weight: number; failSeverity: DiagSeverity }[] = [
    { label: 'Has direct members', pass: memberCount > 0, weight: 25, failSeverity: 'medium' },
    ...(isTeam
      ? [{ label: 'Has portfolios linked', pass: node.portfolioCount > 0, weight: 20, failSeverity: 'info' as DiagSeverity }]
      : []),
    ...(isTeam
      ? [{ label: 'Coverage assigned', pass: node.coverageAssetCount > 0, weight: 25, failSeverity: 'medium' as DiagSeverity }]
      : []),
    { label: 'No high-severity risks', pass: hCount === 0, weight: 20, failSeverity: 'high' },
    { label: 'No medium-severity risks', pass: mCount === 0, weight: 10, failSeverity: 'medium' },
  ]

  return (
    <div>
      <div className="space-y-1">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-1.5 text-xs">
            {c.pass ? (
              <>
                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-gray-500">{c.label}</span>
              </>
            ) : (
              <>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${DIAG_BADGE_STYLES[c.failSeverity]}`}>
                  {DIAG_BADGE_LABELS[c.failSeverity]}
                </span>
                <span className="text-gray-800 font-medium">{c.label}</span>
              </>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={onToggleScoringDetails}
        className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 mt-1.5 transition-colors"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${showScoringDetails ? 'rotate-180' : ''}`} />
        Scoring details
      </button>

      {showScoringDetails && (
        <div className="mt-1.5 space-y-1 pl-1">
          {checks.map(c => (
            <div key={c.label} className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500">{c.label}</span>
              <span className={`font-medium tabular-nums ${c.pass ? 'text-emerald-600' : 'text-red-500'}`}>
                {c.pass ? c.weight : 0}/{c.weight}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-100">
            <span className="text-gray-500 font-medium">Total</span>
            <span className={`font-semibold tabular-nums ${node.healthScore >= 80 ? 'text-emerald-600' : node.healthScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
              {node.healthScore}/100
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MANAGE PAGE SUBCOMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Details Tab ─────────────────────────────────────────────────────────

function ManageDetailsTab({
  node,
  editName,
  editDescription,
  editCustomTypeLabel,
  editPortfolioId,
  onNameChange,
  onDescriptionChange,
  onCustomTypeLabelChange,
  onPortfolioIdChange,
}: {
  node: OrgGraphNode
  editName: string
  editDescription: string
  editCustomTypeLabel: string
  editPortfolioId: string
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onCustomTypeLabelChange: (v: string) => void
  onPortfolioIdChange: (v: string) => void
}) {
  return (
    <div className="space-y-5">
      {node.nodeType === 'custom' && (
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

      {node.nodeType === 'portfolio' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio ID</label>
          <input
            type="text"
            value={editPortfolioId}
            onChange={(e) => onPortfolioIdChange(e.target.value.toUpperCase())}
            placeholder=""
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm font-mono uppercase"
          />
        </div>
      )}
    </div>
  )
}

// ─── Members Tab ─────────────────────────────────────────────────────────

function ManageMembersTab({
  node,
  members,
  nodeNameMap,
  availableUsers,
  showAddMember,
  selectedUserId,
  memberRole,
  memberFocus,
  memberTeamFunction = '',
  isTeamLike = false,
  onToggleAddMember,
  onSelectUser,
  onRoleChange,
  onFocusChange,
  onTeamFunctionChange,
  onAddMember,
  onRemoveMember,
  onUpdateMember,
  onCancelAdd,
}: {
  node: OrgGraphNode
  members: RawNodeMember[]
  nodeNameMap: Map<string, string>
  availableUsers: AvailableUser[]
  showAddMember: boolean
  selectedUserId: string
  memberRole: string
  memberFocus: string
  memberTeamFunction?: string
  isTeamLike?: boolean
  onToggleAddMember: () => void
  onSelectUser: (id: string) => void
  onRoleChange: (v: string) => void
  onFocusChange: (v: string) => void
  onTeamFunctionChange?: (v: string) => void
  onAddMember: () => void
  onRemoveMember: (id: string) => void
  onUpdateMember?: (memberId: string, role: string, focus: string | null) => void
  onCancelAdd: () => void
}) {
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editFocus, setEditFocus] = useState('')

  // Group members by user_id so each person shows once
  const groups = (() => {
    const map = new Map<string, RawNodeMember[]>()
    for (const m of members) {
      if (!map.has(m.user_id)) map.set(m.user_id, [])
      map.get(m.user_id)!.push(m)
    }
    const result: { userId: string; displayName: string; initial: string; entries: RawNodeMember[] }[] = []
    for (const [userId, entries] of map) {
      const first = entries[0]
      const name = first.user?.full_name || first.user?.email || userId
      result.push({ userId, displayName: name, initial: name.charAt(0).toUpperCase(), entries })
    }
    return result
  })()

  const getMembershipLabel = (entry: RawNodeMember) => {
    const role = entry.role
      ? entry.role.charAt(0).toUpperCase() + entry.role.slice(1)
      : 'Member'
    const isFromChild = entry.node_id !== node.id
    const nodeName = isFromChild ? nodeNameMap.get(entry.node_id) : null
    const sourcePart = nodeName ? ` on ${nodeName}` : ''
    const focusPart = entry.focus ? ` — ${entry.focus}` : ''
    return `${role}${sourcePart}${focusPart}`
  }

  const startEditing = (entry: RawNodeMember) => {
    setEditingEntryId(entry.id)
    setEditRole(entry.role || '')
    setEditFocus(entry.focus || '')
  }

  const stopEditing = () => {
    setEditingEntryId(null)
    setEditRole('')
    setEditFocus('')
  }

  return (
    <div className="space-y-4">
      {/* Header with add button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Members ({groups.length})</h3>
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
          {isTeamLike ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team Role</label>
                <select
                  value={memberRole}
                  onChange={(e) => onRoleChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  {TEAM_ROLE_OPTIONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Function</label>
                <select
                  value={memberTeamFunction}
                  onChange={(e) => onTeamFunctionChange?.(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">None (optional)</option>
                  {TEAM_FUNCTION_OPTIONS.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select
                  value={memberRole}
                  onChange={(e) => {
                    onRoleChange(e.target.value)
                    onFocusChange('')
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">Select role...</option>
                  {ROLE_OPTIONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              {memberRole && getFocusOptionsForRole(memberRole).length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Focus (select multiple)</label>
                  <div className="flex flex-wrap gap-1.5">
                    {getFocusOptionsForRole(memberRole).map(focus => {
                      const currentFocuses = memberFocus ? memberFocus.split(', ').filter(Boolean) : []
                      const isSelected = currentFocuses.includes(focus)
                      return (
                        <button
                          key={focus}
                          type="button"
                          onClick={() => {
                            let newFocuses: string[]
                            if (isSelected) {
                              newFocuses = currentFocuses.filter(f => f !== focus)
                            } else {
                              newFocuses = [...currentFocuses, focus]
                            }
                            onFocusChange(newFocuses.join(', '))
                          }}
                          className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                            isSelected
                              ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                              : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {focus}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
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

      {/* Member list — grouped by user */}
      {groups.length > 0 ? (
        <div className="divide-y divide-gray-100">
          {groups.map(group => (
            <div key={group.userId} className="py-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                  style={{ backgroundColor: node.color }}
                >
                  {group.initial}
                </div>
                <span className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0">{group.displayName}</span>
                <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0">
                  {group.entries.length} {group.entries.length === 1 ? 'role' : 'roles'}
                </span>
              </div>
              {/* Membership entries */}
              <div className="mt-1 space-y-1 ml-9">
                {group.entries.map(entry => {
                  const isFromChild = entry.node_id !== node.id
                  const isEditing = editingEntryId === entry.id

                  if (isEditing && onUpdateMember) {
                    const focusOpts = getFocusOptionsForRole(editRole)
                    const currentFocuses = editFocus ? editFocus.split(', ').filter(Boolean) : []
                    return (
                      <div key={entry.id} className="bg-indigo-50 rounded-lg p-2.5 space-y-2">
                        {isTeamLike ? (
                          <>
                            <div>
                              <label className="block text-[10px] font-medium text-gray-600 mb-1">Team Role</label>
                              <select
                                value={editRole}
                                onChange={(e) => {
                                  const newRole = e.target.value
                                  setEditRole(newRole)
                                  onUpdateMember(entry.id, newRole, editFocus || null)
                                }}
                                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              >
                                {TEAM_ROLE_OPTIONS.map(r => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-gray-600 mb-1">Function</label>
                              <select
                                value={editFocus}
                                onChange={(e) => {
                                  const newFunc = e.target.value
                                  setEditFocus(newFunc)
                                  onUpdateMember(entry.id, editRole, newFunc || null)
                                }}
                                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              >
                                <option value="">None</option>
                                {TEAM_FUNCTION_OPTIONS.map(f => (
                                  <option key={f} value={f}>{f}</option>
                                ))}
                              </select>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <label className="block text-[10px] font-medium text-gray-600 mb-1">Role</label>
                              <select
                                value={editRole}
                                onChange={(e) => {
                                  const newRole = e.target.value
                                  setEditRole(newRole)
                                  setEditFocus('')
                                  onUpdateMember(entry.id, newRole, null)
                                }}
                                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              >
                                <option value="">Select role...</option>
                                {ROLE_OPTIONS.map(r => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            </div>
                            {focusOpts.length > 0 && (
                              <div>
                                <label className="block text-[10px] font-medium text-gray-600 mb-1">Focus</label>
                                <div className="flex flex-wrap gap-1">
                                  {focusOpts.map(f => {
                                    const selected = currentFocuses.includes(f)
                                    return (
                                      <button
                                        key={f}
                                        type="button"
                                        onClick={() => {
                                          const newFocuses = selected
                                            ? currentFocuses.filter(x => x !== f)
                                            : [...currentFocuses, f]
                                          const newFocusStr = newFocuses.join(', ')
                                          setEditFocus(newFocusStr)
                                          onUpdateMember(entry.id, editRole, newFocusStr || null)
                                        }}
                                        className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                                          selected
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
                          </>
                        )}
                        <div className="flex justify-end">
                          <button
                            onClick={stopEditing}
                            className="px-2 py-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={entry.id} className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                      <span className="text-xs text-gray-500 truncate flex-1 min-w-0">{getMembershipLabel(entry)}</span>
                      {!isFromChild && onUpdateMember && (
                        <button
                          onClick={() => startEditing(entry)}
                          className="p-0.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded shrink-0 transition-colors"
                          title="Edit role"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      )}
                      {!isFromChild && (
                        <button
                          onClick={() => onRemoveMember(entry.id)}
                          className="p-0.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0 transition-colors"
                          title="Remove member"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No members assigned</p>
      )}
    </div>
  )
}

// ─── Coverage Tab ─────────────────────────────────────────────────────────

function ManageCoverageTab({
  node,
  membersWithDescendants,
  getMemberAdminStatus,
  canManageCoverageAdmins,
  globalCoverageAdminUserIds,
  onToggleCoverageAdmin,
  onToggleCoverageAdminBlocked,
  allNodeMembers,
}: {
  node: OrgGraphNode
  membersWithDescendants: RawNodeMember[]
  getMemberAdminStatus: (m: RawNodeMember) => { status: string; source?: string }
  canManageCoverageAdmins: boolean
  globalCoverageAdminUserIds: Set<string>
  onToggleCoverageAdmin?: (memberId: string, isCoverageAdmin: boolean) => void
  onToggleCoverageAdminBlocked?: (memberId: string, isBlocked: boolean) => void
  allNodeMembers: RawNodeMember[]
}) {
  if (node.isNonInvestment) {
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

  // Split members into admins (explicit/global/inherited/blocked) vs non-admins
  const adminMembers: (RawNodeMember & { _adminStatus: { status: string; source?: string } })[] = []
  const otherMembers: (RawNodeMember & { _adminStatus: { status: string; source?: string } })[] = []

  for (const member of membersWithDescendants) {
    const adminStatus = getMemberAdminStatus(member)
    const tagged = { ...member, _adminStatus: adminStatus }
    if (adminStatus.status !== 'none') {
      adminMembers.push(tagged)
    } else {
      otherMembers.push(tagged)
    }
  }

  const [showOtherMembers, setShowOtherMembers] = useState(false)

  const renderMemberRow = (member: RawNodeMember & { _adminStatus: { status: string; source?: string } }) => {
    const name = member.user?.full_name || member.user?.email || 'Unknown'
    const initial = name.charAt(0).toUpperCase()
    const adminStatus = member._adminStatus

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
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Manage coverage admin rights for members of this node and its descendants.
      </p>

      {/* Coverage admins */}
      {adminMembers.length > 0 ? (
        <div className="divide-y divide-gray-100">
          {adminMembers.map(renderMemberRow)}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic py-2">No coverage admins assigned.</p>
      )}

      {/* Other members — collapsible */}
      {otherMembers.length > 0 && canManageCoverageAdmins && (
        <div className="border-t border-gray-100 pt-2">
          <button
            onClick={() => setShowOtherMembers(v => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            {showOtherMembers ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Other members ({otherMembers.length})
          </button>
          {showOtherMembers && (
            <div className="divide-y divide-gray-100 mt-1">
              {otherMembers.map(renderMemberRow)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Settings Tab ─────────────────────────────────────────────────────────

function ManageSettingsTab({
  editColor,
  editIsNonInvestment,
  onColorChange,
  onNonInvestmentChange,
}: {
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
