/**
 * IdeasFeedPage — Primary Ideas experience.
 *
 * Single-column infinite-scroll feed combining human-authored content
 * with system-generated signal cards. Replaces the masonry grid as
 * the default Ideas view.
 *
 * Layout:
 * - Header: title, mode selector, search, create button
 * - Filter chips: type filtering
 * - Centered feed column (~760px max-width)
 * - Optional detail pane (right side) on card selection
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  Lightbulb, Search, Plus, X, RefreshCw,
  SlidersHorizontal, Sparkles, Users, Clock as ClockIcon,
  FileText, TrendingUp, GitBranch, Zap,
} from 'lucide-react'
import { useMemo } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useOrganization } from '../../../contexts/OrganizationContext'
import { useIdeasFeed, type FeedMode, type IdeasFeedFilters, type MixedFeedItem, isSignalCard } from '../../../hooks/ideas/useIdeasFeed'
import { CockpitStream } from '../cockpit/CockpitStream'
import { IdeasWorkbench } from '../workbench/IdeasWorkbench'
import { buildWorkbench } from '../../../lib/ideas/workbench'
import { toIdeaRow, signalToIdeaRow, cardToIdeaRow } from '../cockpit/to-row'
import { rankMixedCandidates } from '../../../lib/ideas/idea-priority'
import { signalDispositionRef, type GeneratedSignal } from '../../../lib/ideas/signal-candidates'
import {
  cardDispositionRef, lensDispositionRef, emittedCards, toPortfolioLenses,
  type PortfolioLens,
} from '../../../lib/ideas/card-candidates'
import { useScenarioCards } from '../../../hooks/mobile/useScenarioCards'
import { usePortfolioLenses } from '../../../hooks/mobile/usePortfolioLenses'
import { useDecisionEngine } from '../../../engine/decisionEngine'
import {
  flattenProcessFindings, processResolution, processSupportsTriage,
  type ProcessFinding,
} from '../../../lib/ideas/process-candidates'
import { judgmentRefFor } from '../../../lib/ideas/feed-suppression'
import { recordRowTriage, type TriageAction } from '../../../lib/signals/feed-triage'
import { useSignalCards, insertSignalsIntoFeed } from '../../../hooks/ideas/useSignalCards'
import { FeedCard, GroupedThesisCard } from './FeedCard'
import { SignalFeedCard } from './SignalFeedCard'
import { FeedSkeleton } from './FeedSkeleton'
import type { ScoredFeedItem, ItemType } from '../../../hooks/ideas/types'

// ============================================================
// Type filter chips
// ============================================================

const TYPE_CHIPS: Array<{ value: ItemType | null; label: string; icon: React.ElementType }> = [
  { value: null, label: 'All', icon: Sparkles },
  { value: 'quick_thought', label: 'Thoughts', icon: Lightbulb },
  { value: 'trade_idea', label: 'Trade Ideas', icon: TrendingUp },
  { value: 'note', label: 'Notes', icon: FileText },
  { value: 'thesis_update', label: 'Thesis', icon: GitBranch },
]

// ============================================================
// Mode config
// ============================================================

const MODE_OPTIONS: Array<{ value: FeedMode; label: string; icon: React.ElementType }> = [
  { value: 'for_you', label: 'For You', icon: Sparkles },
  { value: 'following', label: 'Following', icon: Users },
  { value: 'latest', label: 'Latest', icon: ClockIcon },
]

// ============================================================
// Props
// ============================================================

interface IdeasFeedPageProps {
  onItemSelect?: (item: any) => void
}

// ============================================================
// Component
// ============================================================

/**
 * A portfolio lens, in the shape the shared card renderer reads.
 *
 * Lenses are not `SignalCard`s — they are raw findings from
 * `usePortfolioLenses` with no headline of their own — so the sentence is
 * composed here, once, rather than in five places in the row component. The
 * TYPE and the ranking come from `lensPriorityInput`; only the words are here.
 */
