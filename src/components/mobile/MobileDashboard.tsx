import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Lightbulb, SlidersHorizontal, X } from 'lucide-react'
import { ReadthroughSheet } from './ReadthroughSheet'
import { useIdeasFeed } from '../../hooks/ideas/useIdeasFeed'
import type { ScoredFeedItem, ItemType } from '../../hooks/ideas/types'
import type { ReadthroughSourceType } from '../../lib/mobile/readthrough-service'
import { loadSeen, markSeen, rotateBySeen } from '../../lib/mobile/feed-rotation'
import { useAuth } from '../../hooks/useAuth'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { useAttention } from '../../hooks/useAttention'
import { attentionTarget } from '../../lib/mobile/attention-navigation'
import { interleaveByKind } from '../../lib/mobile/feed-interleave'
import { clearFeedSession, loadFeedSession, saveFeedSession } from '../../lib/mobile/feed-session'
import { usePullToRefresh } from '../../hooks/mobile/usePullToRefresh'
import { PullToRefreshIndicator } from './PullToRefreshIndicator'
import { useSignalCards } from '../../hooks/ideas/useSignalCards'
import { usePortfolioLenses } from '../../hooks/mobile/usePortfolioLenses'
import { FeedFilterSheet } from './FeedFilterSheet'
import { FeedSlot } from './FeedSlot'
import { FullscreenChart } from '../signals/FullscreenChart'
import { PricePane } from '../signals/PricePane'
import { findExploreMatch } from '../../lib/mobile/explore-match'
import { priceIdentity } from '../../lib/signals/price-availability'
import { newsChartSymbol } from '../../lib/signals/news-chart'
import { feedEntryKeys, symbolOfEntry } from '../../lib/mobile/feed-entry-key'
import { EMPTY_FILTER, filterCount, useFeedFacets, type FeedFilter } from '../../hooks/mobile/useFeedFacets'
import { CATEGORY_LABEL, categoryOf, type FeedCategory } from '../../lib/mobile/feed-categories'
import { clsx } from 'clsx'
import { logPilotEvent } from '../../lib/pilot/pilot-telemetry'
import { MobileExplore } from './MobileExplore'
import { TesseractLoader } from '../ui/TesseractLoader'
import { BottomSheet } from './BottomSheet'
import { MobileCaseTargets } from './asset/MobileCaseTargets'
import {
  aggregatesFor, attentionToExplore, exploreSymbols, ideasToExplore, insightsToExplore,
  lensesToExplore, newsToExplore, scenarioCardsToExplore, templatesToExplore,
} from '../../lib/mobile/explore-adapters'
import { composeExplore } from '../../lib/mobile/explore-compose'
import type { ExploreItem } from '../../lib/mobile/explore-item'
import { ScenarioLadder } from '../signals/ScenarioLadder'
import { ScenarioCaseDetail } from '../signals/ScenarioCaseDetail'
import { useScenarioCards } from '../../hooks/mobile/useScenarioCards'
import {
  buildTemplateCard, buildInsightCard, buildConvictionCard,
  buildCrowdingCard, buildTargetHitCard, buildStaleTargetCard, buildNoTargetCard, buildIdeasSignalCard,
  buildAttentionCard,
} from '../../lib/signals/builders/legacy-kinds'
import { SignalCardSection } from './SignalCardSection'
import { buildActiveRiskCard, selectActiveRisk, type ActiveRiskInput } from '../../lib/signals/builders/activeRisk'
import { WhatIfSize } from '../signals/WhatIfSize'
import { ActiveWeightPeers } from '../signals/ActiveWeightPeers'
import { ScenarioDistribution } from '../signals/ScenarioDistribution'
import { type PriceBand, type PriceMarker, type PricePoint } from '../signals/PriceContext'
import { TargetTuner } from '../signals/TargetTuner'
import { VerdictBar, type VerdictOption } from '../signals/VerdictBar'
import {
  DISPOSITION_DAYS, isDisposedOf, loadDispositions, recordDisposition,
  type DispositionMap,
} from '../../lib/signals/dispositions'
import { recordSignalJudgment } from '../../lib/signals/judgment-log'
import { recordFeedFeedback } from '../../lib/signals/feed-feedback-log'
import type { FeedFeedbackOption } from '../../lib/signals/feed-feedback'
import { claimedSubjects, suppressCoveredInsights } from '../../lib/signals/feed-dedupe'
import { LEAD_TIER, diversify, rankFeed, type PriorityInput } from '../../lib/signals/feed-priority'
import type { JudgmentRecord } from '../../lib/signals/judgment-policy'
import type { SignalType } from '../../lib/signals/contract'
import { signalTypeForTemplate } from '../../lib/signals/builders/legacy-kinds'
import { DAY_MS } from '../../lib/signals/thresholds'
import { resolveFeedAction, type FeedActionKey } from '../../lib/signals/feed-actions'
import { HorizonTimeline } from '../signals/HorizonTimeline'
import { ResearchStarter } from '../signals/ResearchStarter'
import { CaseEditor } from '../signals/CaseEditor'
import { buildIdeaCard } from '../../lib/signals/builders/ideas'
import type { RecommendationInput } from '../../lib/signals/builders/recommendation'
import { latestBenchmarkRows } from '../../lib/holdings/latest-benchmark'
import { WeightBars } from '../signals/WeightBars'
import { usePriceHistory } from '../../hooks/mobile/usePriceHistory'
import { buildNewsCard } from '../../lib/signals/builders/news'
import { useRecommendationCards } from '../../hooks/mobile/useRecommendationCards'
import type { SignalCard } from '../../lib/signals/contract'
import { useMarketNews } from '../../hooks/useMarketNews'
import { useMarketEvents } from '../../hooks/useMarketEvents'
import { useMarketData } from '../../hooks/useMarketData'
import {
  unusualMovers, outsizedActiveRisk, earningsAhead, earningsResult,
  corporateActions, economicReleases,
} from '../../lib/mobile/feed-templates'
import { useDerivedInsights } from '../../hooks/mobile/useDerivedInsights'
import { ShareToUserModal } from '../feed/ShareToUserModal'
import { FeedCaptureSheet } from './FeedCaptureSheet'
import { PromoteToTradeIdeaModal } from '../ideas/PromoteToTradeIdeaModal'
import { PromptModal } from '../thoughts/PromptModal'
import { useFeedDwell } from '../../hooks/mobile/useFeedDwell'
import { interestScore, loadInterest, recordInterest } from '../../lib/mobile/feed-telemetry'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

/**
 * Retired: the banner and the Curate sheet now read `CATEGORY_LABEL`.
 *
 * This was a map of INTERNAL entry kinds — attention, lens, template — shown to
 * readers as filter labels. See lib/mobile/feed-categories for why that could
 * not hold.
 */

interface MobileDashboardProps {
  onNavigate?: (result: any) => void
}

// `onShare` and `onCreateIdea` were removed with `ReelsFeedItem`: they existed
// only to feed that component's own header buttons. Sharing still works — it
// routes through the card menu into ShareToUserModal — and neither prop was
// ever passed by DashboardPage.

/**
 * The phone dashboard: a full-screen, one-post-per-screen ideas feed.
 *
 * This replaces the desktop analytics dashboard on mobile rather than trying
 * to reflow it. The desktop surface is a wide multi-column workbench; squeezed
 * onto 390px it produces cramped cards and horizontal overflow no amount of
 * breakpointing fixes. A feed is the mobile-native shape, and it matches how
 * the app is actually used on a phone — reading and reacting, not authoring.
 *
 * Paging uses CSS scroll-snap rather than manual touch handling: it inherits
 * native momentum, rubber-banding and accessibility behaviour, and cannot
 * desynchronise from the scroll position the way an index-tracking
 * implementation does.
 */


