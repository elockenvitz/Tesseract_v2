import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import type { FeedItem, ScoredFeedItem, CardSize, Reaction } from './types'

interface ScoringContext {
  followedAuthors: Set<string>
  watchlistAssets: Set<string>
  portfolioAssets: Set<string>
  reactionsByItem: Map<string, Reaction[]>
}

// Scoring weights (must sum to 1.0)
const WEIGHTS = {
  recency: 0.25,
  engagement: 0.20,
  authorRelevance: 0.20,
  assetRelevance: 0.20,
  contentQuality: 0.15
}

// Time decay constants
const HALF_LIFE_HOURS = 24 // Score halves every 24 hours

export function useRelevanceScoring(items: FeedItem[]) {
  const { user } = useAuth()

  // Fetch context data for scoring
  const { data: scoringContext } = useQuery({
    queryKey: ['scoring-context', user?.id],
    queryFn: async (): Promise<ScoringContext> => {
      const [followsResult, watchlistResult, portfolioHoldingsResult, reactionsResult] = await Promise.all([
        // Get followed authors
        supabase
          .from('author_follows')
          .select('following_id')
          .eq('follower_id', user?.id),

        // Get watchlist assets
        supabase
          .from('watchlist_items')
          .select('asset_id'),

        // Get portfolio holdings
        supabase
          .from('portfolio_holdings')
          .select('asset_id'),

        // Get reactions for all items
        items.length > 0
          ? supabase
              .from('idea_reactions')
              .select('*')
              .in('item_id', items.map(i => i.id))
          : Promise.resolve({ data: [], error: null })
      ])

      const followedAuthors = new Set(
        (followsResult.data || []).map(f => f.following_id)
      )

      const watchlistAssets = new Set(
        (watchlistResult.data || []).map(w => w.asset_id)
      )

      const portfolioAssets = new Set(
        (portfolioHoldingsResult.data || []).map(h => h.asset_id)
      )

      const reactionsByItem = new Map<string, Reaction[]>()
      for (const reaction of (reactionsResult.data || [])) {
        const key = reaction.item_id
        if (!reactionsByItem.has(key)) {
          reactionsByItem.set(key, [])
        }
        reactionsByItem.get(key)!.push(reaction)
      }

      return {
        followedAuthors,
        watchlistAssets,
        portfolioAssets,
        reactionsByItem
      }
    },
    enabled: !!user?.id && items.length > 0,
    staleTime: 60000
  })

  // Score and sort items
  const scoredItems = useMemo((): ScoredFeedItem[] => {
    if (!items.length) return []

    const context: ScoringContext = scoringContext || {
      followedAuthors: new Set(),
      watchlistAssets: new Set(),
      portfolioAssets: new Set(),
      reactionsByItem: new Map()
    }

    const scored = items.map(item => {
      const breakdown = calculateScoreBreakdown(item, context, user?.id)
      const totalScore =
        breakdown.recency * WEIGHTS.recency +
        breakdown.engagement * WEIGHTS.engagement +
        breakdown.authorRelevance * WEIGHTS.authorRelevance +
        breakdown.assetRelevance * WEIGHTS.assetRelevance +
        breakdown.contentQuality * WEIGHTS.contentQuality

      return {
        ...item,
        score: totalScore,
        scoreBreakdown: breakdown,
        cardSize: calculateCardSize(item, breakdown, context),
        reactions: context.reactionsByItem.get(item.id),
        reactionCounts: calculateReactionCounts(
          context.reactionsByItem.get(item.id) || [],
          user?.id
        )
      } as ScoredFeedItem
    })

    // Sort by score descending, with pinned items first for thoughts
    scored.sort((a, b) => {
      // Pinned items first
      if (a.type === 'quick_thought' && b.type === 'quick_thought') {
        const aIsPinned = (a as any).is_pinned
        const bIsPinned = (b as any).is_pinned
        if (aIsPinned && !bIsPinned) return -1
        if (!aIsPinned && bIsPinned) return 1
      }
      return b.score - a.score
    })

    return scored
  }, [items, scoringContext, user?.id])

  return { scoredItems, isLoading: !scoringContext && items.length > 0 }
}

function calculateScoreBreakdown(
  item: FeedItem,
  context: ScoringContext,
  userId?: string
): ScoredFeedItem['scoreBreakdown'] {
  return {
    recency: calculateRecencyScore(item.created_at),
    engagement: calculateEngagementScore(item, context),
    authorRelevance: calculateAuthorRelevanceScore(item, context, userId),
    assetRelevance: calculateAssetRelevanceScore(item, context),
    contentQuality: calculateContentQualityScore(item)
  }
}

