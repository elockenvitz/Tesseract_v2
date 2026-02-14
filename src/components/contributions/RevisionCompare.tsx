import React, { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  GitCompare,
  ChevronDown,
  ArrowLeftRight,
  DollarSign,
  Gauge,
  FileText,
  AlertTriangle,
  Target,
  Sparkles,
} from 'lucide-react'
import { format } from 'date-fns'
import type { RevisionRow } from '../../hooks/useAssetRevisions'

// ============================================================================
// TYPES
// ============================================================================

interface RevisionCompareProps {
  revisions: RevisionRow[]
  viewFilter: 'aggregated' | string
  significantOnly: boolean
}

type CompareMode = 'revisions' | 'views'

interface DeltaEntry {
  category: string
  field_key: string
  before_value: string | null
  after_value: string | null
  significance_tier: number
}

interface ScopeOption {
  key: string
  label: string
  type: 'firm' | 'user'
  userId: string | null
}

// ============================================================================
// DISPLAY CATEGORIES (ordered)
// ============================================================================

const DISPLAY_CATEGORIES: { key: string; label: string; color: string; icon: React.ElementType }[] = [
  { key: 'rating', label: 'Rating & Stance', color: 'text-indigo-600', icon: Gauge },
  { key: 'valuation_targets', label: 'Valuation & Targets', color: 'text-green-600', icon: DollarSign },
  { key: 'thesis', label: 'Thesis', color: 'text-primary-600', icon: Target },
  { key: 'where_different', label: 'Where Different', color: 'text-purple-600', icon: Sparkles },
  { key: 'risks_to_thesis', label: 'Risks', color: 'text-amber-600', icon: AlertTriangle },
  { key: 'supporting', label: 'Supporting', color: 'text-blue-600', icon: FileText },
]

const SIGNIFICANT_CATEGORIES = new Set(['rating', 'valuation_targets', 'risks_to_thesis'])

// ============================================================================
// FIELD LABEL PARSER
// ============================================================================

