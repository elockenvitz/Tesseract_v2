/**
 * The landing page for work on one asset.
 *
 * Renders what `lib/asset-work/work-overview` assembled. It makes no
 * judgment of its own: the order arrives decided, and the one sentence of
 * justification ("where you left off") comes with it.
 *
 * ── Shape ───────────────────────────────────────────────────────────────
 *
 * Continue working, then the live Processes, then ideas and
 * investigations, then the passive relationships — lists, themes,
 * portfolios, projects — which are connections rather than work and are
 * sized accordingly. Nothing gets a card for its own sake.
 */
import { clsx } from 'clsx'
import { ArrowRight, Clock, GitBranch, Lightbulb, MessageSquare, Play } from 'lucide-react'
import type { AssetWorkOverview as Overview, OverviewRun } from '../../../lib/asset-work/work-overview'
import { progressOf } from '../../../lib/asset-work/work-overview'
import type { WorkItem } from '../../../lib/asset-work/work-items'

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

const shortDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export interface OverviewConnection {
  kind: 'list' | 'theme' | 'portfolio' | 'project'
  id: string
  label: string
  detail?: string | null
}

export interface AssetWorkOverviewProps {
  symbol: string | null
  overview: Overview
  /** Ideas and investigations, already built by the navigator's model. */
  items: readonly WorkItem[]
  connections: readonly OverviewConnection[]
  loading?: boolean
  /** Set when a saved selection could not be reopened. */
  recoveredFrom?: boolean
  onOpenProcess: (workflowId: string) => void
  onResume: (workflowId: string, stageId: string | null, requirementId: string | null) => void
  onOpenItem: (item: WorkItem) => void
  onOpenConnection: (c: OverviewConnection) => void
  className?: string
}