function calculateRecencyScore(createdAt: string): number {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
  // Exponential decay with half-life
  return Math.pow(0.5, ageHours / HALF_LIFE_HOURS)
}

function calculateEngagementScore(item: FeedItem, context: ScoringContext): number {
  const reactions = context.reactionsByItem.get(item.id) || []
  const reactionCount = reactions.length
  const commentsCount = item.commentsCount || 0

  // Use logarithmic scaling to prevent runaway scores
  const reactionScore = Math.log10(reactionCount + 1) / 2 // Max ~1.0 at 100 reactions
  const commentScore = Math.log10(commentsCount + 1) / 2

  return Math.min(1, (reactionScore + commentScore) / 2)
}

function calculateAuthorRelevanceScore(
  item: FeedItem,
  context: ScoringContext,
  userId?: string
): number {
  // Own content gets a boost
  if (item.author.id === userId) return 0.8

  // Followed authors get high score
  if (context.followedAuthors.has(item.author.id)) return 1.0

  // Default score for unknown authors
  return 0.3
}

function calculateAssetRelevanceScore(item: FeedItem, context: ScoringContext): number {
  let assetId: string | undefined

  // Extract asset ID based on item type
  if ('asset' in item && item.asset) {
    assetId = item.asset.id
  }

  if (!assetId) return 0.5 // Neutral score for non-asset content

  // Portfolio assets are most relevant
  if (context.portfolioAssets.has(assetId)) return 1.0

  // Watchlist assets are also relevant
  if (context.watchlistAssets.has(assetId)) return 0.8

  return 0.3
}

function calculateContentQualityScore(item: FeedItem): number {
  let score = 0.5 // Base score

  const content = item.content || ''

  // Length score (longer content tends to be more detailed)
  if (content.length > 500) score += 0.2
  else if (content.length > 200) score += 0.1
  else if (content.length < 50) score -= 0.1

  // Type-specific quality indicators
  switch (item.type) {
    case 'quick_thought':
      // Thoughts with sentiment and tags are more structured
      if ((item as any).sentiment) score += 0.1
      if ((item as any).tags?.length > 0) score += 0.1
      if ((item as any).source_url) score += 0.1
      break

    case 'trade_idea':
      // Trade ideas with rationale are more useful
      if ((item as any).rationale?.length > 100) score += 0.2
      // Urgent trades get a boost
      if ((item as any).urgency === 'urgent') score += 0.15
      else if ((item as any).urgency === 'high') score += 0.1
      break

    case 'note':
      // Notes with titles are more organized
      if ((item as any).title?.length > 0) score += 0.1
      break

    case 'thesis_update':
      // Updates with both old and new values show progress
      if ((item as any).old_value && (item as any).new_value) score += 0.15
      break
  }

  return Math.min(1, Math.max(0, score))
}

function calculateCardSize(
  item: FeedItem,
  breakdown: ScoredFeedItem['scoreBreakdown'],
  context: ScoringContext
): CardSize {
  const totalScore =
    breakdown.recency * WEIGHTS.recency +
    breakdown.engagement * WEIGHTS.engagement +
    breakdown.authorRelevance * WEIGHTS.authorRelevance +
    breakdown.assetRelevance * WEIGHTS.assetRelevance +
    breakdown.contentQuality * WEIGHTS.contentQuality

  // High engagement or relevance gets large cards
  if (totalScore > 0.7 || breakdown.engagement > 0.6) return 'large'

  // Medium engagement or good content gets medium cards
  if (totalScore > 0.4 || item.content.length > 300) return 'medium'

  // Everything else is small
  return 'small'
}

function calculateReactionCounts(
  reactions: Reaction[],
  userId?: string
): ScoredFeedItem['reactionCounts'] {
  const counts = new Map<string, { count: number; hasReacted: boolean }>()

  for (const reaction of reactions) {
    if (!counts.has(reaction.reaction)) {
      counts.set(reaction.reaction, { count: 0, hasReacted: false })
    }
    const entry = counts.get(reaction.reaction)!
    entry.count++
    if (reaction.user_id === userId) {
      entry.hasReacted = true
    }
  }

  return Array.from(counts.entries()).map(([reaction, data]) => ({
    reaction: reaction as any,
    count: data.count,
    hasReacted: data.hasReacted
  }))
}
