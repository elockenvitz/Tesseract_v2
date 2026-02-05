import React from 'react'
import {
  Camera,
  Link2,
  Eye,
  MessageSquare,
  Users,
  Info,
} from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import type {
  SimulationShareAccess,
  SimulationShareMode,
} from '../../hooks/useSimulationShare'

interface SharedSimulationBannerProps {
  sharedBy: {
    id: string
    full_name: string
    email: string
  }
  accessLevel: SimulationShareAccess
  shareMode: SimulationShareMode
  sharedAt: string
  message?: string | null
  className?: string
}

const ACCESS_LEVEL_CONFIG: Record<
  SimulationShareAccess,
  { icon: React.ReactNode; label: string; description: string }
> = {
  view: {
    icon: <Eye className="h-4 w-4" />,
    label: 'View only',
    description: 'You can view this simulation but cannot make changes.',
  },
  suggest: {
    icon: <MessageSquare className="h-4 w-4" />,
    label: 'Can suggest',
    description: 'You can view and submit suggestions for this simulation.',
  },
  collaborate: {
    icon: <Users className="h-4 w-4" />,
    label: 'Collaborator',
    description: 'You have full edit access to this simulation.',
  },
}

export function SharedSimulationBanner({
  sharedBy,
  accessLevel,
  shareMode,
  sharedAt,
  message,
  className,
}: SharedSimulationBannerProps) {
  const accessConfig = ACCESS_LEVEL_CONFIG[accessLevel]
  const isSnapshot = shareMode === 'snapshot'

  return (
    <div
      className={clsx(
        'rounded-lg border p-4',
        isSnapshot
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
          : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
        className
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={clsx(
            'flex-shrink-0 p-2 rounded-full',
            isSnapshot
              ? 'bg-blue-100 dark:bg-blue-800/50 text-blue-600 dark:text-blue-400'
              : 'bg-green-100 dark:bg-green-800/50 text-green-600 dark:text-green-400'
          )}
        >
          {isSnapshot ? <Camera className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4
              className={clsx(
                'font-medium',
                isSnapshot
                  ? 'text-blue-900 dark:text-blue-100'
                  : 'text-green-900 dark:text-green-100'
              )}
            >
              {isSnapshot ? 'Shared Snapshot' : 'Live Shared Simulation'}
            </h4>
            <span
              className={clsx(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                'bg-white/50 dark:bg-gray-800/50',
                isSnapshot
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-green-700 dark:text-green-300'
              )}
            >
              {accessConfig.icon}
              {accessConfig.label}
            </span>
          </div>

          <p
            className={clsx(
              'text-sm mt-1',
              isSnapshot
                ? 'text-blue-700 dark:text-blue-300'
                : 'text-green-700 dark:text-green-300'
            )}
          >
            Shared by{' '}
            <span className="font-medium">
              {sharedBy.full_name || sharedBy.email?.split('@')[0] || 'Unknown'}
            </span>{' '}
            on {format(new Date(sharedAt), 'MMM d, yyyy')}
          </p>

          {isSnapshot && (
            <p
              className={clsx(
                'text-xs mt-2 flex items-center gap-1',
                'text-blue-600 dark:text-blue-400'
              )}
            >
              <Info className="h-3.5 w-3.5" />
              This is a frozen snapshot. Changes to the original simulation won't appear here.
            </p>
          )}

          {message && (
            <div
              className={clsx(
                'mt-3 p-2 rounded text-sm italic',
                isSnapshot
                  ? 'bg-blue-100/50 dark:bg-blue-800/30 text-blue-800 dark:text-blue-200'
                  : 'bg-green-100/50 dark:bg-green-800/30 text-green-800 dark:text-green-200'
              )}
            >
              "{message}"
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SharedSimulationBanner
