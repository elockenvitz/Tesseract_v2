/**
 * Centralized project status & priority taxonomy.
 * Single source of truth for labels, colors, icons, and sort options.
 */
import type { ProjectStatus, ProjectPriority } from '../types/project'

// ── Status ───────────────────────────────────────────────────

export interface StatusConfig {
  id: ProjectStatus
  label: string
  /** Tailwind classes for pill/badge */
  pillClasses: string
  /** Dot indicator color */
  dotColor: string
}

export const PROJECT_STATUSES: readonly StatusConfig[] = [
  { id: 'planning',    label: 'Planning',     pillClasses: 'bg-gray-100 text-gray-700',    dotColor: 'bg-gray-400' },
  { id: 'in_progress', label: 'In Progress',  pillClasses: 'bg-blue-50 text-blue-700',     dotColor: 'bg-blue-500' },
  { id: 'blocked',     label: 'Blocked',      pillClasses: 'bg-red-50 text-red-700',       dotColor: 'bg-red-500' },
  { id: 'completed',   label: 'Completed',    pillClasses: 'bg-emerald-50 text-emerald-700', dotColor: 'bg-emerald-500' },
  { id: 'cancelled',   label: 'Cancelled',    pillClasses: 'bg-gray-100 text-gray-500',    dotColor: 'bg-gray-300' },
] as const

export const STATUS_MAP = new Map<string, StatusConfig>(
  PROJECT_STATUSES.map(s => [s.id, s])
)

export function getStatusConfig(status: ProjectStatus): StatusConfig {
  return STATUS_MAP.get(status) ?? PROJECT_STATUSES[0]
}

// ── Priority ─────────────────────────────────────────────────

export interface PriorityConfig {
  id: ProjectPriority
  label: string
  /** Numeric weight for sorting (higher = more urgent) */
  weight: number
  /** Pill classes */
  pillClasses: string
  /** Subtle left-border accent on cards */
  borderClass: string
  /** Title contrast class (urgent/high get stronger) */
  titleClass: string
  /** Metadata muting class (low gets slightly muted) */
  metaClass: string
}

export const PROJECT_PRIORITIES: readonly PriorityConfig[] = [
  {
    id: 'urgent', label: 'Urgent', weight: 4,
    pillClasses: 'bg-red-50 text-red-600',
    borderClass: 'border-l-red-300',
    titleClass: 'text-gray-900 font-semibold',
    metaClass: 'text-gray-500',
  },
  {
    id: 'high', label: 'High', weight: 3,
    pillClasses: 'bg-orange-50 text-orange-600',
    borderClass: 'border-l-orange-200',
    titleClass: 'text-gray-900 font-medium',
    metaClass: 'text-gray-500',
  },
  {
    id: 'medium', label: 'Medium', weight: 2,
    pillClasses: 'bg-amber-50/70 text-amber-600',
    borderClass: 'border-l-transparent',
    titleClass: 'text-gray-900 font-medium',
    metaClass: 'text-gray-500',
  },
  {
    id: 'low', label: 'Low', weight: 1,
    pillClasses: 'bg-gray-50 text-gray-500',
    borderClass: 'border-l-transparent',
    titleClass: 'text-gray-800 font-medium',
    metaClass: 'text-gray-400',
  },
] as const

export const PRIORITY_MAP = new Map<string, PriorityConfig>(
  PROJECT_PRIORITIES.map(p => [p.id, p])
)

export function getPriorityConfig(priority: ProjectPriority): PriorityConfig {
  return PRIORITY_MAP.get(priority) ?? PROJECT_PRIORITIES[2] // default medium
}

// ── Sort ─────────────────────────────────────────────────────

export interface SortOption {
  value: string
  label: string
  field: 'created_at' | 'due_date' | 'priority' | 'title' | 'updated_at'
  order: 'asc' | 'desc'
}

export const SORT_OPTIONS: readonly SortOption[] = [
  { value: 'created_at-desc',  label: 'Newest',           field: 'created_at',  order: 'desc' },
  { value: 'created_at-asc',   label: 'Oldest',           field: 'created_at',  order: 'asc' },
  { value: 'priority-desc',    label: 'Highest Priority',  field: 'priority',    order: 'desc' },
  { value: 'due_date-asc',     label: 'Most Overdue',      field: 'due_date',    order: 'asc' },
  { value: 'updated_at-desc',  label: 'Recently Updated',  field: 'updated_at',  order: 'desc' },
  { value: 'title-asc',        label: 'Title A-Z',         field: 'title',       order: 'asc' },
] as const

// ── Overdue helpers ──────────────────────────────────────────

/** Returns days overdue (positive = overdue, negative/0 = not overdue). */
export function daysOverdue(dueDate: string | null, status: ProjectStatus): number {
  if (!dueDate || status === 'completed' || status === 'cancelled') return 0
  const diff = Math.floor(
    (Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24)
  )
  return diff > 0 ? diff : 0
}

/**
 * Overdue emphasis level based on priority interaction:
 * urgent/high + overdue → 'strong', medium + overdue → 'moderate', low + overdue → 'mild'
 */
export function overdueEmphasis(
  dueDate: string | null,
  status: ProjectStatus,
  priority: ProjectPriority
): 'none' | 'mild' | 'moderate' | 'strong' {
  const days = daysOverdue(dueDate, status)
  if (days === 0) return 'none'
  if (priority === 'urgent' || priority === 'high') return 'strong'
  if (priority === 'medium') return 'moderate'
  return 'mild'
}
