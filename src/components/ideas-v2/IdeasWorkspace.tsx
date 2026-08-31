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
  useIdeaScan, useScanExposure, useScanFramework, useIdeaDetail, type ScanFrame,
} from '../../hooks/useDesktopIdeas'
import type { SemanticTone } from '../../lib/semantic-tone'
import {
  scoreIdea, compareIdeas, subscribeToOpenIdea, MATURITY_LABEL,
  type IdeaRow, type IdeaFocus,
} from '../../lib/desktop-ideas'
import { DirectionPill, MaturityPill } from './IdeaChrome'
import { IdeaDetail } from './IdeaDetail'
import {
  DesktopGallery, DesktopTile, TileIdentity, TileClaim, TileMeta,
  TileVisual, TileBar, TileScale, TileGap, TileFigure,
  sizeByRank, type TileSize,
} from '../desktop/DesktopTile'
import {
  openDashboardFocus, railAround, type RailCard,
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
  const maxWeight = ranked.reduce((m, i) => Math.max(m, exposure[i.assetId ?? ''] ?? 0), 0)
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
    rail: railAround(ranked, idea.id, i => toRailCard(i, exposure[i.assetId ?? ''])),
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

  return (
    <div className="h-full overflow-y-auto" data-testid="ideas-lens">
      <DesktopGallery
        title="Ideas"
        count={ranked.length}
        note={
          <p className="max-w-[74ch] text-[12.5px] text-gray-600 dark:text-gray-400">
            What we believe, how mature each belief is, and what would move it
            forward. Ordered by decision readiness, then by what has changed.
          </p>
        }
      >
        {ranked.map((idea, i) => (
          <IdeaTile
            key={idea.id}
            idea={idea}
            weightPct={exposure[idea.assetId ?? '']}
            maxWeight={maxWeight}
            frame={framework[idea.assetId ?? '']}
            // Rank decides room. Emitted in rank order, placed by normal grid
            // flow, so what reads first IS what ranks first.
            size={sizeByRank(i, ranked.length)}
            onOpen={() => open(idea)}
          />
        ))}
      </DesktopGallery>
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
    figureLabel: i.proposedWeight != null ? 'proposed' : weightPct != null ? 'held today' : null,
    detail: i.thesis ?? 'No claim written yet',
    portfolioId: i.portfolioId,
    portfolioName: i.portfolioName,
    issue: MATURITY_LABEL[i.maturity],
  }
}

/**
 * One idea in the field.
 *
 * ── The belief is the tile ───────────────────────────────────────────────
 *
 * Every Idea has a stance, a maturity, a book and an author, so a tile built
 * out of those four is the same rectangle six times with different strings in
 * it. The one thing that differs is what the person actually claimed, and it
 * was previously set two points smaller than the metadata around it.
 *
 * ── Size is rank, and rank alone ─────────────────────────────────────────
 *
 * A hero is the idea most ready to be decided, whatever it happens to have to
 * draw. A sparse hero gets room for its claim at reading size; it does not get
 * demoted for lacking a ladder, and it never gets a chart invented for it.
 *
 * ── One visual, only where the desk has already earned it ────────────────
 *
 * Ladder beats target beats position, because that is the order in which they
 * explain the idea: where the case says price should go, then where one number
 * says it should go, then how much of it we already own.
 */
function IdeaTile({
  idea, weightPct, maxWeight, frame, size, onOpen,
}: {
  idea: IdeaRow
  weightPct?: number
  maxWeight: number
  frame?: ScanFrame
  size: TileSize
  onOpen: () => void
}) {
  const rung = (name: string) => frame?.ladder?.find(c => c.name === name)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull')
  const spot = frame?.spot ?? null

  // An idea whose decision is outstanding is work, not a break: amber, never
  // rose. Nothing in Ideas is a capital-risk state.
  const tone: SemanticTone =
    idea.maturity === 'deciding' || idea.maturity === 'decision_ready' ? 'review' : 'neutral'

  const visual =
    bear != null && bull != null && spot != null
      ? <TileScale low={bear} high={bull} spot={spot} outside={spot > bull || spot < bear} />
      : frame?.target != null && spot != null
        ? <TileGap spot={spot} target={frame.target} label="Spot vs target" />
        : weightPct != null
          ? <TileBar pct={weightPct} max={maxWeight} label="Position today" />
          : null

  return (
    <DesktopTile
      testId="idea-tile"
      dataAttrs={{ 'data-maturity': idea.maturity }}
      tone={tone}
      size={size}
      onOpen={onOpen}
      eyebrow={<>
        <DirectionPill direction={idea.direction} />
        <MaturityPill maturity={idea.maturity} />
        {idea.proposedWeight != null && (
          <TileFigure>{idea.proposedWeight.toFixed(1)}% proposed</TileFigure>
        )}
      </>}
    >
      <TileIdentity symbol={idea.symbol} name={idea.companyName} size={size} />

      {idea.thesis
        ? <TileClaim size={size}>{idea.thesis}</TileClaim>
        : <p className="text-[12px] italic leading-snug text-gray-500">
            No claim has been written yet — that is the work this idea is waiting on.
          </p>}

      {/* Compact tiles carry one figure and no chart: at that size a scale is
          four unreadable pixels, and the number is the whole of what a reader
          can use while scanning. */}
      {size === 'compact' ? (
        <TileMeta>
          <span className="font-medium text-gray-600 dark:text-gray-400">
            {idea.portfolioName ?? 'No portfolio'}
          </span>
          {weightPct != null && (
            <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">
              {weightPct.toFixed(1)}% held
            </span>
          )}
        </TileMeta>
      ) : (
        <>
          <TileMeta>
            <span className="font-medium text-gray-600 dark:text-gray-400">
              {idea.portfolioName ?? 'No portfolio'}
            </span>
            {idea.authorName && <span>{idea.authorName}</span>}
            {idea.conviction === 'high' && <span className="font-semibold">High conviction</span>}
          </TileMeta>
          {visual && <TileVisual>{visual}</TileVisual>}
        </>
      )}
    </DesktopTile>
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
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <h1 className="text-[19px] font-semibold tracking-tight">Ideas</h1>
      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
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
