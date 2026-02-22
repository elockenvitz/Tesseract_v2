/**
 * useActiveRuns Hook
 *
 * Fetches all runs (child workflow branches) that the user has access to,
 * enriched with asset progress counts and parent process state.
 * Returns ALL runs (active, ended, archived) so the UI can do client-side
 * filtering. The default "active" filter is applied in
 * RecurringProcessesHomePanel, not here.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { getRunStartedAt } from '../../utils/workflow/runHelpers'

export type WorkflowScopeType = 'asset' | 'portfolio' | 'general'

export interface ActiveRun {
  id: string
  name: string
  branch_suffix: string | null
  parent_workflow_id: string
  parent_name: string
  parent_color: string | null
  cadence_timeframe: string | null
  branched_at: string | null
  created_at: string | null
  /** Best available "started" date (branched_at || created_at) */
  started_at_display: string | null
  status: string
  archived: boolean
  deleted: boolean
  /** Scope type of the process template */
  scope_type: WorkflowScopeType
  /** Scope-generic item counts */
  total_items: number
  items_remaining: number
  completed_items: number
  /** Legacy aliases (asset scope) — kept for backwards compatibility */
  total_assets: number
  assets_remaining: number
  completed_assets: number
  /** Parent process archived flag (for parent gating) */
  parent_archived: boolean
  /** Parent process status (for parent gating) */
  parent_status: string | null
  /** Parent process deleted flag (for parent gating) */
  parent_deleted: boolean
  /** Template version number used by this run (null if not set) */
  template_version_number: number | null
}

export function useActiveRuns(userId: string | undefined) {
  return useQuery({
    queryKey: ['active-runs', userId],
    queryFn: async (): Promise<ActiveRun[]> => {
      if (!userId) return []

      // Step 1: Fetch user access IDs in parallel
      const [collaborationsResult, stakeholdersResult] = await Promise.all([
        supabase
          .from('workflow_collaborations')
          .select('workflow_id')
          .eq('user_id', userId),
        supabase
          .from('workflow_stakeholders')
          .select('workflow_id')
          .eq('user_id', userId),
      ])

      const collabIds = new Set((collaborationsResult.data || []).map(c => c.workflow_id))
      const stakeholderIds = new Set((stakeholdersResult.data || []).map(s => s.workflow_id))

      // Step 2: Fetch all child workflows (branches) with parent info.
      // We fetch ALL non-deleted runs so the UI can offer filter tabs
      // (Active / Ended / Archived / All). The DB-level filter only
      // excludes hard-deleted rows.
      // Parent fields include archived, status, deleted for parent gating.
      const { data: branches, error: branchError } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          branch_suffix,
          parent_workflow_id,
          branched_at,
          created_at,
          status,
          archived,
          deleted,
          created_by,
          scope_type,
          template_version_number,
          parent:parent_workflow_id (
            id,
            name,
            color,
            cadence_timeframe,
            created_by,
            archived,
            status,
            deleted
          )
        `)
        .not('parent_workflow_id', 'is', null)
        .not('branched_at', 'is', null) // Exclude version clones (only real runs have branched_at)
        .eq('deleted', false)

      if (branchError) {
        console.error('Error fetching branches:', branchError)
        throw branchError
      }

      if (!branches || branches.length === 0) return []

      // Step 3: Client-side filter — keep branches where user has access to the parent
      const accessibleBranches = branches.filter(branch => {
        const parent = branch.parent as any
        if (!parent) return false
        const parentId = parent.id
        return (
          parent.created_by === userId ||
          collabIds.has(parentId) ||
          stakeholderIds.has(parentId)
        )
      })

      if (accessibleBranches.length === 0) return []

      // Step 4: Batch fetch progress from all scope tables
      const branchIds = accessibleBranches.map(b => b.id)

      // Group branches by scope_type for targeted queries
      const assetBranchIds = accessibleBranches.filter(b => (b as any).scope_type !== 'portfolio' && (b as any).scope_type !== 'general').map(b => b.id)
      const portfolioBranchIds = accessibleBranches.filter(b => (b as any).scope_type === 'portfolio').map(b => b.id)
      const generalBranchIds = accessibleBranches.filter(b => (b as any).scope_type === 'general').map(b => b.id)

      // Query all three tables in parallel
      const [assetProgress, portfolioProgress, generalProgress] = await Promise.all([
        assetBranchIds.length > 0
          ? supabase.from('asset_workflow_progress').select('workflow_id, is_completed').in('workflow_id', assetBranchIds)
          : { data: [], error: null },
        portfolioBranchIds.length > 0
          ? supabase.from('portfolio_workflow_progress').select('workflow_id, is_completed').in('workflow_id', portfolioBranchIds)
          : { data: [], error: null },
        generalBranchIds.length > 0
          ? supabase.from('general_workflow_progress').select('workflow_id, is_completed').in('workflow_id', generalBranchIds)
          : { data: [], error: null },
      ])

      if (assetProgress.error) console.error('Error fetching asset progress:', assetProgress.error)
      if (portfolioProgress.error) console.error('Error fetching portfolio progress:', portfolioProgress.error)
      if (generalProgress.error) console.error('Error fetching general progress:', generalProgress.error)

      // Build counts per branch from all tables
      const countMap = new Map<string, { total: number; remaining: number; completed: number }>()
      const allProgressData = [
        ...(assetProgress.data || []),
        ...(portfolioProgress.data || []),
        ...(generalProgress.data || []),
      ]
      for (const record of allProgressData) {
        const entry = countMap.get(record.workflow_id) || { total: 0, remaining: 0, completed: 0 }
        entry.total++
        if (record.is_completed) {
          entry.completed++
        } else {
          entry.remaining++
        }
        countMap.set(record.workflow_id, entry)
      }

      // Step 5: Build ActiveRun objects
      const runs: ActiveRun[] = accessibleBranches.map(branch => {
        const parent = branch.parent as any
        const counts = countMap.get(branch.id) || { total: 0, remaining: 0, completed: 0 }
        const startedAt = getRunStartedAt({
          branched_at: branch.branched_at,
          created_at: branch.created_at,
        })

        const scopeType = ((branch as any).scope_type || 'asset') as WorkflowScopeType

        return {
          id: branch.id,
          name: branch.name,
          branch_suffix: branch.branch_suffix,
          parent_workflow_id: branch.parent_workflow_id!,
          parent_name: parent?.name || 'Unknown',
          parent_color: parent?.color || null,
          cadence_timeframe: parent?.cadence_timeframe || null,
          branched_at: branch.branched_at || null,
          created_at: branch.created_at || null,
          started_at_display: startedAt,
          status: branch.status || 'active',
          archived: branch.archived ?? false,
          deleted: branch.deleted ?? false,
          scope_type: scopeType,
          total_items: counts.total,
          items_remaining: counts.remaining,
          completed_items: counts.completed,
          // Legacy aliases
          total_assets: counts.total,
          assets_remaining: counts.remaining,
          completed_assets: counts.completed,
          parent_archived: parent?.archived ?? false,
          parent_status: parent?.status ?? null,
          parent_deleted: parent?.deleted ?? false,
          template_version_number: (branch as any).template_version_number ?? null,
        }
      })

      // Sort by items_remaining DESC (urgency approximation)
      runs.sort((a, b) => b.items_remaining - a.items_remaining)

      return runs
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  })
}
