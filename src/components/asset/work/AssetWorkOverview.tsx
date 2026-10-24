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
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  ArrowRight, Briefcase, FileText, FolderKanban, GitBranch, Lightbulb, List,
  MessageSquare, Play, Plus, StickyNote, Tag,
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
  /** The case's own sections, so the page can show what it SAYS. */
  sections: ReadonlyArray<{
    section: string
    content: string
    at: string | null
  }>
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
  /** Processes this asset could be added to, and the join. */
  joinable?: ReadonlyArray<{ id: string; name: string }>
  onJoin?: (workflowId: string) => void
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

/** One kind of relationship, with its own heading and its own empty state. */
function ConnectionGroup({
  kind, title, empty, rows, loading, onOpen, onOpenAll, trailing,
}: {
  kind: OverviewConnection['kind']
  title: string
  empty: string
  rows: readonly OverviewConnection[]
  loading?: boolean
  onOpen: (c: OverviewConnection) => void
  onOpenAll?: (kind: 'list' | 'theme' | 'portfolio') => void
  trailing?: React.ReactNode
}) {
  return (
    <section data-testid={`work-overview-${kind}s`}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className={EYEBROW}>{title}</span>
        {onOpenAll && kind !== 'project' && (
          <button
            type="button"
            data-testid={`work-overview-all-${kind}`}
            onClick={() => onOpenAll(kind)}
            className="text-[11px] font-medium text-primary-600 hover:underline"
          >
            All {title.toLowerCase()}
          </button>
        )}
      </div>
      {loading ? (
        <div className="h-5 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-gray-500 dark:text-gray-400">{empty}</p>
      ) : (
        <div className="space-y-0.5">
          {rows.map(c => (
            <button
              key={`${c.kind}:${c.id}`}
              type="button"
              data-testid={`overview-connection-${c.kind}-${c.id}`}
              onClick={() => onOpen(c)}
              className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {CONNECTION_ICON[c.kind]}
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-900 dark:text-gray-100">
                {c.label}
              </span>
              {c.detail && (
                <span className="flex-none text-[11px] tabular-nums text-gray-500">{c.detail}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {trailing && <div className="mt-2 flex flex-wrap gap-1.5">{trailing}</div>}
    </section>
  )
}

/** Add this asset to a process, from the page that lists its processes. */
function AddProcess({
  joinable, onJoin,
}: {
  joinable: ReadonlyArray<{ id: string; name: string }>
  onJoin: (workflowId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        data-testid="work-overview-add-process"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline"
      >
        <Plus className="h-3 w-3" aria-hidden="true" /> Add to a process
      </button>
      {open && (
        <div
          role="menu"
          data-testid="work-overview-add-process-menu"
          className="absolute right-0 top-full z-50 mt-1 max-h-72 w-[280px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {joinable.map(j => (
            <button
              key={j.id}
              type="button"
              role="menuitem"
              data-testid={`work-overview-join-${j.id}`}
              onClick={() => { setOpen(false); onJoin(j.id) }}
              className="block w-full truncate px-3 py-1.5 text-left text-[12px] text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {j.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AssetWorkOverview({
  symbol, overview, items, connections, connectionsLoading, research, loading, recoveredFrom,
  onOpenProcess, onResume, onOpenItem, onOpenConnection, onOpenAll, onOpenResearch, onOpenNote,
  joinable = [], onJoin, addActions, ideaFilter, projectsSlot, className,
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
    /*
      ── Two columns, because one stretched every row to 1,500px ──────

      Every section was a full-width list whose label sat at the far left
      and whose one fact sat at the far right, with a thousand pixels of
      nothing between them. Doing the work in two columns of ~620px puts
      the label and its fact next to each other and fits the whole of an
      asset's work on one screen without scrolling.
    */
    <div className={clsx('min-w-0 max-w-[1320px]', className)} data-testid="work-overview">
      {recoveredFrom && (
        /* Said plainly rather than silently showing something else. */
        <p
          data-testid="work-overview-recovered"
          className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          The work you had open is no longer available, so this is all of {symbol ?? 'the asset'}'s work.
        </p>
      )}

      {/*
        ── What this page is ────────────────────────────────────────

        It had no title, and the only thing that named it called it the
        "Work overview" — beside an Overview mode that is a different
        page. A reader had two things called overview and no statement
        of which was home.
      */}
      <header className="mb-4 flex flex-wrap items-baseline gap-x-2 border-b border-gray-200 pb-2 dark:border-gray-700">
        <h2 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
          All work on {symbol ?? 'this asset'}
        </h2>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          processes, research, lists and books, ideas — open one to work on it
        </span>
      </header>

      {/* ── Continue working ──────────────────────────────────────────── */}
      {resume && (
        <section className="mb-5" data-testid="work-overview-resume">
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

      {/*
        ── Packed, not aligned ───────────────────────────────────────

        A two-column GRID aligns row by row, so a short section beside a
        tall one leaves a hole the height of the difference — Processes
        beside Research left about 200px of nothing. Column flow packs
        each section under the previous one in its column, so the only
        empty space left on the page is at the bottom of one column.
      */}
      <div className="gap-x-8 lg:columns-2 [&>section]:mb-5 [&>section]:break-inside-avoid">

      {/* ── Processes ─────────────────────────────────────────────────── */}
      <section data-testid="work-overview-processes">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className={EYEBROW}>Processes</span>
          {/*
            Adding this asset to a process was only possible from INSIDE
            a process — the switcher's "Add a process" group — so an
            asset running none had no way in at all, and the empty state
            cheerfully pointed at a control the reader could not reach.
          */}
          {joinable.length > 0 && onJoin && (
            <AddProcess joinable={joinable} onJoin={onJoin} />
          )}
        </div>
        {runs.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            {joinable.length > 0
              ? `No process is running on ${symbol ?? 'this asset'} yet.`
              : `No process is running on ${symbol ?? 'this asset'}, and none is available to add.`}
          </p>
        ) : (
          <div className="space-y-1.5">
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
        {research.sections.length > 0 || research.notes.length > 0 ? (
          <div className="space-y-1">
            {/*
              The case itself, not a row saying the words "Investment
              case". That row carried one fact — a date — and a link to
              the Research tab, which is already a click away at the top
              of the page: a label pointing at a label.

              These are the case's own sections with the first line of
              what each one says, so the page tells you what the firm
              thinks rather than that a thesis exists somewhere.
            */}
            {research.sections.slice(0, 3).map(s => (
              <button
                key={s.section}
                type="button"
                data-testid={`overview-case-${s.section}`}
                onClick={() => onOpenResearch?.()}
                className="block w-full rounded px-2 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <span className="flex items-baseline gap-2">
                  <FileText className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium capitalize text-gray-900 dark:text-gray-100">
                    {s.section.replace(/_/g, ' ')}
                  </span>
                  <span className="flex-none text-[10px] text-gray-400">{shortDate(s.at)}</span>
                </span>
                <span className="mt-0.5 line-clamp-1 pl-5 text-[11px] text-gray-500 dark:text-gray-400">
                  {s.content}
                </span>
              </button>
            ))}
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

      {/*
        ── Portfolios and lists are different things ─────────────────

        They were one section with a grey "LIST" / "PORTFOLIO" word at
        the end of each row to tell them apart. A book you hold the name
        in and a list you put it on are not the same kind of fact, and
        sorting them by eye down a mixed column is work the page should
        have done. Two sections, each with its own empty state and its
        own escape to the cross-asset app.
      */}
      <ConnectionGroup
        kind="portfolio"
        title="Portfolios"
        empty={`${symbol ?? 'This asset'} is not held in any book.`}
        rows={connections.filter(c => c.kind === 'portfolio')}
        loading={connectionsLoading}
        onOpen={onOpenConnection}
        onOpenAll={onOpenAll}
      />

      <ConnectionGroup
        kind="list"
        title="Lists"
        empty="Not on any list."
        rows={connections.filter(c => c.kind === 'list')}
        loading={connectionsLoading}
        onOpen={onOpenConnection}
        onOpenAll={onOpenAll}
      />

      <ConnectionGroup
        kind="theme"
        title="Themes"
        empty="Not in any theme."
        rows={connections.filter(c => c.kind === 'theme')}
        loading={connectionsLoading}
        onOpen={onOpenConnection}
        onOpenAll={onOpenAll}
        trailing={addActions}
      />

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
      {/* Not "Work overview": the asset already has an Overview mode in
          the nav directly above, so two different pages were called the
          overview and nothing said which was home. */}
      All work
    </button>
  )
}

