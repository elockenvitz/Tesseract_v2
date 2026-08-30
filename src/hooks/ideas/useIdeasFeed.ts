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
  coverageSignature,
  retrievalAssetIdsFor,
  EMPTY_COVERAGE_INDEX,
  type CoverageIndex,
} from '../../lib/signals/coverage-relevance'
import { rankIdeaCandidates, type IdeaRankContext } from '../../lib/ideas/idea-priority'
import type { Priority } from '../../lib/signals/feed-priority'
import {
  COVERAGE_DAYS_BACK,
  RECENT_WINDOW,
  fetchSourceCandidates,
  mergeCandidatePools,
} from '../../lib/ideas/candidate-pools'
import {
  dispositionSignature,
  eligibleFeedItems,
} from '../../lib/ideas/feed-suppression'
import type { DispositionMap } from '../../lib/signals/dispositions'
import { useDispositions } from './useDispositions'
import { useCoverageIndex } from '../../contexts/CoverageRelevanceContext'
import { useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { subDays } from 'date-fns'
import type { FeedItem, ScoredFeedItem, ItemType, Author } from './types'
import {
  OPEN_PROPOSAL_STATUSES, pairIsOpen, pairLegWindow, pairPageSlice, proposalWindowDays,
} from '../../lib/ideas/open-proposal'

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
  /** The page desktop renders: ranked, spaced, sliced. */
  items: ScoredFeedItem[]
  /**
   * Every eligible candidate this page retrieved, ranked and NOT sliced.
   *
   * Mobile reads this. It used to read `items`, which meant it received
   * whatever survived desktop's diversity pass and a 15-row cut — so desktop's
   * presentation decisions silently decided mobile's candidate set, and a card
   * mobile would have led with could be absent because desktop had spaced it
   * out. Both shells now start from the same ranked pool and differ only in
   * what they do with it.
   *
   * No extra query: this is the set `items` is sliced from.
   */
  candidates: ScoredFeedItem[]
  nextCursor: number | null
}

// ============================================================
// Constants
// ============================================================

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

  /**
   * What this reader has already dealt with — the same store mobile reads.
   *
   * Synchronous and local, so it costs no round trip and adds no request to
   * the budget in docs/tickets/ideas-candidate-retrieval.md. The hook exists
   * for the invalidation, not the read: see `useDispositions`.
   */
  const dispositions = useDispositions(user?.id)

  return {
    userId: user?.id || null,
    organizationId: currentOrgId,
    followedIds: followedQuery.data || [],
    heldAssetIds: holdingsQuery.data || new Set<string>(),
    dispositions,
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
  /**
   * The reader's stored answers, for suppression. Optional and neutral when
   * absent, for the same reason `coverageIndex` is: a context assembled
   * without it — a test, an older caller — must show everything rather than
   * hide everything. See `eligibleFeedItems` on failing open.
   */
  dispositions?: DispositionMap
}

/**
 * The reader, in the shape the canonical ranker takes.
 *
 * A projection rather than a second context object: `FeedScoringContext` is
 * what this hook assembles and what its callers already pass, and giving the
 * ranker its own narrower type keeps a Supabase-shaped object out of
 * `lib/ideas`.
 */
export function rankContextFor(ctx: FeedScoringContext): IdeaRankContext {
  return {
    userId: ctx.userId,
    followedIds: ctx.followedIds,
    coverageIndex: ctx.coverageIndex,
    // Suppression already ran, upstream of scoring — see `fetchFeedPage`.
    // Passing it again would be harmless and misleading: it would suggest the
    // ranker is where eligibility is decided.
    dispositions: undefined,
  }
}

// ============================================================
// Score a single feed item
// ============================================================

