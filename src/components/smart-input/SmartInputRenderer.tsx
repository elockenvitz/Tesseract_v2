import React, { useMemo } from 'react'
import { clsx } from 'clsx'
import {
  AtSign,
  Hash,
  DollarSign,
  TrendingUp,
  BarChart3,
  PieChart,
  Calculator,
  Percent,
  Sparkles,
  ExternalLink
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { EntityType, getEntityColor } from '../../hooks/useEntitySearch'
import {
  MENTION_REGEX,
  REFERENCE_REGEX,
  DATA_SNAPSHOT_REGEX,
  DATA_LIVE_REGEX,
  AI_CONTENT_REGEX,
  DataFunctionType
} from './types'

export interface SmartInputRendererProps {
  content: string
  onMentionClick?: (userId: string) => void
  onReferenceClick?: (type: EntityType, id: string) => void
  className?: string
  renderMarkdown?: boolean
  inline?: boolean
}

interface ParsedSegment {
  type: 'text' | 'mention' | 'reference' | 'data-snapshot' | 'data-live' | 'ai-content'
  content: string
  data?: any
}

export function SmartInputRenderer({
  content,
  onMentionClick,
  onReferenceClick,
  className,
  renderMarkdown = true,
  inline = false
}: SmartInputRendererProps) {
  // Parse content into segments
  const segments = useMemo(() => parseContent(content), [content])

  const Wrapper = inline ? 'span' : 'div'

  return (
    <Wrapper className={clsx('smart-input-rendered', inline && 'inline', className)}>
      {segments.map((segment, index) => (
        <SegmentRenderer
          key={index}
          segment={segment}
          onMentionClick={onMentionClick}
          onReferenceClick={onReferenceClick}
          renderMarkdown={renderMarkdown}
          inline={inline}
        />
      ))}
    </Wrapper>
  )
}

function parseContent(content: string): ParsedSegment[] {
  const segments: ParsedSegment[] = []
  let lastIndex = 0

  // Combined regex to find all special patterns
  const patterns = [
    { regex: /@\[([^\]]+)\]\(user:([a-f0-9-]+)\)/g, type: 'mention' as const },
    { regex: /#\[([^\]]+)\]\((\w+):([a-f0-9-]+)\)/g, type: 'reference' as const },
    { regex: /\.data\[(\w+):snapshot:([^:]+):([^\]]+)\]/g, type: 'data-snapshot' as const },
    { regex: /\.data\[(\w+):live:([a-f0-9-]+)\]/g, type: 'data-live' as const },
    { regex: /\.AI\[([^\]]*)\]\{([^}]*)\}/g, type: 'ai-content' as const }
  ]

  // Find all matches with their positions
  interface Match {
    index: number
    length: number
    type: ParsedSegment['type']
    data: any
    fullMatch: string
  }

  const allMatches: Match[] = []

  patterns.forEach(({ regex, type }) => {
    let match
    const regexCopy = new RegExp(regex.source, regex.flags)
    while ((match = regexCopy.exec(content)) !== null) {
      const data: any = {}

      switch (type) {
        case 'mention':
          data.displayName = match[1]
          data.userId = match[2]
          break
        case 'reference':
          data.display = match[1]
          data.entityType = match[2]
          data.entityId = match[3]
          break
        case 'data-snapshot':
          data.dataType = match[1]
          data.value = match[2]
          data.date = match[3]
          break
        case 'data-live':
          data.dataType = match[1]
          data.assetId = match[2]
          break
        case 'ai-content':
          data.prompt = match[1]
          data.content = match[2]
          break
      }

      allMatches.push({
        index: match.index,
        length: match[0].length,
        type,
        data,
        fullMatch: match[0]
      })
    }
  })

  // Sort matches by position
  allMatches.sort((a, b) => a.index - b.index)

  // Build segments
  allMatches.forEach(match => {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: content.substring(lastIndex, match.index)
      })
    }

    // Add the match
    segments.push({
      type: match.type,
      content: match.fullMatch,
      data: match.data
    })

    lastIndex = match.index + match.length
  })

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      content: content.substring(lastIndex)
    })
  }

  return segments
}

interface SegmentRendererProps {
  segment: ParsedSegment
  onMentionClick?: (userId: string) => void
  onReferenceClick?: (type: EntityType, id: string) => void
  renderMarkdown?: boolean
  inline?: boolean
}

