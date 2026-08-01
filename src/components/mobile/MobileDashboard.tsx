import { useCallback, useEffect, useRef, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { ReelsFeedItem } from '../feed/ReelsFeedItem'
import { ACTION_BAR_HEIGHT, MobileFeedActionRail } from './MobileFeedActionRail'
import { ReadthroughSheet } from './ReadthroughSheet'
import { useIdeasFeed } from '../../hooks/ideas/useIdeasFeed'
import type { ScoredFeedItem, ItemType } from '../../hooks/ideas/types'
import type { ReadthroughSourceType } from '../../lib/mobile/readthrough-service'

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
  const { items, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useIdeasFeed({
    mode: 'for_you',
  })

  const [readthroughFor, setReadthroughFor] = useState<ScoredFeedItem | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Drop items with nothing to say. AI insights in particular can arrive as a
  // headline plus a call to action and no actual finding — a full screen
  // asking you to act on nothing is worse than one fewer card.
  const visibleItems = items.filter(item => {
    const body = stripMarkup(item.content ?? '')
    if (body.length >= MIN_BODY_CHARS) return true
    // Short is fine when the card carries other substance.
    return 'asset' in item && !!item.asset
  })

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

/**
 * Feed item types map onto `object_links.source_type`. Only the types with an
 * unambiguous counterpart are offered — `note` covers four distinct note
 * tables, and guessing the wrong one would write a link that resolves to
 * nothing, so readthrough is withheld there rather than recorded incorrectly.
 */
/** Below this, a card has no substantive body worth a full screen. */
const MIN_BODY_CHARS = 24

function stripMarkup(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

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
