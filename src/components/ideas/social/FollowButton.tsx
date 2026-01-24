import React from 'react'
import { clsx } from 'clsx'
import { UserPlus, UserMinus, Check } from 'lucide-react'
import { useAuthorFollow } from '../../../hooks/ideas/useAuthorFollow'
import { useAuth } from '../../../hooks/useAuth'

interface FollowButtonProps {
  authorId: string
  variant?: 'default' | 'compact' | 'pill' | 'fullscreen'
  showLabel?: boolean
  className?: string
}

export function FollowButton({
  authorId,
  variant = 'default',
  showLabel = true,
  className
}: FollowButtonProps) {
  const { user } = useAuth()
  const { isFollowing, toggleFollow, isToggling, isLoading } = useAuthorFollow(authorId)

  // Don't show follow button for self
  if (user?.id === authorId) {
    return null
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleFollow(authorId)
  }

  if (isLoading) {
    return (
      <div className={clsx(
        'animate-pulse',
        variant === 'compact' ? 'w-6 h-6 rounded' : 'w-20 h-8 rounded-lg',
        'bg-gray-200',
        className
      )} />
    )
  }

  if (variant === 'fullscreen') {
    return (
      <button
        onClick={handleClick}
        disabled={isToggling}
        className={clsx(
          'px-4 py-1.5 rounded-full text-sm font-medium transition-all',
          isFollowing
            ? 'bg-white/20 text-white hover:bg-red-500/50'
            : 'bg-white text-gray-900 hover:bg-gray-100',
          isToggling && 'opacity-50',
          className
        )}
      >
        {isFollowing ? (
          <span className="flex items-center gap-1">
            <Check className="h-4 w-4" />
            Following
          </span>
        ) : (
          'Follow'
        )}
      </button>
    )
  }

  if (variant === 'pill') {
    return (
      <button
        onClick={handleClick}
        disabled={isToggling}
        className={clsx(
          'px-3 py-1 rounded-full text-xs font-medium transition-all',
          isFollowing
            ? 'bg-gray-200 text-gray-700 hover:bg-red-100 hover:text-red-600'
            : 'bg-primary-100 text-primary-700 hover:bg-primary-200',
          isToggling && 'opacity-50',
          className
        )}
      >
        {isFollowing ? 'Following' : 'Follow'}
      </button>
    )
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={handleClick}
        disabled={isToggling}
        className={clsx(
          'p-1.5 rounded-lg transition-colors',
          isFollowing
            ? 'text-gray-500 hover:text-red-600 hover:bg-red-50'
            : 'text-gray-400 hover:text-primary-600 hover:bg-primary-50',
          isToggling && 'opacity-50',
          className
        )}
        title={isFollowing ? 'Unfollow' : 'Follow'}
      >
        {isFollowing ? (
          <UserMinus className="h-4 w-4" />
        ) : (
          <UserPlus className="h-4 w-4" />
        )}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={isToggling}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-sm transition-all',
        isFollowing
          ? 'bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-600'
          : 'bg-primary-600 text-white hover:bg-primary-700',
        isToggling && 'opacity-50',
        className
      )}
    >
      {isFollowing ? (
        <>
          <UserMinus className="h-4 w-4" />
          {showLabel && 'Following'}
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4" />
          {showLabel && 'Follow'}
        </>
      )}
    </button>
  )
}

export default FollowButton
