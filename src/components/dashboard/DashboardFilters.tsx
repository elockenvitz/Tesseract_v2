/**
 * DashboardFilters — Integrated filter bar for the Decision Engine Console.
 *
 * Portfolio multi-select (grouped by team), Coverage selector, Urgent-only toggle.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, ChevronDown, Check, X } from 'lucide-react'
import type { DashboardScope, CoverageMode } from '../../hooks/useDashboardScope'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioOption {
  id: string
  name: string
  team_id: string | null
  teams: { id: string; name: string } | null
}

interface DashboardFiltersProps {
  scope: DashboardScope
  onScopeChange: (scope: DashboardScope) => void
  portfolios: PortfolioOption[]
}

// ---------------------------------------------------------------------------
// Coverage labels — "All visible" first
// ---------------------------------------------------------------------------

const COVERAGE_OPTIONS: { value: CoverageMode; label: string }[] = [
  { value: 'visible', label: 'All visible' },
  { value: 'mine', label: 'My coverage' },
  { value: 'assigned', label: 'Assigned' },
]

// ---------------------------------------------------------------------------
// Portfolio tree grouping
// ---------------------------------------------------------------------------

interface PortfolioGroup {
  teamId: string | null
  teamName: string
  portfolios: PortfolioOption[]
}

function buildPortfolioTree(portfolios: PortfolioOption[]): PortfolioGroup[] {
  const groups = new Map<string | null, PortfolioGroup>()

  for (const p of portfolios) {
    const teamId = p.team_id ?? null
    const teamName = p.teams?.name ?? 'Portfolios'
    if (!groups.has(teamId)) {
      groups.set(teamId, { teamId, teamName, portfolios: [] })
    }
    groups.get(teamId)!.portfolios.push(p)
  }

  // Sort groups: named teams first (alphabetical), then ungrouped
  const sorted = Array.from(groups.values()).sort((a, b) => {
    if (a.teamId === null && b.teamId !== null) return 1
    if (a.teamId !== null && b.teamId === null) return -1
    return a.teamName.localeCompare(b.teamName)
  })

  // Sort portfolios within each group
  for (const g of sorted) {
    g.portfolios.sort((a, b) => a.name.localeCompare(b.name))
  }

  return sorted
}

// ---------------------------------------------------------------------------
// Portfolio Multi-Select Dropdown
// ---------------------------------------------------------------------------

function PortfolioMultiSelect({
  portfolios,
  selectedIds,
  onChange,
}: {
  portfolios: PortfolioOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const tree = useMemo(() => buildPortfolioTree(portfolios), [portfolios])
  const hasMultipleGroups = tree.length > 1 || (tree.length === 1 && tree[0].teamId !== null)

  const togglePortfolio = useCallback((id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter(x => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }, [selectedIds, selectedSet, onChange])

  const toggleGroup = useCallback((group: PortfolioGroup) => {
    const groupIds = group.portfolios.map(p => p.id)
    const allSelected = groupIds.every(id => selectedSet.has(id))
    if (allSelected) {
      // Deselect all in group
      onChange(selectedIds.filter(id => !groupIds.includes(id)))
    } else {
      // Select all in group
      const newIds = new Set([...selectedIds, ...groupIds])
      onChange(Array.from(newIds))
    }
  }, [selectedIds, selectedSet, onChange])

  const clearAll = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }, [onChange])

  // Display label
  let displayLabel: string
  if (selectedIds.length === 0) {
    displayLabel = 'All portfolios'
  } else if (selectedIds.length === 1) {
    displayLabel = portfolios.find(p => p.id === selectedIds[0])?.name ?? '1 selected'
  } else {
    displayLabel = `${selectedIds.length} selected`
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex items-center gap-1.5 text-[12px] font-medium rounded-md pl-2.5 pr-2 py-1 transition-colors cursor-pointer',
          'border',
          selectedIds.length > 0
            ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800/40 text-primary-700 dark:text-primary-300'
            : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:border-gray-300 dark:hover:border-gray-500',
          open && 'ring-2 ring-primary-400/40 border-primary-400',
        )}
      >
        <span className="truncate max-w-[160px]">{displayLabel}</span>
        {selectedIds.length > 0 ? (
          <X
            className="w-3 h-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
            onClick={clearAll}
          />
        ) : (
          <ChevronDown className={clsx(
            'w-3 h-3 text-gray-400 dark:text-gray-500 shrink-0 transition-transform',
            open && 'rotate-180',
          )} />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-h-[320px] overflow-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
          {/* Select All / Clear */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
            <button
              onClick={() => onChange(portfolios.map(p => p.id))}
              className="text-[10px] font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700"
            >
              Select all
            </button>
            {selectedIds.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>

          {tree.map((group) => (
            <div key={group.teamId ?? '__ungrouped'}>
              {/* Team header — only show if there are actual team groups */}
              {hasMultipleGroups && (
                <button
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 border-b border-gray-50 dark:border-gray-700/50"
                >
                  <div className={clsx(
                    'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                    group.portfolios.every(p => selectedSet.has(p.id))
                      ? 'bg-primary-500 border-primary-500 text-white'
                      : group.portfolios.some(p => selectedSet.has(p.id))
                        ? 'bg-primary-100 border-primary-300 dark:bg-primary-900/30 dark:border-primary-700'
                        : 'border-gray-300 dark:border-gray-600',
                  )}>
                    {group.portfolios.every(p => selectedSet.has(p.id)) && (
                      <Check className="w-2.5 h-2.5" />
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {group.teamName}
                  </span>
                </button>
              )}

              {/* Portfolio items */}
              {group.portfolios.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePortfolio(p.id)}
                  className={clsx(
                    'w-full flex items-center gap-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors',
                    hasMultipleGroups ? 'px-5 py-1.5' : 'px-3 py-1.5',
                  )}
                >
                  <div className={clsx(
                    'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                    selectedSet.has(p.id)
                      ? 'bg-primary-500 border-primary-500 text-white'
                      : 'border-gray-300 dark:border-gray-600',
                  )}>
                    {selectedSet.has(p.id) && <Check className="w-2.5 h-2.5" />}
                  </div>
                  <span className="text-[12px] text-gray-700 dark:text-gray-200">
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardFilters({
  scope,
  onScopeChange,
  portfolios,
}: DashboardFiltersProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200/80 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 shadow-sm">
      {/* Portfolio multi-select */}
      <label className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Portfolio
        </span>
        <PortfolioMultiSelect
          portfolios={portfolios}
          selectedIds={scope.portfolioIds}
          onChange={(ids) => onScopeChange({ ...scope, portfolioIds: ids })}
        />
      </label>

      <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

      {/* Coverage */}
      <label className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Coverage
        </span>
        <div className="relative">
          <select
            value={scope.coverageMode}
            onChange={(e) =>
              onScopeChange({ ...scope, coverageMode: e.target.value as CoverageMode })
            }
            className="appearance-none text-[12px] font-medium bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-md pl-2.5 pr-6 py-1 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 transition-colors cursor-pointer hover:border-gray-300 dark:hover:border-gray-500"
          >
            {COVERAGE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-gray-500 pointer-events-none" />
        </div>
      </label>

      <div className="flex-1" />

      {/* Urgent toggle */}
      <button
        onClick={() => onScopeChange({ ...scope, urgentOnly: !scope.urgentOnly })}
        className={clsx(
          'flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-md transition-all',
          scope.urgentOnly
            ? 'bg-red-50 text-red-600 border border-red-200 shadow-sm dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/40'
            : 'text-gray-500 dark:text-gray-400 border border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/40 hover:border-gray-200 dark:hover:border-gray-600',
        )}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        Urgent only
      </button>
    </div>
  )
}
