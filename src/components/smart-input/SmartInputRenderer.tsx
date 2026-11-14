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
  ExternalLink,
  Lock,
  Users,
  Building2
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { EntityType, getEntityColor } from '../../hooks/useEntitySearch'
import {
  MENTION_REGEX,
  REFERENCE_REGEX,
  DATA_SNAPSHOT_REGEX,
  DATA_LIVE_REGEX,
  AI_CONTENT_REGEX,
  CHART_REGEX,
  VISIBILITY_PRIVATE_REGEX,
  VISIBILITY_TEAM_REGEX,
  VISIBILITY_PORTFOLIO_REGEX,
  DataFunctionType
} from './types'

export interface SmartInputRendererProps {
  content: string
  onMentionClick?: (userId: string) => void
  onReferenceClick?: (type: EntityType, id: string) => void
  className?: string
  renderMarkdown?: boolean
  inline?: boolean
  /**
   * Body size for block rendering. Defaults to `compact`, which is what every
   * existing caller gets. See `BLOCK_CLASS`. Ignored when `inline`, which has
   * no block elements of its own to size.
   */
  density?: SmartInputDensity
  // Viewer context for visibility filtering
  viewerId?: string
  viewerTeamIds?: string[]
  viewerPortfolioIds?: string[]
}

interface ParsedSegment {
  type: 'text' | 'mention' | 'reference' | 'data-snapshot' | 'data-live' | 'chart' | 'ai-content' | 'visibility-private' | 'visibility-team' | 'visibility-portfolio'
  content: string
  data?: any
}

export function SmartInputRenderer({
  content,
  onMentionClick,
  onReferenceClick,
  className,
  renderMarkdown = true,
  inline = false,
  density = 'compact',
  viewerId,
  viewerTeamIds = [],
  viewerPortfolioIds = []
}: SmartInputRendererProps) {
  // Parse content into segments, filtering based on viewer access
  const segments = useMemo(() =>
    parseContent(content, viewerId, viewerTeamIds, viewerPortfolioIds),
    [content, viewerId, viewerTeamIds, viewerPortfolioIds]
  )

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
          density={density}
        />
      ))}
    </Wrapper>
  )
}

