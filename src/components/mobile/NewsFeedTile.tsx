import { useState } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, Newspaper, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { ExpandableText } from './ExpandableText'
import type { MarketNewsItem } from '../../hooks/useMarketNews'

interface NewsFeedTileProps {
  item: MarketNewsItem
  /** Resolves a symbol to an asset in the book, when we cover it. */
  assetForSymbol?: (symbol: string) => { id: string; symbol: string } | null
  onAssetClick?: (assetId: string, symbol: string) => void
  onCapture?: () => void
  /** Tapping the category chip narrows the feed to this kind. */
  onFilterKind?: () => void
}

const SENTIMENT = {
  positive: { icon: TrendingUp, label: 'Positive', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  negative: { icon: TrendingDown, label: 'Negative', chip: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  neutral:  { icon: Minus, label: 'Neutral', chip: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
} as const

/**
 * A news story in the feed.
 *
 * Unlike every other tile, the headline *is* the content — so it gets the
 * title slot and wraps, rather than sitting truncated in the header band
 * beside the type chip. Measured against live data, headlines run to 143
 * characters; one clipped line of that is barely a sentence and usually stops
 * before the subject.
 *
 * The other measured reality: only 17 of 40 stories carry a summary (Yahoo
 * supplies none, Finnhub does), while 34 of 40 carry an image. So the tile
 * cannot lean on prose. It leads with the headline, shows the image when there
 * is one, and treats the summary as a bonus rather than the body — otherwise
 * more than half of all news tiles render as a headline over dead space.
 *
 * The sentiment chip appears only when a provider actually supplied one.
 * Inferring it from the headline would be a guess dressed as data on a screen
 * where every other number is real.
 */
export function NewsFeedTile({ item, assetForSymbol, onAssetClick, onCapture, onFilterKind }: NewsFeedTileProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const covered = item.symbols.map(s => assetForSymbol?.(s) ?? null).find(Boolean) ?? null
  const sentiment = item.sentiment ? SENTIMENT[item.sentiment] : null
  const SentimentIcon = sentiment?.icon
  const showImage = !!item.imageUrl && !imageFailed

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Provenance band. Which outlet said it, and when, are part of how much
          weight the story carries — so they lead rather than being buried. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={onFilterKind}
          disabled={!onFilterKind}
          title="Show only news"
          className="flex shrink-0 items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800 no-touch-target disabled:cursor-default"
        >
          <Newspaper className="h-3.5 w-3.5 shrink-0" />
          News
        </button>
        <span className="min-w-0 truncate text-[12px] font-medium text-gray-700 dark:text-gray-300">
          {item.source}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-gray-400 whitespace-nowrap">
          {formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}
        </span>
      </div>

      {/* Body scrolls: a long headline plus an image plus a summary genuinely
          can exceed a phone screen, and clipping the story is the one thing
          this tile must not do. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="px-3 pt-2.5 pb-2">
          <h2 className={clsx(
            'font-bold text-gray-900 dark:text-white leading-snug',
            // Long headlines step down a size rather than being cut off.
            item.headline.length > 90 ? 'text-lg' : 'text-xl',
          )}>
            {item.headline}
          </h2>

          {(sentiment || item.symbols.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {sentiment && SentimentIcon && (
                <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium', sentiment.chip)}>
                  <SentimentIcon className="h-3 w-3" />
                  {sentiment.label}
                </span>
              )}
              {item.symbols.slice(0, 5).map(sym => {
                const asset = assetForSymbol?.(sym) ?? null
                return (
                  <button
                    key={sym}
                    type="button"
                    disabled={!asset}
                    onClick={() => asset && onAssetClick?.(asset.id, asset.symbol)}
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[11px] font-medium no-touch-target',
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

        {showImage && (
          <div className="px-3 pb-2">
            <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              // A broken image URL should cost the picture, not leave a torn
              // frame in the middle of the story.
              onError={() => setImageFailed(true)}
              className="w-full h-40 object-cover rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          </div>
        )}

        {item.summary && (
          <div className="px-3 pb-2">
            <ExpandableText text={item.summary} lines={showImage ? 3 : 6} />
          </div>
        )}

        {/* The chart answers the other half of the question — what the price
            did about it — but only for names actually in the book. */}
        {covered && (
          <div className="px-3 pb-3 h-[220px]">
            <ReelsChartPanel symbol={covered.symbol} hideHeader />
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
