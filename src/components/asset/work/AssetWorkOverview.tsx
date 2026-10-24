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
  ArrowRight, Briefcase, FolderKanban, GitBranch, Lightbulb, List,
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

/**
 * What Work shows about research. Read-only; Research still owns writing.
 *
 * Notes only. This briefly also listed the investment case's own fields —
 * Business Model, Where Our Thesis Differs, and so on — each with the first
 * line of what it said. That was the wrong page for them: the case is a
 * document to read in Research, not a list of field names to skim in Work,
 * and rendering it twice made the two surfaces compete over which one was
 * the case. "Open research" is the handoff; these notes are the artifacts
 * Work genuinely needs to show, because they are produced while working.
 */
export interface OverviewResearch {
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

/**
 * Everywhere this asset can be put, under one control.
 *
 * Processes, lists, themes and projects were four controls in two
 * places. The three dialog buttons come in as a slot because each owns
 * its own dialog; the processes are rows because joining one is a
 * mutation this page already has.
 */
function AddMenu({
  joinable, onJoin, addActions,
}: {
  joinable: ReadonlyArray<{ id: string; name: string }>
  onJoin?: (workflowId: string) => void
  addActions?: React.ReactNode
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
        data-testid="work-overview-add"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title="Add this asset to a process, list, theme or project"
        className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
      </button>
      {open && (
        <div
          role="menu"
          data-testid="work-overview-add-menu"
          className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-[280px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {addActions && (
            <div
              className="flex flex-col items-start gap-0.5 px-1 pb-1"
              /* Each of these opens its own dialog and closes this. */
              onClick={() => setOpen(false)}
            >
              {addActions}
            </div>
          )}
          {joinable.length > 0 && onJoin && (
            <>
              <span className="block px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Add to a process
              </span>
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
            </>
          )}
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
    <div className={clsx('min-w-0', className)} data-testid="work-overview">
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
      {/*
        ── One "add", on the title row ───────────────────────────────

        "Add to a process" sat in the Processes heading and the three
        "Add to" dialogs sat at the foot of the Themes section — four
        ways to put this asset somewhere, in two places, neither of them
        where a reader looks for "add". They are one `+` beside the
        page's title.
      */}
      <header className="mb-4 flex flex-wrap items-baseline gap-x-2 border-b border-gray-200 pb-2 dark:border-gray-700">
        <h2 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
          All work on {symbol ?? 'this asset'}
        </h2>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          processes, research, lists and books, ideas — open one to work on it
        </span>
        {(addActions || (joinable.length > 0 && onJoin)) && (
          <span className="ml-auto flex-none self-center">
            <AddMenu
              joinable={joinable}
              onJoin={onJoin}
              addActions={addActions}
            />
          </span>
        )}
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
      {/* Three columns once there is room for them. Two left most of a
          1,920px screen empty; the sections are short lists and pack
          cleanly. */}
      <div className="gap-x-8 lg:columns-2 2xl:columns-3 [&>section]:mb-5 [&>section]:break-inside-avoid">

      {/* ── Processes ─────────────────────────────────────────────────── */}
      <section data-testid="work-overview-processes">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className={EYEBROW}>Processes</span>
          {/* Adding lives in the one "+" on the title row. */}
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

        One of the four things Work is for. The notes are read from the
        same `useAssetWorkspace` the requirement context uses — no new
        query — and click through to the Notes tab, which owns them.

        The investment case is NOT listed here. It lived here for one
        pass as a row per case field with the first line of each, which
        turned a document into a directory and put a second, worse copy
        of the case in front of the reader. "Open research" is the way
        to it; a case is read in Research.
      */}
      <section data-testid="work-overview-research">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className={EYEBROW}>Research notes</span>
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
        {research.notes.length > 0 ? (
          <div className="space-y-1">
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
            No research note written on {symbol ?? 'this asset'} yet.
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

