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
  useIdeaScan, useScanExposure, useScanFramework, useScanOpenPrice, useIdeaDetail,
} from '../../hooks/useDesktopIdeas'
import {
  scoreIdea, compareIdeas, subscribeToOpenIdea, MATURITY_LABEL, targetFor,
  type IdeaRow, type IdeaFocus,
} from '../../lib/desktop-ideas'
import { IdeaDetail } from './IdeaDetail'
import { IdeaCard, densityForRank } from './IdeaCard'
import { askAI, canDiscuss, discuss } from '../../lib/engagement'
import {
  openDashboardFocus, type FocusIntent, type RailCard,
} from '../../lib/dashboard/focus'

/**
 * The two vocabularies, translated at the boundary rather than merged.
 *
 * `FocusIntent` is what the Dashboard shell carries between any lens and any
 * workspace. `IdeaFocus` is what THIS workspace already understood before the
 * shell existed, and what `IdeaDetail` keys its emphasis off. They are not the
 * same list and should not become one: `book` means a position to Ideas and a
 * portfolio panel to Research, and collapsing them would make one lens wrong.
 *
 * Only the parts an Ideas card can actually raise appear here. An intent with
 * no destination behaviour is not translated, so it degrades to the overview
 * rather than silently naming a section that will not move.
 */
const INTENT_FOR: Partial<Record<IdeaFocus, FocusIntent>> = {
  thesis: 'claim',
  framework: 'framework',
  performance: 'price',
  portfolio: 'book',
}

const FOCUS_FOR: Partial<Record<FocusIntent, IdeaFocus>> = {
  claim: 'thesis',
  framework: 'framework',
  price: 'performance',
  book: 'portfolio',
}

export interface IdeasWorkspaceProps {
  /** Selection handed in by whoever opened this tab. */
  selectedIdeaId?: string | null
  focus?: IdeaFocus | null
  /** Why the user was sent here, shown so the reason is not lost in transit. */
  issue?: string | null
  /** Set by the Dashboard deck when this lens is the expanded workspace. */
  focusObjectId?: string | null
  /** Which part of the idea the reader reached for, in the shell's terms. */
  intent?: FocusIntent
}

