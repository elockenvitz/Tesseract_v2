/**
 * FeedCard — Variant-based card renderer for the Ideas feed.
 *
 * Vertically compact: why-now and author on same line where possible.
 * Charts always show timeframe selector + expand button.
 */

import React from 'react'
import { clsx } from 'clsx'
import {
  Lightbulb, TrendingUp, TrendingDown, FileText, GitBranch,
  MoreHorizontal, ExternalLink, ChevronRight,
  Zap, ArrowRight,
} from 'lucide-react'
import { formatDistanceToNowStrict, differenceInDays, differenceInHours } from 'date-fns'
import type { ScoredFeedItem, Sentiment } from '../../../hooks/ideas/types'
import { IdeaReactions } from '../social/IdeaReactions'
import { FeedChart, useFeedQuote } from './FeedChart'

// ============================================================
// Config
// ============================================================

const SENTIMENT_ACCENT: Record<string, string> = {
  bullish: 'border-l-emerald-400', bearish: 'border-l-red-400',
  concerned: 'border-l-amber-400', curious: 'border-l-blue-400', excited: 'border-l-purple-400',
}
const SENTIMENT_BADGE: Record<string, { label: string; color: string }> = {
  bullish: { label: 'Bullish', color: 'text-emerald-700 bg-emerald-50' },
  bearish: { label: 'Bearish', color: 'text-red-700 bg-red-50' },
  concerned: { label: 'Concerned', color: 'text-amber-700 bg-amber-50' },
  curious: { label: 'Curious', color: 'text-blue-700 bg-blue-50' },
  excited: { label: 'Excited', color: 'text-purple-700 bg-purple-50' },
}
const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  quick_thought: { label: 'Thought', icon: Lightbulb, color: 'text-amber-600' },
  trade_idea: { label: 'Trade Idea', icon: TrendingUp, color: 'text-emerald-600' },
  pair_trade: { label: 'Pair Trade', icon: TrendingUp, color: 'text-violet-600' },
  note: { label: 'Note', icon: FileText, color: 'text-blue-600' },
  thesis_update: { label: 'Thesis Update', icon: GitBranch, color: 'text-teal-600' },
  insight: { label: 'Insight', icon: Lightbulb, color: 'text-purple-600' },
}

// ============================================================
// Helpers
// ============================================================

function authorName(a: any): string {
  if (a?.first_name || a?.last_name) return [a.first_name, a.last_name].filter(Boolean).join(' ')
  return a?.email?.split('@')[0] || 'Unknown'
}
function authorInitials(a: any): string {
  if (a?.first_name && a?.last_name) return `${a.first_name[0]}${a.last_name[0]}`.toUpperCase()
  return (a?.email?.[0] || '?').toUpperCase()
}
function stripHtml(html: string): string { return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() }
function relativeTime(d: string): string { try { return formatDistanceToNowStrict(new Date(d), { addSuffix: false }) } catch { return '' } }

function generateWhyNow(item: ScoredFeedItem, quote?: any): string {
  const hours = differenceInHours(new Date(), new Date(item.created_at))
  const days = differenceInDays(new Date(), new Date(item.created_at))
  const sentiment = 'sentiment' in item ? (item as any).sentiment : null
  const asset = 'asset' in item ? (item as any).asset : null

  if (quote && asset) {
    const pct = Math.abs(quote.changePercent || 0)
    if (pct > 3) return `${asset.symbol} ${quote.change >= 0 ? 'up' : 'down'} ${pct.toFixed(1)}% today`
    if (pct > 1.5 && hours <= 6) return `Posted as ${asset.symbol} moves ${quote.change >= 0 ? '+' : ''}${pct.toFixed(1)}%`
  }
  if (item.type === 'thesis_update') {
    const section = 'section' in item ? (item as any).section : null
    if (section && asset) return `${section.replace(/_/g, ' ')} thesis updated`
    return 'Thesis view updated'
  }
  if (item.type === 'trade_idea') {
    const u = (item as any).urgency
    if (u === 'urgent') return 'Flagged urgent — immediate review'
    if (u === 'high') return 'High-conviction idea'
    if (asset && hours <= 6) return `New ${(item as any).action} idea on ${asset.symbol}`
    return 'Trade idea submitted'
  }
  if (item.type === 'note') {
    if (asset && hours <= 12) return `New note on ${asset.symbol}`
    return 'Research note'
  }
  if (sentiment === 'bearish' && asset) return `Bearish on ${asset.symbol}`
  if (sentiment === 'bullish' && asset && hours <= 12) return `Bullish on ${asset.symbol}`
  if (sentiment && asset) return `${sentiment.charAt(0).toUpperCase() + sentiment.slice(1)} on ${asset.symbol}`
  if (hours <= 1) return 'Just posted'
  if (hours <= 6 && asset) return `On ${asset.symbol}`
  if (item.score > 0.75) return 'Relevant to your coverage'
  if (asset) return `On ${asset.symbol}`
  return `${days > 0 ? days + 'd' : relativeTime(item.created_at)} ago`
}

