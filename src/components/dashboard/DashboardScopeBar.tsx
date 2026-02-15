/**
 * DashboardScopeBar — Compact horizontal filter bar for dashboard scope.
 *
 * Portfolio dropdown, coverage dropdown, urgent-only toggle.
 */

import { clsx } from 'clsx'
import { AlertTriangle } from 'lucide-react'
import type { DashboardScope, CoverageMode } from '../../hooks/useDashboardScope'

interface DashboardScopeBarProps {
  scope: DashboardScope
  onScopeChange: (scope: DashboardScope) => void
  portfolios: { id: string; name: string }[]
}

const COVERAGE_LABELS: Record<CoverageMode, string> = {
  mine: 'My coverage',
  assigned: 'Assigned',
  visible: 'All visible',
}

export function DashboardScopeBar({
  scope,
  onScopeChange,
  portfolios,
}: DashboardScopeBarProps) {
  return (
    <div className="flex items-center gap-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800/60 px-4 py-2">
      {/* Portfolio */}
      <label className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Portfolio</span>
        <select
          value={scope.portfolioId ?? ''}
          onChange={(e) =>
            onScopeChange({ ...scope, portfolioId: e.target.value || null })
          }
          className="text-[12px] bg-transparent border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="">All my portfolios</option>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {/* Divider */}
      <div className="w-px h-4 bg-gray-200 dark:bg-gray-600" />

      {/* Coverage */}
      <label className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Coverage</span>
        <select
          value={scope.coverageMode}
          onChange={(e) =>
            onScopeChange({ ...scope, coverageMode: e.target.value as CoverageMode })
          }
          className="text-[12px] bg-transparent border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          {Object.entries(COVERAGE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {/* Divider */}
      <div className="w-px h-4 bg-gray-200 dark:bg-gray-600" />

      {/* Urgent toggle */}
      <button
        onClick={() => onScopeChange({ ...scope, urgentOnly: !scope.urgentOnly })}
        className={clsx(
          'flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors',
          scope.urgentOnly
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/40',
        )}
      >
        <AlertTriangle className="w-3 h-3" />
        Urgent only
      </button>
    </div>
  )
}
