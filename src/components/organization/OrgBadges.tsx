/**
 * Shared presentational components for the Organization Members and Governance tabs.
 *
 * StatusPill   – Active / Invited / Suspended membership status
 * RoleBadge    – Org Admin / Member / Coverage Admin / PM
 * CountChip    – Compact numeric chip (e.g. "3 teams")
 * SeatSummaryBar – Active / Invited / Suspended seat counts
 */

import { clsx } from 'clsx'
import { Crown, Shield, AlertTriangle } from 'lucide-react'

// ─── Status Pill ────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  invited: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  sent: 'bg-amber-50 text-amber-700 border-amber-200',
  inactive: 'bg-red-50 text-red-600 border-red-200',
  suspended: 'bg-red-50 text-red-600 border-red-200',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  invited: 'Invited',
  pending: 'Invited',
  sent: 'Invited',
  inactive: 'Suspended',
  suspended: 'Suspended',
}

export function StatusPill({ status }: { status: string }) {
  const key = status.toLowerCase()
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border',
        STATUS_STYLES[key] || 'bg-gray-50 text-gray-600 border-gray-200',
      )}
    >
      {STATUS_LABELS[key] || status}
    </span>
  )
}

// ─── Role Badge ─────────────────────────────────────────────────────────

interface RoleBadgeProps {
  role: 'org-admin' | 'coverage-admin' | 'pm' | 'member'
  compact?: boolean
}

const ROLE_CONFIG: Record<RoleBadgeProps['role'], { label: string; shortLabel: string; icon?: React.ReactNode; style: string }> = {
  'org-admin': {
    label: 'Org Admin',
    shortLabel: 'Admin',
    icon: <Crown className="w-3 h-3" />,
    style: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  'coverage-admin': {
    label: 'Coverage Admin',
    shortLabel: 'Coverage',
    icon: <Shield className="w-3 h-3" />,
    style: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  'pm': {
    label: 'Portfolio Manager',
    shortLabel: 'PM',
    icon: null,
    style: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  'member': {
    label: 'Member',
    shortLabel: 'Member',
    icon: null,
    style: 'bg-gray-50 text-gray-600 border-gray-200',
  },
}

export function RoleBadge({ role, compact = false }: RoleBadgeProps) {
  const cfg = ROLE_CONFIG[role]
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border', cfg.style)}>
      {cfg.icon}
      {compact ? cfg.shortLabel : cfg.label}
    </span>
  )
}

// ─── Count Chip ─────────────────────────────────────────────────────────

interface CountChipProps {
  count: number
  label: string
  /** Highlight when count > 0 */
  variant?: 'default' | 'risk'
}

export function CountChip({ count, label, variant = 'default' }: CountChipProps) {
  if (variant === 'risk' && count === 0) return null
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded',
        variant === 'risk' && count > 0
          ? 'text-red-600 bg-red-50'
          : 'text-gray-500 bg-gray-100',
      )}
    >
      {variant === 'risk' && count > 0 && <AlertTriangle className="w-3 h-3" />}
      <span className="font-medium">{count}</span>
      <span>{label}</span>
    </span>
  )
}

// ─── Seat Summary Bar ───────────────────────────────────────────────────

export interface SeatCounts {
  active: number
  invited: number
  suspended: number
}

export function SeatSummaryBar({ seats }: { seats: SeatCounts }) {
  return (
    <div className="inline-flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-gray-600">
          <span className="font-semibold text-gray-900">{seats.active}</span> active
        </span>
      </span>
      {seats.invited > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-gray-600">
            <span className="font-semibold text-gray-900">{seats.invited}</span> invited
          </span>
        </span>
      )}
      {seats.suspended > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          <span className="text-gray-600">
            <span className="font-semibold text-gray-900">{seats.suspended}</span> suspended
          </span>
        </span>
      )}
    </div>
  )
}

// ─── Governance Summary Chips ───────────────────────────────────────────

interface GovernanceSummaryProps {
  orgAdminCount: number
  coverageAdminCount: number
  pmCount: number
  riskFlagCount: number
  activeFilter?: string
  onFilterClick?: (filter: string) => void
}

export function GovernanceSummaryStrip({
  orgAdminCount,
  coverageAdminCount,
  pmCount,
  riskFlagCount,
  activeFilter,
  onFilterClick,
}: GovernanceSummaryProps) {
  const chips = [
    { key: 'org-admin', label: 'Org Admins', count: orgAdminCount, style: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
    { key: 'coverage-admin', label: 'Coverage Admins', count: coverageAdminCount, style: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100' },
    { key: 'pm', label: 'PMs', count: pmCount, style: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100' },
    { key: 'flagged', label: 'Risk Flags', count: riskFlagCount, style: 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100', icon: <AlertTriangle className="w-3 h-3" /> },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={() => onFilterClick?.(activeFilter === c.key ? 'all' : c.key)}
          className={clsx(
            'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer',
            c.style,
            activeFilter === c.key && 'ring-2 ring-offset-1 ring-current',
          )}
        >
          {c.icon}
          <span className="font-semibold">{c.count}</span>
          {c.label}
        </button>
      ))}
    </div>
  )
}
