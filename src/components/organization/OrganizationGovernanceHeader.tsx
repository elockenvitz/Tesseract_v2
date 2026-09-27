/**
 * OrganizationGovernanceHeader — dense governance status strip.
 *
 * Two-row layout:
 *   Top: ORG HEALTH (large) | risk severity badges (always shown) | admin action
 *   Bottom: entity counts with dividers
 *
 * Risk count badges are clickable to filter Structure view.
 * Health pill includes tooltip explaining scoring weights.
 */

import {
  Building2,
  Users,
  Briefcase,
  Shield,
  UserCheck,
  AlertTriangle,
} from 'lucide-react'
import { HealthPill } from './HealthPill'
import { RiskCountBadge } from './RiskBadge'
import { useIsMobile } from '../../hooks/useMediaQuery'
import type { OrgGraph } from '../../lib/org-graph'
import type { RiskCounts } from '../../lib/org-graph'

interface OrganizationGovernanceHeaderProps {
  orgGraph: OrgGraph
  riskCounts: RiskCounts
  adminCount: number
  coverageAdminCount: number
  isOrgAdmin: boolean
  activeRiskFilter?: 'high' | 'medium' | 'low' | null
  onRiskFilterClick?: (severity: 'high' | 'medium' | 'low') => void
}

export function OrganizationGovernanceHeader({
  orgGraph,
  riskCounts,
  adminCount,
  coverageAdminCount,
  isOrgAdmin,
  activeRiskFilter,
  onRiskFilterClick,
}: OrganizationGovernanceHeaderProps) {
  const isMobile = useIsMobile()
  return (
    <div className="bg-slate-50/90 border border-gray-200/80 rounded-md shadow-sm mt-3 mb-3" data-no-pan>
      {/* ── Top row: Health + Risk breakdown + Action ──

          On a phone the label pair and the divider go, the pill drops to
          `sm`, and the row wraps: this is a status strip above the actual
          org chart, and it was taking a third of the first screen before any
          structure appeared. Every number is still here. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-1.5 sm:px-4 sm:py-2 border-b border-gray-200/60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-4">
          {/* Health: large and prominent */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <div className="hidden sm:block select-none">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest dark:text-gray-400">Governance</span>
              <span className="text-[9px] text-gray-400 ml-1">Org Health</span>
            </div>
            {/* One instance, sized by viewport. Rendering both and hiding one
                with CSS put the score in the DOM twice — announced twice by a
                screen reader, and ambiguous to anything querying by text. */}
            <HealthPill score={orgGraph.overallHealth} size={isMobile ? 'sm' : 'lg'} showTooltip />
          </div>

          <div className="hidden sm:block w-px h-6 bg-gray-300/60" />

          {/* Risk severity badges — always visible, zero-state reads "0" */}
          <div className="flex items-center gap-1.5">
            <RiskCountBadge
              severity="high"
              count={riskCounts.high}
              showZero
              active={activeRiskFilter === 'high'}
              onClick={onRiskFilterClick ? () => onRiskFilterClick('high') : undefined}
            />
            <RiskCountBadge
              severity="medium"
              count={riskCounts.medium}
              showZero
              active={activeRiskFilter === 'medium'}
              onClick={onRiskFilterClick ? () => onRiskFilterClick('medium') : undefined}
            />
            <RiskCountBadge
              severity="low"
              count={riskCounts.low}
              showZero
              active={activeRiskFilter === 'low'}
              onClick={onRiskFilterClick ? () => onRiskFilterClick('low') : undefined}
            />
          </div>
        </div>

      </div>

      {/* ── Bottom row: Entity counts ──

          A scrolling line on a phone rather than a wrapping block: six counts
          at ~70px each is well past 390px, and stacked they became a panel.
          This keeps them one glanceable line you can swipe. */}
      <div className="flex items-center gap-3 sm:gap-4 px-2 sm:px-4 py-1.5 text-[11px] overflow-x-auto no-scrollbar sm:overflow-visible sm:flex-wrap">
        <Stat icon={<Building2 className="w-3 h-3" />} value={orgGraph.totalNodes} label="Nodes" />
        <Stat icon={<Users className="w-3 h-3" />} value={orgGraph.totalTeams} label="Teams" />
        <Stat icon={<Users className="w-3 h-3" />} value={orgGraph.totalMembers} label="Members" />
        <Stat icon={<Briefcase className="w-3 h-3" />} value={orgGraph.totalPortfolios} label="Portfolios" />
        <Sep />
        <Stat icon={<Shield className="w-3 h-3" />} value={adminCount} label={adminCount === 1 ? 'Admin' : 'Admins'} />
        <Stat icon={<UserCheck className="w-3 h-3" />} value={coverageAdminCount} label="Cov. Admins" />
        {riskCounts.total > 0 && (
          <>
            <Sep />
            <Stat
              icon={<AlertTriangle className="w-3 h-3 text-amber-500" />}
              value={riskCounts.total}
              label={riskCounts.total === 1 ? 'Risk' : 'Risks'}
              warn
            />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Internal helpers ──────────────────────────────────────────────────

function Sep() {
  return <div className="shrink-0 w-px h-3 bg-gray-200" />
}

function Stat({
  icon,
  value,
  label,
  warn,
}: {
  icon: React.ReactNode
  value: number
  label: string
  warn?: boolean
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 whitespace-nowrap text-gray-500 select-none dark:text-gray-400">
      <span className="text-gray-400">{icon}</span>
      <span className={`font-semibold tabular-nums ${warn ? 'text-amber-700' : 'text-gray-800 dark:text-gray-100'}`}>{value}</span>
      <span>{label}</span>
    </div>
  )
}
