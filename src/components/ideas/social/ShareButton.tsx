import React, { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { Share2, Copy, Check, Link, Mail, MessageSquare } from 'lucide-react'
import type { ScoredFeedItem } from '../../../hooks/ideas/types'

interface ShareButtonProps {
  item: ScoredFeedItem
  variant?: 'default' | 'compact' | 'fullscreen'
  showLabel?: boolean
  className?: string
}

export function ShareButton({
  item,
  variant = 'default',
  showLabel = false,
  className
}: ShareButtonProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMenu])

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/ideas/${item.type}/${item.id}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
        setShowMenu(false)
      }, 1500)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleShare = (method: 'native' | 'email' | 'message') => {
    const title = 'title' in item ? item.title : `${item.type} by ${item.author.full_name}`
    const text = item.content.substring(0, 200)
    const url = `${window.location.origin}/ideas/${item.type}/${item.id}`

    switch (method) {
      case 'native':
        if (navigator.share) {
          navigator.share({ title, text, url })
        }
        break
      case 'email':
        window.open(`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`)
        break
      case 'message':
        // Could integrate with messaging system
        handleCopyLink()
        break
    }
    setShowMenu(false)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()

    // Try native share first on mobile
    if (navigator.share && variant !== 'fullscreen') {
      handleShare('native')
    } else {
      setShowMenu(!showMenu)
    }
  }

  if (variant === 'fullscreen') {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={handleClick}
          className={clsx(
            'p-3 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-all',
            className
          )}
          title="Share"
        >
          <Share2 className="h-6 w-6" />
        </button>

        {showMenu && (
          <div className="absolute bottom-full right-0 mb-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
            <button
              onClick={handleCopyLink}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-green-600">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Copy link</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleShare('email')}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Mail className="h-4 w-4" />
              <span>Email</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={handleClick}
        className={clsx(
          'p-1 text-gray-400 hover:text-gray-600 transition-colors',
          className
        )}
        title="Share"
      >
        <Share2 className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={handleClick}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
          'text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors',
          className
        )}
        title="Share"
      >
        <Share2 className="h-4 w-4" />
        {showLabel && (
          <span className="text-sm font-medium">Share</span>
        )}
      </button>

      {showMenu && (
        <div className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-green-600" />
                <span className="text-green-600">Copied!</span>
              </>
            ) : (
              <>
                <Link className="h-4 w-4" />
                <span>Copy link</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleShare('email')}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Mail className="h-4 w-4" />
            <span>Email</span>
          </button>
          <button
            onClick={() => handleShare('message')}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <MessageSquare className="h-4 w-4" />
            <span>Share in discussion</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ShareButton
