import { useMemo } from 'react'
import { useContentAggregation } from './useContentAggregation'
import { useRelevanceScoring } from './useRelevanceScoring'
import type { ScoredFeedItem, FeedFilters, ContentAggregationOptions } from './types'

export interface UseUnifiedFeedOptions extends ContentAggregationOptions {
  enableScoring?: boolean
}

export interface UseUnifiedFeedResult {
  items: ScoredFeedItem[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
  hasMore: boolean
}

export function useUnifiedFeed(options: UseUnifiedFeedOptions = {}): UseUnifiedFeedResult {
  const {
    limit = 50,
    offset = 0,
    filters = {},
    enableScoring = true
  } = options

  // Fetch aggregated content
  const {
    data: rawItems = [],
    isLoading: contentLoading,
    error,
    refetch
  } = useContentAggregation({ limit, offset, filters })

  // Apply relevance scoring
  const { scoredItems, isLoading: scoringLoading } = useRelevanceScoring(
    enableScoring ? rawItems : []
  )

  // Use scored items if scoring is enabled, otherwise map raw items
  const items = useMemo((): ScoredFeedItem[] => {
    if (enableScoring && scoredItems.length > 0) {
      return scoredItems
    }

    // Fallback: convert raw items without scoring
    return rawItems.map(item => ({
      ...item,
      score: 0.5,
      scoreBreakdown: {
        recency: 0.5,
        engagement: 0.5,
        authorRelevance: 0.5,
        assetRelevance: 0.5,
        contentQuality: 0.5
      },
      cardSize: 'medium' as const
    }))
  }, [enableScoring, scoredItems, rawItems])

  return {
    items,
    isLoading: contentLoading || (enableScoring && scoringLoading),
    error: error as Error | null,
    refetch,
    hasMore: rawItems.length === limit
  }
}

// Hook for discovery view (masonry grid)
export function useDiscoveryFeed(filters?: FeedFilters) {
  return useUnifiedFeed({
    limit: 50,
    filters,
    enableScoring: true
  })
}

// Hook for full-screen feed view
export function useFullScreenFeed(filters?: FeedFilters) {
  return useUnifiedFeed({
    limit: 20,
    filters,
    enableScoring: true
  })
}
