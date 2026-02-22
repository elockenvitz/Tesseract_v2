/**
 * RunStatusStrip
 *
 * Compact discipline strip shown between the process header and tabs.
 * Answers at a glance: "Is there an active run? What's remaining? What's next?"
 *
 * Uses existing data passed from WorkflowsPage — no new queries.
 */

import React from 'react'
import {
  Play,
  Clock,
  Calendar,
  Users,
  ChevronRight,
} from 'lucide-react'
import { safeRelativeTime, safeFutureRelativeTime, getRunVersionLabel } from '../../../utils/workflow/runHelpers'

interface ActiveRunInfo {
  id: string
  branch_suffix?: string
  branch_name?: string
  name?: string
  template_version_number?: string | number | null
  total_assets: number
  active_assets: number
  completed_assets: number
  created_at?: string
  branched_at?: string
}

interface ScheduleInfo {
  next_run_at: string | null
  rule_name: string
}

export interface RunStatusStripProps {
  /** The active run for this process, if any */
  activeRun: ActiveRunInfo | null
  /** Next scheduled run info from automation rules */
  schedule: ScheduleInfo | null
  /** Number of stakeholders notified */
  stakeholderCount: number
  /** Whether the process is archived */
  isArchived: boolean
  /** Called when user clicks the active run to view it */
  onViewRun?: () => void
}

export function RunStatusStrip({
  activeRun,
  schedule,
  stakeholderCount,
  isArchived,
  onViewRun,
}: RunStatusStripProps) {
  if (!activeRun) {
    // ─── No active run ───────────────────────────────────────────
    return (
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 transition-all duration-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-gray-400">
              <Play className="w-4 h-4" />
              <span className="text-sm font-medium">No active run</span>
            </div>
            {schedule?.next_run_at && (
              <div className="flex items-center space-x-1.5 text-xs text-gray-500 border-l border-gray-200 pl-4">
                <Calendar className="w-3.5 h-3.5" />
                <span>Next scheduled: {safeFutureRelativeTime(schedule.next_run_at)}</span>
              </div>
            )}
          </div>
          {/* Create Run CTA lives in the page header — not duplicated here */}
        </div>
      </div>
    )
  }

  // ─── Active run exists ───────────────────────────────────────
  const runLabel = activeRun.branch_suffix || activeRun.branch_name || activeRun.name || 'Current Run'
  const startedAt = activeRun.branched_at || activeRun.created_at
  const remaining = activeRun.active_assets
  const total = activeRun.total_assets
  const completed = activeRun.completed_assets
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  // Compute version label — handle both number and formatted string
  const versionLabel = typeof activeRun.template_version_number === 'string'
    ? `v${activeRun.template_version_number}`
    : getRunVersionLabel({ template_version_number: activeRun.template_version_number as number | null })

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-2.5 transition-all duration-200">
      <div className="flex items-center justify-between">
        {/* Left: active run identity + metrics */}
        <div className="flex items-center space-x-5">
          {/* Run identity */}
          <button
            onClick={onViewRun}
            className="flex items-center space-x-2 hover:bg-gray-50 rounded px-2 py-1 -mx-2 transition-colors group"
          >
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
              {runLabel}
            </span>
            <span
              className="text-[10px] font-medium px-1.5 py-0 rounded bg-gray-100 text-gray-500 leading-4"
              title={`Process definition ${versionLabel}`}
            >
              {versionLabel}
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
          </button>

          {/* Divider */}
          <div className="h-5 w-px bg-gray-200" />

          {/* Remaining */}
          <div className="flex items-center space-x-3">
            {total > 0 ? (
              <>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                    {remaining}
                  </span>
                  <span className="text-xs text-gray-500">remaining</span>
                </div>
                <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400">{completed}/{total}</span>
              </>
            ) : (
              <span className="text-xs text-gray-400">0 assets assigned</span>
            )}
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-gray-200" />

          {/* Started */}
          <div className="flex items-center space-x-1.5 text-xs text-gray-500">
            <Clock className="w-3.5 h-3.5" />
            <span>{safeRelativeTime(startedAt)}</span>
          </div>

          {/* Schedule */}
          {schedule?.next_run_at && (
            <>
              <div className="h-5 w-px bg-gray-200" />
              <div className="flex items-center space-x-1.5 text-xs text-gray-500">
                <Calendar className="w-3.5 h-3.5" />
                <span>Next: {safeFutureRelativeTime(schedule.next_run_at)}</span>
              </div>
            </>
          )}

          {/* Stakeholders */}
          {stakeholderCount > 0 && (
            <>
              <div className="h-5 w-px bg-gray-200" />
              <div className="flex items-center space-x-1.5 text-xs text-gray-500" title="Stakeholders notified on run events">
                <Users className="w-3.5 h-3.5" />
                <span>{stakeholderCount}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
