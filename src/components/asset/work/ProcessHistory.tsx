import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

/**
 * What happened the last time we ran this Process on this name.
 *
 * ── The question this answers ───────────────────────────────────────────
 *
 * A recurring Process — Earnings Season, a weekly review — exists to be
 * compared with itself. "What did we expect last quarter, and what did we
 * write?" was unanswerable here: the surface offered an Activity Timeline,
 * a chronological feed of status events, filtered by event type, in which
 * every run read as a row of four zeroes. Status events are not findings,
 * and a feed of them is not a review.
 *
 * So previous runs come first, as runs: when it ran, whether it finished,
 * and how much was actually recorded AGAINST THIS ASSET in it. Opening one
 * switches the workspace to that run, where its real stages, requirements
 * and findings already render — rather than a summary of them invented
 * here.
 *
 * Activity stays, demoted and collapsed, as what it is: a log.
 *
 * ── What it will not do ─────────────────────────────────────────────────
 *
 * It does not compare runs, diff them, or say what changed. Nothing in the
 * schema links a requirement in one run to its counterpart in the next —
 * ids are per-run — so a "since last quarter" column would be a guess
 * dressed as continuity. Counts are counts, and each says which run and
 * which asset it counted.
 */

export interface ProcessRun {
  id: string
  name: string
  runLabel: string | null
  branchedAt: string | null
  status: string | null
  archived: boolean
  isCurrent: boolean
  /** For THIS asset, in THIS run. */
  items: number
  done: number
  findings: number
}

interface Props {
  assetId: string
  assetSymbol?: string | null
  /** The run being worked, whose siblings are the history. */
  workflowId: string | null
  /** Switches the workspace to a previous run. */
  onOpenRun: (workflowId: string) => void
  /** The labelled way back to the Process. */
  onBack: () => void
  backLabel: string
  /** The existing activity feed, demoted into a collapsed section. */
  activitySlot?: React.ReactNode
}

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

