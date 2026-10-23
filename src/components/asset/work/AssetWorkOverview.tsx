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
import {
  ArrowRight, Briefcase, FileText, FolderKanban, GitBranch, Lightbulb, List,
  MessageSquare, Play, StickyNote, Tag,
} from 'lucide-react'
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

/** What Work shows about research. Read-only; Research still owns writing. */
export interface OverviewResearch {
  /** Newest `updated_at` across the core case sections. */
  caseWrittenAt: string | null
  notes: ReadonlyArray<{
    id: string
    title: string
    authorName: string | null
    at: string | null
  }>
}

export interface AssetWorkOverviewProps {
  symbol: string | null
  overview: Overview
  /** Ideas and investigations, already built by the navigator's model. */
  items: readonly WorkItem[]
  connections: readonly OverviewConnection[]
  /** True while memberships are still arriving, so the section can stay
      quiet rather than assert "not on a list" and then contradict itself. */
  connectionsLoading?: boolean
  research: OverviewResearch
  loading?: boolean
  /** Set when a saved selection could not be reopened. */
  recoveredFrom?: boolean
  onOpenProcess: (workflowId: string) => void
  onResume: (workflowId: string, stageId: string | null, requirementId: string | null) => void
  onOpenItem: (item: WorkItem) => void
  onOpenConnection: (c: OverviewConnection) => void
  /** The cross-asset Lists / Themes / Portfolios apps. */
  onOpenAll?: (kind: 'list' | 'theme' | 'portfolio') => void
  onOpenResearch?: () => void
  onOpenNote?: (noteId: string) => void
  /**
   * The three "Add to" buttons and the idea stage filter, which lived in
   * the sidebar. They are passed as slots because each owns its own
   * dialog and query, and this component must not learn what a list is.
   */
  addActions?: React.ReactNode
  ideaFilter?: React.ReactNode
  projectsSlot?: React.ReactNode
  className?: string
}

const CONNECTION_ICON: Record<OverviewConnection['kind'], React.ReactNode> = {
  list: <List className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />,
  theme: <Tag className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />,
  portfolio: <Briefcase className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />,
  project: <FolderKanban className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />,
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
  symbol, overview, items, connections, connectionsLoading, research, loading, recoveredFrom,
  onOpenProcess, onResume, onOpenItem, onOpenConnection, onOpenAll, onOpenResearch, onOpenNote,
  addActions, ideaFilter, projectsSlot, className,
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

      {/*
        ── Research ──────────────────────────────────────────────────

        One of the four things Work is for, and until now the only one
        with no presence here at all. The case and the notes are read
        from the same `useAssetWorkspace` the requirement context uses —
        no new query — and both click through to Research, which still
        owns writing them.
      */}
      <section data-testid="work-overview-research">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className={EYEBROW}>Research</span>
          {onOpenResearch && (
            <button
              type="button"
              data-testid="work-overview-open-research"
              onClick={() => onOpenResearch()}
              className="text-[11px] font-medium text-primary-600 hover:underline"
            >
              Open research
            </button>
          )}
        </div>
        {research.caseWrittenAt || research.notes.length > 0 ? (
          <div className="space-y-1">
            <button
              type="button"
              data-testid="work-overview-case"
              onClick={() => onOpenResearch?.()}
              className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <FileText className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-900 dark:text-gray-100">
                Investment case
              </span>
              <span className="flex-none text-[11px] text-gray-500">
                {research.caseWrittenAt
                  ? `last written ${shortDate(research.caseWrittenAt)}`
                  : 'not written yet'}
              </span>
            </button>
            {research.notes.slice(0, 4).map(n => (
              <button
                key={n.id}
                type="button"
                data-testid={`overview-note-${n.id}`}
                onClick={() => onOpenNote?.(n.id)}
                className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <StickyNote className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-200">
                  {n.title}
                </span>
                <span className="flex-none text-[11px] text-gray-400">
                  {[n.authorName, shortDate(n.at)].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
            {research.notes.length > 4 && (
              <p className="px-2 text-[11px] text-gray-400">
                {research.notes.length - 4} more in Research.
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            No case section or research note written on {symbol ?? 'this asset'} yet.
          </p>
        )}
      </section>

      {/* ── Lists and portfolios ──────────────────────────────────────── */}
      <section data-testid="work-overview-connections">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className={EYEBROW}>Lists and portfolios</span>
          {/* The cross-asset apps, which the sidebar reached with three
              small ExternalLink icons. Still one click, now labelled. */}
          {onOpenAll && (
            <span className="flex gap-3">
              {(['list', 'theme', 'portfolio'] as const).map(k => (
                <button
                  key={k}
                  type="button"
                  data-testid={`work-overview-all-${k}`}
                  onClick={() => onOpenAll(k)}
                  className="text-[11px] font-medium text-primary-600 hover:underline"
                >
                  All {k === 'list' ? 'lists' : k === 'theme' ? 'themes' : 'portfolios'}
                </button>
              ))}
            </span>
          )}
        </div>
        {connectionsLoading ? (
          <div className="h-5 w-48 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        ) : connections.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            Not on a list and not held in any book.
          </p>
        ) : (
          /*
            Rows, not chips. These were a line of small pills under "Also
            connected to", which ranked them below everything — and being
            in a book is one of the four things this surface is for.
          */
          <div className="space-y-1">
            {connections.map(c => (
              <button
                key={`${c.kind}:${c.id}`}
                type="button"
                data-testid={`overview-connection-${c.kind}-${c.id}`}
                onClick={() => onOpenConnection(c)}
                className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {CONNECTION_ICON[c.kind]}
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-900 dark:text-gray-100">
                  {c.label}
                </span>
                <span className="flex-none text-[11px] text-gray-500">{c.detail}</span>
                <span className="flex-none text-[10px] uppercase tracking-wide text-gray-400">
                  {c.kind}
                </span>
              </button>
            ))}
          </div>
        )}
        {addActions && <div className="mt-2 flex flex-wrap gap-1.5">{addActions}</div>}
      </section>

      {/* ── Ideas and investigations ──────────────────────────────────── */}
      {(ideas.length > 0 || investigations.length > 0) && (
        <section data-testid="work-overview-ideas">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className={EYEBROW}>Ideas and investigations</span>
            {ideaFilter}
          </div>
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

      {/* ── Projects ──────────────────────────────────────────────────── */}
      {projectsSlot && (
        <section data-testid="work-overview-projects">
          <span className={clsx(EYEBROW, 'mb-1.5 block')}>Projects</span>
          {projectsSlot}
        </section>
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

