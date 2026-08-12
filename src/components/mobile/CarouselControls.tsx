import { clsx } from 'clsx'

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
 * Paging is by swipe — see `useSwipe`, applied by each carousel to its own
 * panel area. What remains here is the position indicator: dots, tappable as
 * a secondary affordance.
 *
 * The arrows are gone. They existed because a horizontal scroll-snap container
 * absorbed the vertical drags the feed needs, and because on charts a
 * horizontal drag belongs to the crosshair. `useSwipe` resolves both by
 * locking to an axis before claiming the gesture, so neither problem requires
 * giving up the swipe.
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

      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className="flex items-center justify-center h-7 px-1 no-touch-target"
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


      {label && (
        <span className="sr-only" role="status">
          {label}
        </span>
      )}
    </div>
  )
}
