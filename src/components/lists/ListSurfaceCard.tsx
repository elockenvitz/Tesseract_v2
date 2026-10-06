/**
 * One List, as a dense unit rather than a tile.
 *
 * ── Why this is not a card any more ───────────────────────────────────────
 *
 * It was a bordered rectangle with a fixed interior, so a list holding nothing
 * occupied the same several hundred pixels as a list holding forty names and
 * three unanswered pieces of research. A page whose question is "which
 * collection deserves my attention" spent most of its height saying nothing,
 * and the answer was below the fold.
 *
 * So visual weight now follows useful information:
 *
 *   an empty list   one quiet line
 *   a plain list    name, count, a few tickers, when it last moved
 *   a loud list     the same, plus what needs a person, in the strongest ink
 *                   on the row
 *
 * ── How the emphasis is made ──────────────────────────────────────────────
 *
 * Type, spacing and one amber dot. Not a border, not a filled badge, not a
 * coloured background: on a page of thirty lists any of those becomes a wall
 * of decoration, and a wall of decoration is read as texture rather than as
 * signal. The list's own colour survives as a 2px spine, which is identity
 * rather than status.
 */
import { Star, Edit3, Users, Filter } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import type { ListSurface, ListSurfaceMetrics, LastListActivity } from '../../hooks/lists/useListSurfaces'
import type { ListAttention } from '../../hooks/lists/useListAttention'
import { describeActivity } from '../../lib/lists/describeActivity'

interface ListSurfaceCardProps {
  list: ListSurface
  metrics: ListSurfaceMetrics | undefined
  isFavorite: boolean
  /**
   * Kept in the contract, unused in the composition.
   *
   * Ownership used to drive a "Shared" badge. It is now carried by the
   * collaborator faces and the collaborative glyph, which say the same thing
   * without a third pill — but the callers still pass it and a future
   * treatment may want it.
   */
  isOwner?: boolean
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
  /** Map of asset_id → ticker, for the preview strip */
  symbolMap?: Map<string, string>
  /** Most recent activity event on this list */
  lastActivity?: LastListActivity
  /**
   * What on this list needs a person, folded from data already on the page.
   * See `useListAttention`. Absent is fine — the unit simply says less.
   */
  attention?: ListAttention
}

const TICKER_PREVIEW_COUNT = 5
const AVATAR_PREVIEW_COUNT = 2

function initialsOf(u?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null) {
  if (!u) return '?'
  if (u.first_name && u.last_name) return `${u.first_name[0]}${u.last_name[0]}`.toUpperCase()
  if (u.first_name) return u.first_name[0].toUpperCase()
  if (u.email) return u.email[0].toUpperCase()
  return '?'
}

function displayName(u?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null) {
  if (!u) return 'Unknown'
  if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
  if (u.first_name) return u.first_name
  return u.email ?? 'Unknown'
}