export function IdeasWorkspace({
  selectedIdeaId, focus, issue, focusObjectId, intent,
}: IdeasWorkspaceProps = {}) {
  const { ideas, isLoading } = useIdeaScan()
  const exposure = useScanExposure(ideas)
  const openPrice = useScanOpenPrice(ideas)
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
        rank: scoreIdea(idea, { weightPct: exposure[idea.assetId ?? '']?.pct }, now),
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

  const open = (idea: IdeaRow, focus?: IdeaFocus) => openDashboardFocus({
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
      /*
       * Which part of the idea, carried on the shell's own seam.
       *
       * It cannot be held in this component's state: the browse field and the
       * expanded detail are two SEPARATE instances of this workspace -- the
       * shell renders one behind the deck and one inside it -- so a value set
       * on the click in the first is not present in the second. It has to
       * travel with the request, which is what `FocusSource` is for.
       *
       * `FocusIntent` is the shell's vocabulary and `IdeaFocus` is this
       * lens's; they are translated at the boundary rather than merged,
       * because the same intent means different things to a research surface
       * and an ideas one.
       */
      source: focus ? { elementId: `idea-tile-${idea.id}`, role: 'standard', intent: INTENT_FOR[focus] } : null,
    },
    backLabel: 'Ideas',
    rail: ranked.map(i => toRailCard(i, exposure[i.assetId ?? '']?.pct)),
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
        focus={(intent && FOCUS_FOR[intent]) ?? arrival?.focus ?? null}
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
   * Take one idea to the team, without expanding it first.
   *
   * The detail pane has offered this since D1; the browse field never did, so
   * the only way to raise an idea with anyone was to open it first. Same seam,
   * same target, and the same existing threads — `discuss` raises an
   * EngagementRequest and the CommunicationPane answers it.
   */
  const talk = (idea: IdeaRow) => {
    const target = targetFor(idea, undefined)
    if (target) discuss(target)
  }

  /**
   * Whether an idea can hold a thread at all, asked of the seam rather than
   * assumed. `trade_idea` is in the discussable set today, so this is true for
   * every row — but the card omits the action rather than offering one that
   * would fail, and the day the allowlist changes the field follows it.
   */
  const discussable = (idea: IdeaRow) => {
    const target = targetFor(idea, undefined)
    return !!target && canDiscuss(target)
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
      rank={rank}
      density={densityForRank(rank)}
      frame={framework[idea.assetId ?? '']}
      exposure={exposure[idea.assetId ?? '']}
      openPrice={openPrice[idea.id]}
      onOpen={focus => open(idea, focus)}
      onAskAI={() => ask(idea)}
      onDiscuss={discussable(idea) ? () => talk(idea) : undefined}
    />
  )

  return (
    <div className="h-full overflow-y-auto" data-testid="ideas-lens">
      <div className="px-6 pb-10 pt-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-tight">Ideas</h1>
          <span className="font-mono text-[11px] text-gray-500">{ranked.length}</span>
        </div>
        {/*
          What this field is actually holding, rather than what an Ideas page
          is in general.

          The line here read "Active investment ideas, from ready-to-decide to
          early-stage" on every load, whatever the field contained. It is true,
          it never changes, and it cost the first viewport a line to restate
          the tab's own name — the definition of the dashboard chrome this
          surface is trying not to be.

          The two facts that replace it are the ones a reader would otherwise
          have to count by hand, and both are already computed per card and
          then discarded: how many ideas are waiting on a decision nobody has
          taken, and how many have gone cold. Stale is the card's own
          threshold, and it was dead code -- `read()` derived it, no density
          ever drew it, so "this has been sitting unresolved since February"
          was a fact the page knew and never said.
        */}
        <p className="mt-1.5 max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
          {summarise(ranked)}
        </p>

        {/*
          One grid. Not four.

          Every idea on the page is a cell of the same twelve-column grid, in
          rank order, sized by `spanForRank` alone: 8 + 4 across the top, then
          three-across standards, then a compact field that narrows to four
          across at the widest desktop. Eight is two four-column tracks, so
          every vertical edge on the page lands on the same lines.

          The previous version had a bespoke cluster component, a 7/5 tier
          grid, a 4-up scan grid and a separate tail grid behind a rule --
          four sets of column edges, and a visible phase transition where each
          gave way to the next. Nothing here is a region: rank picks a density
          and a span, and normal flow does the rest, so reading order, tab
          order and rank order stay the same order.

          Cells stretch to their row, which is what makes the page read as
          rows at all -- the outer shells of same-row cards share a top and a
          bottom edge. Nothing INSIDE a card stretches: content is composed
          from the top and the shell simply occupies the row, which is a
          different thing from the `mt-auto` push that produced the old
          bottom-of-card whitespace.

          Normal flow only, never a dense backfill: rank is authoritative, and
          a shorter card must never be promoted into a gap above a taller one.
        */}
        <div
          data-testid="idea-field"
          className="mt-5 grid grid-cols-12 gap-4"
        >
          {ranked.map((idea, rank) => card(idea, rank))}
        </div>
      </div>
    </div>
  )
}

/**
 * How long an idea can sit before the page says so.
 *
 * The card's own threshold, in one place so the header and the tile cannot
 * disagree about which ideas have gone cold.
 */
export const STALE_DAYS = 120

/**
 * The field in one line: what is waiting on a judgment, and what has gone cold.
 *
 * Deliberately not a stage breakdown. Counting how many ideas are in each of
 * four maturities describes the workflow; these two describe the book. Neither
 * clause is printed when it is zero -- a field with nothing outstanding should
 * say so by saying nothing, not by printing "0 awaiting a decision".
 */
export function summarise(ideas: IdeaRow[]): string {
  const now = Date.now()
  const deciding = ideas.filter(
    i => i.maturity === 'deciding' || i.maturity === 'decision_ready').length
  const stale = ideas.filter(
    i => (now - new Date(i.createdAt).getTime()) / 86_400_000 >= STALE_DAYS).length

  const parts = [
    deciding ? `${deciding} awaiting a decision` : null,
    stale ? `${stale} open more than ${Math.round(STALE_DAYS / 30)} months` : null,
  ].filter(Boolean)

  if (!parts.length) return 'Active investment ideas. Nothing is overdue a decision.'
  return `${parts.join(' · ')}.`
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
