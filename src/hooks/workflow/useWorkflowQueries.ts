/**
 * useWorkflowQueries Hook
 *
 * Consolidates data fetching queries for the WorkflowsPage component.
 * Extracted from WorkflowsPage.tsx during refactoring to reduce complexity.
 *
 * This hook manages all React Query data fetching for workflows including:
 * - Main workflows list (active, archived)
 * - Workflow stages and checklist templates
 * - Universe rules and automation
 * - Collaborators and stakeholders
 * - Branch management
 * - Template versions
 *
 * Note: Modal-specific queries (user search, etc.) remain in their respective modal components
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface UseWorkflowQueriesParams {
  userId?: string
  selectedWorkflowId?: string | null
  selectedBranchId?: string | null
  branchStatusFilter?: 'all' | 'archived' | 'deleted'
}

export function useWorkflowQueries({
  userId,
  selectedWorkflowId,
  selectedBranchId,
  branchStatusFilter = 'all'
}: UseWorkflowQueriesParams) {

  // Main workflows query
  const workflowsQuery = useQuery({
    queryKey: ['workflows', userId],
    queryFn: async () => {
      if (!userId) return []

      const { data, error } = await supabase
        .from('workflows')
        .select(`
          *,
          creator:created_by(email, first_name, last_name),
          favorites:workflow_favorites(id),
          collaborators:workflow_collaborators(id, user_id, permission)
        `)
        .or(`created_by.eq.${userId},is_public.eq.true,collaborators.user_id.eq.${userId}`)
        .is('parent_workflow_id', null)
        .order('name')

      if (error) {
        console.error('Error fetching workflows:', error)
        throw error
      }

      return data || []
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Archived workflows query
  const archivedWorkflowsQuery = useQuery({
    queryKey: ['archived-workflows', userId],
    queryFn: async () => {
      if (!userId) return []

      const { data, error } = await supabase
        .from('workflows')
        .select(`
          *,
          creator:created_by(email, first_name, last_name)
        `)
        .eq('created_by', userId)
        .eq('archived', true)
        .is('parent_workflow_id', null)
        .order('archived_at', { ascending: false })

      if (error) {
        console.error('Error fetching archived workflows:', error)
        throw error
      }

      return data || []
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  })

  // Workflow stages query
  const workflowStagesQuery = useQuery({
    queryKey: ['workflow-stages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_stages')
        .select('*')
        .order('workflow_id')
        .order('sort_order')

      if (error) {
        console.error('Error fetching workflow stages:', error)
        throw error
      }

      return data || []
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  })

  // Workflow checklist templates query
  const checklistTemplatesQuery = useQuery({
    queryKey: ['workflow-checklist-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_checklist_templates')
        .select('*')
        .order('workflow_id')
        .order('stage_id')
        .order('sort_order')

      if (error) {
        console.error('Error fetching checklist templates:', error)
        throw error
      }

      return data || []
    },
    staleTime: 1000 * 60 * 10,
  })

  // Automation rules query
  const automationRulesQuery = useQuery({
    queryKey: ['workflow-automation-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_automation_rules')
        .select('*')
        .order('workflow_id')
        .order('rule_name')

      if (error) {
        console.error('Error fetching automation rules:', error)
        throw error
      }

      return data || []
    },
    staleTime: 1000 * 60 * 10,
  })

  // Universe rules query (for selected workflow)
  const universeRulesQuery = useQuery({
    queryKey: ['workflow-universe-rules', selectedWorkflowId],
    queryFn: async () => {
      if (!selectedWorkflowId) return []

      const { data, error } = await supabase
        .from('workflow_universe_rules')
        .select('*')
        .eq('workflow_id', selectedWorkflowId)
        .order('created_at')

      if (error) {
        console.error('Error fetching universe rules:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflowId,
    staleTime: 1000 * 60 * 5,
  })

  // Workflow collaborators query
  const collaboratorsQuery = useQuery({
    queryKey: ['workflow-collaborators', selectedWorkflowId],
    queryFn: async () => {
      if (!selectedWorkflowId) return []

      const { data, error } = await supabase
        .from('workflow_collaborators')
        .select(`
          *,
          user:users(id, email, first_name, last_name)
        `)
        .eq('workflow_id', selectedWorkflowId)
        .order('created_at')

      if (error) {
        console.error('Error fetching collaborators:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflowId,
    staleTime: 1000 * 60 * 5,
  })

  // Workflow stakeholders query
  const stakeholdersQuery = useQuery({
    queryKey: ['workflow-stakeholders', selectedWorkflowId],
    queryFn: async () => {
      if (!selectedWorkflowId) return []

      const { data, error } = await supabase
        .from('workflow_stakeholders')
        .select(`
          *,
          user:users(id, email, first_name, last_name)
        `)
        .eq('workflow_id', selectedWorkflowId)
        .order('created_at')

      if (error) {
        console.error('Error fetching stakeholders:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflowId,
    staleTime: 1000 * 60 * 5,
  })

  // Pending access requests query
  const accessRequestsQuery = useQuery({
    queryKey: ['workflow-access-requests', selectedWorkflowId],
    queryFn: async () => {
      if (!selectedWorkflowId) return []

      const { data, error } = await supabase
        .from('workflow_access_requests')
        .select(`
          *,
          user:users(id, email, first_name, last_name)
        `)
        .eq('workflow_id', selectedWorkflowId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching access requests:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflowId,
    staleTime: 1000 * 60 * 2,
  })

  // Workflow branches query
  const branchesQuery = useQuery({
    queryKey: ['workflow-branches', selectedWorkflowId, branchStatusFilter],
    queryFn: async () => {
      if (!selectedWorkflowId) return []

      let branchQuery = supabase
        .from('workflows')
        .select(`
          id,
          name,
          parent_workflow_id,
          source_branch_id,
          branch_suffix,
          branched_at,
          created_at,
          cadence_timeframe,
          kickoff_cadence,
          auto_create_branch,
          status,
          archived,
          archived_at,
          deleted,
          deleted_at,
          template_version_id,
          template_version_number
        `)
        .eq('parent_workflow_id', selectedWorkflowId)
        .order('created_at', { ascending: false })

      if (branchStatusFilter === 'archived') {
        branchQuery = branchQuery.eq('archived', true)
      } else if (branchStatusFilter === 'deleted') {
        branchQuery = branchQuery.eq('deleted', true)
      } else {
        branchQuery = branchQuery.eq('archived', false).eq('deleted', false)
      }

      const { data, error } = await branchQuery

      if (error) {
        console.error('Error fetching branches:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflowId,
    staleTime: 1000 * 60 * 2,
  })

  // All workflow branches (for hierarchy)
  const allBranchesQuery = useQuery({
    queryKey: ['all-workflow-branches', selectedWorkflowId],
    queryFn: async () => {
      if (!selectedWorkflowId) return []

      const { data, error } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          parent_workflow_id,
          source_branch_id,
          branch_suffix,
          branched_at,
          created_at,
          archived,
          deleted,
          template_version_id,
          template_version_number
        `)
        .eq('parent_workflow_id', selectedWorkflowId)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching all branches:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflowId,
    staleTime: 1000 * 60 * 5,
  })

  // Selected branch assets query
  const branchAssetsQuery = useQuery({
    queryKey: ['branch-assets', selectedBranchId],
    queryFn: async () => {
      if (!selectedBranchId) return null

      const { data: progressRecords, error: progressError } = await supabase
        .from('asset_workflow_progress')
        .select('*')
        .eq('workflow_id', selectedBranchId)

      if (progressError) {
        console.error('Error fetching branch progress:', progressError)
        return null
      }

      // Categorize assets by their origin and status
      const inherited = progressRecords?.filter(p => p.inherited_from_parent) || []
      const ruleBased = progressRecords?.filter(p => p.added_by_rule && !p.inherited_from_parent) || []
      const manuallyAdded = progressRecords?.filter(p => !p.added_by_rule && !p.inherited_from_parent) || []
      const deleted = progressRecords?.filter(p => p.deleted) || []
      const completed = progressRecords?.filter(p => p.is_completed && !p.deleted) || []
      const active = progressRecords?.filter(p => !p.is_completed && !p.deleted) || []

      return {
        all: progressRecords || [],
        inherited,
        ruleBased,
        manuallyAdded,
        deleted,
        completed,
        active
      }
    },
    enabled: !!selectedBranchId,
    staleTime: 1000 * 60 * 2,
  })

  // Template versions query
  const templateVersionsQuery = useQuery({
    queryKey: ['template-versions', selectedWorkflowId],
    queryFn: async () => {
      if (!selectedWorkflowId) return []

      const { data, error } = await supabase
        .from('workflow_template_versions')
        .select('*')
        .eq('template_id', selectedWorkflowId)
        .order('version_number', { ascending: false })

      if (error) {
        console.error('Error fetching template versions:', error)
        throw error
      }

      return data || []
    },
    enabled: !!selectedWorkflowId,
    staleTime: 1000 * 60 * 5,
  })

  // Asset lists query (for universe rules)
  const assetListsQuery = useQuery({
    queryKey: ['asset-lists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_lists')
        .select('id, name, description')
        .order('name')

      if (error) {
        console.error('Error fetching asset lists:', error)
        throw error
      }

      return data || []
    },
    staleTime: 1000 * 60 * 10,
  })

  // Themes query (for universe rules)
  const themesQuery = useQuery({
    queryKey: ['themes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investment_themes')
        .select('id, name, description')
        .order('name')

      if (error) {
        console.error('Error fetching themes:', error)
        throw error
      }

      return data || []
    },
    staleTime: 1000 * 60 * 10,
  })

  // Analysts query (for universe rules)
  const analystsQuery = useQuery({
    queryKey: ['analysts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('email')

      if (error) {
        console.error('Error fetching analysts:', error)
        throw error
      }

      return data || []
    },
    staleTime: 1000 * 60 * 10,
  })

  return {
    // Main data
    workflows: workflowsQuery.data,
    isLoadingWorkflows: workflowsQuery.isLoading,
    workflowsError: workflowsQuery.error,
    refetchWorkflows: workflowsQuery.refetch,

    // Archived workflows
    archivedWorkflows: archivedWorkflowsQuery.data,
    isLoadingArchived: archivedWorkflowsQuery.isLoading,

    // Workflow structure
    workflowStages: workflowStagesQuery.data,
    checklistTemplates: checklistTemplatesQuery.data,
    automationRules: automationRulesQuery.data,

    // Universe configuration
    universeRules: universeRulesQuery.data,
    refetchUniverseRules: universeRulesQuery.refetch,
    assetLists: assetListsQuery.data,
    themes: themesQuery.data,
    analysts: analystsQuery.data,

    // Collaboration
    collaborators: collaboratorsQuery.data,
    refetchCollaborators: collaboratorsQuery.refetch,
    stakeholders: stakeholdersQuery.data,
    refetchStakeholders: stakeholdersQuery.refetch,
    accessRequests: accessRequestsQuery.data,
    refetchAccessRequests: accessRequestsQuery.refetch,

    // Branch management
    branches: branchesQuery.data,
    isLoadingBranches: branchesQuery.isLoading,
    allBranches: allBranchesQuery.data,
    branchAssets: branchAssetsQuery.data,

    // Template versions
    templateVersions: templateVersionsQuery.data,
    refetchVersions: templateVersionsQuery.refetch,
  }
}
