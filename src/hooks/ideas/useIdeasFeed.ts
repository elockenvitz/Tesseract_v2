/**
 * useIdeasFeed — Primary infinite-scroll feed hook for the Ideas page.
 *
 * Fetches content from multiple sources, applies ranking, and supports
 * cursor-based infinite loading. This replaces the all-at-once discovery
 * feed with a proper paginated approach.
 *
 * Feed modes:
 * - 'for_you': Ranked by relevance to current user (default)
 * - 'following': Only from followed authors
 * - 'latest': Pure recency sort
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { followedSignature } from '../../lib/ideas/followed-signature'
import {
  coverageBonusFor,
  coverageRelevanceFor,
  coverageSignature,
  desktopAssetRelevanceFor,
  EMPTY_COVERAGE_INDEX,
  type CoverageIndex,
} from '../../lib/signals/coverage-relevance'
import { useCoverageIndex } from '../../contexts/CoverageRelevanceContext'
import { useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { subDays } from 'date-fns'
import type { FeedItem, ScoredFeedItem, ItemType, Author } from './types'
import {
  isOpenProposal, OPEN_PROPOSAL_STATUSES, pairLegWindow, pairPageSlice,
  proposalWindowDays,
} from '../../lib/ideas/open-proposal'
import { pairIsLive } from '../../lib/signals/pair-shape'

// ============================================================
// Types
// ============================================================

export type FeedMode = 'for_you' | 'following' | 'latest'

export interface IdeasFeedFilters {
  mode: FeedMode
  types?: ItemType[]
  timeRange?: 'day' | 'week' | 'month' | 'all'
  assetId?: string
  portfolioId?: string
  themeId?: string
  search?: string
}

interface FeedPage {
  items: ScoredFeedItem[]
  nextCursor: number | null
}

// ============================================================
// Constants
// ============================================================

/** Additive lift for a name the reader covers. See coverageBonusFor. */
const COVERAGE_BONUS = 0.12

const PAGE_SIZE = 15
const INITIAL_DAYS_BACK = 90
const MAX_DAYS_BACK = 365


// ============================================================
// Signal card types for system-generated content
// ============================================================

export type SignalType = 'attention_cluster' | 'stale_coverage' | 'conflict' | 'catalyst_proximity' | 'prompt'

export interface SignalCard {
  id: string
  type: 'signal'
  signalType: SignalType
  headline: string
  body: string
  relatedAssets: Array<{ id: string; symbol: string }>
  relatedAuthors?: Author[]
  relatedPostIds?: string[]
  metric?: string
  metricLabel?: string
  createdAt: string
  priority: number // 0-1, used for insertion ranking
}

// ============================================================
// Feed item with signal cards mixed in
// ============================================================

export type MixedFeedItem = ScoredFeedItem | SignalCard

export function isSignalCard(item: MixedFeedItem): item is SignalCard {
  return item.type === 'signal'
}

// ============================================================
// User context for ranking
// ============================================================

function useUserContext() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  const followedQuery = useQuery({
    queryKey: ['feed-context', 'followed', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data } = await supabase
        .from('author_follows')
        .select('followed_id')
        .eq('follower_id', user.id)
      return (data || []).map(r => r.followed_id)
    },
    enabled: !!user,
    staleTime: 60_000,
  })

  // The same context value the mobile ranker reads — see
  // contexts/CoverageRelevanceContext.
  const coverageIndex = useCoverageIndex()

  const holdingsQuery = useQuery({
    queryKey: ['feed-context', 'holdings', user?.id],
    queryFn: async () => {
      if (!user) return new Set<string>()
      const { data } = await supabase
        .from('portfolio_holdings')
        // holdings-audit: safe — builds a Set of asset ids, and a set is
        // unaffected by the same asset appearing on several snapshot dates.
        // No sum, no denominator, so latestSnapshotRows would change nothing.
        .select('asset_id, portfolios!inner(id)')
      const ids = new Set<string>()
      for (const h of data || []) if (h.asset_id) ids.add(h.asset_id)
      return ids
    },
    enabled: !!user,
    staleTime: 60_000,
  })

  return {
    userId: user?.id || null,
    organizationId: currentOrgId,
    followedIds: followedQuery.data || [],
    heldAssetIds: holdingsQuery.data || new Set<string>(),
    /**
     * The same coverage index the mobile ranker uses.
     *
     * Desktop and mobile run different ranking algorithms — see
     * docs/tickets/ideas-ranking-divergence.md — but they must not run
     * different definitions of "this reader covers that name". This is the
     * shared fact; the two scorers each apply their own arithmetic to it.
     */
    coverageIndex,
  }
}

