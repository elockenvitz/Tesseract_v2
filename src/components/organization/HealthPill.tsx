/**
 * HealthPill — compact health score display (0–100).
 *
 * Color-coded: green >=80, amber >=50, red <50.
 * Renders as an inline pill with optional label and tooltip.
 */

import { clsx } from 'clsx'

interface HealthPillProps {
  score: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  /** Show tooltip explaining health scoring weights */
  showTooltip?: boolean
  className?: string
}

const HEALTH_COLORS = {
  green: {
    bg: 'bg-emerald-50 border-emerald-300',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
  },
  amber: {
    bg: 'bg-amber-50 border-amber-300',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  red: {
    bg: 'bg-red-50 border-red-300',
    text: 'text-red-700',
    dot: 'bg-red-500',
  },
} as const

function getHealthTier(score: number) {
  if (score >= 80) return HEALTH_COLORS.green
  if (score >= 50) return HEALTH_COLORS.amber
  return HEALTH_COLORS.red
}

export function getHealthColorClass(score: number): string {
  if (score >= 80) return 'text-emerald-700'
  if (score >= 50) return 'text-amber-700'
  return 'text-red-700'
}

function buildTooltip(score: number): string {
  return [
    `Health: ${score}%`,
    '',
    'Scoring weights:',
    '  Members assigned: 25pts',
    '  Portfolios linked: 20pts',
    '  Coverage active: 25pts',
    '  No high-severity risks: 20pts',
    '  No medium-severity risks: 10pts',
  ].join('\n')
}

const SIZE_CLASSES = {
  sm: { pill: 'px-1.5 py-0.5 text-[10px]', dot: 'w-1.5 h-1.5' },
  md: { pill: 'px-2 py-0.5 text-xs', dot: 'w-1.5 h-1.5' },
  lg: { pill: 'px-2.5 py-1 text-sm font-semibold', dot: 'w-2 h-2' },
} as const

export function HealthPill({ score, size = 'sm', showLabel = false, showTooltip = false, className }: HealthPillProps) {
  const tier = getHealthTier(score)
  const sz = SIZE_CLASSES[size]

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border font-medium',
        tier.bg,
        tier.text,
        sz.pill,
        className,
      )}
      title={showTooltip ? buildTooltip(score) : `Health: ${score}%`}
    >
      <span className={clsx('rounded-full', tier.dot, sz.dot)} />
      {score}%
      {showLabel && <span className="font-normal opacity-75">health</span>}
    </span>
  )
}