/**
 * A process finding, in the shape the shared card renderer reads.
 *
 * The evaluator already writes both halves a cockpit row wants: `title` states
 * what happened and `description` states why it matters — "Approved trade has
 * not been logged as executed", "Due 5d ago in Q3 Review". Neither is rewritten
 * here; a second wording would be a second product voice for one finding.
 *
 * The ticker is shown where the finding has one and omitted where it does not.
 * A deliverable is not about a name, and printing a dash is more honest than
 * borrowing the project's initials to fill the column.
 */
/**
 * The primary action for a process finding, routed through the events the app
 * already has.
 *
 * `navigate-to-project` and `openTradeQueue` are existing global events that
 * `DashboardPage` — which owns tab navigation — already listens for, and they
 * are the same destinations the Decision Engine's own CTAs use
 * (`OPEN_TRADE_QUEUE_EXECUTION`, `OPEN_PROJECT`). Reusing them means the two
 * surfaces send a reader to the same place, and the cockpit introduces no
 * routing of its own.
 *
 * `onClick` is omitted when the finding has no addressable destination, and the
 * row then renders the label disabled rather than a button that goes nowhere.
 */
function resolutionFor(finding: ProcessFinding) {
  const resolution = processResolution(finding)
  if (!resolution) return undefined

  const dispatch = resolution.route && (() => {
    if (resolution.route!.kind === 'trade-queue') {
      window.dispatchEvent(new CustomEvent('openTradeQueue', {
        detail: { selectedTradeId: resolution.route!.id, openDecisionDrawer: false },
      }))
    } else {
      window.dispatchEvent(new CustomEvent('navigate-to-project', {
        detail: { projectId: resolution.route!.id },
      }))
    }
  })

  return { label: resolution.label, note: resolution.note, onClick: dispatch ?? undefined }
}

function processRow(finding: ProcessFinding): any {
  return {
    id: finding.id,
    type: finding.titleKey === 'OVERDUE_DELIVERABLE' ? 'project_overdue' : 'execution_unconfirmed',
    entity: { ticker: finding.context?.assetTicker ?? null },
    headline: finding.title ?? 'Process exception',
    body: finding.description ?? '',
    metric: { asOf: finding.createdAt },
  }
}

function lensRow(lens: PortfolioLens): any {
  switch (lens.type) {
    case 'breach':
      return {
        id: `breach-${lens.breach.assetId}`, type: 'target_hit',
        entity: { ticker: (lens.breach as any).symbol ?? null },
        headline: `${(lens.breach as any).symbol ?? 'Position'} has passed its price target`,
        body: `${Math.abs(lens.breach.overshootPct * 100).toFixed(0)}% through the target you recorded.`,
        metric: { asOf: lens.breach.asOf },
      }
    case 'stale':
      return {
        id: `stale-${lens.target.assetId}`, type: 'target_expired',
        entity: { ticker: (lens.target as any).symbol ?? null },
        headline: `${(lens.target as any).symbol ?? 'Position'} target has expired`,
        body: `The horizon lapsed ${lens.target.overdueMonths} month${lens.target.overdueMonths === 1 ? '' : 's'} ago and the view has not been restated.`,
        metric: { asOf: lens.target.expiredAt },
      }
    case 'untargeted':
      return {
        id: `untargeted-${lens.position.assetId}`, type: 'no_target',
        entity: { ticker: (lens.position as any).symbol ?? null },
        headline: `${(lens.position as any).symbol ?? 'Position'} is held with no price target`,
        body: `${lens.position.weightPct.toFixed(1)}% of the book, with nothing recorded to value it against.`,
        metric: { asOf: lens.position.asOf },
      }
    case 'conviction':
      return {
        id: `conviction-${lens.gap.assetId}`,
        type: lens.gap.direction === 'overweight' ? 'conviction_oversized' : 'conviction_undersized',
        entity: { ticker: (lens.gap as any).symbol ?? null },
        headline: `${(lens.gap as any).symbol ?? 'Position'} is sized against your conviction`,
        body: `Held at ${lens.gap.weightPct.toFixed(1)}%, ${lens.gap.direction} relative to the rating recorded for it.`,
        metric: { asOf: lens.gap.asOf },
      }
    default:
      return {
        id: `crowded-${lens.name.assetId}`, type: 'crowding',
        entity: { ticker: (lens.name as any).symbol ?? null },
        headline: `${(lens.name as any).symbol ?? 'Position'} is crowded across the book`,
        body: `Up to ${lens.name.maxWeightPct.toFixed(1)}% in a single portfolio.`,
        metric: { asOf: lens.name.asOf },
      }
  }
}

