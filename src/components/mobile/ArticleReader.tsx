import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Loader2, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useArticle } from '../../hooks/useArticle'

interface ArticleReaderProps {
  open: boolean
  onClose: () => void
  url: string
  /** Shown while the article loads, so the sheet is never blank. */
  fallbackTitle?: string
  fallbackSource?: string
  fallbackImage?: string | null
  /**
   * What the desk holds in the name this story is about.
   *
   * ── Why a reader knows about positions ──────────────────────────────────
   *
   * It did not, and that made it an RSS pane: a headline, a paragraph and a
   * link out. When extraction failed — a paywall, a bot block — what remained
   * on screen was one sentence of apology, one button, and two thirds of a
   * blank phone. The feed's own news card for the same story says "you hold it
   * in 2 portfolios, up to 6.2% in Core Equity", and opening the story threw
   * away precisely the half that made it worth surfacing to this reader.
   *
   * So the reader states the position and offers the route to it. That is the
   * useful destination a blocked story still has, and it is the same one the
   * tile would have gone to.
   */
  desk?: { symbol: string; assetId: string | null; holding: string | null } | null
  /** Route to the asset page. Absent when the caller cannot navigate. */
  onOpenAsset?: (assetId: string | null, symbol: string) => void
}

/**
 * Full-screen reader for a news story.
 *
 * Modelled on how Yahoo Finance and Robinhood present a story: the headline
 * and the words, and almost nothing else. The publisher's own page is mostly
 * navigation, subscription prompts and related-story rails — none of which
 * the reader asked for, and all of which is what makes "open the link" feel
 * like leaving.
 *
 * Full screen rather than a bottom sheet. Reading is not a glance, and a
 * sheet that covers 80% of the screen spends the remaining 20% showing a
 * feed the reader is trying to ignore.
 *
 * When extraction fails — paywall, bot block, JS-rendered page — this does
 * not show an empty reader. It says so plainly and offers the publisher's
 * page, because a stub presented as the article is worse than an honest
 * handoff.
 */
export function ArticleReader({
  open, onClose, url, fallbackTitle, fallbackSource, fallbackImage, desk, onOpenAsset,
}: ArticleReaderProps) {
  const { data, isLoading } = useArticle(url, { enabled: open })
  const scrollRef = useRef<HTMLDivElement>(null)

  // Escape closes, and the body must not scroll behind the overlay — on iOS a
  // scrollable body under a fixed overlay is what makes a modal feel like it
  // is sliding around.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // A new article starts at the top. Without this, opening a second story
  // from the same mounted reader keeps the previous scroll position.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [url])

  if (!open) return null

  const article = data?.ok ? data : null
  const failed = data && !data.ok
  const title = article?.title ?? fallbackTitle ?? 'Story'
  const source = article?.siteName ?? fallbackSource
  const image = article?.leadImage ?? fallbackImage ?? null

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-white dark:bg-gray-950 flex flex-col">
      {/* Bar stays put while the story scrolls: on a long article the way out
          should not require scrolling back to find it. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-2 py-2 border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reader"
          className="flex items-center justify-center h-10 w-10 rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          {source && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
              {source}
            </div>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open the original story"
          className="flex items-center justify-center h-10 w-10 rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <ArrowUpRight className="h-5 w-5" />
        </a>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {/* 65ch is the measure that stops a line being tiring to track back
            from. On a phone the padding does the work; on a tablet the cap does. */}
        <article className="mx-auto w-full max-w-[65ch] px-5 pt-6 pb-16">
          <h1 className="text-[26px] leading-[1.22] font-bold tracking-[-0.02em] text-gray-900 dark:text-gray-50">
            {title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-gray-500 dark:text-gray-400">
            {article?.byline && <span className="font-medium">{article.byline}</span>}
            {article?.publishedTime && (
              <>
                {article.byline && <span aria-hidden>·</span>}
                <span>
                  {formatDistanceToNow(new Date(article.publishedTime), { addSuffix: true })}
                </span>
              </>
            )}
            {article && (
              <>
                <span aria-hidden>·</span>
                <span>{article.readingMinutes} min read</span>
              </>
            )}
          </div>

          {image && (
            <img
              src={image}
              alt=""
              className="mt-5 w-full rounded-xl bg-gray-100 dark:bg-gray-900"
              loading="lazy"
            />
          )}

          {isLoading && (
            <div className="mt-8 space-y-3" aria-live="polite" aria-busy>
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading story…
              </div>
              {/* Lines rather than a spinner alone: the shape of what is
                  arriving is itself a progress signal. */}
              {[100, 96, 88, 99, 72].map((w, i) => (
                <div
                  key={i}
                  className="h-4 rounded bg-gray-100 dark:bg-gray-900 animate-pulse"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          )}

          {article && (
            <div className="mt-6 space-y-5">
              {article.paragraphs.map((p, i) => (
                // Escaped server-side, so this is text. Rendering the
                // publisher's markup instead would be an XSS sink pointed at
                // whatever any news site happens to serve.
                <p
                  key={i}
                  className="text-[17px] leading-[1.72] text-gray-800 dark:text-gray-200"
                >
                  {p}
                </p>
              ))}
            </div>
          )}

          {failed && (
            <div className="mt-8 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                This one has to be read at the source
              </p>
              <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
                {data && !data.ok && (data.reason === 'blocked' || data.status === 403)
                  ? 'The publisher does not allow the story to be read outside their site.'
                  : 'We could not pull the full text of this story.'}
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-primary-600 text-white font-semibold"
              >
                Open the story
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          )}

          {/* The position, wherever the story ends.

              On a failed extraction this is most of what the screen has, and
              it is the part that is actually about the desk. On a successful
              one it sits under the words, where "so what do we own?" is the
              next question rather than the first. */}
          {desk && (article || failed) && (
            <div
              data-testid="article-desk"
              className="mt-8 rounded-2xl border border-gray-200 dark:border-gray-800 p-5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Your position
              </p>
              <p className="mt-2 text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                {desk.symbol}
              </p>
              {desk.holding && (
                <p className="mt-0.5 text-[13px] text-gray-500 dark:text-gray-400">
                  {desk.holding}
                </p>
              )}
              {/* Offered only when there is somewhere to go. A story about a
                  name with no asset record keeps the position line and drops
                  the button, rather than drawing a control that dead-ends —
                  which is the defect this whole panel exists to remove. */}
              {onOpenAsset && desk.assetId && (
                <button
                  type="button"
                  onClick={() => { onClose(); onOpenAsset(desk.assetId, desk.symbol) }}
                  className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 px-5 font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100"
                >
                  Open {desk.symbol}
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {article && (
            <div className="mt-10 pt-5 border-t border-gray-200 dark:border-gray-800">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400"
              >
                Read at {article.siteName}
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          )}
        </article>
      </div>
    </div>,
    document.body,
  )
}
