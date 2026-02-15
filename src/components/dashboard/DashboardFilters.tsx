/**
 * DashboardFilters — Integrated filter row for the Decision Engine Console.
 *
 * Portfolio selector, Coverage selector, Urgent-only toggle, Collapse All button.
 */

import { clsx } from 'clsx'
import { AlertTriangle, ChevronsDownUp } from 'lucide-react'
import type { DashboardScope, CoverageMode } from '../../hooks/useDashboardScope'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DashboardFiltersProps {
  scope: DashboardScope
  onScopeChange: (scope: DashboardScope) => void
  portfolios: { id: string; name: string }[]
  onCollapseAll?: () => void
}

const COVERAGE_LABELS: Record<CoverageMode, string> = {
  mine: 'My coverage',
  assigned: 'Assigned',
  visible: 'All visible',
}

export function DashboardFilters({
  scope,
  onScopeChange,
  portfolios,
  onCollapseAll,
}: DashboardFiltersProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-gray-50/80 dark:bg-gray-800/40 px-3 py-1.5">
      {/* Portfolio */}
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Portfolio
        </span>
        <select
          value={scope.portfolioId ?? ''}
          onChange={(e) =>
            onScopeChange({ ...scope, portfolioId: e.target.value || null })
          }
          className="text-[11px] bg-transparent border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="">All</option>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-600" />

      {/* Coverage */}
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Coverage
        </span>
        <select
          value={scope.coverageMode}
          onChange={(e) =>
            onScopeChange({ ...scope, coverageMode: e.target.value as CoverageMode })
          }
          className="text-[11px] bg-transparent border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          {Object.entries(COVERAGE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>

      <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-600" />

      {/* Urgent toggle */}
      <button
        onClick={() => onScopeChange({ ...scope, urgentOnly: !scope.urgentOnly })}
        className={clsx(
          'flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors',
          scope.urgentOnly
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
            : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700/40',
        )}
      >
        <AlertTriangle className="w-3 h-3" />
        Urgent
      </button>

      <div className="flex-1" />

      {/* Collapse All */}
      {onCollapseAll && (
        <button
          onClick={onCollapseAll}
          className="flex items-center gap-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/40 transition-colors"
        >
          <ChevronsDownUp className="w-3 h-3" />
          Collapse All
        </button>
      )}
    </div>
  )
}
