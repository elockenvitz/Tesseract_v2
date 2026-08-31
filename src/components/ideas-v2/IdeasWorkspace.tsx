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
  subscribeToOpenIdea, type IdeaRow, type IdeaFocus,
} from '../../lib/desktop-ideas'
import { IdeaVisual } from './IdeaVisual'
import {
  DirectionPill, MaturityPill, ConvictionPill, IdeaIdentity,
  Metric, MetricStrip, EvolutionStrip,
} from './IdeaChrome'
import { IdeaDetail } from './IdeaDetail'
import {
  DesktopNavigator, DesktopNavRow, NavSymbol, NavQualifier, NavTrailing, NavMeta,
} from '../desktop/DesktopNavigator'

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

  // Entry goes straight into the workspace on the highest-ranked idea. The
  // ranking is untouched -- `ranked` is the same list in the same order; only
  // the intermediate grid, which read as a queue to work through, is gone.
  const selected = ranked.find(i => i.id === selectedId) ?? ranked[0] ?? null
  const { detail } = useIdeaDetail(selected)

  if (isLoading) return <Loading />
  if (!ranked.length || !selected) return <Empty />

  return (
    <div className="flex h-full overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <DesktopNavigator title="Ideas" count={ranked.length}>
        {ranked.map(idea => (
          <NavRow
            key={idea.id}
            idea={idea}
            weightPct={exposure[idea.assetId ?? '']}
            selected={idea.id === selected.id}
            onSelect={() => select(idea.id)}
          />
        ))}
      </DesktopNavigator>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <IdeaDetail idea={selected} detail={detail} focus={arrival?.focus ?? null} arrivedFor={arrival?.issue ?? null} />
      </div>
    </div>
  )
}



/* ---------------------------------------------------------------- nav tile */

/**
 * One idea in the index.
 *
 * Symbol, stance, maturity, book. The portfolio is on its own line rather than
 * squeezed to the right of the weight, because a multi-portfolio idea read
 * against the wrong book is the failure this surface most needs to prevent.
 */
function NavRow({
  idea, weightPct, selected, onSelect,
}: { idea: IdeaRow; weightPct?: number; selected: boolean; onSelect: () => void }) {
  return (
    <DesktopNavRow
      testId="idea-nav-row"
      dataAttrs={{ 'data-maturity': idea.maturity }}
      selected={selected}
      onSelect={onSelect}
      title={<>
        <NavSymbol>{idea.symbol ?? '—'}</NavSymbol>
        {idea.direction && <NavQualifier>{idea.direction}</NavQualifier>}
      </>}
      trailing={weightPct != null ? <NavTrailing>{weightPct.toFixed(1)}%</NavTrailing> : undefined}
    >
      <div className="mt-1 flex items-center gap-1.5">
        <MaturityPill maturity={idea.maturity} />
        <NavMeta>{idea.portfolioName ?? 'No portfolio'}</NavMeta>
      </div>
    </DesktopNavRow>
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