/**
 * The canonical priority, projected onto the shape desktop's UI already reads.
 *
 * ── What happened to the desktop scorer ───────────────────────────────────
 *
 * `scoreFeedItem` is gone. Its six components were audited one at a time and
 * each was moved, merged or dropped on its own merits — see
 * docs/tickets/ideas-ranking-divergence.md for the disposition table. In short:
 *
 *   freshness        merged   `recencyBoost`, plus the open-proposal floor,
 *                             which was desktop's own finding and the best
 *                             thing in the old scorer
 *   authorRelevance  moved    now `authorRelation` + AUTHOR_BONUS, at a fifth
 *                             of its former 0.2 authority
 *   assetRelevance   merged   `scopeWeightFor` — it was a second projection of
 *                             a fact the canonical model already had
 *   coverageBonus    merged   one SCOPE_BONUS instead of desktop's 0.12 and
 *                             mobile's 0.10 applied in sequence
 *   engagement       moved    ENGAGEMENT_BONUS, a fifth of its former weight
 *   contentQuality   dropped  see below
 *
 * `contentQuality` is the only outright deletion. It scored length (>200 chars
 * 0.4, >50 chars 0.2), having an asset (0.3) and having a sentiment (0.2) for
 * 0.15 of the total — which rewards verbosity, structure and form-filling
 * rather than importance, and would rank a padded note above a one-line
 * observation that changes a position. The genuine part of it already exists
 * and is a GATE, not a weight: `isQualityContent` in `builders/ideas` keeps
 * empty posts out of the feed entirely. A card that is worth showing at all
 * should not then be ranked on its character count.
 *
 * `scoreBreakdown` is preserved on the returned shape because it is part of
 * `ScoredFeedItem`, which the card components type against. It now reports the
 * canonical components rather than the old scorer's.
 */
function scoreFeedItem(item: FeedItem, priority: Priority): ScoredFeedItem {
  const c = priority.components
  return {
    ...item,
    score: priority.total,
    scoreBreakdown: {
      recency: c.recency,
      engagement: c.engagement,
      authorRelevance: c.author,
      assetRelevance: c.ownership + c.coverage,
      contentQuality: 0,
    },
    cardSize: 'medium' as const,
    // Carried so a surface can show a tier badge or answer "why am I seeing
    // this?" without ranking anything again. Nothing renders it yet.
    priority,
  }
}

// ============================================================
// Apply diversity controls
// ============================================================

/** Exported for tests only — the behaviour here is worth pinning directly. */
export const applyDiversityForTest = (items: ScoredFeedItem[]) => applyDiversity(items)

/**
 * Exported for tests only — rank a candidate set exactly as a page does.
 *
 * Replaces `scoreFeedItemForTest`, which scored one row in isolation. The
 * canonical ranker drops suppressed rows and sorts by tier before score, so a
 * single-row scorer can no longer express what the pipeline does.
 */
export const rankCandidatesForTest = (
  items: FeedItem[],
  ctx: FeedScoringContext,
  now: number = Date.now(),
) => rankIdeaCandidates(items, rankContextFor(ctx), now)

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
// Retrieve candidates
// ============================================================

/**
 * How a source reports a query it could not run.
 *
 * A failed query is not an empty one — see the note on the contributions
 * source, where discarding an error made every single-name trade idea vanish
 * with nothing in the console. One reporter for every source, so the next one
 * cannot be added without it.
 */
const reportSourceError = (pool: 'recent' | 'relevance', error: unknown) => {
  console.warn(
    pool === 'relevance'
      ? '[feed] coverage candidate query failed'
      : '[feed] source query failed',
    error,
  )
}

/**
 * Every row both shells may consider for this page, before anything ranks them.
 *
 * The retrieval half of what `useIdeasFeed` does, named and separated from the
 * ranking half so it can improve on its own. It is not yet a public seam —
 * mobile still reaches this through `fetchFeedPage`'s ranked, sliced output,
 * which is the divergence the ranking-unification pass has to close — but the
 * boundary now exists where that pass will need it.
 */
interface CandidateSet {
  items: FeedItem[]
  /** The rolling window this page reached, for the caller's `hasMore` rule. */
  windowDays: number
}

