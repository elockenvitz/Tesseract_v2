import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface FeedTileHeaderProps {
  /** Type chip: "Trade Idea", "Decision needed", "Going stale". */
  badge: React.ReactNode
  /** Short summary shown beside the badge. Used by system-derived tiles, which
   *  have no author, so the row is free and the band below can go to the
   *  quote instead of splitting it with a title. */
  headline?: string | null
  /** Who is responsible for the post — author, or recommender on a decision. */
  authorName?: string | null
  onAuthorClick?: () => void
  timestamp?: string | null
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
 * Attribution stacks — name above time — and sits hard right, opposite the
 * type badge. Inline and left-justified the two ran into whatever occupied the
 * rest of the row.
 *
 * The quote deliberately does not live here. Sharing this row with attribution
 * put a two-line ticker block against a two-line name block and they collided
 * on narrow screens; each tile renders it below instead, beside its own title,
 * where the full width is available.
 */
export function FeedTileHeader({
  badge,
  headline,
  authorName,
  onAuthorClick,
  timestamp,
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

      {headline && (
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate">
          {headline}
        </span>
      )}

      {(authorName || when) && (
        <div className="ml-auto min-w-0 flex flex-col justify-center items-end text-right leading-tight">
          {authorName && (
            <button
              type="button"
              onClick={onAuthorClick}
              disabled={!onAuthorClick}
              className="text-[13px] font-medium text-gray-700 dark:text-gray-200 truncate text-right no-touch-target disabled:cursor-default"
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
