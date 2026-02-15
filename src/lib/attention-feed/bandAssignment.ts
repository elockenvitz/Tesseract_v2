/**
 * Band Assignment — Pure functions for attention feed classification.
 *
 * Rules:
 *   NOW  — severity=high OR requiresDecision OR overdue OR blocking
 *   SOON — severity=medium OR dueSoon OR needsProgress (not NOW, not awareness-only)
 *   AWARE — signal/catalyst/rating-change awareness items, or low severity without urgency
 *
 * Sorting:
 *   NOW  — severity desc, overdue/dueAt asc, age desc
 *   SOON — dueAt asc, severity desc, age desc
 *   AWARE — newest first (updatedAt desc)
 */

import type {
  AttentionBand,
  AttentionFeedItem,
  AttentionFeedSeverity,
  AttentionFeedItemType,
  BandSummary,
} from '../../types/attention-feed'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<AttentionFeedSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

/** Types that are awareness-only by nature (never promoted to NOW/SOON) */
const AWARENESS_TYPES: Set<AttentionFeedItemType> = new Set([
  'signal',
  'notification',
  'alignment',
])

/** Types that inherently require a decision */
const DECISION_TYPES: Set<AttentionFeedItemType> = new Set([
  'proposal',
  'suggestion',
])

// ---------------------------------------------------------------------------
// Band assignment
// ---------------------------------------------------------------------------

export function assignBand(item: AttentionFeedItem): AttentionBand {
  // Awareness-only types always go to AWARE
  if (AWARENESS_TYPES.has(item.type)) return 'aware'

  // NOW: high severity, requires decision, overdue, or blocking
  if (
    item.severity === 'high' ||
    item.requiresDecision ||
    item.overdue ||
    item.blocking
  ) {
    return 'now'
  }

  // SOON: medium severity or due soon
  if (item.severity === 'medium' || item.dueSoon) {
    return 'soon'
  }

  // Risk items with non-high severity are awareness
  if (item.type === 'risk' && item.severity === 'low') {
    return 'aware'
  }

  // Default: SOON for actionable types, AWARE for the rest
  return 'soon'
}

// ---------------------------------------------------------------------------
// Urgent-only filter
// ---------------------------------------------------------------------------

/**
 * When urgentOnly is enabled:
 *   - Show all NOW items
 *   - Show SOON items that are dueSoon or overdue
 *   - Hide all AWARE items
 */
export function filterUrgentOnly(items: AttentionFeedItem[]): AttentionFeedItem[] {
  return items.filter(item => {
    if (item.band === 'now') return true
    if (item.band === 'soon' && (item.dueSoon || item.overdue)) return true
    return false
  })
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export function sortNow(items: AttentionFeedItem[]): AttentionFeedItem[] {
  return [...items].sort((a, b) => {
    // Severity desc
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (sevDiff !== 0) return sevDiff

    // Overdue first, then by dueAt asc
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.dueAt && b.dueAt) {
      const dueDiff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      if (dueDiff !== 0) return dueDiff
    }

    // Age desc (older first)
    return b.ageDays - a.ageDays
  })
}

export function sortSoon(items: AttentionFeedItem[]): AttentionFeedItem[] {
  return [...items].sort((a, b) => {
    // Due date asc (items with due dates first)
    if (a.dueAt && b.dueAt) {
      const dueDiff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      if (dueDiff !== 0) return dueDiff
    } else if (a.dueAt && !b.dueAt) return -1
    else if (!a.dueAt && b.dueAt) return 1

    // Severity desc
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (sevDiff !== 0) return sevDiff

    // Age desc
    return b.ageDays - a.ageDays
  })
}

export function sortAware(items: AttentionFeedItem[]): AttentionFeedItem[] {
  return [...items].sort((a, b) => {
    // Newest first (updatedAt desc)
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

/** Sort items within their band */
export function sortByBand(items: AttentionFeedItem[]): {
  now: AttentionFeedItem[]
  soon: AttentionFeedItem[]
  aware: AttentionFeedItem[]
} {
  const now: AttentionFeedItem[] = []
  const soon: AttentionFeedItem[] = []
  const aware: AttentionFeedItem[] = []

  for (const item of items) {
    switch (item.band) {
      case 'now': now.push(item); break
      case 'soon': soon.push(item); break
      case 'aware': aware.push(item); break
    }
  }

  return {
    now: sortNow(now),
    soon: sortSoon(soon),
    aware: sortAware(aware),
  }
}

// ---------------------------------------------------------------------------
// Band summary computation
// ---------------------------------------------------------------------------

export function computeBandSummary(
  band: AttentionBand,
  items: AttentionFeedItem[],
): BandSummary {
  const count = items.length
  let oldestAgeDays = 0

  for (const item of items) {
    if (item.ageDays > oldestAgeDays) oldestAgeDays = item.ageDays
  }

  // Breakdown by type
  const typeCounts = new Map<string, number>()
  for (const item of items) {
    const label = TYPE_BREAKDOWN_LABELS[item.type] ?? item.type
    typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1)
  }
  const breakdown = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n} ${label}`)
    .join(' \u00B7 ') // middle dot

  // SOON: find next due date
  let nextDueAt: string | null = null
  if (band === 'soon') {
    for (const item of items) {
      if (item.dueAt && (!nextDueAt || item.dueAt < nextDueAt)) {
        nextDueAt = item.dueAt
      }
    }
  }

  return { band, count, oldestAgeDays, breakdown, nextDueAt }
}

const TYPE_BREAKDOWN_LABELS: Record<string, string> = {
  proposal: 'decisions',
  simulation: 'sims',
  execution: 'executions',
  deliverable: 'overdue',
  project: 'projects',
  thesis: 'thesis',
  risk: 'risks',
  signal: 'signals',
  prompt: 'prompts',
  suggestion: 'suggestions',
  notification: 'updates',
  alignment: 'team',
}
