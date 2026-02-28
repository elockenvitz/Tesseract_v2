/**
 * @deprecated Use OrgNodeDetailsModal instead. This drawer component is no longer
 * rendered in the Organization → Teams flow. Retained temporarily for reference;
 * safe to delete once all consumers have migrated.
 *
 * OrgNodeDetailsDrawer — right-side drawer for org node governance details.
 *
 * Section order: Overview → Governance & Risk → Membership → Coverage.
 * Keyboard accessible: ESC closes, focus trapped.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  ChevronRight,
  ChevronDown,
  Users,
  Shield,
  Eye,
  Edit3,
  Check,
} from 'lucide-react'
import { HealthPill } from './HealthPill'
import { RiskFlagBadge, RiskDots } from './RiskBadge'
import type { OrgGraphNode } from '../../lib/org-graph'
import type { RawNodeMember } from '../../lib/org-graph'

// ─── Types ──────────────────────────────────────────────────────────────

interface OrgNodeDetailsDrawerProps {
  node: OrgGraphNode
  members: RawNodeMember[]
  /** Members derived from portfolio children (not also direct members) */
  portfolioMembers?: RawNodeMember[]
  /** Ancestor breadcrumb nodes (from root → parent) */
  breadcrumb: { id: string; name: string }[]
  onClose: () => void
  /** Navigate to a different node in the drawer */
  onNavigateNode?: (nodeId: string) => void
  /** Open the full edit modal for this node */
  onEditNode?: () => void
  /** Whether current user is admin */
  isAdmin?: boolean
  /** When false, hides governance & risk section */
  showGovernanceSignals?: boolean
}

// ─── Constants ──────────────────────────────────────────────────────────

const NODE_TYPE_LABELS: Record<string, string> = {
  division: 'Division',
  department: 'Department',
  team: 'Team',
  portfolio: 'Portfolio',
  custom: 'Custom',
}

const PM_PATTERNS = [/\bpm\b/i, /portfolio\s*manager/i]
const ANALYST_PATTERNS = [/analyst/i, /research/i]

function classifyRole(role: string): 'pm' | 'analyst' | 'other' {
  if (PM_PATTERNS.some(p => p.test(role))) return 'pm'
  if (ANALYST_PATTERNS.some(p => p.test(role))) return 'analyst'
  return 'other'
}