// ============================================================
// Variant selection
// ============================================================

type CardVariant = 'chart_post' | 'chart_post_hero' | 'compact_thought' | 'trade_idea' | 'trade_idea_hero' | 'rich_content'

function selectVariant(item: ScoredFeedItem): CardVariant {
  const hasAsset = 'asset' in item && !!(item as any).asset?.symbol
  if (item.type === 'trade_idea') return item.score > 0.7 || (item as any).urgency === 'urgent' || (item as any).urgency === 'high' ? 'trade_idea_hero' : 'trade_idea'
  if (item.type === 'note' || item.type === 'thesis_update') return 'rich_content'
  if (hasAsset) return item.score > 0.7 ? 'chart_post_hero' : 'chart_post'
  return 'compact_thought'
}

// ============================================================
// Props
// ============================================================

interface FeedCardProps {
  item: ScoredFeedItem
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onCardClick?: (item: ScoredFeedItem) => void
  onExpandChart?: (symbol: string) => void
  isSelected?: boolean
}

// ============================================================
// Shared primitives — vertically compact
// ============================================================

/** Combined author + why-now on one line */
function AuthorWhyNowRow({ item, whyNow, onAuthorClick }: { item: ScoredFeedItem; whyNow: string; onAuthorClick?: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={e => { e.stopPropagation(); item.author?.id && onAuthorClick?.(item.author.id) }}
        className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-500 hover:bg-gray-300 transition-colors flex-shrink-0">
        {authorInitials(item.author)}
      </button>
      <span className="text-[12px] font-medium text-gray-600">{authorName(item.author)}</span>
      <span className="text-[10px] text-gray-300">{relativeTime(item.created_at)}</span>
      <span className="text-gray-200">·</span>
      <span className="text-[10px] font-medium text-amber-600 flex items-center gap-1">
        <Zap className="w-2.5 h-2.5" />
        {whyNow}
      </span>
    </div>
  )
}