export function IdeasFeedPage({ onItemSelect }: IdeasFeedPageProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  // Mark the "View the ideas feed" Get Started step done on mount.
  // Keyed per (user, org) so visiting the feed in one workspace
  // doesn't pre-tick the step in another the user joins later.
  useEffect(() => {
    if (!user?.id || !currentOrgId) return
    const key = `pilot-tutorial-ideas-feed-viewed-${user.id}-${currentOrgId}`
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent('pilot-tutorial:ideas-feed-viewed')) } catch { /* ignore */ }
  }, [user?.id, currentOrgId])

  // ── State ──
  const [mode, setMode] = useState<FeedMode>('for_you')
  const [typeFilter, setTypeFilter] = useState<ItemType | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ScoredFeedItem | null>(null)

  // ── Feed filters ──
  const filters: IdeasFeedFilters = {
    mode,
    types: typeFilter ? [typeFilter] : undefined,
    search: searchQuery || undefined,
  }

  // ── Data ──
  const {
    items, rankContext, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, isError,
  } = useIdeasFeed(filters)
  // Read here rather than beside the render, because the ranking memo below
  // needs it: signals are candidates now, not decoration spliced in later.
  const { signals } = useSignalCards()

  /**
   * Scenario ladders and portfolio lenses — the intelligence desktop lacked.
   *
   * `scenario_gap` is tier 0, base 1.00, the highest entry in the TIER table
   * and the only signal that compares a price against the desk's own full
   * ladder. It has been produced for months and rendered only on a phone.
   *
   * Both hooks are the ones mobile already uses, so this is a second CONSUMER
   * rather than a second source, and React Query dedupes the fetch by key.
   */
  const { data: scenarioResults } = useScenarioCards()
  const { data: lensBuckets } = usePortfolioLenses()

  /**
   * Process failures, from the Decision Engine.
   *
   * Two of its seven evaluators are mapped — an approved trade nobody has
   * logged as executed, and an overdue deliverable. `processPriorityInput`
   * returns null for the other five, so they cannot leak in through a default
   * tier while their semantics are still being decided.
   *
   * Read raw rather than through the dashboard's own curation: that applies a
   * display cap, and a candidate set should not be pre-trimmed by another
   * surface's layout budget.
   */
  // `'process'` scopes the engine to the queries the two migrated findings
  // read — three of seven, and five fewer network round trips. See the scope's
  // own note; Dashboard still gets everything, and a cache shared with it means
  // scoping down never costs a second fetch.
  const { selectForDashboard } = useDecisionEngine('process')
  const processFindings = useMemo(
    () => flattenProcessFindings(selectForDashboard().action as ProcessFinding[]),
    [selectForDashboard],
  )

  /** Builders return `CardResult` — emitted or suppressed. Only emitted rank. */
  const scenarioCards = useMemo(() => emittedCards(scenarioResults), [scenarioResults])
  const lenses = useMemo(() => toPortfolioLenses(lensBuckets), [lensBuckets])
  const { user: authUser } = useAuth()

  /**
   * Row density. Cockpit on a desk, cards where somebody wants the chart.
   *
   * Remembered per browser rather than per account: it is a preference about
   * this screen, not a fact about the reader, and a round trip to learn how
   * somebody likes their list is a round trip too many.
   */
  /**
   * `workbench` is the new default; `cockpit` and `cards` are kept.
   *
   * The 52px exception-queue presentation was reviewed and rejected — the
   * ranking under it was not. Keeping both older views behind the control
   * makes this pass easy to compare and easy to revert, and costs one union
   * member.
   */
  const [density, setDensity] = useState<'workbench' | 'cockpit' | 'cards'>(() => {
    try {
      const saved = localStorage.getItem('tesseract:ideas-density')
      return saved === 'cards' ? 'cards' : saved === 'cockpit' ? 'cockpit' : 'workbench'
    } catch { return 'workbench' }
  })
  const chooseDensity = useCallback((next: 'workbench' | 'cockpit' | 'cards') => {
    setDensity(next)
    try { localStorage.setItem('tesseract:ideas-density', next) } catch { /* private mode */ }
  }, [])

  /** Only the ranked feed rows — signal cards are a different shape. */
  const feedItems = useMemo(() => items.filter(i => !isSignalCard(i as MixedFeedItem)), [items])

  /**
   * Snooze and Dismiss, through the identity the whole product already uses.
   *
   * `judgmentRefFor` composes the same `type:entity` key mobile files answers
   * under, so a dismissal here is the same record a dismissal there would be —
   * and `useDispositions` picks up the write in this tab through
   * DISPOSITIONS_CHANGED_EVENT, which re-keys the feed query and drops the row
   * without a reload. No second action system, no optimistic local list.
   */
  /**
   * One ranked stream: posts and system signals, scored by the same ranker.
   *
   * `insertSignalsIntoFeed` used to splice signals into fixed positions of the
   * finished list — 2, 6, 10, 15, 20, 26 — so a team split on a name the reader
   * owns landed at position six because six is where the sixth slot is. Nothing
   * about the signal's content had any bearing on where it went, and the
   * Attention band, which reads the canonical tier, was empty by construction.
   *
   * `rankMixedCandidates` gives both kinds a `PriorityInput` and runs one
   * scoring pass, so a conflict outranks a note when it deserves to and does
   * not when it does not.
   */
  const ranked = useMemo(
    () => rankMixedCandidates(
      {
        posts: feedItems as any[],
        signals: signals as unknown as GeneratedSignal[],
        cards: scenarioCards,
        lenses,
        process: processFindings,
      },
      rankContext,
      Date.now(),
    ),
    [feedItems, signals, scenarioCards, lenses, processFindings, rankContext],
  )

  /**
   * The same ranked candidates, folded into ideas.
   *
   * `rankMixedCandidates` is untouched — this reads its output and inverts the
   * presentation: a scenario break on CROX stops being a peer row and becomes
   * the reason the CROX idea needs attention. See `buildWorkbench`.
   */
  const workbenchIdeas = useMemo(
    () => buildWorkbench(ranked.map(r => {
      const k = r.item.kind
      // The existing converters supply the copy, so the workbench and the
      // cockpit can never describe the same finding differently.
      const row = k === 'signal' ? signalToIdeaRow(r.item.signal!, r.priority)
        : k === 'card' ? cardToIdeaRow(r.item.card!, r.priority, Date.now())
        : k === 'lens' ? cardToIdeaRow(lensRow(r.item.lens!), r.priority, Date.now())
        : k === 'process' ? cardToIdeaRow(processRow(r.item.process!), r.priority, Date.now())
        : null
      const post = k === 'post' ? (r.item.post as any) : null
      return {
        kind: k,
        id: String(r.input.id),
        symbol: (row?.symbol ?? post?.asset?.symbol ?? null) as string | null,
        tier: r.priority.tier,
        reasons: r.priority.reasons ?? [],
        headline: row?.headline ?? '',
        why: row?.whyNow ?? null,
        // The finding's own type key, wherever its source keeps it. Never
        // rendered — it only chooses the verb in `ACTION_FOR`.
        typeKey: k === 'post'
          ? null
          : ((r.item.card?.type ?? (r.item.signal as any)?.type ?? (row as any)?.type ?? null) as string | null),
        post,
      }
    }), Date.now()),
    [ranked],
  )

  const cockpitRows = useMemo(
    () => ranked.map(r => {
      if (r.item.kind === 'signal') return signalToIdeaRow(r.item.signal!, r.priority)
      // Scenario ladders and portfolio lenses share a renderer: both are
      // machine findings about one name, with a headline and a why-now line.
      if (r.item.kind === 'card') return cardToIdeaRow(r.item.card!, r.priority, Date.now())
      if (r.item.kind === 'lens') return cardToIdeaRow(lensRow(r.item.lens!), r.priority, Date.now())
      if (r.item.kind === 'process') {
        return cardToIdeaRow(processRow(r.item.process!), r.priority, Date.now(), {
          canTriage: processSupportsTriage(),
          resolution: resolutionFor(r.item.process!),
        })
      }
      return toIdeaRow({ ...(r.item.post as any), priority: r.priority }, Date.now())
    }),
    [ranked],
  )

  /** Ranked rows are addressed by the id the RANKER saw, whatever produced them. */
  const findRanked = useCallback(
    (id: string) => ranked.find(r => String(r.input.id) === id),
    [ranked],
  )

  const handleRowOpen = useCallback((id: string) => {
    const entry = findRanked(id)
    if (!entry) return
    if (entry.item.kind === 'post') handleCardClick(entry.item.post as any)
    else if (entry.item.kind === 'signal') handleSignalClick(entry.item.signal)
    // Scenario and lens findings have no desktop detail surface yet; opening
    // one does nothing rather than navigating somewhere that cannot show it.
  }, [findRanked])

  /**
   * Snooze and Dismiss, through the identity each kind already has.
   *
   * A post is keyed on the post — one reader answering Priya's thought must not
   * silence Marcus's. A machine finding is keyed on the ASSET, because it is a
   * recurring claim about a name and tomorrow's regenerated card is the same
   * claim. Both rules come from `dispositionEntityFor`; neither is invented
   * here, and a signal with no asset to key on is simply not dismissible.
   */
  const triage = useCallback((id: string, action: TriageAction) => {
    if (!authUser?.id) return
    const entry = findRanked(id)
    if (!entry) return

    /**
     * A process failure has no personal disposition yet — see
     * `processSupportsTriage`. The row renders without Snooze and Dismiss
     * rather than writing an answer under a key nothing can honour.
     */
    if (entry.item.kind === 'process') return

    const ref =
      entry.item.kind === 'signal' ? signalDispositionRef(entry.item.signal!)
      : entry.item.kind === 'card' ? cardDispositionRef(entry.item.card!)
      : entry.item.kind === 'lens' ? lensDispositionRef(entry.item.lens!)
      : judgmentRefFor({ id: String(entry.item.post!.id), type: (entry.item.post as any).type })
    if (!ref) {
      console.warn('[ideas] no disposition identity for this row', { id, action })
      return
    }

    const stuck = recordRowTriage(authUser.id, ref, action)
    if (!stuck) {
      // Private browsing, a full quota. Say so rather than hiding the row and
      // letting it come back tomorrow unexplained.
      console.warn('[ideas] triage not persisted', { id, action })
    }
  }, [authUser?.id, findRanked])

  /**
   * The legacy card view's signal placement, and only that view's.
   *
   * `insertSignalsIntoFeed` drops signals at fixed positions — 2, 6, 10, 15,
   * 20, 26 — irrespective of what they say. The cockpit no longer uses it:
   * signals are ranked candidates there, and where one lands is the ranker's
   * decision. It survives here because the card view has no tier to place them
   * by, and it goes when that view does.
   */
  const mixedFeed = insertSignalsIntoFeed(items, signals)

  // ── Search filtering (client-side for instant results) ──
  const displayItems = searchQuery
    ? mixedFeed.filter(item => {
        if (isSignalCard(item)) {
          return item.headline.toLowerCase().includes(searchQuery.toLowerCase()) ||
                 item.body.toLowerCase().includes(searchQuery.toLowerCase())
        }
        const content = (item.content || '').toLowerCase()
        const symbol = ('asset' in item && item.asset?.symbol || '').toLowerCase()
        const author = [item.author?.first_name, item.author?.last_name].filter(Boolean).join(' ').toLowerCase()
        return content.includes(searchQuery.toLowerCase()) ||
               symbol.includes(searchQuery.toLowerCase()) ||
               author.includes(searchQuery.toLowerCase())
      })
    : mixedFeed

  // ── Group thesis updates by same asset + author + close timestamps ──
  type FeedEntry = { type: 'single'; item: MixedFeedItem } | { type: 'group'; items: ScoredFeedItem[]; key: string }
  const groupedFeed = useMemo((): FeedEntry[] => {
    const entries: FeedEntry[] = []
    const used = new Set<number>()

    for (let i = 0; i < displayItems.length; i++) {
      if (used.has(i)) continue
      const item = displayItems[i]

      if (isSignalCard(item) || item.type !== 'thesis_update') {
        entries.push({ type: 'single', item })
        continue
      }

      // Collect adjacent thesis_updates with same asset + author within 30 min
      const asset = 'asset' in item ? (item as any).asset : null
      const authorId = item.author?.id
      const ts = new Date(item.created_at).getTime()
      const group: ScoredFeedItem[] = [item]
      used.add(i)

      for (let j = i + 1; j < displayItems.length; j++) {
        if (used.has(j)) continue
        const other = displayItems[j]
        if (isSignalCard(other) || other.type !== 'thesis_update') continue
        const otherAsset = 'asset' in other ? (other as any).asset : null
        const otherAuthorId = other.author?.id
        const otherTs = new Date(other.created_at).getTime()
        if (
          asset?.id && otherAsset?.id === asset.id &&
          authorId && otherAuthorId === authorId &&
          Math.abs(otherTs - ts) < 30 * 60 * 1000
        ) {
          group.push(other)
          used.add(j)
        }
      }

      if (group.length > 1) {
        entries.push({ type: 'group', items: group, key: `group-${group.map(g => g.id).join('-')}` })
      } else {
        entries.push({ type: 'single', item })
      }
    }
    return entries
  }, [displayItems])

  // ── Infinite scroll trigger ──
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: '300px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // ── Handlers ──
  const handleCardClick = useCallback((item: ScoredFeedItem) => {
    setSelectedItem(item)
    if (!onItemSelect) return

    const asset = 'asset' in item ? (item as any).asset : null

    if (item.type === 'trade_idea' && asset) {
      // Open the asset page with trade queue context
      onItemSelect({ id: asset.id, title: asset.symbol, type: 'asset', data: { symbol: asset.symbol, defaultTab: 'trade-queue' } })
    } else if (item.type === 'note' && asset) {
      onItemSelect({ id: asset.id, title: asset.symbol, type: 'asset', data: { symbol: asset.symbol, defaultTab: 'notes' } })
    } else if (item.type === 'thesis_update' && asset) {
      onItemSelect({ id: asset.id, title: asset.symbol, type: 'asset', data: { symbol: asset.symbol, defaultTab: 'thesis' } })
    } else if (asset) {
      // Quick thought or other type with an asset — open asset page
      onItemSelect({ id: asset.id, title: asset.symbol, type: 'asset', data: { symbol: asset.symbol } })
    }
    // Items without an asset: no navigation (stay on feed)
  }, [onItemSelect])

  const handleSignalClick = useCallback((signal: any) => {
    if (signal.relatedAssets?.[0] && onItemSelect) {
      const a = signal.relatedAssets[0]
      onItemSelect({ id: a.id, title: a.symbol, type: 'asset', data: { symbol: a.symbol } })
    }
  }, [onItemSelect])

  const handleAuthorClick = useCallback((authorId: string) => {
    // Could open author profile or filter to author
  }, [])

  const handleAssetClick = useCallback((assetId: string, symbol: string) => {
    onItemSelect?.({ id: assetId, title: symbol, type: 'asset', data: { symbol } })
  }, [onItemSelect])

  const handleExpandChart = useCallback((symbol: string) => {
    onItemSelect?.({ id: 'charting', title: 'Charting', type: 'charting', data: { symbol } })
  }, [onItemSelect])

  const handleCreate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openThoughtsCapture', { detail: {} }))
  }, [])

  // ── Render ──
  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      {/* ═══ HEADER ═══ */}
      <div className="bg-white border-b border-gray-100 px-3 md:px-6 py-2.5 shrink-0 dark:border-gray-800 dark:bg-gray-800">
        <div className="max-w-[1060px] mx-auto">
          {/* Title + mode + actions row. Wraps on phones — the mode toggle and
              action buttons together exceed a 390px row. */}
          <div className="flex flex-wrap items-center justify-between gap-y-2 mb-2 min-w-0">
            <div className="flex items-center gap-4">
              <h1 className="text-[16px] font-semibold text-gray-900 flex items-center gap-2 dark:text-white">
                <Lightbulb className="w-4.5 h-4.5 text-primary-600" />
                Ideas
              </h1>

              {/* Mode selector */}
              <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg dark:bg-gray-800">
                {MODE_OPTIONS.map(opt => {
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setMode(opt.value)}
                      className={clsx(
                        'flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium transition-colors',
                        mode === opt.value
                          ? 'bg-white text-gray-900 shadow-sm dark:text-white dark:bg-gray-800'
                          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Density. Two words, not an icon: a control nobody can name is
                  a control nobody finds. */}
              <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
                {(['workbench', 'cockpit', 'cards'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => chooseDensity(d)}
                    className={clsx(
                      'rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                      density === d
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400',
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {/* Search toggle */}
              <button
                onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery('') }}
                className={clsx(
                  'p-2 rounded-lg transition-colors',
                  showSearch ? 'bg-primary-50 text-primary-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700',
                )}
              >
                <Search className="w-4 h-4" />
              </button>

              {/* Refresh */}
              <button
                onClick={() => refetch()}
                disabled={isLoading}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors dark:hover:text-gray-300 dark:hover:bg-gray-700"
              >
                <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
              </button>

              {/* Create */}
              <button
                onClick={handleCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-[12px] font-semibold rounded-lg transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Post
              </button>
            </div>
          </div>

          {/* Search bar */}
          {showSearch && (
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search ideas, assets, people..."
                className="w-full pl-9 pr-8 py-2 text-[13px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:border-gray-700 dark:bg-gray-800"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Type filter chips */}
          <div className="flex items-center gap-1.5">
            {TYPE_CHIPS.map(chip => {
              const Icon = chip.icon
              const isActive = typeFilter === chip.value
              return (
                <button
                  key={chip.value || 'all'}
                  onClick={() => setTypeFilter(chip.value)}
                  className={clsx(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                    isActive
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400 dark:bg-gray-800',
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {chip.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ═══ FEED ═══ */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1060px] mx-auto px-3 md:px-4 py-3">
          {/* Loading state */}
          {isLoading && <FeedSkeleton count={5} />}

          {/* Error state */}
          {isError && !isLoading && (
            <div className="text-center py-16">
              <p className="text-[13px] text-gray-500 mb-3 dark:text-gray-400">Failed to load feed</p>
              <button
                onClick={() => refetch()}
                className="text-[12px] font-medium text-primary-600 hover:text-primary-700"
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && displayItems.length === 0 && (
            <div className="text-center py-20">
              <Lightbulb className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-[15px] font-semibold text-gray-700 mb-1 dark:text-gray-300">
                {searchQuery ? 'No matches' : 'No ideas yet'}
              </h3>
              <p className="text-[13px] text-gray-400 mb-4 max-w-xs mx-auto">
                {searchQuery
                  ? `Nothing matches "${searchQuery}"`
                  : 'Capture a quick thought to get started.'}
              </p>
              {!searchQuery && (
                <button
                  onClick={handleCreate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-[13px] font-semibold rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Post an idea
                </button>
              )}
            </div>
          )}

          {/**
            * The cockpit: one dense ranked stream, which is the default on a
            * desk screen.
            *
            * Measured at 1440x900, the card layout below put three items above
            * the fold at a 194px median height. The row layout puts fourteen at
            * 52px. That is the difference between a reading surface and a
            * scanning one, and it is the whole reason this view exists.
            *
            * The card view is kept behind the density control rather than
            * deleted: it is the only thing that renders a chart inline, and
            * product has not yet chosen between them on real data.
            *
            * Signal cards are deliberately NOT in this stream yet. They come
            * from `useSignalCards`, carry a 0-1 `priority` rather than a
            * canonical tier, and would have to be ranked by the canonical
            * ranker before they could be interleaved honestly. Until then they
            * render below, and the Attention band stays empty — see the report.
            */}
          {!isLoading && density === 'workbench' && workbenchIdeas.length > 0 && (
            <div
              data-workbench-host
              className="-mx-3 overflow-hidden rounded-lg border border-gray-200 md:-mx-4 dark:border-gray-700"
              /* A real desk height. The queue is meant to show 7-8 ideas and
                 the workspace a chart plus a thesis; both need vertical room
                 the page's natural flow does not give them. */
              style={{ height: 'calc(100vh - 190px)', minHeight: 520 }}
            >
              <IdeasWorkbench
                ideas={workbenchIdeas}
                onOpenAsset={sym => {
                  const idea = workbenchIdeas.find(i => i.symbol === sym)
                  if (idea?.assetId) handleAssetClick(idea.assetId, sym)
                }}
              />
            </div>
          )}

          {!isLoading && density === 'cockpit' && cockpitRows.length > 0 && (
            <div className="-mx-3 overflow-hidden rounded-lg border border-gray-200 md:-mx-4 dark:border-gray-700">
              <CockpitStream
                items={cockpitRows}
                selectedId={selectedItem?.id ?? null}
                onOpen={handleRowOpen}
                onSnooze={id => triage(id, 'snooze')}
                onDismiss={id => triage(id, 'dismiss')}
              />
            </div>
          )}

          {/* Feed items */}
          {!isLoading && density === 'cards' && groupedFeed.length > 0 && (
            <div className="space-y-3">
              {groupedFeed.map((entry) => {
                if (entry.type === 'group') {
                  return (
                    <GroupedThesisCard
                      key={entry.key}
                      items={entry.items}
                      onAuthorClick={handleAuthorClick}
                      onAssetClick={handleAssetClick}
                      onCardClick={handleCardClick}
                      onExpandChart={handleExpandChart}
                      isSelected={entry.items.some(i => i.id === selectedItem?.id)}
                    />
                  )
                }

                const item = entry.item
                if (isSignalCard(item)) {
                  return (
                    <SignalFeedCard
                      key={item.id}
                      signal={item}
                      onAssetClick={handleAssetClick}
                      onCardClick={handleSignalClick}
                      onExpandChart={handleExpandChart}
                    />
                  )
                }

                // Discovery prompt cards (system-generated)
                if ((item as any).meta?.isDiscovery) {
                  const meta = (item as any).meta
                  return (
                    <div key={item.id} className="rounded-xl border border-dashed border-gray-300 bg-gradient-to-br from-gray-50 to-white p-4 dark:border-gray-600">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                          <Sparkles className="w-4 h-4 text-primary-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-[13px] font-semibold text-gray-900 leading-snug dark:text-white">{(item as any).title}</h4>
                          <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed dark:text-gray-400">{item.content}</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
                                detail: { captureType: meta.captureType },
                              }))
                            }}
                            className="mt-2 text-[12px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
                          >
                            {meta.actionLabel} &rarr;
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <FeedCard
                    key={item.id}
                    item={item}
                    onAuthorClick={handleAuthorClick}
                    onAssetClick={handleAssetClick}
                    onCardClick={handleCardClick}
                    onExpandChart={handleExpandChart}
                    isSelected={selectedItem?.id === item.id}
                  />
                )
              })}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-px" />

              {/* Loading more indicator */}
              {isFetchingNextPage && (
                <div className="py-4">
                  <FeedSkeleton count={2} />
                </div>
              )}

              {/* End of feed */}
              {!hasNextPage && !isFetchingNextPage && items.length > 0 && (
                <div className="text-center py-8">
                  <p className="text-[11px] text-gray-400">You're all caught up</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
