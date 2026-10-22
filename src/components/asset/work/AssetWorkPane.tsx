/**
 * Work — the current-activity view of one asset.
 *
 * ── Why one pane and not three stacked panels ────────────────────────────
 *
 * The first sketch was three independent vertical bands. Rejected, correctly:
 * an asset with one open idea and a half-finished checklist would render
 * three large containers to say very little, and the reader would scroll past
 * the thing that needed them. This is one pane whose areas COLLAPSE to a line
 * each and expand on demand, so the page is as big as the work is.
 *
 * ── Work is not "not-History" ────────────────────────────────────────────
 *
 * Work is the current-activity perspective; History is the chronological
 * record. The same row legitimately appears in both — a recommendation
 * submitted this morning is live work AND an event that happened. Nothing
 * here moves rows between the two, and nothing is hidden from History because
 * it is still open.
 *
 * ── Contracts, not new models ────────────────────────────────────────────
 *
 * Every prop is a shape that already exists: decision requests split by
 * `splitAttention` (portfolio_team pm/admin), ideas carrying the canonical
 * stage, and the workflow summary the Process tab already renders. This
 * component creates no state and invents no association — the Research links
 * it shows are the ones the caller could prove.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, ExternalLink, AlertTriangle, Clock } from 'lucide-react'
import { stageLabel, stageColor, IDEA_STAGES, IDEA_STAGE_CONFIG, toIdeaStage } from '../../../lib/ideas/stage-model'
import { attentionSummary, type AttentionSplit } from '../../../lib/asset-work/attention'

export interface WorkAttentionItem {
  id: string
  /** 'buy' | 'sell' | 'add' | 'trim' — as stored. */
  action?: string | null
  portfolioName?: string | null
  requesterName?: string | null
  contextNote?: string | null
  createdAgo?: string | null
}

export interface WorkIdea {
  id: string
  action?: string | null
  /** Raw stored stage; normalized for display, never rendered raw. */
  stage: string
  rationale?: string | null
  portfolioName?: string | null
  updatedAgo?: string | null
}

export interface WorkProcess {
  workflowName: string
  /**
   * Completion counts are OPTIONAL and omitted rather than guessed.
   *
   * Per-asset checklist completion is computed inside InvestmentTimeline, and
   * reaching for it here would mean a second fetch of the same rows. Until
   * that computation is lifted into something both surfaces can call, this
   * summary names the stages it can prove and sends the reader to the Process
   * tab for progress — which is honest, where "0/5" on unfetched data is not.
   */
  stages: { id: string; label: string; done?: number; total?: number; active: boolean }[]
  openStageLabel: string | null
  openStageDone?: number
  openStageTotal?: number
  assigneeName?: string | null
  deadline?: string | null
  priorityLabel?: string | null
}

/** "Expectations 2/5", or just "Expectations" when progress is not known. */
function stageProgressLabel(s: { label: string; done?: number; total?: number }): string {
  return s.total != null && s.done != null ? `${s.label} ${s.done}/${s.total}` : s.label
}

/** A link the caller could PROVE — a section with evidence attached, or a
 *  contribution this work references. Never inferred from a ticker match. */
export interface WorkResearchLink {
  key: string
  label: string
  detail?: string | null
  onOpen: () => void
}

export interface AssetWorkPaneProps {
  attention: AttentionSplit<WorkAttentionItem>
  ideas: WorkIdea[]
  process: WorkProcess | null
  researchLinks: WorkResearchLink[]
  /** Opens the existing idea experience. The caller supplies it so this
   *  component does not own navigation. */
  onOpenIdeas: () => void
  onOpenIdea?: (ideaId: string) => void
  /** Opens the full Process surface, which keeps all of its existing
   *  controls — checklists, assignees, deadlines, priority. */
  onOpenProcess?: () => void
  onNewIdea?: () => void
  onStartProcess?: () => void
  isLoading?: boolean
  className?: string
}

