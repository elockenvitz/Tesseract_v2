/**
 * The running workflow, summarised for the Work pane.
 *
 * ── No new fetching ──────────────────────────────────────────────────────
 *
 * Every query key below is the one InvestmentTimeline already uses, copied
 * exactly. When both are mounted React Query serves one entry to both; when
 * only Work is mounted, this is the first fetch rather than a second. The one
 * addition is `workflow-identity`, two columns, because the workflow's NAME is
 * in none of the existing queries — the Work summary previously fell back to
 * the literal string "Active process" for want of it.
 *
 * ── Truthful states ──────────────────────────────────────────────────────
 *
 * `status` separates "no workflow" from "not loaded yet", and the selectors
 * return null counts rather than zeros for unfetched rows. Passing null to the
 * pane once made it announce "none running" on an asset with a running
 * process; the type now makes that confusion hard to repeat.
 */

import { useQuery, skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'
import { workflowDeadlinesKey } from '../lib/deadlines/stage-deadlines'
import {
  buildStageProgress, activeStage, nextDeadline, processStatus,
  type ProcessSummaryStatus, type ProcessStageRow,
} from '../lib/asset-work/process-summary'

export interface AssetProcessSummary {
  status: ProcessSummaryStatus
  workflowName: string | null
  stages: ProcessStageRow[]
  active: ProcessStageRow | null
  nextDeadlineDate: string | null
}

export function useAssetProcessSummary(
  assetId: string,
  workflowId: string | null | undefined,
  enabled = true,
): AssetProcessSummary {
  const { currentOrgId } = useOrganization()
  const on = enabled && !!assetId && !!workflowId

  /* Name only. The existing workflow-stages query selects the columns it
     needs to decide whether to render stages at all, and name is not one. */
  const { data: identity } = useQuery({
    queryKey: ['workflow-identity', workflowId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, name')
        .eq('id', workflowId!)
        .maybeSingle()
      if (error) throw error
      return data as { id: string; name: string } | null
    },
    enabled: on,
    staleTime: 5 * 60_000,
  })

  /*
   * ── Observers, not fetchers ────────────────────────────────────────────
   *
   * InvestmentTimeline owns `workflow-stages`, `asset-workflow-checklist` and
   * `asset-workflow-progress`. Declaring those keys here with my own queryFn
   * would be a silent corruption: React Query keys a single entry per key, so
   * whichever component mounted first supplies the fetcher, and the stage
   * shape is not even stable — a workflow BRANCH reads its stages from
   * `workflow_template_versions.stages` as `stage_key`/`stage_label`, while a
   * root workflow reads `workflow_stages`. A second fetcher on that key would
   * hand the Process surface the wrong shape. Giving them different keys
   * instead would duplicate the fetch, which this hook exists to avoid.
   *
   * So each one is `useQuery` with `queryFn: skipToken`: it subscribes to the
   * entry and never requests anything. When Process is mounted — which, in
   * the Work mode, it is, directly below this summary — the band and the
   * stage rail show the same numbers at the same time.
   *
   * `skipToken`, not `enabled: false` with the queryFn omitted. Both behave
   * identically, but React Query logs an error for every observer it finds
   * without a queryFn, whatever `enabled` says — five observers across the
   * remounts of one Work session produced 170 console errors, which is how a
   * real error stops being visible. `skipToken` is the supported way to say
   * "this query deliberately never runs".
   *
   * `getQueryData` was the first attempt. It reads the entry but does not
   * subscribe to it, so the band rendered once, before Process had fetched,
   * and never again: "checklist progress is elsewhere" printed directly above
   * a rail reading 0/4. One page, two answers.
   *
   * When nothing has populated the entry the selectors see `undefined` and
   * report UNKNOWN — not zero, not "no open stage".
   */
  /*
   * An OBSERVER, not a fetcher. `useQuery` with `queryFn: skipToken`
   * subscribes to the cache entry without ever issuing a request: if
   * InvestmentTimeline is mounted, its data arrives here and re-renders this
   * hook; if it is not, the entry is empty and the selectors below report
   * UNKNOWN.
   *
   * `getQueryData` was the first attempt and was wrong in a way that only
   * showed once Process and the summary sat on the same screen: a plain read
   * is not reactive, so the band kept rendering "progress is elsewhere" while
   * the stage rail directly beneath it displayed 0/4. One page, two answers.
   *
   * `gcTime: 0` on the owning queries means the entry disappears as soon as
   * the last observer unmounts — this observer is harmless because it never
   * fetches, so it cannot keep a stale workflow alive on its own.
   */
  const { data: stages } = useQuery<
    { id?: string; stage_key?: string; name?: string; stage_label?: string }[]
  >({ queryKey: ['workflow-stages', workflowId], queryFn: skipToken })

  const { data: checklist } = useQuery<
    { stage_id?: string | null; completed?: boolean | null }[]
  >({ queryKey: ['asset-workflow-checklist', assetId, workflowId], queryFn: skipToken })

  const { data: progress } = useQuery<
    { current_stage_id?: string | null } | null
  >({ queryKey: ['asset-workflow-progress', assetId, workflowId], queryFn: skipToken })

  const { data: deadlines } = useQuery<
    { stage_id?: string | null; deadline_date?: string | null }[]
  >({ queryKey: workflowDeadlinesKey(currentOrgId, assetId, workflowId), queryFn: skipToken })

  /* The stage's TEMPLATE — what the checklist is supposed to contain. The
     saved rows alone under-count: they hold only items somebody has touched. */
  const { data: templates } = useQuery<
    { stage_id?: string | null }[]
  >({ queryKey: ['workflow-checklist-templates', workflowId], queryFn: skipToken })

  return useMemo(() => {
    /* Normalize the two stage shapes — a root workflow's `workflow_stages`
       rows and a branch's template-version rows — into one. */
    const normalized = stages?.map(s => ({
      id: (s.id ?? s.stage_key ?? '') as string,
      label: (s.stage_label ?? s.name ?? null) as string | null,
    }))
    const rows = buildStageProgress(normalized, checklist, progress?.current_stage_id ?? null, templates)
    return {
      status: processStatus(workflowId, normalized),
      workflowName: identity?.name ?? null,
      stages: rows,
      active: activeStage(rows),
      nextDeadlineDate: nextDeadline(deadlines),
    }
  }, [workflowId, identity, stages, checklist, progress, deadlines, templates])
}
