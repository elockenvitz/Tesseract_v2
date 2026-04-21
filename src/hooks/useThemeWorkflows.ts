import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// =========================================================================
// Types
// =========================================================================

export interface ThemeWorkflowStage {
  stage_key: string
  stage_label: string | null
  stage_description: string | null
  stage_color: string | null
  stage_icon: string | null
  sort_order: number
  checklist_items: any[] | null
  standard_deadline_days: number | null
  completion_criteria: string | null
}

export interface ThemeWorkflowProgress {
  id: string
  theme_id: string
  workflow_id: string
  current_stage_key: string | null
  is_started: boolean
  is_completed: boolean
  started_at: string | null
  completed_at: string | null
  started_by: string | null
  completed_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface ThemeWorkflow {
  id: string
  name: string
  description: string | null
  color: string | null
  scope_type: 'theme' | 'general' | 'asset' | 'portfolio'
  cadence_timeframe: string | null
  parent_workflow_id: string | null
  is_public: boolean | null
  archived: boolean
  created_by: string | null
  created_at: string | null
  progress?: ThemeWorkflowProgress | null
  stages?: ThemeWorkflowStage[]
}

// =========================================================================
// Load stages for a workflow (branch-aware: templates store in workflow_stages,
// branches store in workflow_template_versions.stages JSON).
// =========================================================================

async function getWorkflowStages(workflowId: string): Promise<ThemeWorkflowStage[]> {
  const { data: w } = await supabase
    .from('workflows')
    .select('template_version_id, parent_workflow_id')
    .eq('id', workflowId)
    .maybeSingle()

  if (w?.parent_workflow_id && w?.template_version_id) {
    const { data: tv } = await supabase
      .from('workflow_template_versions')
      .select('stages')
      .eq('id', w.template_version_id)
      .maybeSingle()
    return ((tv?.stages as any[]) || []).map((s: any, i: number) => ({
      stage_key: s.stage_key,
      stage_label: s.stage_label ?? null,
      stage_description: s.stage_description ?? null,
      stage_color: s.stage_color ?? null,
      stage_icon: s.stage_icon ?? null,
      sort_order: typeof s.sort_order === 'number' ? s.sort_order : i,
      checklist_items: s.checklist_items ?? null,
      standard_deadline_days: s.standard_deadline_days ?? null,
      completion_criteria: s.completion_criteria ?? null,
    }))
  }

  const { data } = await supabase
    .from('workflow_stages')
    .select('stage_key, stage_label, stage_description, stage_color, stage_icon, sort_order, checklist_items, standard_deadline_days, completion_criteria')
    .eq('workflow_id', workflowId)
    .order('sort_order', { ascending: true })
  return (data || []) as ThemeWorkflowStage[]
}

// =========================================================================
// Active + available workflows for a theme
// =========================================================================

export function useThemeWorkflows(themeId: string | undefined) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const joined = useQuery({
    queryKey: ['theme-workflows-joined', themeId],
    enabled: !!themeId,
    queryFn: async (): Promise<ThemeWorkflow[]> => {
      const { data: progress, error } = await supabase
        .from('theme_workflow_progress')
        .select('*')
        .eq('theme_id', themeId!)
      if (error) throw error
      const rows = (progress || []) as ThemeWorkflowProgress[]
      if (rows.length === 0) return []

      const workflowIds = [...new Set(rows.map(r => r.workflow_id))]
      const { data: workflows, error: wErr } = await supabase
        .from('workflows')
        .select('id, name, description, color, scope_type, cadence_timeframe, parent_workflow_id, is_public, archived, created_by, created_at')
        .in('id', workflowIds)
      if (wErr) throw wErr

      const withStages = await Promise.all((workflows || []).map(async (w: any) => ({
        ...w,
        stages: await getWorkflowStages(w.id),
        progress: rows.find(r => r.workflow_id === w.id) || null,
      })) as Promise<ThemeWorkflow>[])

      return withStages
    }
  })

