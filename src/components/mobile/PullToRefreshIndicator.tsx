import { clsx } from 'clsx'
import { ArrowDown, Loader2 } from 'lucide-react'

interface PullToRefreshIndicatorProps {
  pullDistance: number
  isRefreshing: boolean
  threshold: number
}

/**
 * The spinner that tracks a pull.
 *
 * Rendered above the feed and translated by the pull distance, so the control
 * follows the finger rather than appearing at a fixed point — which is what
 * makes the gesture feel connected rather than triggered.
 *
 * Crossing the threshold is signalled before release (the arrow flips and the
 * ring fills), so the user knows the refresh is armed without having to let go
 * to find out.
 */
export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold,
}: PullToRefreshIndicatorProps) {
  if (pullDistance <= 0 && !isRefreshing) return null

  const progress = Math.min(pullDistance / threshold, 1)
  const armed = progress >= 1

  return (
    <div
      className="absolute inset-x-0 top-0 z-30 flex justify-center pointer-events-none"
      style={{
        transform: `translateY(${Math.max(pullDistance - 40, 0)}px)`,
        opacity: Math.min(progress + 0.2, 1),
      }}
      aria-hidden={!isRefreshing}
    >
      <div
        className={clsx(
          'mt-2 flex items-center justify-center h-10 w-10 rounded-full shadow-md',
          'bg-white dark:bg-gray-800 ring-1 ring-black/5 dark:ring-white/10'
        )}
      >
        {isRefreshing ? (
          <Loader2 className="h-5 w-5 text-primary-600 animate-spin" />
        ) : (
          <ArrowDown
            className={clsx(
              'h-5 w-5 transition-transform duration-150',
              armed ? 'rotate-180 text-primary-600' : 'text-gray-400'
            )}
          />
        )}
      </div>
      <span className="sr-only" role="status">
        {isRefreshing ? 'Refreshing feed' : armed ? 'Release to refresh' : 'Pull to refresh'}
      </span>
    </div>
  )
}
