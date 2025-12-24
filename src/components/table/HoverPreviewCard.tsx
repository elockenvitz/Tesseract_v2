/**
 * HoverPreviewCard - Rich hover preview for table rows
 *
 * Features:
 * - 300ms delay before appearing (prevents flickering)
 * - 7-day sparkline chart
 * - Key metrics: price, change, volume
 * - Quick actions: Add to list, Change priority, Analyze
 * - Position-aware rendering (flips at viewport edges)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Star,
  ListPlus,
  Sparkles,
  ExternalLink,
  Clock,
  BarChart3,
  Activity,
  Building2,
  Tag
} from 'lucide-react'

export interface HoverPreviewData {
  id: string
  symbol: string
  companyName?: string
  sector?: string
  price?: number
  change?: number
  changePercent?: number
  volume?: number
  avgVolume?: number
  marketCap?: number
  priority?: string
  stage?: string
  sparklineData?: number[]
  lastUpdated?: string
  coverageAnalyst?: string
}

interface HoverPreviewCardProps {
  data: HoverPreviewData | null
  anchorRect: DOMRect | null
  isVisible: boolean
  onClose: () => void
  onQuickAction?: (action: 'add-to-list' | 'change-priority' | 'analyze' | 'open') => void
}

// Simple sparkline component
function Sparkline({ data, width = 120, height = 40, positive = true }: {
  data: number[]
  width?: number
  height?: number
  positive?: boolean
}) {
  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-gray-400"
        style={{ width, height }}
      >
        <Activity className="w-4 h-4 opacity-50" />
      </div>
    )
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width
    const y = height - ((value - min) / range) * height * 0.8 - height * 0.1
    return `${x},${y}`
  }).join(' ')

  const fillPoints = `0,${height} ${points} ${width},${height}`

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Gradient fill */}
      <defs>
        <linearGradient id={`gradient-${positive ? 'up' : 'down'}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={positive ? '#22c55e' : '#ef4444'} stopOpacity="0.3" />
          <stop offset="100%" stopColor={positive ? '#22c55e' : '#ef4444'} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Fill area */}
      <polygon
        points={fillPoints}
        fill={`url(#gradient-${positive ? 'up' : 'down'})`}
      />

      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke={positive ? '#22c55e' : '#ef4444'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* End dot */}
      <circle
        cx={width}
        cy={height - ((data[data.length - 1] - min) / range) * height * 0.8 - height * 0.1}
        r="3"
        fill={positive ? '#22c55e' : '#ef4444'}
      />
    </svg>
  )
}

