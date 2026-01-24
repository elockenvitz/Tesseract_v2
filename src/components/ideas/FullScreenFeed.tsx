import React, { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  ChevronUp, ChevronDown, ArrowLeft, ArrowRight,
  TrendingUp, TrendingDown, Lightbulb, FileText, GitBranch, Sparkles,
  Heart, MessageSquare, Share2, Bookmark, MoreHorizontal, User,
  Zap, Bot, Hash, BarChart3
} from 'lucide-react'
import { IdeaReactions } from './social/IdeaReactions'
import { BookmarkButton } from './social/BookmarkButton'
import { ShareButton } from './social/ShareButton'
import { FollowButton } from './social/FollowButton'
import { ChartModal } from './widgets/ChartModal'
import type { ScoredFeedItem, ItemType } from '../../hooks/ideas/types'

// Strip HTML tags from content for clean display
function stripHtml(html: string): string {
  if (!html) return ''
  const text = html.replace(/<[^>]*>/g, ' ')
  const decoded = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return decoded.replace(/\s+/g, ' ').trim()
}

interface FullScreenFeedProps {
  items: ScoredFeedItem[]
  onItemClick?: (item: ScoredFeedItem) => void
  onAuthorClick?: (authorId: string) => void
  onAssetClick?: (assetId: string, symbol: string) => void
  onGenerateIdea?: (item: ScoredFeedItem) => void
  onClose?: () => void
  initialIndex?: number
  isLoading?: boolean
  className?: string
}

const typeConfig: Record<ItemType, { icon: typeof Lightbulb; label: string; gradient: string }> = {
  quick_thought: {
    icon: Lightbulb,
    label: 'Thought',
    gradient: 'from-indigo-600 via-purple-600 to-pink-600'
  },
  trade_idea: {
    icon: TrendingUp,
    label: 'Trade Idea',
    gradient: 'from-emerald-600 via-teal-600 to-cyan-600'
  },
  note: {
    icon: FileText,
    label: 'Research Note',
    gradient: 'from-blue-600 via-sky-600 to-cyan-600'
  },
  thesis_update: {
    icon: GitBranch,
    label: 'Thesis Update',
    gradient: 'from-purple-600 via-violet-600 to-indigo-600'
  },
  insight: {
    icon: Sparkles,
    label: 'AI Insight',
    gradient: 'from-amber-500 via-orange-500 to-red-500'
  },
  message: {
    icon: MessageSquare,
    label: 'Discussion',
    gradient: 'from-gray-600 via-slate-600 to-zinc-600'
  }
}

