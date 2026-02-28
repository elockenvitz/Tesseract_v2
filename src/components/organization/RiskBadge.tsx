/**
 * RiskBadge — displays a single risk flag or a risk count summary.
 *
 * Severity colors: high = red, medium = amber, low = gray.
 * Three variants:
 *   - RiskFlagBadge: shows a single RiskFlag with label
 *   - RiskCountBadge: shows a severity count (e.g., "3 High"), supports showZero + active state
 *   - RiskDots: compact inline indicator dots
 */

import { clsx } from 'clsx'
import { AlertTriangle, AlertCircle, Info } from 'lucide-react'
import type { RiskFlag } from '../../lib/org-graph'

// ─── Shared styles ──────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  high: {
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-700',
    activeBg: 'bg-red-100 border-red-400',
    zeroBg: 'bg-gray-50 border-gray-200',
    zeroText: 'text-gray-400',
    icon: AlertTriangle,
  },
  medium: {
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-700',
    activeBg: 'bg-amber-100 border-amber-400',
    zeroBg: 'bg-gray-50 border-gray-200',
    zeroText: 'text-gray-400',
    icon: AlertCircle,
  },
  low: {
    bg: 'bg-gray-100 border-gray-200',
    text: 'text-gray-600',
    activeBg: 'bg-gray-200 border-gray-400',
    zeroBg: 'bg-gray-50 border-gray-200',
    zeroText: 'text-gray-400',
    icon: Info,
  },
} as const

// ─── Single flag badge ──────────────────────────────────────────────────

interface RiskFlagBadgeProps {
  flag: RiskFlag
  size?: 'sm' | 'md'
  showLabel?: boolean
  className?: string
}

export function RiskFlagBadge({ flag, size = 'sm', showLabel = true, className }: RiskFlagBadgeProps) {
  const style = SEVERITY_STYLES[flag.severity]
  const Icon = style.icon

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border font-medium',
        style.bg,
        style.text,
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        className,
      )}
      title={flag.label}
    >
      <Icon className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {showLabel && <span className="truncate max-w-[120px]">{flag.label}</span>}
    </span>
  )
}

// ─── Severity count badge ───────────────────────────────────────────────

interface RiskCountBadgeProps {
  severity: 'high' | 'medium' | 'low'
  count: number
  /** Show badge even when count is 0 (displays "0" with muted styling) */
  showZero?: boolean
  /** Highlight as actively filtered */
  active?: boolean
  onClick?: () => void
  className?: string
}

export function RiskCountBadge({ severity, count, showZero, active, onClick, className }: RiskCountBadgeProps) {
  if (count === 0 && !showZero) return null

  const style = SEVERITY_STYLES[severity]
  const Icon = style.icon
  const label = severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Low'
  const isZero = count === 0

  const Component = onClick ? 'button' : 'span'

  return (
    <Component
      className={clsx(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium transition-all',
        active
          ? `${style.activeBg} ${style.text} ring-1 ring-offset-1 ring-current`
          : isZero
          ? `${style.zeroBg} ${style.zeroText}`
          : `${style.bg} ${style.text}`,
        onClick && 'cursor-pointer hover:opacity-80',
        className,
      )}
      onClick={onClick}
      title={`${count} ${label.toLowerCase()}-severity risk${count !== 1 ? 's' : ''}`}
    >
      <Icon className="w-3 h-3" />
      <span className="tabular-nums">{count}</span>
      <span className="font-normal">{label}</span>
    </Component>
  )
}

// ─── Inline risk dots (compact, for cards) ──────────────────────────────

interface RiskDotsProps {
  flags: RiskFlag[]
  className?: string
}

export function RiskDots({ flags, className }: RiskDotsProps) {
  if (flags.length === 0) return null

  const high = flags.filter(f => f.severity === 'high').length
  const medium = flags.filter(f => f.severity === 'medium').length
  const low = flags.filter(f => f.severity === 'low').length

  return (
    <span
      className={clsx('inline-flex items-center gap-0.5', className)}
      title={flags.map(f => `${f.severity.toUpperCase()}: ${f.label}`).join('\n')}
    >
      {high > 0 && <span className="w-2 h-2 rounded-full bg-red-500" />}
      {medium > 0 && <span className="w-2 h-2 rounded-full bg-amber-500" />}
      {low > 0 && <span className="w-2 h-2 rounded-full bg-gray-400" />}
    </span>
  )
}
