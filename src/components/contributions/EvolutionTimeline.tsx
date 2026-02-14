import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Target,
  AlertTriangle,
  DollarSign,
  FileText,
  ChevronDown,
  ChevronRight,
  Star,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Flag
} from 'lucide-react'
import { format, formatDistanceToNow, startOfWeek, startOfMonth, startOfQuarter } from 'date-fns'
import type { HistoryEvent, EvolutionAnalysis } from '../../hooks/useContributions'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type TimeGrouping = 'none' | 'week' | 'month' | 'quarter'
type Sentiment = 'bullish' | 'neutral' | 'bearish'

interface Milestone {
  date: string
  type: 'thesis_shift' | 'risk_identified' | 'price_target_change' | 'conviction_change'
  description: string
  significance: 'high' | 'medium' | 'low'
}

interface EvolutionTimelineProps {
  events: HistoryEvent[]
  milestones?: Milestone[]
  className?: string
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const typeConfig = {
  thesis: {
    icon: Target,
    label: 'Investment Thesis',
    color: 'text-primary-600',
    bgColor: 'bg-primary-50',
    borderColor: 'border-primary-200',
    dotColor: 'bg-primary-500'
  },
  where_different: {
    icon: Sparkles,
    label: 'Where Different',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    dotColor: 'bg-purple-500'
  },
  risks_to_thesis: {
    icon: AlertTriangle,
    label: 'Risks to Thesis',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    dotColor: 'bg-amber-500'
  },
  price_target: {
    icon: DollarSign,
    label: 'Price Target',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    dotColor: 'bg-green-500'
  },
  reference: {
    icon: FileText,
    label: 'Supporting Docs',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    dotColor: 'bg-blue-500'
  }
} as Record<string, { icon: React.ElementType; label: string; color: string; bgColor: string; borderColor: string; dotColor: string }>

const fallbackConfig = {
  icon: FileText,
  label: 'Update',
  color: 'text-gray-600',
  bgColor: 'bg-gray-50',
  borderColor: 'border-gray-200',
  dotColor: 'bg-gray-400'
}

const milestoneConfig = {
  thesis_shift: { color: 'bg-primary-500', label: 'Thesis Shift' },
  risk_identified: { color: 'bg-amber-500', label: 'Risk Identified' },
  price_target_change: { color: 'bg-green-500', label: 'Price Target Change' },
  conviction_change: { color: 'bg-purple-500', label: 'Conviction Change' }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getGroupKey(date: Date, grouping: TimeGrouping): string {
  switch (grouping) {
    case 'week':
      return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    case 'month':
      return format(startOfMonth(date), 'yyyy-MM')
    case 'quarter':
      return format(startOfQuarter(date), 'yyyy-QQQ')
    default:
      return 'all'
  }
}

function getGroupLabel(key: string, grouping: TimeGrouping): string {
  if (grouping === 'none') return ''

  const date = new Date(key)
  switch (grouping) {
    case 'week':
      return `Week of ${format(date, 'MMM d, yyyy')}`
    case 'month':
      return format(new Date(key + '-01'), 'MMMM yyyy')
    case 'quarter':
      const [year, q] = key.split('-')
      return `${q} ${year}`
    default:
      return key
  }
}

function detectSentiment(content: string | undefined): Sentiment | null {
  if (!content) return null

  const lowerContent = content.toLowerCase()

  const bullishIndicators = [
    'strong buy', 'outperform', 'upside', 'bullish', 'overweight',
    'positive', 'accelerating', 'growth', 'opportunity', 'undervalued',
    'conviction', 'confident'
  ]

  const bearishIndicators = [
    'sell', 'underperform', 'downside', 'bearish', 'underweight',
    'negative', 'declining', 'risk', 'concern', 'overvalued',
    'caution', 'avoid'
  ]

  let bullishScore = 0
  let bearishScore = 0

  bullishIndicators.forEach(word => {
    if (lowerContent.includes(word)) bullishScore++
  })

  bearishIndicators.forEach(word => {
    if (lowerContent.includes(word)) bearishScore++
  })

  if (bullishScore > bearishScore + 1) return 'bullish'
  if (bearishScore > bullishScore + 1) return 'bearish'
  return 'neutral'
}

function isSignificantChange(event: HistoryEvent): boolean {
  // Price target change > 20%
  if (event.type === 'price_target' && event.priceTarget && event.previousPriceTarget) {
    const change = Math.abs(
      (event.priceTarget - event.previousPriceTarget) / event.previousPriceTarget
    )
    return change > 0.2
  }

  // New content (not an edit)
  if (!event.previousContent && event.content) {
    return true
  }

  // Large content change
  if (event.previousContent && event.content) {
    const oldLen = event.previousContent.length
    const newLen = event.content.length
    const change = Math.abs(newLen - oldLen) / Math.max(oldLen, 1)
    return change > 0.5
  }

  return false
}

// ============================================================================
// TIMELINE EVENT COMPONENT
// ============================================================================

interface TimelineEventItemProps {
  event: HistoryEvent
  isLast: boolean
  isMilestone: boolean
  milestone?: Milestone
}

function TimelineEventItem({ event, isLast, isMilestone, milestone }: TimelineEventItemProps) {
  const [expanded, setExpanded] = useState(false)
  const config = typeConfig[event.type] || fallbackConfig
  const Icon = config.icon
  const sentiment = detectSentiment(event.content)
  const significant = isSignificantChange(event)

  const sentimentColors = {
    bullish: 'ring-green-400',
    neutral: 'ring-gray-300',
    bearish: 'ring-red-400'
  }

  // Calculate price change percentage
  const priceChange = event.type === 'price_target' && event.priceTarget && event.previousPriceTarget
    ? ((event.priceTarget - event.previousPriceTarget) / event.previousPriceTarget) * 100
    : null

  return (
    <div className="relative">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-4 top-10 w-0.5 h-full bg-gray-200" />
      )}

      {/* Milestone marker */}
      {isMilestone && milestone && (
        <div className="absolute -left-1 top-3">
          <div
            className={clsx(
              'w-2.5 h-2.5 rounded-full',
              milestoneConfig[milestone.type]?.color || 'bg-gray-400'
            )}
            title={milestone.description}
          />
        </div>
      )}

      <div className="flex gap-4">
        {/* Event dot with sentiment ring */}
        <div
          className={clsx(
            'relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 bg-white',
            config.borderColor,
            sentiment && sentimentColors[sentiment],
            sentiment && 'ring-2 ring-offset-1'
          )}
        >
          <Icon className={clsx('w-4 h-4', config.color)} />

          {/* Significance indicator */}
          {significant && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full flex items-center justify-center">
              <Star className="w-2 h-2 text-yellow-800 fill-yellow-800" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 pb-6">
          <div
            className={clsx(
              'p-3 rounded-lg border transition-all cursor-pointer hover:shadow-sm',
              config.bgColor,
              config.borderColor,
              significant && 'ring-1 ring-yellow-300'
            )}
            onClick={() => setExpanded(!expanded)}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx('text-xs font-semibold', config.color)}>
                    {config.label}
                  </span>

                  {/* Sentiment badge */}
                  {sentiment && (
                    <span className={clsx(
                      'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs',
                      sentiment === 'bullish' && 'bg-green-100 text-green-700',
                      sentiment === 'neutral' && 'bg-gray-100 text-gray-700',
                      sentiment === 'bearish' && 'bg-red-100 text-red-700'
                    )}>
                      {sentiment === 'bullish' && <TrendingUp className="w-2.5 h-2.5" />}
                      {sentiment === 'neutral' && <Minus className="w-2.5 h-2.5" />}
                      {sentiment === 'bearish' && <TrendingDown className="w-2.5 h-2.5" />}
                      {sentiment}
                    </span>
                  )}

                  {/* Milestone badge */}
                  {isMilestone && milestone && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">
                      <Flag className="w-2.5 h-2.5" />
                      Milestone
                    </span>
                  )}
                </div>