function EngagementRow({ item }: { item: ScoredFeedItem }) {
  const total = item.reactionCounts?.reduce((s, r) => s + r.count, 0) || 0
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <IdeaReactions itemId={item.id} itemType={item.type} compact />
        {total > 0 && <span className="text-[10px] text-gray-400">{total}</span>}
      </div>
      <button onClick={e => e.stopPropagation()} className="p-1 text-gray-300 hover:text-gray-500 hover:bg-gray-100 rounded transition-colors opacity-0 group-hover:opacity-100">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function MetricRow({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const { data: quote } = useFeedQuote(symbol)
  if (!quote) return null
  const pct = quote.changePercent
  const isUp = pct >= 0
  return (
    <div className={clsx('flex items-baseline gap-2 tabular-nums', compact ? 'text-[11px]' : 'text-[13px]')}>
      <span className="font-bold text-gray-900">${quote.price.toFixed(2)}</span>
      <span className={clsx('font-bold', isUp ? 'text-emerald-600' : 'text-red-500')}>
        {isUp ? '+' : ''}{pct.toFixed(1)}%
      </span>
      {quote.volume && !compact && <span className="text-[10px] text-gray-400 ml-1">Vol {(quote.volume / 1e6).toFixed(1)}M</span>}
    </div>
  )
}

// ============================================================
// ChartPostCard
// ============================================================

function ChartPostCard({ item, onAuthorClick, onAssetClick, onCardClick, onExpandChart, isSelected, hero = false }: FeedCardProps & { hero?: boolean }) {
  const asset = 'asset' in item ? (item as any).asset : null
  const sentiment = 'sentiment' in item ? (item as any).sentiment : undefined
  const sentimentBadge = sentiment ? SENTIMENT_BADGE[sentiment] : undefined
  const { data: quote } = useFeedQuote(asset?.symbol)
  const content = stripHtml(item.content || '')
  const truncated = content.length > 280 ? content.slice(0, 280) + '...' : content
  const whyNow = generateWhyNow(item, quote)

  return (
    <div onClick={() => onCardClick?.(item)} className={clsx(
      'rounded-xl overflow-hidden transition-all cursor-pointer group',
      hero ? 'bg-white shadow-sm hover:shadow-lg' : 'bg-white border border-gray-150 hover:shadow-md',
      isSelected && 'ring-2 ring-primary-300 shadow-lg',
    )}>
      {/* Ticker + metrics — single compact row */}
      {asset && (
        <div className="px-4 pt-2.5 pb-0.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={e => { e.stopPropagation(); onAssetClick?.(asset.id, asset.symbol) }}
              className={clsx('font-bold text-gray-900 hover:text-primary-700 tracking-tight', hero ? 'text-[15px]' : 'text-[14px]')}>
              {asset.symbol}
            </button>
            <span className="text-[10px] text-gray-400">{asset.company_name}</span>
            {sentimentBadge && <span className={clsx('text-[9px] font-semibold px-1.5 py-0.5 rounded-full', sentimentBadge.color)}>{sentimentBadge.label}</span>}
          </div>
          <MetricRow symbol={asset.symbol} />
        </div>
      )}

      {/* Chart with timeframes + expand */}
      {asset?.symbol && <FeedChart symbol={asset.symbol} height={hero ? 220 : 180} defaultTimeframe="3M" onExpand={onExpandChart} />}

      {/* Author + why-now + commentary — compact */}
      <div className="px-4 pt-1.5 pb-0.5">
        <AuthorWhyNowRow item={item} whyNow={whyNow} onAuthorClick={onAuthorClick} />
      </div>
      <div className="px-4 pb-2">
        <p className="text-[13px] text-gray-700 leading-relaxed">{truncated}</p>
        {content.length > 280 && (
          <button onClick={e => { e.stopPropagation(); onCardClick?.(item) }} className="text-[12px] font-medium text-primary-600 hover:text-primary-700 mt-0.5 inline-flex items-center gap-0.5">
            More <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {'source_url' in item && (item as any).source_url && (
        <div className="px-4 pb-1.5">
          <a href={(item as any).source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-primary-600"><ExternalLink className="w-3 h-3" />{(item as any).source_title || 'Source'}</a>
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-gray-100"><EngagementRow item={item} /></div>
    </div>
  )
}

// ============================================================
// CompactThoughtCard
// ============================================================

function CompactThoughtCard({ item, onAuthorClick, onAssetClick, onCardClick, isSelected }: FeedCardProps) {
  const sentiment = 'sentiment' in item ? (item as any).sentiment : undefined
  const sentimentAccent = sentiment ? SENTIMENT_ACCENT[sentiment] : undefined
  const sentimentBadge = sentiment ? SENTIMENT_BADGE[sentiment] : undefined
  const asset = 'asset' in item ? (item as any).asset : null
  const content = stripHtml(item.content || '')

  return (
    <div onClick={() => onCardClick?.(item)} className={clsx(
      'transition-all cursor-pointer group',
      sentimentAccent ? `border-l-[3px] ${sentimentAccent} bg-white rounded-r-lg pl-3.5 pr-4 py-2.5` : 'bg-transparent hover:bg-white rounded-lg px-4 py-2.5 hover:shadow-sm',
      isSelected && 'bg-white shadow-md ring-1 ring-primary-200',
    )}>
      <div className="flex items-center gap-2 mb-1.5">
        <button onClick={e => { e.stopPropagation(); item.author?.id && onAuthorClick?.(item.author.id) }}
          className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-500 hover:bg-gray-300 transition-colors flex-shrink-0">
          {authorInitials(item.author)}
        </button>
        <span className="text-[12px] font-medium text-gray-600">{authorName(item.author)}</span>
        <span className="text-[10px] text-gray-300">{relativeTime(item.created_at)}</span>
        {asset && (
          <button onClick={e => { e.stopPropagation(); onAssetClick?.(asset.id, asset.symbol) }}
            className="text-[11px] font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 px-1.5 py-0.5 rounded transition-colors ml-auto">${asset.symbol}</button>
        )}
        {sentimentBadge && <span className={clsx('text-[9px] font-medium px-1.5 py-0.5 rounded', sentimentBadge.color)}>{sentimentBadge.label}</span>}
      </div>
      <p className="text-[13px] text-gray-800 leading-relaxed">{content}</p>
      <div className="mt-1.5"><EngagementRow item={item} /></div>
    </div>
  )
}

// ============================================================
// TradeIdeaFeedCard
// ============================================================

function TradeIdeaFeedCard({ item, onAuthorClick, onAssetClick, onCardClick, onExpandChart, isSelected, hero = false }: FeedCardProps & { hero?: boolean }) {
  const tradeAction = (item as any).action as string
  const tradeUrgency = (item as any).urgency as string
  const asset = 'asset' in item ? (item as any).asset : null
  const portfolio = 'portfolio' in item ? (item as any).portfolio : null
  const { data: quote } = useFeedQuote(asset?.symbol)
  const content = stripHtml(item.content || '')
  const isBuy = tradeAction === 'buy'
  const whyNow = generateWhyNow(item, quote)

  return (
    <div onClick={() => onCardClick?.(item)} className={clsx(
      'rounded-xl overflow-hidden transition-all cursor-pointer group',
      hero ? 'shadow-md hover:shadow-xl' : 'border border-gray-200 hover:shadow-md',
      isSelected && 'ring-2 ring-primary-300 shadow-lg',
    )}>
      {/* Stance row */}
      <div className={clsx('px-4 py-2 flex items-center justify-between', isBuy ? 'bg-emerald-600' : 'bg-red-600')}>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-black uppercase tracking-wider text-white">{tradeAction}</span>
          <ArrowRight className="w-3 h-3 text-white/50" />
          {asset && <span className="text-[15px] font-black text-white tracking-tight">{asset.symbol}</span>}
          {asset?.company_name && <span className="text-[10px] text-white/60 hidden sm:inline">{asset.company_name}</span>}
        </div>
        <div className="flex items-center gap-2">
          {tradeUrgency && tradeUrgency !== 'low' && (
            <span className={clsx('text-[9px] font-bold uppercase px-2 py-0.5 rounded-full',
              tradeUrgency === 'urgent' ? 'bg-white text-red-700' : 'bg-white/20 text-white')}>{tradeUrgency}</span>
          )}
        </div>
      </div>

      <div className="bg-white">
        {/* Metrics + portfolio — single row */}
        {asset?.symbol && (
          <div className="px-4 pt-2 pb-0.5 flex items-center justify-between">
            <MetricRow symbol={asset.symbol} />
            {portfolio && <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded">{portfolio.name}</span>}
          </div>
        )}

        {/* Chart with controls */}
        {asset?.symbol && <FeedChart symbol={asset.symbol} height={hero ? 200 : 160} defaultTimeframe="3M" onExpand={onExpandChart} />}

        {/* Author + why-now + rationale — compact */}
        <div className="px-4 pt-1.5 pb-0.5">
          <AuthorWhyNowRow item={item} whyNow={whyNow} onAuthorClick={onAuthorClick} />
        </div>
        {content && (
          <div className="px-4 pb-2">
            <p className="text-[13px] text-gray-700 leading-relaxed">{content.length > 300 ? content.slice(0, 300) + '...' : content}</p>
          </div>
        )}

        <div className="px-4 py-1.5 border-t border-gray-100"><EngagementRow item={item} /></div>
      </div>
    </div>
  )
}

// ============================================================
// RichContentCard
// ============================================================

function RichContentCard({ item, onAuthorClick, onAssetClick, onCardClick, onExpandChart, isSelected }: FeedCardProps) {
  const typeCfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.note
  const TypeIcon = typeCfg.icon
  const asset = 'asset' in item ? (item as any).asset : null
  const noteTitle = 'title' in item ? (item as any).title : null
  const thesisSection = 'section' in item ? (item as any).section : null
  const content = stripHtml(item.content || '')
  const truncated = content.length > 400 ? content.slice(0, 400) + '...' : content
  const { data: quote } = useFeedQuote(asset?.symbol)
  const whyNow = generateWhyNow(item, quote)
  const isThesis = item.type === 'thesis_update'

  return (
    <div onClick={() => onCardClick?.(item)} className={clsx(
      'rounded-xl overflow-hidden transition-all cursor-pointer group border',
      isSelected ? 'border-primary-300 shadow-lg ring-1 ring-primary-200' : 'border-gray-200 hover:shadow-md',
    )}>
      {/* Header — type + asset + title on minimal lines */}
      <div className={clsx('px-4 pt-2.5 pb-2 border-b', isThesis ? 'bg-teal-50/40 border-teal-100' : 'bg-slate-50/50 border-slate-100')}>
        <div className="flex items-center gap-2 mb-0.5">
          <TypeIcon className={clsx('w-3 h-3', typeCfg.color)} />
          <span className={clsx('text-[10px] font-bold uppercase tracking-wide', typeCfg.color)}>{typeCfg.label}</span>
          {asset && <button onClick={e => { e.stopPropagation(); onAssetClick?.(asset.id, asset.symbol) }}
            className="text-[13px] font-bold text-gray-900 hover:text-primary-700">{asset.symbol}</button>}
          {thesisSection && <span className="text-[9px] text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded-full font-medium capitalize">{thesisSection.replace(/_/g, ' ')}</span>}
          <span className="text-[10px] text-gray-400 ml-auto">{relativeTime(item.created_at)}</span>
        </div>
        {noteTitle && <h3 className="text-[14px] font-semibold text-gray-900 leading-snug">{noteTitle}</h3>}
      </div>

      <div className="bg-white">
        {asset?.symbol && <FeedChart symbol={asset.symbol} height={140} defaultTimeframe="3M" onExpand={onExpandChart} className="pt-1" />}

        {/* Author + why-now + content — compact */}
        <div className="px-4 pt-1.5 pb-0.5">
          <AuthorWhyNowRow item={item} whyNow={whyNow} onAuthorClick={onAuthorClick} />
        </div>
        <div className="px-4 pb-2">
          <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">{truncated}</p>
          {content.length > 400 && <button onClick={e => { e.stopPropagation(); onCardClick?.(item) }} className="text-[12px] font-medium text-primary-600 mt-0.5">More <ChevronRight className="w-3 h-3 inline" /></button>}
        </div>

        <div className="px-4 py-1.5 border-t border-gray-100"><EngagementRow item={item} /></div>
      </div>
    </div>
  )
}

// ============================================================
// Main dispatcher
// ============================================================

export const FeedCard = React.memo(function FeedCard(props: FeedCardProps) {
  const variant = selectVariant(props.item)
  switch (variant) {
    case 'chart_post_hero': return <ChartPostCard {...props} hero />
    case 'chart_post': return <ChartPostCard {...props} />
    case 'compact_thought': return <CompactThoughtCard {...props} />
    case 'trade_idea_hero': return <TradeIdeaFeedCard {...props} hero />
    case 'trade_idea': return <TradeIdeaFeedCard {...props} />
    case 'rich_content': return <RichContentCard {...props} />
    default: return <CompactThoughtCard {...props} />
  }
})
