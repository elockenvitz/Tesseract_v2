import { clsx } from 'clsx'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The four Quick Ideas actions, as one construction on every surface.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The pane and the phone had grown two separate implementations of the same
 * four actions, and the pane's had four unrelated button treatments — an
 * indigo-to-blue gradient, a green-to-emerald gradient, a 1px violet outline
 * and a 2px amber outline — with the count hung underneath each as a detached
 * 11px link. Nothing said which two actions mattered, and the hue was carrying
 * decoration rather than meaning.
 *
 * One band component fixes both surfaces at once. Weight carries hierarchy;
 * hue carries identity. Geometry is identical across all four.
 *
 * ── The trailing zone ─────────────────────────────────────────────────────
 *
 * Every band ends in a fixed-width zone holding a status value and a chevron.
 * Fixed width is the point: with intrinsic width the divider landed at a
 * different x on all four bands, because a one-digit count, a two-digit count
 * and a bare chevron are three different sizes. `TRAILING_W` is the single
 * number that keeps the dividers, values and chevrons in one column.
 *
 * It is always rendered, even at zero. Partly so the column survives — a band
 * that dropped its trailing zone would break the alignment of the ones that
 * kept theirs — and partly because the route behind it is worth having when
 * the count is zero. "No open prompts" is an answer.
 *
 * The trailing zone is a SEPARATE button from the band, because it goes
 * somewhere the band does not: the band opens a capture form, the trailing
 * zone opens that kind's list. Nested buttons are invalid HTML, so the two are
 * siblings inside one rounded, overflow-hidden shell: one control to the eye,
 * two targets to the finger, both full height.
 */

/** One column for every trailing zone. The reason the dividers line up. */
const TRAILING_W = 'w-14'

export type BandTone = 'amber' | 'emerald' | 'violet' | 'blue'

/**
 * Whole Tailwind class strings — never interpolated, or the JIT drops them.
 *
 * Primary is a saturated fill; secondary is a soft tint of its own hue rather
 * than a neutral outline. Secondary WAS neutral, which read as disabled next to
 * two filled bands. A tint keeps them clearly subordinate while still looking
 * like something you may press.
 */
const TONE: Record<BandTone, { band: string; divider: string; trailing: string; icon: string }> = {
  amber: {
    band: 'bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-600',
    divider: 'border-white/25',
    trailing: 'text-white hover:bg-amber-600 active:bg-amber-600',
    icon: 'text-white',
  },
  emerald: {
    band: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-700',
    divider: 'border-white/25',
    trailing: 'text-white hover:bg-emerald-700 active:bg-emerald-700',
    icon: 'text-white',
  },
  violet: {
    band: 'bg-violet-50 text-violet-800 hover:bg-violet-100 active:bg-violet-100 dark:bg-violet-900/25 dark:text-violet-200 dark:hover:bg-violet-900/40',
    divider: 'border-violet-200 dark:border-violet-800/60',
    trailing: 'text-violet-700 hover:bg-violet-100 active:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/40',
    icon: 'text-violet-500 dark:text-violet-400',
  },
  blue: {
    band: 'bg-blue-50 text-blue-800 hover:bg-blue-100 active:bg-blue-100 dark:bg-blue-900/25 dark:text-blue-200 dark:hover:bg-blue-900/40',
    divider: 'border-blue-200 dark:border-blue-800/60',
    trailing: 'text-blue-700 hover:bg-blue-100 active:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/40',
    icon: 'text-blue-500 dark:text-blue-400',
  },
}

export interface CaptureBand {
  key: string
  label: string
  icon: LucideIcon
  tone: BandTone
  weight: 'primary' | 'secondary'
  /** Opens the capture form for this kind. */
  onOpen: () => void
  /**
   * The status value in the trailing zone, or `null` to show none.
   *
   * `null` is for a number that describes the database rather than the
   * reader's attention. The route stays either way — only the digit goes.
   */
  count: number | null
  /** Read out with the number, e.g. "3 open prompts". */
  countLabel: string
  /** Where the trailing zone goes. Never the same place as `onOpen`. */
  onTrailing: () => void
}

