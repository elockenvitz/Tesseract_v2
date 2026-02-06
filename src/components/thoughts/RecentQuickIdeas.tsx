import { clsx } from 'clsx'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  HelpCircle,
  AlertTriangle,
  Sparkles,
  ChevronRight,
} from 'lucide-react'

// Types
export type QuickIdeaSignal = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited'

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

interface RecentQuickIdeasProps {
  items: QuickIdea[]
  onOpen: (id: string) => void
  onViewAll: () => void
  hasMore?: boolean
}

// Signal configuration
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

/**
 * Format a date as a compact relative time string
 */
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

function QuickIdeaRow({
  idea,
  onClick,
}: {
  idea: QuickIdea
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left group cursor-pointer"
    >
      {/* Signal icon */}
      {idea.signal ? (
        <SignalPill signal={idea.signal} />
      ) : (
        <div className="w-5 h-5 rounded bg-gray-100 dark:bg-gray-700 flex-shrink-0" />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 leading-snug">
          {idea.text}
        </p>

        {/* Meta row */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {formatRelativeTime(idea.createdAt)}
          </span>

          {idea.contextTag && (
            <>
              <span className="text-[10px] text-gray-300 dark:text-gray-600">·</span>
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 truncate max-w-[60px]">
                {idea.contextTag.label}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Hover chevron */}
      <ChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
    </button>
  )
}

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
        {items.map((idea) => (
          <QuickIdeaRow
            key={idea.id}
            idea={idea}
            onClick={() => onOpen(idea.id)}
          />
        ))}
      </div>
    </div>
  )
}