// Format large numbers
function formatNumber(num: number | undefined, decimals = 2): string {
  if (num === undefined || num === null) return '—'

  if (num >= 1e12) return `${(num / 1e12).toFixed(decimals)}T`
  if (num >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`
  if (num >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`

  return num.toFixed(decimals)
}

// Format currency
function formatCurrency(num: number | undefined): string {
  if (num === undefined || num === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num)
}

export function HoverPreviewCard({
  data,
  anchorRect,
  isVisible,
  onClose,
  onQuickAction
}: HoverPreviewCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'right' | 'left' | 'above' | 'below' }>({
    top: 0,
    left: 0,
    placement: 'right'
  })

  // Calculate position based on anchor and viewport
  useEffect(() => {
    if (!anchorRect || !cardRef.current || !isVisible) return

    const cardWidth = 320
    const cardHeight = 280
    const padding = 12
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let placement: 'right' | 'left' | 'above' | 'below' = 'right'
    let top = anchorRect.top
    let left = anchorRect.right + padding

    // Check if it fits on the right
    if (left + cardWidth > viewportWidth - padding) {
      // Try left side
      left = anchorRect.left - cardWidth - padding
      placement = 'left'

      // If still doesn't fit, try above/below
      if (left < padding) {
        left = Math.max(padding, Math.min(anchorRect.left, viewportWidth - cardWidth - padding))

        if (anchorRect.top > viewportHeight / 2) {
          // Place above
          top = anchorRect.top - cardHeight - padding
          placement = 'above'
        } else {
          // Place below
          top = anchorRect.bottom + padding
          placement = 'below'
        }
      }
    }

    // Ensure vertical bounds
    top = Math.max(padding, Math.min(top, viewportHeight - cardHeight - padding))

    setPosition({ top, left, placement })
  }, [anchorRect, isVisible])

  // Close on scroll
  useEffect(() => {
    if (!isVisible) return

    const handleScroll = () => onClose()
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true })

    return () => window.removeEventListener('scroll', handleScroll, { capture: true })
  }, [isVisible, onClose])

  // Close on click outside
  useEffect(() => {
    if (!isVisible) return

    const handleClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isVisible, onClose])

  if (!isVisible || !data || !anchorRect) return null

  const isPositive = (data.changePercent ?? 0) >= 0
  const volumeRatio = data.volume && data.avgVolume ? data.volume / data.avgVolume : undefined

  return createPortal(
    <div
      ref={cardRef}
      className={clsx(
        'fixed z-50 w-80 bg-white dark:bg-dark-card rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden',
        'animate-in fade-in zoom-in-95 duration-150',
        position.placement === 'right' && 'origin-left',
        position.placement === 'left' && 'origin-right',
        position.placement === 'above' && 'origin-bottom',
        position.placement === 'below' && 'origin-top'
      )}
      style={{
        top: position.top,
        left: position.left
      }}
      onMouseLeave={onClose}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-dark-card border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-gray-900 dark:text-gray-100">
                {data.symbol}
              </span>
              {data.priority && data.priority !== 'none' && (
                <span className={clsx(
                  'px-1.5 py-0.5 text-[10px] font-medium rounded',
                  data.priority === 'high' && 'bg-red-100 text-red-700',
                  data.priority === 'medium' && 'bg-yellow-100 text-yellow-700',
                  data.priority === 'low' && 'bg-green-100 text-green-700'
                )}>
                  {data.priority.toUpperCase()}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {data.companyName || 'Unknown Company'}
            </p>
          </div>

          {/* Price & Change */}
          <div className="text-right shrink-0">
            <div className="font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(data.price)}
            </div>
            <div className={clsx(
              'flex items-center gap-1 text-sm',
              isPositive ? 'text-green-600' : 'text-red-600'
            )}>
              {isPositive ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              <span>
                {isPositive ? '+' : ''}{(data.changePercent ?? 0).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sparkline Chart */}
      <div className="px-4 py-3 bg-gray-50/50 dark:bg-gray-900/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            7-Day Trend
          </span>
          <BarChart3 className="w-3.5 h-3.5 text-gray-400" />
        </div>
        <Sparkline
          data={data.sparklineData || []}
          width={280}
          height={50}
          positive={isPositive}
        />
      </div>

      {/* Key Metrics */}
      <div className="px-4 py-3 grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-700">
        <div>
          <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">
            Volume
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {formatNumber(data.volume, 1)}
            </span>
            {volumeRatio && (
              <span className={clsx(
                'text-[10px] font-medium px-1 py-0.5 rounded',
                volumeRatio > 1.5 ? 'bg-blue-100 text-blue-700' :
                volumeRatio < 0.5 ? 'bg-gray-100 text-gray-600' :
                'bg-gray-50 text-gray-500'
              )}>
                {volumeRatio.toFixed(1)}x avg
              </span>
            )}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">
            Market Cap
          </div>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {formatNumber(data.marketCap, 1)}
          </span>
        </div>

        {data.sector && (
          <div className="col-span-2 flex items-center gap-1.5">
            <Tag className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">{data.sector}</span>
          </div>
        )}

        {data.coverageAnalyst && (
          <div className="col-span-2 flex items-center gap-1.5">
            <Building2 className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">
              Coverage: {data.coverageAnalyst}
            </span>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 flex items-center gap-1">
        <button
          onClick={() => onQuickAction?.('add-to-list')}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <ListPlus className="w-3.5 h-3.5" />
          <span>Add to List</span>
        </button>

        <button
          onClick={() => onQuickAction?.('change-priority')}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <Star className="w-3.5 h-3.5" />
          <span>Priority</span>
        </button>

        <button
          onClick={() => onQuickAction?.('analyze')}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Analyze</span>
        </button>

        <button
          onClick={() => onQuickAction?.('open')}
          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="Open Details"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* Last Updated */}
      {data.lastUpdated && (
        <div className="px-4 py-1.5 bg-gray-100/50 dark:bg-gray-900/70 flex items-center justify-center gap-1 text-[10px] text-gray-400">
          <Clock className="w-3 h-3" />
          <span>Updated {data.lastUpdated}</span>
        </div>
      )}
    </div>,
    document.body
  )
}

export default HoverPreviewCard
