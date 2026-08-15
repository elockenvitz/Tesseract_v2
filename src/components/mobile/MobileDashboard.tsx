import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lightbulb, SlidersHorizontal, X } from 'lucide-react'
import { ReelsFeedItem } from '../feed/ReelsFeedItem'
import { ACTION_BAR_HEIGHT, MobileFeedActionRail } from './MobileFeedActionRail'
import { ReadthroughSheet } from './ReadthroughSheet'
import { useIdeasFeed } from '../../hooks/ideas/useIdeasFeed'
import type { ScoredFeedItem, ItemType } from '../../hooks/ideas/types'
import type { ReadthroughSourceType } from '../../lib/mobile/readthrough-service'
import { loadSeen, markSeen, rotateBySeen } from '../../lib/mobile/feed-rotation'
import { useAuth } from '../../hooks/useAuth'
import { useAttention } from '../../hooks/useAttention'
import { AttentionFeedCard } from './AttentionFeedCard'
import { attentionTarget } from '../../lib/mobile/attention-navigation'
import { interleaveByKind } from '../../lib/mobile/feed-interleave'
import { clearFeedSession, loadFeedSession, saveFeedSession } from '../../lib/mobile/feed-session'
import { usePullToRefresh } from '../../hooks/mobile/usePullToRefresh'
import { PullToRefreshIndicator } from './PullToRefreshIndicator'
import { useSignalCards } from '../../hooks/ideas/useSignalCards'
import { SignalFeedTile } from './SignalFeedTile'
import { DerivedInsightTile } from './DerivedInsightTile'
import { NewsFeedTile } from './NewsFeedTile'
import { ConvictionGapTile, CrowdedNameTile, TargetBreachTile, StaleTargetTile } from './PortfolioLensTile'
import { usePortfolioLenses } from '../../hooks/mobile/usePortfolioLenses'
import { FeedFilterSheet } from './FeedFilterSheet'
import { EMPTY_FILTER, filterCount, useFeedFacets, type FeedFilter } from '../../hooks/mobile/useFeedFacets'
import { TemplateFeedTile } from './TemplateFeedTile'
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
  onShare?: (item: ScoredFeedItem) => void
  onCreateIdea?: (item: ScoredFeedItem) => void
}

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
export function MobileDashboard({
  onNavigate,
  onShare,
  onCreateIdea,
}: MobileDashboardProps) {
  const { user } = useAuth()
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
  /** Asset the reader was looking at when they tapped Capture, so a thought
   *  logged from the feed arrives already attached to its subject. */
  const [captureCtx, setCaptureCtx] = useState<
    { assetId: string | null; symbol: string | null; name: string | null } | null
  >(null)

  const { track } = useFeedDwell(userId)

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
  const { data: activeRiskRows = [] } = useQuery({
    queryKey: ['feed-active-risk', userId],
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id')
        .eq('status', 'active')
        .limit(1)
      const portfolioId = (portfolios as any[])?.[0]?.id as string | undefined
      if (!portfolioId) return []

      const [{ data: holdings }, { data: bench }] = await Promise.all([
        supabase
          .from('portfolio_holdings')
          .select('asset_id, shares, price, date, assets(id, symbol)')
          .eq('portfolio_id', portfolioId)
          .order('date', { ascending: false, nullsFirst: false }),
        supabase
          .from('portfolio_benchmark_weights')
          .select('asset_id, weight')
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
      if (total <= 0) return []

      const benchByAsset = new Map((bench ?? []).map((b: any) => [b.asset_id, Number(b.weight)]))
      return rows
        .map((h: any) => ({
          assetId: h.asset_id,
          symbol: h.assets?.symbol ?? '',
          weight: ((Number(h.shares) || 0) * (Number(h.price) || 0)) / total * 100,
          benchmarkWeight: benchByAsset.has(h.asset_id) ? benchByAsset.get(h.asset_id)! : null,
        }))
        .filter(r => r.symbol)
    },
  })

  /**
   * Derived content cards.
   *
   * Templates are pure functions over data we already hold, so this is a memo
   * rather than a query — and each returns nothing when there is nothing worth
   * saying, which is what keeps the feed from filling with cards that always
   * fire.
   */
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
              ?? e.lens?.breach?.symbol ?? e.lens?.target?.symbol ?? null
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
      <div className="flex-shrink-0 flex items-center gap-2 px-3 pb-2 pt-2.5 [padding-top:calc(0.625rem+env(safe-area-inset-top))] border-b border-gray-200 dark:border-gray-800">
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
        className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory overscroll-contain"
      >
        {feedEntries.map(entry => {
          if (entry.kind === 'attention') {
            const a = entry.attention
            const linked = a.context?.asset_id ? attentionAssets?.[a.context.asset_id] : null
            const target = attentionTarget(a)
            return (
              <section key={a.attention_id} ref={track({ assetId: a.context?.asset_id ?? null, kind: 'attention' })} className="relative h-full w-full snap-start snap-always border-b-8 border-gray-200 dark:border-gray-800">
                <AttentionFeedCard
                  onFilterKind={() => setKindFilter('attention')}
                  item={a}
                  symbol={linked?.symbol}
                  companyName={linked?.company_name}
                  pairLegs={(() => {
                    const key = a.source_id ? pairInfo?.keyBySource?.[a.source_id] : undefined
                    return key ? pairInfo?.legsByPair?.[key] : undefined
                  })()}
                  onOpen={target ? () => { markRead(a.attention_id); onNavigate?.(target) } : undefined}
                  onSnooze={() => snoozeFor(a.attention_id, 24)}
                  onAcknowledge={() => acknowledge(a.attention_id)}
                  onCapture={() => setCaptureCtx({
                    assetId: linked?.id ?? null,
                    symbol: linked?.symbol ?? null,
                    name: linked?.company_name ?? null,
                  })}
                />
              </section>
            )
          }

          if (entry.kind === 'lens') {
            const l = entry.lens
            const key =
              l.type === 'conviction' ? `lens-conv-${l.gap.assetId}-${l.gap.portfolioId}`
              : l.type === 'crowded'  ? `lens-crowd-${l.name.assetId}`
              : l.type === 'breach'   ? `lens-breach-${l.breach.assetId}`
              :                         `lens-stale-${l.target.assetId}`
            return (
              <section
                key={key}
                ref={track({ assetId: null, kind: 'lens' })}
                className="relative h-full w-full snap-start snap-always border-b-8 border-gray-200 dark:border-gray-800"
              >
                {l.type === 'conviction' ? (
                  <ConvictionGapTile gap={l.gap} onAssetClick={openAsset}
                    onFilterKind={() => setKindFilter('lens')} />
                ) : l.type === 'crowded' ? (
                  <CrowdedNameTile name={l.name} onAssetClick={openAsset}
                    onFilterKind={() => setKindFilter('lens')} />
                ) : l.type === 'breach' ? (
                  <TargetBreachTile breach={l.breach} onAssetClick={openAsset}
                    onFilterKind={() => setKindFilter('lens')} />
                ) : (
                  <StaleTargetTile target={l.target} onAssetClick={openAsset}
                    onFilterKind={() => setKindFilter('lens')} />
                )}
              </section>
            )
          }

          if (entry.kind === 'insight') {
            return (
              <section
                key={`${entry.insight.id}-r${entry.round}`}
                ref={track({ assetId: entry.insight.assetId ?? null, kind: 'insight' })}
                className="relative h-full w-full snap-start snap-always border-b-8 border-gray-200 dark:border-gray-800"
              >
                <DerivedInsightTile
                  onFilterKind={() => setKindFilter('insight')}
                  insight={entry.insight}
                  onAssetClick={openAsset}
                  onCapture={() => setCaptureCtx({
                    assetId: entry.insight.assetId ?? null,
                    symbol: entry.insight.symbol ?? null,
                    name: null,
                  })}
                />
              </section>
            )
          }

          if (entry.kind === 'signal') {
            return (
              <section key={entry.signal.id} ref={track({ assetId: (entry.signal.relatedAssets?.[0] as any)?.id ?? null, kind: 'signal' })} className="relative h-full w-full snap-start snap-always border-b-8 border-gray-200 dark:border-gray-800">
                <SignalFeedTile
                  onFilterKind={() => setKindFilter('signal')}
                  signal={entry.signal}
                  onAssetClick={openAsset}
                  onCapture={() => setCaptureCtx({
                    assetId: entry.signal.asset?.id ?? null,
                    symbol: entry.signal.asset?.symbol ?? null,
                    name: entry.signal.asset?.company_name ?? null,
                  })}
                />
              </section>
            )
          }

          if (entry.kind === 'template') {
            const c = entry.card
            return (
              <section key={c.id} ref={track({ assetId: (c as any).assetId ?? null, kind: 'template' })} className="relative h-full w-full snap-start snap-always border-b-8 border-gray-200 dark:border-gray-800">
                <TemplateFeedTile
                  card={c}
                  onAssetClick={openAsset}
                  onFilterKind={() => setKindFilter('template')}
                  onCapture={() => setCaptureCtx({
                    assetId: c.assetId ?? null,
                    symbol: c.symbol ?? null,
                    name: null,
                  })}
                />
              </section>
            )
          }

          if (entry.kind === 'news') {
            const n = entry.news
            const linked = n.symbols
              .map((s: string) => assetBySymbol.get(s.toUpperCase()) ?? null)
              .find(Boolean) ?? null
            return (
              <section key={n.id} ref={track({ assetId: null, kind: 'news' })} className="relative h-full w-full snap-start snap-always border-b-8 border-gray-200 dark:border-gray-800">
                <NewsFeedTile
                  item={n}
                  assetForSymbol={(sym) => assetBySymbol.get(sym.toUpperCase()) ?? null}
                  onAssetClick={openAsset}
                  onFilterKind={() => setKindFilter('news')}
                  onCapture={() => setCaptureCtx({
                    assetId: linked?.id ?? null,
                    symbol: linked?.symbol ?? null,
                    name: null,
                  })}
                />
              </section>
            )
          }

          const item = entry.idea
          const source = readthroughSourceType(item.type)
          const itemAssetId = ('asset' in item && item.asset ? item.asset.id : null) as string | null
          const itemAuthorId = item.author?.id ?? null
          const note = (signal: 'reaction' | 'share' | 'open' | 'readthrough') =>
            userId && recordInterest({ userId, signal, assetId: itemAssetId, authorId: itemAuthorId, kind: 'idea' })
          return (
            <section
              key={item.id}
              ref={track({ assetId: itemAssetId, authorId: itemAuthorId, kind: 'idea' })}
              className="relative h-full w-full snap-start snap-always border-b-8 border-gray-200 dark:border-gray-800"
            >
              {/* Inset by exactly the bar height so the card never renders
                  underneath the actions. */}
              <div className="absolute inset-x-0 top-0" style={{ bottom: ACTION_BAR_HEIGHT }}>
                <ReelsFeedItem
                  item={item}
                  hideHeaderActions
                  onAssetClick={(id, sym) => { note('open'); openAsset(id, sym) }}
                  onShare={onShare}
                  onCreateIdea={onCreateIdea}
                />
              </div>
              <MobileFeedActionRail
                itemId={item.id}
                itemType={item.type}
                onShare={() => { note('share'); setShareItem(item) }}
                onReact={() => note('reaction')}
                onPromote={item.type === 'quick_thought' ? () => setPromoteItem(item) : undefined}
                onAsk={() => setAskItem(item)}
                onReadthrough={source ? () => { note('readthrough'); setReadthroughFor(item) } : undefined}
                onCapture={() => setCaptureCtx({
                  assetId: itemAssetId,
                  symbol: ('asset' in item && item.asset ? item.asset.symbol : null) as string | null,
                  name: ('asset' in item && item.asset ? item.asset.company_name : null) as string | null,
                })}
              />
            </section>
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