                {/* Price target display */}
                {event.type === 'price_target' && (
                  <div className="mt-1.5 flex items-center gap-2 text-sm">
                    {event.previousPriceTarget && (
                      <>
                        <span className="text-gray-400">${event.previousPriceTarget}</span>
                        <ChevronRight className="w-3 h-3 text-gray-300" />
                      </>
                    )}
                    <span className="font-semibold text-gray-900">${event.priceTarget}</span>
                    {priceChange !== null && (
                      <span className={clsx(
                        'text-xs px-1.5 py-0.5 rounded',
                        priceChange > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      )}>
                        {priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}

                {/* Content preview */}
                {event.type !== 'price_target' && event.content && (
                  <p className={clsx(
                    'mt-1.5 text-xs text-gray-600',
                    !expanded && 'line-clamp-2'
                  )}>
                    {event.previousContent ? (
                      <span className="text-gray-400 italic">Updated: </span>
                    ) : (
                      <span className="text-green-600 italic">New: </span>
                    )}
                    {event.content}
                  </p>
                )}
              </div>

              {/* Date and expand */}
              <div className="flex items-center gap-2 text-right flex-shrink-0">
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </div>
                {event.content && (
                  expanded
                    ? <ChevronDown className="w-4 h-4 text-gray-400" />
                    : <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
              </div>
            </div>

            {/* Expanded content with diff */}
            {expanded && event.previousContent && event.content && (
              <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                <div>
                  <span className="text-xs font-medium text-gray-500">Previous:</span>
                  <p className="text-xs text-gray-400 line-through mt-1">{event.previousContent}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500">Current:</span>
                  <p className="text-xs text-gray-700 mt-1">{event.content}</p>
                </div>
              </div>
            )}

            {/* Milestone description */}
            {isMilestone && milestone && (
              <div className="mt-2 pt-2 border-t border-purple-200">
                <p className="text-xs text-purple-700">
                  <span className="font-medium">{milestoneConfig[milestone.type]?.label}:</span>{' '}
                  {milestone.description}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// VISUAL TIMELINE BAR
// ============================================================================

interface TimelineBarProps {
  events: HistoryEvent[]
  milestones: Milestone[]
}

function TimelineBar({ events, milestones }: TimelineBarProps) {
  if (events.length === 0) return null

  const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const minDate = sortedEvents[0].timestamp.getTime()
  const maxDate = sortedEvents[sortedEvents.length - 1].timestamp.getTime()
  const range = maxDate - minDate || 1

  return (
    <div className="relative h-12 bg-gray-50 rounded-lg border border-gray-200 mb-4 overflow-hidden">
      {/* Timeline axis */}
      <div className="absolute inset-x-4 top-6 h-0.5 bg-gray-200" />

      {/* Date labels */}
      <div className="absolute left-4 top-1 text-xs text-gray-400">
        {format(sortedEvents[0].timestamp, 'MMM yyyy')}
      </div>
      <div className="absolute right-4 top-1 text-xs text-gray-400">
        {format(sortedEvents[sortedEvents.length - 1].timestamp, 'MMM yyyy')}
      </div>

      {/* Event dots */}
      {sortedEvents.map((event, idx) => {
        const position = range > 0
          ? ((event.timestamp.getTime() - minDate) / range) * 100
          : 50
        const config = typeConfig[event.type] || fallbackConfig
        const sentiment = detectSentiment(event.content)

        return (
          <div
            key={event.id}
            className="absolute top-5 transform -translate-x-1/2"
            style={{ left: `calc(${Math.max(5, Math.min(95, position))}%)` }}
            title={`${config.label} - ${format(event.timestamp, 'MMM d, yyyy')}`}
          >
            <div
              className={clsx(
                'w-3 h-3 rounded-full border-2 border-white shadow-sm',
                config.dotColor,
                sentiment === 'bullish' && 'ring-1 ring-green-400',
                sentiment === 'bearish' && 'ring-1 ring-red-400'
              )}
            />
          </div>
        )
      })}

      {/* Milestone markers */}
      {milestones.map((milestone, idx) => {
        const milestoneDate = new Date(milestone.date).getTime()
        if (milestoneDate < minDate || milestoneDate > maxDate) return null

        const position = range > 0
          ? ((milestoneDate - minDate) / range) * 100
          : 50

        return (
          <div
            key={idx}
            className="absolute top-3 transform -translate-x-1/2"
            style={{ left: `calc(${Math.max(5, Math.min(95, position))}%)` }}
            title={milestone.description}
          >
            <Flag
              className={clsx(
                'w-3 h-3',
                milestone.significance === 'high' ? 'text-red-500' :
                  milestone.significance === 'medium' ? 'text-amber-500' : 'text-gray-400'
              )}
            />
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function EvolutionTimeline({
  events,
  milestones = [],
  className
}: EvolutionTimelineProps) {
  const [grouping, setGrouping] = useState<TimeGrouping>('none')
  const [showOnlySignificant, setShowOnlySignificant] = useState(false)

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    let result = [...events]

    if (showOnlySignificant) {
      result = result.filter(e => isSignificantChange(e))
    }

    // Sort by timestamp descending (most recent first)
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    return result
  }, [events, showOnlySignificant])

  // Group events
  const groupedEvents = useMemo(() => {
    if (grouping === 'none') {
      return new Map([['all', filteredEvents]])
    }

    const groups = new Map<string, HistoryEvent[]>()
    filteredEvents.forEach(event => {
      const key = getGroupKey(event.timestamp, grouping)
      const existing = groups.get(key) || []
      existing.push(event)
      groups.set(key, existing)
    })

    return groups
  }, [filteredEvents, grouping])

  // Match milestones to events
  const getMilestoneForEvent = (event: HistoryEvent): Milestone | undefined => {
    return milestones.find(m => {
      const milestoneDate = new Date(m.date)
      const dayDiff = Math.abs(event.timestamp.getTime() - milestoneDate.getTime()) / (1000 * 60 * 60 * 24)
      return dayDiff < 1 // Within 1 day
    })
  }

  if (events.length === 0) {
    return (
      <div className={clsx(
        'bg-white border border-gray-200 rounded-lg p-6 text-center',
        className
      )}>
        <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No timeline events yet</p>
        <p className="text-xs text-gray-400 mt-1">Changes will appear here as you edit</p>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white border border-gray-200 rounded-lg overflow-hidden', className)}>
      {/* Header with filters */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">Evolution Timeline</h3>
            <span className="text-xs text-gray-400">
              ({filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''})
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Significant only toggle */}
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlySignificant}
                onChange={(e) => setShowOnlySignificant(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Significant only
            </label>

            {/* Grouping selector */}
            <select
              value={grouping}
              onChange={(e) => setGrouping(e.target.value as TimeGrouping)}
              className="text-xs bg-white border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="none">No grouping</option>
              <option value="week">By week</option>
              <option value="month">By month</option>
              <option value="quarter">By quarter</option>
            </select>
          </div>
        </div>
      </div>

      {/* Visual timeline bar */}
      <div className="px-4 pt-4">
        <TimelineBar events={events} milestones={milestones} />
      </div>

      {/* Legend */}
      <div className="px-4 pb-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        {Object.entries(typeConfig).map(([key, config]) => (
          <div key={key} className="flex items-center gap-1">
            <div className={clsx('w-2 h-2 rounded-full', config.dotColor)} />
            <span>{config.label}</span>
          </div>
        ))}
      </div>

      {/* Timeline events */}
      <div className="p-4">
        {Array.from(groupedEvents.entries()).map(([groupKey, groupEvents]) => (
          <div key={groupKey}>
            {/* Group header */}
            {grouping !== 'none' && (
              <div className="mb-3 pb-2 border-b border-gray-100">
                <h4 className="text-sm font-medium text-gray-700">
                  {getGroupLabel(groupKey, grouping)}
                </h4>
                <p className="text-xs text-gray-400">
                  {groupEvents.length} change{groupEvents.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}

            {/* Events in group */}
            <div className="space-y-0">
              {groupEvents.map((event, index) => {
                const milestone = getMilestoneForEvent(event)
                return (
                  <TimelineEventItem
                    key={event.id}
                    event={event}
                    isLast={index === groupEvents.length - 1}
                    isMilestone={!!milestone}
                    milestone={milestone}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default EvolutionTimeline
