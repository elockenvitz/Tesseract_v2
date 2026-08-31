/**
 * Desktop Ideas — the workspace.
 *
 * Two states, one surface:
 *
 *   nothing selected  a rich scan across the full width
 *   an Idea selected  a persistent visual navigator (~28%) beside the
 *                     selected Idea's workspace (~72%)
 *
 * The navigator is what stops this being a gallery you leave and re-enter. It
 * stays tiles — ticker, direction, maturity, a claim line, metrics, a small
 * visual, what changed — so the next Idea can be chosen without opening it.
 *
 * Ideas creates EngagementTargets and nothing else: Ask AI and Team both open
 * the existing CommunicationPane through the D1 seam. No AI component, no
 * message component, no comment system is defined here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, MoreHorizontal, Sparkles } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { useIdeaScan, useScanExposure, useIdeaDetail } from '../../hooks/useDesktopIdeas'
import {
  familyFor, primaryActionFor, targetFor, scoreIdea, compareIdeas,
  subscribeToOpenIdea, IDEA_TIER_LABEL, type IdeaRow, type IdeaFocus,
} from '../../lib/desktop-ideas'
import { IdeaVisual } from './IdeaVisual'
import {
  DirectionPill, MaturityPill, ConvictionPill, IdeaIdentity,
  Metric, MetricStrip, EvolutionStrip,
} from './IdeaChrome'
import { IdeaDetail } from './IdeaDetail'

export interface IdeasWorkspaceProps {
  /** Selection handed in by whoever opened this tab. */
  selectedIdeaId?: string | null
  focus?: IdeaFocus | null
  /** Why the user was sent here, shown so the reason is not lost in transit. */
  issue?: string | null
}

