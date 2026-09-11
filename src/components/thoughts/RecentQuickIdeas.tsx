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
import { useIsMobile } from '../../hooks/useMediaQuery'

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
  closed: { text: 'Resolved', cls: 'text-emerald-600 dark:text-emerald-400' },
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

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

/** A dot between metadata fragments. */
function MetaDot() {
  return <span className="text-gray-300 dark:text-gray-600" aria-hidden>·</span>
}

/**
 * One recent item. Same structure on every surface; only density differs.
 *
 * ── What was wrong, and it was wrong on BOTH ──────────────────────────────
 *
 * The row drew its type twice: a coloured block on the left, then a type tag
 * with the same icon and the word right beside it. For the common case — a
 * thought with no sentiment — that block had no icon to hold, so it rendered
 * as an empty grey square that reads as a broken avatar. Beneath it sat a
 * third line for time and context. A two-field list item was three lines tall
 * with a redundant gutter, and the chevron was `opacity-0 group-hover:100`, so
 * on a touch screen the row had no affordance at all.
 *
 * ── The grammar ───────────────────────────────────────────────────────────
 *
 *   title                                    primary, what you scan for
 *   type · state · signal · time · ctx · to  one line, everything else
 *                                      ›     quiet, always drawn
 *
 * Nothing is dropped. The sentiment that lived in the left pill is the signal
 * icon in the metadata line; the empty square had nothing to say and so no
 * longer says it. Type keeps its icon and colour, so the list is still
 * scannable by kind without spending a block on it.
 *
 * Long values cannot break the line: the metadata row is `overflow-hidden`,
 * type, state, signal and time are `shrink-0`, and only context and assignee
 * truncate. That is what holds at 320px, where a long assignee name would
 * otherwise push the timestamp off-screen.
 */
export function RecentRow({ item, onClick, dense }: { item: RecentItem; onClick: () => void; dense: boolean }) {
  const status = item.kind === 'prompt' ? (STATUS_LABEL[item.status] || STATUS_LABEL.open) : null
  const signal = item.kind === 'thought' && item.signal ? SIGNAL_CONFIG[item.signal] : null
  const SignalIcon = signal?.icon
  const TypeIcon = item.kind === 'prompt' ? MessageCircleQuestion : Lightbulb
  const typeTone = item.kind === 'prompt'
    ? 'text-violet-600 dark:text-violet-400'
    : 'text-amber-600 dark:text-amber-500'

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 text-left cursor-pointer transition-colors',
        'hover:bg-gray-50 dark:hover:bg-gray-800/60 active:bg-gray-100 dark:active:bg-gray-800',
        dense ? 'px-2.5 py-2.5' : 'px-2 py-2',
      )}
    >
      <div className="flex-1 min-w-0">
        <p className={clsx(
          'font-medium text-gray-800 dark:text-gray-100 line-clamp-2 leading-snug',
          dense ? 'text-sm' : 'text-[13px]',
        )}>
          {item.text}
        </p>
        <div className="mt-1 flex items-center gap-1.5 overflow-hidden text-[11px] leading-none">
          <TypeIcon className={clsx('h-3 w-3 shrink-0', typeTone)} />
          <span className={clsx('font-semibold uppercase tracking-wide shrink-0', typeTone)}>
            {item.kind === 'prompt' ? 'Prompt' : 'Thought'}
          </span>
          {status && (
            <>
              <MetaDot />
              <span className={clsx('font-medium shrink-0', status.cls)}>{status.text}</span>
            </>
          )}
          {signal && SignalIcon && (
            <>
              <MetaDot />
              <span className={clsx('flex items-center gap-0.5 shrink-0', signal.textColor)}>
                <SignalIcon className="h-3 w-3" />
                <span className="font-medium">{signal.label}</span>
              </span>
            </>
          )}
          <MetaDot />
          <span className="text-gray-500 dark:text-gray-400 shrink-0">
            {formatRelativeTime(item.createdAt)}
          </span>
          {item.contextTag && (
            <>
              <MetaDot />
              <span className="font-medium text-gray-600 dark:text-gray-300 truncate">
                {item.contextTag.label}
              </span>
            </>
          )}
          {item.kind === 'prompt' && item.assigneeName && (
            <>
              <MetaDot />
              <span className="text-gray-500 dark:text-gray-400 truncate">To: {item.assigneeName}</span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className={clsx(
        'shrink-0 text-gray-400 dark:text-gray-500',
        dense ? 'h-4 w-4' : 'h-3.5 w-3.5',
      )} />
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
  const dense = useIsMobile()
  // `View all` was a 10px word with no padding — a click target on desktop and
  // barely a tap target on a phone. Tinted and padded on both; the phone gets
  // the larger box.
  const viewAll = clsx(
    'font-medium text-primary-600 dark:text-primary-400 rounded-md transition-colors',
    'hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-800',
    dense ? 'text-xs px-2 py-1.5 -mr-2' : 'text-[11px] px-1.5 py-1 -mr-1.5',
  )
  const sectionLabel = clsx(
    'font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide',
    dense ? 'text-xs' : 'text-[11px]',
  )
  // Empty state
  if (items.length === 0) {
    return (
      <div className="mt-4">
        <div className="border-t border-gray-200 dark:border-gray-700 mb-2" />
        <div className="flex items-center justify-between px-1">
          <span className={sectionLabel}>Recent</span>
          <button onClick={onViewAll} className={viewAll}>View all</button>
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
      <div className="flex items-center justify-between px-1">
        <span className={sectionLabel}>Recent</span>
        <button onClick={onViewAll} className={viewAll}>View all</button>
      </div>

      {/* Fixed list (no scrolling) */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {items.map((item) => (
          <RecentRow
            key={item.id}
            item={item}
            dense={dense}
            onClick={() => onOpen(item.id, item.kind)}
          />
        ))}
      </div>
    </div>
  )
}
