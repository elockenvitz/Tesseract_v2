/**
 * Desktop Ideas — the workspace.
 *
 * Two states, one surface, one at a time:
 *
 *   BROWSE   the gallery has the whole canvas — ticker, direction, maturity,
 *            a claim line, metrics, a small visual, what changed — enough to
 *            choose between Ideas without opening any of them.
 *   DETAIL   the chosen Idea has the whole canvas, and returning is one
 *            click back to where the reader was in the gallery.
 *
 * Earlier passes kept both on screen: a left rail, then a capped band above
 * the workspace. Both rationed the scan to make room for detail it was not
 * competing with. Neither question is served by half a screen.
 *
 * Ideas creates EngagementTargets and nothing else: Ask AI and Team both open
 * the existing CommunicationPane through the D1 seam. No AI component, no
 * message component, no comment system is defined here.
 */

import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
  useIdeaScan, useScanExposure, useScanFramework, useIdeaDetail,
} from '../../hooks/useDesktopIdeas'
import {
  scoreIdea, compareIdeas, subscribeToOpenIdea, MATURITY_LABEL, targetFor,
  type IdeaRow, type IdeaFocus,
} from '../../lib/desktop-ideas'
import { IdeaDetail } from './IdeaDetail'
import { IdeaCard, slotForRank } from './IdeaCard'
import { askAI } from '../../lib/engagement'
import {
  openDashboardFocus, type RailCard,
} from '../../lib/dashboard/focus'

export interface IdeasWorkspaceProps {
  /** Selection handed in by whoever opened this tab. */
  selectedIdeaId?: string | null
  focus?: IdeaFocus | null
  /** Why the user was sent here, shown so the reason is not lost in transit. */
  issue?: string | null
  /** Set by the Dashboard deck when this lens is the expanded workspace. */
  focusObjectId?: string | null
}