export function IdeasWorkspace({ selectedIdeaId, focus, issue }: IdeasWorkspaceProps = {}) {
  const { ideas, isLoading } = useIdeaScan()
  const exposure = useScanExposure(ideas)
  const [selectedId, setSelectedId] = useState<string | null>(selectedIdeaId ?? null)
  const [arrival, setArrival] = useState<{ focus?: IdeaFocus | null; issue?: string | null } | null>(
    selectedIdeaId ? { focus, issue } : null,
  )

  // A later hand-off into an already-open tab. The tab id is fixed, so
  // arriving from Today twice reuses this workspace and re-selects inside it
  // rather than stacking duplicate tabs.
  useEffect(() => {
    if (selectedIdeaId) { setSelectedId(selectedIdeaId); setArrival({ focus, issue }) }
  }, [selectedIdeaId, focus, issue])

  useEffect(() => subscribeToOpenIdea(r => {
    setSelectedId(r.ideaId)
    setArrival({ focus: r.focus, issue: r.issue })
  }), [])

  // Choosing an idea by hand clears the arrival banner — the reason someone
  // else sent you here does not apply to the one you picked yourself.
  const select = (id: string) => { setSelectedId(id); setArrival(null) }

  const ranked = useMemo(() => {
    const now = Date.now()
    return ideas
      .map(idea => ({
        idea,
        id: idea.id,
        rank: scoreIdea(idea, { weightPct: exposure[idea.assetId ?? ''] }, now),
      }))
      .sort(compareIdeas)
      .map(r => r.idea)
  }, [ideas, exposure])

  const selected = ranked.find(i => i.id === selectedId) ?? null
  const { detail } = useIdeaDetail(selected)

  if (isLoading) return <Loading />
  if (!ranked.length) return <Empty />

  if (!selected) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/60 pb-12 dark:bg-[#0b0f16]">
        <Header count={ranked.length} />
        <div className="grid grid-cols-1 gap-3.5 px-6 pt-4 md:grid-cols-2 xl:grid-cols-3">
          {ranked.map(idea => (
            <ScanTile
              key={idea.id}
              idea={idea}
              weightPct={exposure[idea.assetId ?? '']}
              onOpen={() => select(idea.id)}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <aside className="h-full w-[28%] min-w-[260px] shrink-0 overflow-y-auto border-r border-gray-200 px-3 py-3 dark:border-white/10">
        <div className="mb-2 flex items-center gap-2 px-1">
          <h2 className="text-[12px] font-semibold">Ideas</h2>
          <span className="font-mono text-[10.5px] text-gray-500">{ranked.length}</span>
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            Full scan
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {ranked.map(idea => (
            <NavTile
              key={idea.id}
              idea={idea}
              weightPct={exposure[idea.assetId ?? '']}
              selected={idea.id === selected.id}
              onSelect={() => select(idea.id)}
            />
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <IdeaDetail idea={selected} detail={detail} focus={arrival?.focus ?? null} arrivedFor={arrival?.issue ?? null} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ header */

function Header({ count }: { count: number }) {
  return (
    <header className="px-6 pt-6">
      <h1 className="text-[21px] font-semibold tracking-tight">Ideas</h1>
      <p className="mt-1 max-w-[66ch] text-[12.5px] text-gray-600 dark:text-gray-400">
        What we believe, how mature each belief is, and what would move it forward.
        Ordered by decision readiness, then by what has changed and what it is worth.
      </p>
      <div className="mt-3 flex items-center gap-2.5 text-[11.5px] text-gray-500">
        <strong className="font-semibold text-gray-700 dark:text-gray-300">{count} open</strong>
        <span className="text-gray-300 dark:text-gray-700">·</span>
        <span>closed and rejected ideas are not shown</span>
      </div>
    </header>
  )
}

/* --------------------------------------------------------------- scan tile */

function ScanTile({
  idea, weightPct, onOpen,
}: { idea: IdeaRow; weightPct?: number; onOpen: () => void }) {
  // The scan is deliberately un-enriched: no per-card history or ladder fetch.
  // Family therefore resolves from what the row itself carries.
  const family = familyFor(idea, { weightPct })
  const target = targetFor(idea, { weightPct })
  const primary = primaryActionFor(idea, { weightPct })

  const metrics: { value: string; label: string }[] = []
  if (weightPct != null) metrics.push({ value: `${weightPct.toFixed(1)}%`, label: 'Weight' })
  if (idea.proposedWeight != null) metrics.push({ value: `${idea.proposedWeight.toFixed(1)}%`, label: 'Proposed' })
  if (idea.conviction) metrics.push({ value: idea.conviction, label: 'Conviction' })

  return (
    <article
      data-testid="idea-scan-tile"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-white/[0.08] dark:bg-[#141a25]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <DirectionPill direction={idea.direction} />
        <MaturityPill maturity={idea.maturity} />
        {metrics.length < 2 && <ConvictionPill conviction={idea.conviction} />}
        <span className="ml-auto truncate text-[10px] text-gray-500">
          {idea.portfolioName ?? idea.authorName ?? ''}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 px-3.5 pt-2.5">
        <IdeaIdentity symbol={idea.symbol} company={idea.companyName} />

        {idea.thesis ? (
          <p className="line-clamp-3 text-[12.5px] leading-snug text-gray-700 dark:text-gray-300">
            {idea.thesis}
          </p>
        ) : (
          <p className="text-[12px] italic leading-snug text-gray-500">
            No thesis written yet.
          </p>
        )}

        {/*
          A strip is only worth its height when it carries more than one fact.
          Most scan rows have no exposure and no proposed size, and a single
          cell reading "high / CONVICTION" in a full-width tray looks broken.
          Below two real metrics the conviction moves into the chrome instead.
        */}
        {metrics.length >= 2 ? (
          <MetricStrip>
            {metrics.map(m => <Metric key={m.label} value={m.value} label={m.label} />)}
          </MetricStrip>
        ) : null}

        <EvolutionStrip idea={idea} />
      </div>

      <div className="flex flex-wrap items-center gap-1 px-3.5 pb-2.5 pt-2.5">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
        >
          {primary ?? 'Open idea'}
          <ArrowRight className="h-3.5 w-3.5 opacity-70" />
        </button>
        {target && (
          <button
            type="button"
            onClick={() => askAI(target)}
            className="inline-flex items-baseline gap-1.5 rounded-md px-2.5 py-2 text-[12px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
          >
            Ask AI
            <span className="font-mono text-[10.5px] opacity-75">{target.contextChips?.length ?? 0}</span>
          </button>
        )}
        <span className="ml-auto font-mono text-[9.5px] uppercase tracking-wide text-gray-400">
          {IDEA_TIER_LABEL[scoreIdea(idea, { weightPct }).tier]}
        </span>
      </div>
    </article>
  )
}

/* ---------------------------------------------------------------- nav tile */

function NavTile({
  idea, weightPct, selected, onSelect,
}: { idea: IdeaRow; weightPct?: number; selected: boolean; onSelect: () => void }) {
  return (
    <div
      data-testid="idea-nav-tile"
      role="button"
      tabIndex={0}
      aria-current={selected}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={clsx(
        // flex:none matters — the navigator is a flex column and the default
        // shrink would crush every tile to its chrome band.
        'flex-none cursor-pointer overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow dark:bg-[#141a25]',
        selected
          ? 'border-blue-600 shadow-[0_0_0_1px_theme(colors.blue.600)] dark:border-blue-500'
          : 'border-gray-200 hover:shadow-md dark:border-white/[0.08]',
      )}
    >
      <div className={clsx(
        'flex items-center gap-1.5 border-b px-2.5 py-1.5',
        selected
          ? 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30'
          : 'border-gray-200/80 bg-gray-50/80 dark:border-white/10 dark:bg-white/[0.03]',
      )}>
        <span className="font-mono text-[13px] font-bold tracking-tight">{idea.symbol ?? '—'}</span>
        <DirectionPill direction={idea.direction} />
        {weightPct != null && (
          <span className="ml-auto font-mono text-[10px] text-gray-500">{weightPct.toFixed(1)}%</span>
        )}
      </div>
      <div className="flex flex-col items-start gap-1.5 px-2.5 py-2">
        {/* items-start matters: a flex column stretches its children, which
            made every pill a full-width grey bar. */}
        <MaturityPill maturity={idea.maturity} />
        {idea.thesis && (
          <p className="line-clamp-2 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
            {idea.thesis}
          </p>
        )}
        <EvolutionStrip idea={idea} />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- states */

function Loading() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <div className="h-8 w-40 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
      <div className="mt-5 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-56 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-[#141a25]" />
        ))}
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 dark:bg-[#0b0f16]">
      <Header count={0} />
      <div className="mx-6 mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
        <Sparkles className="mx-auto h-7 w-7 text-gray-400" />
        <h2 className="mt-4 text-[17px] font-semibold">No open ideas</h2>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[12.5px] text-gray-600 dark:text-gray-400">
          Ideas appear here from the moment someone raises one, through research and
          thesis to a decision. Nothing is currently open.
        </p>
      </div>
    </div>
  )
}
