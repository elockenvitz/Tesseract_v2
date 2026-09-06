// Unified types for the Ideas feed system

export type ItemType = 'quick_thought' | 'trade_idea' | 'pair_trade' | 'note' | 'thesis_update' | 'insight' | 'message'
export type ReactionType = 'like' | 'love' | 'insightful' | 'bearish' | 'bullish' | 'question'
export type Sentiment = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited'
/**
 * All four directions the database actually stores.
 *
 * This was `'buy' | 'sell'` against a `trade_queue_items.action` enum with four
 * values, so every `add` and every `trim` in the feed was read through a type
 * that said it could not exist. Nothing crashed — the rows arrived, the badge
 * fell through its `isBuy` ternary, and an ADD rendered as SELL because it was
 * not the string `'buy'`. A card telling the desk to sell a name whose author
 * asked to add to it is the worst class of quiet defect this surface can have.
 *
 * Buy and sell open or close a position; add and trim resize one already on.
 * See `lib/signals/idea-shape` for why they stay distinct all the way to the
 * badge.
 */
export type TradeAction = 'buy' | 'sell' | 'add' | 'trim'
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
  /**
   * The investment content of the idea, joined as of Mobile Ideas V2.
   *
   * Every one of these already existed on `trade_queue_items` and none of them
   * were selected, so the feed row carried a direction, a paragraph and a
   * timestamp — enough to render a post and not enough to render an investment
   * claim. This is a wider SELECT on rows the feed was already reading; no new
   * query, no new table, no schema change.
   */
  /** How worked-through the idea is. Drives the maturity pill. */
  stage?: string | null
  stage_changed_at?: string | null
  updated_at?: string
  /** The author's own number. Null is common and is a real state. */
  target_price?: number | null
  conviction?: 'low' | 'medium' | 'high' | null
  time_horizon?: 'short' | 'medium' | 'long' | null
  /** The written case, where the author wrote one beyond the rationale. */
  thesis_text?: string | null
  /** Intended sizing. An expectation, not a trade instruction. */
  proposed_weight?: number | null
  proposed_shares?: number | null
  /** Co-analysts who can also move the idea. Team context on the card. */
  assigned_to?: string | null
  collaborators?: string[] | null
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
  /** Per-leg target, where the author set one. Legs carry their own. */
  target_price?: number | null
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

export interface FeedItemScore {
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

/**
 * Must be an intersection, not `interface ScoredFeedItem extends FeedItem`.
 * `FeedItem` is a union, and an interface cannot extend one — TypeScript
 * reported TS2312 and fell back to an empty type, so every downstream
 * `item.type` / `item.id` access failed with "property does not exist".
 *
 * An intersection distributes over the union — `(A | B) & S` becomes
 * `(A & S) | (B & S)` — which keeps each member's fields reachable *and*
 * preserves `type` as a discriminant, so narrowing by `item.type` still works.
 */
export type ScoredFeedItem = FeedItem & FeedItemScore

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