async function fetchIdeaCandidates(
  offset: number,
  filters: IdeasFeedFilters,
  ctx: FeedScoringContext,
): Promise<CandidateSet> {
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
  /**
   * The relevance pool reaches past the rolling window, on purpose.
   *
   * Same argument `proposalStart` already makes: what makes the row a candidate
   * is the reader's responsibility for the name, which has nothing to do with
   * how far they have scrolled. An explicit `timeRange` from the reader still
   * wins — somebody who asks for the last week means it — so this narrows to
   * the scrolled window whenever one was chosen.
   */
  const coverageStart = subDays(
    new Date(),
    filters.timeRange && filters.timeRange !== 'all' ? expandedDays : COVERAGE_DAYS_BACK,
  ).toISOString()

  /**
   * The assets worth a second, relevance-ordered look — `direct` and
   * `assigned` only, never `held`. One projection of the one coverage index;
   * see `retrievalAssetIdsFor`.
   *
   * Empty for a reader who has declared nothing (which is nearly everyone
   * today) and empty when the reader has already filtered to a single asset,
   * where a second query over that same asset could only return rows the first
   * one already has. Empty means the pool is never queried at all.
   */
  const coveredAssetIds = filters.assetId
    ? []
    : retrievalAssetIdsFor(ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX)

  const wantTypes = filters.types && filters.types.length > 0 ? filters.types : null

  const queries: Promise<FeedItem[]>[] = []

  // Quick thoughts — strictly scoped to current org. quick_thoughts now
  // carries organization_id (migration 20260605120000); the BEFORE INSERT
  // trigger stamps it from users.current_organization_id, so a thought
  // posted in Org A no longer appears on the Ideas feed in Org B.
  if (!wantTypes || wantTypes.includes('quick_thought')) {
    queries.push((async () => {
      const data = await fetchSourceCandidates({
        recentSince: timeStart,
        coverageSince: coverageStart,
        offset,
        pageSize: PAGE_SIZE,
        coveredAssetIds,
        onError: reportSourceError,
        build: () => {
          let q = supabase
            .from('quick_thoughts')
            .select('id, content, created_at, updated_at, sentiment, visibility, is_pinned, tags, asset_id, created_by, source_url, source_title, assets:asset_id(id, symbol, company_name)')
            .eq('is_archived', false)
            .eq('organization_id', ctx.organizationId!)
            .order('created_at', { ascending: false })
            // A total order. `created_at` alone left rows sharing a timestamp
            // in an order Postgres chose, which also made it undefined WHICH
            // of them fell inside the range.
            .order('id', { ascending: true })

          if (filters.mode === 'following' && ctx.followedIds.length > 0) {
            q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
          }
          if (filters.assetId) q = q.eq('asset_id', filters.assetId)
          return q
        },
      })
      if (!data.length) return []

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
      const data = await fetchSourceCandidates({
        // Proposals are bounded by their status, not by their age. See
        // PROPOSAL_DAYS_BACK — the rolling window left 1 of 23 visible. Both
        // pools already agree here; passing it twice keeps the helper's
        // contract uniform rather than special-casing this source.
        recentSince: proposalStart,
        coverageSince: proposalStart,
        offset,
        pageSize: PAGE_SIZE,
        coveredAssetIds,
        onError: reportSourceError,
        build: () => {
          let q = supabase
            .from('trade_queue_items')
            .select('id, action, urgency, rationale, status, created_at, created_by, asset_id, portfolio_id, pair_id, pair_trade_id, sharing_visibility, assets:asset_id(id, symbol, company_name, current_price), portfolios:portfolio_id(id, name)')
            // Every open proposal, not only untouched ones. See `open-proposal`:
            // this used to be `status = 'idea'` while the pair source filtered on
            // nothing, and that asymmetry is what made the Ideas filter look like
            // a list of pair trades.
            .in('status', OPEN_PROPOSAL_STATUSES)
            .eq('visibility_tier', 'active')
            .eq('organization_id', ctx.organizationId!)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })

          if (filters.mode === 'following' && ctx.followedIds.length > 0) {
            q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
          }
          if (filters.assetId) q = q.eq('asset_id', filters.assetId)
          if (filters.portfolioId) q = q.eq('portfolio_id', filters.portfolioId)
          return q
        },
      })
      if (!data.length) return []

      const authorIds = [...new Set((data as any[]).map(d => d.created_by).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      // Exclude pair legs on either linking column — a leg that slipped
      // through would render as a standalone idea alongside its own pair.
      return (data as any[]).filter(d => !d.pair_id && !d.pair_trade_id).map(d => ({
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
        .select('id, action, urgency, rationale, status, created_at, created_by, asset_id, portfolio_id, pair_id, pair_trade_id, pair_leg_type, assets:asset_id(id, symbol, company_name, current_price), portfolios:portfolio_id(id, name)')
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
        // A total order, so which legs fall inside the window below — and
        // therefore which pairs group — stops depending on how Postgres broke
        // a timestamp tie. This source keeps its growing-window strategy
        // otherwise: grouping has to happen before slicing, so it cannot use
        // the two-pool retrieval the other sources do. See
        // docs/tickets/ideas-candidate-retrieval.md.
        .order('id', { ascending: true })
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
      const ordered = [...byPair.entries()].filter(([, ls]) => pairIsOpen(ls.map(l => l.status)))
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
        const toLeg = (l: any) => ({ id: l.id, action: l.action, asset: l.assets })
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
      const data = await fetchSourceCandidates({
        recentSince: timeStart,
        coverageSince: coverageStart,
        offset,
        pageSize: PAGE_SIZE,
        coveredAssetIds,
        onError: reportSourceError,
        build: () => {
          let q = supabase
            .from('asset_notes')
            .select('id, title, content, created_at, user_id, asset_id, assets:asset_id(id, symbol, company_name)')
            .eq('organization_id', ctx.organizationId!)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })

          if (filters.mode === 'following' && ctx.followedIds.length > 0) {
            q = q.in('user_id', [...ctx.followedIds, ctx.userId || ''])
          }
          if (filters.assetId) q = q.eq('asset_id', filters.assetId)
          return q
        },
      })
      if (!data.length) return []

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
       *
       * `fetchSourceCandidates` now owns that logging for every source that
       * goes through it, which is the point of there being one helper.
       */
      const data = await fetchSourceCandidates({
        recentSince: timeStart,
        coverageSince: coverageStart,
        offset,
        pageSize: PAGE_SIZE,
        coveredAssetIds,
        onError: reportSourceError,
        build: () => {
          let q = supabase
            .from('asset_contributions')
            .select('id, section, content, created_at, created_by, asset_id, assets:asset_id(id, symbol, company_name)')
            .eq('organization_id', ctx.organizationId!)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })

          if (filters.mode === 'following' && ctx.followedIds.length > 0) {
            q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
          }
          if (filters.assetId) q = q.eq('asset_id', filters.assetId)
          return q
        },
      })
      if (!data.length) return []

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

  /**
   * One candidate set, deduplicated across sources as well as within them.
   *
   * Within a source, `fetchSourceCandidates` has already merged its two pools.
   * Across sources this matters for `trade_queue_items`, which is read twice —
   * once for single ideas and once for pair legs — and the id filters there
   * are complementary rather than provably disjoint.
   */
  const allItems = mergeCandidatePools<FeedItem>(results, item => String(item.id))

  return { items: allItems, windowDays: expandedDays }
}

// ============================================================
// Rank a page of feed items
// ============================================================

async function fetchFeedPage(
  offset: number,
  filters: IdeasFeedFilters,
  ctx: FeedScoringContext,
): Promise<FeedPage> {
  const { items: allItems, windowDays: expandedDays } = await fetchIdeaCandidates(offset, filters, ctx)
  const now = Date.now()

  /**
   * What the reader has already dealt with, removed before anything ranks.
   *
   * ── Why here and not after scoring ────────────────────────────────────────
   *
   * Desktop ran no suppression at all until now, so a card settled, snoozed or
   * dismissed on a phone came back on the laptop. The policy that decides it is
   * `suppressionFor` — the same one `priorityFor` calls — reached through
   * `eligibleFeedItems`, so the two shells cannot answer this differently.
   *
   * The position in the pipeline is load-bearing twice over. A suppressed row
   * must not consume a diversity slot, or a hidden card pushes a visible one
   * off the page to space something nobody can see. And coverage must not
   * resurrect a dismissed card: the coverage bonus is additive and deliberately
   * large enough to move a card up a page, so if suppression were a filter over
   * an already-coverage-ranked list the two features would be arguing.
   * Evaluating eligibility first means they never meet.
   */
  const eligible = eligibleFeedItems(allItems, ctx.dispositions ?? {}, now)

  /**
   * One ranking, for both shells.
   *
   * `rankIdeaCandidates` computes tier, score and reasons and returns a total
   * order — `compareRanked`, which was always the mobile sort and is now the
   * only one. Desktop's `b.score - a.score` had no tie-break at all, so equal
   * cards could swap between renders.
   *
   * `latest` is the one mode that overrides it, and deliberately: a reader who
   * asks for the newest thing is asking for a SORT, not for a different opinion
   * about importance. Ranking still runs, so tier and reasons are available to
   * the cards; only the order is replaced.
   */
  const ranked = rankIdeaCandidates(eligible, rankContextFor(ctx), now)
  const ordered = filters.mode === 'latest'
    ? [...ranked].sort((a, b) => {
        const at = new Date(a.item.created_at).getTime()
        const bt = new Date(b.item.created_at).getTime()
        return bt - at || (String(a.item.id) < String(b.item.id) ? -1 : 1)
      })
    : ranked

  const scored = ordered.map(r => scoreFeedItem(r.item, r.priority))

  /**
   * Diversity is a PRESENTATION transform, applied after ranking and never
   * folded into it — see the ticket. Desktop spaces a dense column; mobile
   * spaces an immersive one, with different rules, from this same ranked set.
   */
  const diverse = applyDiversity(scored)

  // Paginate
  const pageItems = diverse.slice(0, PAGE_SIZE)
  const hasHumanContent = allItems.length >= RECENT_WINDOW

  // If human content is running thin, generate system insights to keep the feed going
  if (pageItems.length < PAGE_SIZE && ctx.heldAssetIds.size > 0) {
    /**
     * Suppressed the same way, though they never entered the candidate set.
     *
     * These are synthesised after the slice, so the filter above cannot see
     * them — but mobile ranks them through the same `case 'idea'` branch as
     * every other post, which means a reader CAN dismiss one, and a dismissal
     * that works on one shell and not the other is the divergence this phase
     * exists to remove. Their ids are stable per slot (`discovery-{offset}-{i}`),
     * so the answer lands somewhere that means the same thing next time.
     */
    const systemItems = eligibleFeedItems(
      generateDiscoveryItems(offset, PAGE_SIZE - pageItems.length),
      ctx.dispositions ?? {},
      now,
    )
    pageItems.push(...systemItems)
  }

  // Keep pagination alive: only stop at hard limit with no time window left to expand
  const hasMore = hasHumanContent || expandedDays < MAX_DAYS_BACK || pageItems.length >= PAGE_SIZE

  return {
    items: pageItems,
    // Ranked, unsliced, un-spaced. What mobile pools from.
    candidates: scored,
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
      coverageSignature(ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX),
      /**
       * Suppression is decided inside `fetchFeedPage`, so an answer recorded
       * anywhere has to re-key or the cached page keeps showing a card the
       * reader has dismissed until something unrelated invalidates it. Same
       * mechanism as coverage above, and deliberately clock-independent: the
       * signature moves when the STORE moves, never on its own, so an expired
       * snooze returns at the next evaluation rather than through a timer.
       */
      dispositionSignature(ctx.dispositions ?? {})],
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

  /**
   * Every ranked candidate, before desktop spaced or sliced anything.
   *
   * ── Why this exists ───────────────────────────────────────────────────────
   *
   * Mobile used to read `items`. That is the desktop PAGE — post-diversity,
   * cut to fifteen — so desktop's presentation silently decided what mobile
   * was allowed to consider, and a card mobile would have led with could be
   * missing because desktop had spaced it out to avoid three posts from one
   * author. Two shells, one of them ranking the other's leftovers.
   *
   * Deduped across pages on the same first-occurrence-wins rule as `items`, so
   * scrolling accumulates candidates rather than repeating them. No extra
   * query: this is the set each page's `items` was sliced from.
   */
  const candidates = useMemo(() => {
    const pages = query.data?.pages.flatMap(p => p.candidates) || []
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

  /**
   * The reader context the ranking used, exposed so a second shell cannot
   * assemble a different one.
   *
   * Mobile needs `followedIds` and the coverage index to rank its pooled feed.
   * Querying them again there would be a second source of truth for "who does
   * this reader follow" and one more round trip; reading them from the hook
   * that already has them is neither.
   */
  const rankContext = useMemo<IdeaRankContext>(
    () => rankContextFor(ctx),
    [ctx.userId, ctx.followedIds, ctx.coverageIndex],
  )

  return {
    items,
    candidates,
    rankContext,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    isError: query.isError,
  }
}
