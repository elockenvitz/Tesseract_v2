import React, { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  ArrowUpRight,
  Bookmark,
  MoreHorizontal,
  Pencil,
  Archive,
  CalendarClock,
  Link2
} from 'lucide-react'

export interface CardActionsProps {
  /**
   * Whether actions should be visible (controlled by parent hover state).
   */
  visible: boolean
  /**
   * Whether the item is bookmarked.
   * Bookmarked items show the bookmark icon even when not hovering.
   */
  isBookmarked?: boolean
  /**
   * Whether current user can edit (creator only).
   */
  canEdit?: boolean
  /**
   * Whether to show the "Promote to Trade Idea" action.
   * Hide if already promoted or not a quick_thought.
   */
  showPromote?: boolean
  // Callbacks
  onPromote?: () => void
  onBookmark?: () => void
  onEdit?: () => void
  onArchive?: () => void
  onSetRevisit?: () => void
  onCopyLink?: () => void
}

/**
 * IconButton - Small icon button with hover state.
 */
function IconButton({
  icon: Icon,
  label,
  onClick,
  filled = false,
  className
}: {
  icon: typeof Bookmark
  label: string
  onClick?: (e: React.MouseEvent) => void
  filled?: boolean
  className?: string
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      className={clsx(
        'p-1 rounded-md transition-colors duration-150',
        'text-gray-400 hover:text-gray-600 hover:bg-gray-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        className
      )}
      title={label}
      aria-label={label}
    >
      <Icon
        className={clsx(
          'h-4 w-4 transition-colors duration-150',
          filled && 'fill-current'
        )}
      />
    </button>
  )
}

/**
 * CardActions - Action buttons that appear on card hover.
 * Positioned absolute bottom-right by parent.
 */
export function CardActions({
  visible,
  isBookmarked = false,
  canEdit = false,
  showPromote = true,
  onPromote,
  onBookmark,
  onEdit,
  onArchive,
  onSetRevisit,
  onCopyLink
}: CardActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  // Always render container to prevent layout shift
  // Use opacity + pointer-events to hide/show
  return (
    <div
      className={clsx(
        'flex items-center gap-0.5 transition-opacity duration-150',
        // Show when hovered OR when bookmarked (to show filled bookmark)
        (visible || isBookmarked) ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    >
      {/* Promote to Trade Idea - always render if enabled, opacity controlled by parent */}
      {showPromote && onPromote && (
        <IconButton
          icon={ArrowUpRight}
          label="Promote to Trade Idea"
          onClick={() => onPromote()}
        />
      )}

      {/* Bookmark - always render if callback provided */}
      {onBookmark && (
        <IconButton
          icon={Bookmark}
          label={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
          onClick={() => onBookmark()}
          filled={isBookmarked}
          className={isBookmarked ? 'text-primary-500 hover:text-primary-600' : ''}
        />
      )}

      {/* Overflow menu - always render */}
      <div className="relative" ref={menuRef}>
          <IconButton
            icon={MoreHorizontal}
            label="More actions"
            onClick={() => setMenuOpen(!menuOpen)}
          />

          {/* Dropdown menu */}
          {menuOpen && (
            <div
              className={clsx(
                'absolute right-0 bottom-full mb-1 z-50',
                'w-40 bg-white rounded-lg shadow-lg border border-gray-200',
                'py-1 text-sm'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {canEdit && onEdit && (
                <MenuButton icon={Pencil} label="Edit" onClick={() => {
                  onEdit()
                  setMenuOpen(false)
                }} />
              )}

              {onSetRevisit && (
                <MenuButton icon={CalendarClock} label="Set Revisit Date" onClick={() => {
                  onSetRevisit()
                  setMenuOpen(false)
                }} />
              )}

              {onCopyLink && (
                <MenuButton icon={Link2} label="Copy Link" onClick={() => {
                  onCopyLink()
                  setMenuOpen(false)
                }} />
              )}

              {onArchive && (
                <>
                  <div className="border-t border-gray-100 my-1" />
                  <MenuButton
                    icon={Archive}
                    label="Archive"
                    onClick={() => {
                      onArchive()
                      setMenuOpen(false)
                    }}
                    destructive
                  />
                </>
              )}
            </div>
          )}
        </div>
    </div>
  )
}

/**
 * MenuButton - Item in overflow dropdown menu.
 */
function MenuButton({
  icon: Icon,
  label,
  onClick,
  destructive = false
}: {
  icon: typeof Bookmark
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
        destructive
          ? 'text-red-600 hover:bg-red-50'
          : 'text-gray-700 hover:bg-gray-50'
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  )
}

export default CardActions
