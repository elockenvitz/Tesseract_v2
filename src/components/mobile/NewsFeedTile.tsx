import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Newspaper, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ReelsChartPanel } from '../feed/ReelsChartPanel'
import { ExpandableText } from './ExpandableText'
import { ArticleReader } from './ArticleReader'
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
    // No subject means no chart. market-news now attributes from the story's
    // own words and leaves `primarySymbol` unset when the text names nobody —
    // a fund or macro story. Falling back to `symbols` here would put the
    // queried ticker back on screen, which is the wrong-chart bug by another
    // route: "Tiger Global cuts stakes in Big Tech" would draw Microsoft
    // again purely because Microsoft's query found it.
    if (!item.primarySymbol) return []
    const ordered = [item.primarySymbol, ...item.symbols.filter(s => s !== item.primarySymbol)]
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

  // Chips name what the story is about, not what query surfaced it. Showing
  // the queried ticker on a story that never mentions it is what put GOOGL on
  // half the feed.
  const attributed = item.primarySymbol ? item.symbols : []
  const [chartIndex, setChartIndex] = useState(0)
  const [readerOpen, setReaderOpen] = useState(false)
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
        {/* Above the headline, edge to edge, and shorter.
            Below the title it split the story in two — headline, picture,
            then the rest of the prose — so the summary read as a caption to
            an image that had already interrupted it. A masthead photo is the
            arrangement every news app uses because it sets the scene before
            the words rather than between them. h-24 to h-[104px] full-bleed
            reads as larger while occupying less vertical space than an inset
            band did. */}
        {showImage && (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            // A broken image URL should cost the picture, not leave a torn
            // frame at the top of the story.
            onError={() => setImageFailed(true)}
            className="w-full h-[104px] object-cover bg-gray-100 dark:bg-gray-800"
          />
        )}

        <div className="px-3 pt-2.5 pb-2">
          <h2 className={clsx(
            'font-bold text-gray-900 dark:text-white leading-snug',
            // Long headlines step down a size rather than being cut off.
            item.headline.length > 90 ? 'text-lg' : 'text-xl',
          )}>
            {item.headline}
          </h2>

          {(sentiment || attributed.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {sentiment && SentimentIcon && (
                <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium', sentiment.chip)}>
                  <SentimentIcon className="h-3 w-3" />
                  {sentiment.label}
                </span>
              )}
              {attributed.slice(0, 5).map(sym => {
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

        {item.summary && (
          <div className="px-3 pb-2">
            <ExpandableText text={item.summary} lines={6} />
          </div>
        )}

        {/* The chart answers the other half of the question — what the price
            did about it — but only for names actually in the book. */}
        {covered && (
          <div className="px-3 pb-3">
            {/* The switcher sits on the chart, not under it.
                Detached pills below made you look away from the chart to find
                out what you were looking at, and read as page dots rather than
                as a control. Naming the symbol on the chart's own header means
                the answer is where the eye already is; the other tickers are a
                segmented control beside it, which reads as "these are the
                choices" instead of "you are on slide 2". */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 dark:bg-white/[0.04] border-b border-gray-200 dark:border-gray-800">
                <span className="text-[13px] font-bold tracking-tight text-gray-900 dark:text-white">
                  {covered.symbol}
                </span>
                {chartable.length > 1 && (
                  <div className="ml-auto flex items-center rounded-lg bg-gray-200/70 dark:bg-white/10 p-0.5">
                    {chartable.map((a, i) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setChartIndex(i)}
                        aria-label={`Show ${a.symbol} chart`}
                        aria-current={i === chartIndex}
                        className={clsx(
                          'px-2 py-[3px] rounded-md text-[11px] font-bold tracking-wide transition-colors no-touch-target',
                          i === chartIndex
                            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                            : 'text-gray-500 dark:text-gray-400'
                        )}
                      >
                        {a.symbol}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <WhenNearViewport
                className="h-[200px]"
                placeholder={
                  <div className="w-full h-full bg-gray-50 dark:bg-gray-800/50 animate-pulse" />
                }
              >
                <ReelsChartPanel key={covered.symbol} symbol={covered.symbol} hideHeader />
              </WhenNearViewport>
            </div>


          </div>
        )}
      </div>

      {/* pb-safe alone only clears the home indicator — on a phone without
          one it resolves to zero, so the buttons sat flush against the screen
          edge. A real 12px floor plus the safe area gives the row somewhere to
          sit either way. */}
      <div className="flex-shrink-0 flex items-stretch gap-2 px-3 pt-2 pb-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onCapture}
          className="flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-gray-300 dark:border-gray-600 font-semibold text-gray-700 dark:text-gray-200 no-touch-target"
        >
          Capture
        </button>
        {/* Opens the in-app reader rather than leaving for the publisher.
            It falls back to the original page by itself when the story
            cannot be extracted, so this stays a single unambiguous action
            instead of asking the reader to guess which stories will work. */}
        <button
          type="button"
          onClick={() => setReaderOpen(true)}
          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary-600 text-white font-semibold no-touch-target"
        >
          Read story
        </button>
      </div>

      <ArticleReader
        open={readerOpen}
        onClose={() => setReaderOpen(false)}
        url={item.url}
        fallbackTitle={item.headline}
        fallbackSource={item.source}
        fallbackImage={item.imageUrl ?? null}
      />
    </div>
  )
}