export function ListSurfaceCard({
  list,
  metrics,
  isFavorite,
  onClick,
  onEdit,
  symbolMap,
  lastActivity,
  attention
}: ListSurfaceCardProps) {
  const color = list.color || '#3b82f6'
  const isScreen = (list as any).content_mode === 'screen'
  const isCollab = list.list_type === 'collaborative'
  const assetCount = metrics?.assetCount ?? 0
  const isEmpty = assetCount === 0

  const tickers = symbolMap
    ? list.assetIds.slice(0, TICKER_PREVIEW_COUNT)
        .map(id => symbolMap.get(id))
        .filter((s): s is string => !!s)
    : []
  const overflowTickers = Math.max(0, list.assetIds.length - tickers.length)

  const needs = attention?.needsAttention ?? 0
  const collabs = list.collaborators ?? []

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick() }}
      className={clsx(
        'group relative cursor-pointer rounded-md transition-colors',
        // One hairline underneath, no box. Hover is a surface, not a shadow and
        // a lift — thirty lifting tiles is a page that will not hold still.
        'pl-4 pr-3 hover:bg-gray-50 dark:hover:bg-gray-800/50',
        // A working list gets room to say what it is; an empty one stays a
        // single quiet line. The first version gave both the same two lines and
        // read as a column of navigation links rather than as workspaces.
        isEmpty ? 'py-2' : 'py-3',
      )}
    >
      {/* Identity spine. 2px, and only while it has reason to be seen. */}
      <span
        aria-hidden
        className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full opacity-70 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: color }}
      />

      {/* ── Line one: name, scale, and what needs a person ───────────── */}
      <div className="flex items-baseline gap-2 min-w-0">
        <h3 className={clsx(
          'truncate tracking-tight',
          // An attended list is heavier and darker. That is the emphasis.
          needs > 0
            ? 'text-[14.5px] font-semibold text-gray-900 dark:text-gray-50'
            : isEmpty
              ? 'text-[13px] font-medium text-gray-500 dark:text-gray-400'
              : 'text-[14.5px] font-medium text-gray-800 dark:text-gray-100',
        )}>
          {list.name}
        </h3>

        {isFavorite && <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
        {isScreen && (
          <span className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 flex-shrink-0">
            <Filter className="h-2.5 w-2.5" />
            Screen
          </span>
        )}
        {isCollab && (
          <Users className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" aria-label="Collaborative" />
        )}

        {/* The universe's size, as a figure rather than a caption. */}
        <span className="text-[12px] tabular-nums text-gray-400 dark:text-gray-500 flex-shrink-0">
          {assetCount === 0 ? 'empty' : `${assetCount} name${assetCount === 1 ? '' : 's'}`}
        </span>

        <span className="flex-1" />

        {/* The reason to open this list, in the strongest ink on the row. */}
        {attention && needs > 0 && (
          <span className="inline-flex items-baseline gap-2 flex-shrink-0 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 self-center" />
            {attention.newResearch > 0 && (
              <span
                className="text-[11.5px] font-semibold text-gray-900 dark:text-gray-50 whitespace-nowrap"
                title={`${attention.newResearchNotes} unreviewed note${attention.newResearchNotes === 1 ? '' : 's'}`}
              >
                {attention.newResearch} new research
              </span>
            )}
            {attention.reviewDue > 0 && (
              <span className="text-[11.5px] font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                {attention.reviewDue} review due
              </span>
            )}
          </span>
        )}
        {attention && needs === 0 && attention.activeIdeas > 0 && (
          <span className="text-[11.5px] text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0">
            {attention.activeIdeas} active
          </span>
        )}

        <button
          onClick={onEdit}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 -mr-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded flex-shrink-0"
          title="Edit list"
        >
          <Edit3 className="h-3 w-3" />
        </button>
      </div>

      {/* ── Line two: purpose, where there is one ─────────────────────── */}
      {!isEmpty && list.description && (
        <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400 leading-snug truncate">
          {list.description}
        </p>
      )}

      {/* ── Line three: what is in it, and when it last moved ─────────── */}
      {!isEmpty && (
        <div className="flex items-baseline gap-3 min-w-0 mt-1.5">
          {/* The universe itself, in the same tabular face the watchlist uses —
              so a list reads as a set of securities rather than as a folder. */}
          {tickers.length > 0 && (
            <span className="flex items-baseline gap-2.5 min-w-0 flex-shrink">
              {tickers.map(t => (
                <span key={t} className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums tracking-[-0.01em]">
                  {t}
                </span>
              ))}
              {overflowTickers > 0 && (
                <span className="text-[12px] text-gray-300 dark:text-gray-600 tabular-nums">
                  +{overflowTickers}
                </span>
              )}
            </span>
          )}

          <span className="flex-1" />

          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[42%] flex-shrink-0">
            {lastActivity ? (
              <>
                {lastActivity.actor_name} {describeActivity(lastActivity)}
                {' · '}
                {formatDistanceToNow(new Date(lastActivity.created_at), { addSuffix: true })}
              </>
            ) : list.updated_at ? (
              `Updated ${formatDistanceToNow(new Date(list.updated_at), { addSuffix: true })}`
            ) : null}
          </span>

          {/* Ownership is visible but secondary: two faces, no ring stack. */}
          {collabs.length > 0 && (
            <span className="flex items-center flex-shrink-0" title={`${collabs.length} collaborator${collabs.length === 1 ? '' : 's'}`}>
              {collabs.slice(0, AVATAR_PREVIEW_COUNT).map(c => (
                <span
                  key={c.id}
                  title={displayName(c.user)}
                  className="w-[18px] h-[18px] rounded-full bg-gray-100 dark:bg-gray-800 text-[9px] font-semibold text-gray-500 dark:text-gray-400 flex items-center justify-center -ml-1 first:ml-0 ring-1 ring-white dark:ring-gray-900"
                >
                  {initialsOf(c.user)}
                </span>
              ))}
              {collabs.length > AVATAR_PREVIEW_COUNT && (
                <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                  +{collabs.length - AVATAR_PREVIEW_COUNT}
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