function parseContent(
  content: string,
  viewerId?: string,
  viewerTeamIds: string[] = [],
  viewerPortfolioIds: string[] = []
): ParsedSegment[] {
  const segments: ParsedSegment[] = []
  let lastIndex = 0

  // Combined regex to find all special patterns
  const patterns = [
    { regex: /@\[([^\]]+)\]\(user:([a-f0-9-]+)\)/g, type: 'mention' as const },
    { regex: /#\[([^\]]+)\]\((\w+):([a-f0-9-]+)\)/g, type: 'reference' as const },
    { regex: /\.data\[(\w+):snapshot:([^:]+):([^\]]+)\]/g, type: 'data-snapshot' as const },
    { regex: /\.data\[(\w+):live:([a-f0-9-]+)\]/g, type: 'data-live' as const },
    { regex: /\.AI\[([^\]]*)\]\{([^}]*)\}/g, type: 'ai-content' as const },
    { regex: /\.chart\[(\w+):([A-Z0-9.]+)\]/g, type: 'chart' as const },
    // Visibility patterns
    { regex: /\[PRIVATE:([a-f0-9-]+)\]([\s\S]*?)\[\/PRIVATE\]/g, type: 'visibility-private' as const },
    { regex: /\[TEAM:([a-f0-9-]*):([^\]]*)\]([\s\S]*?)\[\/TEAM\]/g, type: 'visibility-team' as const },
    { regex: /\[PORTFOLIO:([a-f0-9-]*):([^\]]*)\]([\s\S]*?)\[\/PORTFOLIO\]/g, type: 'visibility-portfolio' as const }
  ]

  // Find all matches with their positions
  interface Match {
    index: number
    length: number
    type: ParsedSegment['type']
    data: any
    fullMatch: string
    hasAccess: boolean
  }

  const allMatches: Match[] = []

  patterns.forEach(({ regex, type }) => {
    let match
    const regexCopy = new RegExp(regex.source, regex.flags)
    while ((match = regexCopy.exec(content)) !== null) {
      const data: any = {}
      let hasAccess = true

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
        case 'chart':
          data.chartType = match[1]
          data.symbol = match[2]
          break
        case 'ai-content':
          data.prompt = match[1]
          data.content = match[2]
          break
        case 'visibility-private':
          data.authorId = match[1]
          data.innerContent = match[2]
          // Only show if viewer is the author
          hasAccess = viewerId === data.authorId
          break
        case 'visibility-team':
          data.teamId = match[1]
          data.teamName = match[2]
          data.innerContent = match[3]
          // Show if viewer is in the team (or if no teamId specified, show to all)
          hasAccess = !data.teamId || viewerTeamIds.includes(data.teamId)
          break
        case 'visibility-portfolio':
          data.portfolioId = match[1]
          data.portfolioName = match[2]
          data.innerContent = match[3]
          // Show if viewer has portfolio access (or if no portfolioId specified, show to all)
          hasAccess = !data.portfolioId || viewerPortfolioIds.includes(data.portfolioId)
          break
      }

      allMatches.push({
        index: match.index,
        length: match[0].length,
        type,
        data,
        fullMatch: match[0],
        hasAccess
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

    // For visibility segments, only add if user has access
    // For non-visibility segments, always add
    const isVisibility = match.type.startsWith('visibility-')
    if (isVisibility) {
      if (match.hasAccess) {
        // User has access - show the inner content with a visual indicator
        segments.push({
          type: match.type,
          content: match.data.innerContent,
          data: match.data
        })
      }
      // If no access, content is simply omitted
    } else {
      // Regular segment - add it
      segments.push({
        type: match.type,
        content: match.fullMatch,
        data: match.data
      })
    }

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

// ---------------------------------------------------------------------------
// FormattedTextBlock — Direct rendering with line breaks, bullets, spacing
// No ReactMarkdown — just parse lines into native HTML elements
// ---------------------------------------------------------------------------

/**
 * The heading sizes stored research is rendered at.
 *
 * Deliberately not h1/h2. A saved thesis is content INSIDE a page that
 * already has a title and section headings, so a `#` in the text is a
 * heading within that section, not a competitor to it. The element levels
 * start at h4 for the same reason: the document outline stays the page's.
 */
const RESEARCH_HEADING: Record<number, { tag: 'h4' | 'h5' | 'h6'; className: string }> = {
  1: { tag: 'h4', className: 'text-[15px] font-semibold text-gray-900 mt-3 mb-1 first:mt-0 dark:text-gray-100' },
  2: { tag: 'h4', className: 'text-[14px] font-semibold text-gray-900 mt-3 mb-1 first:mt-0 dark:text-gray-100' },
  3: { tag: 'h5', className: 'text-[13px] font-semibold text-gray-900 mt-2.5 mb-0.5 first:mt-0 dark:text-gray-100' },
  4: { tag: 'h5', className: 'text-[13px] font-semibold text-gray-800 mt-2 mb-0.5 first:mt-0 dark:text-gray-200' },
  5: { tag: 'h6', className: 'text-[12px] font-semibold uppercase tracking-wide text-gray-600 mt-2 mb-0.5 first:mt-0 dark:text-gray-400' },
  6: { tag: 'h6', className: 'text-[12px] font-semibold uppercase tracking-wide text-gray-500 mt-2 mb-0.5 first:mt-0 dark:text-gray-500' },
}

/**
 * The two sizes stored research is read at, and why there are two.
 *
 * `compact` is this renderer's original and still its default: a 14px grey
 * body that sits correctly inside a message bubble, a contribution card or a
 * summary row, where the text is one element among many.
 *
 * `reading` is for a surface where a saved section IS the content -- the
 * Asset Workspace's "The case", which sets its own 15px/1.7 measure. Before
 * this existed, such a surface had two bad options: interpolate the raw
 * string and show `**bold**` to the reader, or adopt a body size chosen for
 * message bubbles. The first is the defect this prop was added to close.
 *
 * Nothing about parsing changes between them. Only the class strings differ,
 * so a form that renders in one renders identically in the other.
 */
export type SmartInputDensity = 'compact' | 'reading'

const BLOCK_CLASS: Record<SmartInputDensity, { p: string; ul: string; ol: string; quote: string }> = {
  compact: {
    p: 'text-sm text-gray-700 my-0.5 leading-relaxed dark:text-gray-300',
    ul: 'list-disc pl-5 my-1.5 space-y-0.5 text-sm text-gray-700 dark:text-gray-300',
    ol: 'list-decimal pl-5 my-1.5 space-y-0.5 text-sm text-gray-700 dark:text-gray-300',
    quote: 'my-1.5 border-l-2 border-gray-300 pl-3 text-sm italic text-gray-600 dark:border-gray-600 dark:text-gray-400',
  },
  reading: {
    p: 'text-[15px] text-gray-900 my-1 leading-[1.7] dark:text-gray-100',
    ul: 'list-disc pl-5 my-2 space-y-1 text-[15px] leading-[1.7] text-gray-900 dark:text-gray-100',
    ol: 'list-decimal pl-5 my-2 space-y-1 text-[15px] leading-[1.7] text-gray-900 dark:text-gray-100',
    quote: 'my-2 border-l-2 border-gray-300 pl-3 text-[15px] italic leading-[1.7] text-gray-600 dark:border-gray-600 dark:text-gray-400',
  },
}

function FormattedTextBlock({ text, density = 'compact' }: { text: string; density?: SmartInputDensity }) {
  const block = BLOCK_CLASS[density]
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let bulletGroup: { prefix: string; content: string }[] = []
  let orderedGroup: { num: string; content: string }[] = []
  let quoteGroup: string[] = []

  const flushBullets = () => {
    if (bulletGroup.length === 0) return
    elements.push(
      <ul key={`ul-${elements.length}`} className={block.ul}>
        {bulletGroup.map((b, i) => <li key={i}>{applyInlineFormatting(b.content)}</li>)}
      </ul>
    )
    bulletGroup = []
  }

  const flushOrdered = () => {
    if (orderedGroup.length === 0) return
    elements.push(
      <ol key={`ol-${elements.length}`} className={block.ol}>
        {orderedGroup.map((b, i) => <li key={i}>{applyInlineFormatting(b.content)}</li>)}
      </ol>
    )
    orderedGroup = []
  }

  const flushQuote = () => {
    if (quoteGroup.length === 0) return
    elements.push(
      <blockquote
        key={`bq-${elements.length}`}
        className={block.quote}
      >
        {quoteGroup.map((q, i) => <p key={i} className="my-0.5">{applyInlineFormatting(q)}</p>)}
      </blockquote>
    )
    quoteGroup = []
  }

  /** Close every open group. One call, so no site can forget one. */
  const flushAll = () => { flushBullets(); flushOrdered(); flushQuote() }

  for (const line of lines) {
    /*
     * A heading. This was the reported defect's other half: stored research
     * written in Markdown rendered its `##` literally, because this renderer
     * knew about lists and emphasis and nothing else. Checked before the
     * bullet branch, since neither `#` nor `>` can open a list.
     */
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.*\S)\s*$/)
    if (headingMatch) {
      flushAll()
      const level = headingMatch[1].length
      const { tag: Tag, className } = RESEARCH_HEADING[level]
      elements.push(
        <Tag key={`h-${elements.length}`} className={className}>
          {applyInlineFormatting(headingMatch[2])}
        </Tag>
      )
      continue
    }

    // A thematic break. Checked before bullets: `---` has no space after the
    // dash, so it is not a list item, but being explicit keeps it that way.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll()
      elements.push(<hr key={`hr-${elements.length}`} className="my-2 border-gray-200 dark:border-gray-700" />)
      continue
    }

    // A quoted line. Consecutive ones become one blockquote.
    const quoteMatch = line.match(/^\s*>\s?(.*)$/)
    if (quoteMatch) {
      flushBullets()
      flushOrdered()
      quoteGroup.push(quoteMatch[1])
      continue
    }
    flushQuote()

    // Bullet list item: -, *, +, •, –
    const bulletMatch = line.match(/^\s*[-*+•–]\s+(.*)/)
    if (bulletMatch) {
      flushOrdered()
      bulletGroup.push({ prefix: '-', content: bulletMatch[1] })
      continue
    }

    // Ordered list item: 1. 2. etc.
    const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*)/)
    if (orderedMatch) {
      flushBullets()
      orderedGroup.push({ num: orderedMatch[1], content: orderedMatch[2] })
      continue
    }

    // Not a list item — flush any open lists
    flushBullets()
    flushOrdered()

    // Blank line → visible spacer
    if (line.trim() === '') {
      elements.push(<div key={`br-${elements.length}`} className="h-3" />)
      continue
    }

    // Regular text paragraph
    elements.push(
      <p key={`p-${elements.length}`} className={block.p}>
        {applyInlineFormatting(line)}
      </p>
    )
  }

  flushAll()

  return <div>{elements}</div>
}

