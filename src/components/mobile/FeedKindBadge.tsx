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
        // Filled, not outlined. The border was an untinted default grey drawn
        // around a pale fill, which reads as a disabled control rather than a
        // category — it muddied the one element whose job is to be instantly
        // identifiable at a glance while scrolling.
        //
        // Uppercase at 10px with wide tracking rather than 11px sentence case:
        // a label read by shape, not by reading. It ends up *smaller* and far
        // more legible, and the size drop buys contrast against the title
        // instead of competing with it.
        'flex shrink-0 items-center gap-1 px-2 py-[3px] rounded-full',
        'text-[10px] font-bold uppercase tracking-[0.06em] whitespace-nowrap',
        chip,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} />
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
