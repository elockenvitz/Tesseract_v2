import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ExternalLink } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import {
  matchPriorWork, type PriorWorkRow, type PriorRunRef,
} from '../../../lib/asset-work/prior-work'

/**
 * Last cycle's answer to this cycle's question.
 *
 * Read-only by construction: this panel renders text written in another run
 * and offers a way to open that run. It never copies a prior conclusion into
 * the current assessment — a finding carries its author and its date, and
 * moving it would quietly reassign both.
 *
 * The matching rule and its refusals live in `lib/asset-work/prior-work`.
 * This component does the reading and the rendering, nothing else.
 */

interface Props {
  assetId: string
  /** The run being worked. Its siblings are the history. */
  workflowId: string | null
  requirementText: string
  /** Opens a previous run in the workspace, without leaving the asset. */
  onOpenRun?: (workflowId: string) => void
  className?: string
}

interface WorkflowRow {
  id: string
  name: string
  branch_suffix: string | null
  branched_at: string | null
  created_at: string | null
  parent_workflow_id?: string | null
}
interface ItemRow {
  id: string
  workflow_id: string
  item_text: string | null
  notes: string | null
  completed: boolean | null
}
interface CommentRow {
  checklist_item_id: string
  comment_text: string | null
  created_at: string | null
  user?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null
}

const stamp = (iso: string | null): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const personName = (u: CommentRow['user']): string | null =>
  u ? ([u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || null) : null

function usePriorWork(assetId: string, workflowId: string | null, requirementText: string) {
  return useQuery({
    queryKey: ['prior-work', assetId, workflowId, requirementText],
    enabled: !!assetId && !!workflowId && !!requirementText,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: self } = await supabase
        .from('workflows').select('id, parent_workflow_id').eq('id', workflowId!).single()
      const selfRow = self as unknown as Pick<WorkflowRow, 'id' | 'parent_workflow_id'> | null
      const rootId = selfRow?.parent_workflow_id ?? selfRow?.id
      if (!rootId) return matchPriorWork(requirementText, [])

      const { data: sib } = await supabase
        .from('workflows')
        .select('id, name, branch_suffix, branched_at, created_at')
        .or(`id.eq.${rootId},parent_workflow_id.eq.${rootId}`)
      const runs = ((sib ?? []) as unknown as WorkflowRow[]).filter(w => w.id !== workflowId)
      if (!runs.length) return matchPriorWork(requirementText, [])

      const runById = new Map<string, PriorRunRef>(runs.map(w => [w.id, {
        workflowId: w.id,
        label: w.branch_suffix ?? w.name,
        at: w.branched_at ?? w.created_at ?? null,
      }]))

      /*
       * Only rows that EXIST carry work: a requirement nobody touched has no
       * row in that run at all, and a row created by a touch carries its own
       * label. So this is the complete candidate set, and it is small.
       */
      const { data: itemData } = await supabase
        .from('asset_checklist_items')
        .select('id, workflow_id, item_text, notes, completed')
        .eq('asset_id', assetId)
        .in('workflow_id', [...runById.keys()])
      const items = (itemData ?? []) as unknown as ItemRow[]
      if (!items.length) return matchPriorWork(requirementText, [])

      const { data: commentData } = await supabase
        .from('checklist_item_comments')
        .select('checklist_item_id, comment_text, created_at, user:users!checklist_item_comments_user_id_fkey(first_name, last_name, email)')
        .eq('signal_type', 'commentary')
        .in('checklist_item_id', items.map(i => i.id))
        .order('created_at', { ascending: false })
      const comments = (commentData ?? []) as unknown as CommentRow[]
      const newestByItem = new Map<string, CommentRow>()
      for (const c of comments) if (!newestByItem.has(c.checklist_item_id)) newestByItem.set(c.checklist_item_id, c)

      const candidates: PriorWorkRow[] = items.map(i => {
        const c = newestByItem.get(i.id)
        return {
          itemId: i.id,
          run: runById.get(i.workflow_id)!,
          requirementText: i.item_text ?? '',
          finding: c?.comment_text ?? null,
          authorName: personName(c?.user ?? null),
          writtenAt: c?.created_at ?? null,
          notes: i.notes ?? null,
          completed: !!i.completed,
        }
      }).filter(r => !!r.run)

      return matchPriorWork(requirementText, candidates)
    },
  })
}

export function PriorWorkPanel({
  assetId, workflowId, requirementText, onOpenRun, className,
}: Props) {
  const { data, isLoading, error } = usePriorWork(assetId, workflowId ?? null, requirementText)

  if (isLoading) {
    return <div className={clsx('h-16 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800', className)} />
  }
  if (error || !data) {
    return (
      <p className={clsx('text-[12px] text-amber-700 dark:text-amber-500', className)}>
        Earlier cycles could not be read, so none are shown rather than an empty answer.
      </p>
    )
  }

  const { outcome, match, runsToReview } = data

  return (
    <div className={clsx('min-w-0', className)} data-testid="prior-work">
      {outcome === 'matched' && match && (
        <div data-testid="prior-work-match">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[12px] font-medium text-gray-900 dark:text-gray-100">
              {match.run.label}
            </span>
            {stamp(match.writtenAt ?? match.run.at) && (
              <span className="text-[11px] text-gray-400">{stamp(match.writtenAt ?? match.run.at)}</span>
            )}
            {match.completed && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                completed
              </span>
            )}
          </div>
          {match.finding?.trim() ? (
            <blockquote className="mt-1 border-l-2 border-gray-200 pl-2.5 text-[13px] leading-relaxed text-gray-700 dark:border-gray-700 dark:text-gray-200">
              {match.finding}
            </blockquote>
          ) : (
            <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
              Marked done, with working notes rather than a written assessment.
            </p>
          )}
          {match.notes?.trim() && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
              <span className="text-gray-400">Notes: </span>{match.notes}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3">
            {match.authorName && (
              <span className="text-[11px] text-gray-400">{match.authorName}</span>
            )}
            {onOpenRun && (
              <button
                type="button"
                onClick={() => onOpenRun(match.run.workflowId)}
                data-testid="prior-work-open-run"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline"
              >
                Open that cycle <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {outcome === 'ambiguous' && (
        <p className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400" data-testid="prior-work-ambiguous">
          An earlier cycle has more than one requirement with this name, so none
          is shown as the predecessor of this one.
        </p>
      )}

      {outcome === 'none' && (
        <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="prior-work-none">
          {runsToReview.length === 0
            ? 'No earlier cycle of this Process recorded work on this asset.'
            : 'No earlier cycle recorded anything under this requirement.'}
        </p>
      )}

      {runsToReview.length > 0 && (
        <div className={clsx(outcome === 'matched' ? 'mt-2' : 'mt-1.5')}>
          <span className="text-[11px] text-gray-400">
            {outcome === 'matched' ? 'Earlier cycles with work: ' : 'Cycles that recorded other work: '}
          </span>
          {runsToReview.slice(0, 4).map((r, i) => (
            <span key={r.workflowId}>
              {i > 0 && <span className="text-[11px] text-gray-300">, </span>}
              <button
                type="button"
                onClick={() => onOpenRun?.(r.workflowId)}
                disabled={!onOpenRun}
                data-testid={`prior-work-run-${r.workflowId}`}
                className="text-[11px] font-medium text-primary-600 hover:underline disabled:text-gray-400 disabled:no-underline"
              >
                {r.label}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