export function IdeasWorkspace({
  selectedIdeaId, focus, issue, focusObjectId,
}: IdeasWorkspaceProps = {}) {
  const { ideas, isLoading } = useIdeaScan()
  const exposure = useScanExposure(ideas)
  const [arrival, setArrival] = useState<{ focus?: IdeaFocus | null; issue?: string | null } | null>(
    selectedIdeaId ? { focus, issue } : null,
  )

  // A later hand-off into an already-open tab. The tab id is fixed, so
  // arriving from Today twice reuses this workspace and re-selects inside it
  // rather than stacking duplicate tabs.
  useEffect(() => {
    if (selectedIdeaId) setArrival({ focus, issue })
  }, [selectedIdeaId, focus, issue])

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

  /**
   * Selection lives in the deck. The ranking is untouched -- `ranked` is the
   * same list in the same order -- and it still decides which idea the reader
   * meets first. What it never does is open one on their behalf.
   */
  const activeId = focusObjectId ?? null
  const selected = activeId ? ranked.find(i => i.id === activeId) ?? null : null
  // One read for the whole gallery, so a tile can show where spot sits in the
  // desk's own ladder without costing a query per tile.
  const framework = useScanFramework(ranked)
  // Null while browsing, so the gallery costs one query however long the
  // reader stays in it.
  const { detail } = useIdeaDetail(selected)

  const open = (idea: IdeaRow) => openDashboardFocus({
    target: {
      originLens: 'ideas',
      workspaceLens: 'ideas',
      objectType: 'idea',
      objectId: idea.id,
      symbol: idea.symbol,
      label: idea.companyName,
      portfolioId: idea.portfolioId,
      portfolioName: idea.portfolioName,
      issue: MATURITY_LABEL[idea.maturity],
      origin: 'ideas',
    },
    backLabel: 'Ideas',
    rail: ranked.map(i => toRailCard(i, exposure[i.assetId ?? ''])),
  })

  useEffect(() => subscribeToOpenIdea(r => {
    const found = ranked.find(i => i.id === r.ideaId)
    if (found) open(found)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ranked])

  if (isLoading) return <Loading />
  if (!ranked.length) return <Empty />

  if (selected) {
    return (
      <IdeaDetail
        idea={selected}
        detail={detail}
        focus={arrival?.focus ?? null}
        arrivedFor={arrival?.issue ?? null}
      />
    )
  }

  /** Ask AI about one idea, without expanding it first. */
  const ask = (idea: IdeaRow) => {
    const target = targetFor(idea, undefined)
    if (target) askAI(target)
  }

  /**
   * One card, from its rank.
   *
   * Rank is the only input to the slot, and it is computed here so no region
   * can accidentally disagree with another about where an idea belongs.
   */
  const card = (idea: IdeaRow, rank: number) => (
    <IdeaCard
      key={idea.id}
      idea={idea}
      slot={slotForRank(rank)}
      frame={framework[idea.assetId ?? '']}
      weightPct={exposure[idea.assetId ?? '']}
      onOpen={() => open(idea)}
      onAskAI={() => ask(idea)}
    />
  )

  const cluster = ranked.slice(0, 3)
  const tier2 = ranked.slice(3, 5)
  const scan = ranked.slice(5, 9)
  const tail = ranked.slice(9)

  return (
    <div className="h-full overflow-y-auto" data-testid="ideas-lens">
      <div className="px-6 pb-10 pt-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-tight">Ideas</h1>
          <span className="font-mono text-[11px] text-gray-500">{ranked.length}</span>
        </div>
        <p className="mt-1.5 max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
          Active investment ideas, from ready-to-decide to early-stage.
        </p>

        {/*
          A priority field, in four regions.

          The top three share ONE surface: the lead on the left, the second and
          third stacked down the right. Stacking is the point -- when they sat
          in a single grid row a sparse second inherited the lead's height and
          became a large empty rectangle. Here each takes the height it needs.

          Below it a two-cell second tier, then an even scan row, then a
          tail of mini-tiles. Every region is emitted in rank order and placed
          by normal flow, so reading order, tab order and rank order are the
          same order.
        */}
        {cluster.length > 0 && (
          <section
            data-testid="idea-cluster"
            className="mt-4 grid grid-cols-1 overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] dark:border-white/[0.07] dark:bg-[#141a25]"
          >
            <div className="min-w-0 border-b border-gray-200/80 xl:border-b-0 xl:border-r dark:border-white/10">
              {card(cluster[0], 0)}
            </div>
            {cluster.length > 1 && (
              <div className="flex min-w-0 flex-col divide-y divide-gray-200/80 dark:divide-white/10">
                {cluster.slice(1).map((idea, i) => (
                  <div key={idea.id} className="min-w-0 flex-1">{card(idea, i + 1)}</div>
                ))}
              </div>
            )}
          </section>
        )}

        {tier2.length > 0 && (
          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-6 xl:grid-cols-9 2xl:grid-cols-12">
            {tier2.map((idea, i) => card(idea, i + 3))}
          </div>
        )}

        {scan.length > 0 && (
          <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {scan.map((idea, i) => card(idea, i + 5))}
          </div>
        )}

        {/* The tail. Not rows, and not a titled section either.
            The heading named the region as a second list of work, which is
            exactly the watchlist reading the rows had already created -- two
            reinforcing signals that the bottom of the page was a queue. One
            hairline and a change of scale say everything it did: the ranking
            continues, more quietly. */}
        {tail.length > 0 && (
          <div className="mt-8 border-t border-gray-200/70 pt-5 dark:border-white/[0.06]">
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 lg:grid-cols-3 2xl:grid-cols-4">
              {tail.map((idea, i) => card(idea, i + 9))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * An idea as a rail card.
 *
 * The claim is what distinguishes one belief from another, so it is the line
 * of substance. Direction and maturity are the state; nothing is coloured by
 * buy-versus-sell, which is a stance and not a severity.
 */
export function toRailCard(i: IdeaRow, weightPct?: number): RailCard {
  const deciding = i.maturity === 'deciding' || i.maturity === 'decision_ready'
  return {
    id: i.id,
    workspaceLens: 'ideas',
    objectType: 'idea',
    symbol: i.symbol,
    reason: `${i.direction ?? 'idea'} \u00b7 ${MATURITY_LABEL[i.maturity]}`,
    tone: deciding ? 'review' : 'neutral',
    figure: i.proposedWeight != null ? `${i.proposedWeight.toFixed(1)}%`
      : weightPct != null ? `${weightPct.toFixed(1)}%` : null,
    figureLabel: i.proposedWeight != null ? 'proposed' : weightPct != null ? 'held' : null,
    // Proposed against held is the whole shape of a sizing decision, and both
    // are already in hand. Never shown twice as the same number.
    secondary: i.proposedWeight != null && weightPct != null
      ? { value: `${weightPct.toFixed(1)}%`, label: 'held' }
      : null,
    detail: i.thesis ?? 'No claim written yet',
    portfolioId: i.portfolioId,
    portfolioName: i.portfolioName,
    issue: MATURITY_LABEL[i.maturity],
  }
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
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <h1 className="text-[19px] font-semibold tracking-tight">Ideas</h1>
      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
        <Sparkles className="mx-auto h-7 w-7 text-gray-400" />
        <h2 className="mt-4 text-[17px] font-semibold">No open ideas</h2>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[12px] text-gray-600 dark:text-gray-400">
          Ideas appear here from the moment someone raises one, through research and
          thesis to a decision. Nothing is currently open.
        </p>
      </div>
    </div>
  )
}
