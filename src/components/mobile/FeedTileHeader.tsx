import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { TickerQuoteBadge } from './TickerQuoteBadge'

interface FeedTileHeaderProps {
  /** Type chip: "Trade Idea", "Decision needed", "Going stale". */
  badge: React.ReactNode
  /** Who is responsible for the post — author, or recommender on a decision. */
  authorName?: string | null
  onAuthorClick?: () => void
  timestamp?: string | null
  /** Quote block on the right. Omitted for pair trades, whose legs each need
   *  their own and so carry it inside the carousel instead. */
  symbol?: string | null
  companyName?: string | null
  /** Desktop-only controls; the phone puts these in the bottom bar. */
  actions?: React.ReactNode
  className?: string
}

/**
 * The top band of every feed tile.
 *
 * Shared so attribution lands in the same place whatever kind of post it is.
 * Each tile type previously built its own header, and they drifted: the author
 * sat inline beside the badge on ideas, inside the title row on decisions, and
 * nowhere at all on signals and insights.
 *
 * Attribution stacks — name above time — rather than running along the row.
 * Inline, the two competed with the badge for the same horizontal space and
 * forced the ticker out of the header entirely; stacked they occupy one column
 * and hand the whole right-hand side to the quote.
 */
export function FeedTileHeader({
  badge,
  authorName,
  onAuthorClick,
  timestamp,
  symbol,
  companyName,
  actions,
  className,
}: FeedTileHeaderProps) {
  const when = timestamp ? safeRelative(timestamp) : null

  return (
    <div
      className={clsx(
        'flex-shrink-0 z-30 flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800',
        className
      )}
    >
      {badge}

      {(authorName || when) && (
        <div className="min-w-0 flex flex-col justify-center leading-tight">
          {authorName && (
            <button
              type="button"
              onClick={onAuthorClick}
              disabled={!onAuthorClick}
              className="text-[13px] font-medium text-gray-700 dark:text-gray-200 truncate text-left no-touch-target disabled:cursor-default"
            >
              by {authorName}
            </button>
          )}
          {when && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {when}
            </span>
          )}
        </div>
      )}

      {symbol && (
        <TickerQuoteBadge symbol={symbol} companyName={companyName} className="ml-auto" />
      )}

      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A malformed timestamp should cost the label, not the whole tile. */
function safeRelative(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return formatDistanceToNow(date, { addSuffix: true })
}
