/**
 * ProcessWalkthrough
 *
 * Inline stage walkthrough for portfolio-level and standalone processes.
 * Shows stages as a horizontal stepper, checklist items per stage,
 * and allows advancing through stages.
 */

import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check, ChevronRight, ChevronDown, ChevronLeft, ArrowLeft, Info, Plus,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { Card } from '../../ui/Card'
import { DecisionItemCard } from '../../ui/checklist/DecisionItemCard'
import { OperationalItemCard } from '../../ui/checklist/OperationalItemCard'
import type { ChecklistItemData } from '../../ui/checklist/types'

// ─── Types ─────────────────────────────────────────────────────────

interface WorkflowStage {
  stage_key: string
  stage_label: string
  stage_color?: string
  sort_order: number
  checklist?: { id: string; text: string; type?: string }[]
}

interface ProcessWalkthroughProps {
  workflowId: string
  /** For portfolio-level: the portfolio whose progress we're viewing */
  portfolioId?: string
  /** 'portfolio' | 'general' */
  scopeType: 'portfolio' | 'general'
  onBack: () => void
  processName: string
  /** When true, hides the header (used when parent already shows process name) */
  embedded?: boolean
}

// ─── Component ─────────────────────────────────────────────────────

export function ProcessWalkthrough({
  workflowId,
  portfolioId: portfolioIdProp,
  scopeType,
  onBack,
  processName,
  embedded = false,
}: ProcessWalkthroughProps) {
  const { user: currentUser } = useAuth()
  const qc = useQueryClient()
  const [viewingStageIdx, setViewingStageIdx] = useState<number | null>(null)
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(portfolioIdProp || null)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  // Resolve template → active run. If workflowId is a template (no parent), find its active branch.
  const { data: resolvedWorkflowId } = useQuery({
    queryKey: ['resolve-active-run', workflowId],
    queryFn: async () => {
      // Check if this is already a branch
      const { data: wf } = await supabase
        .from('workflows')
        .select('id, parent_workflow_id')
        .eq('id', workflowId)
        .single()
      if (wf?.parent_workflow_id) return workflowId // Already a branch

      // It's a template — find the active branch
      const { data: branches } = await supabase
        .from('workflows')
        .select('id')
        .eq('parent_workflow_id', workflowId)
        .eq('status', 'active')
        .or('archived.is.null,archived.eq.false')
        .or('deleted.is.null,deleted.eq.false')
        .order('created_at', { ascending: false })
        .limit(1)
      return branches?.[0]?.id || workflowId // Fall back to template if no active run
    },
    enabled: !!workflowId,
    staleTime: 60_000,
  })

  const effectiveWorkflowId = resolvedWorkflowId || workflowId

  // For portfolio-scoped processes without a pre-set portfolio, load the list
  const { data: portfoliosInProcess = [] } = useQuery({
    queryKey: ['process-portfolios', effectiveWorkflowId],
    queryFn: async () => {
      // Check portfolio_workflow_progress for active portfolios in this process
      const { data: progress } = await supabase
        .from('portfolio_workflow_progress')
        .select('portfolio_id, is_completed, current_stage_key, portfolio:portfolios!portfolio_workflow_progress_portfolio_id_fkey(id, name)')
        .eq('workflow_id', effectiveWorkflowId)
      if (progress && progress.length > 0) {
        return progress.map((p: any) => ({
          id: p.portfolio_id,
          name: Array.isArray(p.portfolio) ? p.portfolio[0]?.name : p.portfolio?.name || 'Unknown',
          isCompleted: p.is_completed,
          currentStage: p.current_stage_key,
        }))
      }
      // Fall back to template selections
      const { data: selections } = await supabase
        .from('workflow_portfolio_selections')
        .select('portfolio_id, portfolio:portfolios!workflow_portfolio_selections_portfolio_id_fkey(id, name)')
        .eq('workflow_id', workflowId)
      return (selections || []).map((s: any) => ({
        id: s.portfolio_id,
        name: Array.isArray(s.portfolio) ? s.portfolio[0]?.name : s.portfolio?.name || 'Unknown',
        isCompleted: false,
        currentStage: null,
      }))
    },
    enabled: scopeType === 'portfolio' && !portfolioIdProp && !!effectiveWorkflowId,
    staleTime: 30_000,
  })

  const portfolioId = portfolioIdProp || selectedPortfolioId || undefined

  const showPortfolioPicker = scopeType === 'portfolio' && !portfolioIdProp && !selectedPortfolioId

  // ── Load workflow stages ──────────────────────────────────────

  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['process-walkthrough-stages', effectiveWorkflowId],
    queryFn: async () => {
      // Check if this is a branch with template version
      const { data: wf } = await supabase
        .from('workflows')
        .select('id, parent_workflow_id, template_version_id')
        .eq('id', effectiveWorkflowId)
        .single()

      if (wf?.parent_workflow_id && wf?.template_version_id) {
        const { data: tv } = await supabase
          .from('workflow_template_versions')
          .select('stages')
          .eq('id', wf.template_version_id)
          .single()
        return ((tv?.stages || []) as any[]).map((s: any) => ({
          stage_key: s.key || s.stage_key,
          stage_label: s.name || s.stage_label,
          stage_color: s.color || s.stage_color,
          sort_order: s.order_index ?? s.sort_order ?? 0,
          checklist: s.checklist_items || s.checklist || [],
        })).sort((a: WorkflowStage, b: WorkflowStage) => a.sort_order - b.sort_order)
      }

      // Template — load from workflow_stages
      const { data } = await supabase
        .from('workflow_stages')
        .select('*')
        .eq('workflow_id', effectiveWorkflowId)
        .order('sort_order')
      return (data || []).map((s: any) => ({
        stage_key: s.stage_key,
        stage_label: s.stage_label,
        stage_color: s.stage_color,
        sort_order: s.sort_order,
        checklist: s.checklist_items || [],
      })) as WorkflowStage[]
    },
    enabled: !!effectiveWorkflowId,
    staleTime: 60_000,
  })

  // ── Load progress ─────────────────────────────────────────────

  const progressTable = scopeType === 'portfolio' ? 'portfolio_workflow_progress' : 'general_workflow_progress'
  const progressKey = ['process-walkthrough-progress', effectiveWorkflowId, portfolioId || 'general']

  const { data: progress } = useQuery({
    queryKey: progressKey,
    queryFn: async () => {
      let q = supabase.from(progressTable).select('*').eq('workflow_id', effectiveWorkflowId)
      if (scopeType === 'portfolio' && portfolioId) {
        q = q.eq('portfolio_id', portfolioId)
      }
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!effectiveWorkflowId,
    staleTime: 30_000,
  })

  // ── Load checklist items ──────────────────────────────────────

  const checklistTable = scopeType === 'portfolio' ? 'portfolio_checklist_items' : 'general_checklist_items'
  const checklistKey = ['process-walkthrough-checklist', effectiveWorkflowId, portfolioId || 'general']

  const { data: checklistItems = [] } = useQuery({
    queryKey: checklistKey,
    queryFn: async () => {
      let q = supabase.from(checklistTable).select('*').eq('workflow_id', effectiveWorkflowId).order('sort_order')
      if (scopeType === 'portfolio' && portfolioId) {
        q = q.eq('portfolio_id', portfolioId)
      }
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    enabled: !!effectiveWorkflowId,
    staleTime: 30_000,
  })

  // ── Derived state ─────────────────────────────────────────────

  const currentStageKey = progress?.current_stage_key
  const isCompleted = progress?.is_completed ?? false
  const currentStageIndex = isCompleted ? stages.length : stages.findIndex(s => s.stage_key === currentStageKey)
  const activeIdx = viewingStageIdx ?? currentStageIndex
  const activeStage = activeIdx < stages.length ? stages[activeIdx] : undefined

  const itemsByStage = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const item of checklistItems) {
      const list = map.get(item.stage_id) || []
      list.push(item)
      map.set(item.stage_id, list)
    }
    return map
  }, [checklistItems])

  // If no checklist items exist yet, initialize from template
  const activeStageItems = activeStage ? (itemsByStage.get(activeStage.stage_key) || []) : []
  const templateItems = activeStage?.checklist || []
  const needsInit = activeStageItems.length === 0 && templateItems.length > 0

  // ── Load commentaries for completed summary ───────────────────

  const allItemDbIds = checklistItems.filter((i: any) => i.item_type === 'thinking').map((i: any) => i.id)
  const { data: allCommentariesForSummary = [] } = useQuery({
    queryKey: ['process-walkthrough-commentaries', effectiveWorkflowId, portfolioId || 'general'],
    queryFn: async () => {
      if (allItemDbIds.length === 0) return []
      const { data, error } = await supabase
        .from('checklist_item_comments')
        .select('checklist_item_id, comment_text, signal_type, user_id, created_at, user:users!checklist_item_comments_user_id_fkey(id, first_name, last_name, email)')
        .in('checklist_item_id', allItemDbIds)
        .eq('signal_type', 'commentary')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: allItemDbIds.length > 0 && (isCompleted || (viewingStageIdx !== null && viewingStageIdx === stages.length)),
    staleTime: 30_000,
  })

  // ── Initialize checklist from template ────────────────────────

  const initChecklistM = useMutation({
    mutationFn: async (stage: WorkflowStage) => {
      if (!currentUser || !stage.checklist || stage.checklist.length === 0) return
      const rows = stage.checklist.map((item: any, idx: number) => ({
        ...(scopeType === 'portfolio' && portfolioId ? { portfolio_id: portfolioId } : {}),
        workflow_id: effectiveWorkflowId,
        stage_id: stage.stage_key,
        item_id: item.id || `item_${idx}`,
        item_text: item.text,
        item_type: item.item_type || item.type || 'operational',
        sort_order: idx,
      }))
      const { error } = await supabase.from(checklistTable).upsert(rows, {
        onConflict: scopeType === 'portfolio' ? 'portfolio_id,workflow_id,stage_id,item_id' : 'workflow_id,stage_id,item_id',
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: checklistKey }),
  })

  // Auto-init when viewing a stage with template items but no DB items
  React.useEffect(() => {
    if (needsInit && activeStage && !initChecklistM.isPending) {
      initChecklistM.mutate(activeStage)
    }
  }, [needsInit, activeStage?.stage_key])

  // ── Toggle checklist item ─────────────────────────────────────

  // Cycle: unchecked → completed → na → unchecked (matches InvestmentTimeline)
  const handleToggleItem = (item: any) => {
    const currentStatus = item.status || (item.completed ? 'completed' : 'unchecked')
    let newStatus: 'unchecked' | 'completed' | 'na'
    if (currentStatus === 'unchecked') newStatus = 'completed'
    else if (currentStatus === 'completed') newStatus = 'na'
    else newStatus = 'unchecked'

    const isDone = newStatus === 'completed' || newStatus === 'na'
    toggleItemM.mutate({
      itemId: item.id,
      status: newStatus,
      completed: newStatus === 'completed',
      completedAt: isDone ? new Date().toISOString() : null,
      completedBy: isDone ? currentUser?.id || null : null,
    })
  }

  const toggleItemM = useMutation({
    mutationFn: async ({ itemId, status, completed, completedAt, completedBy }: {
      itemId: string; status: string; completed: boolean; completedAt: string | null; completedBy: string | null
    }) => {
      const { error } = await supabase.from(checklistTable).update({
        completed,
        completed_at: completedAt,
        completed_by: completedBy,
        status,
        updated_at: new Date().toISOString(),
      }).eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: checklistKey }),
  })

  // ── Advance stage ─────────────────────────────────────────────

  const advanceM = useMutation({
    mutationFn: async () => {
      const nextIdx = currentStageIndex + 1
      let q;
      if (nextIdx >= stages.length) {
        q = supabase.from(progressTable).update({
          is_completed: true, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('workflow_id', effectiveWorkflowId)
      } else {
        q = supabase.from(progressTable).update({
          current_stage_key: stages[nextIdx].stage_key, updated_at: new Date().toISOString(),
        }).eq('workflow_id', effectiveWorkflowId)
      }
      // Scope to this portfolio only
      if (scopeType === 'portfolio' && portfolioId) {
        q = q.eq('portfolio_id', portfolioId)
      }
      const { error } = await q
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: progressKey })
      qc.invalidateQueries({ queryKey: ['active-runs'] })
      qc.invalidateQueries({ queryKey: ['portfolio-all-runs'] })
      setViewingStageIdx(null)
    },
  })

  // ── Init progress if missing ──────────────────────────────────

  const initProgressM = useMutation({
    mutationFn: async () => {
      if (!stages.length) return
      const row: any = {
        workflow_id: effectiveWorkflowId,
        current_stage_key: stages[0].stage_key,
        is_started: true,
        started_at: new Date().toISOString(),
        is_completed: false,
      }
      if (scopeType === 'portfolio' && portfolioId) row.portfolio_id = portfolioId
      const { error } = await supabase.from(progressTable).upsert(row, {
        onConflict: scopeType === 'portfolio' ? 'portfolio_id,workflow_id' : 'workflow_id',
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: progressKey }),
  })

  // Add "Completed" pseudo-stage to timeline display (must be before any early returns)
  const timelineStages = useMemo(() => [
    ...stages,
    { stage_key: 'completed', stage_label: 'Completed', stage_color: '#10b981', sort_order: 999, checklist: [] },
  ], [stages])

  const currentItems = activeStage ? (itemsByStage.get(activeStage.stage_key) || []) : []
  const allComplete = currentItems.length > 0 ? currentItems.every((i: any) => i.completed) : true
  const isViewingCurrent = activeIdx === currentStageIndex
  const isViewingCompleted = activeIdx === stages.length

  const getStageStatus = (idx: number) => {
    if (idx === stages.length) return isCompleted ? 'completed' : 'future'
    if (isCompleted) return 'completed'
    if (idx < currentStageIndex) return 'completed'
    if (idx === currentStageIndex) return 'current'
    return 'future'
  }

  // ── Portfolio picker ──────────────────────────────────────────

  if (showPortfolioPicker) {
    return (
      <div className="space-y-4">
        {!embedded && (
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h3 className="text-[15px] font-semibold text-gray-900">{processName}</h3>
          </div>
        )}
        <p className="text-[12px] text-gray-500">Select a portfolio to view its progress.</p>
        <div className="space-y-1.5">
          {portfoliosInProcess.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPortfolioId(p.id)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:border-gray-300 bg-white transition-colors text-left"
            >
              <div>
                <span className="text-[13px] font-medium text-gray-900">{p.name}</span>
                {p.currentStage && <span className="text-[11px] text-gray-400 ml-2">{p.currentStage}</span>}
              </div>
              <div className="flex items-center gap-2">
                {p.isCompleted && <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Complete</span>}
                <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
              </div>
            </button>
          ))}
          {portfoliosInProcess.length === 0 && (
            <p className="text-[12px] text-gray-400 text-center py-6">No portfolios assigned to this process.</p>
          )}
        </div>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────

  if (stagesLoading || !resolvedWorkflowId) {
    return (
      <div className="space-y-6 animate-pulse">
        <Card><div className="h-[130px] bg-gray-50 rounded" /></Card>
        <Card><div className="h-[200px] bg-gray-50 rounded" /></Card>
      </div>
    )
  }

  if (stages.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-400">This process has no stages defined.</p>
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-700 mt-2">Back</button>
      </div>
    )
  }

  // (timelineStages, currentItems, etc. defined above early returns)

  return (
    <div className="space-y-6">
      {/* Header — only in non-embedded mode */}
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={() => {
            if (!portfolioIdProp && scopeType === 'portfolio') {
              setSelectedPortfolioId(null)
              setViewingStageIdx(null)
            } else {
              onBack()
            }
          }} className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold text-gray-900 truncate">{processName}</h3>
          </div>
        </div>
      )}

      {/* Chevron Timeline — matches InvestmentTimeline */}
      <Card>
        <div className="py-6 px-8">
          <div className="flex items-center gap-0.5 w-full">
            {timelineStages.map((stage, idx) => {
              const status = getStageStatus(idx)
              const isFirst = idx === 0
              const isLast = idx === timelineStages.length - 1
              const isSelected = activeIdx === idx

              const stageItems = itemsByStage.get(stage.stage_key) || []
              const completedCount = stageItems.filter((i: any) => i.completed).length
              const totalCount = stageItems.length
              const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

              const colorSchemes: Record<string, { bg: string; text: string; accent: string; progressTrack: string; progressFill: string }> = {
                completed: { bg: 'bg-emerald-500', text: 'text-white', accent: 'text-emerald-50', progressTrack: 'bg-emerald-700/30', progressFill: 'bg-white' },
                current: { bg: 'bg-gradient-to-br from-blue-600 to-indigo-600', text: 'text-white', accent: 'text-blue-50', progressTrack: 'bg-white/20', progressFill: 'bg-white' },
                future: { bg: 'bg-slate-100', text: 'text-slate-700', accent: 'text-slate-500', progressTrack: 'bg-slate-200', progressFill: 'bg-slate-500' },
              }
              const colors = colorSchemes[status]
              const chevronArrowSize = '34px'

              return (
                <div key={stage.stage_key} className="relative flex items-center transition-all duration-300 flex-1 min-w-0" style={{ flexBasis: 0 }}>
                  {isSelected && (
                    <div className="absolute pointer-events-none z-[2]" style={{
                      top: '-5px', left: '-5px', right: '-5px', bottom: '-5px',
                      background: 'linear-gradient(135deg, rgba(147, 197, 253, 0.9), rgba(96, 165, 250, 0.7))',
                      clipPath: isLast
                        ? isFirst ? 'none' : `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, ${chevronArrowSize} 50%)`
                        : isFirst
                          ? `polygon(0% 0%, calc(100% - ${chevronArrowSize}) 0%, 100% 50%, calc(100% - ${chevronArrowSize}) 100%, 0% 100%)`
                          : `polygon(0% 0%, calc(100% - ${chevronArrowSize}) 0%, 100% 50%, calc(100% - ${chevronArrowSize}) 100%, 0% 100%, ${chevronArrowSize} 50%)`,
                      filter: 'blur(3px)',
                    }} />
                  )}
                  <button
                    onClick={() => setViewingStageIdx(idx)}
                    className={`relative w-full py-5 px-6 transition-all duration-300 min-w-0 ${colors.bg} ${colors.text} ${isSelected ? 'z-[3]' : 'shadow-lg hover:shadow-xl hover:z-[2]'} ${isFirst ? 'rounded-l-xl' : ''} ${isLast ? 'rounded-r-xl' : ''}`}
                    style={{
                      clipPath: isLast
                        ? isFirst ? 'none' : `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, ${chevronArrowSize} 50%)`
                        : isFirst
                          ? `polygon(0% 0%, calc(100% - ${chevronArrowSize}) 0%, 100% 50%, calc(100% - ${chevronArrowSize}) 100%, 0% 100%)`
                          : `polygon(0% 0%, calc(100% - ${chevronArrowSize}) 0%, 100% 50%, calc(100% - ${chevronArrowSize}) 100%, 0% 100%, ${chevronArrowSize} 50%)`,
                    }}
                  >
                    <div className="relative z-10 space-y-2.5 min-h-[85px] flex flex-col justify-center min-w-0 w-full" style={{ marginLeft: isFirst ? '0' : '16px' }}>
                      <div className="flex items-center min-w-0">
                        <div className="relative flex items-center justify-center w-7 h-7 rounded-md bg-black/15 text-sm font-bold flex-shrink-0 mr-2">
                          {idx + 1}
                          {status === 'completed' && (
                            <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white rounded-full flex items-center justify-center shadow-sm">
                              <Check className="w-3 h-3 text-green-600" strokeWidth={3} />
                            </div>
                          )}
                          {status === 'current' && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white rounded-full animate-pulse shadow-sm" />}
                        </div>
                        <h4 className="text-base font-semibold leading-tight truncate min-w-0">{stage.stage_label}</h4>
                      </div>
                      {totalCount > 0 ? (
                        <div className="space-y-1.5 pr-8">
                          <div className={`h-1.5 ${colors.progressTrack} rounded-full overflow-hidden`}>
                            <div className={`h-full ${colors.progressFill} rounded-full transition-all duration-500`} style={{ width: `${progressPercent}%` }} />
                          </div>
                          <div className={`flex items-center justify-between text-xs font-semibold ${colors.accent}`}>
                            <span className="truncate mr-2">{completedCount}/{totalCount} tasks</span>
                            <span className="flex-shrink-0">{Math.round(progressPercent)}%</span>
                          </div>
                        </div>
                      ) : (
                        <div className="h-[34px]" />
                      )}
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      {/* No progress yet — start button */}
      {!progress && !isCompleted && (
        <Card>
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 mb-3">This process hasn't been started yet.</p>
            <button
              onClick={() => initProgressM.mutate()}
              disabled={initProgressM.isPending}
              className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800"
            >
              Start Process
            </button>
          </div>
        </Card>
      )}

      {/* Stage Details Card — matches InvestmentTimeline */}
      {progress && activeStage && !isViewingCompleted && (
        <Card className="transition-all duration-300 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                getStageStatus(activeIdx) === 'completed' ? 'bg-emerald-500' : 'bg-gradient-to-br from-blue-600 to-indigo-600'
              }`}>
                {getStageStatus(activeIdx) === 'completed' ? (
                  <Check className="w-5 h-5 text-white" />
                ) : (
                  <Info className="w-5 h-5 text-white" />
                )}
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900">{activeStage.stage_label} Stage</h4>
                <p className="text-sm text-gray-600">
                  {currentItems.length > 0
                    ? `${currentItems.filter((i: any) => i.completed).length} of ${currentItems.length} items completed`
                    : 'No checklist items'}
                </p>
              </div>
            </div>
          </div>

          {/* Checklist — full card components matching asset page */}
          <div>
            {currentItems.length === 0 && !needsInit ? (
              <p className="text-[12px] text-gray-400 py-4 text-center">No checklist items for this stage.</p>
            ) : (
              <div className="space-y-1.5">
                {currentItems.map((item: any) => {
                  const cardItem: ChecklistItemData = {
                    id: item.item_id || item.id,
                    text: item.item_text || item.item_id,
                    completed: item.completed,
                    status: item.status || (item.completed ? 'completed' : 'unchecked'),
                    completedAt: item.completed_at,
                    completedBy: item.completed_by,
                    dbId: item.id,
                    item_type: item.item_type || 'operational',
                    takeaway: item.takeaway,
                  }
                  const cardProps = {
                    item: cardItem,
                    stageId: activeStage!.stage_key,
                    assetId: portfolioId || '',
                    workflowId: effectiveWorkflowId,
                    isEditable: true,
                    isExpanded: expandedItemId === item.id,
                    onToggleExpand: () => setExpandedItemId(expandedItemId === item.id ? null : item.id),
                    onToggleStatus: () => handleToggleItem(item),
                    currentUser: currentUser,
                    scopeType: 'portfolio' as const,
                  }
                  return (item.item_type || 'operational') === 'thinking'
                    ? <DecisionItemCard key={item.id} {...cardProps} />
                    : <OperationalItemCard key={item.id} {...cardProps} />
                })}
              </div>
            )}
          </div>

          {/* Advance button — only when viewing current stage */}
          {isViewingCurrent && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {allComplete && currentItems.length > 0
                  ? 'All items complete'
                  : currentItems.length > 0
                    ? `${currentItems.filter((i: any) => i.completed).length} of ${currentItems.length} items completed`
                    : ''}
              </span>
              <button
                onClick={() => advanceM.mutate()}
                disabled={!allComplete || advanceM.isPending}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  allComplete
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {currentStageIndex + 1 >= stages.length ? 'Complete Process ✓' : 'Advance Stage →'}
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Completed stage summary — shown when clicking completed chevron or when process is done */}
      {(isViewingCompleted || (isCompleted && !activeStage)) && (() => {
        // Group commentaries by checklist_item_id
        const commentaryByItem = new Map<string, any[]>()
        for (const c of allCommentariesForSummary) {
          const list = commentaryByItem.get(c.checklist_item_id) || []
          list.push(c)
          commentaryByItem.set(c.checklist_item_id, list)
        }

        // Build findings: items with commentary, grouped by stage
        const findings = stages.flatMap(stage =>
          (itemsByStage.get(stage.stage_key) || [])
            .filter((i: any) => i.item_type === 'thinking' && commentaryByItem.has(i.id))
            .map((i: any) => ({ item: i, stageLabel: stage.stage_label, entries: commentaryByItem.get(i.id) || [] }))
        )

        const totalDone = checklistItems.filter((i: any) => i.completed || i.status === 'na').length
        const totalSkipped = checklistItems.filter((i: any) => i.status === 'na').length

        return (
          <Card className="transition-all duration-300 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center">
                  <Check className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">Completed</h4>
                  <p className="text-sm text-gray-600">
                    {totalDone} completed{totalSkipped > 0 ? ` · ${totalSkipped} skipped` : ''} across {stages.length} stages
                  </p>
                </div>
              </div>
            </div>

            {/* Key Findings — commentary entries */}
            {findings.length > 0 ? (
              <div>
                <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2.5">Key Findings</h4>
                <div className="space-y-4">
                  {findings.map(({ item: fi, stageLabel, entries }) => (
                    <div key={fi.id}>
                      <p className="text-[11px] font-medium text-gray-500 mb-1">{fi.item_text} <span className="text-gray-400 font-normal">· {stageLabel}</span></p>
                      <div className="space-y-1.5 pl-2 border-l-2 border-gray-100">
                        {entries.map((entry: any) => {
                          const u = Array.isArray(entry.user) ? entry.user[0] : entry.user
                          return (
                            <div key={`${entry.checklist_item_id}-${entry.user_id}`}>
                              <p className="text-[13px] text-gray-800 leading-relaxed">{entry.comment_text}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5">{u?.first_name || u?.email?.split('@')[0] || 'Unknown'}</p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-gray-400">No commentary was captured during this process.</p>
            )}
          </Card>
        )
      })()}
    </div>
  )
}
