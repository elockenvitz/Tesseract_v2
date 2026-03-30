import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight, Check, ChevronDown,
} from 'lucide-react'
import { Card } from '../../ui/Card'
import { supabase } from '../../../lib/supabase'
import type { NavigateHandler } from './portfolio-tab-types'
import { ProcessWalkthrough } from './ProcessWalkthrough'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProcessesTabProps {
  portfolio: any
  onNavigate?: NavigateHandler
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProcessesTab({ portfolio, onNavigate }: ProcessesTabProps) {
  const portfolioId: string = portfolio.id
  const [activeProcess, setActiveProcess] = useState<{ id: string; name: string; scopeType: 'portfolio' | 'general' } | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  // ── Query: All portfolio-level runs (active + completed) ──────

  const { data: portfolioRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ['portfolio-all-runs', portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_workflow_progress')
        .select(`
          id, workflow_id, is_completed, is_started, current_stage_key, completed_at, started_at,
          workflow:workflows!portfolio_workflow_progress_workflow_id_fkey(id, name, parent_workflow_id, scope_type, status, archived, deleted)
        `)
        .eq('portfolio_id', portfolioId)
      if (error) throw error

      // Deduplicate by workflow_id and filter to valid runs only
      const seen = new Set<string>()
      return (data || [])
        .map((r: any) => ({
          ...r,
          workflow: Array.isArray(r.workflow) ? r.workflow[0] : r.workflow,
        }))
        .filter((r: any) => {
          if (!r.workflow || !r.workflow.parent_workflow_id) return false // Only runs
          if (r.workflow.archived || r.workflow.deleted) return false // Skip archived/deleted
          if (seen.has(r.workflow_id)) return false // Deduplicate
          seen.add(r.workflow_id)
          return true
        })
    },
    enabled: !!portfolioId,
    staleTime: 30_000,
  })


  // ── Derived ───────────────────────────────────────────────────

  const activePortfolioRuns = portfolioRuns.filter((r: any) => !r.is_completed && r.workflow?.status === 'active')
  const completedPortfolioRuns = portfolioRuns.filter((r: any) => r.is_completed)


  // ── Loading ───────────────────────────────────────────────────

  if (runsLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-gray-200" />
          <div className="h-4 w-16 bg-gray-200 rounded" />
        </div>
        <div className="h-16 bg-gray-100 rounded-lg" />
        <div className="h-16 bg-gray-100 rounded-lg" />
      </div>
    )
  }

  // ── Walkthrough view ──────────────────────────────────────────

  if (activeProcess) {
    return (
      <ProcessWalkthrough
        workflowId={activeProcess.id}
        portfolioId={activeProcess.scopeType === 'portfolio' ? portfolioId : undefined}
        scopeType={activeProcess.scopeType}
        processName={activeProcess.name}
        onBack={() => setActiveProcess(null)}
      />
    )
  }

  // ── Empty state ───────────────────────────────────────────────

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Active Runs ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900">Active</h3>
          {activePortfolioRuns.length > 0 && (
            <span className="text-[11px] text-gray-400">{activePortfolioRuns.length}</span>
          )}
        </div>

        {activePortfolioRuns.length > 0 ? (
          <div className="space-y-2">
            {activePortfolioRuns.map((run: any) => (
              <button
                key={run.id}
                onClick={() => setActiveProcess({ id: run.workflow_id, name: run.workflow.name, scopeType: 'portfolio' })}
                className="w-full text-left px-3 py-3 rounded-lg border border-gray-200 hover:border-blue-300 bg-white transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-gray-900 truncate">{run.workflow.name}</span>
                    <p className="text-[11px] text-gray-400 mt-0.5">In progress</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-500 flex-shrink-0" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-gray-400 pl-4">No active processes</p>
        )}
      </div>

      {/* ── Completed Runs ───────────────────────────────────── */}
      {completedPortfolioRuns.length > 0 && (
        <div>
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex items-center gap-2 mb-3 hover:opacity-80"
          >
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            <h3 className="text-sm font-semibold text-gray-900">Completed</h3>
            <span className="text-[11px] text-gray-400">{completedPortfolioRuns.length}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showCompleted ? '' : '-rotate-90'}`} />
          </button>
          {showCompleted && (
            <div className="space-y-1.5">
              {completedPortfolioRuns.map((run: any) => (
                <button
                  key={run.id}
                  onClick={() => setActiveProcess({ id: run.workflow_id, name: run.workflow.name, scopeType: 'portfolio' })}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-100 bg-gray-50/50 transition-colors hover:border-gray-200 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-[13px] text-gray-600 truncate">{run.workflow.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {run.completed_at && (
                        <span className="text-[10px] text-gray-400">
                          {new Date(run.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