  // All theme-scoped workflows accessible to the user (for the "join" picker)
  const available = useQuery({
    queryKey: ['theme-workflows-available', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<ThemeWorkflow[]> => {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, name, description, color, scope_type, cadence_timeframe, parent_workflow_id, is_public, archived, created_by, created_at')
        .eq('scope_type', 'theme')
        .eq('archived', false)
        .is('parent_workflow_id', null) // templates only, not branches
        .order('name', { ascending: true })
      if (error) throw error
      return (data || []) as ThemeWorkflow[]
    }
  })

  // Partition: unjoined = available - joined
  const unjoined = useMemo<ThemeWorkflow[]>(() => {
    const joinedIds = new Set((joined.data || []).map(w => w.id))
    return (available.data || []).filter(w => !joinedIds.has(w.id))
  }, [joined.data, available.data])

  // Realtime
  useEffect(() => {
    if (!themeId) return
    const channel = supabase
      .channel(`theme-workflow-progress-${themeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'theme_workflow_progress', filter: `theme_id=eq.${themeId}` },
        () => queryClient.invalidateQueries({ queryKey: ['theme-workflows-joined', themeId] })
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [themeId, queryClient])

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['theme-workflows-joined', themeId] })
  }

  const joinWorkflow = useMutation({
    mutationFn: async (input: { workflowId: string; startImmediately?: boolean }) => {
      if (!themeId) throw new Error('Missing themeId')
      if (!user?.id) throw new Error('Not signed in')
      const stages = await getWorkflowStages(input.workflowId)
      const firstStage = stages[0]?.stage_key ?? null
      const now = new Date().toISOString()
      const payload = {
        theme_id: themeId,
        workflow_id: input.workflowId,
        current_stage_key: firstStage,
        is_started: !!input.startImmediately,
        is_completed: false,
        started_at: input.startImmediately ? now : null,
        started_by: input.startImmediately ? user.id : null,
        updated_by: user.id,
      }
      const { data, error } = await supabase
        .from('theme_workflow_progress')
        .upsert(payload, { onConflict: 'theme_id,workflow_id' })
        .select('*')
        .single()
      if (error) throw error
      return data as ThemeWorkflowProgress
    },
    onSuccess: invalidate,
  })

  const startWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      if (!themeId) throw new Error('Missing themeId')
      if (!user?.id) throw new Error('Not signed in')
      const { error } = await supabase
        .from('theme_workflow_progress')
        .update({
          is_started: true,
          started_at: new Date().toISOString(),
          started_by: user.id,
          updated_by: user.id,
          is_completed: false,
          completed_at: null,
          completed_by: null,
        })
        .eq('theme_id', themeId)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const setStage = useMutation({
    mutationFn: async ({ workflowId, stageKey }: { workflowId: string; stageKey: string }) => {
      if (!themeId) throw new Error('Missing themeId')
      if (!user?.id) throw new Error('Not signed in')
      const { error } = await supabase
        .from('theme_workflow_progress')
        .update({
          current_stage_key: stageKey,
          updated_by: user.id,
          is_completed: false,
          completed_at: null,
          completed_by: null,
        })
        .eq('theme_id', themeId)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const completeWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      if (!themeId) throw new Error('Missing themeId')
      if (!user?.id) throw new Error('Not signed in')
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('theme_workflow_progress')
        .update({
          is_completed: true,
          completed_at: now,
          completed_by: user.id,
          updated_by: user.id,
        })
        .eq('theme_id', themeId)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const restartWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      if (!themeId) throw new Error('Missing themeId')
      if (!user?.id) throw new Error('Not signed in')
      const stages = await getWorkflowStages(workflowId)
      const firstStage = stages[0]?.stage_key ?? null
      const { error } = await supabase
        .from('theme_workflow_progress')
        .update({
          current_stage_key: firstStage,
          is_started: true,
          started_at: new Date().toISOString(),
          started_by: user.id,
          is_completed: false,
          completed_at: null,
          completed_by: null,
          updated_by: user.id,
        })
        .eq('theme_id', themeId)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const removeWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      if (!themeId) throw new Error('Missing themeId')
      const { error } = await supabase
        .from('theme_workflow_progress')
        .delete()
        .eq('theme_id', themeId)
        .eq('workflow_id', workflowId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return {
    joined: joined.data || [],
    unjoined,
    isLoading: joined.isLoading || available.isLoading,
    isError: joined.isError || available.isError,
    joinWorkflow: joinWorkflow.mutateAsync,
    startWorkflow: startWorkflow.mutateAsync,
    setStage: setStage.mutateAsync,
    completeWorkflow: completeWorkflow.mutateAsync,
    restartWorkflow: restartWorkflow.mutateAsync,
    removeWorkflow: removeWorkflow.mutateAsync,
  }
}