function SegmentRenderer({
  segment,
  onMentionClick,
  onReferenceClick,
  renderMarkdown,
  inline
}: SegmentRendererProps) {
  switch (segment.type) {
    case 'text':
      if (renderMarkdown) {
        return (
          <span className={clsx('prose prose-sm max-w-none', inline && 'inline prose-p:inline prose-p:m-0')}>
            <ReactMarkdown>{segment.content}</ReactMarkdown>
          </span>
        )
      }
      return <span>{segment.content}</span>

    case 'mention':
      return (
        <MentionChip
          displayName={segment.data.displayName}
          userId={segment.data.userId}
          onClick={onMentionClick}
        />
      )

    case 'reference':
      return (
        <ReferenceChip
          display={segment.data.display}
          entityType={segment.data.entityType}
          entityId={segment.data.entityId}
          onClick={onReferenceClick}
        />
      )

    case 'data-snapshot':
      return (
        <DataSnapshotChip
          dataType={segment.data.dataType}
          value={segment.data.value}
          date={segment.data.date}
        />
      )

    case 'data-live':
      return (
        <DataLiveChip
          dataType={segment.data.dataType}
          assetId={segment.data.assetId}
        />
      )

    case 'ai-content':
      return (
        <AIContentBlock
          prompt={segment.data.prompt}
          content={segment.data.content}
        />
      )

    default:
      return <span>{segment.content}</span>
  }
}

// Mention chip component
interface MentionChipProps {
  displayName: string
  userId: string
  onClick?: (userId: string) => void
}

function MentionChip({ displayName, userId, onClick }: MentionChipProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(userId)}
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-sm',
        'bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors',
        onClick && 'cursor-pointer'
      )}
    >
      <AtSign className="w-3 h-3 mr-1" />
      {displayName}
    </button>
  )
}

// Reference chip component
interface ReferenceChipProps {
  display: string
  entityType: EntityType
  entityId: string
  onClick?: (type: EntityType, id: string) => void
}

function ReferenceChip({ display, entityType, entityId, onClick }: ReferenceChipProps) {
  const color = getEntityColor(entityType)
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
    green: 'bg-green-100 text-green-800 hover:bg-green-200',
    purple: 'bg-purple-100 text-purple-800 hover:bg-purple-200',
    orange: 'bg-orange-100 text-orange-800 hover:bg-orange-200',
    gray: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
    cyan: 'bg-cyan-100 text-cyan-800 hover:bg-cyan-200',
    pink: 'bg-pink-100 text-pink-800 hover:bg-pink-200'
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(entityType, entityId)}
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-sm transition-colors',
        colorClasses[color] || colorClasses.gray,
        onClick && 'cursor-pointer'
      )}
    >
      <Hash className="w-3 h-3 mr-1" />
      {display}
      <span className="ml-1 text-xs opacity-60">{entityType}</span>
    </button>
  )
}

// Data snapshot chip
interface DataSnapshotChipProps {
  dataType: DataFunctionType
  value: string
  date: string
}

function DataSnapshotChip({ dataType, value, date }: DataSnapshotChipProps) {
  const Icon = getDataIcon(dataType)

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-sm">
      <Icon className="w-3 h-3 mr-1 text-gray-500" />
      {value}
      <span className="ml-1 text-xs text-gray-400">({date})</span>
    </span>
  )
}

// Live data chip (would fetch current value)
interface DataLiveChipProps {
  dataType: DataFunctionType
  assetId: string
}

function DataLiveChip({ dataType, assetId }: DataLiveChipProps) {
  const Icon = getDataIcon(dataType)

  // In a real implementation, this would use a hook to fetch live data
  // For now, show a placeholder
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-sm border border-emerald-200">
      <Icon className="w-3 h-3 mr-1" />
      <span className="animate-pulse">Loading...</span>
      <ExternalLink className="w-3 h-3 ml-1 opacity-50" />
    </span>
  )
}

// AI content block
interface AIContentBlockProps {
  prompt: string
  content: string
}

function AIContentBlock({ prompt, content }: AIContentBlockProps) {
  return (
    <span className="inline-flex items-start bg-purple-50 border-l-2 border-purple-400 px-2 py-1 rounded-r text-sm">
      <Sparkles className="w-3 h-3 mr-1.5 mt-0.5 text-purple-500 flex-shrink-0" />
      <span className="text-gray-700">{content}</span>
    </span>
  )
}

// Helper to get icon for data type
function getDataIcon(dataType: DataFunctionType) {
  const icons: Record<DataFunctionType, React.ElementType> = {
    price: DollarSign,
    change: TrendingUp,
    volume: BarChart3,
    marketcap: PieChart,
    pe_ratio: Calculator,
    dividend_yield: Percent
  }
  return icons[dataType] || DollarSign
}