function getFieldLabel(fieldKey: string): string {
  const segments = fieldKey.split('.')

  if (segments[0] === 'targets' && segments.length >= 3) {
    const scenario = segments[1].charAt(0).toUpperCase() + segments[1].slice(1).replace(/_/g, ' ')
    const metric = segments[2]
    if (metric === 'price') return `${scenario} target`
    if (metric === 'prob' || metric === 'probability') return `${scenario} probability`
    if (metric === 'expiry') return `${scenario} expiry`
    return `${scenario} ${metric}`
  }

  if (segments[0] === 'targets' && segments.length === 2) {
    const metric = segments[1]
    if (metric === 'price') return 'Target price'
    if (metric === 'prob' || metric === 'probability') return 'Probability'
    return metric.charAt(0).toUpperCase() + metric.slice(1)
  }

  if (segments[0] === 'rating' && segments.length >= 3 && segments[2] === 'value') {
    const methodology = segments[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    return `Rating (${methodology})`
  }

  if (segments[0] === 'rating' && segments.length === 2 && segments[1] === 'methodology') {
    return 'Rating methodology'
  }

  const simpleLabels: Record<string, string> = {
    thesis: 'Investment Thesis',
    where_different: 'Where Different',
    risks_to_thesis: 'Risks to Thesis',
  }

  return simpleLabels[fieldKey] || fieldKey.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ============================================================================
// DELTA FORMATTING
// ============================================================================

interface FormattedDelta {
  label: string
  formatted: string
  type: 'numeric' | 'percentage' | 'text' | 'value'
  percentChange?: number
}

function formatDelta(fieldKey: string, before: string | null, after: string | null): FormattedDelta {
  const label = getFieldLabel(fieldKey)
  const segments = fieldKey.split('.')
  const metric = segments.length >= 3 ? segments[2] : (segments.length === 2 ? segments[1] : '')

  // Price values
  if (metric === 'price') {
    const beforeNum = before ? parseFloat(before) : null
    const afterNum = after ? parseFloat(after) : null

    if (beforeNum != null && afterNum != null && beforeNum !== 0) {
      const pctChange = ((afterNum - beforeNum) / beforeNum) * 100
      const sign = pctChange >= 0 ? '+' : ''
      return {
        label,
        formatted: `$${beforeNum.toLocaleString()} → $${afterNum.toLocaleString()} (${sign}${pctChange.toFixed(1)}%)`,
        type: 'numeric',
        percentChange: pctChange,
      }
    }
    if (beforeNum == null && afterNum != null) return { label, formatted: `$${afterNum.toLocaleString()} (new)`, type: 'numeric' }
    if (beforeNum != null && afterNum == null) return { label, formatted: `$${beforeNum.toLocaleString()} (removed)`, type: 'numeric' }
  }

  // Probability values
  if (metric === 'prob' || metric === 'probability') {
    const beforeNum = before ? parseFloat(before) : null
    const afterNum = after ? parseFloat(after) : null

    if (beforeNum != null && afterNum != null) {
      const ppChange = afterNum - beforeNum
      const sign = ppChange >= 0 ? '+' : ''
      return {
        label,
        formatted: `${Math.round(beforeNum)}% → ${Math.round(afterNum)}% (${sign}${Math.round(ppChange)}pp)`,
        type: 'percentage',
      }
    }
    if (beforeNum == null && afterNum != null) return { label, formatted: `${Math.round(afterNum)}% (new)`, type: 'percentage' }
    if (beforeNum != null && afterNum == null) return { label, formatted: `${Math.round(beforeNum)}% (removed)`, type: 'percentage' }
  }

  // Expiry values
  if (metric === 'expiry') {
    return { label, formatted: `${before || 'none'} → ${after || 'none'}`, type: 'value' }
  }

  // Rating values
  if (segments[0] === 'rating') {
    if (before && after) return { label, formatted: `${before} → ${after}`, type: 'value' }
    if (!before && after) return { label, formatted: `${after} (new)`, type: 'value' }
    if (before && !after) return { label, formatted: `${before} (removed)`, type: 'value' }
  }

  // Text values — label only, no diff
  if (before && after) return { label, formatted: 'Updated', type: 'text' }
  if (!before && after) return { label, formatted: 'Added', type: 'text' }
  if (before && !after) return { label, formatted: 'Removed', type: 'text' }

  return { label, formatted: 'Changed', type: 'text' }
}

// ============================================================================
// AGGREGATION
// ============================================================================

/** Aggregate net deltas between two revisions (same scope). */
function aggregateRevisionDeltas(
  revisions: RevisionRow[],
  baselineId: string,
  compareId: string
): DeltaEntry[] {
  const baseline = revisions.find(r => r.id === baselineId)
  const compare = revisions.find(r => r.id === compareId)
  if (!baseline || !compare) return []

  const baselineTime = new Date(baseline.last_activity_at).getTime()
  const compareTime = new Date(compare.last_activity_at).getTime()
  const isForward = baselineTime <= compareTime
  const [olderTime, newerTime] = isForward
    ? [baselineTime, compareTime]
    : [compareTime, baselineTime]

  const inRange = revisions.filter(r => {
    const t = new Date(r.last_activity_at).getTime()
    return t >= olderTime && t <= newerTime
      && r.view_scope_type === baseline.view_scope_type
      && r.view_scope_user_id === baseline.view_scope_user_id
  })

  const allEvents = inRange
    .flatMap(r => r.events)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const fieldMap = new Map<string, DeltaEntry>()
  for (const event of allEvents) {
    const existing = fieldMap.get(event.field_key)
    if (!existing) {
      fieldMap.set(event.field_key, {
        category: event.category,
        field_key: event.field_key,
        before_value: event.before_value,
        after_value: event.after_value,
        significance_tier: event.significance_tier,
      })
    } else {
      existing.after_value = event.after_value
      existing.significance_tier = Math.min(existing.significance_tier, event.significance_tier)
    }
  }

  // If baseline is newer → swap before/after so deltas read baseline → compare
  if (!isForward) {
    for (const entry of fieldMap.values()) {
      const tmp = entry.before_value
      entry.before_value = entry.after_value
      entry.after_value = tmp
    }
  }

  return Array.from(fieldMap.values()).filter(e => e.before_value !== e.after_value)
}

/** Build latest state per field_key for a scope. */
function buildScopeState(
  revisions: RevisionRow[],
  scopeType: string,
  scopeUserId: string | null
): Map<string, { category: string; value: string | null; significance_tier: number }> {
  const scopeRevisions = revisions.filter(r =>
    r.view_scope_type === scopeType &&
    r.view_scope_user_id === scopeUserId
  )

  const stateMap = new Map<string, { category: string; value: string | null; significance_tier: number }>()
  const allEvents = scopeRevisions
    .flatMap(r => r.events)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  for (const event of allEvents) {
    stateMap.set(event.field_key, {
      category: event.category,
      value: event.after_value,
      significance_tier: event.significance_tier,
    })
  }

  return stateMap
}

/** Compare latest states between two scopes. */
function compareViewStates(
  revisions: RevisionRow[],
  scopeA: ScopeOption,
  scopeB: ScopeOption
): DeltaEntry[] {
  const stateA = buildScopeState(revisions, scopeA.type, scopeA.userId)
  const stateB = buildScopeState(revisions, scopeB.type, scopeB.userId)

  const allKeys = new Set([...stateA.keys(), ...stateB.keys()])
  const deltas: DeltaEntry[] = []

  for (const key of allKeys) {
    const a = stateA.get(key)
    const b = stateB.get(key)
    const valueA = a?.value ?? null
    const valueB = b?.value ?? null

    if (valueA !== valueB) {
      deltas.push({
        category: a?.category || b?.category || 'supporting',
        field_key: key,
        before_value: valueA,
        after_value: valueB,
        significance_tier: Math.min(a?.significance_tier ?? 3, b?.significance_tier ?? 3),
      })
    }
  }

  return deltas
}

// ============================================================================
// DELTA ROW COMPONENT
// ============================================================================

function DeltaRow({ delta }: { delta: DeltaEntry }) {
  const formatted = formatDelta(delta.field_key, delta.before_value, delta.after_value)
  const isPositive = formatted.percentChange != null && formatted.percentChange > 0
  const isNegative = formatted.percentChange != null && formatted.percentChange < 0

  return (
    <div className="flex items-start gap-2 py-1 text-sm">
      <span className="text-gray-500 text-xs mt-0.5 flex-shrink-0 min-w-[120px]">
        {formatted.label}:
      </span>
      {formatted.type === 'text' ? (
        <span className={clsx(
          'text-xs px-1.5 py-0.5 rounded',
          formatted.formatted === 'Added' && 'bg-green-50 text-green-700',
          formatted.formatted === 'Removed' && 'bg-red-50 text-red-700',
          formatted.formatted !== 'Added' && formatted.formatted !== 'Removed' && 'bg-amber-50 text-amber-700',
        )}>
          {formatted.formatted}
        </span>
      ) : (
        <span className={clsx(
          'text-xs font-medium',
          isPositive && 'text-green-700',
          isNegative && 'text-red-700',
          !isPositive && !isNegative && 'text-gray-900 dark:text-gray-100',
        )}>
          {formatted.formatted}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function RevisionCompare({ revisions, viewFilter, significantOnly }: RevisionCompareProps) {
  const [compareMode, setCompareMode] = useState<CompareMode>('revisions')
  const [baselineId, setBaselineId] = useState('')
  const [compareId, setCompareId] = useState('')
  const [baselineScopeKey, setBaselineScopeKey] = useState('')
  const [compareScopeKey, setCompareScopeKey] = useState('')

  // Revisions filtered to current view scope (for revision mode)
  const scopedRevisions = useMemo(() => {
    if (viewFilter === 'aggregated') {
      return revisions.filter(r => r.view_scope_type === 'firm')
    }
    return revisions.filter(r =>
      r.view_scope_type === 'user' && r.view_scope_user_id === viewFilter
    )
  }, [revisions, viewFilter])

  // Available scopes (for view mode)
  const availableScopes = useMemo(() => {
    const scopes: ScopeOption[] = []
    const seen = new Set<string>()
    // Build a name lookup from actors
    const nameLookup = new Map<string, string>()
    for (const r of revisions) {
      if (r.actor && !nameLookup.has(r.actor_user_id)) {
        nameLookup.set(
          r.actor_user_id,
          `${r.actor.first_name || ''} ${r.actor.last_name || ''}`.trim() || 'Unknown'
        )
      }
    }

    for (const r of revisions) {
      const key = `${r.view_scope_type}:${r.view_scope_user_id || ''}`
      if (seen.has(key)) continue
      seen.add(key)

      if (r.view_scope_type === 'firm') {
        scopes.push({ key, label: 'Firm View', type: 'firm', userId: null })
      } else if (r.view_scope_user_id) {
        const name = nameLookup.get(r.view_scope_user_id) || 'Unknown'
        scopes.push({ key, label: `${name}'s View`, type: 'user', userId: r.view_scope_user_id })
      }
    }
    return scopes
  }, [revisions])

  // Compute deltas
  const deltas = useMemo((): DeltaEntry[] => {
    if (compareMode === 'revisions') {
      if (!baselineId || !compareId) return []
      return aggregateRevisionDeltas(revisions, baselineId, compareId)
    }
    const scopeA = availableScopes.find(s => s.key === baselineScopeKey)
    const scopeB = availableScopes.find(s => s.key === compareScopeKey)
    if (!scopeA || !scopeB) return []
    return compareViewStates(revisions, scopeA, scopeB)
  }, [compareMode, baselineId, compareId, baselineScopeKey, compareScopeKey, revisions, availableScopes])

  // Filter by significance
  const visibleDeltas = useMemo(() => {
    if (!significantOnly) return deltas
    return deltas.filter(d => SIGNIFICANT_CATEGORIES.has(d.category))
  }, [deltas, significantOnly])

  // Group by category in display order
  const grouped = useMemo(() => {
    const groups = new Map<string, DeltaEntry[]>()
    for (const d of visibleDeltas) {
      const arr = groups.get(d.category) || []
      arr.push(d)
      groups.set(d.category, arr)
    }
    return DISPLAY_CATEGORIES
      .filter(cat => groups.has(cat.key))
      .map(cat => ({ ...cat, deltas: groups.get(cat.key)! }))
  }, [visibleDeltas])

  const handleSwap = () => {
    if (compareMode === 'revisions') {
      const tmp = baselineId
      setBaselineId(compareId)
      setCompareId(tmp)
    } else {
      const tmp = baselineScopeKey
      setBaselineScopeKey(compareScopeKey)
      setCompareScopeKey(tmp)
    }
  }

  const formatRevisionOption = (r: RevisionRow) => {
    const name = r.actor
      ? `${r.actor.first_name || ''} ${r.actor.last_name || ''}`.trim() || 'Unknown'
      : 'Unknown'
    const date = format(new Date(r.last_activity_at), 'MMM d')
    const n = r.events.length
    return `${date} · ${name} · ${n} chg${n !== 1 ? 's' : ''}`
  }

  const hasSelection = compareMode === 'revisions'
    ? !!baselineId && !!compareId
    : !!baselineScopeKey && !!compareScopeKey

  // Empty state: no revisions at all
  if (revisions.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
        <GitCompare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No revision data available</p>
        <p className="text-xs text-gray-400 mt-1">Revisions are created when you publish changes</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 space-y-3">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-gray-500" />
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            <button
              onClick={() => { setCompareMode('revisions'); setBaselineScopeKey(''); setCompareScopeKey('') }}
              className={clsx(
                'px-2.5 py-1 text-xs font-medium rounded transition-colors',
                compareMode === 'revisions'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              Revisions
            </button>
            <button
              onClick={() => { setCompareMode('views'); setBaselineId(''); setCompareId('') }}
              disabled={availableScopes.length < 2}
              className={clsx(
                'px-2.5 py-1 text-xs font-medium rounded transition-colors',
                compareMode === 'views'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
                availableScopes.length < 2 && 'opacity-40 cursor-not-allowed'
              )}
              title={availableScopes.length < 2 ? 'Need revisions from at least 2 different view scopes' : undefined}
            >
              Views
            </button>
          </div>
        </div>

        {/* Selectors */}
        {compareMode === 'revisions' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Baseline:</span>
              <div className="relative">
                <select
                  value={baselineId}
                  onChange={e => setBaselineId(e.target.value)}
                  className="appearance-none pl-2.5 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer min-w-[180px]"
                >
                  <option value="">Select revision...</option>
                  {scopedRevisions.map(r => (
                    <option key={r.id} value={r.id} disabled={r.id === compareId}>
                      {formatRevisionOption(r)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>
            </div>

            <button
              onClick={handleSwap}
              disabled={!baselineId || !compareId}
              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
              title="Swap baseline and compare"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Compare to:</span>
              <div className="relative">
                <select
                  value={compareId}
                  onChange={e => setCompareId(e.target.value)}
                  className="appearance-none pl-2.5 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer min-w-[180px]"
                >
                  <option value="">Select revision...</option>
                  {scopedRevisions.map(r => (
                    <option key={r.id} value={r.id} disabled={r.id === baselineId}>
                      {formatRevisionOption(r)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Baseline:</span>
              <div className="relative">
                <select
                  value={baselineScopeKey}
                  onChange={e => setBaselineScopeKey(e.target.value)}
                  className="appearance-none pl-2.5 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer min-w-[140px]"
                >
                  <option value="">Select view...</option>
                  {availableScopes.map(s => (
                    <option key={s.key} value={s.key} disabled={s.key === compareScopeKey}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>
            </div>

            <button
              onClick={handleSwap}
              disabled={!baselineScopeKey || !compareScopeKey}
              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
              title="Swap views"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Compare to:</span>
              <div className="relative">
                <select
                  value={compareScopeKey}
                  onChange={e => setCompareScopeKey(e.target.value)}
                  className="appearance-none pl-2.5 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer min-w-[140px]"
                >
                  <option value="">Select view...</option>
                  {availableScopes.map(s => (
                    <option key={s.key} value={s.key} disabled={s.key === baselineScopeKey}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>
        )}

        {/* Selection metadata */}
        {compareMode === 'revisions' && (baselineId || compareId) && (
          <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
            {baselineId && (() => {
              const r = scopedRevisions.find(rev => rev.id === baselineId)
              if (!r) return null
              return (
                <span>
                  Baseline: {format(new Date(r.last_activity_at), 'MMM d, yyyy HH:mm')}
                  {r.revision_note && <span className="text-blue-400 ml-1">· {r.revision_note}</span>}
                </span>
              )
            })()}
            {compareId && (() => {
              const r = scopedRevisions.find(rev => rev.id === compareId)
              if (!r) return null
              return (
                <span>
                  Compare: {format(new Date(r.last_activity_at), 'MMM d, yyyy HH:mm')}
                  {r.revision_note && <span className="text-blue-400 ml-1">· {r.revision_note}</span>}
                </span>
              )
            })()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {!hasSelection ? (
          <div className="text-center py-8">
            <GitCompare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {compareMode === 'revisions'
                ? scopedRevisions.length < 2
                  ? `Only ${scopedRevisions.length} revision${scopedRevisions.length !== 1 ? 's' : ''} in this scope`
                  : 'Select two revisions to compare'
                : 'Select two views to compare'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {compareMode === 'revisions'
                ? scopedRevisions.length < 2
                  ? 'Switch to a different view or use the Views tab to compare across scopes'
                  : 'Choose a baseline and compare-to revision above'
                : 'Choose two different view scopes above'}
            </p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-8">
            <GitCompare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {significantOnly ? 'No significant differences' : 'No differences found'}
            </p>
            {significantOnly && deltas.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                {deltas.length} minor change{deltas.length !== 1 ? 's' : ''} hidden by significance filter
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-3 pb-3 border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500">
              <span>{visibleDeltas.length} difference{visibleDeltas.length !== 1 ? 's' : ''}</span>
              {significantOnly && deltas.length > visibleDeltas.length && (
                <span className="text-gray-400">
                  ({deltas.length - visibleDeltas.length} minor hidden)
                </span>
              )}
            </div>

            {/* Categorized deltas */}
            {grouped.map(group => {
              const Icon = group.icon
              return (
                <div key={group.key}>
                  <div className={clsx('flex items-center gap-1.5 mb-2', group.color)}>
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">{group.label}</span>
                  </div>
                  <div className="ml-5 space-y-0.5">
                    {group.deltas.map((d, i) => (
                      <DeltaRow key={`${d.field_key}-${i}`} delta={d} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
