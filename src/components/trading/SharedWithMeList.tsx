import React from 'react'
import {
  Camera,
  Clock,
  Eye,
  MessageSquare,
  Users,
  Share2,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useSimulationShare, type SharedSimulationListItem } from '../../hooks/useSimulationShare'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface SharedWithMeListProps {
  onSelectShare?: (share: SharedSimulationListItem) => void
  className?: string
}

const ACCESS_LEVEL_ICONS: Record<string, React.ReactNode> = {
  view: <Eye className="h-3.5 w-3.5" />,
  suggest: <MessageSquare className="h-3.5 w-3.5" />,
  collaborate: <Users className="h-3.5 w-3.5" />,
}

const ACCESS_LEVEL_LABELS: Record<string, string> = {
  view: 'View only',
  suggest: 'Can suggest',
  collaborate: 'Collaborate',
}

export function SharedWithMeList({ onSelectShare, className }: SharedWithMeListProps) {
  const { sharedWithMe, isLoadingSharedWithMe } = useSimulationShare()

  if (isLoadingSharedWithMe) {
    return (
      <div className={clsx('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
      </div>
    )
  }

  if (sharedWithMe.length === 0) {
    return (
      <div className={clsx('text-center py-8', className)}>
        <Share2 className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No simulations have been shared with you yet.
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          When someone shares a simulation, it will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-2', className)}>
      {sharedWithMe.map((item) => (
        <button
          key={item.share_id}
          onClick={() => onSelectShare?.(item)}
          className={clsx(
            'w-full text-left p-4 rounded-lg border transition-colors',
            'bg-white dark:bg-gray-800',
            'border-gray-200 dark:border-gray-700',
            'hover:bg-gray-50 dark:hover:bg-gray-750',
            'hover:border-primary-300 dark:hover:border-primary-700',
            'group'
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {/* Simulation name */}
              <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                {item.name}
              </h4>

              {/* Description */}
              {item.description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                  {item.description}
                </p>
              )}

              {/* Sharer info */}
              <div className="flex items-center gap-2 mt-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300">
                      {item.shared_by.full_name
                        ? item.shared_by.full_name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .toUpperCase()
                        : item.shared_by.email?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <span>
                    Shared by{' '}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {item.shared_by.full_name || item.shared_by.email?.split('@')[0] || 'Unknown'}
                    </span>
                  </span>
                </div>
              </div>

              {/* Metadata row */}
              <div className="flex items-center gap-3 mt-2">
                {/* Share mode badge */}
                <span
                  className={clsx(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                    item.share_mode === 'snapshot'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  )}
                >
                  <Camera className="h-3 w-3" />
                  {item.share_mode === 'snapshot' ? 'Snapshot' : 'Live'}
                </span>

                {/* Access level badge */}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {ACCESS_LEVEL_ICONS[item.access_level]}
                  {ACCESS_LEVEL_LABELS[item.access_level]}
                </span>

                {/* Time ago */}
                <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(item.shared_at), { addSuffix: true })}
                </span>
              </div>

              {/* Optional message */}
              {item.message && (
                <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800/50 rounded text-xs text-gray-600 dark:text-gray-400 italic">
                  "{item.message}"
                </div>
              )}
            </div>

            {/* Arrow indicator */}
            <ChevronRight className="h-5 w-5 text-gray-300 dark:text-gray-600 group-hover:text-primary-500 transition-colors flex-shrink-0" />
          </div>
        </button>
      ))}
    </div>
  )
}

export default SharedWithMeList
