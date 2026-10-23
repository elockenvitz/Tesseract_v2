/**
 * The report's reads.
 *
 * Every query is scoped to `(asset_id, workflow_id)` — the pair the
 * workspace uses — so the report sees exactly the rows the workspace
 * writes and cannot drift from them. Nothing is stored; `buildProcessReport`
 * assembles, this fetches.
 *
 * ── Why the cycle has to be a parameter ─────────────────────────────────
 *
 * A previous cycle is a DIFFERENT `workflow_id`. Scoping every read to the
 * workflow being reported is what keeps a historical report historical.
 * Drop it from any one of these and last quarter's report fills with this
 * quarter's findings, which is the single failure a record of what was
 * established must not have.
 *
 * ── What the schema actually looks like, which is not obvious ───────────
 *
 * Three things here were each a bug waiting to happen, and each was found
 * by querying production rather than by reading the migrations:
 *
 *   `asset_checklist_items.stage_id` holds the stage KEY
 *   ("stage_1771641141401_zsgrk2"), not `workflow_stages.id`. Joining on
 *   the uuid matches nothing.
 *
 *   `asset_checklist_items.item_text` is NULL on untouched rows, and stays
 *   null on rows that have been worked. The label lives in
 *   `workflow_checklist_templates`, which is copied PER RUN and keyed
 *   `(workflow_id, stage_id, item_id)`. Reading item_text alone renders a
 *   cycle's entire record as "Untitled requirement" — observed on AAPL,
 *   where all five rows are null including the one holding a 452-character
 *   assessment.
 *
 *   `asset_checklist_attachments` has no `checklist_item_id`. It keys on
 *   `(stage_id, item_id)` too.
 *
 * So the TEMPLATE is the spine: it supplies every requirement in the
 * cycle and its label, and the per-asset rows supply state and work. A
 * requirement nobody has touched has no row at all, and must still appear
 * in the report as outstanding.
 *
 * RLS posture: unchanged. Every table read here is already read by the
 * workspace through the same client under the same policies. No new table,
 * view, RPC or storage path; no query widens a scope.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import {
  buildProcessReport,
  type ProcessReport,
  type ReportRequirementInput,
  type ReportStageInput,
} from '../../../lib/asset-work/process-report'

interface TemplateRow {
  stage_id: string | null
  item_id: string | null
  item_text: string | null
  sort_order: number | null
}
interface ItemRow {
  id: string
  stage_id: string | null
  item_id: string | null
  item_text: string | null
  status: string | null
  completed: boolean | null
  completed_at: string | null
  notes: string | null
  completed_by_user?: unknown
}
interface CommentRow {
  checklist_item_id: string
  comment_text: string | null
  created_at: string | null
  user?: unknown
}
interface AttachmentRow {
  stage_id: string | null
  item_id: string | null
  file_name: string | null
  uploaded_at: string | null
}
interface StageShape {
  stageKey: string
  label: string
  description: string | null
  order: number
}

const personName = (u: unknown): string | null => {
  const one = (Array.isArray(u) ? u[0] : u) as
    { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined
  if (!one) return null
  return [one.first_name, one.last_name].filter(Boolean).join(' ').trim() || one.email || null
}

const pairKey = (stageId: string | null, itemId: string | null) => `${stageId ?? ''}|${itemId ?? ''}`

/** Stages for a run: the template version for a cycle, the table otherwise. */
async function readStages(workflowId: string): Promise<StageShape[]> {
  const { data: wf } = await supabase
    .from('workflows')
    .select('parent_workflow_id, template_version_id')
    .eq('id', workflowId)
    .maybeSingle()
  const row = wf as unknown as { parent_workflow_id?: string | null; template_version_id?: string | null } | null

  if (row?.template_version_id) {
    const { data: tv } = await supabase
      .from('workflow_template_versions')
      .select('stages')
      .eq('id', row.template_version_id)
      .maybeSingle()
    const stages = ((tv as unknown as { stages?: unknown[] } | null)?.stages ?? []) as Array<Record<string, unknown>>
    if (stages.length) {
      return stages.map((s, i) => ({
        stageKey: String(s.key ?? s.stage_key ?? ''),
        label: String(s.name ?? s.stage_label ?? 'Stage'),
        description: (s.description ?? s.stage_description ?? null) as string | null,
        order: Number(s.order_index ?? s.sort_order ?? i),
      })).filter(s => s.stageKey)
    }
  }

  const { data } = await supabase
    .from('workflow_stages')
    .select('stage_key, stage_label, stage_description, sort_order')
    .eq('workflow_id', workflowId)
    .order('sort_order')
  return ((data ?? []) as unknown as Array<{
    stage_key: string | null; stage_label: string | null
    stage_description: string | null; sort_order: number | null
  }>).map((s, i) => ({
    stageKey: s.stage_key ?? '',
    label: s.stage_label ?? s.stage_key ?? 'Stage',
    description: s.stage_description,
    order: s.sort_order ?? i,
  })).filter(s => s.stageKey)
}

export interface UseProcessReportResult {
  report: ProcessReport | null
  isLoading: boolean
  error: boolean
}

