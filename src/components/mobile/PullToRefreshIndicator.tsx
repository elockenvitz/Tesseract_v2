import { forwardRef } from 'react'
import { clsx } from 'clsx'
import { ArrowDown, Loader2 } from 'lucide-react'

interface PullToRefreshIndicatorProps {
  isRefreshing: boolean
  /** True once the drag has passed the commit threshold. */
  armed: boolean
}

/**
 * The spinner that tracks a pull.
 *
 * Position and opacity are written directly to this element by
 * usePullToRefresh rather than passed as props — driving them through React
 * re-rendered the entire feed on every touchmove, which is what made the
 * gesture stutter. Only `armed` and `isRefreshing` come through props, and
 * both change at most once or twice per gesture.
 */
export const PullToRefreshIndicator = forwardRef<HTMLDivElement, PullToRefreshIndicatorProps>(
  function PullToRefreshIndicator({ isRefreshing, armed }, ref) {
    return (
      <div
        ref={ref}
        className="absolute inset-x-0 top-0 z-30 flex justify-center pointer-events-none"
        // Starts hidden; the hook takes over on first movement.
        style={{ opacity: 0, transform: 'translate3d(0, 0, 0)', willChange: 'transform, opacity' }}
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
          {isRefreshing ? 'Refreshing feed' : armed ? 'Release to refresh' : ''}
        </span>
      </div>
    )
  }
)
