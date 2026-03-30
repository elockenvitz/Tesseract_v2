/**
 * RuleRow — compact, single-line rule display for the scheduling rule builder.
 *
 * Layout (fixed column order):
 *   [status pill]  Name  ·  summary text           [meta]  [edit] [delete] [⋯]
 *
 * Sits inside a RuleSection container — no per-row border/radius.
 * Rows are separated by thin dividers from the parent divide-y container.
 * Status pill doubles as toggle. Actions show on hover, always keyboard accessible.
 */

import React, { useState } from 'react'
import {
  Edit3, Trash2, MoreHorizontal, Calendar, AlertTriangle,
} from 'lucide-react'

export interface RuleRowProps {
  id: string
  name: string
  triggerIcon?: React.ReactNode // deprecated — no longer rendered
  summary: string
  status: { label: string; className: string; icon: React.ReactNode }
  canEdit: boolean
  isActive: boolean
  lastRunText?: string
  lastRunIcon?: React.ReactNode
  nextRunText?: string
  scheduleWarning?: string
  runCount?: number
  onEdit?: () => void
  onDelete?: () => void
  onToggleActive?: () => void
}

export function RuleRow({
  id,
  name,
  triggerIcon,
  summary,
  status,
  canEdit,
  isActive,
  lastRunText,
  lastRunIcon,
  nextRunText,
  scheduleWarning,
  runCount,
  onEdit,
  onDelete,
  onToggleActive,
}: RuleRowProps) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 transition-colors group ${
        !isActive
          ? 'bg-gray-50/60 opacity-55'
          : 'hover:bg-gray-50/40'
      }`}
      role="listitem"
      aria-label={`Rule: ${name}`}
    >
      {/* Col 1: status pill + name (line 1) + summary (line 2) */}
      <div className="flex items-start gap-1.5 flex-1 min-w-0">
        {/* Status pill — leading position, doubles as toggle for editors */}
        <div className="mt-0.5 shrink-0">
          {canEdit && onToggleActive ? (
            <button
              onClick={onToggleActive}
              className={`inline-flex items-center gap-0.5 h-[18px] px-1.5 rounded-full text-[10px] font-medium leading-none border cursor-pointer transition-all hover:shadow-sm focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-blue-400 ${status.className}`}
              title={isActive ? 'Click to disable' : 'Click to enable'}
              aria-label={`Toggle rule: currently ${status.label}`}
            >
              {status.icon}
              {status.label}
            </button>
          ) : (
            <span className={`inline-flex items-center gap-0.5 h-[18px] px-1.5 rounded-full text-[10px] font-medium leading-none border ${status.className}`}>
              {status.icon}
              {status.label}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gray-900 truncate">{name}</div>
          <div className="text-[11px] text-gray-400 truncate leading-tight">{summary}</div>
        </div>
      </div>

      {/* Col 2: meta (fixed) */}
      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 tabular-nums flex-shrink-0">
        {lastRunText && (
          <span className="flex items-center gap-0.5" title={`Last: ${lastRunText}`}>
            {lastRunIcon}
            <span>{lastRunText}</span>
          </span>
        )}
        {nextRunText && (
          <span className="flex items-center gap-0.5" title={`Next: ${nextRunText}`}>
            <Calendar className="w-2.5 h-2.5" />
            <span>{nextRunText}</span>
          </span>
        )}
        {scheduleWarning && (
          <span className="text-amber-500" title={scheduleWarning} tabIndex={0} aria-label={scheduleWarning}>
            <AlertTriangle className="w-2.5 h-2.5" />
          </span>
        )}
        {(runCount ?? 0) > 0 && <span>{runCount}&times;</span>}
      </div>

      {/* Col 4: actions */}
      {canEdit && (
        <div className="flex items-center gap-px flex-shrink-0">
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1 hover:bg-gray-100 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400"
              title="Edit rule"
              aria-label="Edit rule"
            >
              <Edit3 className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1 hover:bg-red-50 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-red-400"
              title="Delete rule"
              aria-label="Delete rule"
            >
              <Trash2 className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}

          {/* Overflow menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 hover:bg-gray-100 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400"
              title="More actions"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-3.5 h-3.5 text-gray-400" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-30">
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-400 cursor-not-allowed" disabled>
                    Duplicate
                  </button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-400 cursor-not-allowed" disabled>
                    View logs
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