export function MobileDashboard({ onNavigate }: MobileDashboardProps) {
  const { user } = useAuth()
  // Required by `audit_events`. Optional context so the feed still renders for
  // a user who has not resolved an org yet; without it the judgment is local
  // only, which `recordSignalJudgment` reports as `skipped` rather than failed.
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null
  const userId = user?.id
  const queryClient = useQueryClient()
  const { items, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useIdeasFeed({ mode: 'for_you' })

  // Re-rank on every open. staleTime keeps the network quiet within 30s, but
  // the point here is that returning to the feed reflects what changed.
  useEffect(() => { refetch() }, [refetch])

  const { sections, acknowledge, snoozeFor, markRead, refetch: refetchAttention, isLoading: attentionLoading } = useAttention()

  const attentionItems = useMemo(() => {
    // All four types, not just decisions and actions. The feed is meant to be
    // endless and to keep pointing the user at something to do; restricting it
    // to the two most urgent buckets left long stretches with nothing to act
    // on. Priority still orders them, so decisions surface first.
    const byPriority = [
      ...(sections?.decision_required ?? []),
      ...(sections?.action_required ?? []),
      ...(sections?.alignment ?? []),
      ...(sections?.informational ?? []),
    ]
    return byPriority.filter(a => a.status !== 'resolved' && a.status !== 'dismissed')
  }, [sections])

  // Genuinely derived signals — stale coverage, conflicting team sentiment,
  // catalyst proximity. These are the real "what should I be thinking about"
  // cards; the `prompt` type is excluded because those are canned questions
  // with no finding behind them, which is precisely the filler complained of.
  const { data: derivedInsights = [], isLoading: insightsLoading } = useDerivedInsights()

  // Portfolio lenses: questions about the book that no other screen asks.
  // Deliberately part of the feed rather than a separate destination — the
  // whole point is that nobody goes looking for "is this position the right
  // size", so it has to arrive unprompted.
  const { data: lenses, isLoading: lensesLoading } = usePortfolioLenses()
  const { signals, isLoading: signalsLoading } = useSignalCards()
  const realSignals = useMemo(
    () => (signals ?? []).filter(sig => sig.signalType !== 'prompt'),
    [signals]
  )

  const [shareItem, setShareItem] = useState<ScoredFeedItem | null>(null)
  const [promoteItem, setPromoteItem] = useState<ScoredFeedItem | null>(null)
  const [askItem, setAskItem] = useState<ScoredFeedItem | null>(null)
  /**
   * Asset the reader was looking at when they tapped Capture, so a thought
   * logged from the feed arrives already attached to its subject.
   *
   * `kind` and `note` are set only by controls that have already made the
   * choice for the reader — today just the active-risk what-if slider, which
   * arrives with a specific proposed weight and would lose it to a menu.
   */
  const [captureCtx, setCaptureCtx] = useState<
    {
      assetId: string | null
      symbol: string | null
      name: string | null
      kind?: 'thought'
      note?: string
    } | null
  >(null)

  /**
   * What the reader has already decided about, snapshotted once per mount.
   *
   * Read live, a disposition applied mid-scroll would delete the card under the
   * reader's thumb and jump the feed — the same reason `seenAtMount` is a
   * snapshot. Cards already on screen keep their place; the decision takes
   * effect on the next open or refresh, which is when a feed is allowed to
   * change shape.
   */
  const [dispositions, setDispositions] = useState<DispositionMap>(() => loadDispositions(userId ?? ''))
  useEffect(() => { setDispositions(loadDispositions(userId ?? '')) }, [userId])

  /**
   * Applied at the moment of decision, and reflected on the next open.
   *
   * `flagged` deliberately does not hide anything: the reader said the finding
   * is real and needs work, and hiding it then would be the surface raising
   * something and immediately removing the reminder.
   */
  /**
   * Judgment first, writing second — and writing is never compulsory.
   *
   * ── What this used to do, and why it was wrong ────────────────────────────
   *
   * A `flagged` judgment opened the capture sheet automatically, on the
   * reasoning that committing to work is worth a sentence. The reasoning is
   * fine and the trigger was not: `flagged` is a FEED state, not a statement
   * that the reader wants to write something. Five of the most ordinary answers
   * on the surface map to it — Thesis weaker, Cases outdated, Needs review,
   * Revise target, Needs update — so answering a question in one tap threw the
   * reader into a form they never asked for, which is precisely the friction
   * "judgment first" exists to remove. The compatibility mapping had started
   * dictating product behaviour.
   *
   * Now: tap, persist, stay in the feed. Capture is still one tap away on every
   * card's action bar and through the global control, and a follow-up prompt
   * ("add why?") is a later phase's job — offered, not imposed.
   */
  const applyVerdict = useCallback(
    async (card: SignalCard, question: string, o: VerdictOption): Promise<boolean> => {
      if (!userId) return false
      const result = await recordSignalJudgment({
        userId,
        orgId: currentOrgId ?? null,
        card,
        question,
        judgment: {
          key: o.key,
          label: o.label,
          disposition: o.disposition,
          intent: o.intent,
        },
      })
      // The LOCAL write decides what the reader is told, because it is what the
      // feed reads on the next open. A dropped audit request must not stop
      // somebody triaging on a train; it is marked and left for a sync pass.
      if (result.durable === 'failed') {
        console.warn('[feed] judgment recorded locally but not durably', {
          card: card.type, key: o.key,
        })
      }
      return result.local
    },
    [userId, currentOrgId],
  )

  /**
   * Feedback about the feed, with the two effects kept apart.
   *
   * 1. RECORD it, to product telemetry, always.
   * 2. DISMISS the card, only where the option says it should.
   *
   * Two statements rather than one, because Phase 3's defect was a
   * compatibility state silently driving unrelated behaviour. "This was not
   * useful" and "hide this" are different claims, and a reader may mean the
   * first without the second — the option declares which, and neither is
   * inferred from the other.
   *
   * `feed_wrong_person` records a ROUTING complaint and does not touch
   * coverage. Repeated feedback may one day suggest an ownership change; a
   * menu tap silently rewriting team data would be a different product.
   */
  const applyFeedback = useCallback(
    (card: SignalCard, o: FeedFeedbackOption) => {
      // Fire-and-forget by design: the card goes away because the reader asked,
      // not because telemetry replied. A dismissal that waited on a network
      // round trip would be worse than a lost datapoint.
      recordFeedFeedback({ card, option: o, orgId: currentOrgId ?? null })
      if (o.dismisses && userId) {
        recordDisposition(userId, card.type, card.entity.id, {
          kind: 'rejected',
          // Namespaced so this never reads as an investment judgment. Anything
          // querying judgments filters on the `feed_` prefix — or, durably, on
          // the fact that this wrote no audit row at all.
          key: o.key,
          label: o.label,
          question: 'Feed feedback',
          cardType: card.type,
          until: Date.now() + DISPOSITION_DAYS.rejected * 86_400_000,
        })
        setDispositions(loadDispositions(userId))
      }
    },
    [userId, currentOrgId],
  )

  const { track } = useFeedDwell(userId)

  /**
   * Draft reweights on scenario cases, written from the feed.
   *
   * `draft_*` only — the published case is untouched, so this is reversible by
   * construction and needs no confirmation ceremony. The `user_id` filter is
   * belt and braces: RLS already restricts UPDATE to `auth.uid() = user_id`,
   * but it does so by matching zero rows and returning SUCCESS, so a bug that
   * sent somebody else's case id would report a save that never happened.
   * Filtering here makes that case an observable zero instead.
   */
  const [savingCases, setSavingCases] = useState<string | null>(null)
  const saveCaseDrafts = useCallback(
    async (cardId: string, edits: { id: string; probability: number }[]) => {
      if (!userId || !edits.length) return
      setSavingCases(cardId)
      try {
        const stamp = new Date().toISOString()
        for (const e of edits) {
          const { error } = await (supabase as any)
            .from('analyst_price_targets')
            // Cast because the generated DB types predate the `draft_*`
            // columns, which exist in production and are already written by
            // `useAnalystPriceTargets`. The repo's types and the live schema
            // have drifted; this is the drift, not a new column.
            .update({ draft_probability: e.probability, draft_updated_at: stamp } as any)
            .eq('id', e.id)
            .eq('user_id', userId)
          if (error) throw error
        }
        await queryClient.invalidateQueries({ queryKey: ['scenario-cards'] })
      } finally {
        setSavingCases(null)
      }
    },
    [userId, queryClient],
  )

  // Resume the previous session if there is a recent one, so returning from an
  // asset lands where the user left. A fresh visit gets a new seed, which is
  // what makes a genuine refresh reorder the feed.
  /**
   * Show one kind only. Set by tapping a tile's category chip — the chip names
   * what a card is, so it is the obvious control for "more like this", and
   * having it do nothing was a dead affordance on every tile.
   */
  /**
   * Curate or Explore. A browsing MODE, not a filter.
   *
   * Deliberately outside `feedFilter`: the category row answers "which of these
   * do I want", and this answers "which question am I asking" — what deserves
   * my attention, or what might be interesting. Folding it into the filters
   * would make Explore look like a sixth category, which is the one thing the
   * phase brief is explicit that it is not.
   */
  const [mode, setMode] = useState<'curate' | 'explore'>('curate')
  /** Explore's own category selection, kept apart from Curate's filter state. */
  const [exploreCategory, setExploreCategory] = useState<FeedCategory | null>(null)
  /**
   * The Explore tile a reader has opened, if any.
   *
   * Explore is preview -> rich tile -> asset page. Tapping a preview used to
   * jump straight to the asset route, which skips the middle step and throws
   * away the reader's place in the mosaic. This holds the opened item so the
   * rich card can render over Explore, with Explore still mounted behind it.
   */
  const [exploreFocus, setExploreFocus] = useState<ExploreItem | null>(null)

  /**
   * The target/cases editor, opened over the card instead of replacing it.
   *
   * "Set a target" and "Review cases" both routed to the asset page, which is
   * the whole surface for a change that takes one number and a horizon — the
   * reader loses the feed, their place in it, and the card they were answering.
   */
  const [targetSheet, setTargetSheet] = useState<
    { assetId: string; symbol: string; price: number | null } | null
  >(null)

  /**
   * The expanded chart, or nothing.
   *
   * Held here rather than per card so only one can ever be open, and so a
   * windowed slot collapsing underneath does not take the overlay with it.
   * Everything it needs is captured at open time — the series, the overlays,
   * the resolved name — which also means it cannot re-resolve a symbol and
   * find a different one.
   */
  const [fsChart, setFsChart] = useState<{
    symbol: string
    companyName: string | null
    series: any[]
    bands: PriceBand[]
    markers: PriceMarker[]
  } | null>(null)

  const [kindFilter, setKindFilter] = useState<string | null>(null)

  /**
   * The curated view: several facets at once, intersected.
   *
   * kindFilter above stays as the tile chip's one-tap "more like this" — it is
   * the right control for a glance. This is the other half: you cannot express
   * "European industrials, news and decisions only" by tapping a chip.
   */
  const [feedFilter, setFeedFilter] = useState<FeedFilter>(EMPTY_FILTER)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const { data: facets } = useFeedFacets()

  const [resumed] = useState(() => loadFeedSession())
  const [shuffleSeed, setShuffleSeed] = useState(() => resumed?.seed ?? Math.floor(Math.random() * 2 ** 31))

  // The feed must not end. Ideas paginate from the server, but attention,
  // signals and derived insights are finite sets. When the server has no more
  // pages, additional cycles of the derived insights are appended instead of
  // the scroll simply stopping. Each cycle is reshuffled and labelled, so it
  // reads as "here is the rest of the book to look at" rather than a silent
  // repeat.
  const [cycle, setCycle] = useState(() => resumed?.cycle ?? 0)

  // Snapshot at mount for the same reason as the seen map: re-reading live
  // would re-rank the list under the reader as their own dwell is recorded.
  const [interestAtMount] = useState(() => loadInterest(userId ?? ''))
  const [readthroughFor, setReadthroughFor] = useState<ScoredFeedItem | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // State, not a ref. The component returns early while loading, so the
  // scroller does not exist on first render — effects keyed on a ref bound to
  // nothing and never re-ran, which is why pull-to-refresh did nothing and the
  // scroll position was never saved.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const restoredRef = useRef(false)

  // One query for every asset referenced by an attention item, rather than a
  // lookup inside each card.
  const attentionAssetIds = useMemo(
    () => Array.from(new Set(attentionItems.map(a => a.context?.asset_id).filter(Boolean) as string[])),
    [attentionItems]
  )
  const { data: attentionAssets } = useQuery({
    queryKey: ['attention-feed-assets', attentionAssetIds],
    queryFn: async () => {
      if (!attentionAssetIds.length) return {} as Record<string, { symbol: string; company_name: string | null }>
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .in('id', attentionAssetIds)
      if (error) throw error
      return Object.fromEntries((data ?? []).map((a: any) => [a.id, a]))
    },
    enabled: attentionAssetIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  // Attention items are raised per trade-queue row, so a four-leg pair
  // produces four near-identical decision cards. Look up pair membership for
  // the sources on screen so legs of one pair can be collapsed into a single
  // tile.
  const attentionSourceIds = useMemo(
    () => attentionItems
      .filter(a => a.source_type === 'trade_queue_item')
      .map(a => a.source_id)
      .filter(Boolean) as string[],
    [attentionItems]
  )
  const { data: pairInfo, isLoading: pairInfoLoading } = useQuery({
    queryKey: ['attention-pair-membership', attentionSourceIds],
    queryFn: async () => {
      const empty = { keyBySource: {} as Record<string, string>, legsByPair: {} as Record<string, any[]> }
      if (!attentionSourceIds.length) return empty

      const { data: sources, error } = await supabase
        .from('trade_queue_items')
        .select('id, pair_id, pair_trade_id')
        .in('id', attentionSourceIds)
      if (error) throw error

      const keyBySource: Record<string, string> = {}
      const pairKeys = new Set<string>()
      for (const row of (sources ?? []) as any[]) {
        const key = row.pair_trade_id || row.pair_id
        if (!key) continue
        keyBySource[row.id] = key
        pairKeys.add(key)
      }
      if (!pairKeys.size) return { keyBySource, legsByPair: {} }

      // Every leg of those pairs, so the surviving card can show the whole
      // trade rather than the one leg that happened to raise the alert.
      const keys = [...pairKeys]
      const { data: legs } = await supabase
        .from('trade_queue_items')
        .select('id, action, pair_id, pair_trade_id, pair_leg_type, assets:asset_id(id, symbol, company_name)')
        .or(`pair_id.in.(${keys.join(',')}),pair_trade_id.in.(${keys.join(',')})`)
        .eq('visibility_tier', 'active')
        .neq('status', 'deleted')

      const legsByPair: Record<string, any[]> = {}
      for (const leg of (legs ?? []) as any[]) {
        const key = leg.pair_trade_id || leg.pair_id
        if (!key) continue
        ;(legsByPair[key] ||= []).push(leg)
      }
      return { keyBySource, legsByPair }
    },
    enabled: attentionSourceIds.length > 0,
    staleTime: 60_000,
  })
  const pairKeyBySource = pairInfo?.keyBySource

  // Drop only genuinely empty cards. An earlier 24-character threshold was
  // hiding real posts — short reasoning is still reasoning. This now catches
  // just the AI insights that arrive as a call to action with no finding.
  const substantive = items.filter(item => {
    // Drop the generated discovery prompts. They are eight hardcoded questions
    // ("What are the biggest risks to your portfolio right now?") emitted when
    // human content runs thin, yet they render under an "AI Insight" badge —
    // an action prompt with no finding behind it. The mobile feed now carries
    // attention items and genuinely derived signals, so it does not need
    // filler to stay populated.
    if ((item as any).meta?.isDiscovery) return false

    if (stripMarkup(item.content ?? '').length > 0) return true
    if ('title' in item && item.title) return true
    return 'asset' in item && !!item.asset
  })

  // Demote what has already been seen so the feed does not open on the same
  // post every time. Snapshot the seen map once per mount: reading it live
  // would reshuffle the list underneath the reader as they scroll.
  const [seenAtMount] = useState(() => loadSeen(userId ?? ''))
  const visibleItems = useMemo(
    () => rotateBySeen(substantive, seenAtMount),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [substantive.map(i => i.id).join(','), seenAtMount]
  )

  // Record what actually reached the screen, so the next open leads with
  // something else.
  useEffect(() => {
    if (!userId || !visibleItems.length) return
    const timer = setTimeout(() => markSeen(userId, visibleItems.slice(0, 10).map(i => i.id)), 1500)
    return () => clearTimeout(timer)
  }, [userId, visibleItems])

  // News for the names already in front of the reader. Deliberately derived
  // from what the feed is showing rather than the whole book: each symbol
  // costs a provider call, and a story about a name you are not looking at is
  // not why you opened this.
  const newsSymbols = useMemo(() => {
    const out: string[] = []
    for (const item of visibleItems) {
      const sym = ('asset' in item && item.asset ? item.asset.symbol : null) as string | null
      if (sym) out.push(sym)
    }
    for (const sig of realSignals) {
      const sym = sig.relatedAssets?.[0]?.symbol
      if (sym) out.push(sym)
    }
    return Array.from(new Set(out)).slice(0, 12)
  }, [visibleItems, realSignals])

  /**
   * Cached closes for the names on screen, for the price pane.
   *
   * Keyed off `newsSymbols` — the names the feed is already showing — for the
   * same reason the news query is: a chart of a name nobody is looking at
   * costs a round trip and answers no question.
   */

  const { data: news } = useMarketNews(newsSymbols)
  const newsItems = news?.items ?? []

  const { data: events } = useMarketEvents(newsSymbols)

  /** Symbol → asset, for turning a story's tickers into things you can open. */
  const assetBySymbol = useMemo(() => {
    const map = new Map<string, { id: string; symbol: string; companyName?: string | null; sector?: string | null }>()
    for (const item of visibleItems) {
      const a = ('asset' in item ? item.asset : null) as any
      if (a?.symbol) map.set(a.symbol.toUpperCase(), { id: a.id, symbol: a.symbol, companyName: a.company_name, sector: a.sector })
    }
    for (const sig of realSignals) {
      for (const a of (sig.relatedAssets ?? []) as any[]) {
        if (a?.symbol) map.set(a.symbol.toUpperCase(), { id: a.id, symbol: a.symbol, companyName: a.company_name, sector: a.sector })
      }
    }
    return map
  }, [visibleItems, realSignals])

  // Live quotes for the names on screen — the input to the unusual-mover and
  // earnings-reaction templates.
  const { quotes: feedQuotes } = useMarketData(newsSymbols, { enabled: newsSymbols.length > 0 })

  // Active weight needs both sides: what the book holds and what the benchmark
  // holds. Fetched together and joined here rather than per-card, which would
  // be a query per position.
  const EMPTY_ACTIVE_RISK = useMemo(
    () => ({ rows: [] as any[], notHeldCount: 0, notHeldActivePct: 0 }),
    [],
  )
  const { data: activeRisk = EMPTY_ACTIVE_RISK } = useQuery({
    queryKey: ['feed-active-risk', userId],
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      // Ordered, because `.limit(1)` on an unordered select picks whichever row
      // Postgres returns first — which is not stable, and 4 of the 11 active
      // portfolios have no benchmark weights at all. The card that came back
      // therefore varied between reloads.
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id, name')
        .eq('status', 'active')
        .order('name', { ascending: true })
        .limit(1)
      const portfolioId = (portfolios as any[])?.[0]?.id as string | undefined
      const portfolioName = (portfolios as any[])?.[0]?.name as string | undefined
      if (!portfolioId) return { rows: [], notHeldCount: 0, notHeldActivePct: 0 }

      const [{ data: holdings }, { data: bench }] = await Promise.all([
        supabase
          .from('portfolio_holdings')
          .select('asset_id, shares, price, date, assets(id, symbol, asset_type, current_symbol, lifecycle_status)')
          .eq('portfolio_id', portfolioId)
          .order('date', { ascending: false, nullsFirst: false }),
        supabase
          .from('portfolio_benchmark_weights')
          // as_of_date is selected even though the table can only hold one
          // today: `UNIQUE (portfolio_id, asset_id)` forbids a second. The
          // moment that constraint is relaxed for historical active weights,
          // an unfiltered read starts merging index files across dates — the
          // distinct-vs-current collapse, for the third time in this codebase.
          .select('asset_id, weight, as_of_date, portfolio_id')
          .eq('portfolio_id', portfolioId),
      ])

      // Same dated-snapshot rule as the portfolio page: only the newest row
      // per asset is a live position.
      const current = new Map<string, any>()
      for (const h of (holdings as any[]) ?? []) {
        if (!current.has(h.asset_id)) current.set(h.asset_id, h)
      }
      const rows = [...current.values()]
      const total = rows.reduce((s, h) => s + (Number(h.shares) || 0) * (Number(h.price) || 0), 0)
      if (total <= 0) return { rows: [], notHeldCount: 0, notHeldActivePct: 0 }

      // One file per portfolio, newest wins. A no-op today and load-bearing
      // the day the history migration lands.
      const currentBench = latestBenchmarkRows((bench ?? []) as any[])
      const benchByAsset = new Map(currentBench.map((b: any) => [b.asset_id, Number(b.weight)]))

      /**
       * Index constituents the book does not hold at all.
       *
       * One decision, not N. A concentrated book against a 500-name index is
       * underweight every name it skipped, and listing those would bury the
       * positions somebody actually chose. The peer pane states them as a
       * single line — see `ActiveWeightPeers` — so the number is visible
       * without pretending to be a ranking.
       */
      const held = new Set(rows.map((h: any) => h.asset_id))
      let notHeldCount = 0
      let notHeldActivePct = 0
      for (const b of currentBench as any[]) {
        if (held.has(b.asset_id)) continue
        notHeldCount += 1
        notHeldActivePct -= Number(b.weight) || 0
      }

      return {
        notHeldCount,
        notHeldActivePct,
        rows: rows
          .map((h: any) => ({
            assetId: h.asset_id,
            symbol: h.assets?.symbol ?? '',
            weight: ((Number(h.shares) || 0) * (Number(h.price) || 0)) / total * 100,
            benchmarkWeight: benchByAsset.has(h.asset_id) ? benchByAsset.get(h.asset_id)! : null,
            // Carried for the contract card: a weight is a book number and the
            // eyebrow has to be able to say which book, and as of when.
            portfolioId,
            portfolioName: portfolioName ?? 'Portfolio',
            asOf: h.date ?? null,
            // How many names the benchmark file lists at all. Without it the
            // builder cannot tell "the index excludes this name" from "this
            // portfolio has no benchmark", and asserts the first.
            benchmarkNameCount: benchByAsset.size,
            // What KIND of instrument it is. The builder suppresses the claims
            // that are structurally impossible for a class rather than merely
            // unverified — an index is not a position, a currency pair is not
            // an index constituent.
            instrumentClass: h.assets?.asset_type ?? null,
            /**
             * The ticker it trades under NOW, for price lookups only.
             *
             * `symbol` stays what the holdings file said — rewriting it to
             * match the present would make old uploads unreconcilable — so a
             * renamed name (SQ, held, now XYZ) would otherwise look up a price
             * series that ends the day it was renamed. The card still says
             * SQ; the chart comes from XYZ.
             */
            tradedSymbol: (h.assets?.current_symbol || h.assets?.symbol) ?? null,
            lifecycleStatus: h.assets?.lifecycle_status ?? null,
          }))
          .filter((r: any) => r.symbol),
      }
    },
  })
  const activeRiskRows = activeRisk.rows

  /**
   * Every held name ranked by active weight, for the peer pane.
   *
   * Built once here rather than per card: the ranking is a property of the
   * book, not of the name the card happens to be about, and recomputing it
   * inside three cards would sort the same 69 rows three times.
   *
   * Names with no benchmark weight are dropped rather than treated as zero.
   * A missing row means the index file did not list the name, which is not the
   * same claim as "the index holds none of it" — and `ActiveWeightPeers`
   * renders a signed active weight, so guessing here would put a fabricated
   * bet on a chart.
   */
  const activeRiskPeers = useMemo(
    () => activeRiskRows
      .filter((r: any) => r.benchmarkWeight != null && Number.isFinite(r.weight))
      .map((r: any) => ({
        symbol: r.symbol,
        weightPct: r.weight,
        benchmarkPct: r.benchmarkWeight as number,
        activePct: r.weight - (r.benchmarkWeight as number),
      }))
      .sort((a: any, b: any) => Math.abs(b.activePct) - Math.abs(a.activePct)),
    [activeRiskRows],
  )

  /**
   * Derived content cards.
   *
   * Templates are pure functions over data we already hold, so this is a memo
   * rather than a query — and each returns nothing when there is nothing worth
   * saying, which is what keeps the feed from filling with cards that always
   * fire.
   */
  /**
   * The three kinds that have moved onto the card contract.
   *
   * Behind the `signal-cards` flag. While it is off nothing here renders and
   * the feed is exactly as it was; while it is on, these three kinds render
   * through SignalCardView and the other four keep their legacy tiles. That
   * mixed state is deliberate and temporary — the exit is the remaining four
   * builders, after which the legacy components are deleted in one PR.
   */
  /**
   * Signal cards are the feed, not an experiment.
   *
   * They were behind a `signal-cards` flag while three of seven kinds were
   * migrated and the other four still rendered as legacy tiles. That flag cost
   * more than it bought: it silently failed twice — once because the root
   * route's <Navigate replace> dropped the query string before anything read
   * it, and once because nothing on screen said which state you were in — and
   * every "why is the feed empty" question had to rule the flag out first.
   *
   * A card that renders nothing and a card behind an unset flag look identical.
   * Removing the flag removes that ambiguity permanently.
   */
  const { data: recommendationResults = [], isLoading: recsLoading } = useRecommendationCards()

  /** Keyed by trade_queue_items.id, so a recommendation keeps its position in
   *  the interleave rather than jumping to the top of the feed. */
  const recommendationBySource = useMemo(() => {
    const m = new Map<string, { card: SignalCard; input: RecommendationInput }>()
    for (const r of recommendationResults) {
      if (r.result.ok) {
        m.set(r.result.card.id.replace(/^recommendation:/, ''), { card: r.result.card, input: r.input })
      }
    }
    return m
  }, [recommendationResults])

  /**
   * Keyed by assetId, replacing the active_risk template cards one for one.
   *
   * The builder INPUT is kept beside the card, not discarded. The card carries
   * the active weight as a formatted string, and the what-if control needs the
   * two numbers behind it — recovering them by parsing `metric.value` back out
   * of the rendered card would be the same mistake as reading a rollup instead
   * of the source.
   */
  const activeRiskByAsset = useMemo(() => {
    const m = new Map<string, { card: SignalCard; input: ActiveRiskInput }>()
    const usable = activeRiskRows.filter((r: any) => r.asOf)
    for (const row of selectActiveRisk(usable.map((r: any) => ({
      assetId: r.assetId, symbol: r.symbol, weightPct: r.weight,
      benchmarkWeightPct: r.benchmarkWeight, portfolioId: r.portfolioId,
      portfolioName: r.portfolioName, asOf: r.asOf,
      benchmarkNameCount: r.benchmarkNameCount,
      instrumentClass: r.instrumentClass,
    })), { limit: 3 })) {
      const built = buildActiveRiskCard(row)
      if (built.ok) m.set(row.assetId, { card: built.card, input: row })
    }
    return m
  }, [activeRiskRows])

  /**
   * Scenario cards — the strongest content the product can produce.
   *
   * Behind the `signal-cards` flag. Placed ahead of the interleave rather than
   * inside it: these are the only cards built on data no other tool has, and
   * burying the one saying "TSLA is below your bear case" beneath four news
   * items would be a ranking decision nobody would defend out loud.
   */
  const { data: scenarioResults = [], isLoading: scenariosLoading } = useScenarioCards()


  const scenarioCards = useMemo(
    () => scenarioResults.filter(r => r.ok).map(r => (r as { ok: true; card: any }).card),
    [scenarioResults],
  )

  const templateCards = useMemo(() => {
    const quoteList = newsSymbols
      .map(sym => {
        const q = feedQuotes.get(sym)
        return q ? { symbol: sym, price: q.price, changePercent: q.changePercent } : null
      })
      .filter(Boolean) as { symbol: string; price: number; changePercent: number }[]
    const quoteMap = new Map(quoteList.map(q => [q.symbol.toUpperCase(), q]))

    return [
      ...unusualMovers(quoteList, assetBySymbol as any),
      ...outsizedActiveRisk(activeRiskRows),
      ...earningsAhead(events?.upcomingEarnings ?? [], assetBySymbol as any),
      ...earningsResult(events?.recentEarnings ?? [], assetBySymbol as any, quoteMap),
      ...corporateActions(events?.corporateActions ?? [], assetBySymbol as any, quoteMap),
      ...economicReleases(events?.economicReleases ?? []),
    ]
  }, [newsSymbols, feedQuotes, assetBySymbol, events, activeRiskRows])

  // One card per pair. The highest-priority leg is kept — the list is already
  // ordered by attention priority — and the rest are dropped rather than
  // rendered as separate screens for what is one decision.
  const dedupedAttention = useMemo(() => {
    // Until pair membership resolves, every leg still looks like its own
    // decision. Rendering them would show "SELL CLOV" for a beat and then
    // replace it with the pair, so hold the attention cards back instead.
    if (attentionSourceIds.length && pairInfoLoading) return []
    if (!pairKeyBySource || !Object.keys(pairKeyBySource).length) return attentionItems
    const seenPairs = new Set<string>()
    return attentionItems.filter(a => {
      const key = a.source_id ? pairKeyBySource[a.source_id] : undefined
      if (!key) return true
      if (seenPairs.has(key)) return false
      seenPairs.add(key)
      return true
    })
  }, [attentionItems, pairKeyBySource, attentionSourceIds.length, pairInfoLoading])

  /**
   * Every feed entry, expressed in the terms the ranking model understands.
   *
   * The adapter is the only place that knows where each kind hides its signal
   * type, its weight and its deviation, and it is deliberately explicit rather
   * than clever: seven sources store those in seven different shapes, and one
   * generic reader over them would quietly return `undefined` the first time a
   * shape moved. A field missing here has to mean "this signal genuinely does
   * not carry that", because the model reads unknown as neutral.
   *
   * Deviation is normalised per signal type BEFORE it reaches the model. "12%
   * through a bull case" and "12% overweight versus benchmark" are the same
   * number and nothing like the same fact, so each kind converts its own.
   */
  const rankInputFor = useCallback((e: any): PriorityInput => {
    /** The stored judgment for a card, so acknowledgment can be read. */
    const judgmentFor = (type: SignalType, entityId?: string | null): JudgmentRecord | null => {
      if (!entityId) return null
      const d = dispositions[`${type}:${entityId}`]
      return d ? { key: d.key ?? d.verdict ?? null, kind: d.kind, at: d.at } : null
    }
    const withJudgment = (
      i: Omit<PriorityInput, 'judgment'>,
      entityId?: string | null,
    ): PriorityInput => ({ ...i, judgment: judgmentFor(i.type, entityId) })

    switch (e.kind) {
      case 'scenario': {
        const c = e.card
        // The card's own metric IS the deviation: a percentage of the case the
        // price broke through, and the same number the builder computed the
        // severity from. Reading it back beats recomputing it differently.
        const dev = Number(String(c?.metric?.value ?? '').replace(/[^0-9.]/g, ''))
        return withJudgment({
          id: c.id,
          type: c.type as SignalType,
          severity: c.severity,
          occurredAt: c.provenance?.occurredAt ?? null,
          deviationPct: Number.isFinite(dev) ? dev : null,
          // A scenario ladder exists because somebody covers the name, and the
          // card carries the portfolios it sits in.
          held: (c.context ?? []).some((chip: any) => /portfolio/i.test(String(chip?.label ?? ''))),
          weightPct: null,
        }, c?.entity?.id)
      }

      case 'lens': {
        const l = e.lens
        switch (l.type) {
          case 'breach':
            return withJudgment({
              id: `breach-${l.breach.assetId}`,
              type: 'target_hit',
              severity: Math.abs(l.breach.overshootPct * 100) >= 15 ? 'critical' : 'attention',
              occurredAt: l.breach.asOf,
              // `TargetBreach` carries no weight at all. Null is neutral here,
              // not zero — see `materialityBand`.
              weightPct: null,
              held: true,
              deviationPct: Math.abs(l.breach.overshootPct * 100),
            }, l.breach.assetId)
          case 'stale':
            return withJudgment({
              id: `stale-${l.target.assetId}`,
              type: 'target_expired',
              severity: l.target.overdueMonths >= 6 ? 'critical' : 'attention',
              occurredAt: l.target.expiredAt,
              weightPct: null,
              held: true,
              // Months overdue is this signal's deviation — how far past its own
              // horizon the view has run. Converted into the band's 0-100 shape
              // rather than compared against a price move, which it is not.
              deviationPct: l.target.overdueMonths * 5,
            }, l.target.assetId)
          case 'untargeted':
            return withJudgment({
              id: `untargeted-${l.position.assetId}`,
              type: 'no_target',
              severity: l.position.weightPct >= 5 ? 'critical' : 'attention',
              occurredAt: l.position.asOf,
              weightPct: l.position.weightPct,
              held: true,
              deviationPct: null,
            }, l.position.assetId)
          case 'conviction':
            return withJudgment({
              id: `conviction-${l.gap.assetId}`,
              type: l.gap.direction === 'overweight' ? 'conviction_oversized' : 'conviction_undersized',
              severity: 'attention',
              occurredAt: l.gap.asOf,
              weightPct: l.gap.weightPct,
              held: true,
              // `tension` is this lens's own mismatch measure on its own scale.
              // Scaled into the band's shape rather than reused raw.
              deviationPct: Math.min(Math.abs(l.gap.tension) * 100, 100),
            }, l.gap.assetId)
          default:
            return withJudgment({
              id: `crowded-${l.name.assetId}`,
              type: 'crowding',
              severity: 'informational',
              occurredAt: l.name.asOf,
              weightPct: l.name.maxWeightPct,
              held: true,
              deviationPct: null,
            }, l.name.assetId)
        }
      }

      case 'insight': {
        const i = e.insight
        const type: SignalType = i.kind === 'no_thesis' ? 'no_research'
          : i.kind === 'concentration' ? 'crowding'
          : 'research_stale'
        return withJudgment({
          id: i.id,
          type,
          severity: (i.weightPct ?? 0) >= 5 ? 'attention' : 'informational',
          occurredAt: i.lastTouchedAt ?? null,
          weightPct: i.weightPct ?? null,
          held: true,
          // The Phase 7 context IS the deviation, where the trigger was a move.
          deviationPct: i.context?.kind === 'price_move' ? Math.abs(i.context.movePct ?? 0) : null,
        }, i.assetId)
      }

      case 'attention': {
        const a = e.attention
        /**
         * Attention items are not one thing, so they must not get one tier.
         *
         * A trade awaiting the PM's call, a deliverable three weeks late and a
         * plain notification were all pushed to the top of the feed together by
         * `leadWith: 'attention'`. Mapping by source is what lets the overdue
         * project sink while the pending trade stays competitive.
         */
        const type: SignalType =
          a.source_type === 'trade_queue_item' ? 'recommendation'
          : a.source_type === 'project' || a.source_type === 'project_deliverable' ? 'project_overdue'
          : a.attention_type === 'informational' ? 'thought'
          : 'awaiting_review'
        return withJudgment({
          id: String(a.attention_id),
          type,
          severity: a.priority === 'high' ? 'critical'
            : a.priority === 'medium' ? 'attention'
            : 'informational',
          occurredAt: a.created_at ?? null,
          weightPct: null,
          held: !!a.context?.asset_id,
          overdueDays: a.due_date
            ? Math.floor((Date.now() - new Date(a.due_date).getTime()) / DAY_MS)
            : null,
        }, a.context?.asset_id)
      }

      case 'template': {
        const c = e.card
        return withJudgment({
          id: String(c.id ?? c.symbol),
          // `active_risk` is deliberately absent from TEMPLATE_TYPE — it has
          // its own builder — so it is named here rather than falling to news.
          type: signalTypeForTemplate(c.kind),
          severity: c.tone === 'negative' ? 'attention' : 'informational',
          occurredAt: c.occurredAt ?? null,
          weightPct: c.weightPct ?? null,
          held: !!c.heldIn?.length,
          deviationPct: null,
        }, c.assetId)
      }

      case 'news':
        return {
          id: String(e.news?.id ?? e.news?.url ?? 'news'),
          type: 'news',
          severity: 'informational',
          occurredAt: e.news?.publishedAt ?? e.news?.published_at ?? null,
          weightPct: null,
          held: false,
        }

      case 'idea':
        return {
          id: String(e.idea?.id ?? 'idea'),
          type: e.idea?.type === 'trade' ? 'trade_idea' : 'thought',
          severity: 'informational',
          occurredAt: e.idea?.created_at ?? null,
          weightPct: null,
          held: false,
        }

      default:
        // `signal` entries are already contract cards.
        return withJudgment({
          id: String(e.signal?.id ?? e.kind),
          type: (e.signal?.type ?? 'news') as SignalType,
          severity: e.signal?.severity ?? 'informational',
          occurredAt: e.signal?.provenance?.occurredAt ?? null,
          weightPct: null,
          held: false,
        }, e.signal?.entity?.id)
    }
  }, [dispositions])

  /**
   * Explore's candidates, from exactly the same sources Curate reads.
   *
   * No new content query. Explore is a second arrangement of material already
   * in hand, which is why it can exist without a data programme behind it —
   * and why switching modes is instant rather than a load.
   */
  const exploreCandidates = useMemo<ExploreItem[]>(() => {
    const base = [
      ...lensesToExplore(lenses as any),
      ...scenarioCardsToExplore(scenarioCards as any[]),
      ...insightsToExplore(derivedInsights as any[]),
      ...ideasToExplore(visibleItems as any[]),
      ...newsToExplore((newsItems ?? []) as any[]),
      ...templatesToExplore(templateCards as any[]),
      ...attentionToExplore(dedupedAttention as any[]),
    ]
    // Aggregates are derived from the base set, so they can never claim a count
    // the reader cannot go and find.
    return [...base, ...aggregatesFor(base, Date.now())]
  }, [lenses, scenarioCards, derivedInsights, visibleItems, newsItems, templateCards, dedupedAttention])

  /**
   * The names Explore wants a sparkline for — derived from ITS OWN page.
   *
   * ── The trap this avoids ──────────────────────────────────────────────────
   *
   * `usePriceHistory` takes the first `MAX_SYMBOLS` (24) of whatever it is
   * given. Curate feeds it the composed Curate feed order, so passing Explore
   * the same list would have given tiles 25+ no chart while looking exactly
   * like missing data — the failure mode this project has now hit three times.
   *
   * So Explore composes first and asks second: the symbol list is taken from
   * the page it is actually about to render, in the order the tiles appear,
   * which is also the order a thumb reaches them. React Query keys on the
   * symbol list, so this is a SEPARATE cache entry from Curate's rather than a
   * competitor for the same budget, and it is gated on the mode so only one of
   * the two is ever in flight.
   *
   * Beyond 24 a tile simply renders without a sparkline. That is a graceful
   * degradation and not a silent one: the content of every tile stands on its
   * own, and none of them claims a chart it does not have.
   */
  const exploreSymbolList = useMemo(
    () => exploreSymbols(composeExplore(exploreCandidates, { now: Date.now(), category: exploreCategory })
      .map(c => c.item)),
    [exploreCandidates, exploreCategory],
  )
  const { data: exploreSeries } = usePriceHistory(exploreSymbolList, { enabled: mode === 'explore' })

  // Interleave so consecutive screens are not all one kind. Scores are
  // position-derived rather than raw: each source ranks on its own scale, and
  // using position preserves the ordering each source already decided
  // (including the seen-rotation applied to ideas) while making the two
  // comparable. `leadWith` keeps the single most pressing decision first.
  /**
   * The last UNFILTERED composition, kept for the price-history symbol set.
   *
   * Written only when no filter is active, so it holds the mixed feed's own
   * ranked order and does not move when a category is selected. That is what
   * makes the query key below stable — see `pricedSymbols`.
   *
   * A ref rather than state: nothing renders from it, and making it state would
   * add a render per composition purely to feed a query key.
   */
  const unfilteredRef = useRef<any[]>([])

  const feedEntries = useMemo(() => {
    const attentionEntries = dedupedAttention.map((a, idx) => ({
      kind: 'attention' as const,
      score: dedupedAttention.length - idx,
      attention: a,
    }))
    // Learned interest nudges rank rather than dictating it: a strong
    // interest can lift an item by up to a third of the list, but cannot
    // override recency and relevance entirely, so the feed still surfaces
    // new names instead of narrowing to what was read yesterday.
    const ideaEntries = visibleItems.map((i, idx) => {
      const boost = interestScore(interestAtMount, {
        assetId: ('asset' in i && i.asset ? i.asset.id : null) as string | null,
        authorId: i.author?.id ?? null,
      })
      return {
        kind: 'idea' as const,
        score: (visibleItems.length - idx) + boost * visibleItems.length * 0.33,
        idea: i,
      }
    })
    const signalEntries = realSignals.map((sig, idx) => ({
      kind: 'signal' as const,
      score: realSignals.length - idx,
      signal: sig,
    }))

    // Cycle 0 is the first pass; each additional cycle re-presents the derived
    // insights further down the book, so scrolling keeps yielding real
    // observations about real positions rather than running out.
    const insightEntries = Array.from({ length: cycle + 1 }).flatMap((_, round) =>
      derivedInsights.map((ins, idx) => ({
        kind: 'insight' as const,
        score: derivedInsights.length - idx,
        insight: ins,
        round,
      }))
    )

    // News is the only source that brings genuinely new material between
    // visits — everything else is the book restated. Ranked on the provider's
    // own relevance where there is one, recency otherwise, then normalised to
    // the same positional scale as every other kind.
    const newsEntries = (newsItems ?? []).map((n, idx) => ({
      kind: 'news' as const,
      score: newsItems.length - idx,
      news: n,
    }))

    // Derived templates share one kind so the interleaver treats them as a
    // single stream. Grouping them per-template would let six sparse kinds
    // dominate the rotation over the sources that actually carry the book.
    const templateEntries = templateCards.map(c => ({
      kind: 'template' as const,
      score: c.score,
      // The declared signal type travels WITH the card, so `categoryOf` can
      // read it rather than inferring a category from the entry kind. That
      // inference is what filed active risk — a sizing decision — under News.
      card: { ...c, type: signalTypeForTemplate(c.kind) },
    }))

    // Both lenses share one kind so the interleaver treats them as a single
    // stream, for the same reason the templates do: two sparse kinds would
    // otherwise take two slots in every rotation.
    const lensEntries = [
      ...((lenses?.conviction ?? []).map((g, idx) => ({
        kind: 'lens' as const,
        score: 40 - idx,
        lens: { type: 'conviction' as const, gap: g },
      }))),
      ...((lenses?.crowded ?? []).map((c, idx) => ({
        kind: 'lens' as const,
        score: 38 - idx,
        lens: { type: 'crowded' as const, name: c },
      }))),
      // Scored above the other two: a target that has been hit or has expired
      // is a decision waiting on someone, where sizing and crowding are
      // observations. Attention should outrank interest.
      ...((lenses?.breaches ?? []).map((b, idx) => ({
        kind: 'lens' as const,
        score: 60 - idx,
        lens: { type: 'breach' as const, breach: b },
      }))),
      ...((lenses?.stale ?? []).map((t, idx) => ({
        kind: 'lens' as const,
        score: 58 - idx,
        lens: { type: 'stale' as const, target: t },
      }))),
      // Scored between the target lenses and the observations. A large position
      // nobody has priced is a decision waiting on someone, like the two target
      // kinds above it, but unlike them it has been waiting since the position
      // was opened rather than since a horizon lapsed, so it is less urgent than
      // a view that has just run out.
      ...((lenses?.untargeted ?? []).map((u, idx) => ({
        kind: 'lens' as const,
        score: 50 - idx,
        lens: { type: 'untargeted' as const, position: u },
      }))),
    ]

    /**
     * A specific decision event beats a generic attention reminder.
     *
     * If a name already has a target-hit, target-expired, no-target or
     * scenario-gap card in this feed, an insight card saying "nobody has
     * looked at it lately" is describing the SAME unresolved condition in
     * weaker words. Two cards about one problem is how a feed teaches people
     * to skim: the precise one gets read at the same rate as the vague one.
     *
     * Precedence rather than scoring, because this is not a close call — the
     * stronger card names the event and offers the matching action, and the
     * insight card names neither.
     *
     * Deliberately NOT applied to `no_thesis`: a name with a stale target and
     * no written research at all are two genuinely different gaps, and the
     * second is not implied by the first.
     */
    const claimed = claimedSubjects([
      // Each kind stores its subject somewhere different; the extraction stays
      // here where the shapes are known, and the rule stays in `feed-dedupe`.
      // Read per variant. The optional-chain version compiled only because
      // nothing typechecked this file: `gap` exists on one member of the union,
      // so `e.lens?.gap` is an error, and the `as any` fallbacks would have
      // silently returned undefined for every kind if the shape ever moved.
      ...lensEntries.map(e => {
        const l = e.lens
        switch (l.type) {
          case 'conviction': return l.gap.symbol
          case 'crowded':    return l.name.symbol
          case 'breach':     return l.breach.symbol
          case 'stale':      return l.target.symbol
          case 'untargeted': return l.position.symbol
          default:           return null
        }
      }),
      ...(scenarioCards as any[]).map(c => c?.entity?.ticker),
    ])
    const insightEntriesDeduped = suppressCoveredInsights(insightEntries, claimed)

    // Scenario cards join the pool instead of rendering in their own block
    // above it. They were unconditionally first, so a gap on a 0.4% watchlist
    // name preceded a 12% position below its bear case and no ranking could
    // reach them. They still usually lead — `scenario_gap` tops tier 0 — but
    // now they have to earn it against the rest of the book.
    const scenarioEntries = (scenarioCards as any[]).map(c => ({
      kind: 'scenario' as const,
      score: 0,
      card: c,
    }))

    const all = [...attentionEntries, ...ideaEntries, ...signalEntries, ...insightEntriesDeduped, ...newsEntries, ...templateEntries, ...lensEntries, ...scenarioEntries]

    // Filtering before the interleave rather than after: interleaving exists to
    // stop one kind running consecutively, and with a single kind selected that
    // constraint has nothing to do — applying it first would just be a shuffle
    // fighting a rule that can never be satisfied.
    /**
     * The symbol a tile is about, where it has one.
     *
     * Every kind stores it somewhere different, and a tile with no symbol —
     * a macro event, an unattributed story — is *kept* when only kind filters
     * are set and dropped when an asset facet is. Dropping it either way would
     * silently remove whole categories from a "European only" view that the
     * reader never meant to exclude.
     */
    const symbolOf = symbolOfEntry

    const assetFacetsActive =
      feedFilter.sectors.length > 0 || feedFilter.countries.length > 0 ||
      feedFilter.exchanges.length > 0 || feedFilter.symbols.length > 0

    const matchesFilter = (e: any): boolean => {
      // Categories, not internal kinds. `feedFilter.kinds` carries category
      // keys now, so the Curate sheet and the header banner are filtering the
      // same objects by the same words — see lib/mobile/feed-categories.
      if (feedFilter.kinds.length) {
        const cat = categoryOf(e)
        if (!cat || !feedFilter.kinds.includes(cat)) return false
      }
      if (!assetFacetsActive) return true

      const sym = symbolOf(e)
      // No symbol and an asset facet is set: this tile cannot be shown to
      // satisfy it, so it is excluded rather than assumed to qualify.
      if (!sym) return false
      if (feedFilter.symbols.length && !feedFilter.symbols.includes(sym)) return false

      const f = facets?.bySymbol.get(sym.toUpperCase())
      if (feedFilter.sectors.length && !(f?.sector && feedFilter.sectors.includes(f.sector))) return false
      if (feedFilter.countries.length && !(f?.country && feedFilter.countries.includes(f.country))) return false
      if (feedFilter.exchanges.length && !(f?.exchange && feedFilter.exchanges.includes(f.exchange))) return false
      return true
    }

    // Facets intersect: two sectors widen, adding a country narrows. The chip
    // filter stays a separate one-tap override on top.
    const curated = filterCount(feedFilter) ? all.filter(matchesFilter) : all
    // The one-tap chip filter speaks the same vocabulary as the sheet.
    const filtered = kindFilter ? curated.filter(e => categoryOf(e) === kindFilter) : curated

    // Tag each entry with what it is *about* so the interleaver can keep one
    // name off three consecutive screens. symbolOf already knows where each
    // kind hides its subject.
    const pool = filtered.map(e => ({ ...e, subject: symbolOf(e) }))

    /**
     * Rank deterministically, then interleave only what is left.
     *
     * ── Why not simply sort everything ───────────────────────────────────
     *
     * `interleaveByKind` exists for a real problem: concatenating sources
     * produces "all decisions, then all projects, then all ideas", and a
     * strict sort of per-source positional scores produced the identical feed
     * on every visit. Its answer was a seeded weighted draw — importance
     * biases position rather than fixing it.
     *
     * That answer is right for the tail and wrong for the head. A PM opening
     * the feed twice must see the same most-important thing both times, and a
     * ranking nobody can reproduce cannot be debugged. But a fully sorted feed
     * would also run every scenario card, then every target card, then every
     * insight — which is the blocked-by-kind reading the interleaver was
     * written to prevent.
     *
     * So: the decision tiers lead, in a fixed order, and everything below them
     * is interleaved as before. The scores handed to the interleaver are now
     * genuinely comparable across kinds, which is the complaint its own header
     * opens with.
     */
    const ranked = diversify(
      rankFeed<any>(pool, rankInputFor, Date.now()),
      {
        // Off under a single-category filter: the reader asked for all of that
        // category, and interleaving a category with itself means nothing.
        enabled: !kindFilter && !feedFilter.kinds.length,
        // The opening cap needs to know what family a card belongs to, which
        // is the same canonical answer the filters use.
        categoryOf: (e: any) => categoryOf(e),
      },
    )

    const lead = ranked.filter(r => r.priority.tier <= LEAD_TIER)
    const tail = ranked.filter(r => r.priority.tier > LEAD_TIER)

    // Recorded before the filter is applied downstream — see `unfilteredRef`.
    if (!kindFilter && !feedFilter.kinds.length) {
      unfilteredRef.current = ranked.map(r => r.item)
    }

    return [
      ...lead.map(r => r.item),
      ...interleaveByKind<any>(
        // The interleaver reads `score`, and the ranked total is the first
        // number in this feed's history that means the same thing in every
        // kind. Position-derived scores were explicitly not comparable.
        tail.map(r => ({ ...r.item, score: r.priority.total })),
        {
          maxRun: 1,
          // `leadWith: 'attention'` is gone. It forced workflow items to open
          // the feed, which is precisely the "a project overdue by two days
          // outranks a 12% position below its bear case" failure — and the
          // lead is now decided by tier instead.
          seed: shuffleSeed,
        },
      ),
    ]
  }, [dedupedAttention, visibleItems, realSignals, derivedInsights, newsItems, templateCards, cycle, interestAtMount, shuffleSeed, kindFilter, lenses, feedFilter, facets, scenarioCards])

  /**
   * Keys that survive a recompute.
   *
   * The pipeline rebuilds every entry object each time it runs, so identity
   * cannot come from the object. A slot whose key changed would remount its
   * card and lose the carousel pane the reader had paged to.
   */
  const feedKeys = useMemo(() => feedEntryKeys(feedEntries), [feedEntries])

  /**
   * The names to fetch closes for, taken from the feed that was actually
   * composed.
   *
   * ── The bug this replaces ─────────────────────────────────────────────────
   *
   * This used to be derived from `newsSymbols`, which is built from ideas posts
   * and ideas signals and nothing else. So a conviction card, a crowding card, a
   * target-hit card, a stale-target card, a derived insight and every market
   * template asked for a price pane that had never been fetched — `panes.length`
   * came out 0, the evidence band collapsed, and the surface silently lost
   * almost every chart it declared. The only cards that kept one were the few
   * whose ticker happened to also appear in somebody's post.
   *
   * That is why the product went from "a lot of interactive charts" to one
   * chart on one tile: nothing about the charts was removed, the data stopped
   * being requested for them.
   *
   * ── Why the order matters ─────────────────────────────────────────────────
   *
   * `usePriceHistory` caps at twelve symbols, so which twelve is a real
   * decision. Walking `feedEntries` in its final interleaved order means the
   * cards the reader reaches first are the ones that get a chart, rather than
   * whichever source happened to sort highest.
   */
  /**
   * Display ticker to the one the series is stored under.
   *
   * `price_history_cache` is keyed by `coalesce(current_symbol, symbol)` — what
   * the instrument trades as now — while cards say what the holdings file said,
   * because rewriting that would make old uploads unreconcilable. So a renamed
   * name (SQ, held, now trading as XYZ) is fetched as XYZ and must be looked up
   * as XYZ too.
   *
   * Shared by the fetch and the lookup deliberately. They were two separate
   * copies of this mapping for about an hour, and only the fetch side had it:
   * the series arrived under the traded ticker and `pricePane` asked for the
   * display ticker, so every renamed instrument fetched a chart it could never
   * find. One resolver means the two cannot disagree again.
   */
  const tradedSymbolOf = useCallback((symbol: string): string => {
    const up = symbol.toUpperCase()
    for (const r of activeRiskRows as any[]) {
      if (r.symbol && String(r.symbol).toUpperCase() === up && r.tradedSymbol) {
        return String(r.tradedSymbol).toUpperCase()
      }
    }
    return up
  }, [activeRiskRows])

  /**
   * There is no feed-wide symbol budget any more.
   *
   * A `pricedSymbols` list used to be collected here — every symbol the
   * composed feed mentioned, deduplicated, then handed to `usePriceHistory`,
   * which took the first 24 and split them across seven parallel requests
   * because PostgREST returns at most 1,000 rows per call.
   *
   * That machinery existed only because the query was batched. `PricePane`
   * reads one symbol, which is 260 rows and one request, and `FeedSlot` keeps
   * about five cards mounted at any depth. So the budget, the ordering
   * question it forced ("which 24?"), the paging, and the whole-list query key
   * that invalidated on any change all go away together.
   *
   * Explore still batches, and correctly: it renders many tiles at once and
   * each needs only a sparkline, which is a genuinely different shape of
   * request from a card's full year.
   */

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0].isIntersecting) return
        if (hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        } else if (derivedInsights.length > 0) {
          // Server exhausted — keep the scroll alive with another pass over
          // the book rather than dead-ending.
          setCycle(c => c + 1)
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, derivedInsights.length])

  // Restore once, after the entries that make up the remembered offset exist.
  // Attempting it before render leaves scrollTop clamped to zero.
  useEffect(() => {
    if (restoredRef.current || !resumed?.scrollTop) return
    if (!scroller || !feedEntries.length) return
    const el = scroller
    restoredRef.current = true
    // Two frames: one for the list to lay out, one for snap to settle.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.scrollTop = resumed.scrollTop
    }))
  }, [resumed, scroller, feedEntries.length])

  // Persist position as the user scrolls, and once more on unmount so a fast
  // navigation away is not lost to the throttle window.
  useEffect(() => {
    const el = scroller
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const persist = () => saveFeedSession({ seed: shuffleSeed, cycle, scrollTop: el.scrollTop })
    const onScroll = () => {
      if (timer) return
      timer = setTimeout(() => { timer = null; persist() }, 400)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (timer) clearTimeout(timer)
      persist()
    }
  }, [scroller, shuffleSeed, cycle])

  /**
   * A filter change starts the feed again, at the top.
   *
   * ── The bug ───────────────────────────────────────────────────────────────
   *
   * Reported from a phone: scroll down five tiles, come back up, apply a
   * filter, and the old tiles are still there — the filtered ones only begin
   * once you scroll past everything you had already seen.
   *
   * Two causes, and they compound. `cycle` grows as the reader scrolls, and
   * each cycle re-presents the derived insights further down, so the rendered
   * list is several times longer than the candidate set. And the scroll
   * position is left where it was, so the reader is standing in the middle of a
   * list that has just been rebuilt underneath them.
   *
   * Selecting a category is a request to see that category, from the start. It
   * resets the depth and returns to the top, which is also what stops the DOM
   * from carrying five screens of cards nobody can reach any more — most of the
   * slowdown after a long scroll.
   */
  /**
   * Every facet, not only the categories.
   *
   * This read `kinds` alone, so narrowing to a sector, country, exchange or
   * symbol reset neither the depth nor the scroll position — the reader was
   * left standing five screens down a list that had just been rebuilt
   * underneath them, which is the half of the report that survived the first
   * fix. Any change to what the reader asked for starts the feed again.
   */
  const filterKey = [
    kindFilter ?? '',
    feedFilter.kinds.join(','),
    feedFilter.sectors.join(','),
    feedFilter.countries.join(','),
    feedFilter.exchanges.join(','),
    feedFilter.symbols.join(','),
  ].join('|')
  const lastFilterKey = useRef(filterKey)
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return
    lastFilterKey.current = filterKey
    setCycle(0)
    if (scroller) scroller.scrollTop = 0
  }, [filterKey, scroller])

  // A deliberate refresh: refetch every source, re-deal the order, drop the
  // saved position and return to the top. The browser's own pull-to-refresh
  // would instead reload the page, which loses all of that.
  const handleRefresh = useCallback(async () => {
    setShuffleSeed(Math.floor(Math.random() * 2 ** 31))
    setCycle(0)
    clearFeedSession()
    restoredRef.current = true // nothing to restore after an explicit refresh
    await Promise.all([
      refetch(),
      refetchAttention?.(),
      // useSignalCards and useDerivedInsights expose no refetch, so refresh
      // them through the cache they share.
      queryClient.invalidateQueries({ queryKey: ['signal-cards'] }),
      queryClient.invalidateQueries({ queryKey: ['derived-insights'] }),
    ].filter(Boolean) as Promise<unknown>[])
    scroller?.scrollTo({ top: 0 })
  }, [refetch, refetchAttention, queryClient, scroller])

  const { indicatorRef, isRefreshing, armed } = usePullToRefresh({
    scroller,
    onRefresh: handleRefresh,
  })

  const openAsset = useCallback(
    (assetId: string, symbol: string) => {
      onNavigate?.({ id: assetId, title: symbol, type: 'asset', data: { id: assetId, symbol } })
    },
    [onNavigate]
  )

  /**
   * A book named in a card's context row.
   *
   * "Held in Core Equity" is only better than "Held in 1" if the name goes
   * somewhere. This is the reader's shortest route from a finding about a
   * position to the position itself.
   */
  const openPortfolio = useCallback(
    (portfolioId: string, name: string) => {
      onNavigate?.({ id: portfolioId, title: name, type: 'portfolio', data: { id: portfolioId, name } })
    },
    [onNavigate]
  )

  /**
   * Where an Explore tile goes.
   *
   * Routed through `resolveFeedAction`, the same resolver Curate uses, so
   * "Review target" means one destination in both modes. A second route
   * grammar for Explore is exactly the divergence that gave the product two
   * filter taxonomies and cost a phase to unpick.
   */
  /**
   * Opening a tile shows the rich card, not the asset page.
   *
   * `filter` destinations never reach here — `MobileExplore` owns the category
   * state and handles those itself. Everything else focuses the item, and the
   * overlay decides what it can render. Navigation is still available from
   * inside that card, as an explicit action, which is the order the mode is
   * meant to have: preview, then detail, then leave.
   */
  const openExploreItem = useCallback((item: ExploreItem) => {
    if (item.destination.kind === 'filter') return
    setExploreFocus(item)
  }, [])

  /**
   * Contextual actions, handled in place where the feed can honour them.
   *
   * `review_target`, `set_target` and `open_cases` all resolve to the same
   * editor — `MobileCaseTargets`, which is where a price and a horizon are
   * actually written — so the feed opens it over the card rather than
   * navigating to the page that hosts it. Persistence is that component's own;
   * nothing here fakes a save.
   *
   * Everything else still routes. `update_thesis` in particular needs a
   * rich-text field with history beside it, which is a page rather than a
   * sheet, and pretending otherwise would be the dead-end button this feed has
   * been removing since Phase 4.
   */
  const handleFeedAction = useCallback((t: { id: string; title: string; type: string; data: Record<string, unknown> }) => {
    const focus = (t.data as any)?.focus
    if (t.type === 'asset' && (focus === 'target' || focus === 'cases')) {
      setTargetSheet({
        assetId: String((t.data as any).id ?? t.id),
        symbol: String((t.data as any).symbol ?? t.title),
        price: null,
      })
      return
    }
    onNavigate?.(t)
  }, [onNavigate])

  /** Leaving the focused card for the asset page, on purpose. */
  const leaveExploreForAsset = useCallback((item: ExploreItem) => {
    const d = item.destination
    if (d.kind === 'tab') return onNavigate?.(d.target)
    if (d.kind !== 'action') return
    const target = resolveFeedAction(d.action as FeedActionKey, {
      assetId: d.assetId ?? null,
      symbol: d.symbol ?? null,
      name: d.name ?? item.companyName ?? null,
    })
    if (target) return onNavigate?.(target)
    // `open_asset` is handled by the surface rather than the resolver, which
    // returns null for it by design.
    if (d.assetId) openAsset(d.assetId, d.symbol ?? item.symbol ?? '')
  }, [onNavigate, openAsset])

  /**
   * The price pane, built once instead of at six call sites.
   *
   * Every kind that is about a name wants the same thing behind it, and the
   * five copies of this block that existed had already drifted: one passed
   * bands, three did not, one keyed the lookup off the traded ticker and the
   * rest off the display symbol. Returns nothing when there is no series, so
   * `panes.filter(Boolean)` keeps a card from advertising a chart it cannot
   * draw.
   */
  const pricePane = useCallback(
    (symbol: string | null | undefined, opts?: { bands?: PriceBand[]; markers?: PriceMarker[] }) => {
      /**
       * The pane is composed here; the DATA is fetched by the pane itself.
       *
       * ── What changed, and why it matters ────────────────────────────────
       *
       * This used to read a shared map filled by one batched query for the
       * first 24 symbols in feed order. PostgREST caps a response at 1,000
       * rows, so 24 names at 260 closes each was already seven parallel pages
       * — and the twenty-fifth card onward simply lost its chart. Not because
       * the data was missing, but because the budget had run out, which meant
       * whether a card carried evidence depended on where the reader happened
       * to be standing.
       *
       * `PricePane` fetches ONE symbol, which is 260 rows: comfortably inside
       * the cap, so it is a single request with no paging at all. The cap only
       * ever bit because the query was batched. `FeedSlot` keeps about five
       * cards mounted, so this is about five independent, individually cached
       * requests at any scroll depth.
       *
       * Only the SYMBOL is resolved synchronously here — an unresolved or
       * placeholder symbol gets no pane, because there is no honest statement
       * to make about it. The other three states (loading, drawable,
       * resolved-but-uncached) are the pane's own business.
       */
      const resolved = priceIdentity(symbol, () => undefined)
      if (!resolved.symbol) return null
      // Price history is stored under what the provider serves, which for a
      // renamed instrument is not what the holdings file called it.
      const traded = tradedSymbolOf(resolved.symbol)
      const bands = opts?.bands ?? []
      const markers = opts?.markers ?? []
      return {
        id: 'price',
        label: 'Price',
        content: (
          <PricePane
            symbol={traded}
            bands={bands}
            markers={markers}
            onExpand={(series: PricePoint[]) => setFsChart({
              symbol: traded,
              companyName: assetBySymbol.get(traded)?.companyName ?? null,
              series, bands, markers,
            })}
          />
        ),
      }
    },
    [tradedSymbolOf, assetBySymbol],
  )

  /**
   * A verdict pane, for the many cards whose only other affordance is "Open".
   *
   * The feed's problem was never that its findings were wrong, it was that most
   * of them could only be read. A card with nothing to do on it is a card people
   * learn to swipe past, and once that habit forms it applies to the cards that
   * DO matter. So every kind that can carry a proposition gets one response
   * control, and the response is recorded as a note against the name rather
   * than as a hidden vote: the desk has to be able to find it later, and an
   * opinion nobody can read is not worth collecting.
   */
  /**
   * The optional next step after a judgment, or nothing.
   *
   * ── The deduplication rule ────────────────────────────────────────────────
   *
   * Suppressed when the follow-on is the SAME action the card's own primary
   * button already offers. On a no-target card the primary is "Set a target"
   * and the `price_target` judgment's follow-on is also `set_target` — two
   * identical buttons about 150px apart, one of which is permanently visible in
   * a sticky bar. The inline one adds nothing there.
   *
   * It is a comparison of action IDS, not labels, so a rewording cannot quietly
   * defeat it. Where the actions differ — `cases_outdated` offering the case
   * editor on a card whose primary is the target editor — both render, because
   * they genuinely go to different places.
   *
   * Returns null for anything unroutable, which is the same guard Phase 4 uses:
   * a follow-on with no destination is a dead-end button, and the answer is not
   * to render it.
   */
  const resolveNextFor = useCallback(
    (card: SignalCard) => (o: VerdictOption) => {
      const id = o.nextAction?.id
      if (!id) return null
      // Feed feedback never produces an investment-workflow CTA. Saying "this
      // story is not relevant to me" must not open a thesis editor.
      if (o.intent === 'feed_quality') return null
      if (id === card.actions.primary.id) return null

      const target = resolveFeedAction(id as FeedActionKey, {
        assetId: card.entity.kind === 'asset' ? card.entity.id : null,
        symbol: card.entity.ticker ?? null,
        name: card.entity.name,
      })
      if (!target) return null
      return { label: o.nextAction!.label, run: () => onNavigate?.(target) }
    },
    [onNavigate],
  )

  const verdictPane = useCallback(
    (card: SignalCard, question: string, options: VerdictOption[]) => ({
      id: 'verdict',
      label: 'Respond',
      content: (
        <VerdictBar
          question={question}
          options={options}
          // The card's own prompt already asked this, higher up and in a style
          // a reader meets first.
          hideQuestion={card.prompt === question}
          resolveNext={resolveNextFor(card)}
          onRespond={o => applyVerdict(card, question, o)}
        />
      ),
    }),
    [applyVerdict, resolveNextFor],
  )

  /**
   * One wrapper for every migrated kind.
   *
   * All seven kinds now render through SignalCardView, so the eyebrow, severity
   * dot, claim/metric split, overflow menu, show-more control, one-screen
   * constraint and action grammar are defined once. A card that suppresses
   * renders nothing rather than falling back to a legacy tile — a suppression
   * is a decision, not a rendering failure, and gate() has already logged it
   * with its reason.
   */
  const renderCard = (
    result: ReturnType<typeof buildInsightCard>,
    trackAs: string,
    assetId: string | null,
    /**
     * Everything interactive, as ONE carousel.
     *
     * Replaces the old `evidence` + `detail` pair. Two regions meant the lower
     * one carried `flex-1` and was therefore the first to give up space, so the
     * controls under the question were what got clipped when a card ran out of
     * room. The chart, the editor and the response all page together now.
     *
     * Empty is fine: most kinds have nothing to chart and the band collapses
     * rather than leaving a gap.
     */
    panes: { id: string; label: string; content: React.ReactNode }[] = [],
  ) => {
    if (!result.ok) return null
    const card = result.card
    // A finding the reader has settled or rejected does not come back until its
    // disposition expires. This is the `snoozed` suppression the contract has
    // named since it was written, finally doing something.
    if (isDisposedOf(dispositions, card.type, card.entity.id)) return null
    return (
      <div key={card.id} className="h-full w-full" ref={track({ assetId, kind: trackAs })}>
        <SignalCardSection
          card={card}
          panes={panes}
          onOpenAsset={openAsset}
          onOpenPortfolio={openPortfolio}
          onFeedAction={handleFeedAction}
          onFeedback={applyFeedback}
          onCapture={setCaptureCtx}
          onWhy={() => {}}
          onSnooze={() => {}}
          onDismiss={() => {}}
          onPrimary={() => {}}
          // Tapping the kind chip narrows the feed, exactly as the legacy
          // tile chips did. `trackAs` is the feed's own entry kind, which is
          // what kindFilter already speaks — mapping SignalType back to it
          // would be lossy in both directions.
          // The card's own category, so tapping its chip and choosing the same
          // word in Curate produce the same feed.
          onFilterKind={() => setKindFilter(categoryOf({ kind: trackAs }) ?? null)}
        />
      </div>
    )
  }

  /**
   * What the first coherent feed actually depends on.
   *
   * ── The bug this fixes ────────────────────────────────────────────────────
   *
   * The gate covered five sources — ideas, attention, signals, insights, pair
   * info — and the feed composes from ten. The five it missed include the two
   * that produce the highest-ranked cards in the product: `usePortfolioLenses`
   * (targets hit, targets expired, positions with no target) and
   * `useScenarioCards` (a price outside its own ladder). Both are tier 0 or 1.
   *
   * So the first paint happened with only the low-tier sources in hand, showed
   * whatever led those, and then a scenario gap landed and took the lead. The
   * reader saw one tile replaced by another and concluded — reasonably — that
   * the ranking had changed its mind. Nothing had; the feed had simply been
   * committed before it was composed.
   *
   * ── Critical versus enrichment ────────────────────────────────────────────
   *
   * CRITICAL means the input can change which cards exist, what tier they are,
   * or which one leads. Everything below is critical on that test, and all of
   * it now gates the first commit.
   *
   * ENRICHMENT means the input only adds decoration to a card that already
   * exists and already knows its rank. `usePriceHistory` is the clear case: a
   * missing sparkline collapses an evidence band, and no card's eligibility,
   * tier, score or order depends on it. It must NOT gate — waiting on it would
   * hold a correct feed behind a picture, and it is also the slowest input.
   *
   * `useMarketNews` and the market templates are the interesting middle. They
   * produce real cards, so they are critical for COMPLETENESS — but they are
   * tier 4, they can never lead, and they are the slowest of the content
   * sources. Gating on them would trade a stable first card for a slower one
   * and gain nothing: a news card appearing late changes nothing above it.
   */
  const composing =
    isLoading || attentionLoading || signalsLoading || insightsLoading ||
    lensesLoading || scenariosLoading || recsLoading ||
    (attentionSourceIds.length > 0 && pairInfoLoading)

  if (composing) {
    return (
      // The branded mark, not a border-radius with a spinning edge.
      //
      // `TesseractLoader` already exists and already runs at app boot, so this
      // is the same motion the reader has just seen rather than a second
      // loading vocabulary. Reused rather than rebuilt.
      //
      // No artificial minimum display time. The brief allows one to avoid a
      // single-frame flash, and it is not needed here: the gate now waits on
      // seven sources including the portfolio lenses, so a cold feed is never
      // ready inside a frame. Adding a floor would only make a warm feed slower.
      <div className="flex h-full items-center justify-center" data-testid="feed-loader">
        <TesseractLoader size={96} compact text="Curating your feed…" />
      </div>
    )
  }

  if (!visibleItems.length && !attentionItems.length) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="text-center">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 text-amber-400" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Nothing in your feed yet</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Ideas, thoughts and thesis updates from your team will appear here.
          </p>
        </div>
      </div>
    )
  }

  /**
   * A scenario card, as a function rather than as its own render block.
   *
   * These used to render in a `.map` above the feed, which meant they were
   * unconditionally first: a gap on a 0.4% watchlist name preceded a 12%
   * position below its bear case, and no ranking could reach them because
   * they were never in the pool. They are ordinary feed entries now, and
   * this is the same JSX moved rather than rewritten.
   */
  const renderScenarioCard = (card: any) => (
        <SignalCardSection
          key={card.id}
          card={card}
          // Two panes, paged sideways. The ladder answers "where is the
          // tape"; the distribution answers "where is the analyst's weight",
          // which is a different question and often the more revealing one —
          // on AAPL the base case carries 19% while a bull carries 62%.
          //
          // The gallery has rendered both since the carousel was written.
          // The app rendered only the ladder, so the conviction pane and the
          // carousel itself were verified by e2e on fixtures no user could
          // reach: a green check on something that was not in the product.
          /**
           * One carousel, not two regions.
           *
           * The chart, the case editor and the response are all things the
           * reader interacts with, so they page together in the band that has
           * the height. The question then sits directly above the action bar
           * with nothing between them to squeeze — which is what used to clip
           * the answer buttons out of view.
           */
          panes={[
                {
                  id: 'ladder',
                  label: 'Ladder',
                  content: (
                    <ScenarioLadder
                      price={card.evidence.data.price}
                      cases={card.evidence.data.cases}
                      expected={card.evidence.data.expected}
                    />
                  ),
                },
                /**
                 * The tape behind the ladder, through `pricePane` like every
                 * other card.
                 *
                 * This read the batched map directly, so it carried its own
                 * copy of the availability rule and inherited the 24-symbol
                 * budget — a scenario card deep in the feed lost its chart
                 * even when the closes were cached. One path now decides
                 * whether a chart is honest, and the pane fetches its own
                 * symbol.
                 */
                ...(() => {
                  const p = pricePane(card.entity.ticker, {
                    // The analyst's own cases on the same axis as the tape.
                    // This is the comparison the card claims, and the one the
                    // ladder makes against a single price.
                    bands: (card.evidence.data.cases as any[])
                      .filter(c => Number.isFinite(c.price))
                      .map(c => ({ label: c.name, price: c.price, kind: 'case' as const })),
                  })
                  return p ? [p] : []
                })(),
                {
                  id: 'weight',
                  label: 'Conviction',
                  content: (
                    <ScenarioDistribution
                      cases={card.evidence.data.cases}
                      expected={card.evidence.data.expected}
                      price={card.evidence.data.price}
                      // The builder states WHY there is no expectation. Six
                      // of ten laddered symbols cannot produce one, and the
                      // pane must say which rather than vanish.
                      blockedBy={
                        card.context.find((x: any) =>
                          x.label.startsWith('Probabilities sum') ||
                          x.label.startsWith('Mixed horizons'))?.label ?? null
                      }
                    />
                  ),
                },
                /**
                 * The judgment this card was missing entirely.
                 *
                 * `scenario_gap` is the framework-vs-reality event — the
                 * price has moved outside the range the analyst modelled —
                 * and it was the one signal in the feed with no way to
                 * respond. Meanwhile `target_expired`, which fires purely on
                 * an elapsed horizon, carried the case-vs-price question. The
                 * two were the wrong way round.
                 */
                {
                  id: 'verdict',
                  label: 'Respond',
                  content: verdictPane(
                    card,
                    'Has the investment view changed?',
                    [
                      { key: 'scenario_thesis_intact', label: 'Thesis intact', tone: 'affirm', disposition: 'settled',
                        note: `${card.entity.ticker ?? card.entity.name}: the thesis is intact; the market has moved, my view has not.` },
                      { key: 'scenario_thesis_weaker', label: 'Thesis weaker', tone: 'neutral', disposition: 'flagged',
                        note: `${card.entity.ticker ?? card.entity.name}: the move outside my modelled range has weakened the thesis.`,
                        nextAction: { id: 'open_cases', label: 'Review cases' } },
                      { key: 'scenario_cases_outdated', label: 'Cases outdated', tone: 'neutral', disposition: 'flagged',
                        note: `${card.entity.ticker ?? card.entity.name}: the cases are stale rather than the view. They need restating against where the price actually is.`,
                        nextAction: { id: 'open_cases', label: 'Review cases' } },
                      { key: 'scenario_needs_review', label: 'Needs review', tone: 'neutral', disposition: 'flagged',
                        note: `${card.entity.ticker ?? card.entity.name}: needs a proper review before I would call it either way.`,
                        nextAction: { id: 'open_cases', label: 'Review cases' } },
                    ],
                  ).content,
                },
                {
                  id: 'cases',
                  label: 'Cases',
                  content: (
                    <ScenarioCaseDetail
                      price={card.evidence.data.price}
                      cases={card.evidence.data.cases}
                      expected={card.evidence.data.expected}
                    />
                  ),
                },
                {
                  id: 'reweight',
                  label: 'Reweight',
                  content: (
                    <CaseEditor
                      symbol={card.entity.ticker ?? card.entity.name}
                      saving={savingCases === card.id}
                      cases={(card.evidence.data.cases as any[])
                        .filter(c => c.id)
                        .map(c => ({
                          id: c.id,
                          name: c.name,
                          price: c.price,
                          probability: c.probability,
                          timeframe: c.timeframe,
                          // RLS decides this server-side and fails silently,
                          // so the control must not render unless it matches.
                          mine: !!userId && c.userId === userId,
                          authorName: null,
                        }))}
                      onSaveDraft={edits => saveCaseDrafts(card.id, edits)}
                    />
                  ),
                },
          ]}
          onOpenAsset={openAsset}
          onOpenPortfolio={openPortfolio}
          onFeedAction={handleFeedAction}
          onFeedback={applyFeedback}
          onCapture={setCaptureCtx}
          onWhy={() => {}}
          onSnooze={() => {}}
          onDismiss={() => {}}
          onPrimary={() => {}}
        />
  )

  /**
   * One feed entry, rendered.
   *
   * Extracted from the map so Explore can reuse it. A tile there opens the
   * SAME rich card Curate would show rather than a second detail surface —
   * one renderer, so the two modes cannot drift into disagreeing about what a
   * scenario gap looks like.
   */
  const renderEntry = (entry: any) => {
          // Ranked in with everything else now, rather than rendered in its own
          // block above the feed. The JSX is unchanged; only its position in the
          // list is decided differently.
          if (entry.kind === 'scenario') return renderScenarioCard(entry.card)

          if (entry.kind === 'attention') {
            const a = entry.attention
            const linked = a.context?.asset_id ? attentionAssets?.[a.context.asset_id] : null
            const target = attentionTarget(a)

            // Trade-queue-backed attention items are recommendations. Matched
            // by source_id so the card holds its place in the interleave
            // instead of jumping to the top of the feed.
            const asRecommendation = a.source_type === 'trade_queue_item' && a.source_id
              ? recommendationBySource.get(a.source_id)
              : undefined
            if (asRecommendation) {
              return (
                                <div
                  key={a.attention_id}
                  // h-full, or the SignalCardSection inside collapses to content
                  // height: `h-full` resolves against the PARENT, and a bare
                  // wrapper div has none. That is why the market card rendered at
                  // half a screen while the scenario cards — which render the
                  // section directly, with no wrapper — filled it.
                  className="h-full w-full" ref={track({ assetId: a.context?.asset_id ?? null, kind: 'attention' })}>
                  <SignalCardSection
                    card={asRecommendation.card}
                    // What it holds against what is being asked for. The card
                    // states the proposed weight as a number; the bars put it
                    // beside the current one, which is the comparison the
                    // reader is making in their head either way.
                    //
                    // Only when both exist. `currentWeightPct` is null when the
                    // name is new to the book — a real and different case, and
                    // charting it as a bar of zero would say "we hold none of
                    // it" when the truth is "we could not look it up".
                    /**
                     * One carousel: the sizing bars and the rationale.
                     *
                     * The rationale is the one thing the decision turns on, and
                     * it sat in the lower region — the one that collapses when
                     * a card runs out of room, behind a "Read the full
                     * rationale" toggle that no longer exists.
                     */
                    panes={[
                      ...(asRecommendation.input.proposedWeightPct != null &&
                          asRecommendation.input.currentWeightPct != null ? [{
                        id: 'weights',
                        label: 'Sizing',
                        content: (
                            <WeightBars
                              baselineIndex={0}
                              rows={[
                                {
                                  label: 'Current',
                                  weightPct: asRecommendation.input.currentWeightPct,
                                  tone: 'subject',
                                  note: asRecommendation.input.currentWeightAsOf
                                    ? `book ${asRecommendation.input.currentWeightAsOf.slice(0, 10)}`
                                    : undefined,
                                },
                                {
                                  label: 'Proposed',
                                  weightPct: asRecommendation.input.proposedWeightPct,
                                  tone: 'proposed',
                                },
                              ]}
                              unitNote="Tap to see the change asked for"
                            />
                        ),
                      }] : []),
                      ...(asRecommendation.input.rationale ? [{
                        id: 'rationale',
                        label: 'The case',
                        content: (
                          <div className="text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">
                            {asRecommendation.input.recommendedBy && (
                              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                                {asRecommendation.input.recommendedBy}’s case
                              </p>
                            )}
                            {/* Clamped, because a pane is a box: the full text
                                is a tap away in the commentary drawer. */}
                            <p className="line-clamp-6">{asRecommendation.input.rationale}</p>
                          </div>
                        ),
                      }] : []),
                    ]}
                    onOpenAsset={openAsset}
                    onOpenPortfolio={openPortfolio}
                    onFeedAction={handleFeedAction}
                    onFeedback={applyFeedback}
                    onCapture={setCaptureCtx}
                    onWhy={() => {}}
                    onSnooze={() => snoozeFor(a.attention_id, 24)}
                    onDismiss={() => acknowledge(a.attention_id)}
                    onPrimary={() => { markRead(a.attention_id); if (target) onNavigate?.(target) }}
                  />
                </div>
              )
            }

            /**
             * The two thinnest cards in the feed, given something to work with.
             *
             * "Needs review" and "Overdue" were a title, a clause and two
             * buttons — the only kinds left with an empty evidence band AND an
             * empty detail slot, which is why they read as notifications that
             * had wandered into a feed.
             *
             * The tape is the missing context. A decision waiting on somebody
             * is a decision about a name, and "what has it done since this was
             * raised" is the first thing anybody asks. The raise date goes on
             * the axis as a marker rather than into the prose, so the reader
             * sees the gap between the ask and now rather than computing it.
             */
            const attnBuilt = buildAttentionCard(a as any, linked ? {
              id: linked.id, symbol: linked.symbol,
              companyName: (linked as any).company_name ?? null,
            } : null)
            const attnRaisedAt = a.created_at ?? a.last_activity_at ?? null
            const attnPrice = pricePane(linked?.symbol, {
              markers: attnRaisedAt
                ? [{ date: attnRaisedAt, label: 'Raised', kind: 'event' as const }]
                : [],
            })
            const isDecision = a.attention_type === 'decision_required'

            return renderCard(attnBuilt,
'attention',
a.context?.asset_id ?? null,
[
...(attnPrice ? [attnPrice] : []),
...(attnBuilt.ok ? [{ id: 'verdict', label: 'Respond', content: (
<VerdictBar
                  question={isDecision ? 'What is your answer?' : 'Where does this stand?'}
                  /**
                   * The one set where the generic dispositions are a natural
                   * fit rather than a compatibility mapping. A workflow item
                   * genuinely IS done, in progress, deferred or misrouted, and
                   * those map cleanly onto settled / flagged / rejected without
                   * flattening anything an analyst meant.
                   */
                  options={isDecision
                    ? [
                        { key: 'answered', label: 'Answered', tone: 'affirm', disposition: 'settled',
                          note: `${linked?.symbol ?? a.title}: answered outside the feed. Clearing it from my queue.` },
                        { key: 'in_progress', label: 'In progress', tone: 'neutral', disposition: 'flagged',
                          note: `${linked?.symbol ?? a.title}: still working through it.` },
                        { key: 'defer', label: 'Defer', tone: 'neutral', disposition: 'settled',
                          note: `${linked?.symbol ?? a.title}: deferred deliberately, not forgotten.` },
                        { key: 'not_mine', label: 'Not mine', tone: 'negate', disposition: 'rejected',
                          note: `${linked?.symbol ?? a.title}: this decision is not mine to make.` },
                      ]
                    : [
                        { key: 'done', label: 'Done', tone: 'affirm', disposition: 'settled',
                          note: `${linked?.symbol ?? a.title}: handled. Clearing it from my queue.` },
                        { key: 'in_progress', label: 'In progress', tone: 'neutral', disposition: 'flagged',
                          note: `${linked?.symbol ?? a.title}: in progress. Noting where it stands.` },
                        { key: 'defer', label: 'Defer', tone: 'neutral', disposition: 'settled',
                          note: `${linked?.symbol ?? a.title}: deferred deliberately, not forgotten.` },
                        { key: 'not_mine', label: 'Not mine', tone: 'negate', disposition: 'rejected',
                          note: `${linked?.symbol ?? a.title}: this is not mine to action.` },
                      ]}
                  onRespond={o => {
                    applyVerdict(attnBuilt.card, isDecision ? 'What is your answer?' : 'Where does this stand?', o)
                    // The attention engine has its own record, and a card the
                    // reader has answered should not be waiting on them there
                    // either. Local disposition alone would clear the feed and
                    // leave the queue.
                    if (o.disposition === 'settled') acknowledge(a.attention_id)
                    if (o.disposition === 'rejected') snoozeFor(a.attention_id, 24 * 7)
                  }}
                />
) }] : []),
])
          }

          if (entry.kind === 'lens') {
            const l = entry.lens
            const built =
              l.type === 'conviction' ? buildConvictionCard(l.gap)
              : l.type === 'crowded'  ? buildCrowdingCard(l.name)
              : l.type === 'breach'   ? buildTargetHitCard(l.breach)
              : l.type === 'untargeted' ? buildNoTargetCard(l.position)
              :                         buildStaleTargetCard(l.target)
            const assetId =
              l.type === 'conviction' ? l.gap.assetId
              : l.type === 'crowded'  ? l.name.assetId
              : l.type === 'breach'   ? l.breach.assetId
              : l.type === 'untargeted' ? l.position.assetId
              :                         l.target.assetId
            const symbol =
              l.type === 'conviction' ? l.gap.symbol
              : l.type === 'crowded'  ? l.name.symbol
              : l.type === 'breach'   ? l.breach.symbol
              : l.type === 'untargeted' ? l.position.symbol
              :                         l.target.symbol

            /**
             * The spread behind the claim.
             *
             * Crowding says "six books hold it" and the number alone cannot
             * distinguish five token positions beside one real bet from six
             * books expressing the same view. The bars are that distinction.
             *
             * The other three lens kinds get the price pane when there is a
             * series: a target reached and a view gone stale are both claims
             * about where the tape went, and neither card could show it.
             */
            const panes: any[] = []

            /**
             * The conviction cohort: every name in this book you rated the
             * same way, with its weight.
             *
             * "High conviction, 0.4% position" invites the answer "so is
             * everything else". If the other five high-conviction names sit at
             * 4%, it is not — and nothing on the card could tell those two
             * apart before. Two or more, because a cohort of one is the
             * subject looking at itself.
             */
            if (l.type === 'conviction' && l.gap.cohort?.length > 1) {
              panes.push({
                id: 'cohort',
                // The label follows the BASIS, not the card's conviction field.
                // A ranking against the whole book captioned "high conviction"
                // would be a different claim than the one being drawn — and
                // today the book path is the only one that ever runs.
                label: l.gap.cohortBasis === 'conviction' && l.gap.conviction
                  ? `${l.gap.conviction} conviction`
                  : 'Book sizes',
                content: (
                  <WeightBars
                    rows={l.gap.cohort.map((c: { symbol: string; weightPct: number }) => ({
                      label: c.symbol,
                      weightPct: c.weightPct,
                      tone: c.symbol === l.gap.symbol ? ('subject' as const) : ('neutral' as const),
                    }))}
                    // The subject is the baseline, so every tap answers
                    // "against THIS position" rather than against the heaviest.
                    baselineIndex={Math.max(
                      l.gap.cohort.findIndex((c: { symbol: string }) => c.symbol === l.gap.symbol), 0)}
                    unitNote={l.gap.cohortBasis === 'conviction'
                      ? `Same stated conviction in ${l.gap.portfolioName}`
                      : `Every position in ${l.gap.portfolioName}`}
                  />
                ),
              })
            }
            if (l.type === 'crowded' && l.name.weightsByPortfolio?.length > 1) {
              panes.push({
                id: 'books',
                label: 'By book',
                content: (
                  <WeightBars
                    rows={l.name.weightsByPortfolio.map((w: { name: string; weightPct: number }, i: number) => ({
                      label: w.name,
                      weightPct: w.weightPct,
                      tone: i === 0 ? ('subject' as const) : ('neutral' as const),
                    }))}
                    unitNote="Weight in each portfolio · tap to compare"
                  />
                ),
              })
            }
            /**
             * The target belongs on the axis, on BOTH cards that are about one.
             *
             * This drew a band only for `breach`. The stale-target card, whose
             * entire claim is "this number has stopped being a view", therefore
             * rendered a bare price line with the number in question nowhere on
             * it — the one card in the feed where the reference line IS the
             * argument. The horizon gets a marker for the same reason: the card
             * says the view outlived its own deadline, so the deadline should be
             * a place on the chart rather than a figure in the prose.
             */
            const priceBands: PriceBand[] =
              l.type === 'breach' ? [{ label: 'Target', price: l.breach.target, kind: 'target' }]
              : l.type === 'stale' ? [{ label: 'Target', price: l.target.target, kind: 'target' }]
              : []
            const priceMarkers: PriceMarker[] =
              l.type === 'stale'
                ? [{ date: l.target.expiredAt, label: 'Horizon', kind: 'horizon' }]
                : []

            const priced = pricePane(symbol, { bands: priceBands, markers: priceMarkers })
            if (priced) panes.push(priced)

            // How long the view was given against how long it has overrun. Two
            // durations the prose kept collapsing into one "5mo".
            if (l.type === 'stale') {
              panes.push({
                id: 'horizon',
                label: 'Horizon',
                content: (
                  <HorizonTimeline
                    statedAt={l.target.statedAt}
                    horizonAt={l.target.expiredAt}
                    timeframe={l.target.timeframe}
                  />
                ),
              })
            }

            // The pane ranks, the detail carries the rest — the same split
            // `active-risk-real` uses, and what keeps a card with six books on
            // it from either truncating silently or growing past its screen.
            // A conviction card's claim is that the size and the view disagree.
            // The control that answers it is the same one the active-risk card
            // carries — and deliberately NOT a second copy of the bars above,
            // because within one book value and weight rank identically, so a
            // money view here would be the same chart twice.
            const convictionDetail = l.type === 'conviction'
              ? (
                  <WhatIfSize
                    symbol={l.gap.symbol}
                    currentPct={l.gap.weightPct}
                    benchmarkPct={null}
                    maxPct={Math.max(Math.ceil(l.gap.weightPct * 1.5), 12)}
                    onStage={proposedPct => setCaptureCtx({
                      assetId: l.gap.assetId,
                      symbol: l.gap.symbol,
                      name: l.gap.companyName ?? l.gap.symbol,
                      kind: 'thought',
                      note: `${l.gap.symbol} at ${proposedPct.toFixed(2)}% instead of ${
                        l.gap.weightPct.toFixed(2)}% in ${l.gap.portfolioName}. Stated conviction ${
                        l.gap.conviction ?? 'not recorded'}. Weights from the holdings snapshot of ${
                        l.gap.asOf.slice(0, 10)}. Recorded from the feed; the position is unchanged.`,
                    })}
                  />
                )
              : undefined

            const lensDetail = l.type === 'crowded' && l.name.weightsByPortfolio?.length > 1
              ? (
                  <WeightBars
                    // Money, not weight — a different fact, not a repeat of the
                    // pane above it. A 25% weight in a small book can be a
                    // fraction of a 4% weight in a large one, and "crowded" is
                    // a claim about the firm's money rather than about any one
                    // book's percentages.
                    unit="usd"
                    rows={l.name.weightsByPortfolio.map(
                      (w: { name: string; weightPct: number; valueUsd: number }) => ({
                        label: w.name, weightPct: w.valueUsd,
                      }))}
                    limit={12}
                    unitNote="Exposure by book · tap to compare"
                  />
                )
              : undefined

            /**
             * The two target cards get the control their claim demands.
             *
             * "Your view has outlived its horizon" and "the price reached your
             * target" both end in the same question: what is the number now?
             * Until this, the only answer either card offered was to leave the
             * feed. The tuner puts the arithmetic in front of the reader and
             * records what they land on, which is the most a feed can honestly
             * do with somebody else's research artifact.
             *
             * The reference is named on both. On a stale target it is the
             * holdings mark, which is not a live quote, and `TargetTuner` will
             * not take a price without a label precisely so that cannot be
             * quietly forgotten here.
             */
            const targetDetail =
              l.type === 'stale' ? (
                <TargetTuner
                  symbol={l.target.symbol}
                  currentTarget={l.target.target}
                  reference={{ price: l.target.price, label: 'position mark' }}
                  onRecord={t => setCaptureCtx({
                    assetId: l.target.assetId,
                    symbol: l.target.symbol,
                    name: l.target.companyName ?? l.target.symbol,
                    kind: 'thought',
                    note: `${l.target.symbol} target restated at $${t.toFixed(2)}, against a standing $${
                      l.target.target.toFixed(2)} set on a ${l.target.timeframe ?? 'stated'} horizon that ran out ${
                      l.target.overdueMonths} months ago. Book mark $${l.target.price.toFixed(2)}. Recorded from the feed; the stored target is unchanged.`,
                  })}
                />
              ) : l.type === 'breach' ? (
                <TargetTuner
                  symbol={l.breach.symbol}
                  currentTarget={l.breach.target}
                  reference={{ price: l.breach.price, label: 'position mark' }}
                  onRecord={t => setCaptureCtx({
                    assetId: l.breach.assetId,
                    symbol: l.breach.symbol,
                    name: l.breach.companyName ?? l.breach.symbol,
                    kind: 'thought',
                    note: `${l.breach.symbol} target restated at $${t.toFixed(2)}, against a standing $${
                      l.breach.target.toFixed(2)} the price has already passed. Book mark $${
                      l.breach.price.toFixed(2)}. Recorded from the feed; the stored target is unchanged.`,
                  })}
                />
              ) : l.type === 'untargeted' ? (
                // Seeded from the holdings mark, which is the only price this
                // card has. `currentTarget` is therefore "the price it is at",
                // and the tuner reads as "put a number on this" rather than
                // "change the number", which is the true state of affairs: the
                // implied return starts at zero because nobody has claimed one.
                <TargetTuner
                  symbol={l.position.symbol}
                  currentTarget={l.position.price}
                  reference={{ price: l.position.price, label: 'position mark' }}
                  isFirstTarget
                  onRecord={t => setCaptureCtx({
                    assetId: l.position.assetId,
                    symbol: l.position.symbol,
                    name: l.position.companyName ?? l.position.symbol,
                    kind: 'thought',
                    note: `${l.position.symbol} price target proposed at $${t.toFixed(2)}, against a book mark of $${
                      l.position.price.toFixed(2)}. The position is ${l.position.weightPct.toFixed(1)}% of ${
                      l.position.portfolioName} and had no target on record. Recorded from the feed; nothing is stored as an official target.`,
                  })}
                />
              ) : undefined

            // A response for the kinds with no number to move. Crowding and a
            // conviction gap are propositions about the book, and a reader who
            // disagrees currently has nowhere to say so.
            /**
             * Three dispositions, in the same order on every kind.
             *
             * Left is "handled, stop asking", middle is "real, and it needs
             * work", right is "this is not a useful thing to tell me about this
             * name". The wording is kind-specific because a target and a
             * position size are not answered with the same words, but the
             * POSITION of each answer is fixed, so the gesture is learnable
             * across a feed that mixes seven kinds.
             */
            const lensVerdict = built.ok ? verdictPane(
              built.card,
              l.type === 'stale' ? 'Is this target still your view?'
                : l.type === 'breach' ? 'What should happen next?'
                : l.type === 'crowded' ? `Is ${symbol} too much of one bet?`
                // Asks whether a target BELONGS here. The old question,
                // "How is this position being valued?", presumed the absence
                // was an oversight and asked the analyst to defend their
                // process — on a card that only knows one field is empty.
                : l.type === 'untargeted' ? 'Does this position need a price target?'
                : 'Does the size match the view?',
              l.type === 'untargeted'
                /**
                 * Does this position need a price target?
                 *
                 * The KEYS are unchanged and deliberately so. `price_target`,
                 * `case_framework` and `not_price_driven` already carry exactly
                 * these three meanings, they are classified in
                 * `judgment-policy.ts` (with `not_price_driven` resolving the
                 * no-target signal), and every one already recorded means what
                 * the new label says. Renaming them would orphan those records
                 * for no gain — Phase 3's rule is to classify what exists, not
                 * to retranslate it. Only the labels move, to match the
                 * narrower question.
                 *
                 * `needs_work` is the exception and is genuinely replaced. It
                 * answered "the valuation basis needs work", which is not an
                 * answer to "does this need a target" at all. `not_now` is.
                 *
                 * `not_price_driven` maps to `settled`, NOT `rejected`. A
                 * position held on a framework that does not reduce to a price
                 * target is a legitimate investment process, and the earlier
                 * set had no way to say so: the nearest option was "Not
                 * useful", which files a deliberate methodology under feed spam.
                 */
                ? [
                    { key: 'price_target', label: 'Yes', tone: 'affirm', disposition: 'flagged',
                      note: `${symbol}: this position should carry a price target. Recording that it needs one.`,
                      nextAction: { id: 'set_target', label: 'Set target' } },
                    { key: 'case_framework', label: 'I use cases', tone: 'affirm', disposition: 'flagged',
                      note: `${symbol}: valued on a scenario ladder rather than a single target.`,
                      nextAction: { id: 'open_cases', label: 'Build cases' } },
                    { key: 'not_price_driven', label: 'Not target-driven', tone: 'neutral', disposition: 'settled',
                      note: `${symbol}: held on a thesis that does not reduce to a price. Deliberate, not an oversight.` },
                    { key: 'not_now', label: 'Not now', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: a target question worth answering, but not today. Deferred from the feed.` },
                  ]
                // What should happen next? These are the reader's intended next
                // steps. Tesseract is prompting, not recommending one.
                : l.type === 'breach'
                ? [
                    { key: 'revise_target', label: 'Revise target', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the target needs revising now the price has reached it.`,
                      nextAction: { id: 'set_target', label: 'Revise target' } },
                    { key: 'hold_as_is', label: 'Hold as-is', tone: 'affirm', disposition: 'settled',
                      note: `${symbol}: holding at this level deliberately, target unchanged.` },
                    { key: 'reduce_exit', label: 'Reduce / exit', tone: 'negate', disposition: 'flagged',
                      note: `${symbol}: reaching the target is the trigger to reduce or exit.` },
                    { key: 'reunderwrite', label: 'Re-underwrite', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the whole case needs re-underwriting rather than a new number.`,
                      // Re-underwriting is rewriting the case, which is the
                      // thesis field. Deliberately NOT a trade or sizing flow:
                      // `reduce_exit` gets no follow-on at all for that reason.
                      nextAction: { id: 'update_thesis', label: 'Review thesis' } },
                  ]
                /**
                 * Is this target still your view?
                 *
                 * Keys are target-specific rather than the generic
                 * `still_valid` / `needs_review`, which already mean something
                 * else on the stale-research card. Two judgments that share a
                 * key but answer different questions are indistinguishable the
                 * moment anyone queries them, and the whole point of a semantic
                 * key is that it survives being read back.
                 *
                 * `target_replace_with_cases` is the option this card could not
                 * previously express: "I no longer want a single number, I want
                 * to think in scenarios." It routes to the cases surface, which
                 * is truthful — there is no framework-conversion wizard and
                 * nothing here pretends there is.
                 */
                : l.type === 'stale'
                ? [
                    { key: 'target_still_valid', label: 'Still valid', tone: 'affirm', disposition: 'settled',
                      note: `${symbol}: the target still stands; only its horizon lapsed.` },
                    { key: 'target_revise', label: 'Revise target', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the target needs revising now its horizon has run out.`,
                      nextAction: { id: 'review_target', label: 'Review target' } },
                    { key: 'target_replace_with_cases', label: 'Replace with cases', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: a single target is the wrong shape for this name; it should be scenarios.`,
                      nextAction: { id: 'open_cases', label: 'Review cases' } },
                    { key: 'target_needs_review', label: 'Needs review', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: needs a proper review before I would call it either way.`,
                      nextAction: { id: 'review_target', label: 'Review target' } },
                  ]
                : [
                    { key: 'sized_right', label: 'Sized right', tone: 'affirm', disposition: 'settled',
                      note: `${symbol}: the current size is deliberate and I am comfortable with it.` },
                    { key: 'size_wrong', label: 'Size is wrong', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the size and the view disagree and the size is the part that is wrong.` },
                    { key: 'view_stale', label: 'View is stale', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the size is fine; the stated view behind it is what needs updating.` },
                    { key: 'needs_review', label: 'Review', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: needs a proper review before I would call it either way.` },
                  ],
            ) : null

            /**
             * Detail is a carousel now, not a single control.
             *
             * The slot used to hold exactly one thing, so a card could offer the
             * tuner or the verdict but never both, and the choice was made in
             * this file by an `??` chain. Paging them sideways is the same move
             * the scenario card already makes with its cases and its reweight
             * editor, and it is what lets every lens card carry three things a
             * reader can work: the chart, a second pane, and a control.
             */
            const detailPanes = [
              ...(targetDetail ? [{ id: 'tune', label: 'Target', content: targetDetail }] : []),
              ...(convictionDetail ? [{ id: 'size', label: 'Size', content: convictionDetail }] : []),
              ...(lensDetail ? [{ id: 'money', label: 'Money', content: lensDetail }] : []),
              ...(lensVerdict ? [lensVerdict] : []),
            ]

            return renderCard(
              built, 'lens', assetId,
              // One carousel: the evidence panes and the controls together.
              [...panes, ...detailPanes],
            )
          }

          if (entry.kind === 'insight') {
            const ins = entry.insight
            // Research staleness is a claim about a name, so the tape behind it
            // is the same evidence every other name-shaped card gets. This kind
            // rendered with an empty evidence band and an empty detail slot.
            // The gap ON the axis, not counted at the reader. A marker where
            // research last happened turns "179 days" into a visible distance
            // between a point on the line and its right-hand edge.
            const insightPrice = pricePane(ins.symbol, {
              markers: ins.lastTouchedAt
                ? [{ date: ins.lastTouchedAt, label: 'Last written', kind: 'event' as const }]
                : [],
            })
            // Built once. The handler needs the card to record a disposition
            // against its type and entity, and rebuilding it inside the closure
            // ran the whole builder — suppression gates included — on every tap.
            const insightBuilt = buildInsightCard(ins)
            return renderCard(insightBuilt,
'insight',
ins.assetId ?? null,
[
...(insightPrice ? [insightPrice] : []),
...(insightBuilt.ok ? [
                    {
                      id: 'start',
                      label: 'Start',
                      content: (
                        <ResearchStarter
                          symbol={ins.symbol}
                          daysSince={ins.daysSinceActivity}
                          onStart={(_p, note) => setCaptureCtx({
                            assetId: ins.assetId ?? null,
                            symbol: ins.symbol ?? null,
                            name: ins.companyName ?? ins.symbol ?? null,
                            kind: 'thought',
                            note,
                          })}
                        />
                      ),
                    },
                    {
                      id: 'verdict',
                      label: 'Respond',
                      content: (
                <VerdictBar
                  question={insightBuilt.card.type === 'no_research'
                    ? 'What best describes this position?'
                    : 'Does this change need a look?'}
                  options={insightBuilt.card.type === 'no_research'
                    /**
                     * A position with no written research is not automatically
                     * a failure. It is routinely a legacy holding, or one
                     * somebody else covers, and the old set could only say
                     * "covered" or "needs a refresh" — neither of which is
                     * true of either case.
                     */
                    ? [
                        { key: 'active_thesis', label: 'Active thesis', tone: 'affirm', disposition: 'settled',
                          note: `${ins.symbol}: there is an active thesis; it has not been written up here.`,
                          // The strongest follow-on on the surface: the reader
                          // has just said a view exists and the product has no
                          // record of it. Offered, never forced.
                          nextAction: { id: 'add_rationale', label: 'Add rationale' } },
                        { key: 'legacy_position', label: 'Legacy position', tone: 'neutral', disposition: 'settled',
                          note: `${ins.symbol}: a legacy position carried rather than actively underwritten.` },
                        { key: 'owned_elsewhere', label: 'Someone else owns it', tone: 'neutral', disposition: 'settled',
                          note: `${ins.symbol}: covered by someone else; the research lives with them.`,
                          nextAction: { id: 'open_coverage', label: 'Open coverage' } },
                        { key: 'needs_review', label: 'Needs review', tone: 'negate', disposition: 'flagged',
                          note: `${ins.symbol}: genuinely uncovered and it needs review. Flagged from the feed.`,
                          nextAction: { id: 'add_rationale', label: 'Add rationale' } },
                      ]
                    // Three, not four. A fourth added purely for visual
                    // symmetry would be an answer nobody meant.
                    /**
                     * Three, matched to the new trigger.
                     *
                     * The card now asserts that something changed and the view
                     * did not follow, so the answers are about that change:
                     * the view already accounts for it, it needs revising, or
                     * nobody is covering this name any more. No fourth option
                     * was added for symmetry.
                     */
                    : [
                        { key: 'change_accounted_for', label: 'View holds', tone: 'affirm', disposition: 'settled',
                          note: `${ins.symbol}: the recorded view already accounts for this. Reaffirmed from the feed.` },
                        { key: 'view_needs_update', label: 'Needs update', tone: 'neutral', disposition: 'flagged',
                          note: `${ins.symbol}: the written view needs updating for this. Flagged from the feed.`,
                          nextAction: { id: 'update_thesis', label: 'Update thesis' } },
                        { key: 'no_longer_covered', label: 'No longer covered', tone: 'negate', disposition: 'settled',
                          note: `${ins.symbol}: no longer actively covered. Recording that rather than leaving it ambiguous.` },
                      ]}
                  onRespond={o => applyVerdict(insightBuilt.card, `Does ${ins.symbol} need work?`, o)}
                />
                      ),
                    },
                  ] : []),
])
          }

          if (entry.kind === 'signal') {
            const sigAsset = (entry.signal.relatedAssets?.[0] as any) ?? null
            const sigPrice = pricePane(sigAsset?.symbol)
            const sigBuilt = buildIdeasSignalCard(entry.signal as any)
            return renderCard(
              sigBuilt,
              'signal',
              sigAsset?.id ?? null,
              // Team focus, a coverage gap and a thesis conflict are all
              // observations about the desk, and the reader is on the desk. A
              // card about what everyone is looking at with no way to say "that
              // is not the interesting part" is a broadcast, not a feed.
              [
                ...(sigPrice ? [sigPrice] : []),
                ...(sigAsset ? [{ id: 'verdict', label: 'Respond', content: (

                    <VerdictBar
                      /**
                       * DELIBERATELY LEFT ON ITS EXISTING BEHAVIOUR.
                       *
                       * This card fires on "the desk has been quiet on this
                       * name" and similar attention clustering. That is not
                       * enough context to support an investment judgment: there
                       * is no price event, no target, no catalyst and no
                       * position change behind it, so any option set naming a
                       * thesis would be asking the reader to rule on something
                       * the signal never established.
                       *
                       * Its current options are a mix of investment view and
                       * feed feedback, which is exactly what the rest of this
                       * phase separated. Fixing it properly needs the SIGNAL to
                       * carry a reason to revisit — a move, a catalyst, a size
                       * change — not a better set of buttons. Left intact, keys
                       * normalised, and the feed-quality option marked so it
                       * can move to the overflow with the others.
                       */
                      question="Is the desk looking at the right thing?"
                      options={[
                        { key: 'agree', label: 'Agree', tone: 'affirm', disposition: 'settled',
                          note: `${sigAsset.symbol}: agreed, this is where the attention belongs right now.` },
                        // Key says what it means; the label already worked.
                        { key: 'discussion_warranted', label: 'Worth a talk', tone: 'neutral', disposition: 'flagged',
                          note: `${sigAsset.symbol}: worth a conversation before the desk commits more time here.` },
                        /**
                         * Stays in the judgment layer, reworded.
                         *
                         * It was labelled "Not useful" and tagged feed_quality, but its
                         * note says "I do not think this is the thing worth the desk's
                         * attention" — a view about where research effort should go, not
                         * a complaint that the card was shown. Moving it to the overflow
                         * would have discarded a process judgment because its label
                         * sounded like feedback. The label now matches the meaning.
                         */
                        { key: 'attention_misplaced', label: 'Not the priority', tone: 'negate', disposition: 'flagged',
                          note: `${sigAsset.symbol}: I do not think this is the thing worth the desk's attention.` },
                      ]}
                      onRespond={o => { if (sigBuilt.ok) applyVerdict(sigBuilt.card, "Is the desk looking at the right thing?", o) }}
                    />
                ) }] : []),
              ],
            )
          }

          if (entry.kind === 'template') {
            const c = entry.card

            // active_risk has its own builder — benchmark provenance and a peer
            // pane the flat template shape cannot carry.
            if (c.kind === 'active_risk' && c.assetId) {
              const built = activeRiskByAsset.get(c.assetId)
              if (built) {
                const { card, input } = built
                return (
                  <div key={c.id} className="h-full w-full" ref={track({ assetId: c.assetId ?? null, kind: 'template' })}>
                    <SignalCardSection
                      card={card}
                      // The peer ranking, which the builder has always declared
                      // as `evidence: peer_bar` and the feed has never passed a
                      // node for — so `hasEvidence` was false and the band
                      // collapsed. One active weight in isolation says nothing
                      // about whether it is the book's biggest bet or its fifth.
                      /**
                       * One carousel: the peer ranking, the tape, the sizing
                       * control and the response.
                       *
                       * Active risk carried the most content of any card and
                       * split it across two regions, the lower of which is the
                       * one that collapses under pressure.
                       */
                      panes={[...(() => {
                        const panes = []
                        if (activeRiskPeers.length > 0) {
                          panes.push({
                            id: 'weight',
                            label: 'Active weight',
                            content: (
                              <ActiveWeightPeers
                                subject={input.symbol}
                                peers={activeRiskPeers}
                                heldCount={activeRiskPeers.length}
                                notHeldCount={activeRisk.notHeldCount}
                                notHeldActivePct={activeRisk.notHeldActivePct}
                              />
                            ),
                          })
                        }
                        /**
                         * Through `pricePane`, which fetches this card's own
                         * symbol.
                         *
                         * The comment here used to say the cache covered eight
                         * symbols, which had been wrong for months —
                         * `price_history_cache` holds 135 symbols and ~34k
                         * rows. The real bound was `usePriceHistory`'s
                         * MAX_SYMBOLS: the first 24 names in FEED ORDER, so a
                         * card lacked a chart because it sat deep in the feed,
                         * not because the data was missing.
                         *
                         * That budget is gone — a per-symbol read is 260 rows
                         * and needs no paging — and with it the reason this
                         * branch had its own copy of the availability rule.
                         * `pricePane` also resolves the traded ticker, which a
                         * renamed instrument needs and which this had to do by
                         * hand.
                         */
                        const p = pricePane(input.symbol)
                        if (p) panes.push(p)
                        return panes
                      })(),
                      // The question this card provokes is "what if it were
                      // smaller", and until now the only way to answer it was
                      // to leave the feed and do the arithmetic elsewhere.
                      //
                      // The hold RECORDS the proposed size as a thought against
                      // the name — it does not change the position and the
                      // label does not claim it does. Sizing is a PM decision
                      // taken in Trade Lab; what a feed can honestly do is
                      // capture the number you arrived at, with its provenance
                      // attached, so the desk finds it instead of losing it.
                      // Two panes, like every other card that carries a
                      // control: the sizing question the card provokes, and the
                      // disposition that decides whether it comes back. This
                      // kind was the last one where a reader could explore an
                      // answer but not record having reached one.
                      ...[
                            {
                              id: 'size',
                              label: 'Size',
                              content: (
                                <WhatIfSize
                                  symbol={input.symbol}
                                  currentPct={input.weightPct}
                                  benchmarkPct={input.benchmarkWeightPct}
                                  benchmarkNote={
                                    input.benchmarkSource
                                      ? `${input.benchmarkSource.proxy}${input.benchmarkSource.isProxy ? ' proxy' : ''}`
                                      : undefined
                                  }
                                  onStage={proposedPct => setCaptureCtx({
                                    assetId: input.assetId,
                                    symbol: input.symbol,
                                    name: input.companyName ?? input.symbol,
                                    kind: 'thought',
                                    note: whatIfNote(input, proposedPct),
                                  })}
                                />
                              ),
                            },
                            verdictPane(
                              card,
                              `Is the ${input.symbol} bet the right size?`,
                              [
                                { key: 'sized_right', label: 'Sized right', tone: 'affirm', disposition: 'settled',
                                  note: `${input.symbol}: the active weight is deliberate and I am comfortable with it.` },
                                { key: 'trim', label: 'Trim it', tone: 'neutral', disposition: 'flagged',
                                  note: `${input.symbol}: the active weight is larger than the view supports.` },
                                { key: 'add', label: 'Add to it', tone: 'neutral', disposition: 'flagged',
                                  note: `${input.symbol}: the view supports more than the current active weight.` },
                                { key: 'needs_review', label: 'Review', tone: 'neutral', disposition: 'flagged',
                                  note: `${input.symbol}: the active weight needs a proper review. Flagged from the feed.` },
                              ],
                            ),
                          ],
                      ]}
                      onOpenAsset={openAsset}
                      onOpenPortfolio={openPortfolio}
                      onFeedAction={handleFeedAction}
                      onFeedback={applyFeedback}
                      onCapture={setCaptureCtx}
                      onWhy={() => {}}
                      onSnooze={() => {}}
                      onDismiss={() => {}}
                      onPrimary={() => {}}
                    />
                  </div>
                )
              }
            }

            /**
             * The market templates get the tape, which is what they are about.
             *
             * An unusual move, an earnings reaction and a corporate action are
             * all statements about a price path, and every one of them rendered
             * as a headline over an empty band. A macro release has no ticker
             * and correctly gets nothing: `pricePane` returns null and the
             * carousel is skipped rather than showing an empty pane.
             */
            const tplPrice = pricePane(c.symbol)
            const tplBuilt = buildTemplateCard(c)
            return renderCard(tplBuilt,
'template',
c.assetId ?? null,
[
...(tplPrice ? [tplPrice] : []),
...(c.symbol ? [{ id: 'verdict', label: 'Respond', content: (
<VerdictBar
                      question={`Does this change anything for ${c.symbol}?`}
                      options={[
                        { key: 'priced_in', label: 'Priced in', tone: 'affirm', disposition: 'settled',
                          note: `${c.symbol}: the move is noise against the thesis. No action.` },
                        { key: 'thesis_relevant', label: 'Hits the thesis', tone: 'neutral', disposition: 'flagged',
                          note: `${c.symbol}: this affects the thesis and needs following up. Flagged from the feed.` },
                        // `not_relevant` moved to the overflow menu, for the same reason
                        // as news: it was about surfacing, not about the position.
                      ]}
                      onRespond={o => { if (tplBuilt.ok) applyVerdict(tplBuilt.card, `Does this change anything for ${c.symbol}?`, o) }}
                    />
) }] : []),
])
          }

          if (entry.kind === 'news') {
            const n = entry.news
            /**
             * The story's subject, decided by the SOURCE — never by a search
             * over our own holdings. See `news-chart` for why the previous
             * `symbols.map(...).find(Boolean)` produced MSFT charts on stories
             * that had nothing to do with Microsoft.
             */
            const newsChart = newsChartSymbol({ primarySymbol: n.primarySymbol, symbols: n.symbols })
            /**
             * `linked` is now ONLY the asset record behind a symbol the source
             * actually named, and is used for naming and navigation. It is no
             * longer allowed to pick a chart: an arbitrary tagged name that we
             * happen to own is not what a story is about.
             */
            const linked = newsChart.symbol
              ? (assetBySymbol.get(newsChart.symbol) ?? null)
              : null

            {
              // No quote is passed. The feed's quote map has no per-symbol
              // timestamp to check freshness against, and the builder must not
              // be handed a number it cannot date — that is the exact shape of
              // the placeholder bug. A news card with no move is correct; a
              // news card with an undateable move is not.
              const built = buildNewsCard({
                id: n.id, headline: n.headline, summary: n.summary ?? null,
                url: n.url, source: n.source, publishedAt: n.publishedAt,
                primarySymbol: n.primarySymbol ?? null, symbols: n.symbols,
                sentiment: n.sentiment ?? null,
                asset: linked ? { id: linked.id, symbol: linked.symbol, companyName: (linked as any).company_name ?? null } : null,
                heldIn: [], maxWeightPct: null, quote: null,
              })
              // Suppressed cards render nothing at all. The suppression is
              // already logged with its reason by gate().
              if (!built.ok) return null
              // A story about a name the book holds, with no way to see what the
              // name did and no way to say what you make of it, is a headline
              // the reader could have got anywhere.
              // Only the source-declared subject. A multi-name story and a
              // macro story both get no chart, which is the correct news card.
              const newsPrice = pricePane(newsChart.symbol)
              return (
                <div key={n.id} className="h-full w-full" ref={track({ assetId: linked?.id ?? null, kind: 'news' })}>
                  <SignalCardSection
                    card={built.card}
                    /**
                     * One carousel: the tape and the response page together.
                     *
                     * Reported from a phone as "news tiles are not showing
                     * interactive objects" — the chart was there but it was the
                     * whole of the evidence band while the judgment sat in a
                     * separate region below the question, which is the region
                     * that collapses when a card runs out of room.
                     */
                    panes={[
                      ...(newsPrice ? [newsPrice] : []),
                      ...(linked ? [{
                        id: 'verdict',
                        label: 'Respond',
                        content: (
                            <VerdictBar
                              question={`What does this mean for ${linked.symbol}?`}
                              options={[
                                { key: 'priced_in', label: 'Already priced', tone: 'affirm', disposition: 'settled',
                                  note: `${linked.symbol}: this story is already in the price and does not move the thesis.` },
                                { key: 'thesis_relevant', label: 'Hits the thesis', tone: 'neutral', disposition: 'flagged',
                                  note: `${linked.symbol}: this bears directly on the thesis and needs a proper look.` },
                                // `not_relevant` moved to the overflow menu. Its note read
                                // "news on this name is not worth SURFACING to me", which is a
                                // complaint about the feed rather than a view about the
                                // position — and the investment reading of it, "this does not
                                // move the thesis", is already what `priced_in` says.
                              ]}
                              onRespond={o => applyVerdict(built.card, `What does this mean for ${linked.symbol}?`, o)}
                            />
                        ),
                      }] : []),
                    ]}
                    onOpenAsset={openAsset}
                    onOpenPortfolio={openPortfolio}
                    onFeedAction={handleFeedAction}
                    onFeedback={applyFeedback}
                    onCapture={setCaptureCtx}
                    onWhy={() => {}}
                    onSnooze={() => {}}
                    onDismiss={() => {}}
                    onPrimary={() => {}}
                  />
                </div>
              )
            }
          }

          const item = entry.idea
          const source = readthroughSourceType(item.type)
          const itemAssetId = ('asset' in item && item.asset ? item.asset.id : null) as string | null
          const itemAuthorId = item.author?.id ?? null
          const note = (signal: 'reaction' | 'share' | 'open' | 'readthrough') =>
            userId && recordInterest({ userId, signal, assetId: itemAssetId, authorId: itemAuthorId, kind: 'idea' })

          /**
           * Posts render as cards too, as of 2026-08-19.
           *
           * They were the last kinds outside the contract — a colleague's trade
           * idea sat next to an active-risk card wearing entirely different
           * furniture, in the same scroller. That is the "two products"
           * complaint the whole migration existed to end, surviving in the one
           * place nobody counted because posts were never among "the seven
           * kinds".
           *
           * Everything the old vertical action rail offered survives, in the
           * card's menu: ask, share, promote, readthrough. A migration that
           * looks tidier while quietly dropping functionality is the worst
           * kind, so the builder only offers what this call site can honour.
           */
          const itemAsset = ('asset' in item && item.asset ? item.asset : null) as any
          const built = buildIdeaCard(
            {
              id: item.id,
              type: item.type as any,
              content: (item as any).content ?? null,
              title: (item as any).title ?? null,
              createdAt: item.created_at,
              authorName: item.author?.full_name
                || [item.author?.first_name, item.author?.last_name].filter(Boolean).join(' ')
                || item.author?.email?.split('@')[0]
                || null,
              asset: itemAsset
                ? { id: itemAsset.id, symbol: itemAsset.symbol, companyName: itemAsset.company_name ?? null }
                : null,
              action: (item as any).action ?? null,
              urgency: (item as any).urgency ?? null,
              rationale: (item as any).rationale ?? null,
              portfolioName: (item as any).portfolio?.name ?? null,
              longLegs: (item as any).long_legs ?? undefined,
              shortLegs: (item as any).short_legs ?? undefined,
              sentiment: (item as any).sentiment ?? null,
            },
            {
              share: true,
              ask: true,
              // Only a quick thought can become a trade idea.
              promote: item.type === 'quick_thought',
              readthrough: !!source,
            },
          )
          if (!built.ok) return null

          const ideaPrice = pricePane(itemAsset?.symbol)

          /**
           * A colleague's post is the most obviously answerable thing in the
           * feed, and it was the least answerable card in it.
           *
           * The post kinds carry "Ask" and "Share" in the menu, both of which
           * start a conversation somewhere else. Agreeing or disagreeing on the
           * spot is the response people actually have, and losing it is how a
           * desk ends up with six analysts who each assumed everyone else
           * agreed.
           */
          const ideaVerdict = itemAsset?.symbol
            ? (
                <VerdictBar
                  question={`Where do you land on ${itemAsset.symbol}?`}
                  options={[
                    { key: 'agree', label: 'Agree', tone: 'affirm', disposition: 'settled',
                      note: `${itemAsset.symbol}: I agree with this read.` },
                    { key: 'questions', label: 'Questions', tone: 'neutral', disposition: 'flagged',
                      note: `${itemAsset.symbol}: I have questions about this before I would back it.` },
                    { key: 'disagree', label: 'Not convinced', tone: 'negate', disposition: 'flagged',
                      note: `${itemAsset.symbol}: I do not agree with this read and would want to argue the other side.` },
                  ]}
                  onRespond={o => applyVerdict(built.card, `Where do you land on ${itemAsset.symbol}?`, o)}
                />
              )
            : null

          // The post itself, in full. The body clamps to two lines, so on a
          // research note or a thesis update the card was showing an opening
          // clause and hiding the argument, on a surface whose whole point is
          // not having to navigate to read it.
          const ideaDetailPanes = [
            ...(built.card.body.length > 140
              ? [{
                  id: 'post',
                  label: 'Post',
                  content: (
                    <p className="whitespace-pre-line text-[15px] leading-[1.55] text-gray-600 dark:text-gray-300">
                      {built.card.body}
                    </p>
                  ),
                }]
              : []),
            ...(ideaVerdict ? [{ id: 'verdict', label: 'Respond', content: ideaVerdict }] : []),
          ]

          return (
            <div
              key={item.id}
              className="h-full w-full"
              ref={track({ assetId: itemAssetId, authorId: itemAuthorId, kind: 'idea' })}
            >
              <SignalCardSection
                card={built.card}
                /**
                 * One carousel: the tape, the post and the response.
                 *
                 * The tape only when there is a series — a sparkline under
                 * somebody's musing is decoration, which the builder already
                 * refuses to declare. Reported from a phone as "pair trade
                 * tiles are not showing interactive objects": the panes existed
                 * but sat in the lower region, which is the one that collapses.
                 */
                panes={[
                  ...(ideaPrice ? [ideaPrice] : []),
                  ...ideaDetailPanes,
                ]}
                onOpenAsset={(id, sym) => { note('open'); openAsset(id, sym) }}
                onCapture={setCaptureCtx}
                onWhy={() => {}}
                onSnooze={() => {}}
                onDismiss={() => {}}
                onPrimary={(_card, actionId) => {
                  // Routed by action id so the rail's verbs survive the move.
                  switch (actionId) {
                    case 'share': note('share'); setShareItem(item); break
                    case 'ask': setAskItem(item); break
                    case 'promote': setPromoteItem(item); break
                    case 'readthrough': note('readthrough'); setReadthroughFor(item); break
                    default: note('open')
                  }
                }}
              />
            </div>
          )
  }

  return (
    // Column, not a positioning context with an overlay in it. The filter bar
    // below used to be `absolute top-0`, which kept it from scrolling away but
    // also took it out of layout — so it sat on top of the first tile's header
    // band, hiding the kind badge and attribution behind it. A flex column
    // gives it its own height and leaves the rest to the scroller, which is
    // what "above the scroller" was trying to express in the first place.
    <div className="relative h-full overflow-hidden flex flex-col">
      <PullToRefreshIndicator ref={indicatorRef as any} isRefreshing={isRefreshing} armed={armed} />

      {/* Active filter. Occupies its own row so it cannot scroll away and
          cannot cover the feed — a filter you cannot see is a feed that looks
          broken, and one that hides the tile beneath it is worse. */}
      {/* Always-present entry point. The chip filter below only appears once
          something is filtered, which is correct for a state indicator and
          wrong for a control — there was no way to *start* curating. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 pb-1.5 pt-1.5 [padding-top:calc(0.375rem+env(safe-area-inset-top))] border-b border-gray-200 dark:border-gray-800">
        {/* The mode switch, in the open and one tap from anywhere.
            Not behind the overflow menu: it is one of two peer answers to
            "what am I doing here", and a browsing mode nobody can find is a
            browsing mode nobody uses. 32px tall so it costs one row rather
            than a band, and the safe-area inset above it is unchanged. */}
        <div data-feed-mode={mode} className="flex shrink-0 rounded-full bg-gray-100 p-0.5 dark:bg-gray-800">
          {(['curate', 'explore'] as const).map(m => (
            <button
              key={m}
              type="button"
              data-mode-option={m}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m)
                logPilotEvent({ eventType: 'feed_mode', organizationId: currentOrgId ?? null, metadata: { mode: m } })
              }}
              className={clsx(
                'h-7 rounded-full px-3 text-[12px] font-bold no-touch-target',
                mode === m
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400',
              )}
            >
              {/* "Ideas", not "Curate". Curate is what the FILTER does — it
                  narrows the feed — and using the same word for the browsing
                  mode made two different controls claim one verb. The internal
                  key stays `curate` so telemetry and the filter sheet keep
                  their vocabulary. */}
              {m === 'curate' ? 'Ideas' : 'Explore'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFilterSheetOpen(true)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-gray-100 dark:bg-gray-800 text-[12px] font-bold text-gray-700 dark:text-gray-200 no-touch-target"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Curate
          {filterCount(feedFilter) > 0 && (
            <span className="px-1.5 rounded-full bg-primary-600 text-white text-[10px]">
              {filterCount(feedFilter)}
            </span>
          )}
        </button>
        {filterCount(feedFilter) > 0 && (
          <button
            type="button"
            onClick={() => setFeedFilter(EMPTY_FILTER)}
            className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 underline underline-offset-2 no-touch-target"
          >
            Reset
          </button>
        )}
      </div>

      {kindFilter && (
        // pt-safe alone collapses to zero on a phone with no notch, which is
        // why the band read as cramped against the top edge. A real 10px floor
        // plus the inset, and more room below it, gives the row a band rather
        // than a stripe.
        <div className="flex-shrink-0 z-40 flex items-center gap-2 px-3 py-2.5 bg-gray-900 text-white dark:bg-gray-800">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em]">
            {CATEGORY_LABEL[kindFilter as FeedCategory] ?? kindFilter} only
          </span>
          <button
            type="button"
            onClick={() => setKindFilter(null)}
            className="ml-auto flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/15 text-[11px] font-semibold active:bg-white/25 no-touch-target"
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
            Clear
          </button>
        </div>
      )}

      {/* The focused Explore tile, over Explore.
          ── Why an overlay and not a route ──────────────────────────────────
          Explore is preview -> rich tile -> asset page, and the middle step
          only works if the mosaic survives it: a reader who opens a tile,
          decides it is not interesting and closes it must land exactly where
          they were. A route change loses the scroll position and the category,
          and puts the browser's back stack between them and the page.
          Not a snap container either. One card does not need a feed, and
          wrapping it in one would put mandatory snapping around a single tile.
      */}
      {mode === 'explore' && exploreFocus && (
        <div className="absolute inset-0 z-40 flex flex-col bg-white dark:bg-gray-900" data-explore-focus>
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 [padding-top:calc(0.5rem+env(safe-area-inset-top))] dark:border-gray-800">
            <button
              type="button"
              data-explore-close
              onClick={() => setExploreFocus(null)}
              className="flex h-9 items-center gap-1 rounded-full px-2 text-[13px] font-semibold text-gray-600 dark:text-gray-300 no-touch-target"
            >
              <ChevronLeft className="h-4 w-4" />
              Explore
            </button>
            {exploreFocus.symbol && (
              // The explicit way out, which is the only way this surface
              // navigates. Tapping a preview no longer does it by itself.
              <button
                type="button"
                data-explore-open-asset
                onClick={() => leaveExploreForAsset(exploreFocus)}
                className="ml-auto flex h-9 items-center rounded-full bg-gray-100 px-3 text-[13px] font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200 no-touch-target"
              >
                Open {exploreFocus.symbol}
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {(() => {
              /**
               * The SAME card Curate would render, found by matching the
               * preview back to the entry it came from.
               *
               * Matched on asset and ranked signal type, because those are what
               * both sides agree on: `rankInputFor` gives every feed entry a
               * type and an id, and an Explore item's `dedupeKey` is built from
               * the same signal type and asset. Rebuilding the card from the
               * preview instead would mean a second copy of every builder.
               *
               * A preview with no matching entry — a post, an aggregate, a
               * template with no ticker — falls back to what the preview itself
               * knows. That is honest: the alternative is inventing a card.
               */
              const match = findExploreMatch(
                exploreFocus,
                unfilteredRef.current as any[],
                e => {
                  const input = rankInputFor(e)
                  return { type: input.type, id: input.id, symbol: symbolOfEntry(e) }
                },
              )
              if (match) return renderEntry(match)
              return (
                <div className="flex h-full flex-col justify-center px-6 text-center">
                  <p className="text-[15px] font-semibold text-gray-900 dark:text-white">
                    {exploreFocus.title}
                  </p>
                  {exploreFocus.context && (
                    <p className="mt-2 text-[13px] text-gray-500">{exploreFocus.context}</p>
                  )}
                  <p className="mt-4 text-[12px] text-gray-400">
                    {/* Said plainly rather than dressed up as a card. */}
                    This one lives on its own surface.
                  </p>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Explore replaces the snap scroller entirely rather than wrapping it.
          The two modes are different layouts with different scroll owners, and
          nesting one inside the other is how gesture architecture leaks — the
          snap container would still be there, still mandatory, still claiming
          one viewport per child. */}
      {mode === 'explore' ? (
        <MobileExplore
          candidates={exploreCandidates}
          series={exploreSeries}
          category={exploreCategory}
          onCategoryChange={setExploreCategory}
          onOpen={openExploreItem}
          onTelemetry={(eventType, metadata) =>
            // Product telemetry, never `audit_events`. Browsing is not
            // investment judgment, and putting it in the research record would
            // make every future reader filter it out before counting anything.
            logPilotEvent({ eventType, organizationId: currentOrgId ?? null, metadata })}
        />
      ) : (
      <>
      {/* min-h-0 matters: a flex child defaults to min-height:auto, which lets
          it grow to its content instead of scrolling, and the snap sections
          inside are full-height by definition. Without it the scroller has no
          bounded height and every tile spills. */}
      <div
        ref={setScroller}
        // Mandatory snapping stays.
        //
        // It was briefly relaxed to `proximity` on the theory that mandatory
        // snapping was what made the feed read as a stack of full-screen
        // alerts. It was not: the full-screen CARDS were, and once a compact
        // card is 380px the next one is already visible below it while the
        // current one sits snapped to the top. Proximity bought nothing and
        // cost the "one swipe advances exactly one tile" guarantee, which two
        // gesture tests and every reader's muscle memory depend on.
        className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory overscroll-contain"
      >
        {/* Scenario cards are ranked with everything else — see renderScenarioCard. */}

        {/* Windowed. Every tile is exactly one scroller height, so a collapsed
            slot occupies the same box and no scroll offset moves — see
            FeedSlot for why that exactness matters on a snap scroller. */}
        {feedEntries.map((entry, i) => (
          <FeedSlot
            key={feedKeys[i]}
            root={scroller}
            // The first two screens are present in the first paint; the rest
            // arrive as the observer reaches them.
            initiallyNear={i < 2}
            render={() => renderEntry(entry)}
          />
        ))}

        <div ref={sentinelRef} className="h-px" />
      </div>
      </>
      )}

      {/* The expanded chart. One shell for every card kind — see
          FullscreenChart for why the overlays are parameters rather than
          variants. Closing restores the card and the feed untouched, because
          nothing about the feed changed while it was open. */}
      <FullscreenChart
        open={fsChart !== null}
        onClose={() => setFsChart(null)}
        symbol={fsChart?.symbol ?? ''}
        companyName={fsChart?.companyName}
        series={fsChart?.series ?? []}
        bands={fsChart?.bands}
        markers={fsChart?.markers}
      />

      {/* The target and case editor, over the card.
          The real one — `MobileCaseTargets` writes through
          `useAnalystPriceTargets`, so a save here is a save. `viewFilter` is
          the reader's own id because editing requires it; the aggregated view
          is read-only and would give them a sheet they cannot type in.
          A sheet is one of the two places a vertical scroller is legitimate on
          this surface: it is an overlay, not a member of the snap feed. */}
      <BottomSheet
        open={targetSheet !== null}
        onClose={() => setTargetSheet(null)}
        title={targetSheet ? `${targetSheet.symbol} price target` : ''}
        snapPoints={[0.7, 0.95]}
        aria-label="Price target editor"
      >
        {targetSheet && (
          <div data-slot="target-sheet" className="px-3 pb-6">
            <MobileCaseTargets
              assetId={targetSheet.assetId}
              currentPrice={targetSheet.price}
              viewFilter={userId ?? 'aggregated'}
            />
          </div>
        )}
      </BottomSheet>

      <FeedCaptureSheet
        open={captureCtx !== null}
        onClose={() => setCaptureCtx(null)}
        assetId={captureCtx?.assetId}
        assetSymbol={captureCtx?.symbol}
        assetName={captureCtx?.name}
        initialKind={captureCtx?.kind ?? null}
        initialNote={captureCtx?.note ?? null}
      />

      {shareItem && (
        <ShareToUserModal isOpen onClose={() => setShareItem(null)} item={shareItem} />
      )}

      {promoteItem && (
        <PromoteToTradeIdeaModal
          isOpen
          onClose={() => setPromoteItem(null)}
          quickThoughtId={promoteItem.id}
          quickThoughtContent={promoteItem.content ?? ''}
          assetId={('asset' in promoteItem && promoteItem.asset ? promoteItem.asset.id : null) as any}
          assetSymbol={('asset' in promoteItem && promoteItem.asset ? promoteItem.asset.symbol : null) as any}
          assetName={('asset' in promoteItem && promoteItem.asset ? promoteItem.asset.company_name : null) as any}
        />
      )}

      {askItem && (
        <PromptModal
          isOpen
          onClose={() => setAskItem(null)}
          context={{
            type: 'asset' in askItem && askItem.asset ? 'asset' : undefined,
            id: 'asset' in askItem && askItem.asset ? askItem.asset.id : undefined,
            title: 'asset' in askItem && askItem.asset ? askItem.asset.symbol : undefined,
          }}
        />
      )}

      <FeedFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        value={feedFilter}
        onChange={setFeedFilter}
        kindLabels={CATEGORY_LABEL}
      />

      {readthroughFor && (
        <ReadthroughSheet
          open
          onClose={() => setReadthroughFor(null)}
          sourceType={readthroughSourceType(readthroughFor.type)!}
          sourceId={readthroughFor.id}
          excludeAssetId={
            'asset' in readthroughFor && readthroughFor.asset ? readthroughFor.asset.id : null
          }
        />
      )}
    </div>
  )
}

function stripMarkup(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The seed text for a size recorded off the active-risk card.
 *
 * It states every number the proposal depends on, including the snapshot date
 * the weights came from. A note saying only "take NVDA to 6.5%" is unreadable
 * a week later: 6.5% against what book, on which day, and versus what
 * benchmark. The whole reason the card carries `asOf` is that a book number
 * without its date is a claim nobody can check, and a note derived from one
 * inherits the same obligation.
 *
 * The benchmark clause is omitted rather than faked when there is no benchmark
 * weight — writing "benchmark 0.00%" would assert the index excludes the name,
 * which is the `insufficient_coverage` confusion the builder exists to avoid.
 */
function whatIfNote(input: ActiveRiskInput, proposedPct: number): string {
  const day = new Date(input.asOf)
  const asOf = Number.isNaN(day.getTime())
    ? 'an undated snapshot'
    : day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

  const bench = input.benchmarkWeightPct
  const benchClause = bench == null
    ? ''
    : ` Benchmark ${bench.toFixed(2)}%, so active weight would go from ${
        (input.weightPct - bench >= 0 ? '+' : '')}${(input.weightPct - bench).toFixed(2)}% to ${
        (proposedPct - bench >= 0 ? '+' : '')}${(proposedPct - bench).toFixed(2)}%.`

  return `${input.symbol} at ${proposedPct.toFixed(2)}% instead of ${input.weightPct.toFixed(2)}% in ${
    input.portfolioName}.${benchClause} Weights from the holdings snapshot of ${asOf}. Recorded from the feed; the position is unchanged.`
}

/**
 * Feed item types map onto `object_links.source_type`. Only the types with an
 * unambiguous counterpart are offered — `note` covers four distinct note
 * tables, and guessing the wrong one would write a link that resolves to
 * nothing, so readthrough is withheld there rather than recorded incorrectly.
 */
function readthroughSourceType(type: ItemType): ReadthroughSourceType | null {
  switch (type) {
    case 'quick_thought':
      return 'quick_thought'
    case 'trade_idea':
      return 'trade_idea'
    case 'thesis_update':
      return 'trade_idea_thesis'
    default:
      return null
  }
}
