import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { ReelsFeedItem } from '../feed/ReelsFeedItem'
import { ACTION_BAR_HEIGHT, MobileFeedActionRail } from './MobileFeedActionRail'
import { ReadthroughSheet } from './ReadthroughSheet'
import { useIdeasFeed } from '../../hooks/ideas/useIdeasFeed'
import type { ScoredFeedItem, ItemType } from '../../hooks/ideas/types'
import type { ReadthroughSourceType } from '../../lib/mobile/readthrough-service'
import { loadSeen, markSeen, rotateBySeen } from '../../lib/mobile/feed-rotation'
import { useAuth } from '../../hooks/useAuth'

interface MobileDashboardProps {
  onNavigate?: (result: any) => void
  onShare?: (item: ScoredFeedItem) => void
  onCreateIdea?: (item: ScoredFeedItem) => void
}

/**
 * The phone dashboard: a full-screen, one-post-per-screen ideas feed.
 *
 * This replaces the desktop analytics dashboard on mobile rather than trying
 * to reflow it. The desktop surface is a wide multi-column workbench; squeezed
 * onto 390px it produces cramped cards and horizontal overflow no amount of
 * breakpointing fixes. A feed is the mobile-native shape, and it matches how
 * the app is actually used on a phone — reading and reacting, not authoring.
 *
 * Paging uses CSS scroll-snap rather than manual touch handling: it inherits
 * native momentum, rubber-banding and accessibility behaviour, and cannot
 * desynchronise from the scroll position the way an index-tracking
 * implementation does.
 */
export function MobileDashboard({
  onNavigate,
  onShare,
  onCreateIdea,
}: MobileDashboardProps) {
  const { user } = useAuth()
  const userId = user?.id
  const { items, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useIdeasFeed({ mode: 'for_you' })

  // Re-rank on every open. staleTime keeps the network quiet within 30s, but
  // the point here is that returning to the feed reflects what changed.
  useEffect(() => { refetch() }, [refetch])

  const [readthroughFor, setReadthroughFor] = useState<ScoredFeedItem | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Drop only genuinely empty cards. An earlier 24-character threshold was
  // hiding real posts — short reasoning is still reasoning. This now catches
  // just the AI insights that arrive as a call to action with no finding.
  const substantive = items.filter(item => {
    if (stripMarkup(item.content ?? '').length > 0) return true
    if ('title' in item && item.title) return true
    return 'asset' in item && !!item.asset
  })

  // Demote what has already been seen so the feed does not open on the same
  // post every time. Snapshot the seen map once per mount: reading it live
  // would reshuffle the list underneath the reader as they scroll.
  const [seenAtMount] = useState(() => loadSeen(userId ?? ''))
  const visibleItems = useMemo(
    () => rotateBySeen(substantive, seenAtMount),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [substantive.map(i => i.id).join(','), seenAtMount]
  )

  // Record what actually reached the screen, so the next open leads with
  // something else.
  useEffect(() => {
    if (!userId || !visibleItems.length) return
    const timer = setTimeout(() => markSeen(userId, visibleItems.slice(0, 10).map(i => i.id)), 1500)
    return () => clearTimeout(timer)
  }, [userId, visibleItems])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '400px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const openAsset = useCallback(
    (assetId: string, symbol: string) => {
      onNavigate?.({ id: assetId, title: symbol, type: 'asset', data: { id: assetId, symbol } })
    },
    [onNavigate]
  )

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-primary-500 animate-spin dark:border-gray-700" />
          <p className="text-xs">Loading your feed…</p>
        </div>
      </div>
    )
  }

  if (!visibleItems.length) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="text-center">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 text-amber-400" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Nothing in your feed yet</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Ideas, thoughts and thesis updates from your team will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="h-full overflow-y-auto snap-y snap-mandatory overscroll-contain">
        {visibleItems.map(item => {
          const source = readthroughSourceType(item.type)
          return (
            <section key={item.id} className="relative h-full w-full snap-start snap-always">
              {/* Inset by exactly the bar height so the card never renders
                  underneath the actions. */}
              <div className="absolute inset-x-0 top-0" style={{ bottom: ACTION_BAR_HEIGHT }}>
                <ReelsFeedItem
                  item={item}
                  hideHeaderActions
                  onAssetClick={openAsset}
                  onShare={onShare}
                  onCreateIdea={onCreateIdea}
                />
              </div>
              <MobileFeedActionRail
                itemId={item.id}
                itemType={item.type}
                onShare={onShare ? () => onShare(item) : undefined}
                onCreateIdea={onCreateIdea ? () => onCreateIdea(item) : undefined}
                onReadthrough={source ? () => setReadthroughFor(item) : undefined}
              />
            </section>
          )
        })}
        <div ref={sentinelRef} className="h-px" />
      </div>

      {readthroughFor && (
        <ReadthroughSheet
          open
          onClose={() => setReadthroughFor(null)}
          sourceType={readthroughSourceType(readthroughFor.type)!}
          sourceId={readthroughFor.id}
          excludeAssetId={
            'asset' in readthroughFor && readthroughFor.asset ? readthroughFor.asset.id : null
          }
        />
      )}
    </>
  )
}

function stripMarkup(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Feed item types map onto `object_links.source_type`. Only the types with an
 * unambiguous counterpart are offered — `note` covers four distinct note
 * tables, and guessing the wrong one would write a link that resolves to
 * nothing, so readthrough is withheld there rather than recorded incorrectly.
 */
function readthroughSourceType(type: ItemType): ReadthroughSourceType | null {
  switch (type) {
    case 'quick_thought':
      return 'quick_thought'
    case 'trade_idea':
      return 'trade_idea'
    case 'thesis_update':
      return 'trade_idea_thesis'
    default:
      return null
  }
}