function stamp(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/*
 * The three row shapes this reads. Named rather than cast to `any`: the
 * select strings are opaque to the generated types, and a run's counts are
 * arithmetic — a field read off `any` that silently becomes undefined shows
 * a reader "0 of 0 done" for a cycle somebody worked.
 */
interface WorkflowRow {
  id: string
  name: string
  branch_suffix: string | null
  branched_at: string | null
  status: string | null
  archived: boolean | null
  created_at: string | null
  parent_workflow_id?: string | null
}
interface ChecklistRow { id: string; workflow_id: string; completed: boolean | null }
interface CommentRow { checklist_item_id: string }

/* Not exported: a hook beside a component breaks fast refresh for the file,
   and nothing else needs these runs. */
function useProcessRuns(assetId: string, workflowId: string | null) {
  return useQuery<ProcessRun[]>({
    queryKey: ['process-runs', assetId, workflowId],
    enabled: !!assetId && !!workflowId,
    staleTime: 60_000,
    queryFn: async () => {
      /* The family: this run's parent, or itself when it is the template. */
      const { data: self, error: selfErr } = await supabase
        .from('workflows')
        .select('id, parent_workflow_id')
        .eq('id', workflowId!)
        .single()
      if (selfErr) throw selfErr
      const selfRow = self as unknown as Pick<WorkflowRow, 'id' | 'parent_workflow_id'> | null
      const rootId = selfRow?.parent_workflow_id ?? selfRow?.id
      if (!rootId) return []

      const { data: siblings, error: sibErr } = await supabase
        .from('workflows')
        .select('id, name, branch_suffix, branched_at, status, archived, created_at')
        .or(`id.eq.${rootId},parent_workflow_id.eq.${rootId}`)
      if (sibErr) throw sibErr
      const runs = (siblings ?? []) as unknown as WorkflowRow[]

      const ids = runs.map(w => w.id)
      if (!ids.length) return []

      /* Work recorded against THIS asset, per run. One read for the items
         and one for the findings; both filtered by asset so a busy run on
         another name never counts here. */
      const { data: itemData } = await supabase
        .from('asset_checklist_items')
        .select('id, workflow_id, completed')
        .eq('asset_id', assetId)
        .in('workflow_id', ids)
      const items = (itemData ?? []) as unknown as ChecklistRow[]

      const itemIds = items.map(i => i.id)
      let findingsByItem = new Set<string>()
      if (itemIds.length) {
        const { data: commentData } = await supabase
          .from('checklist_item_comments')
          .select('checklist_item_id')
          .eq('signal_type', 'commentary')
          .in('checklist_item_id', itemIds)
        const comments = (commentData ?? []) as unknown as CommentRow[]
        findingsByItem = new Set(comments.map(c => c.checklist_item_id))
      }

      const byRun = new Map<string, { items: number; done: number; findings: number }>()
      for (const i of items) {
        const row = byRun.get(i.workflow_id) ?? { items: 0, done: 0, findings: 0 }
        row.items += 1
        if (i.completed) row.done += 1
        if (findingsByItem.has(i.id)) row.findings += 1
        byRun.set(i.workflow_id, row)
      }

      return runs
        /*
         * The template is not a run. `or(id.eq.root, parent.eq.root)` has to
         * include the root to cover a Process that has never branched, but
         * once there are branches the root is the definition they were cut
         * from — listing it as a cycle alongside "Q3 2026" invites a reader
         * to open it looking for last quarter's work.
         */
        .filter(w => w.id !== rootId || rootId === workflowId)
        .map((w): ProcessRun => ({
          id: w.id,
          name: w.name,
          runLabel: w.branch_suffix ?? null,
          branchedAt: w.branched_at ?? w.created_at ?? null,
          status: w.status ?? null,
          archived: !!w.archived,
          isCurrent: w.id === workflowId,
          ...(byRun.get(w.id) ?? { items: 0, done: 0, findings: 0 }),
        }))
        .sort((a, b) => String(b.branchedAt ?? '').localeCompare(String(a.branchedAt ?? '')))
    },
  })
}

export function ProcessHistory({
  assetId, assetSymbol, workflowId, onOpenRun, onBack, backLabel, activitySlot,
}: Props) {
  const { data: runs = [], isLoading, error } = useProcessRuns(assetId, workflowId)
  const [activityOpen, setActivityOpen] = useState(false)

  const previous = runs.filter(r => !r.isCurrent)

  return (
    <section className="min-w-0" data-testid="process-history">
      <header className="border-b border-gray-200 pb-3 dark:border-gray-700">
        <button
          type="button"
          onClick={onBack}
          data-testid="history-back"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </button>
        <h3 className="mt-1 text-[17px] font-semibold leading-snug text-gray-900 dark:text-gray-100">
          Previous runs
        </h3>
        <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">
          Earlier cycles of this Process, and what was recorded against{' '}
          {assetSymbol ?? 'this asset'} in each.
        </p>
      </header>

      <div className="py-3">
        {isLoading ? (
          <div className="space-y-2" data-testid="history-loading">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
        ) : error ? (
          <p className="text-[12px] text-amber-700 dark:text-amber-500">
            Previous runs could not be loaded, so none are shown rather than an empty list.
          </p>
        ) : previous.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="history-empty">
            This Process has not run before — the one you are in is its first cycle.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="history-runs">
            {previous.map(run => {
              const when = stamp(run.branchedAt)
              const recorded = run.items === 0
                ? `Nothing recorded for ${assetSymbol ?? 'this asset'}`
                : `${run.done} of ${run.items} done · ${run.findings === 0 ? 'no findings written' : `${run.findings} finding${run.findings === 1 ? '' : 's'}`}`
              return (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                  <div className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-gray-100">
                      {run.runLabel ?? run.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                      {[when, run.archived ? 'archived' : run.status].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    <span className={clsx(
                      'text-[11px]',
                      run.items === 0 ? 'text-gray-400' : 'text-gray-600 dark:text-gray-300',
                    )}>
                      {recorded}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenRun(run.id)}
                      data-testid={`history-open-${run.id}`}
                      className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      Open this run
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {activitySlot && (
        <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
          {/* A log, named as one and closed by default. It records status
              events; it is not a review, and it stopped being presented as
              one. */}
          <button
            type="button"
            onClick={() => setActivityOpen(o => !o)}
            aria-expanded={activityOpen}
            data-testid="history-activity-toggle"
            className="flex w-full items-center gap-1.5 text-left"
          >
            {activityOpen
              ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
            <span className={EYEBROW}>Activity log</span>
            <span className="text-[11px] text-gray-400">
              every recorded event, newest first
            </span>
          </button>
          {activityOpen && <div className="mt-2" data-testid="history-activity">{activitySlot}</div>}
        </div>
      )}
    </section>
  )
}