function Bar({ fraction, tone }: { fraction: number; tone: 'normal' | 'late' }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-gray-150 dark:bg-gray-700" aria-hidden="true">
      <div
        className={clsx('h-full rounded-full', tone === 'late' ? 'bg-amber-500' : 'bg-primary-600')}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` }}
      />
    </div>
  )
}

function RunRow({ run, onOpen }: { run: OverviewRun; onOpen: () => void }) {
  const p = progressOf(run)
  const due = shortDate(run.dueDate)
  return (
    <button
      type="button"
      data-testid={`overview-run-${run.workflowId}`}
      onClick={onOpen}
      className="group block w-full rounded-md border border-gray-200 px-3 py-2.5 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="min-w-0 truncate text-[13px] font-semibold text-gray-900 dark:text-gray-100">
          {run.name}
        </span>
        {run.cycle && <span className="flex-none text-[11px] text-gray-500">{run.cycle}</span>}
        {run.overdue && (
          <span className="flex-none rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
            past due
          </span>
        )}
        <ArrowRight className="ml-auto h-3.5 w-3.5 flex-none text-gray-300 group-hover:text-gray-500" aria-hidden="true" />
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-gray-500 dark:text-gray-400">
        {run.currentStageLabel && <span>{run.currentStageLabel}</span>}
        <span className="text-gray-300">·</span>
        <span>{p.label} requirements done</span>
        {run.outstanding > 0 && (
          <>
            <span className="text-gray-300">·</span>
            <span>{run.outstanding} open</span>
          </>
        )}
        {run.assigneeName && (
          <>
            <span className="text-gray-300">·</span>
            <span>{run.assigneeName}</span>
          </>
        )}
        {due && (
          <>
            <span className="text-gray-300">·</span>
            <span className={run.overdue ? 'text-amber-700 dark:text-amber-400' : undefined}>due {due}</span>
          </>
        )}
      </div>

      <div className="mt-1.5">
        <Bar fraction={p.fraction} tone={run.overdue ? 'late' : 'normal'} />
      </div>
    </button>
  )
}

export function AssetWorkOverview({
  symbol, overview, items, connections, loading, recoveredFrom,
  onOpenProcess, onResume, onOpenItem, onOpenConnection, className,
}: AssetWorkOverviewProps) {
  if (loading) {
    return (
      <div className={clsx('space-y-3', className)} data-testid="work-overview-loading">
        <div className="h-16 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
        <div className="h-24 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
      </div>
    )
  }

  const ideas = items.filter(i => i.kind === 'idea')
  const investigations = items.filter(i => i.kind === 'conversation')
  const { resume, runs } = overview

  return (
    <div className={clsx('min-w-0 space-y-6', className)} data-testid="work-overview">
      {recoveredFrom && (
        /* Said plainly rather than silently showing something else. */
        <p
          data-testid="work-overview-recovered"
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          The work you had open is no longer available, so this is {symbol ?? 'the asset'}'s work overview.
        </p>
      )}

      {/* ── Continue working ──────────────────────────────────────────── */}
      {resume && (
        <section data-testid="work-overview-resume">
          <span className={clsx(EYEBROW, 'mb-1.5 block')}>Continue working</span>
          <div className="rounded-md border border-primary-200 bg-primary-50/40 px-3 py-2.5 dark:border-primary-900 dark:bg-primary-950/20">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                {resume.requirementText ?? resume.stageLabel ?? resume.processName}
              </span>
              <span className="text-[11px] text-gray-500">{resume.reason}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              {[resume.processName, resume.cycle, resume.stageLabel].filter(Boolean).join(' · ')}
            </p>
            <button
              type="button"
              data-testid="work-overview-resume-action"
              onClick={() => onResume(resume.workflowId, resume.stageId, resume.requirementId)}
              className="mt-2 inline-flex items-center gap-1.5 rounded bg-primary-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-primary-700"
            >
              <Play className="h-3 w-3" aria-hidden="true" /> Resume
            </button>
          </div>
        </section>
      )}

      {/* ── Active processes ──────────────────────────────────────────── */}
      <section data-testid="work-overview-processes">
        <span className={clsx(EYEBROW, 'mb-1.5 block')}>Active processes</span>
        {runs.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            No process is running on {symbol ?? 'this asset'}. Add one from the process switcher.
          </p>
        ) : (
          <div className="space-y-2">
            {runs.map(r => (
              <RunRow key={r.workflowId} run={r} onOpen={() => onOpenProcess(r.workflowId)} />
            ))}
          </div>
        )}
      </section>

      {/* ── Ideas and investigations ──────────────────────────────────── */}
      {(ideas.length > 0 || investigations.length > 0) && (
        <section data-testid="work-overview-ideas">
          <span className={clsx(EYEBROW, 'mb-1.5 block')}>Ideas and investigations</span>
          <div className="space-y-1">
            {[...ideas, ...investigations].map(i => (
              <button
                key={i.key}
                type="button"
                data-testid={`overview-item-${i.key}`}
                onClick={() => onOpenItem(i)}
                className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {i.kind === 'idea'
                  ? <Lightbulb className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />
                  : <MessageSquare className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-900 dark:text-gray-100">
                  {i.label}
                </span>
                {i.detail && <span className="flex-none text-[11px] text-gray-500">{i.detail}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Connections ───────────────────────────────────────────────── */}
      {connections.length > 0 && (
        <section data-testid="work-overview-connections">
          <span className={clsx(EYEBROW, 'mb-1.5 block')}>Also connected to</span>
          {/* Inline and small: belonging to a book is not a task, and
              giving it a card would rank it with the work above. */}
          <div className="flex flex-wrap gap-1.5">
            {connections.map(c => (
              <button
                key={`${c.kind}:${c.id}`}
                type="button"
                data-testid={`overview-connection-${c.kind}-${c.id}`}
                onClick={() => onOpenConnection(c)}
                className="inline-flex items-baseline gap-1.5 rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <span className="truncate">{c.label}</span>
                {c.detail && <span className="text-gray-400">{c.detail}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* One line, not a page of zeros. */}
      {overview.quiet && connections.length === 0 && (
        <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="work-overview-quiet">
          Nothing is being worked on for {symbol ?? 'this asset'} yet.
        </p>
      )}
    </div>
  )
}

/** The compact "what else is open" control for inside a focused workspace. */
export function WorkOverviewReturn({
  onBack, className,
}: { onBack: () => void; className?: string }) {
  return (
    <button
      type="button"
      data-testid="back-to-work-overview"
      onClick={onBack}
      className={clsx(
        'inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
        className,
      )}
    >
      <GitBranch className="h-3 w-3" aria-hidden="true" />
      Back to Work overview
    </button>
  )
}

export { Clock }