// ─── Component ──────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export function OrgNodeDetailsDrawer({
  node,
  members,
  portfolioMembers = [],
  breadcrumb,
  onClose,
  onNavigateNode,
  onEditNode,
  isAdmin = false,
  showGovernanceSignals = false,
}: OrgNodeDetailsDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const lastActiveElementRef = useRef<Element | null>(null)
  const [showScoringDetails, setShowScoringDetails] = useState(false)

  // Store originator element and restore on unmount
  useEffect(() => {
    lastActiveElementRef.current = document.activeElement
    return () => {
      const el = lastActiveElementRef.current
      if (el && el instanceof HTMLElement) {
        requestAnimationFrame(() => el.focus())
      }
    }
  }, [])

  // Focus close button on open/node change
  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [node.id])

  // ESC to close + focus trap (Tab/Shift+Tab cycling)
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

  // Role distribution
  const roleGroups = members.reduce<{ pm: RawNodeMember[]; analyst: RawNodeMember[]; other: RawNodeMember[] }>(
    (acc, m) => {
      const group = classifyRole(m.role)
      acc[group].push(m)
      return acc
    },
    { pm: [], analyst: [], other: [] },
  )

  const coverageAdmins = members.filter(m => m.is_coverage_admin && !m.coverage_admin_blocked)

  const uniqueMembers = new Map<string, RawNodeMember>()
  for (const m of members) {
    if (!uniqueMembers.has(m.user_id)) uniqueMembers.set(m.user_id, m)
  }

  const uniquePortfolioMembers = new Map<string, RawNodeMember>()
  for (const m of portfolioMembers) {
    if (!uniquePortfolioMembers.has(m.user_id)) uniquePortfolioMembers.set(m.user_id, m)
  }

  const hasPortfolioMembers = uniquePortfolioMembers.size > 0
  const isTeamWithDerived = node.nodeType === 'team' && hasPortfolioMembers

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-label={`Details for ${node.name}`}
        tabIndex={-1}
        className="fixed right-0 top-0 bottom-0 w-[380px] bg-white shadow-2xl z-50 flex flex-col outline-none overflow-hidden animate-slide-in-right"
      >
        {/* ── Header / Overview ── */}
        <div className="flex items-start justify-between px-4 pt-3 pb-2.5 border-b border-gray-200">
          <div className="flex-1 min-w-0">
            {/* Breadcrumb */}
            {breadcrumb.length > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5 overflow-hidden">
                {breadcrumb.map((ancestor, i) => (
                  <span key={ancestor.id} className="flex items-center gap-1 shrink-0">
                    {i > 0 && <ChevronRight className="w-2.5 h-2.5" />}
                    {onNavigateNode ? (
                      <button
                        onClick={() => onNavigateNode(ancestor.id)}
                        className="hover:text-indigo-600 hover:underline truncate max-w-[80px]"
                      >
                        {ancestor.name}
                      </button>
                    ) : (
                      <span className="truncate max-w-[80px]">{ancestor.name}</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* Name + type */}
            <h2 className="text-base font-semibold text-gray-900 truncate">{node.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-500">{node.customTypeLabel || NODE_TYPE_LABELS[node.nodeType] || node.nodeType}</span>
              {showGovernanceSignals && <HealthPill score={node.healthScore} size="sm" showTooltip />}
              {showGovernanceSignals && <RiskDots flags={node.riskFlags} />}
            </div>
          </div>

          <div className="flex items-center gap-1 ml-2 shrink-0">
            {isAdmin && onEditNode && (
              <button
                onClick={onEditNode}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                title="Edit node"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">
          {/* ═══ A. Governance & Risk (gated) ═══ */}
          {showGovernanceSignals && (
            <Section title="Governance & Risk" icon={<Shield className="w-3.5 h-3.5" />}>
              {/* Health diagnostics checklist */}
              <HealthDiagnostics
                node={node}
                memberCount={uniqueMembers.size}
                showScoringDetails={showScoringDetails}
                onToggleScoringDetails={() => setShowScoringDetails(v => !v)}
              />

              {/* Risk flags */}
              {node.riskFlags.length > 0 && (
                <div className="mt-2.5">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Risk Flags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {node.riskFlags.map((flag, i) => (
                      <RiskFlagBadge key={i} flag={flag} size="md" />
                    ))}
                  </div>
                </div>
              )}

              {/* Coverage admins */}
              <div className="mt-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Coverage Admins</span>
                  <span className="font-medium text-gray-800">
                    {coverageAdmins.length > 0
                      ? coverageAdmins.map(m => m.user?.full_name || m.user?.email || 'Unknown').join(', ')
                      : <span className="text-gray-400 italic">None assigned</span>
                    }
                  </span>
                </div>
                {node.isNonInvestment && (
                  <div className="text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded mt-1.5">
                    Non-investment node — excluded from coverage health
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ═══ B. Membership ═══ */}
          <Section title="Membership" icon={<Users className="w-3.5 h-3.5" />}>
            {/* Role distribution line */}
            <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
              {roleGroups.pm.length > 0 && (
                <span className="font-medium">{roleGroups.pm.length} PM{roleGroups.pm.length > 1 ? 's' : ''}</span>
              )}
              {roleGroups.pm.length > 0 && roleGroups.analyst.length > 0 && <span className="text-gray-300">&bull;</span>}
              {roleGroups.analyst.length > 0 && (
                <span className="font-medium">{roleGroups.analyst.length} Analyst{roleGroups.analyst.length > 1 ? 's' : ''}</span>
              )}
              {roleGroups.other.length > 0 && (roleGroups.pm.length > 0 || roleGroups.analyst.length > 0) && <span className="text-gray-300">&bull;</span>}
              {roleGroups.other.length > 0 && (
                <span className="font-medium">{roleGroups.other.length} Other</span>
              )}
              {uniqueMembers.size === 0 && !hasPortfolioMembers && <span className="text-gray-400 italic">No members</span>}
            </div>

            {/* Direct Members */}
            {isTeamWithDerived && (
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Direct Members ({uniqueMembers.size})
              </div>
            )}
            {uniqueMembers.size > 0 && (
              <MemberList members={Array.from(uniqueMembers.values())} />
            )}
            {uniqueMembers.size === 0 && isTeamWithDerived && (
              <div className="text-xs text-gray-400 italic py-0.5">No direct members</div>
            )}

            {/* Inherited from Portfolios */}
            {isTeamWithDerived && (
              <div className={uniqueMembers.size > 0 ? 'mt-2.5' : 'mt-1.5'}>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Inherited from Portfolios ({uniquePortfolioMembers.size})
                </div>
                <MemberList members={Array.from(uniquePortfolioMembers.values())} />
              </div>
            )}
          </Section>

          {/* ═══ C. Coverage (team nodes only) ═══ */}
          {node.nodeType === 'team' && (
            <Section title="Coverage" icon={<Eye className="w-3.5 h-3.5" />}>
              <div className="space-y-1">
                <StatRow label="Assets Covered" value={node.coverageAssetCount} />
                <StatRow label="Analysts" value={node.coverageAnalystCount} />
                <StatRow label="Portfolios" value={node.portfolioCount} />
                <StatRow label="Total Members" value={node.totalMemberCount} />
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
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
  const highCount = node.riskFlags.filter(f => f.severity === 'high').length
  const medCount = node.riskFlags.filter(f => f.severity === 'medium').length

  const checks = [
    { label: 'Has direct members', pass: memberCount > 0, weight: 25 },
    ...(isTeam
      ? [{ label: 'Has portfolios linked', pass: node.portfolioCount > 0, weight: 20 }]
      : []),
    ...(isTeam
      ? [{ label: 'Coverage assigned', pass: node.coverageAssetCount > 0, weight: 25 }]
      : []),
    { label: 'No high-severity risks', pass: highCount === 0, weight: 20 },
    { label: 'No medium-severity risks', pass: medCount === 0, weight: 10 },
  ]

  return (
    <div>
      <div className="space-y-0.5">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-1.5 text-xs">
            {c.pass ? (
              <Check className="w-3 h-3 text-emerald-500 shrink-0" />
            ) : (
              <X className="w-3 h-3 text-red-400 shrink-0" />
            )}
            <span className={c.pass ? 'text-gray-600' : 'text-red-600 font-medium'}>{c.label}</span>
          </div>
        ))}
      </div>

      {/* Scoring details toggle */}
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

// ─── Member List ─────────────────────────────────────────────────────────

function MemberList({ members }: { members: RawNodeMember[] }) {
  if (members.length === 0) return null
  return (
    <div className="space-y-0.5 max-h-44 overflow-y-auto">
      {members.map(m => (
        <div key={m.id} className="flex items-center gap-2 py-0.5">
          <div
            className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-medium text-gray-600 shrink-0"
            title={m.user?.full_name || m.user?.email || m.user_id}
          >
            {(m.user?.full_name || m.user?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-800 truncate">
              {m.user?.full_name || m.user?.email || m.user_id}
            </div>
            <div className="text-[10px] text-gray-400">{m.role}{m.focus ? ` — ${m.focus}` : ''}</div>
          </div>
          {m.is_coverage_admin && !m.coverage_admin_blocked && (
            <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-medium shrink-0">
              Cov Admin
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Internal helpers ───────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 border-b border-gray-100">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-gray-400">{icon}</span>
        <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-900 tabular-nums">{value}</span>
    </div>
  )
}
