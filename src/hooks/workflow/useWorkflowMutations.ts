/**
 * useWorkflowMutations Hook
 *
 * Consolidates all mutation operations for the WorkflowsPage component.
 * Extracted from WorkflowsPage.tsx during refactoring to reduce complexity.
 *
 * This hook manages all data modification operations including:
 * - Workflow CRUD operations
 * - Stage management
 * - Checklist item management
 * - Universe rules management
 * - Branch operations
 * - Collaborator/stakeholder management
 * - Access requests
 * - Template versions
 *
 * All mutations include proper query invalidation and optimistic updates where appropriate.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

interface UseWorkflowMutationsParams {
  userId?: string
  onSuccess?: (message: string) => void
  onError?: (error: any) => void
}

export function useWorkflowMutations({
  userId,
  onSuccess,
  onError
}: UseWorkflowMutationsParams = {}) {
  const queryClient = useQueryClient()

  // ======================
  // WORKFLOW OPERATIONS
  // ======================

  const createWorkflow = useMutation({
    mutationFn: async (data: {
      name: string
      description: string
      color: string
      is_public: boolean
      cadence_days: number
    }) => {
      const { data: workflow, error } = await supabase
        .from('workflows')
        .insert({
          ...data,
          created_by: userId
        })
        .select()
        .single()

      if (error) throw error
      return workflow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onSuccess?.('Workflow created successfully')
    },
    onError
  })

  const updateWorkflow = useMutation({
    mutationFn: async (data: {
      id: string
      name?: string
      description?: string
      color?: string
    }) => {
      const { id, ...updates } = data
      const { error } = await supabase
        .from('workflows')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onSuccess?.('Workflow updated successfully')
    },
    onError
  })

  const duplicateWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      const { data, error } = await supabase.rpc('copy_workflow_with_unique_name', {
        source_workflow_id: workflowId,
        suffix: 'Copy',
        target_user_id: userId
      })

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onSuccess?.('Workflow duplicated successfully')
    },
    onError
  })

  const archiveWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userId
        })
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      queryClient.invalidateQueries({ queryKey: ['archived-workflows'] })
      onSuccess?.('Workflow archived successfully')
    },
    onError
  })

  const unarchiveWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          archived: false,
          archived_at: null,
          archived_by: null
        })
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      queryClient.invalidateQueries({ queryKey: ['archived-workflows'] })
      onSuccess?.('Workflow restored successfully')
    },
    onError
  })

  const deleteWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: userId
        })
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onSuccess?.('Workflow deleted successfully')
    },
    onError
  })

  const restoreDeletedWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          deleted: false,
          deleted_at: null,
          deleted_by: null
        })
        .eq('id', workflowId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onSuccess?.('Workflow restored successfully')
    },
    onError
  })

  const toggleFavorite = useMutation({
    mutationFn: async (data: { workflowId: string; isFavorited: boolean }) => {
      if (data.isFavorited) {
        const { error } = await supabase
          .from('workflow_favorites')
          .delete()
          .eq('workflow_id', data.workflowId)
          .eq('user_id', userId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('workflow_favorites')
          .insert({
            workflow_id: data.workflowId,
            user_id: userId
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
    onError
  })

  // ======================
  // STAGE OPERATIONS
  // ======================

  const addStage = useMutation({
    mutationFn: async (data: {
      workflow_id: string
      stage_key: string
      stage_label: string
      stage_description?: string
      stage_color?: string
      stage_icon?: string
      sort_order: number
      standard_deadline_days?: number
      suggested_priorities?: string[]
    }) => {
      const { data: stage, error } = await supabase
        .from('workflow_stages')
        .insert(data)
        .select()
        .single()

      if (error) throw error
      return stage
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      onSuccess?.('Stage added successfully')
    },
    onError
  })

  const updateStage = useMutation({
    mutationFn: async (data: {
      id: string
      stage_label?: string
      stage_description?: string
      stage_color?: string
      stage_icon?: string
      standard_deadline_days?: number
      suggested_priorities?: string[]
    }) => {
      const { id, ...updates } = data
      const { error } = await supabase
        .from('workflow_stages')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      onSuccess?.('Stage updated successfully')
    },
    onError
  })

  const deleteStage = useMutation({
    mutationFn: async (stageId: string) => {
      const { error } = await supabase
        .from('workflow_stages')
        .delete()
        .eq('id', stageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      onSuccess?.('Stage deleted successfully')
    },
    onError
  })

  const reorderStages = useMutation({
    mutationFn: async (stages: Array<{ id: string; sort_order: number }>) => {
      const promises = stages.map(stage =>
        supabase
          .from('workflow_stages')
          .update({ sort_order: stage.sort_order })
          .eq('id', stage.id)
      )

      const results = await Promise.all(promises)
      const error = results.find(r => r.error)?.error
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stages'] })
      onSuccess?.('Stages reordered successfully')
    },
    onError
  })

  // ======================
  // CHECKLIST OPERATIONS
  // ======================

  const addChecklistItem = useMutation({
    mutationFn: async (data: {
      workflow_id: string
      stage_id: string
      item_id: string
      item_text: string
      item_description?: string
      sort_order: number
    }) => {
      const { data: item, error } = await supabase
        .from('workflow_checklist_templates')
        .insert(data)
        .select()
        .single()

      if (error) throw error
      return item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
      onSuccess?.('Checklist item added successfully')
    },
    onError
  })

  const updateChecklistItem = useMutation({
    mutationFn: async (data: {
      id: string
      item_text?: string
      item_description?: string
    }) => {
      const { id, ...updates } = data
      const { error } = await supabase
        .from('workflow_checklist_templates')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
      onSuccess?.('Checklist item updated successfully')
    },
    onError
  })

  const deleteChecklistItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('workflow_checklist_templates')
        .delete()
        .eq('id', itemId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
      onSuccess?.('Checklist item deleted successfully')
    },
    onError
  })

  const reorderChecklistItems = useMutation({
    mutationFn: async (items: Array<{ id: string; sort_order: number }>) => {
      const promises = items.map(item =>
        supabase
          .from('workflow_checklist_templates')
          .update({ sort_order: item.sort_order })
          .eq('id', item.id)
      )

      const results = await Promise.all(promises)
      const error = results.find(r => r.error)?.error
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-checklist-templates'] })
      onSuccess?.('Checklist items reordered successfully')
    },
    onError
  })

  // ======================
  // UNIVERSE RULE OPERATIONS
  // ======================

  const addRule = useMutation({
    mutationFn: async (data: {
      workflow_id: string
      rule_type: string
      rule_config: any
      rule_name: string
      combine_with?: 'AND' | 'OR'
    }) => {
      const { data: rule, error } = await supabase
        .from('workflow_universe_rules')
        .insert(data)
        .select()
        .single()

      if (error) throw error
      return rule
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-rules', variables.workflow_id] })
      onSuccess?.('Rule added successfully')
    },
    onError
  })

  const updateRule = useMutation({
    mutationFn: async (data: {
      id: string
      rule_config?: any
      rule_name?: string
      combine_with?: 'AND' | 'OR'
    }) => {
      const { id, ...updates } = data
      const { error } = await supabase
        .from('workflow_universe_rules')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-rules'] })
      onSuccess?.('Rule updated successfully')
    },
    onError
  })

  const deleteRule = useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase
        .from('workflow_universe_rules')
        .delete()
        .eq('id', ruleId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-rules'] })
      onSuccess?.('Rule deleted successfully')
    },
    onError
  })

  const saveUniverse = useMutation({
    mutationFn: async (data: {
      workflow_id: string
      rules: any[]
    }) => {
      // This would call a stored procedure to update all rules atomically
      const { error } = await supabase.rpc('update_workflow_universe', {
        p_workflow_id: data.workflow_id,
        p_rules: data.rules
      })

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-rules', variables.workflow_id] })
      onSuccess?.('Universe configuration saved successfully')
    },
    onError
  })

  // ======================
  // BRANCH OPERATIONS
  // ======================

  const createBranch = useMutation({
    mutationFn: async (data: {
      workflow_id: string
      branch_suffix?: string
      source_branch_id?: string
    }) => {
      const { data: branch, error } = await supabase.rpc('create_workflow_branch', {
        p_template_id: data.workflow_id,
        p_branch_suffix: data.branch_suffix,
        p_source_branch_id: data.source_branch_id,
        p_user_id: userId
      })

      if (error) throw error
      return branch
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches', variables.workflow_id] })
      queryClient.invalidateQueries({ queryKey: ['all-workflow-branches', variables.workflow_id] })
      onSuccess?.('Branch created successfully')
    },
    onError
  })

  const closeBranch = useMutation({
    mutationFn: async (branchId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({ status: 'inactive' })
        .eq('id', branchId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      onSuccess?.('Branch closed successfully')
    },
    onError
  })

  const continueBranch = useMutation({
    mutationFn: async (branchId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({ status: 'active' })
        .eq('id', branchId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      onSuccess?.('Branch reopened successfully')
    },
    onError
  })

  const archiveBranch = useMutation({
    mutationFn: async (branchId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          archived: true,
          archived_at: new Date().toISOString()
        })
        .eq('id', branchId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      onSuccess?.('Branch archived successfully')
    },
    onError
  })

  const unarchiveBranch = useMutation({
    mutationFn: async (branchId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          archived: false,
          archived_at: null
        })
        .eq('id', branchId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      onSuccess?.('Branch unarchived successfully')
    },
    onError
  })

  const deleteBranch = useMutation({
    mutationFn: async (branchId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          deleted: true,
          deleted_at: new Date().toISOString()
        })
        .eq('id', branchId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      onSuccess?.('Branch deleted successfully')
    },
    onError
  })

  const restoreBranch = useMutation({
    mutationFn: async (branchId: string) => {
      const { error } = await supabase
        .from('workflows')
        .update({
          deleted: false,
          deleted_at: null
        })
        .eq('id', branchId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      onSuccess?.('Branch restored successfully')
    },
    onError
  })

  const updateBranchSuffix = useMutation({
    mutationFn: async (data: { branchId: string; suffix: string }) => {
      const { error } = await supabase
        .from('workflows')
        .update({ branch_suffix: data.suffix })
        .eq('id', data.branchId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-branches'] })
      onSuccess?.('Branch suffix updated successfully')
    },
    onError
  })

  // ======================
  // COLLABORATION OPERATIONS
  // ======================

  const updateCollaborator = useMutation({
    mutationFn: async (data: {
      id: string
      permission: 'read' | 'write' | 'admin'
    }) => {
      const { error } = await supabase
        .from('workflow_collaborators')
        .update({ permission: data.permission })
        .eq('id', data.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborators'] })
      onSuccess?.('Collaborator permission updated successfully')
    },
    onError
  })

  const removeCollaborator = useMutation({
    mutationFn: async (collaboratorId: string) => {
      const { error } = await supabase
        .from('workflow_collaborators')
        .delete()
        .eq('id', collaboratorId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborators'] })
      onSuccess?.('Collaborator removed successfully')
    },
    onError
  })

  const addStakeholder = useMutation({
    mutationFn: async (data: {
      workflow_id: string
      user_id: string
    }) => {
      const { data: stakeholder, error } = await supabase
        .from('workflow_stakeholders')
        .insert(data)
        .select()
        .single()

      if (error) throw error
      return stakeholder
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stakeholders'] })
      onSuccess?.('Stakeholder added successfully')
    },
    onError
  })

  const removeStakeholder = useMutation({
    mutationFn: async (stakeholderId: string) => {
      const { error } = await supabase
        .from('workflow_stakeholders')
        .delete()
        .eq('id', stakeholderId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-stakeholders'] })
      onSuccess?.('Stakeholder removed successfully')
    },
    onError
  })

  const requestAccess = useMutation({
    mutationFn: async (data: {
      workflow_id: string
      requested_permission: 'write' | 'admin'
      reason?: string
    }) => {
      const { data: request, error } = await supabase
        .from('workflow_access_requests')
        .insert({
          ...data,
          user_id: userId,
          status: 'pending'
        })
        .select()
        .single()

      if (error) throw error
      return request
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-access-requests'] })
      onSuccess?.('Access request submitted successfully')
    },
    onError
  })

  const approveAccessRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc('approve_workflow_access_request', {
        p_request_id: requestId,
        p_approver_id: userId
      })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-access-requests'] })
      queryClient.invalidateQueries({ queryKey: ['workflow-collaborators'] })
      onSuccess?.('Access request approved successfully')
    },
    onError
  })

  const rejectAccessRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('workflow_access_requests')
        .update({ status: 'rejected' })
        .eq('id', requestId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-access-requests'] })
      onSuccess?.('Access request rejected')
    },
    onError
  })

  // ======================
  // TEMPLATE VERSION OPERATIONS
  // ======================

  const createVersion = useMutation({
    mutationFn: async (data: {
      template_id: string
      version_name: string
      version_type: 'major' | 'minor'
      changes_summary?: string
    }) => {
      const { data: version, error } = await supabase.rpc('create_workflow_version', {
        p_template_id: data.template_id,
        p_version_name: data.version_name,
        p_version_type: data.version_type,
        p_changes_summary: data.changes_summary,
        p_user_id: userId
      })

      if (error) throw error
      return version
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-versions'] })
      onSuccess?.('Version created successfully')
    },
    onError
  })

  const activateVersion = useMutation({
    mutationFn: async (data: {
      template_id: string
      version_id: string
    }) => {
      const { error } = await supabase.rpc('activate_workflow_version', {
        p_template_id: data.template_id,
        p_version_id: data.version_id
      })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-versions'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onSuccess?.('Version activated successfully')
    },
    onError
  })

  const uploadTemplate = useMutation({
    mutationFn: async (data: {
      name: string
      description: string
      template_json: any
    }) => {
      const { data: template, error } = await supabase.rpc('import_workflow_template', {
        p_name: data.name,
        p_description: data.description,
        p_template_json: data.template_json,
        p_user_id: userId
      })

      if (error) throw error
      return template
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onSuccess?.('Template uploaded successfully')
    },
    onError
  })

  const deleteTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from('workflows')
        .delete()
        .eq('id', templateId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      onSuccess?.('Template deleted successfully')
    },
    onError
  })

  return {
    // Workflow operations
    createWorkflow,
    updateWorkflow,
    duplicateWorkflow,
    archiveWorkflow,
    unarchiveWorkflow,
    deleteWorkflow,
    restoreDeletedWorkflow,
    toggleFavorite,

    // Stage operations
    addStage,
    updateStage,
    deleteStage,
    reorderStages,

    // Checklist operations
    addChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
    reorderChecklistItems,

    // Universe rule operations
    addRule,
    updateRule,
    deleteRule,
    saveUniverse,

    // Branch operations
    createBranch,
    closeBranch,
    continueBranch,
    archiveBranch,
    unarchiveBranch,
    deleteBranch,
    restoreBranch,
    updateBranchSuffix,

    // Collaboration operations
    updateCollaborator,
    removeCollaborator,
    addStakeholder,
    removeStakeholder,
    requestAccess,
    approveAccessRequest,
    rejectAccessRequest,

    // Template version operations
    createVersion,
    activateVersion,
    uploadTemplate,
    deleteTemplate,
  }
}