export function useProcessReport(
  assetId: string | null,
  workflowId: string | null,
): UseProcessReportResult {
  const enabled = !!assetId && !!workflowId

  const q = useQuery({
    queryKey: ['process-report', assetId, workflowId],
    enabled,
    /* Short, not zero: this reads rows the workspace just wrote, and is
       reopened often while working. */
    staleTime: 15_000,
    queryFn: async () => {
      const stages = await readStages(workflowId!)

      const { data: tmplData, error: tmplErr } = await supabase
        .from('workflow_checklist_templates')
        .select('stage_id, item_id, item_text, sort_order')
        .eq('workflow_id', workflowId!)
      if (tmplErr) throw tmplErr
      const templates = (tmplData ?? []) as unknown as TemplateRow[]

      const { data: itemData, error: itemErr } = await supabase
        .from('asset_checklist_items')
        .select(
          'id, stage_id, item_id, item_text, status, completed, completed_at, notes, ' +
          'completed_by_user:users!asset_checklist_items_completed_by_fkey(first_name, last_name, email)'
        )
        .eq('asset_id', assetId!)
        .eq('workflow_id', workflowId!)
      if (itemErr) throw itemErr
      const items = (itemData ?? []) as unknown as ItemRow[]

      const ids = items.map(i => i.id)
      const comments: CommentRow[] = ids.length
        ? ((((await supabase
            .from('checklist_item_comments')
            .select(
              'checklist_item_id, comment_text, created_at, ' +
              'user:users!checklist_item_comments_user_id_fkey(first_name, last_name, email)'
            )
            .eq('signal_type', 'commentary')
            .in('checklist_item_id', ids)
            /* Oldest first, so the record reads in the order it was
               written and the first contributor is not pushed to the end. */
            .order('created_at', { ascending: true })).data) ?? []) as unknown as CommentRow[])
        : []

      const { data: attachData } = await supabase
        .from('asset_checklist_attachments')
        .select('stage_id, item_id, file_name, uploaded_at')
        .eq('asset_id', assetId!)
        .eq('workflow_id', workflowId!)
      const attachments = (attachData ?? []) as unknown as AttachmentRow[]

      const itemByPair = new Map<string, ItemRow>()
      for (const i of items) itemByPair.set(pairKey(i.stage_id, i.item_id), i)

      const commentsBy = new Map<string, CommentRow[]>()
      for (const c of comments) {
        const list = commentsBy.get(c.checklist_item_id) ?? []
        list.push(c)
        commentsBy.set(c.checklist_item_id, list)
      }

      const attachBy = new Map<string, AttachmentRow[]>()
      for (const a of attachments) {
        const k = pairKey(a.stage_id, a.item_id)
        const list = attachBy.get(k) ?? []
        list.push(a)
        attachBy.set(k, list)
      }

      const stageInputs: ReportStageInput[] = stages.map(s => ({
        stageId: s.stageKey,
        label: s.label,
        description: s.description,
        sortOrder: s.order,
      }))

      /*
       * The template is the spine. Ordered by `sort_order` then `item_id`:
       * every row in this corpus carries sort_order 1, and `item_id` is
       * timestamp-prefixed, so it is the only field that actually orders
       * them the way the workspace lists them.
       */
      const ordered = [...templates].sort((a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        String(a.item_id ?? '').localeCompare(String(b.item_id ?? '')))

      const seen = new Set<string>()
      const requirements: ReportRequirementInput[] = []

      for (const t of ordered) {
        const k = pairKey(t.stage_id, t.item_id)
        if (seen.has(k)) continue
        seen.add(k)
        const row = itemByPair.get(k) ?? null
        requirements.push({
          /*
           * The TEMPLATE item id, not the `asset_checklist_items` row id.
           *
           * The workspace builds its rail from the template and matches
           * the open requirement with `item.id === selectedRequirement`,
           * where `item.id` is `saved.item_id`. Handing the report's
           * links a row id would make every "open this requirement"
           * silently match nothing — the report would look right and go
           * nowhere. It is also the id that exists for an untouched
           * requirement, which has no row at all.
           */
          requirementId: t.item_id ?? k,
          stageId: t.stage_id,
          /* Template label first: the row's own is null on real data. */
          text: t.item_text ?? row?.item_text ?? null,
          status: row?.status ?? null,
          completed: row?.completed ?? false,
          completedAt: row?.completed_at ?? null,
          completedByName: personName(row?.completed_by_user),
          notes: row?.notes ?? null,
          commentaries: row ? (commentsBy.get(row.id) ?? []).map(c => ({
            text: c.comment_text,
            authorName: personName(c.user),
            at: c.created_at,
          })) : [],
          attachments: (attachBy.get(k) ?? []).map(a => ({
            name: a.file_name,
            at: a.uploaded_at,
          })),
        })
      }

      /*
       * Anything worked that the template no longer lists — a requirement
       * removed from the definition after someone wrote against it. It
       * keeps its work rather than disappearing from the record.
       */
      for (const i of items) {
        const k = pairKey(i.stage_id, i.item_id)
        if (seen.has(k)) continue
        seen.add(k)
        requirements.push({
          /* Same rule as above: the workspace selects by template id. */
          requirementId: i.item_id ?? i.id,
          stageId: i.stage_id,
          text: i.item_text,
          status: i.status,
          completed: i.completed,
          completedAt: i.completed_at,
          completedByName: personName(i.completed_by_user),
          notes: i.notes,
          commentaries: (commentsBy.get(i.id) ?? []).map(c => ({
            text: c.comment_text,
            authorName: personName(c.user),
            at: c.created_at,
          })),
          attachments: (attachBy.get(k) ?? []).map(a => ({ name: a.file_name, at: a.uploaded_at })),
        })
      }

      return buildProcessReport(stageInputs, requirements)
    },
  })

  return { report: q.data ?? null, isLoading: enabled && q.isLoading, error: !!q.error }
}
