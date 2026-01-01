import React, { useState, useEffect } from 'react'
import { ExternalLink, Globe, ChevronDown, ChevronUp, Trash2, Edit2, RefreshCw, Image, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'

interface EmbedCardProps {
  url: string
  title: string | null
  description: string | null
  imageUrl: string | null
  faviconUrl: string | null
  siteName: string | null
  isExpanded?: boolean
  onToggleExpand?: () => void
  onDelete?: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
  isEditable?: boolean
}

export function EmbedCard({
  url,
  title,
  description,
  imageUrl,
  faviconUrl,
  siteName,
  isExpanded = false,
  onToggleExpand,
  onDelete,
  onRefresh,
  isRefreshing = false,
  isEditable = true
}: EmbedCardProps) {
  const [imageError, setImageError] = useState(false)
  const [faviconError, setFaviconError] = useState(false)

  // Reset error states when URLs change
  useEffect(() => {
    setImageError(false)
    setFaviconError(false)
  }, [imageUrl, faviconUrl])

  const displayTitle = title || new URL(url).hostname
  const displaySiteName = siteName || new URL(url).hostname

  const handleOpenUrl = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      className={clsx(
        'group relative border border-gray-200 rounded-lg overflow-hidden',
        'bg-white hover:border-gray-300 transition-colors',
        isExpanded ? 'max-w-full' : 'max-w-md'
      )}
    >
      {/* Main clickable area */}
      <div
        className="cursor-pointer"
        onClick={handleOpenUrl}
      >
        {/* Image preview (if available and expanded or large card) */}
        {imageUrl && !imageError && (
          <div className={clsx(
            'relative bg-gray-100',
            isExpanded ? 'h-48' : 'h-32'
          )}>
            <img
              src={imageUrl}
              alt={displayTitle}
              onError={() => setImageError(true)}
              className="w-full h-full object-cover"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
          </div>
        )}

        {/* Content */}
        <div className="p-3">
          {/* Site info */}
          <div className="flex items-center gap-2 mb-2">
            {faviconUrl && !faviconError ? (
              <img
                src={faviconUrl}
                alt=""
                onError={() => setFaviconError(true)}
                className="w-4 h-4 rounded"
              />
            ) : (
              <Globe className="w-4 h-4 text-gray-400" />
            )}
            <span className="text-xs text-gray-500 truncate">
              {displaySiteName}
            </span>
          </div>

          {/* Title */}
          <h4 className="font-medium text-gray-900 text-sm leading-tight mb-1 line-clamp-2">
            {displayTitle}
          </h4>

          {/* Description */}
          {description && (
            <p className={clsx(
              'text-xs text-gray-600 leading-relaxed',
              isExpanded ? 'line-clamp-4' : 'line-clamp-2'
            )}>
              {description}
            </p>
          )}

          {/* URL */}
          <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
            <ExternalLink className="w-3 h-3" />
            <span className="truncate max-w-[200px]">{url}</span>
          </div>
        </div>
      </div>

      {/* Action buttons (visible on hover or when editing) */}
      {isEditable && (
        <div className={clsx(
          'absolute top-2 right-2 flex items-center gap-1',
          'opacity-0 group-hover:opacity-100 transition-opacity'
        )}>
          {onToggleExpand && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand()
              }}
              className="p-1.5 bg-white/90 hover:bg-white rounded-md shadow-sm border border-gray-200 text-gray-600 hover:text-gray-800"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {onRefresh && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRefresh()
              }}
              disabled={isRefreshing}
              className={clsx(
                'p-1.5 bg-white/90 hover:bg-white rounded-md shadow-sm border border-gray-200',
                isRefreshing ? 'text-gray-400' : 'text-gray-600 hover:text-gray-800'
              )}
              title="Refresh metadata"
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
            </button>
          )}

          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="p-1.5 bg-white/90 hover:bg-white rounded-md shadow-sm border border-gray-200 text-gray-600 hover:text-red-500"
              title="Remove embed"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Loading overlay */}
      {isRefreshing && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Refreshing...
          </div>
        </div>
      )}
    </div>
  )
}

// Compact inline version for embed preview in editor
export function EmbedCardInline({
  url,
  title,
  faviconUrl,
  siteName,
  onDelete,
  isEditable = true
}: Pick<EmbedCardProps, 'url' | 'title' | 'faviconUrl' | 'siteName' | 'onDelete' | 'isEditable'>) {
  const [faviconError, setFaviconError] = useState(false)

  const displayTitle = title || url
  const displaySiteName = siteName || new URL(url).hostname

  const handleOpenUrl = () => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="group inline-flex items-center gap-2 px-2 py-1 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors max-w-full">
      {/* Favicon */}
      {faviconUrl && !faviconError ? (
        <img
          src={faviconUrl}
          alt=""
          onError={() => setFaviconError(true)}
          className="w-4 h-4 rounded flex-shrink-0"
        />
      ) : (
        <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
      )}

      {/* Link */}
      <button
        onClick={handleOpenUrl}
        className="text-sm text-blue-600 hover:text-blue-700 hover:underline truncate max-w-[300px]"
      >
        {displayTitle}
      </button>

      {/* Site name */}
      <span className="text-xs text-gray-400 flex-shrink-0">
        {displaySiteName}
      </span>

      {/* Delete button */}
      {isEditable && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-opacity flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

export default EmbedCard
