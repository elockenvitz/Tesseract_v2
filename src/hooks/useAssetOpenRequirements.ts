/**
 * The requirements of one process run on one asset, for a surface that is not
 * the Work surface.
 *
 * ── Why this is a new key rather than a shared one ───────────────────────
 *
 * `InvestmentTimeline` owns `['asset-workflow-checklist', assetId,
 * workflowId]` and selects `*` plus a completed-by join, because it renders
 * and edits every item. `useAssetProcessSummary` subscribes to that key with
 * `queryFn: skipToken` precisely so it cannot become a second fetcher on it --
 * the hazard that module documents at length.
 *
 * The Overview needs the same rows with none of that: it is never mounted at
 * the same time as the Work surface (the asset page renders one mode at a
 * time), so a narrow projection under its own key duplicates no in-flight
 * request and cannot hand the Work surface a shape it did not ask for.
 *
 * ── Permission scope ─────────────────────────────────────────────────────
 *
 * RLS posture, verified against the live database rather than the migrations:
 * `asset_checklist_items` has RLS enabled with policies TO `authenticated`
 * only, and its SELECT policy is `organization_id = current_org_id() AND
 * is_active_member_of_current_org()`. So this read is both caller-scoped and
 * org-scoped by the server, and nothing here widens it: no RPC, no definer,
 * no service role, the reader's own client.
 *
 * Because the rows are org-scoped SERVER-side, `currentOrgId` leads the query
 * key. A key without it caches one organization's requirements and serves
 * them after an org switch -- the same defect that had the AI pane showing a
 * previous organization's BYOK configuration.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'

export interface OpenRequirement {
  id: string
  /** `item_text`. May be absent on a row created from a template edit. */
  text: string | null
  stageId: string | null
  completed: boolean
  dueDate: string | null
  assigneeName: string | null
}

export interface AssetRequirements {
  /** Every requirement on the run, in the order the process defines. */
  all: OpenRequirement[]
  /** The ones still owed. */
  open: OpenRequirement[]
  doneCount: number
  isLoading: boolean
}

const EMPTY: AssetRequirements = { all: [], open: [], doneCount: 0, isLoading: false }

const personName = (u: { first_name?: string | null; last_name?: string | null; email?: string | null } | null): string | null =>
  u ? ([u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || null) : null

export function useAssetOpenRequirements(
  assetId: string | null | undefined,
  workflowId: string | null | undefined,
  enabled = true,
): AssetRequirements {
  const { currentOrgId } = useOrganization()
  const on = enabled && !!assetId && !!workflowId && !!currentOrgId

  const { data, isLoading } = useQuery({
    queryKey: ['asset-open-requirements', currentOrgId, assetId, workflowId],
    queryFn: async (): Promise<OpenRequirement[]> => {
      const { data: rows, error } = await supabase
        .from('asset_checklist_items')
        .select(`
          id, item_text, stage_id, completed, due_date,
          assignee:users!asset_checklist_items_assignee_id_fkey(id, email, first_name, last_name)
        `)
        .eq('asset_id', assetId!)
        .eq('workflow_id', workflowId!)
        .order('sort_order', { ascending: true })
      if (error) throw error
      /* Named at the boundary: an untyped Supabase select infers `never[]`
         for the row here, as most queries in this app do. */
      return ((rows ?? []) as unknown as Array<{
        id: string; item_text: string | null; stage_id: string | null
        completed: boolean | null; due_date: string | null
        assignee: { first_name?: string | null; last_name?: string | null; email?: string | null } | null
      }>).map(r => ({
        id: r.id,
        text: r.item_text ?? null,
        stageId: r.stage_id ?? null,
        completed: r.completed === true,
        dueDate: r.due_date ?? null,
        assigneeName: personName(r.assignee ?? null),
      }))
    },
    enabled: on,
    staleTime: 30_000,
  })

  return useMemo(() => {
    if (!on) return EMPTY
    const all = data ?? []
    const open = all.filter(r => !r.completed)
    return { all, open, doneCount: all.length - open.length, isLoading }
  }, [on, data, isLoading])
}
