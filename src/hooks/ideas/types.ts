// Unified types for the Ideas feed system

export type ItemType = 'quick_thought' | 'trade_idea' | 'pair_trade' | 'note' | 'thesis_update' | 'insight' | 'message'
export type ReactionType = 'like' | 'love' | 'insightful' | 'bearish' | 'bullish' | 'question'
export type Sentiment = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited'
export type TradeAction = 'buy' | 'sell'
export type TradeUrgency = 'low' | 'medium' | 'high' | 'urgent'
export type CardSize = 'small' | 'medium' | 'large'

export interface Author {
  id: string
  email?: string
  first_name?: string
  last_name?: string
  full_name?: string
  avatar_url?: string
}

export interface Reaction {
  id: string
  item_id: string
  item_type: ItemType
  user_id: string
  reaction: ReactionType
  created_at: string
}

export interface ReactionCount {
  reaction: ReactionType
  count: number
  hasReacted: boolean
}

export interface Bookmark {
  id: string
  item_id: string
  item_type: ItemType
  user_id: string
  created_at: string
}

export interface BaseIdeaItem {
  id: string
  type: ItemType
  content: string
  created_at: string
  updated_at?: string
  author: Author
  reactions?: Reaction[]
  reactionCounts?: ReactionCount[]
  bookmarked?: boolean
  commentsCount?: number
}

export interface QuickThoughtItem extends BaseIdeaItem {
  type: 'quick_thought'
  sentiment?: Sentiment
  source_url?: string
  source_title?: string
  ticker_mentions?: string[]
  tags?: string[]
  visibility: 'private' | 'team' | 'public'
  is_pinned: boolean
  asset?: {
    id: string
    symbol: string
    company_name: string
  }
}

export interface TradeIdeaItem extends BaseIdeaItem {
  type: 'trade_idea'
  action: TradeAction
  urgency: TradeUrgency
  rationale?: string
  status: string
  pair_id?: string
  sharing_visibility?: 'private' | 'team' | 'public' | null
  asset?: {
    id: string
    symbol: string
    company_name: string
    current_price?: number
  }
  portfolio?: {
    id: string
    name: string
  }
}

export interface PairTradeLeg {
  id: string
  action: TradeAction
  asset: {
    id: string
    symbol: string
    company_name: string
    current_price?: number
  }
}

export interface PairTradeItem extends BaseIdeaItem {
  type: 'pair_trade'
  pair_id: string
  urgency: TradeUrgency
  rationale?: string
  status: string
  sharing_visibility?: 'private' | 'team' | 'public' | null
  long_legs: PairTradeLeg[]
  short_legs: PairTradeLeg[]
  portfolio?: {
    id: string
    name: string
  }
}

export interface NoteItem extends BaseIdeaItem {
  type: 'note'
  title: string
  note_type: 'asset' | 'portfolio' | 'theme' | 'custom' | 'notebook'
  source?: {
    id: string
    name: string
    type: 'asset' | 'portfolio' | 'theme' | 'notebook' | string
  }
  preview: string
}

export interface ThesisUpdateItem extends BaseIdeaItem {
  type: 'thesis_update'
  section: string
  field_name?: string // deprecated, use section
  old_value?: string
  new_value?: string
  change_type: 'created' | 'updated' | 'deleted'
  asset?: {
    id: string
    symbol: string
    company_name: string
  }
}

export interface InsightItem extends BaseIdeaItem {
  type: 'insight'
  insight_type: 'market_insight' | 'research_tip' | 'portfolio_alert' | 'trend_analysis' | 'educational'
  title: string
  tags?: string[]
  related_assets?: string[]
  source: 'ai' | 'user' | 'system'
}

export type FeedItem = QuickThoughtItem | TradeIdeaItem | PairTradeItem | NoteItem | ThesisUpdateItem | InsightItem

export interface ScoredFeedItem extends FeedItem {
  score: number
  scoreBreakdown: {
    recency: number
    engagement: number
    authorRelevance: number
    assetRelevance: number
    contentQuality: number
  }
  cardSize: CardSize
}

export interface FeedFilters {
  types?: ItemType[]
  authors?: string[]
  assets?: string[]
  tags?: string[]
  timeRange?: 'day' | 'week' | 'month' | 'all'
  onlyBookmarked?: boolean
  onlyFollowing?: boolean
}

export interface ContentAggregationOptions {
  limit?: number
  offset?: number
  filters?: FeedFilters
}
