import { Star, Edit3, Users, Clock, Filter } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import type { ListSurface, ListSurfaceMetrics, LastListActivity } from '../../hooks/lists/useListSurfaces'
import { describeActivity } from '../../lib/lists/describeActivity'

interface ListSurfaceCardProps {
  list: ListSurface
  metrics: ListSurfaceMetrics | undefined
  isFavorite: boolean
  isOwner: boolean
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
  /** Map of asset_id → ticker, for rendering the preview strip */
  symbolMap?: Map<string, string>
  /** Most recent activity event on this list */
  lastActivity?: LastListActivity
}

const TICKER_PREVIEW_COUNT = 5
const AVATAR_PREVIEW_COUNT = 3

function getTypeBadge(list: ListSurface, isOwner: boolean): { label: string; className: string } | null {
  if (list.list_type === 'collaborative') {
    return {
      label: 'Collaborative',
      className: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800'
    }
  }
  if (!isOwner) {
    return {
      label: 'Shared',
      className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800'
    }
  }
  return null
}

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
  isOwner,
  onClick,
  onEdit,
  symbolMap,
  lastActivity
}: ListSurfaceCardProps) {
  const typeBadge = getTypeBadge(list, isOwner)
  const hasMembers = !!list.created_by_user || list.collaborators.length > 0
  const color = list.color || '#3b82f6'
  const isScreen = (list as any).content_mode === 'screen'

  const tickers = symbolMap
    ? list.assetIds.slice(0, TICKER_PREVIEW_COUNT)
        .map(id => symbolMap.get(id))
        .filter((s): s is string => !!s)
    : []
  const overflowTickers = Math.max(0, list.assetIds.length - tickers.length)

  const assetCount = metrics?.assetCount ?? 0

  return (
    <div
      onClick={onClick}
      className={clsx(
        'group relative cursor-pointer overflow-hidden rounded-xl border bg-white transition-all duration-200 h-full',
        'border-gray-200 hover:border-gray-300 hover:shadow-lg hover:-translate-y-0.5',
        'dark:bg-gray-900 dark:border-gray-800 dark:hover:border-gray-700'
      )}
      style={{
        // Subtle gradient bloom on hover, keyed off the list color
        backgroundImage: `linear-gradient(to bottom right, ${color}03, transparent 40%)`
      }}
    >
      {/* Left color bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: color }}
      />

      {/* Subtle glow on hover — uses the list color */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          background: `radial-gradient(600px circle at 50% 0%, ${color}08, transparent 60%)`
        }}
      />

      {/* h-full + flex-col means the footer can mt-auto to the bottom,
          keeping the activity line aligned across tiles regardless of
          what middle content each one has. */}
      <div className="relative pl-4 pr-3 py-2.5 flex flex-col gap-2 h-full">
        {/* ── Top row: name cluster · actions ────────────────── */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <h3 className="font-semibold text-[14px] tracking-tight text-gray-900 dark:text-gray-50 truncate">
              {list.name}
            </h3>
            {isFavorite && (
              <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />
            )}
            {isScreen && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-semibold bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900">
                <Filter className="h-2 w-2" />
                SCREEN
              </span>
            )}
            {typeBadge && (
              <span className={clsx(
                'inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-medium border',
                typeBadge.className
              )}>
                {list.list_type === 'collaborative' && <Users className="h-2 w-2" />}
                {typeBadge.label}
              </span>
            )}
          </div>

          <button
            onClick={onEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded flex-shrink-0"
            title="Edit list"
          >
            <Edit3 className="h-3 w-3" />
          </button>
        </div>

        {/* ── Description — single line, conditional (no reserved slot) ── */}
        {list.description && (
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-snug line-clamp-1">
            {list.description}
          </p>
        )}

        {/* ── Ticker preview — conditional; an empty list still shows its
               metadata + activity so the tile doesn't look broken */}
        {tickers.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {tickers.map(t => (
              <span
                key={t}
                className="px-1.5 py-0 rounded text-[10px] font-mono font-semibold tabular-nums border border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300"
              >
                {t}
              </span>
            ))}
            {overflowTickers > 0 && (
              <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 px-0.5">
                +{overflowTickers}
              </span>
            )}
          </div>
        )}

        {/* ── Metadata row — clean text, no icon pill ────────── */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 min-w-0">
            <span className="tabular-nums font-medium text-gray-700 dark:text-gray-300">
              {assetCount} {assetCount === 1 ? 'asset' : 'assets'}
            </span>
            {metrics?.portfolioName && (
              <>
                <span className="text-gray-300 dark:text-gray-700">·</span>
                <span className="truncate max-w-[140px]">{metrics.portfolioName}</span>
              </>
            )}
          </div>
          {hasMembers && <CardAvatarStack list={list} />}
        </div>

        {/* ── Activity footer — bottom-anchored via mt-auto ───── */}
        <div className="mt-auto flex items-center gap-1.5 text-[10.5px] text-gray-400 dark:text-gray-500 pt-1.5 border-t border-gray-100 dark:border-gray-800/50 min-w-0">
          <Clock className="h-2.5 w-2.5 flex-shrink-0" />
          {lastActivity ? (
            <span className="truncate">
              <span className="font-medium text-gray-600 dark:text-gray-400">{lastActivity.actor_name}</span>{' '}
              {describeActivity(lastActivity)}{' '}
              <span className="text-gray-400 dark:text-gray-600">
                · {formatDistanceToNow(new Date(lastActivity.created_at), { addSuffix: true })}
              </span>
            </span>
          ) : (
            <span className="truncate">
              {list.updated_at
                ? `Updated ${formatDistanceToNow(new Date(list.updated_at), { addSuffix: true })}`
                : 'No activity yet'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Compact avatar stack for card footer ────────────────────────────────

function CardAvatarStack({ list }: { list: ListSurface }) {
  const owner = list.created_by_user
  const collabs = list.collaborators ?? []
  const visibleCollabs = collabs.slice(0, AVATAR_PREVIEW_COUNT)
  const overflow = Math.max(0, collabs.length - AVATAR_PREVIEW_COUNT)

  return (
    <div className="flex items-center flex-shrink-0">
      {owner && (
        <CardAvatar
          initials={initialsOf(owner)}
          label={displayName(owner)}
          className="bg-gradient-to-br from-primary-400 to-primary-600 text-white"
          isOwner
        />
      )}
      {visibleCollabs.map(c => (
        <CardAvatar
          key={c.id}
          initials={initialsOf(c.user)}
          label={displayName(c.user)}
          className="bg-gradient-to-br from-gray-400 to-gray-600 text-white"
        />
      ))}
      {overflow > 0 && (
        <CardAvatar
          initials={`+${overflow}`}
          label={`${overflow} more`}
          className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        />
      )}
    </div>
  )
}

function CardAvatar({
  initials,
  label,
  className,
  isOwner
}: {
  initials: string
  label: string
  className?: string
  isOwner?: boolean
}) {
  return (
    <div
      title={isOwner ? `${label} · Owner` : label}
      className={clsx(
        'relative w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold ring-2 ring-white dark:ring-gray-900 -ml-1.5 first:ml-0',
        className
      )}
    >
      {initials}
      {isOwner && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-white dark:border-gray-900" title="Owner" />
      )}
    </div>
  )
}