/**
 * Inline emphasis, code and strikethrough, left to right.
 *
 * Candidates are matched independently and the LEFTMOST wins, so a line that
 * mixes them resolves in reading order rather than in the order the patterns
 * happen to be written. Code wins ties, because backticks are the one marker
 * whose whole point is that what is inside them is not formatted.
 *
 * Nothing here produces HTML from the text. Every branch emits a React
 * element whose children are strings, so a stored case containing
 * `<script>` or `<img onerror=...>` is shown as those characters and never
 * parsed -- the reason this is a hand-rolled scan and not `rehype-raw`.
 */
function applyInlineFormatting(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const code = remaining.match(/`([^`]+)`/)
    const bold = remaining.match(/\*\*(.+?)\*\*|__(.+?)__/)
    const strike = remaining.match(/~~(.+?)~~/)
    /*
     * Italic, but never a half of `**`, and never across a space-padded pair.
     *
     * The old rule was `\*(.+?)\*`, which turned "Margins improved * see
     * footnote 4 * for the basis" into italics and ATE both asterisks: a
     * footnote marker in a stored case came back as formatting. Markdown
     * requires the opening marker to be followed by a non-space and the
     * closing one to be preceded by a non-space, which is exactly the
     * distinction between emphasis and punctuation, so that is the rule.
     */
    const italic = remaining.match(/(?<!\*)\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?!\*)|(?<!_)_(?![\s_])([^_\n]+?)(?<![\s_])_(?!_)/)

    type Candidate = { at: number; len: number; node: (k: number) => React.ReactNode }
    const candidates: Candidate[] = []
    if (code) candidates.push({
      at: code.index!, len: code[0].length,
      node: k => <code key={k} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-gray-800">{code[1]}</code>,
    })
    if (bold) candidates.push({
      at: bold.index!, len: bold[0].length,
      node: k => <strong key={k}>{bold[1] || bold[2]}</strong>,
    })
    if (strike) candidates.push({
      at: strike.index!, len: strike[0].length,
      node: k => <s key={k} className="text-gray-500">{strike[1]}</s>,
    })
    if (italic) candidates.push({
      at: italic.index!, len: italic[0].length,
      node: k => <em key={k}>{italic[1] || italic[2]}</em>,
    })

    if (candidates.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }

    /* Leftmost wins; on a tie the earlier candidate does, and `code` is
       pushed first for exactly that reason. */
    const next = candidates.reduce((best, c) => (c.at < best.at ? c : best), candidates[0])
    if (next.at > 0) parts.push(<span key={key++}>{remaining.slice(0, next.at)}</span>)
    parts.push(next.node(key++))
    remaining = remaining.slice(next.at + next.len)
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>
}

interface SegmentRendererProps {
  segment: ParsedSegment
  onMentionClick?: (userId: string) => void
  onReferenceClick?: (type: EntityType, id: string) => void
  renderMarkdown?: boolean
  inline?: boolean
  density?: SmartInputDensity
}

function SegmentRenderer({
  segment,
  onMentionClick,
  onReferenceClick,
  renderMarkdown,
  inline,
  density
}: SegmentRendererProps) {
  switch (segment.type) {
    case 'text':
      if (renderMarkdown) {
        // When inline, render paragraphs as spans to keep content on same line
        const components = inline ? {
          p: ({ children }: { children?: React.ReactNode }) => <span>{children} </span>
        } : undefined

        if (inline) {
          return (
            <span className="prose prose-sm max-w-none inline">
              <ReactMarkdown components={components}>{segment.content}</ReactMarkdown>
            </span>
          )
        }

        // Direct rendering: parse lines into paragraphs, bullet lists, and blank lines.
        // This avoids ReactMarkdown's whitespace collapsing entirely.
        return <FormattedTextBlock text={segment.content} density={density} />
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

    case 'chart':
      return (
        <ChartEmbed
          chartType={segment.data.chartType}
          symbol={segment.data.symbol}
        />
      )

    case 'ai-content':
      return (
        <AIContentBlock
          prompt={segment.data.prompt}
          content={segment.data.content}
        />
      )

    case 'visibility-private':
      return (
        <VisibilityBlock type="private" label="Private">
          {segment.content}
        </VisibilityBlock>
      )

    case 'visibility-team':
      return (
        <VisibilityBlock type="team" label={segment.data.teamName || 'Team'}>
          {segment.content}
        </VisibilityBlock>
      )

    case 'visibility-portfolio':
      return (
        <VisibilityBlock type="portfolio" label={segment.data.portfolioName || 'Portfolio'}>
          {segment.content}
        </VisibilityBlock>
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
    gray: 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:text-gray-100 dark:bg-gray-800',
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
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-sm dark:text-gray-300 dark:bg-gray-800">
      <Icon className="w-3 h-3 mr-1 text-gray-500 dark:text-gray-400" />
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
// Chart embed — renders an actual chart for a symbol
function ChartEmbed({ chartType, symbol }: { chartType: string; symbol: string }) {
  // Lazy-load SimpleChart to avoid circular deps
  const [SimpleChart, setSimpleChart] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    import('../charts/SimpleChart').then(mod => setSimpleChart(() => mod.SimpleChart))
  }, [])

  return (
    <div className="my-2 rounded-lg border border-gray-200 overflow-hidden dark:border-gray-700">
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-50 border-b border-cyan-100">
        <BarChart3 className="w-3.5 h-3.5 text-cyan-600" />
        <span className="text-xs font-semibold text-cyan-800">{symbol}</span>
        <span className="text-[10px] text-cyan-500">{chartType} chart</span>
      </div>
      {SimpleChart ? (
        <SimpleChart symbol={symbol} height={200} />
      ) : (
        <div className="h-[200px] flex items-center justify-center text-xs text-gray-400">Loading chart...</div>
      )}
    </div>
  )
}

interface AIContentBlockProps {
  prompt: string
  content: string
}

function AIContentBlock({ prompt, content }: AIContentBlockProps) {
  return (
    <span className="inline-flex items-start bg-purple-50 border-l-2 border-purple-400 px-2 py-1 rounded-r text-sm">
      <Sparkles className="w-3 h-3 mr-1.5 mt-0.5 text-purple-500 flex-shrink-0" />
      <span className="text-gray-700 dark:text-gray-300">{content}</span>
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

// Visibility block component - shows restricted content with a visual indicator
interface VisibilityBlockProps {
  type: 'private' | 'team' | 'portfolio'
  label: string
  children: React.ReactNode
}

function VisibilityBlock({ type, label, children }: VisibilityBlockProps) {
  const config = {
    private: {
      icon: Lock,
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-300',
      textColor: 'text-amber-700',
      badgeBg: 'bg-amber-100'
    },
    team: {
      icon: Users,
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-300',
      textColor: 'text-blue-700',
      badgeBg: 'bg-blue-100'
    },
    portfolio: {
      icon: Building2,
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-300',
      textColor: 'text-purple-700',
      badgeBg: 'bg-purple-100'
    }
  }

  const { icon: Icon, bgColor, borderColor, textColor, badgeBg } = config[type]

  return (
    <span className={clsx(
      'inline-flex items-start gap-1 px-2 py-0.5 rounded border-l-2',
      bgColor,
      borderColor
    )}>
      <span className={clsx(
        'inline-flex items-center gap-0.5 text-xs font-medium px-1 py-0.5 rounded',
        badgeBg,
        textColor
      )}>
        <Icon className="w-3 h-3" />
        {label}
      </span>
      <span className="text-gray-700 dark:text-gray-300">{children}</span>
    </span>
  )
}
