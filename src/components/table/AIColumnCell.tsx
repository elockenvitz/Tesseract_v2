/**
 * AIColumnCell - Cell component for AI-generated columns
 *
 * Shows cached content or generate button, with loading states
 */

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, RefreshCw, Loader2, ChevronRight, X, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'

interface AIColumnCellProps {
  columnId: string
  columnName: string
  assetId: string
  assetSymbol: string
  content: string | null
  isLoading?: boolean
  error?: string | null
  onGenerate: () => void
  onRefresh: () => void
  density?: 'comfortable' | 'compact' | 'ultra'
}

export function AIColumnCell({
  columnId,
  columnName,
  assetId,
  assetSymbol,
  content,
  isLoading = false,
  error = null,
  onGenerate,
  onRefresh,
  density = 'comfortable',
}: AIColumnCellProps) {
  const [showPopover, setShowPopover] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 })

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (content) {
      // Show full content in popover
      const rect = e.currentTarget.getBoundingClientRect()
      setPopoverPosition({
        x: Math.min(rect.left, window.innerWidth - 350),
        y: Math.min(rect.bottom + 4, window.innerHeight - 300),
      })
      setShowPopover(true)
    } else if (!isLoading) {
      // Generate content
      onGenerate()
    }
  }

  // No content yet
  if (!content && !isLoading) {
    return (
      <button
        onClick={handleClick}
        className={clsx(
          'flex items-center gap-1.5 text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded px-1.5 py-0.5 transition-colors',
          density === 'ultra' && 'text-xs'
        )}
      >
        <Sparkles className={clsx('flex-shrink-0', density === 'ultra' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        <span className="text-sm">Generate</span>
      </button>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={clsx(
        'flex items-center gap-1.5 text-gray-400',
        density === 'ultra' && 'text-xs'
      )}>
        <Loader2 className={clsx('animate-spin flex-shrink-0', density === 'ultra' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        <span className="text-sm">Generating...</span>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={clsx(
        'flex items-center gap-1.5 text-red-500',
        density === 'ultra' && 'text-xs'
      )}>
        <AlertCircle className={clsx('flex-shrink-0', density === 'ultra' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        <span className="text-sm truncate" title={error}>Error</span>
        <button
          onClick={(e) => { e.stopPropagation(); onGenerate() }}
          className="p-0.5 hover:bg-red-50 rounded"
          title="Retry"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
    )
  }

  // Has content
  const truncatedContent = content && content.length > 60
    ? content.slice(0, 60) + '...'
    : content

  return (
    <>
      <div
        onClick={handleClick}
        className={clsx(
          'group relative cursor-pointer w-full',
          density === 'ultra' && 'text-xs'
        )}
      >
        <div className="flex items-center gap-1">
          <span className={clsx(
            'text-gray-600 truncate flex-1',
            density === 'ultra' ? 'text-xs' : 'text-sm'
          )}>
            {truncatedContent}
          </span>
          {content && content.length > 60 && (
            <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>

        {/* Refresh button on hover */}
        <button
          onClick={(e) => { e.stopPropagation(); onRefresh() }}
          className="absolute right-0 top-1/2 -translate-y-1/2 p-1 bg-white border border-gray-200 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3 text-gray-400" />
        </button>
      </div>

      {/* Full Content Popover */}
      {showPopover && content && (
        <AIContentPopover
          columnName={columnName}
          assetSymbol={assetSymbol}
          content={content}
          position={popoverPosition}
          onClose={() => setShowPopover(false)}
          onRefresh={() => { onRefresh(); setShowPopover(false) }}
        />
      )}
    </>
  )
}

interface AIContentPopoverProps {
  columnName: string
  assetSymbol: string
  content: string
  position: { x: number; y: number }
  onClose: () => void
  onRefresh: () => void
}

function AIContentPopover({
  columnName,
  assetSymbol,
  content,
  position,
  onClose,
  onRefresh,
}: AIContentPopoverProps) {
  const popoverRef = React.useRef<HTMLDivElement>(null)

  // Close on outside click
  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 w-80 max-h-80 animate-in fade-in slide-in-from-top-2 duration-150"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <div>
            <span className="text-xs text-gray-400 font-medium">{assetSymbol}</span>
            <span className="mx-1.5 text-gray-300">·</span>
            <span className="text-sm font-medium text-gray-900">{columnName}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4 text-gray-400" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto max-h-60">
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
          {content}
        </p>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 rounded-b-lg">
        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          AI-generated content
        </p>
      </div>
    </div>,
    document.body
  )
}

export default AIColumnCell
