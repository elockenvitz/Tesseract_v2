import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, Newspaper, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { ExpandableText } from './ExpandableText'
import { FeedKindBadge } from './FeedKindBadge'
import { WhenNearViewport } from './WhenNearViewport'
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
 * Summary coverage used to be the constraint: across cached payloads one batch
 * of 30 stories carried a summary on none of them while 28 carried an image,
 * so the tile rendered as a photograph with a caption. That was a sourcing gap
 * rather than a design one — Yahoo's RSS feed supplies the descriptions its
 * JSON endpoint omits, and market-news now reads both. The image went from
 * hero height to a band to match: it is supporting material, and it was only
 * ever dominant because there was nothing else to show.
 *
 * The sentiment chip appears only when a provider actually supplied one.
 * Inferring it from the headline would be a guess dressed as data on a screen
 * where every other number is real.
 */
export function NewsFeedTile({ item, assetForSymbol, onAssetClick, onCapture, onFilterKind }: NewsFeedTileProps) {
  const [imageFailed, setImageFailed] = useState(false)
  /**
   * Charts to show, and in what order.
   *
   * This used to be a single lookup: the first symbol in `item.symbols` that
   * we cover. That reads as "the story's chart" but is not — a Reddit story
   * mentioning Google rendered a Google chart, because RDDT was not in the
   * book and GOOGL was. The subject of the story and the subjects we happen
   * to cover are different questions, and only the first one belongs at the
   * front.
   *
   * `primarySymbol` is now supplied by market-news (exact from Finnhub's
   * per-symbol query, top-relevance from Alpha Vantage), so it leads. The
   * rest follow in relevance order, and everything we do not cover is
   * dropped — we have no chart to draw for it.
   */
  const chartable = useMemo(() => {
    const ordered = item.primarySymbol
      ? [item.primarySymbol, ...item.symbols.filter(s => s !== item.primarySymbol)]
      : item.symbols
    const seen = new Set<string>()
    return ordered
      .map(sym => assetForSymbol?.(sym) ?? null)
      .filter((a): a is { id: string; symbol: string } => {
        if (!a || seen.has(a.id)) return false
        seen.add(a.id)
        return true
      })
      .slice(0, 5)
  }, [item.primarySymbol, item.symbols, assetForSymbol])

  const [chartIndex, setChartIndex] = useState(0)
  const covered = chartable[chartIndex] ?? null
  const sentiment = item.sentiment ? SENTIMENT[item.sentiment] : null
  const SentimentIcon = sentiment?.icon
  const showImage = !!item.imageUrl && !imageFailed

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Provenance band. Which outlet said it, and when, are part of how much
          weight the story carries — so they lead rather than being buried. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
        <FeedKindBadge
          icon={Newspaper}
          label="News"
          chip="bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800"
          onFilter={onFilterKind}
          filterLabel="Show only news"
        />
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
              // Deliberately a band rather than a hero. At h-40 the picture was
              // the tile: most stories carry an image and few carry prose, so
              // the screen read as a photo with a caption. It is supporting
              // material and now takes supporting height.
              className="w-full h-24 object-cover rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          </div>
        )}

        {item.summary && (
          <div className="px-3 pb-2">
            <ExpandableText text={item.summary} lines={6} />
          </div>
        )}

        {/* The chart answers the other half of the question — what the price
            did about it — but only for names actually in the book. */}
        {covered && (
          <div className="px-3 pb-3">
            {/* One chart at a time, swapped by the pager below, rather than a
                horizontal scroller: this sits inside a vertically-swiped feed,
                and a nested horizontal scroll region steals the gesture that
                moves between stories. */}
            <WhenNearViewport
              className="h-[220px]"
              placeholder={
                <div className="w-full h-full rounded-lg bg-gray-50 dark:bg-gray-800/50 animate-pulse" />
              }
            >
              <ReelsChartPanel key={covered.symbol} symbol={covered.symbol} hideHeader />
            </WhenNearViewport>

            {chartable.length > 1 && (
              <div className="mt-2 flex items-center justify-center gap-1.5">
                {chartable.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setChartIndex(i)}
                    aria-label={`Show ${a.symbol} chart`}
                    aria-current={i === chartIndex}
                    className={clsx(
                      'px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide transition-colors no-touch-target',
                      i === chartIndex
                        ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    )}
                  >
                    {a.symbol}
                  </button>
                ))}
              </div>
            )}
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