function Band({ band, dense }: { band: CaptureBand; dense: boolean }) {
  const tone = TONE[band.tone]
  const Icon = band.icon
  const primary = band.weight === 'primary'

  return (
    <div
      className={clsx(
        'flex items-stretch overflow-hidden',
        primary ? 'rounded-xl shadow-sm' : 'rounded-lg',
        tone.band,
      )}
    >
      <button
        onClick={band.onOpen}
        className={clsx(
          'flex-1 min-w-0 flex items-center text-left',
          primary ? 'gap-3 font-semibold' : 'gap-2.5 font-medium',
          dense
            ? primary ? 'px-4 py-3.5 text-[15px]' : 'px-3.5 py-2.5 text-sm'
            : primary ? 'px-3.5 py-2.5 text-sm' : 'px-3 py-2 text-sm',
        )}
      >
        <Icon className={clsx('shrink-0', primary ? 'h-5 w-5' : 'h-4 w-4', tone.icon)} />
        <span className="truncate">{band.label}</span>
      </button>

      <button
        onClick={band.onTrailing}
        aria-label={band.count === null ? `View ${band.countLabel}` : `${band.count} ${band.countLabel}`}
        className={clsx(
          'flex items-center justify-center gap-0.5 shrink-0 border-l transition-colors',
          TRAILING_W,
          tone.divider,
          tone.trailing,
        )}
      >
        {band.count !== null && (
          <span className={clsx('font-bold tabular-nums', primary ? 'text-sm' : 'text-xs')}>
            {band.count}
          </span>
        )}
        <ChevronRight className={clsx('opacity-80', primary ? 'h-4 w-4' : 'h-3.5 w-3.5')} />
      </button>
    </div>
  )
}

/**
 * Both surfaces stack. `dense` changes the ROW, not the arrangement: taller
 * bands and 15px labels on a phone, compact bands and 14px labels in the pane.
 *
 * ── Why the pane does not go two-up ───────────────────────────────────────
 *
 * It was two-up, and it truncated every label to "Quick t...", "Trade i...",
 * "Recomm...". The pane is `w-96` — 384px, less 24px of padding — so a
 * two-column band is 176px. Subtract the trailing zone, the band padding and
 * the icon and 60px of label space is left for a name that needs about 100.
 *
 * That is not fixable by trimming: at a trailing zone of ZERO width the label
 * still only gets 116px, and a zero-width trailing zone has no route in it.
 * Two columns cannot hold this content at this pane width, so the pane stacks.
 *
 * It does not cost height. The arrangement this replaced was two buttons per
 * group each with a detached count link underneath — four rows per group in
 * practice. Four stacked bands is fewer rows than that, not more.
 *
 * Shared design language, not identical geometry.
 */
export function CaptureActionBands({
  primary,
  secondary,
  dense,
  directNote,
}: {
  primary: CaptureBand[]
  secondary: CaptureBand[]
  dense: boolean
  /** Shown under the Direct label where there is room for it. */
  directNote?: string
}) {
  const group = dense ? 'space-y-2' : 'space-y-1.5'
  const groupSecondary = dense ? 'space-y-1.5' : 'space-y-1.5'

  return (
    <div className={dense ? 'pt-1' : undefined}>
      <div className={group}>
        {primary.map(b => <Band key={b.key} band={b} dense={dense} />)}
      </div>

      <div className="my-3 border-t border-gray-100 dark:border-gray-800" />

      <span className="px-0.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        Direct
      </span>
      {directNote && (
        <p className="mt-0.5 mb-1.5 text-xs leading-snug text-gray-400 dark:text-gray-500">
          {directNote}
        </p>
      )}
      <div className={clsx(directNote ? '' : 'mt-1.5', groupSecondary)}>
        {secondary.map(b => <Band key={b.key} band={b} dense={dense} />)}
      </div>
    </div>
  )
}
