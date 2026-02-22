/**
 * RuleSection — vertical container for a category of scheduling rules.
 *
 * Layout:
 *   [step badge]  Section title (icon + text)       right-aligned summary
 *   └── Section container (border + radius)
 *       Subtitle (muted description)
 *       ────────────────────────────────────
 *       Rule row 1
 *       ────────────────────────────────────
 *       Rule row 2
 *       ────────────────────────────────────
 *       + Add … button
 *
 * The step badge + title sit above the container.
 * Rules sit inside a bordered card with thin dividers between rows.
 * Consistent border-radius and padding across all sections.
 */

import React from 'react'
import { Plus } from 'lucide-react'

export interface RuleSectionProps {
  step: number
  icon: React.ReactNode
  title: string
  subtitle: string
  summaryText: string
  addLabel: string
  canEdit: boolean
  isLoading: boolean
  ruleCount: number
  onAdd?: () => void
  children: React.ReactNode
}

export function RuleSection({
  step,
  icon,
  title,
  subtitle,
  summaryText,
  addLabel,
  canEdit,
  isLoading,
  ruleCount,
  onAdd,
  children,
}: RuleSectionProps) {
  return (
    <div role="region" aria-label={title}>
      {/* Section header — sits above the container */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {/* Step badge — w-5 anchors the left grid */}
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500 flex items-center justify-center">
            {step}
          </span>
          <div className="flex items-center gap-1.5">
            {icon}
            <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
          </div>
        </div>
        {summaryText && (
          <span className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">{summaryText}</span>
        )}
      </div>

      {/* Section container — bordered card holding subtitle + rules + add button */}
      <div className="ml-7 border border-gray-200 rounded-lg bg-white overflow-hidden">
        {/* Subtitle */}
        <p className="text-[11px] text-gray-500 px-3 py-2">{subtitle}</p>

        {/* Rule list */}
        {isLoading ? (
          <div className="border-t border-gray-100 text-center py-4">
            <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
          </div>
        ) : ruleCount > 0 ? (
          <div className="border-t border-gray-100 divide-y divide-gray-100" role="list">
            {children}
          </div>
        ) : (
          <div className="border-t border-gray-100 px-3 py-2.5">
            <p className="text-[11px] text-gray-400 italic">No rules configured</p>
          </div>
        )}

        {/* Add button — inside container, separated by border */}
        {canEdit && onAdd && (
          <div className="border-t border-gray-100 px-3 py-2">
            <button
              onClick={onAdd}
              className="flex items-center gap-1.5 text-[12px] font-medium text-blue-600 hover:text-blue-700 transition-colors py-1 px-2.5 rounded border border-dashed border-blue-200 hover:border-blue-400 hover:bg-blue-50/50 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
              aria-label={addLabel}
            >
              <Plus className="w-3.5 h-3.5" />
              {addLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
