import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

interface FeedKindBadgeProps {
  icon: LucideIcon
  label: string
  /** Whole Tailwind classes for the pill's colour — never interpolated, or JIT
   *  drops them. */
  chip: string
  /** Narrow the feed to this kind. Omitted where a tile has no filterable kind,
   *  which renders the pill inert rather than as a dead button. */
  onFilter?: () => void
  /** Tooltip / accessible name, e.g. "Show only news". */
  filterLabel?: string
}

/**
 * The type chip at the top-left of every feed tile.
 *
 * It reads as a category label, so tapping it should narrow the feed to that
 * category — and on three of the five tiles it did nothing, because each tile
 * hand-rolled its own chip and only two were ever built as buttons. Sharing one
 * component is what stops the set drifting apart again.
 *
 * The hit box is deliberately larger than the pill: `py-2 -my-2` adds 16px of
 * vertical target that the negative margin then removes from layout, so the
 * header band keeps its height. A 44px-tall pill would be the textbook target
 * size and would also double the height of a band whose whole job is to stay
 * out of the way. This is the compromise — a real target around a small chip —
 * and it is why the global 44px minimum is opted out of here.
 */
export function FeedKindBadge({ icon: Icon, label, chip, onFilter, filterLabel }: FeedKindBadgeProps) {
  const pill = (
    <span
      className={clsx(
        'flex shrink-0 items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap',
        chip,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
  )

  if (!onFilter) return pill

  return (
    <button
      type="button"
      onClick={onFilter}
      title={filterLabel ?? `Show only ${label.toLowerCase()}`}
      aria-label={filterLabel ?? `Show only ${label.toLowerCase()}`}
      className="shrink-0 py-2 -my-2 no-touch-target active:opacity-60 transition-opacity"
    >
      {pill}
    </button>
  )
}
