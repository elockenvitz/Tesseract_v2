import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  RefreshCw, Calendar, Zap, Users, Globe, Briefcase,
  ChevronRight, Clock,
} from 'lucide-react'
import { Card } from '../../ui/Card'
import { format } from 'date-fns'
import { supabase } from '../../../lib/supabase'
import type { NavigateHandler } from './portfolio-tab-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortfolioWorkflow {
  id: string
  name: string
  description: string | null
  scope_type: 'asset' | 'portfolio' | 'general'
  cadence_timeframe: string | null
  color: string | null
  status: string | null
  // derived
  triggerLabel: string
  nextRun: string | null
  assignees: { id: string; first_name?: string; last_name?: string; email: string }[]
  assets: { id: string; symbol: string }[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCOPE_LABEL: Record<string, string> = {
  asset: 'Asset',
  portfolio: 'Portfolio',
  general: 'General',
}

const CADENCE_LABEL: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  'semi-annually': 'Semi-annually',
  annually: 'Annually',
  persistent: 'Persistent',
}

function deriveTriggerLabel(
  cadence: string | null,
  automationRules: { condition_type: string; rule_name: string; next_run_at: string | null }[],
): { label: string; nextRun: string | null } {
  // Prefer the first active time_interval rule
  const scheduled = automationRules.find(r => r.condition_type === 'time_interval')
  if (scheduled) {
    return {
      label: `${scheduled.rule_name} schedule`,
      nextRun: scheduled.next_run_at,
    }
  }
  // Fall back to cadence_timeframe
  if (cadence && CADENCE_LABEL[cadence]) {
    return { label: `${CADENCE_LABEL[cadence]} schedule`, nextRun: null }
  }
  // Event-driven triggers
  const eventRule = automationRules.find(r =>
    r.condition_type === 'on_branch_creation' || r.condition_type === 'time_after_creation',
  )
  if (eventRule) {
    return { label: 'Event-driven', nextRun: null }
  }
  return { label: 'Manual', nextRun: null }
}

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

  // ── Query: workflows linked to this portfolio ──────────────

  const { data: workflows, isLoading } = useQuery({
    queryKey: ['portfolio-workflows', portfolioId],
    enabled: !!portfolioId,
    staleTime: 60_000,
    queryFn: async () => {
      // 1. Find workflow IDs that reference this portfolio via universe rules
      const { data: rules } = await supabase
        .from('workflow_universe_rules')
        .select('workflow_id, rule_config')
        .eq('rule_type', 'portfolio')
        .eq('is_active', true)

      const ruleWorkflowIds = (rules || [])
        .filter((r: any) => {
          const cfg = typeof r.rule_config === 'string' ? JSON.parse(r.rule_config) : r.rule_config
          return cfg?.values?.includes(portfolioId)
        })
        .map((r: any) => r.workflow_id)

      // 2. Also check direct portfolio selections
      const { data: selections } = await supabase
        .from('workflow_portfolio_selections')
        .select('workflow_id')
        .eq('portfolio_id', portfolioId)

      const selectionIds = (selections || []).map((s: any) => s.workflow_id)

      // 3. Combine & dedupe
      const allIds = [...new Set([...ruleWorkflowIds, ...selectionIds])]
      if (allIds.length === 0) return []

      // 4. Fetch workflow templates (parent only, not branches)
      const { data: wfRows } = await supabase
        .from('workflows')
        .select('id, name, description, scope_type, cadence_timeframe, color, status')
        .in('id', allIds)
        .is('parent_workflow_id', null)
        .or('deleted.is.null,deleted.eq.false')

      if (!wfRows || wfRows.length === 0) return []

      const wfIds = wfRows.map(w => w.id)

      // 5. Parallel: automation rules, stakeholders, asset progress
      const [autoRes, stakeRes, progressRes] = await Promise.all([
        supabase
          .from('workflow_automation_rules')
          .select('workflow_id, condition_type, rule_name, next_run_at')
          .in('workflow_id', wfIds)
          .eq('is_active', true),

        supabase
          .from('workflow_stakeholders')
          .select('workflow_id, user_id')
          .in('workflow_id', wfIds),

        supabase
          .from('asset_workflow_progress')
          .select('workflow_id, asset_id')
          .in('workflow_id', wfIds)
          .eq('is_completed', false),
      ])

      // 6. Collect user & asset IDs for batch lookup
      const userIds = [...new Set((stakeRes.data || []).map((s: any) => s.user_id))]
      const assetIds = [...new Set((progressRes.data || []).map((p: any) => p.asset_id))]

      const [usersRes, assetsRes] = await Promise.all([
        userIds.length > 0
          ? supabase.from('users').select('id, first_name, last_name, email').in('id', userIds)
          : { data: [] as any[] },
        assetIds.length > 0
          ? supabase.from('assets').select('id, symbol').in('id', assetIds)
          : { data: [] as any[] },
      ])

      const userMap = new Map((usersRes.data || []).map((u: any) => [u.id, u]))
      const assetMap = new Map((assetsRes.data || []).map((a: any) => [a.id, a]))

      // 7. Group supplementary data by workflow
      const autoByWf = new Map<string, any[]>()
      for (const r of autoRes.data || []) {
        if (!autoByWf.has(r.workflow_id)) autoByWf.set(r.workflow_id, [])
        autoByWf.get(r.workflow_id)!.push(r)
      }

      const stakeByWf = new Map<string, string[]>()
      for (const s of stakeRes.data || []) {
        if (!stakeByWf.has(s.workflow_id)) stakeByWf.set(s.workflow_id, [])
        const list = stakeByWf.get(s.workflow_id)!
        if (!list.includes(s.user_id)) list.push(s.user_id)
      }

      const assetsByWf = new Map<string, string[]>()
      for (const p of progressRes.data || []) {
        if (!assetsByWf.has(p.workflow_id)) assetsByWf.set(p.workflow_id, [])
        const list = assetsByWf.get(p.workflow_id)!
        if (!list.includes(p.asset_id)) list.push(p.asset_id)
      }

      // 8. Assemble final objects
      return wfRows.map((w): PortfolioWorkflow => {
        const { label, nextRun } = deriveTriggerLabel(
          w.cadence_timeframe,
          autoByWf.get(w.id) || [],
        )
        return {
          id: w.id,
          name: w.name,
          description: w.description,
          scope_type: w.scope_type as PortfolioWorkflow['scope_type'],
          cadence_timeframe: w.cadence_timeframe,
          color: w.color,
          status: w.status,
          triggerLabel: label,
          nextRun,
          assignees: (stakeByWf.get(w.id) || []).map(uid => userMap.get(uid)).filter(Boolean),
          assets: (assetsByWf.get(w.id) || []).map(aid => assetMap.get(aid)).filter(Boolean),
        }
      })
    },
  })

  // ── Group by scope ─────────────────────────────────────────

  const grouped = useMemo(() => {
    if (!workflows || workflows.length === 0) return []
    const scopeOrder = ['portfolio', 'asset', 'general']
    const groups = new Map<string, PortfolioWorkflow[]>()
    for (const wf of workflows) {
      const key = wf.scope_type || 'general'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(wf)
    }
    return [...groups.entries()]
      .sort(([a], [b]) => scopeOrder.indexOf(a) - scopeOrder.indexOf(b))
      .map(([scope, items]) => ({ scope, items }))
  }, [workflows])

  // ── Loading ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900">Processes</h2>
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Card key={i} padding="sm">
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-3 bg-gray-200 rounded w-2/3" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────

  if (!workflows || workflows.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900">Processes</h2>
        <div className="text-center py-12">
          <RefreshCw className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No processes yet</h3>
          <p className="text-gray-500 text-sm">
            Recurring investment processes like earnings reviews, position reviews, and rebalancing will appear here.
          </p>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-gray-900">Processes</h2>

      {grouped.map(({ scope, items }) => (
        <div key={scope}>
          {/* Scope group header */}
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-gray-400">
              {scope === 'asset' ? 'Asset-Level' : scope === 'portfolio' ? 'Portfolio-Level' : 'General'}
            </h3>
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-[11px] text-gray-400 tabular-nums">{items.length}</span>
          </div>

          <div className="space-y-1.5">
            {items.map(wf => (
              <Card
                key={wf.id}
                padding="none"
                className="group/wf px-3 py-2.5 cursor-pointer hover:border-primary-200 transition-colors"
                onClick={() => onNavigate?.({
                  id: 'workflows',
                  title: 'Process',
                  type: 'workflows',
                  data: { id: wf.id },
                })}
              >
                {/* Row 1: Name + scope badge + chevron */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="text-[13px] font-semibold text-gray-900 truncate">{wf.name}</h4>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-semibold border shrink-0 ${
                      wf.scope_type === 'portfolio'
                        ? 'bg-violet-50 text-violet-700 border-violet-200/60'
                        : wf.scope_type === 'asset'
                          ? 'bg-blue-50 text-blue-700 border-blue-200/60'
                          : 'bg-gray-50 text-gray-600 border-gray-200/60'
                    }`}>
                      {wf.scope_type === 'portfolio' ? <Globe className="h-2.5 w-2.5" /> : <Briefcase className="h-2.5 w-2.5" />}
                      {SCOPE_LABEL[wf.scope_type] || wf.scope_type}
                    </span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-gray-300 group-hover/wf:text-gray-500 transition-colors shrink-0" />
                </div>

                {/* Row 2: Assets (asset-scope only) */}
                {wf.scope_type === 'asset' && wf.assets.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider shrink-0">Assets</span>
                    <div className="flex flex-wrap gap-1">
                      {wf.assets.slice(0, 8).map(a => (
                        <span
                          key={a.id}
                          className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-semibold bg-primary-50 text-primary-700 border border-primary-200/60"
                        >
                          {a.symbol}
                        </span>
                      ))}
                      {wf.assets.length > 8 && (
                        <span className="text-[10px] text-gray-400">+{wf.assets.length - 8} more</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Row 3: Trigger + next run + assignees */}
                <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    {wf.triggerLabel.includes('schedule') ? (
                      <Calendar className="h-3 w-3 text-gray-400" />
                    ) : (
                      <Zap className="h-3 w-3 text-gray-400" />
                    )}
                    {wf.triggerLabel}
                  </span>

                  {wf.nextRun && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3 text-gray-400" />
                      Next: {format(new Date(wf.nextRun), 'MMM d')}
                    </span>
                  )}

                  {wf.assignees.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3 text-gray-400" />
                      {wf.assignees.map(u => u.first_name || u.email.split('@')[0]).join(', ')}
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
