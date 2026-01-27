/**
 * MetricPopover - Drill-down popovers for table metrics
 *
 * Click any metric (price, coverage, workflows, priority) to see detailed info.
 */

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X, TrendingUp, TrendingDown, Users, Target, Calendar,
  ExternalLink, ArrowRight, Clock, BarChart2, Activity
} from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow, format, subDays } from 'date-fns'
import { PriorityBadge } from '../ui/PriorityBadge'

interface PopoverPosition {
  x: number
  y: number
}

interface MetricPopoverProps {
  type: 'price' | 'coverage' | 'workflows' | 'priority'
  asset: any
  trigger: React.ReactNode
  quote?: { price?: number; changePercent?: number; high?: number; low?: number; volume?: number }
  coverage?: Array<{ analyst: string; team: string; isLead: boolean }>
  workflows?: Array<{ id: string; name: string; color: string }>
  onPriorityChange?: (priority: string) => void
  onNavigate?: () => void
  onWorkflowClick?: (workflowId: string) => void
}

export function MetricPopover({
  type,
  asset,
  trigger,
  quote,
  coverage = [],
  workflows = [],
  onPriorityChange,
  onNavigate,
  onWorkflowClick,
}: MetricPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition>({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      // Position below trigger, adjust if near edge
      let x = rect.left
      let y = rect.bottom + 4

      // Check if popover would go off screen
      if (x + 300 > window.innerWidth) {
        x = window.innerWidth - 310
      }
      if (y + 400 > window.innerHeight) {
        y = rect.top - 4
      }

      setPosition({ x, y })
      setIsOpen(true)
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const renderContent = () => {
    switch (type) {
      case 'price':
        return (
          <div className="space-y-3">
            {/* Current Price */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Current Price</span>
              <span className="text-lg font-semibold text-gray-900">
                ${(quote?.price || asset.current_price || 0).toFixed(2)}
              </span>
            </div>

            {/* Change */}
            {quote?.changePercent !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Today's Change</span>
                <span className={clsx(
                  'text-sm font-medium flex items-center gap-1',
                  quote.changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                )}>
                  {quote.changePercent >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
                </span>
              </div>
            )}

            {/* High/Low */}
            {(quote?.high || quote?.low) && (
              <div className="pt-2 border-t border-gray-100">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Day Range</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-red-600">${quote.low?.toFixed(2)}</span>
                  <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    {quote.low && quote.high && quote.price && (
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{
                          marginLeft: `${((quote.price - quote.low) / (quote.high - quote.low)) * 100}%`,
                          width: '4px'
                        }}
                      />
                    )}
                  </div>
                  <span className="text-xs font-medium text-green-600">${quote.high?.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Volume */}
            {quote?.volume && (
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <span className="text-sm text-gray-500">Volume</span>
                <span className="text-sm font-medium text-gray-700">
                  {(quote.volume / 1000000).toFixed(2)}M
                </span>
              </div>
            )}

            {/* Price Targets */}
            {asset.price_targets?.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
                  <Target className="h-3 w-3" />
                  <span>Price Targets</span>
                </div>
                <div className="space-y-1">
                  {asset.price_targets.slice(0, 3).map((target: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">{target.analyst || 'Analyst'}</span>
                      <span className="font-medium text-gray-900">${target.price?.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* View Details */}
            {onNavigate && (
              <button
                onClick={() => { onNavigate(); setIsOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                View Full Details <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )

      case 'coverage':
        return (
          <div className="space-y-2">
            {coverage.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No coverage assigned</p>
            ) : (
              coverage.map((analyst, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'flex items-center gap-3 px-2 py-1.5 rounded-md',
                    analyst.isLead ? 'bg-blue-50' : 'hover:bg-gray-50'
                  )}
                >
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                    {analyst.analyst.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{analyst.analyst}</p>
                      {analyst.isLead && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">Lead</span>
                      )}
                    </div>
                    {analyst.team && (
                      <p className="text-xs text-gray-500">{analyst.team}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )

      case 'workflows':
        return (
          <div className="space-y-2">
            {workflows.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No active workflows</p>
            ) : (
              workflows.map((workflow, idx) => (
                <button
                  key={idx}
                  onClick={() => { onWorkflowClick?.(workflow.id); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-gray-50 transition-colors text-left"
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: workflow.color }}
                  />
                  <span className="text-sm text-gray-900 flex-1">{workflow.name}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
                </button>
              ))
            )}
          </div>
        )

      case 'priority':
        const priorities = [
          { value: 'high', label: 'High', color: 'bg-red-100 text-red-700 border-red-200' },
          { value: 'medium', label: 'Medium', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
          { value: 'low', label: 'Low', color: 'bg-green-100 text-green-700 border-green-200' },
          { value: 'none', label: 'None', color: 'bg-gray-100 text-gray-700 border-gray-200' },
        ]
        return (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">Set priority level:</p>
            {priorities.map(priority => (
              <button
                key={priority.value}
                onClick={() => { onPriorityChange?.(priority.value); setIsOpen(false); }}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-md border transition-colors',
                  asset.priority === priority.value
                    ? priority.color + ' ring-2 ring-offset-1 ring-blue-500'
                    : 'border-gray-200 hover:bg-gray-50'
                )}
              >
                <span className={clsx(
                  'px-2 py-0.5 text-xs font-medium rounded',
                  priority.color
                )}>
                  {priority.label}
                </span>
                {asset.priority === priority.value && (
                  <span className="ml-auto text-xs text-blue-600">Current</span>
                )}
              </button>
            ))}
          </div>
        )

      default:
        return null
    }
  }

  const getTitle = () => {
    switch (type) {
      case 'price': return 'Price Details'
      case 'coverage': return 'Coverage Team'
      case 'workflows': return 'Active Workflows'
      case 'priority': return 'Change Priority'
      default: return ''
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleTriggerClick}
        className="text-left w-full"
      >
        {trigger}
      </button>

      {isOpen && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 w-72 animate-in fade-in slide-in-from-top-2 duration-150"
          style={{ left: position.x, top: position.y }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{asset.symbol}</span>
              <span className="text-sm font-medium text-gray-900">{getTitle()}</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          </div>

          {/* Content */}
          <div className="p-3">
            {renderContent()}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export default MetricPopover
