import { Star, Edit3, Users, List, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import type { ListSurface, ListSurfaceMetrics } from '../../hooks/lists/useListSurfaces'

interface ListSurfaceCardProps {
  list: ListSurface
  metrics: ListSurfaceMetrics | undefined
  isFavorite: boolean
  isOwner: boolean
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
}

function getTypeBadge(list: ListSurface, isOwner: boolean): { label: string; className: string } | null {
  if (list.list_type === 'collaborative') {
    return {
      label: 'Collaborative',
      className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
    }
  }
  if (!isOwner) {
    return {
      label: 'Shared',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    }
  }
  return null
}

export function ListSurfaceCard({
  list,
  metrics,
  isFavorite,
  isOwner,
  onClick,
  onEdit
}: ListSurfaceCardProps) {
  const typeBadge = getTypeBadge(list, isOwner)

  return (
    <div
      onClick={onClick}
      className={clsx(
        'relative cursor-pointer rounded-lg border bg-white shadow-sm transition-all duration-200',
        'hover:shadow-md hover:border-gray-300 group',
        'dark:bg-gray-900 dark:border-gray-700 dark:hover:border-gray-600'
      )}
    >
      {/* Left color bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg"
        style={{ backgroundColor: list.color || '#3b82f6' }}
      />

      <div className="pl-4 pr-3 py-3 space-y-2">
        {/* Row 1: Name + favorite + type badge + edit */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: list.color || '#3b82f6' }}
            />
            <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
              {list.name}
            </h3>
            {isFavorite && (
              <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
            )}
            {typeBadge && (
              <span className={clsx(
                'flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                typeBadge.className
              )}>
                {list.list_type === 'collaborative' && <Users className="h-2.5 w-2.5 mr-0.5" />}
                {typeBadge.label}
              </span>
            )}
          </div>
          <button
            onClick={onEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded flex-shrink-0"
            title="Edit list"
          >
            <Edit3 className="h-3.5 w-3.5 text-gray-400" />
          </button>
        </div>

        {/* Row 2: Description */}
        {list.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 pl-[18px]">
            {list.description}
          </p>
        )}

        {/* Row 3: Asset count (primary metric) */}
        <div className="flex items-center gap-1.5 pl-[18px] flex-wrap">
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <List className="h-2.5 w-2.5" />
            {metrics?.assetCount ?? 0} assets
          </span>
          {metrics?.portfolioName && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 truncate max-w-[120px]">
              {metrics.portfolioName}
            </span>
          )}
        </div>

        {/* Row 4: Timestamp */}
        <div className="flex items-center justify-end pl-[18px]">
          <span className="flex items-center text-[10px] text-gray-400 dark:text-gray-500">
            <Clock className="h-2.5 w-2.5 mr-0.5" />
            {list.updated_at
              ? formatDistanceToNow(new Date(list.updated_at), { addSuffix: true })
              : 'Unknown'}
          </span>
        </div>
      </div>
    </div>
  )
}