/** A collapsible area. Summary always visible; detail on demand. */
function Area({
  id, title, summary, defaultOpen = false, tone = 'plain', children,
}: {
  id: string
  title: string
  summary: string | null
  defaultOpen?: boolean
  tone?: 'plain' | 'urgent'
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section
      data-testid={`work-area-${id}`}
      className={clsx(
        'rounded-lg border',
        tone === 'urgent'
          ? 'border-amber-300/70 bg-amber-50/50 dark:border-amber-400/30 dark:bg-amber-500/[0.06]'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={`work-panel-${id}`}
        data-testid={`work-toggle-${id}`}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />}
        <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{title}</span>
        {summary && (
          <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{summary}</span>
        )}
      </button>
      {open && (
        <div id={`work-panel-${id}`} data-testid={`work-panel-${id}`} className="border-t border-gray-100 px-3 py-2 dark:border-gray-700">
          {children}
        </div>
      )}
    </section>
  )
}

export function AssetWorkPane({
  attention, ideas, process, researchLinks,
  onOpenIdeas, onOpenIdea, onOpenProcess, onNewIdea, onStartProcess,
  isLoading = false, className,
}: AssetWorkPaneProps) {
  const attnSummary = attentionSummary(attention)
  const hasAttention = attnSummary !== null
  const hasIdeas = ideas.length > 0
  const hasProcess = !!process

  if (isLoading) {
    return (
      <div className={clsx('space-y-2', className)} data-testid="work-loading">
        {[0, 1].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />)}
      </div>
    )
  }

  /* Nothing at all: one line and two entry points, not three empty cards. */
  if (!hasAttention && !hasIdeas && !hasProcess) {
    return (
      <div
        data-testid="work-empty"
        className={clsx('rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center dark:border-gray-700', className)}
      >
        <p className="text-[13px] text-gray-500 dark:text-gray-400">No active work on this asset.</p>
        <div className="mt-2 flex items-center justify-center gap-2">
          {onNewIdea && (
            <button type="button" onClick={onNewIdea} data-testid="work-new-idea"
              className="rounded px-2.5 py-1 text-[11px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100">
              New trade idea
            </button>
          )}
          {onStartProcess && (
            <button type="button" onClick={onStartProcess} data-testid="work-start-process"
              className="rounded px-2.5 py-1 text-[11px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800">
              Start a process
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-2', className)} data-testid="work-pane">
      {/*
        Attention is ABSENT when nothing is waiting, not empty. An "0 items"
        row in the one place meant to interrupt you teaches you to skip it.
        It opens by default, because its whole purpose is to be seen.
      */}
      {hasAttention && (
        <Area id="attention" title="Attention" summary={attnSummary} defaultOpen tone="urgent">
          {attention.needsYourAction.length > 0 && (
            <div data-testid="work-needs-you">
              <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Needs your action
              </p>
              <ul className="space-y-1">
                {attention.needsYourAction.map(r => (
                  <li key={r.id} data-testid={`work-attention-you-${r.id}`}
                      className="flex items-baseline gap-2 text-[12px] text-gray-800 dark:text-gray-200">
                    <span className="font-semibold uppercase">{r.action ?? 'request'}</span>
                    <span className="min-w-0 flex-1 truncate">{r.contextNote ?? 'Decision requested'}</span>
                    <span className="shrink-0 text-[10px] text-gray-500">
                      {[r.portfolioName, r.requesterName, r.createdAgo].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {attention.awaitingOthers.length > 0 && (
            <div className={clsx(attention.needsYourAction.length > 0 && 'mt-2')} data-testid="work-awaiting-others">
              <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <Clock className="h-3 w-3" aria-hidden="true" /> Awaiting others
              </p>
              <ul className="space-y-1">
                {attention.awaitingOthers.map(r => (
                  <li key={r.id} data-testid={`work-attention-other-${r.id}`}
                      className="flex items-baseline gap-2 text-[12px] text-gray-600 dark:text-gray-400">
                    <span className="font-semibold uppercase">{r.action ?? 'request'}</span>
                    <span className="min-w-0 flex-1 truncate">{r.contextNote ?? 'Decision requested'}</span>
                    <span className="shrink-0 text-[10px] text-gray-400">
                      {[r.portfolioName, r.createdAgo].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Area>
      )}

      {/* Active ideas — canonical stages only; the chip is maturity, never urgency. */}
      <Area
        id="ideas"
        title="Active ideas"
        summary={hasIdeas ? `${ideas.length}` : 'none open'}
        defaultOpen={hasIdeas && !hasAttention}
      >
        {hasIdeas ? (
          <>
            <div className="mb-2 flex flex-wrap gap-1" data-testid="work-stage-rail">
              {IDEA_STAGES.map(s => {
                const n = ideas.filter(i => toIdeaStage(i.stage) === s).length
                return (
                  <span key={s} data-testid={`work-stage-${s}`}
                        className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          n > 0 ? IDEA_STAGE_CONFIG[s].color : 'bg-gray-50 text-gray-400 dark:bg-gray-800')}>
                    {IDEA_STAGE_CONFIG[s].label} {n}
                  </span>
                )
              })}
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {ideas.map(i => (
                <li key={i.id}>
                  <button
                    type="button"
                    data-testid={`work-idea-${i.id}`}
                    onClick={() => (onOpenIdea ? onOpenIdea(i.id) : onOpenIdeas())}
                    className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    <span className="shrink-0 text-[10px] font-bold uppercase text-gray-500">{i.action ?? ''}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-gray-900 dark:text-gray-100">
                      {i.rationale || 'No rationale'}
                    </span>
                    <span className={clsx('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', stageColor(i.stage))}>
                      {stageLabel(i.stage)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onOpenIdeas} data-testid="work-open-pipeline"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline">
              {/* "Open in Ideas", because that is what it does: the existing
                  handoff opens the Ideas pipeline filtered to this asset. It
                  would be called "Open idea" only once a verified per-idea
                  route exists; naming one that does not is how a label starts
                  promising a screen nobody built. */}
              Open in Ideas <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </button>
          </>
        ) : (
          <p className="py-1 text-[12px] text-gray-500 dark:text-gray-400">
            No open ideas.{' '}
            {onNewIdea && (
              <button type="button" onClick={onNewIdea} data-testid="work-new-idea"
                className="font-medium text-primary-600 hover:underline">New trade idea</button>
            )}
          </p>
        )}
      </Area>

      {/* Process — a summary that opens into the FULL existing surface. */}
      <Area
        id="process"
        title="Investment process"
        /*
          The open stage is named only when it is KNOWN. Defaulting it to
          "no open stage" claimed a fact — and claimed it wrongly on every
          asset whose stage simply had not been fetched. An unknown is
          silence, not a negative.
        */
        summary={process
          ? [
              process.workflowName,
              process.openStageLabel
                ? stageProgressLabel({
                    label: process.openStageLabel,
                    done: process.openStageDone,
                    total: process.openStageTotal,
                  })
                : null,
              process.deadline ? `due ${process.deadline}` : null,
            ].filter(Boolean).join(' · ')
          : 'none running'}
        defaultOpen={hasProcess && !hasAttention && !hasIdeas}
      >
        {process ? (
          <>
            <div className="mb-2 flex flex-wrap gap-1" data-testid="work-process-stages">
              {process.stages.map(s => (
                <span key={s.id} data-testid={`work-process-stage-${s.id}`}
                      className={clsx('rounded px-2 py-0.5 text-[10px] font-medium',
                        s.active
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300')}>
                  {stageProgressLabel(s)}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {[
                process.assigneeName && `Assigned to ${process.assigneeName}`,
                process.deadline && `Due ${process.deadline}`,
                process.priorityLabel && `Priority ${process.priorityLabel}`,
              ].filter(Boolean).join(' · ') || 'No assignee, deadline or priority set.'}
            </p>
            {process.stages.every(s => s.total == null) && (
              <p className="mt-0.5 text-[11px] text-gray-400" data-testid="work-process-no-progress">
                Checklist progress has not loaded yet.
              </p>
            )}
            {/* The compact summary never replaces the full surface — checklists,
                assignment, deadlines and priority all live there, unchanged.
                In Work that surface is the section directly below, so this is
                a jump down the page, not a route: a downward chevron, not the
                external-link glyph it used to carry. */}
            <button type="button" onClick={onOpenProcess} data-testid="work-open-process"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline">
              Go to the process <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          </>
        ) : (
          <p className="py-1 text-[12px] text-gray-500 dark:text-gray-400">
            No process running.{' '}
            {onStartProcess && (
              <button type="button" onClick={onStartProcess} data-testid="work-start-process"
                className="font-medium text-primary-600 hover:underline">Start a process</button>
            )}
          </p>
        )}
      </Area>

      {/*
        Research links appear only when the caller could PROVE a relationship —
        a section with evidence attached, a contribution this work cites.
        Nothing is inferred from a shared ticker.
      */}
      {researchLinks.length > 0 && (
        <Area id="research" title="Related research" summary={`${researchLinks.length}`}>
          <ul className="space-y-1">
            {researchLinks.map(l => (
              <li key={l.key}>
                <button type="button" onClick={l.onOpen} data-testid={`work-research-${l.key}`}
                  className="flex w-full items-baseline gap-2 py-1 text-left text-[12px] text-primary-700 hover:underline dark:text-primary-400">
                  <span className="min-w-0 flex-1 truncate">{l.label}</span>
                  {l.detail && <span className="shrink-0 text-[10px] text-gray-400">{l.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Area>
      )}
    </div>
  )
}