/**
 * Everything the desktop scorer reads about the reader.
 *
 * Named and exported so `scoreFeedItem` and `generateDiscoveryItems` share one
 * shape instead of repeating an inline literal that drifts.
 */
export interface FeedScoringContext {
  userId: string | null
  organizationId: string | null
  followedIds: string[]
  heldAssetIds: Set<string>
  /**
   * Optional, and neutral when absent.
   *
   * A scoring context assembled without coverage — a unit test, a caller that
   * predates this field — must score exactly as it did before rather than fail
   * to compile or, worse, read as "this reader covers nothing" and penalise
   * every card. That is the same refusal `coverageRelevanceFor` makes for an
   * index that has not loaded; making the field required would have put the
   * decision in the type system instead, where it can only be answered by
   * every caller inventing an empty index.
   */
  coverageIndex?: CoverageIndex
}

// ============================================================
// Score a single feed item
// ============================================================

function scoreFeedItem(
  item: FeedItem,
  ctx: FeedScoringContext,
  mode: FeedMode,
): ScoredFeedItem {
  const ageHours = (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60)

  /**
   * Freshness: exponential decay, half-life 18h.
   *
   * Right for the sources this scorer was written for — thoughts, notes,
   * discussion — where something said yesterday genuinely matters more than
   * something said last month.
   */
  const decayed = Math.pow(0.5, ageHours / 18)

  /**
   * An OPEN PROPOSAL does not age like a comment, and this is why Ideas looked
   * empty.
   *
   * Measured against production on 2026-08-23: the newest open proposal in the
   * reporting org is 553 hours old, and the average is 4,098. At an 18-hour
   * half-life that is 0.5^30 — about five ten-billionths. Every trade idea
   * scored as though it had no recency component at all, sorted below anything
   * written this week, and `fetchFeedPage` slices to PAGE_SIZE before the
   * mobile feed ever sees the list. The rows were fetched, passed every filter,
   * and were cut by the ranking.
   *
   * That is the fifth distinct cause behind "I see no trade ideas", after the
   * status rule, the time window, diversity deleting rather than deferring, and
   * the adapter mismatches. Each was real; none was sufficient, because this
   * one sits after all of them.
   *
   * The floor states what is actually true: a proposal is in this feed BECAUSE
   * it is still open — that is the only reason it survived
   * `OPEN_PROPOSAL_STATUSES` — so its relevance is a fact about its state, not
   * about the calendar. A February idea nobody has executed or rejected is a
   * live question today. It still decays a little above the floor, so a fresh
   * proposal leads an old one; it just can no longer be rounded to nothing.
   *
   * 0.55 rather than 1.0: an open proposal should compete with this week's
   * writing, not automatically beat it.
   */
  const PROPOSAL_FRESHNESS_FLOOR = 0.55
  const isOpenProposal = item.type === 'trade_idea' || item.type === 'pair_trade'
  const freshness = isOpenProposal ? Math.max(decayed, PROPOSAL_FRESHNESS_FLOOR) : decayed

  // Author relevance
  const isOwn = item.author?.id === ctx.userId
  const isFollowed = ctx.followedIds.includes(item.author?.id || '')
  const authorRelevance = isOwn ? 0.7 : isFollowed ? 0.9 : 0.3

  // Asset relevance — coverage first, holdings second.
  //
  // Was `heldAssetIds.has(assetId) ? 0.9 : 0.3`. Those two numbers are
  // preserved exactly for "held" and "not relevant", so a reader with no
  // coverage scores identically to before; coverage adds a band ABOVE holdings
  // rather than rescaling what was there. The bands themselves are decided in
  // lib/signals/coverage-relevance, shared with the mobile ranker.
  const assetId = 'asset' in item && item.asset ? item.asset.id : null
  const coverage = coverageRelevanceFor(ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX, assetId)
  const assetRelevance = desktopAssetRelevanceFor(coverage)
  /**
   * The lift that makes the declaration worth making.
   *
   * 0.12 is set against this scorer's own arithmetic: freshness carries 0.25
   * and decays with an 18h half-life, so 0.12 lets a covered idea outrank a
   * distinctly fresher uncovered one while a genuinely urgent, much fresher
   * item still wins. Zero for everything except a name the reader declared or
   * was assigned — see coverageBonusFor.
   */
  const coverageBonus = coverageBonusFor(coverage) * COVERAGE_BONUS

  // Content quality
  const contentLen = (item.content || '').length
  const hasAsset = !!assetId
  const hasSentiment = 'sentiment' in item && !!item.sentiment
  const quality = Math.min(1, (contentLen > 200 ? 0.4 : contentLen > 50 ? 0.2 : 0.1) +
    (hasAsset ? 0.3 : 0) + (hasSentiment ? 0.2 : 0))

  // Engagement
  const reactionCount = item.reactionCounts?.reduce((s, r) => s + r.count, 0) || 0
  const engagement = Math.min(1, Math.log2(reactionCount + 1) / 4)

  // Weighted score
  let score: number
  if (mode === 'latest') {
    score = freshness
  } else if (mode === 'following') {
    score = freshness * 0.5 + authorRelevance * 0.3 + quality * 0.2
  } else {
    // for_you
    score = freshness * 0.25 + authorRelevance * 0.2 + assetRelevance * 0.2 +
            quality * 0.15 + engagement * 0.2 + coverageBonus
  }

  return {
    ...item,
    score,
    scoreBreakdown: {
      recency: freshness,
      engagement,
      authorRelevance,
      assetRelevance,
      contentQuality: quality,
    },
    cardSize: 'medium' as const,
  }
}

