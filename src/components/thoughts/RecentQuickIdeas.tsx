import { clsx } from 'clsx'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  HelpCircle,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  Lightbulb,
  MessageCircleQuestion,
} from 'lucide-react'
import type { RecentItem } from '../../hooks/useRecentQuickIdeas'

// ---------------------------------------------------------------------------
// Types re-exported for backwards compat (hook still imports QuickIdeaSignal)
// ---------------------------------------------------------------------------

export type QuickIdeaSignal = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited'

// Legacy QuickIdea kept for any external consumers; hook now returns RecentItem
export interface QuickIdea {
  id: string
  text: string
  createdAt: string
  signal: QuickIdeaSignal | null
  contextTag?: {
    type: 'asset' | 'portfolio' | 'theme' | 'other'
    label: string
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RecentQuickIdeasProps {
  items: RecentItem[]
  onOpen: (id: string, kind: RecentItem['kind']) => void
  onViewAll: () => void
  hasMore?: boolean
}

// ---------------------------------------------------------------------------
// Signal config (unchanged)
// ---------------------------------------------------------------------------

const SIGNAL_CONFIG: Record<QuickIdeaSignal, {
  icon: React.ComponentType<{ className?: string }>
  label: string
  bgColor: string
  textColor: string
}> = {
  bullish: {
    icon: TrendingUp,
    label: 'Bullish',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-600 dark:text-green-400',
  },
  bearish: {
    icon: TrendingDown,
    label: 'Bearish',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-600 dark:text-red-400',
  },
  neutral: {
    icon: Minus,
    label: 'Neutral',
    bgColor: 'bg-gray-100 dark:bg-gray-700',
    textColor: 'text-gray-600 dark:text-gray-400',
  },
  curious: {
    icon: HelpCircle,
    label: 'Curious',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-600 dark:text-blue-400',
  },
  concerned: {
    icon: AlertTriangle,
    label: 'Concerned',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    textColor: 'text-amber-600 dark:text-amber-400',
  },
  excited: {
    icon: Sparkles,
    label: 'Excited',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-600 dark:text-purple-400',
  },
}

// ---------------------------------------------------------------------------
// Status label config for prompts
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  open: { text: 'Open', cls: 'text-violet-600 dark:text-violet-400' },
  responded: { text: 'Responded', cls: 'text-emerald-600 dark:text-emerald-400' },
  closed: { text: 'Closed', cls: 'text-gray-400 dark:text-gray-500' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays === 1) return '1d'
  if (diffDays < 7) return `${diffDays}d`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SignalPill({ signal }: { signal: QuickIdeaSignal }) {
  const config = SIGNAL_CONFIG[signal]
  const Icon = config.icon

  return (
    <div
      className={clsx(
        'flex items-center justify-center w-5 h-5 rounded flex-shrink-0',
        config.bgColor
      )}
      title={config.label}
    >
      <Icon className={clsx('h-3 w-3', config.textColor)} />
    </div>
  )
}

/** Subtle type tag: [PROMPT · OPEN] or [THOUGHT] */
function TypeTag({ item }: { item: RecentItem }) {
  if (item.kind === 'prompt') {
    const st = STATUS_LABEL[item.status] || STATUS_LABEL.open
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium leading-none">
        <MessageCircleQuestion className="h-3 w-3 text-violet-500 dark:text-violet-400" />
        <span className="uppercase tracking-wide text-violet-600 dark:text-violet-400">Prompt</span>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <span className={st.cls}>{st.text}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium leading-none">
      <Lightbulb className="h-3 w-3 text-gray-400 dark:text-gray-500" />
      <span className="uppercase tracking-wide text-gray-400 dark:text-gray-500">Thought</span>
    </span>
  )
}

/** Meta line under the title — differs by item kind */
function MetaLine({ item }: { item: RecentItem }) {
  const parts: React.ReactNode[] = []

  // Timestamp
  parts.push(
    <span key="time" className="text-[10px] text-gray-400 dark:text-gray-500">
      {formatRelativeTime(item.createdAt)}
    </span>
  )

  // Context tag (e.g. COIN)
  if (item.contextTag) {
    parts.push(
      <span key="ctx-dot" className="text-[10px] text-gray-300 dark:text-gray-600">·</span>,
      <span key="ctx" className="text-[10px] font-medium text-gray-500 dark:text-gray-400 truncate max-w-[60px]">
        {item.contextTag.label}
      </span>
    )
  }

  // Prompt-specific: assignee
  if (item.kind === 'prompt' && item.assigneeName) {
    parts.push(
      <span key="to-dot" className="text-[10px] text-gray-300 dark:text-gray-600">·</span>,
      <span key="to" className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[80px]">
        To: {item.assigneeName}
      </span>
    )
  }

  return <div className="flex items-center gap-1.5 mt-0.5">{parts}</div>
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function RecentItemRow({ item, onClick }: { item: RecentItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left group cursor-pointer"
    >
      {/* Signal icon — only for thoughts (prompts have no sentiment) */}
      {item.kind === 'thought' && item.signal ? (
        <SignalPill signal={item.signal} />
      ) : item.kind === 'thought' ? (
        <div className="w-5 h-5 rounded bg-gray-100 dark:bg-gray-700 flex-shrink-0" />
      ) : (
        // Prompt: subtle violet dot indicator
        <div className="w-5 h-5 rounded bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
          <MessageCircleQuestion className="h-3 w-3 text-violet-500 dark:text-violet-400" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Type tag line */}
        <TypeTag item={item} />

        {/* Title / text */}
        <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 leading-snug mt-0.5">
          {item.text}
        </p>

        {/* Meta row */}
        <MetaLine item={item} />
      </div>

      {/* Hover chevron */}
      <ChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RecentQuickIdeas({
  items,
  onOpen,
  onViewAll,
  hasMore = false,
}: RecentQuickIdeasProps) {
  // Empty state
  if (items.length === 0) {
    return (
      <div className="mt-4">
        <div className="border-t border-gray-200 dark:border-gray-700 mb-2" />
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            Recent
          </span>
          <button
            onClick={onViewAll}
            className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            View all
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-1">
          Nothing here yet — capture your first thought.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4">
      {/* Divider */}
      <div className="border-t border-gray-200 dark:border-gray-700 mb-2" />

      {/* Header with View all */}
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Recent
        </span>
        <button
          onClick={onViewAll}
          className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          View all
        </button>
      </div>

      {/* Fixed list (no scrolling) */}
      <div className="space-y-0.5">
        {items.map((item) => (
          <RecentItemRow
            key={item.id}
            item={item}
            onClick={() => onOpen(item.id, item.kind)}
          />
        ))}
      </div>
    </div>
  )
}