export function FullScreenFeed({
  items,
  onItemClick,
  onAuthorClick,
  onAssetClick,
  onGenerateIdea,
  onClose,
  initialIndex = 0,
  isLoading = false,
  className
}: FullScreenFeedProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef<number>(0)

  const currentItem = items[currentIndex]
  const hasNext = currentIndex < items.length - 1
  const hasPrev = currentIndex > 0

  const goToNext = useCallback(() => {
    if (hasNext && !isTransitioning) {
      setIsTransitioning(true)
      setCurrentIndex(prev => prev + 1)
      setTimeout(() => setIsTransitioning(false), 300)
    }
  }, [hasNext, isTransitioning])

  const goToPrev = useCallback(() => {
    if (hasPrev && !isTransitioning) {
      setIsTransitioning(true)
      setCurrentIndex(prev => prev - 1)
      setTimeout(() => setIsTransitioning(false), 300)
    }
  }, [hasPrev, isTransitioning])

  // Close chart modal when navigating to different item
  useEffect(() => {
    setShowChart(false)
  }, [currentIndex])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showChart) return // Don't navigate while chart is open
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') {
        goToNext()
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k') {
        goToPrev()
      } else if (e.key === 'Escape') {
        onClose?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToNext, goToPrev, onClose, showChart])

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

  // Scroll wheel handling
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let scrollTimeout: NodeJS.Timeout
    let lastScrollTime = 0

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      const now = Date.now()
      if (now - lastScrollTime < 500) return // Debounce
      lastScrollTime = now

      if (e.deltaY > 0) {
        goToNext()
      } else if (e.deltaY < 0) {
        goToPrev()
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [goToNext, goToPrev])

  if (isLoading) {
    return (
      <div className={clsx(
        'w-full h-full bg-gradient-to-br from-gray-900 to-black flex items-center justify-center',
        className
      )}>
        <div className="text-center text-white">
          <Sparkles className="w-16 h-16 mx-auto mb-4 animate-pulse" />
          <p className="text-xl">Loading feed...</p>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className={clsx(
        'w-full h-full bg-gradient-to-br from-gray-900 to-black flex items-center justify-center',
        className
      )}>
        <div className="text-center text-white">
          <Lightbulb className="w-16 h-16 mx-auto mb-4 text-gray-500" />
          <p className="text-xl">No ideas to show</p>
          <p className="text-gray-400 mt-2">Start by adding some content!</p>
        </div>
      </div>
    )
  }

  const config = typeConfig[currentItem.type]
  const TypeIcon = config.icon

  return (
    <div
      ref={containerRef}
      className={clsx(
        'relative w-full h-full overflow-hidden',
        'bg-gradient-to-br',
        config.gradient,
        className
      )}
    >
      {/* Progress indicators */}
      <div className="absolute top-4 left-4 right-4 z-10 flex gap-1">
        {items.map((_, index) => (
          <div
            key={index}
            className={clsx(
              'h-0.5 flex-1 rounded-full transition-all duration-300',
              index === currentIndex ? 'bg-white' : 'bg-white/30'
            )}
          />
        ))}
      </div>

      {/* Header */}
      <div className="absolute top-8 left-4 right-4 z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 px-3 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-white text-sm font-medium">
            <TypeIcon className="h-4 w-4" />
            {config.label}
          </span>
          <span className="text-white/60 text-sm">
            {currentIndex + 1} / {items.length}
          </span>
        </div>

        <button
          onClick={onClose}
          className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {/* Main content */}
      <div
        className={clsx(
          'absolute inset-0 flex flex-col items-center justify-center p-8 pt-24 pb-32',
          'transition-opacity duration-300',
          isTransitioning ? 'opacity-0' : 'opacity-100'
        )}
        onClick={() => onItemClick?.(currentItem)}
      >
        {/* Title (for notes/insights) */}
        {'title' in currentItem && currentItem.title && (
          <h1 className="text-3xl md:text-4xl font-bold text-white text-center mb-6 max-w-4xl">
            {currentItem.title}
          </h1>
        )}

        {/* Content */}
        <p className="text-xl md:text-2xl text-white/90 text-center max-w-3xl leading-relaxed mb-8">
          {(() => {
            const cleanContent = stripHtml(currentItem.content)
            return cleanContent.length > 500
              ? cleanContent.substring(0, 500) + '...'
              : cleanContent
          })()}
        </p>

        {/* Asset badge with chart button */}
        {'asset' in currentItem && currentItem.asset && (
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAssetClick?.(currentItem.asset!.id, currentItem.asset!.symbol)
              }}
              className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-white font-semibold hover:bg-white/30 transition-colors"
            >
              ${currentItem.asset.symbol}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowChart(true)
              }}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/30 transition-colors"
              title="View chart"
            >
              <BarChart3 className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Chart Modal */}
        {'asset' in currentItem && currentItem.asset && (
          <ChartModal
            symbol={currentItem.asset.symbol}
            companyName={currentItem.asset.company_name}
            isOpen={showChart}
            onClose={() => setShowChart(false)}
            onNavigateToAsset={(symbol) => {
              setShowChart(false)
              onAssetClick?.(currentItem.asset!.id, symbol)
            }}
          />
        )}

        {/* Tags (for insights) */}
        {'tags' in currentItem && currentItem.tags && currentItem.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 justify-center">
            {currentItem.tags.slice(0, 5).map(tag => (
              <span
                key={tag}
                className="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full text-white/80 text-sm"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Author info */}
      <div className="absolute bottom-24 left-4 right-4 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAuthorClick?.(currentItem.author.id)
          }}
          className="flex items-center gap-3 text-white hover:text-white/80 transition-colors"
        >
          {currentItem.author.avatar_url ? (
            <img
              src={currentItem.author.avatar_url}
              alt={currentItem.author.full_name || ''}
              className="w-10 h-10 rounded-full object-cover border-2 border-white/30"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center border-2 border-white/30">
              <User className="h-5 w-5 text-white" />
            </div>
          )}
          <div className="text-left">
            <p className="font-semibold">
              {currentItem.author.full_name ||
                (currentItem.author.first_name && currentItem.author.last_name
                  ? `${currentItem.author.first_name} ${currentItem.author.last_name}`
                  : currentItem.author.email?.split('@')[0] || 'Unknown')}
            </p>
            <p className="text-sm text-white/60">
              {formatDistanceToNow(new Date(currentItem.created_at), { addSuffix: true })}
            </p>
          </div>

          <FollowButton
            authorId={currentItem.author.id}
            variant="pill"
            className="ml-auto"
          />
        </button>
      </div>

      {/* Action buttons */}
      <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <IdeaReactions
            itemId={currentItem.id}
            itemType={currentItem.type}
            variant="fullscreen"
          />
        </div>

        <div className="flex items-center gap-2">
          {onGenerateIdea && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onGenerateIdea(currentItem)
              }}
              className="p-3 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition-colors"
              title="Generate idea from this"
            >
              <Zap className="h-5 w-5" />
            </button>
          )}
          <BookmarkButton
            itemId={currentItem.id}
            itemType={currentItem.type}
            variant="fullscreen"
          />
          <ShareButton
            item={currentItem}
            variant="fullscreen"
          />
        </div>
      </div>

      {/* Navigation arrows */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          goToPrev()
        }}
        className={clsx(
          'absolute left-4 top-1/2 -translate-y-1/2 z-10',
          'p-3 bg-white/10 backdrop-blur-sm rounded-full text-white',
          'hover:bg-white/20 transition-colors',
          !hasPrev && 'opacity-30 cursor-not-allowed'
        )}
        disabled={!hasPrev}
      >
        <ChevronUp className="h-6 w-6" />
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation()
          goToNext()
        }}
        className={clsx(
          'absolute right-4 top-1/2 -translate-y-1/2 z-10',
          'p-3 bg-white/10 backdrop-blur-sm rounded-full text-white',
          'hover:bg-white/20 transition-colors',
          !hasNext && 'opacity-30 cursor-not-allowed'
        )}
        disabled={!hasNext}
      >
        <ChevronDown className="h-6 w-6" />
      </button>

      {/* Tap zones for navigation */}
      <div
        className="absolute inset-y-0 left-0 w-1/3 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          goToPrev()
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/3 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          goToNext()
        }}
      />
    </div>
  )
}

export default FullScreenFeed