// ============================================================
// Apply diversity controls
// ============================================================

/** Exported for tests only — the behaviour here is worth pinning directly. */
export const applyDiversityForTest = (items: ScoredFeedItem[]) => applyDiversity(items)

/** Exported for tests only — the ranking is what buried open proposals. */
export const scoreFeedItemForTest = scoreFeedItem

function applyDiversity(items: ScoredFeedItem[]): ScoredFeedItem[] {
  const result: ScoredFeedItem[] = []
  /**
   * Items the run-length rules pushed back, kept rather than discarded.
   *
   * ── The bug this fixes ────────────────────────────────────────────────────
   *
   * This loop used `continue`, with a comment reading "skip, will appear
   * later". They never appeared later. `applyDiversity` runs ONCE per page,
   * and the next page re-queries the database at a different offset — so a row
   * dropped here is not deferred, it is deleted, and nothing downstream can
   * tell the difference between "diversity moved this" and "this does not
   * exist".
   *
   * The damage lands hardest on exactly the source that can least afford it.
   * A desk's trade ideas come from a handful of people: 21 open proposals in
   * the reporting org, written by two or three analysts. "Three from the same
   * author in the last five" then discards most of them on every page, while
   * pair trades — built through a different path, from a different author
   * spread — survive intact. Reported, twice, as the Ideas filter showing
   * nothing but pair trades.
   *
   * Diversity is a rule about ORDER. Implementing it as a rule about
   * membership was the mistake.
   */
  const deferred: ScoredFeedItem[] = []
  const recentAuthors: string[] = []
  const recentAssets: string[] = []

  const take = (item: ScoredFeedItem) => {
    result.push(item)
    recentAuthors.push(item.author?.id || '')
    recentAssets.push(('asset' in item && item.asset?.id) || '')
  }

  for (const item of items) {
    const authorId = item.author?.id || ''
    const assetId = ('asset' in item && item.asset?.id) || ''

    // Three from one author in the last five reads as that author's feed.
    const authorRecent = recentAuthors.slice(-5).filter(a => a === authorId).length
    // Two on one name in the last four reads as a page about that name.
    const assetRecent = recentAssets.slice(-4).filter(a => a === assetId && a !== '').length

    if (authorRecent >= 3 || assetRecent >= 2) { deferred.push(item); continue }
    take(item)
  }

  /**
   * The deferred items, re-offered in their original order.
   *
   * A second pass rather than a plain concatenation, so the spacing rules
   * still apply among them — and anything the second pass cannot place is
   * appended regardless, because a page that silently returns fewer items than
   * it could is the defect this function just stopped causing.
   */
  const stillBlocked: ScoredFeedItem[] = []
  for (const item of deferred) {
    const authorId = item.author?.id || ''
    const assetId = ('asset' in item && item.asset?.id) || ''
    const authorRecent = recentAuthors.slice(-5).filter(a => a === authorId).length
    const assetRecent = recentAssets.slice(-4).filter(a => a === assetId && a !== '').length
    if (authorRecent >= 3 || assetRecent >= 2) { stillBlocked.push(item); continue }
    take(item)
  }

  return [...result, ...stillBlocked]
}

// ============================================================
// Fetch a page of feed items
// ============================================================

