import React, { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { Sparkles, Lightbulb, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import { ReelsFeedItem } from './ReelsFeedItem'
import { useInfiniteFeed } from '../../hooks/feed'
import type { ScoredFeedItem, FeedFilters, ItemType } from '../../hooks/ideas/types'

interface ReelsFeedProps {
  filters?: FeedFilters
  onItemClick?: (item: ScoredFeedItem) => void
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onOpenFullChart?: (symbol: string) => void
  onShare?: (item: ScoredFeedItem) => void
  onCreateIdea?: (item: ScoredFeedItem) => void
  className?: string
}

export function ReelsFeed({
  filters = {},
  onItemClick,
  onAuthorClick,
  onAssetClick,
  onOpenFullChart,
  onShare,
  onCreateIdea,
  className
}: ReelsFeedProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef<number>(0)
  const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastWheelTime = useRef<number>(0)

  const {
    items,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error
  } = useInfiniteFeed({ filters })

  // Debug logging
  useEffect(() => {
    console.log('[ReelsFeed] State:', {
      itemsCount: items.length,
      isLoading,
      error: error?.message,
      filters
    })
  }, [items.length, isLoading, error, filters])

  const currentItem = items[currentIndex]
  const hasItems = items.length > 0
  // Always allow navigation if we have items (we loop)
  const hasNext = hasItems
  const hasPrev = hasItems

  // Prefetch next page when approaching the end
  useEffect(() => {
    if (currentIndex >= items.length - 3 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [currentIndex, items.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  const goToNext = useCallback(() => {
    if (!hasItems || isTransitioning) return

    setIsTransitioning(true)
    setTimeout(() => {
      setCurrentIndex(prev => {
        // Loop back to beginning if at end
        if (prev >= items.length - 1) {
          return 0
        }
        return prev + 1
      })
      setTimeout(() => setIsTransitioning(false), 150)
    }, 50)
  }, [hasItems, items.length, isTransitioning])

  const goToPrev = useCallback(() => {
    if (!hasItems || isTransitioning) return

    setIsTransitioning(true)
    setTimeout(() => {
      setCurrentIndex(prev => {
        // Loop to end if at beginning
        if (prev <= 0) {
          return items.length - 1
        }
        return prev - 1
      })
      setTimeout(() => setIsTransitioning(false), 150)
    }, 50)
  }, [hasItems, items.length, isTransitioning])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
        case 'j':
        case ' ':
          e.preventDefault()
          goToNext()
          break
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'k':
          e.preventDefault()
          goToPrev()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToNext, goToPrev])

  // Touch/swipe handling
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY
    }

    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndY = e.changedTouches[0].clientY
      const diff = touchStartY.current - touchEndY

      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          goToNext()
        } else {
          goToPrev()
        }
      }
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [goToNext, goToPrev])

  // Mouse wheel handling with debounce
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      const now = Date.now()
      if (now - lastWheelTime.current < 400) return // Debounce
      lastWheelTime.current = now

      if (e.deltaY > 20) {
        goToNext()
      } else if (e.deltaY < -20) {
        goToPrev()
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [goToNext, goToPrev])

  if (isLoading) {
    return (
      <div className={clsx(
        'w-full h-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center',
        className
      )}>
        <div className="text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary-500" />
          <p className="text-lg text-gray-600">Loading feed...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={clsx(
        'w-full h-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center',
        className
      )}>
        <div className="text-center">
          <Lightbulb className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <p className="text-lg text-gray-900">Error loading feed</p>
          <p className="text-gray-500 mt-2">{error.message}</p>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className={clsx(
        'w-full h-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center',
        className
      )}>
        <div className="text-center">
          <Lightbulb className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-lg text-gray-900">No ideas to show</p>
          <p className="text-gray-500 mt-2">Start by adding some content!</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={clsx('relative w-full h-full overflow-hidden', className)}
    >
      {/* Progress indicator - horizontal at bottom */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-gray-200">
        {items.slice(
          Math.max(0, currentIndex - 3),
          Math.min(items.length, currentIndex + 4)
        ).map((_, idx) => {
          const actualIndex = Math.max(0, currentIndex - 3) + idx
          return (
            <button
              key={actualIndex}
              onClick={() => {
                if (!isTransitioning) {
                  setIsTransitioning(true)
                  setCurrentIndex(actualIndex)
                  setTimeout(() => setIsTransitioning(false), 200)
                }
              }}
              className={clsx(
                'h-1.5 rounded-full transition-all duration-200',
                actualIndex === currentIndex
                  ? 'w-6 bg-primary-500'
                  : 'w-1.5 bg-gray-300 hover:bg-gray-400'
              )}
            />
          )
        })}
        <span className="text-xs text-gray-500 ml-2">
          {currentIndex + 1}/{items.length}
        </span>
      </div>

      {/* Main content with snappy transition */}
      <div className="w-full h-full relative overflow-hidden bg-gray-100">
        <div
          className={clsx(
            'w-full h-full transition-all duration-150 ease-out',
            isTransitioning
              ? 'opacity-0 scale-[0.98]'
              : 'opacity-100 scale-100'
          )}
        >
          {currentItem && (
            <ReelsFeedItem
              item={currentItem}
              onItemClick={onItemClick}
              onAuthorClick={onAuthorClick}
              onAssetClick={onAssetClick}
              onOpenFullChart={onOpenFullChart}
              onShare={onShare}
              onCreateIdea={onCreateIdea}
            />
          )}
        </div>
      </div>

      {/* Navigation buttons */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          goToPrev()
        }}
        className={clsx(
          'absolute top-4 left-1/2 -translate-x-1/2 z-20',
          'p-2.5 bg-white shadow-md border border-gray-200 rounded-full text-gray-600',
          'hover:bg-gray-50 hover:text-gray-900 transition-colors',
          !hasItems && 'opacity-30 cursor-not-allowed'
        )}
        disabled={!hasItems}
        title="Previous (↑ or K)"
      >
        <ChevronUp className="h-5 w-5" />
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation()
          goToNext()
        }}
        className={clsx(
          'absolute bottom-12 left-1/2 -translate-x-1/2 z-20',
          'p-2.5 bg-white shadow-md border border-gray-200 rounded-full text-gray-600',
          'hover:bg-gray-50 hover:text-gray-900 transition-colors',
          !hasItems && 'opacity-30 cursor-not-allowed'
        )}
        disabled={!hasItems}
        title="Next (↓ or J)"
      >
        {isFetchingNextPage ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ChevronDown className="h-5 w-5" />
        )}
      </button>

    </div>
  )
}

export default ReelsFeed
