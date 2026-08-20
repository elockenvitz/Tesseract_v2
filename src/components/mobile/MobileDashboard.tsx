import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lightbulb, SlidersHorizontal, X } from 'lucide-react'
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
import { EMPTY_FILTER, filterCount, useFeedFacets, type FeedFilter } from '../../hooks/mobile/useFeedFacets'
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
import { CardCarousel } from '../signals/CardCarousel'
import { ScenarioDistribution } from '../signals/ScenarioDistribution'
import { PriceContext, type PriceBand, type PriceMarker } from '../signals/PriceContext'
import { TargetTuner } from '../signals/TargetTuner'
import { VerdictBar, type VerdictOption } from '../signals/VerdictBar'
import {
  DISPOSITION_DAYS, isDisposedOf, loadDispositions, recordDisposition,
  type DispositionMap,
} from '../../lib/signals/dispositions'
import { recordSignalJudgment } from '../../lib/signals/judgment-log'
import { recordFeedFeedback } from '../../lib/signals/feed-feedback-log'
import type { FeedFeedbackOption } from '../../lib/signals/feed-feedback'
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

/** Human names for the feed's internal kind keys, used by the filter banner. */
const KIND_LABELS: Record<string, string> = {
  attention: 'decisions',
  idea: 'ideas',
  signal: 'signals',
  insight: 'insights',
  news: 'news',
  template: 'market events',
  lens: 'portfolio lenses',
}

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
  const { data: lenses } = usePortfolioLenses()
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
  const { data: recommendationResults = [] } = useRecommendationCards()

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
  const { data: scenarioResults = [] } = useScenarioCards()


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

  // Interleave so consecutive screens are not all one kind. Scores are
  // position-derived rather than raw: each source ranks on its own scale, and
  // using position preserves the ordering each source already decided
  // (including the seen-rotation applied to ideas) while making the two
  // comparable. `leadWith` keeps the single most pressing decision first.
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
      card: c,
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

    const all = [...attentionEntries, ...ideaEntries, ...signalEntries, ...insightEntries, ...newsEntries, ...templateEntries, ...lensEntries]

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
    const symbolOf = (e: any): string | null => {
      switch (e.kind) {
        case 'news':      return e.news?.primarySymbol ?? null
        case 'template':  return e.card?.symbol ?? null
        case 'insight':   return e.insight?.symbol ?? null
        case 'lens':
          return e.lens?.gap?.symbol ?? e.lens?.name?.symbol
              ?? e.lens?.breach?.symbol ?? e.lens?.target?.symbol
              ?? e.lens?.position?.symbol ?? null
        case 'idea':      return (e.item as any)?.asset?.symbol ?? null
        case 'attention': return null
        default:          return null
      }
    }

    const assetFacetsActive =
      feedFilter.sectors.length > 0 || feedFilter.countries.length > 0 ||
      feedFilter.exchanges.length > 0 || feedFilter.symbols.length > 0

    const matchesFilter = (e: any): boolean => {
      if (feedFilter.kinds.length && !feedFilter.kinds.includes(e.kind)) return false
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
    const filtered = kindFilter ? curated.filter(e => e.kind === kindFilter) : curated

    // Tag each entry with what it is *about* so the interleaver can keep one
    // name off three consecutive screens. symbolOf already knows where each
    // kind hides its subject.
    const pool = filtered.map(e => ({ ...e, subject: symbolOf(e) }))

    return interleaveByKind<any>(pool, {
      maxRun: 1,
      leadWith: kindFilter ? undefined : 'attention',
      seed: shuffleSeed,
    })
  }, [dedupedAttention, visibleItems, realSignals, derivedInsights, newsItems, templateCards, cycle, interestAtMount, shuffleSeed, kindFilter, lenses, feedFilter, facets])

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

  const pricedSymbols = useMemo(() => {
    const out: string[] = []
    const push = (s: unknown) => {
      if (typeof s !== 'string' || !s.trim()) return
      out.push(tradedSymbolOf(s))
    }

    // Scenario cards render above the interleaved feed, so they are first in
    // line for a slot.
    for (const c of scenarioCards as any[]) push(c?.entity?.ticker)

    for (const e of feedEntries as any[]) {
      switch (e.kind) {
        case 'lens':
          push(e.lens?.gap?.symbol ?? e.lens?.name?.symbol
            ?? e.lens?.breach?.symbol ?? e.lens?.target?.symbol
            ?? e.lens?.position?.symbol)
          break
        case 'insight':  push(e.insight?.symbol); break
        case 'template': push(e.card?.symbol); break
        case 'idea':     push(e.idea?.asset?.symbol); break
        case 'signal':   push(e.signal?.relatedAssets?.[0]?.symbol); break
        case 'news':     push(e.news?.primarySymbol); break
        case 'attention': break
        default: break
      }
    }

    return Array.from(new Set(out))
  }, [feedEntries, scenarioCards, tradedSymbolOf])

  const { data: priceHistory } = usePriceHistory(pricedSymbols, { enabled: pricedSymbols.length > 0 })

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
      if (!symbol) return null
      // Resolved the same way the fetch resolved it. See `tradedSymbolOf`.
      const series = priceHistory?.get(tradedSymbolOf(String(symbol)))
      if (!series?.length) return null
      return {
        id: 'price',
        label: 'Price',
        content: (
          <PriceContext
            symbol={symbol}
            series={series}
            bands={opts?.bands ?? []}
            markers={opts?.markers ?? []}
          />
        ),
      }
    },
    [priceHistory, tradedSymbolOf],
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
    /** Charts for the evidence band. Optional: most kinds have nothing to
     *  chart, and the band collapses rather than leaving a gap. */
    evidence?: React.ReactNode,
    /** Revealed in place by the disclosure control. */
    detail?: React.ReactNode,
    detailLabel?: string,
    /** False when the detail is a single control rather than content worth
     *  hiding behind a toggle. See `SignalCardView`. */
    detailCollapsible?: boolean,
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
          evidence={evidence}
          detail={detail}
          detailLabel={detailLabel}
          detailCollapsible={detailCollapsible}
          onOpenAsset={openAsset}
          onOpenPortfolio={openPortfolio}
          onFeedAction={t => onNavigate?.(t)}
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
          onFilterKind={() => setKindFilter(trackAs)}
        />
      </div>
    )
  }

  // Every source gates the first paint. The feed's order is composed from all
  // of them, so rendering before they have arrived shows one tile and then
  // swaps it for another as each source lands.
  const composing =
    isLoading || attentionLoading || signalsLoading || insightsLoading ||
    (attentionSourceIds.length > 0 && pairInfoLoading)

  if (composing) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-primary-500 animate-spin dark:border-gray-700" />
          <p className="text-xs">Loading your feed…</p>
        </div>
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
            {KIND_LABELS[kindFilter] ?? kindFilter} only
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
        {scenarioCards.map((card: any) => (
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
            evidence={
              <CardCarousel
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
                  // The tape behind the ladder, when it exists. Three of the
                  // ten laddered symbols have cached closes (AAPL, GOOGL,
                  // TSLA) — the pane is added per card rather than always,
                  // because a permanent "no price history" pane on seven of
                  // ten cards is furniture.
                  ...(priceHistory?.get(String(card.entity.ticker ?? '').toUpperCase())?.length
                    ? [{
                        id: 'price',
                        label: 'Price',
                        content: (
                          <PriceContext
                            symbol={card.entity.ticker!}
                            series={priceHistory.get(String(card.entity.ticker).toUpperCase())!}
                            // The analyst's own cases on the same axis as the
                            // tape. This is the comparison the card claims and
                            // the one the ladder makes against a single price.
                            bands={(card.evidence.data.cases as any[])
                              .filter(c => Number.isFinite(c.price))
                              .map(c => ({ label: c.name, price: c.price, kind: 'case' as const }))}
                          />
                        ),
                      }]
                    : []),
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
                ]}
              />
            }
            // Two things behind one disclosure: the reasoning you have to
            // read, and the weights you might want to change. Paging them
            // sideways keeps both without the card growing — the reasoning is
            // prose and needs the height, the editor needs the taps.
            detail={
              <CardCarousel
                panes={[
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
              />
            }
            detailLabel={`Respond, or see all ${card.evidence.data.cases.length} cases`}
            onOpenAsset={openAsset}
            onOpenPortfolio={openPortfolio}
            onFeedAction={t => onNavigate?.(t)}
            onFeedback={applyFeedback}
            onCapture={setCaptureCtx}
            onWhy={() => {}}
            onSnooze={() => {}}
            onDismiss={() => {}}
            onPrimary={() => {}}
          />
        ))}

        {feedEntries.map(entry => {
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
                    evidence={
                      asRecommendation.input.proposedWeightPct != null &&
                      asRecommendation.input.currentWeightPct != null
                        ? (
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
                          )
                        : undefined
                    }
                    // The argument for the trade, in full. The body clamps to
                    // two lines, so the one thing a decision actually turns on
                    // was the thing the card would not show.
                    detail={
                      asRecommendation.input.rationale
                        ? (
                            <div className="text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">
                              {asRecommendation.input.recommendedBy && (
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                                  {asRecommendation.input.recommendedBy}’s case
                                </p>
                              )}
                              <p>{asRecommendation.input.rationale}</p>
                            </div>
                          )
                        : undefined
                    }
                    detailLabel="Read the full rationale"
                    onOpenAsset={openAsset}
                    onOpenPortfolio={openPortfolio}
                    onFeedAction={t => onNavigate?.(t)}
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

            return renderCard(
              attnBuilt,
              'attention',
              a.context?.asset_id ?? null,
              attnPrice ? <CardCarousel panes={[attnPrice]} /> : undefined,
              attnBuilt.ok ? (
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
              ) : undefined,
              undefined,
              false,
            )
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
                    unitNote="Weight of each book · tap to compare"
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
                  reference={{ price: l.target.price, label: 'book mark' }}
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
                  reference={{ price: l.breach.price, label: 'book mark' }}
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
                  reference={{ price: l.position.price, label: 'book mark' }}
                  isFirstTarget
                  onRecord={t => setCaptureCtx({
                    assetId: l.position.assetId,
                    symbol: l.position.symbol,
                    name: l.position.companyName ?? l.position.symbol,
                    kind: 'thought',
                    note: `${l.position.symbol} first target proposed at $${t.toFixed(2)}, against a book mark of $${
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
                : l.type === 'untargeted' ? 'How is this position being valued?'
                : 'Does the size match the view?',
              l.type === 'untargeted'
                /**
                 * How is this position being valued?
                 *
                 * `not_price_driven` maps to `settled`, NOT `rejected`. A
                 * position held on a framework that does not reduce to a price
                 * target is a legitimate investment process, and the previous
                 * set had no way to say so: the nearest option was "Not
                 * useful", which files a deliberate methodology under feed
                 * spam. That was the clearest case of the system vocabulary
                 * distorting the analyst one.
                 */
                ? [
                    { key: 'price_target', label: 'Price target', tone: 'affirm', disposition: 'flagged',
                      note: `${symbol}: valued on a price target. Recording the number it should carry.`,
                      nextAction: { id: 'set_target', label: 'Set target' } },
                    { key: 'case_framework', label: 'Case framework', tone: 'affirm', disposition: 'flagged',
                      note: `${symbol}: valued on a scenario framework rather than a single target.`,
                      nextAction: { id: 'open_cases', label: 'Build cases' } },
                    { key: 'not_price_driven', label: 'Not price-driven', tone: 'neutral', disposition: 'settled',
                      note: `${symbol}: held on a thesis that does not reduce to a price. Deliberate, not an oversight.` },
                    { key: 'needs_work', label: 'Needs work', tone: 'negate', disposition: 'flagged',
                      note: `${symbol}: the valuation basis needs work. Flagged from the feed.` },
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
              panes.length ? <CardCarousel panes={panes} /> : undefined,
              <CardCarousel panes={detailPanes} />,
              undefined,
              /**
               * No disclosure control.
               *
               * The region holds controls — a target slider, a size slider, a
               * response bar — already labelled by the carousel's own
               * indicators, and open by default because they are the point of
               * the card. A "Hide detail" bar above them offered to hide the
               * only part of the card a reader can act on, and cost 60px of a
               * screen that was pushing the commit button under the action bar.
               * A disclosure earns its place over CONTENT, not over controls.
               */
              false,
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
            return renderCard(
              insightBuilt,
              'insight',
              ins.assetId ?? null,
              insightPrice ? <CardCarousel panes={[insightPrice]} /> : undefined,
              insightBuilt.ok ? (
                <CardCarousel
                  panes={[
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
                    : 'Is the current view still valid?'}
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
                    : [
                        { key: 'still_valid', label: 'Still valid', tone: 'affirm', disposition: 'settled',
                          note: `${ins.symbol}: the recorded view still holds even though nothing new has been written.` },
                        { key: 'needs_update', label: 'Needs update', tone: 'neutral', disposition: 'flagged',
                          note: `${ins.symbol}: the written view needs updating. Flagged from the feed.`,
                          nextAction: { id: 'update_thesis', label: 'Update thesis' } },
                        { key: 'no_longer_covered', label: 'No longer covered', tone: 'negate', disposition: 'settled',
                          note: `${ins.symbol}: no longer actively covered. Recording that rather than leaving it ambiguous.` },
                      ]}
                  onRespond={o => applyVerdict(insightBuilt.card, `Does ${ins.symbol} need work?`, o)}
                />
                      ),
                    },
                  ]}
                />
              ) : undefined,
              undefined,
              // A response bar is the only thing in this region and it is open
              // by default. "Hide detail" would offer to hide the one part of
              // the card a reader can act on.
              false,
            )
          }

          if (entry.kind === 'signal') {
            const sigAsset = (entry.signal.relatedAssets?.[0] as any) ?? null
            const sigPrice = pricePane(sigAsset?.symbol)
            const sigBuilt = buildIdeasSignalCard(entry.signal as any)
            return renderCard(
              sigBuilt,
              'signal',
              sigAsset?.id ?? null,
              sigPrice ? <CardCarousel panes={[sigPrice]} /> : undefined,
              // Team focus, a coverage gap and a thesis conflict are all
              // observations about the desk, and the reader is on the desk. A
              // card about what everyone is looking at with no way to say "that
              // is not the interesting part" is a broadcast, not a feed.
              sigAsset
                ? (
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
                        { key: 'worth_a_talk', label: 'Worth a talk', tone: 'neutral', disposition: 'flagged',
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
                  )
                : undefined,
              undefined,
              false,
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
                      evidence={(() => {
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
                        // Only when there is a series. A pane that renders "no
                        // data" on 7 of 8 names would be furniture — and the
                        // cache covers 8 symbols, so most cards get one pane.
                        // Keyed by the TRADED ticker: price history is stored
                        // under what the provider serves, which for a renamed
                        // instrument is not what the holdings file called it.
                        const traded = (activeRiskRows.find((r: any) => r.assetId === input.assetId)?.tradedSymbol
                          ?? input.symbol) as string
                        const series = priceHistory?.get(traded.toUpperCase())
                        if (series?.length) {
                          panes.push({
                            id: 'price',
                            label: 'Price',
                            content: <PriceContext symbol={input.symbol} series={series} />,
                          })
                        }
                        return panes.length ? <CardCarousel panes={panes} /> : undefined
                      })()}
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
                      detail={
                        <CardCarousel
                          panes={[
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
                          ]}
                        />
                      }
                      detailCollapsible={false}
                      onOpenAsset={openAsset}
                      onOpenPortfolio={openPortfolio}
                      onFeedAction={t => onNavigate?.(t)}
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
            return renderCard(
              tplBuilt, 'template', c.assetId ?? null,
              tplPrice ? <CardCarousel panes={[tplPrice]} /> : undefined,
              c.symbol
                ? (
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
                  )
                : undefined,
              undefined,
              false,
            )
          }

          if (entry.kind === 'news') {
            const n = entry.news
            const linked = n.symbols
              .map((s: string) => assetBySymbol.get(s.toUpperCase()) ?? null)
              .find(Boolean) ?? null

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
              const newsPrice = pricePane(n.primarySymbol ?? linked?.symbol)
              return (
                <div key={n.id} className="h-full w-full" ref={track({ assetId: linked?.id ?? null, kind: 'news' })}>
                  <SignalCardSection
                    card={built.card}
                    evidence={newsPrice ? <CardCarousel panes={[newsPrice]} /> : undefined}
                    detail={
                      linked
                        ? (
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
                          )
                        : undefined
                    }
                    detailCollapsible={false}
                    onOpenAsset={openAsset}
                    onOpenPortfolio={openPortfolio}
                    onFeedAction={t => onNavigate?.(t)}
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
                // The tape behind a trade idea. Only when there is a series: a
                // sparkline under somebody's musing is decoration, which the
                // builder already refuses to declare.
                evidence={ideaPrice ? <CardCarousel panes={[ideaPrice]} /> : undefined}
                detail={ideaDetailPanes.length
                  ? <CardCarousel panes={ideaDetailPanes} />
                  : undefined}
                detailLabel={ideaDetailPanes[0]?.id === 'post' ? 'Read the whole post' : 'Respond to this'}
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
        })}

        <div ref={sentinelRef} className="h-px" />
      </div>

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
        kindLabels={KIND_LABELS}
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