async function fetchFeedPage(
  offset: number,
  filters: IdeasFeedFilters,
  ctx: FeedScoringContext,
): Promise<FeedPage> {
  // Expand time window as user scrolls deeper — starts at 90d, grows to 365d
  const baseDays = filters.timeRange === 'day' ? 1
    : filters.timeRange === 'week' ? 7
    : filters.timeRange === 'month' ? 30
    : INITIAL_DAYS_BACK
  const expandedDays = Math.min(MAX_DAYS_BACK, baseDays + Math.floor(offset / PAGE_SIZE) * 30)
  const timeStart = subDays(new Date(), expandedDays).toISOString()
  /**
   * Open proposals are bounded by their status, not by scroll depth. See
   * `proposalWindowDays` — the rolling window left 1 of 23 ideas visible.
   */
  const proposalStart = subDays(
    new Date(), proposalWindowDays(filters.timeRange, expandedDays),
  ).toISOString()

  const wantTypes = filters.types && filters.types.length > 0 ? filters.types : null

  // Parallel fetch from content sources
  const fetchSize = PAGE_SIZE + 5 // overfetch slightly for diversity filtering

  const queries: Promise<FeedItem[]>[] = []

  // Quick thoughts — strictly scoped to current org. quick_thoughts now
  // carries organization_id (migration 20260605120000); the BEFORE INSERT
  // trigger stamps it from users.current_organization_id, so a thought
  // posted in Org A no longer appears on the Ideas feed in Org B.
  if (!wantTypes || wantTypes.includes('quick_thought')) {
    queries.push((async () => {
      let q = supabase
        .from('quick_thoughts')
        .select('id, content, created_at, updated_at, sentiment, visibility, is_pinned, tags, asset_id, created_by, source_url, source_title, assets:asset_id(id, symbol, company_name)')
        .eq('is_archived', false)
        .eq('organization_id', ctx.organizationId!)
        .gte('created_at', timeStart)
        .order('created_at', { ascending: false })
        .range(offset, offset + fetchSize - 1)

      if (filters.mode === 'following' && ctx.followedIds.length > 0) {
        q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
      }
      if (filters.assetId) q = q.eq('asset_id', filters.assetId)

      const { data, error } = await q
      if (error) console.warn('[feed] source query failed', error)
      if (!data) return []

      // Fetch authors
      const authorIds = [...new Set((data as any[]).map(d => d.created_by).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      return (data as any[]).map(d => ({
        id: d.id,
        type: 'quick_thought' as const,
        content: d.content || '',
        created_at: d.created_at,
        updated_at: d.updated_at,
        author: (() => { const u = userMap.get(d.created_by); return u ? { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name } : { id: d.created_by || '' } })(),
        sentiment: d.sentiment,
        visibility: d.visibility || 'team',
        is_pinned: d.is_pinned || false,
        tags: d.tags || [],
        source_url: d.source_url,
        source_title: d.source_title,
        asset: d.assets || undefined,
      }))
    })())
  }

  // Trade ideas — strictly scoped to current org via the canonical
  // trade_queue_items.organization_id column.
  if (!wantTypes || wantTypes.includes('trade_idea')) {
    queries.push((async () => {
      let q = supabase
        .from('trade_queue_items')
        /**
         * The investment columns, joined as of Mobile Ideas V2.
         *
         * `stage`, `target_price`, `conviction`, `time_horizon`, `thesis_text`,
         * the proposed sizing and the co-analyst fields all already existed on
         * these rows and none were selected — so the card could say who wanted
         * to buy what, and nothing about the claim they were making. Widening a
         * SELECT on rows already being read costs one column list and no extra
         * round trip.
         *
         * `stage` is the one that matters most and is the least obvious: it is
         * how the card tells a buy somebody sketched this morning from a buy
         * sitting in front of a PM. See `lib/signals/idea-shape`.
         */
        .select('id, action, urgency, rationale, status, outcome, stage, stage_changed_at, updated_at, created_at, created_by, asset_id, portfolio_id, pair_id, pair_trade_id, sharing_visibility, target_price, conviction, time_horizon, thesis_text, proposed_weight, proposed_shares, assigned_to, collaborators, assets:asset_id(id, symbol, company_name, current_price), portfolios:portfolio_id(id, name)')
        // Every open proposal, not only untouched ones. See `open-proposal`:
        // this used to be `status = 'idea'` while the pair source filtered on
        // nothing, and that asymmetry is what made the Ideas filter look like
        // a list of pair trades.
        .in('status', OPEN_PROPOSAL_STATUSES)
        .eq('visibility_tier', 'active')
        .eq('organization_id', ctx.organizationId!)
        // Proposals are bounded by their status, not by their age. See
        // PROPOSAL_DAYS_BACK — the rolling window left 1 of 23 visible.
        .gte('created_at', proposalStart)
        .order('created_at', { ascending: false })
        .range(offset, offset + fetchSize - 1)

      if (filters.mode === 'following' && ctx.followedIds.length > 0) {
        q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
      }
      if (filters.assetId) q = q.eq('asset_id', filters.assetId)
      if (filters.portfolioId) q = q.eq('portfolio_id', filters.portfolioId)

      const { data, error } = await q
      if (error) console.warn('[feed] source query failed', error)
      if (!data) return []

      const authorIds = [...new Set((data as any[]).map(d => d.created_by).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      // Exclude pair legs on either linking column — a leg that slipped
      // through would render as a standalone idea alongside its own pair.
      /**
       * Terminal ideas leave here — at the candidate boundary, before anything
       * downstream can see them.
       *
       * The status filter above is a coarse server-side narrowing and cannot
       * read `outcome`; `isOpenProposal` is what actually decides. Doing it
       * here rather than at render is the point: a terminal row that survives
       * this line goes on to compete in ranking, occupy a diversity slot,
       * consume feed depth, resolve a visual family, build panes, and be
       * offered a judgment control. Filtering at the end would hide the card
       * and leave every one of those effects in place.
       */
      return (data as any[])
        .filter(d => !d.pair_id && !d.pair_trade_id)
        .filter(isOpenProposal)
        .map(d => ({
        id: d.id,
        type: 'trade_idea' as const,
        content: d.rationale || '',
        created_at: d.created_at,
        author: (() => { const u = userMap.get(d.created_by); return u ? { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name } : { id: d.created_by || '' } })(),
        action: d.action as any,
        urgency: d.urgency as any,
        rationale: d.rationale,
        status: d.status,
        sharing_visibility: d.sharing_visibility,
        // Nulls are passed through as nulls, never defaulted. "No target" and
        // "we did not look up the target" have to stay distinguishable — the
        // card renders them differently and a `?? 0` here would erase that.
        stage: d.stage ?? null,
        stage_changed_at: d.stage_changed_at ?? null,
        updated_at: d.updated_at ?? undefined,
        target_price: d.target_price ?? null,
        conviction: d.conviction ?? null,
        time_horizon: d.time_horizon ?? null,
        thesis_text: d.thesis_text ?? null,
        proposed_weight: d.proposed_weight ?? null,
        proposed_shares: d.proposed_shares ?? null,
        assigned_to: d.assigned_to ?? null,
        collaborators: d.collaborators ?? null,
        asset: d.assets || undefined,
        portfolio: d.portfolios || undefined,
      }))
    })())
  }

  // Pair trades. The trade-idea query above deliberately drops legs
  // (`!d.pair_id`) so a pair does not appear as two unrelated cards — but
  // nothing was adding the pair back, so pair trades never reached the feed at
  // all. Built from the legs rather than from `pair_trades` directly: the legs
  // carry organization_id, so the same org scoping applies without inventing a
  // second rule for a table that has no org column.
  if (!wantTypes || wantTypes.includes('pair_trade')) {
    queries.push((async () => {
      let legQuery = supabase
        .from('trade_queue_items')
        // Legs carry their own target and their own stage. A pair whose long
        // leg is decision-ready and short leg is still being researched is a
        // real and interesting state, and the card can only say so if both are
        // read. Same widening as the single-idea query above.
        .select('id, action, urgency, rationale, status, outcome, stage, created_at, created_by, asset_id, portfolio_id, pair_id, pair_trade_id, pair_leg_type, target_price, conviction, assets:asset_id(id, symbol, company_name, current_price), portfolios:portfolio_id(id, name)')
        // Legs link through either column depending on when they were created,
        // so matching only one silently drops whole pairs.
        .or('pair_id.not.is.null,pair_trade_id.not.is.null')
        // Not restricted to status 'idea' the way single ideas are. A pair that
        // has been approved or executed is still the team's position on a
        // relationship between two names, and is worth seeing in the feed;
        // filtering to 'idea' hid every pair that had actually progressed.
        // visibility_tier already excludes trashed rows.
        .eq('visibility_tier', 'active')
        .neq('status', 'deleted')
        .eq('organization_id', ctx.organizationId!)
        // Same reasoning as the single proposals above: a pair is open or it
        // is not, and how long ago it was drafted does not decide that.
        .gte('created_at', proposalStart)
        .order('created_at', { ascending: false })
        // Bounded by how many PAIRS this page can possibly need, not by a
        // fixed slab of legs. See the slice below.
        .range(0, pairLegWindow(offset, PAGE_SIZE) - 1)

      if (filters.portfolioId) legQuery = legQuery.eq('portfolio_id', filters.portfolioId)

      const { data: legs } = await legQuery
      if (!legs?.length) return []

      // Legs arrive newest-first, so insertion order makes this a map of pairs
      // ordered by their most recent leg — which is the order the feed wants.
      const byPair = new Map<string, any[]>()
      for (const leg of legs as any[]) {
        const key = leg.pair_trade_id || leg.pair_id
        if (!key) continue
        const list = byPair.get(key)
        if (list) list.push(leg)
        else byPair.set(key, [leg])
      }

      /**
       * The page's share of pairs — the fix for a source that had no offset.
       *
       * Every other source in this feed pages with `.range(offset, ...)`. This
       * one selected a fixed slab of legs and grouped it, so page 2 and page 7
       * returned exactly the same pairs. Two things followed: the same pair
       * appeared on a phone once per page scrolled, and because single ideas
       * advanced properly while pairs were re-added, the pair share of the
       * Ideas filter grew with every scroll until it was nearly all of it.
       *
       * Grouping has to happen before slicing — a pair split across a page
       * boundary would render as two half-pairs — so the leg window grows with
       * depth rather than sliding. It stays bounded: pairs needed so far times
       * a generous legs-per-pair allowance.
       *
       * Openness is judged on the whole group, which is the other reason the
       * grouping cannot come after a status filter: a leg-level filter would
       * quietly turn a pair with one settled leg into a half-built one.
       */
      /**
       * Openness judged on the LEGS THEMSELVES, not on their statuses.
       *
       * `pairIsOpen` could only see statuses, so a pair whose every leg was
       * executed still matched — `approved` and `executed` legs are in the
       * coarse list. `pairIsOpenFromRows` reads the outcome as well, which is
       * the field that actually says the work is over.
       */
      /**
       * Liveness for the GROUP, under the real pair rule.
       *
       * There is no pair-level outcome column, so this is a property of the
       * legs: deleted legs are not part of the structure and are removed
       * first, then the pair is live if any surviving leg is live. Deleted and
       * terminal are deliberately different — treating a removed leg as
       * finished work would make a live pair read as settled, and production
       * has a ten-leg group with six deletions where that would have happened.
       */
      const ordered = [...byPair.entries()].filter(([, ls]) => pairIsLive(ls))
      const [from, to] = pairPageSlice(offset, PAGE_SIZE)
      const pairIds = ordered.slice(from, to).map(([id]) => id)
      if (!pairIds.length) return []
      const [{ data: pairs }, { data: users }] = await Promise.all([
        supabase.from('pair_trades').select('id, name, rationale, thesis_summary, urgency, status, created_by, created_at').in('id', pairIds),
        (async () => {
          // Authors of THIS page's pairs, not of the whole leg window. The
          // window grows with depth, so keying it off `legs` would make the
          // author lookup grow with it for no benefit.
          const authorIds = [...new Set(
            pairIds.flatMap(id => byPair.get(id) || []).map(l => l.created_by).filter(Boolean),
          )]
          if (!authorIds.length) return { data: [] as any[] }
          return supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        })(),
      ])

      const pairMap = new Map((pairs || []).map((p: any) => [p.id, p]))
      const userMap = new Map((users || []).map((u: any) => [u.id, u]))

      // `pair_leg_type` states the side explicitly and is authoritative where
      // present; older legs have it null, so the action is the fallback. A pair
      // with only one side is still shown — a half-built pair is worth seeing.
      const isLong = (leg: any) => {
        if (leg.pair_leg_type === 'long') return true
        if (leg.pair_leg_type === 'short') return false
        return leg.action === 'buy' || leg.action === 'add'
      }

      return pairIds.map(pairId => {
        const pairLegs = byPair.get(pairId) || []
        const meta: any = pairMap.get(pairId)
        const first = pairLegs[0]
        const author = userMap.get(first?.created_by)

        // Legs whose asset join came back empty cannot be charted or labelled,
        // so they are dropped here rather than handed downstream to crash on.
        const toLeg = (l: any) => ({
          id: l.id, action: l.action, target_price: l.target_price ?? null, asset: l.assets,
        })
        const chartable = (l: any) => !!l?.assets?.symbol

        return {
          id: pairId,
          type: 'pair_trade' as const,
          content: meta?.rationale || meta?.thesis_summary || first?.rationale || '',
          created_at: meta?.created_at || first?.created_at,
          author: author
            ? { id: author.id, email: author.email, first_name: author.first_name, last_name: author.last_name }
            : { id: first?.created_by || '' },
          pair_id: pairId,
          urgency: (meta?.urgency || first?.urgency) as any,
          rationale: meta?.rationale || first?.rationale,
          status: meta?.status || first?.status,
          long_legs: pairLegs.filter(l => isLong(l) && chartable(l)).map(toLeg),
          short_legs: pairLegs.filter(l => !isLong(l) && chartable(l)).map(toLeg),
          portfolio: first?.portfolios || undefined,
          asset: pairLegs.find(isLong)?.assets || first?.assets || undefined,
        }
      })
    })())
  }

  // Notes (asset notes only for now — most relevant). Strictly scoped
  // to current org via asset_notes.organization_id.
  if (!wantTypes || wantTypes.includes('note')) {
    queries.push((async () => {
      let q = supabase
        .from('asset_notes')
        .select('id, title, content, created_at, user_id, asset_id, assets:asset_id(id, symbol, company_name)')
        .eq('organization_id', ctx.organizationId!)
        .gte('created_at', timeStart)
        .order('created_at', { ascending: false })
        .range(offset, offset + fetchSize - 1)

      if (filters.mode === 'following' && ctx.followedIds.length > 0) {
        q = q.in('user_id', [...ctx.followedIds, ctx.userId || ''])
      }
      if (filters.assetId) q = q.eq('asset_id', filters.assetId)

      const { data, error } = await q
      if (error) console.warn('[feed] source query failed', error)
      if (!data) return []

      const authorIds = [...new Set((data as any[]).map(d => d.user_id).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      return (data as any[]).map(d => ({
        id: d.id,
        type: 'note' as const,
        content: d.content || '',
        created_at: d.created_at,
        author: (() => { const u = userMap.get(d.user_id); return u ? { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name } : { id: d.user_id || '' } })(),
        title: d.title || '',
        note_type: 'asset' as const,
        preview: (d.content || '').replace(/<[^>]*>/g, '').slice(0, 200),
        source: d.assets ? { id: d.assets.id, name: d.assets.symbol, type: 'asset' } : undefined,
        asset: d.assets || undefined,
      }))
    })())
  }

  // Thesis updates — strictly scoped to current org via
  // asset_contributions.organization_id.
  if (!wantTypes || wantTypes.includes('thesis_update')) {
    queries.push((async () => {
      let q = supabase
        .from('asset_contributions')
        .select('id, section, content, created_at, created_by, asset_id, assets:asset_id(id, symbol, company_name)')
        .eq('organization_id', ctx.organizationId!)
        .gte('created_at', timeStart)
        .order('created_at', { ascending: false })
        .range(offset, offset + fetchSize - 1)

      if (filters.mode === 'following' && ctx.followedIds.length > 0) {
        q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
      }
      if (filters.assetId) q = q.eq('asset_id', filters.assetId)

      const { data, error } = await q
      /**
       * A failed query is not an empty one.
       *
       * Destructuring only `data` turned an error into `null`, which the next
       * line turned into `[]` — so a broken request and a source with nothing
       * to say were indistinguishable, in a feed whose whole job is to show
       * what exists.
       *
       * That is exactly how every single-name trade idea disappeared: two
       * statuses in the TypeScript union were not in the database enum,
       * PostgREST rejected the whole `in.(...)` list, and the resulting error
       * was discarded here without a line in the console. Five subsequent
       * fixes were all downstream of a query that had already failed.
       */
      if (error) console.warn('[feed] source query failed', error)
      if (!data) return []

      const authorIds = [...new Set((data as any[]).map(d => d.created_by).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      return (data as any[]).map(d => ({
        id: d.id,
        type: 'thesis_update' as const,
        content: d.content || '',
        created_at: d.created_at,
        author: (() => { const u = userMap.get(d.created_by); return u ? { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name } : { id: d.created_by || '' } })(),
        section: d.section,
        change_type: 'updated' as const,
        asset: d.assets || undefined,
      }))
    })())
  }

  // Execute all queries in parallel
  const results = await Promise.all(queries)
  const allItems = results.flat()

  // Score and sort
  const scored = allItems.map(item => scoreFeedItem(item, ctx, filters.mode))
  scored.sort((a, b) => b.score - a.score)

  // Apply diversity controls
  const diverse = applyDiversity(scored)

  // Paginate
  const pageItems = diverse.slice(0, PAGE_SIZE)
  const hasHumanContent = allItems.length >= fetchSize

  // If human content is running thin, generate system insights to keep the feed going
  if (pageItems.length < PAGE_SIZE && ctx.heldAssetIds.size > 0) {
    const systemItems = generateDiscoveryItems(offset, PAGE_SIZE - pageItems.length)
    pageItems.push(...systemItems)
  }

  // Keep pagination alive: only stop at hard limit with no time window left to expand
  const hasMore = hasHumanContent || expandedDays < MAX_DAYS_BACK || pageItems.length >= PAGE_SIZE

  return {
    items: pageItems,
    nextCursor: hasMore ? offset + PAGE_SIZE : null,
  }
}

// ============================================================
// System-generated discovery items to keep the feed infinite
// ============================================================

const DISCOVERY_PROMPTS: { title: string; body: string; actionLabel: string; captureType: string }[] = [
  { title: 'What are the biggest risks to your portfolio right now?', body: 'Take a moment to document the key risks you\'re tracking.', actionLabel: 'Capture thought', captureType: 'thought' },
  { title: 'Any positions you\'ve been meaning to revisit?', body: 'If a thesis feels stale, now is a good time to refresh it.', actionLabel: 'Update thesis', captureType: 'thought' },
  { title: 'Is there a trade idea you haven\'t formalized yet?', body: 'Turn a conviction into a structured idea your team can evaluate.', actionLabel: 'Create idea', captureType: 'trade_idea' },
  { title: 'Have you reviewed your price targets recently?', body: 'Markets move — make sure your scenarios reflect current conditions.', actionLabel: 'Review targets', captureType: 'thought' },
  { title: 'Any unresolved questions on your holdings?', body: 'Send a prompt to a colleague to get their perspective.', actionLabel: 'Send prompt', captureType: 'prompt' },
  { title: 'What\'s changed in your highest-conviction name?', body: 'Check if the thesis still holds for your largest active positions.', actionLabel: 'Capture thought', captureType: 'thought' },
  { title: 'Are there catalysts coming up you should prepare for?', body: 'Earnings, events, or macro data that could move your portfolio.', actionLabel: 'Capture thought', captureType: 'thought' },
  { title: 'Do any team members have views you should review?', body: 'Check if colleagues have posted new research or ideas.', actionLabel: 'Browse feed', captureType: 'thought' },
]

function generateDiscoveryItems(
  offset: number,
  count: number,
): ScoredFeedItem[] {
  const items: ScoredFeedItem[] = []
  const startIdx = Math.floor(offset / PAGE_SIZE) % DISCOVERY_PROMPTS.length

  for (let i = 0; i < count && i < DISCOVERY_PROMPTS.length; i++) {
    const prompt = DISCOVERY_PROMPTS[(startIdx + i) % DISCOVERY_PROMPTS.length]
    items.push({
      id: `discovery-${offset}-${i}`,
      type: 'insight' as any,
      content: prompt.body,
      title: prompt.title,
      created_at: new Date().toISOString(),
      author: { id: 'system' },
      score: 0.3,
      scoreBreakdown: { recency: 0.5, engagement: 0, authorRelevance: 0, assetRelevance: 0, contentQuality: 0.3 },
      cardSize: 'medium',
      meta: { actionLabel: prompt.actionLabel, captureType: prompt.captureType, isDiscovery: true },
    } as any)
  }

  return items
}

// ============================================================
// Main hook
// ============================================================

export function useIdeasFeed(filters: IdeasFeedFilters) {
  const ctx = useUserContext()

  const query = useInfiniteQuery({
    queryKey: ['ideas-feed', filters, ctx.userId, ctx.organizationId,
      // The following list is a SET, so the key has to identify the set.
      //
      // This was `ctx.followedIds.length`, and a count is not an identity:
      // following one analyst and unfollowing another leaves it unchanged, so
      // the key was unchanged and React Query kept serving pages built from a
      // following list the reader no longer had. `followedSignature` sorts and
      // hashes, so the same set in a different row order is the same key and a
      // different set of the same size is not.
      followedSignature(ctx.followedIds),
      // Coverage is a ranking input, so it must re-key. Without this,
      // declaring a name leaves the cached page in place and the feed does
      // not move until something unrelated invalidates it.
      coverageSignature(ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX)],
    queryFn: async ({ pageParam = 0 }) => {
      return fetchFeedPage(pageParam, filters, ctx)
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!ctx.userId && !!ctx.organizationId,
    staleTime: 30_000,
  })

  const items = useMemo(() => {
    /**
     * De-duplicated across pages, by id.
     *
     * ── Why pages repeat ──────────────────────────────────────────────────
     *
     * Most sources in this feed paginate. The pair-trade source does not: it
     * selects legs by `created_at` with a fixed limit and groups them, with no
     * offset, so EVERY page returns the same pairs. Reported from a phone as
     * "the same pair trade shows a bunch of times" — and it also explains why
     * the Ideas filter looked like nothing but pair trades. They were being
     * re-added on every page while single ideas advanced properly, so their
     * share of the list grew with every scroll.
     *
     * Deduping here rather than in the pair query because the id is already
     * stable (it is the pair's own id) and because a repeated row from any
     * future source would be the same defect. The first occurrence wins, which
     * preserves the ordering each page decided.
     */
    const pages = query.data?.pages.flatMap(p => p.items) || []
    const seen = new Set<string>()
    const out: ScoredFeedItem[] = []
    for (const item of pages) {
      const id = String(item.id)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(item)
    }
    return out
  }, [query.data])

  return {
    items,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    isError: query.isError,
  }
}
