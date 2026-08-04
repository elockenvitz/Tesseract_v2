import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CarouselControlsProps {
  count: number
  index: number
  onChange: (index: number) => void
  /** Announced to screen readers, e.g. "LLY — chart 1 of 2". */
  label?: string
  /** Accessible name for each dot, e.g. i => `Show ${panels[i].label}`. */
  dotLabel?: (index: number) => string
  className?: string
}

/**
 * Arrows and dots for paging a carousel.
 *
 * Shared because the tile has two carousels — the pair-trade charts and the
 * supporting-detail panels — and they must page identically; two carousels on
 * one screen that respond to different gestures is worse than either choice
 * made consistently.
 *
 * Both are driven by taps rather than swipes. On the charts a horizontal drag
 * belongs to the crosshair, and on the panels it competed with the feed's own
 * vertical paging: a horizontal scroll-snap container is a scroll container,
 * so vertical drags starting inside it were absorbed rather than passed up.
 */
export function CarouselControls({
  count,
  index,
  onChange,
  label,
  dotLabel,
  className,
}: CarouselControlsProps) {
  if (count <= 1) return null

  return (
    <div className={clsx('flex items-center justify-center gap-2', className)}>
      <button
        type="button"
        onClick={() => onChange(Math.max(0, index - 1))}
        disabled={index === 0}
        className="flex items-center justify-center h-8 w-8 rounded-full text-gray-500 dark:text-gray-400 disabled:opacity-30 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
        aria-label="Previous"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className="flex items-center justify-center h-8 px-1 no-touch-target"
          aria-label={dotLabel?.(i) ?? `Go to ${i + 1}`}
          aria-current={i === index}
        >
          <span
            className={clsx(
              'block h-1.5 rounded-full transition-all',
              i === index ? 'w-4 bg-gray-500 dark:bg-gray-300' : 'w-1.5 bg-gray-300 dark:bg-gray-600'
            )}
          />
        </button>
      ))}

      <button
        type="button"
        onClick={() => onChange(Math.min(count - 1, index + 1))}
        disabled={index === count - 1}
        className="flex items-center justify-center h-8 w-8 rounded-full text-gray-500 dark:text-gray-400 disabled:opacity-30 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
        aria-label="Next"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      {label && (
        <span className="sr-only" role="status">
          {label}
        </span>
      )}
    </div>
  )
}
