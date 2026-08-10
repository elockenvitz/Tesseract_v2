import { clsx } from 'clsx'
import { ArrowUpRight, Newspaper, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { FeedTileHeader } from './FeedTileHeader'
import { FeedTileTitle } from './FeedTileTitle'
import { ExpandableText } from './ExpandableText'
import type { MarketNewsItem } from '../../hooks/useMarketNews'

interface NewsFeedTileProps {
  item: MarketNewsItem
  /** Resolves a symbol to an asset in the book, when we cover it. */
  assetForSymbol?: (symbol: string) => { id: string; symbol: string } | null
  onAssetClick?: (assetId: string, symbol: string) => void
  onCapture?: () => void
}

const SENTIMENT = {
  positive: { icon: TrendingUp, label: 'Positive', chip: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' },
  negative: { icon: TrendingDown, label: 'Negative', chip: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800' },
  neutral:  { icon: Minus, label: 'Neutral', chip: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700' },
} as const

/**
 * A news story in the feed's shape: header band, chart, body, action row.
 *
 * News earns a place here only when it is about a name in the book — the
 * chart underneath is what turns a headline into something you can act on,
 * because "what happened" and "what the price did about it" are the same
 * question. Stories about symbols we do not cover still render, without the
 * chart and without an asset action.
 *
 * The sentiment chip only appears when a provider actually supplied one
 * (Alpha Vantage does; Finnhub and Yahoo do not). Inferring it here from the
 * headline would be a guess dressed as data on a screen where every other
 * number is real.
 */
export function NewsFeedTile({ item, assetForSymbol, onAssetClick, onCapture }: NewsFeedTileProps) {
  const covered = item.symbols.map(s => assetForSymbol?.(s) ?? null).find(Boolean) ?? null
  const sentiment = item.sentiment ? SENTIMENT[item.sentiment] : null
  const SentimentIcon = sentiment?.icon

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      <FeedTileHeader
        badge={
          <span className="flex shrink-0 items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800">
            <Newspaper className="h-3.5 w-3.5 shrink-0" />
            News
          </span>
        }
        headline={item.headline}
      />

      <FeedTileTitle quoteSymbol={covered?.symbol} />

      {covered && (
        <div className="flex-shrink-0 h-[33%] min-h-[170px] max-h-[300px] px-3">
          <ReelsChartPanel symbol={covered.symbol} hideHeader />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden px-3 py-2">
        {/* Provenance sits with the story, not in the header: which outlet
            said it is part of how much weight it carries. */}
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-gray-500 dark:text-gray-400 mb-2">
          <span className="font-medium text-gray-700 dark:text-gray-300">{item.source}</span>
          <span className="text-gray-300">·</span>
          <span>{formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}</span>
          {sentiment && SentimentIcon && (
            <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border', sentiment.chip)}>
              <SentimentIcon className="h-3 w-3" />
              {sentiment.label}
            </span>
          )}
        </div>

        {item.summary && <ExpandableText text={item.summary} lines={5} />}

        {item.symbols.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {item.symbols.slice(0, 6).map(sym => {
              const asset = assetForSymbol?.(sym) ?? null
              return (
                <button
                  key={sym}
                  type="button"
                  disabled={!asset}
                  onClick={() => asset && onAssetClick?.(asset.id, asset.symbol)}
                  className={clsx(
                    'px-2 py-0.5 rounded-full text-[11px] no-touch-target',
                    asset
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
                  )}
                >
                  {sym}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-stretch gap-2 px-3 py-2 pb-safe border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onCapture}
          className="flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-gray-300 dark:border-gray-600 font-semibold text-gray-700 dark:text-gray-200 no-touch-target"
        >
          Capture
        </button>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary-600 text-white font-semibold no-touch-target"
        >
          Read story
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}
