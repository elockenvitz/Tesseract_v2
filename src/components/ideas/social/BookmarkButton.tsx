import React from 'react'
import { clsx } from 'clsx'
import { Bookmark } from 'lucide-react'
import { useIdeaBookmarks } from '../../../hooks/ideas/useIdeaBookmarks'
import type { ItemType } from '../../../hooks/ideas/types'

interface BookmarkButtonProps {
  itemId: string
  itemType: ItemType
  variant?: 'default' | 'compact' | 'fullscreen'
  showLabel?: boolean
  className?: string
}

export function BookmarkButton({
  itemId,
  itemType,
  variant = 'default',
  showLabel = false,
  className
}: BookmarkButtonProps) {
  const { isBookmarked, toggleBookmark, isToggling } = useIdeaBookmarks(itemId, itemType)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleBookmark(itemId, itemType)
  }

  if (variant === 'fullscreen') {
    return (
      <button
        onClick={handleClick}
        disabled={isToggling}
        className={clsx(
          'p-3 rounded-full transition-all',
          isBookmarked
            ? 'bg-white/20 text-white'
            : 'text-white/70 hover:text-white hover:bg-white/10',
          isToggling && 'opacity-50',
          className
        )}
        title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
      >
        <Bookmark className={clsx(
          'h-6 w-6',
          isBookmarked && 'fill-current'
        )} />
      </button>
    )
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={handleClick}
        disabled={isToggling}
        className={clsx(
          'p-1 transition-colors',
          isBookmarked
            ? 'text-amber-500'
            : 'text-gray-400 hover:text-amber-500',
          isToggling && 'opacity-50',
          className
        )}
        title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
      >
        <Bookmark className={clsx(
          'h-4 w-4',
          isBookmarked && 'fill-current'
        )} />
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={isToggling}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors',
        isBookmarked
          ? 'bg-amber-50 text-amber-600'
          : 'text-gray-500 hover:bg-gray-100 hover:text-amber-600',
        isToggling && 'opacity-50',
        className
      )}
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
    >
      <Bookmark className={clsx(
        'h-4 w-4',
        isBookmarked && 'fill-current'
      )} />
      {showLabel && (
        <span className="text-sm font-medium">
          {isBookmarked ? 'Saved' : 'Save'}
        </span>
      )}
    </button>
  )
}

export default BookmarkButton
