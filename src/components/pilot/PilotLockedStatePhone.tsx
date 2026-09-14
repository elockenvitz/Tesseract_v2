import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Lock } from 'lucide-react'

/**
 * A pilot's locked Trade Book / Outcomes, composed for a phone.
 *
 * The desktop preview is a documentation page — a pill, a paragraph, a large
 * tinted card and six feature cards. Stacked at 390px it no longer clipped,
 * but the one thing the reader needs (why it's locked, and what to do) sat
 * under a screen of explanation. This is a locked state instead: what the
 * surface is in one line, the lock in a title and two sentences, one
 * full-width action, and three one-line reasons it's worth opening. The
 * message and the action fit in the first screen at 390×844.
 *
 * The shell wraps both tabs in `overflow-hidden`, so this scrolls itself.
 */
export interface PilotLockedItem {
  icon: LucideIcon
  title: string
  /** One short line. */
  line: string
}

export function PilotLockedStatePhone({
  icon: SurfaceIcon,
  tone,
  surface,
  description,
  lockTitle,
  lockBody,
  ctaLabel,
  onCta,
  itemsLabel,
  items,
}: {
  icon: LucideIcon
  tone: 'indigo' | 'teal'
  surface: string
  description: string
  lockTitle: string
  /** One or two sentences. */
  lockBody: string
  ctaLabel: string
  onCta?: () => void
  itemsLabel: string
  items: PilotLockedItem[]
}) {
  const t = TONES[tone]
  return (
    <div data-slot="pilot-locked-phone" className="h-full overflow-y-auto overscroll-contain bg-gray-50 dark:bg-gray-950 px-4 pt-5 pb-8">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${t.tile}`}>
            <SurfaceIcon className="w-4 h-4" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{surface}</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>

        <section data-slot="pilot-locked-card" className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${t.lock}`}>
              <Lock className="w-4 h-4" />
            </div>
            <h2 className="min-w-0 text-[15px] font-semibold leading-snug text-gray-900 dark:text-white">{lockTitle}</h2>
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{lockBody}</p>
          <button
            type="button"
            data-slot="pilot-locked-cta"
            onClick={onCta}
            className="mt-4 w-full h-11 rounded-xl bg-primary-600 active:bg-primary-700 text-sm font-semibold text-white inline-flex items-center justify-center gap-1.5"
          >
            {ctaLabel}
            <ArrowRight className="w-4 h-4" />
          </button>
        </section>

        <h3 className="mt-6 mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{itemsLabel}</h3>
        <ul data-slot="pilot-locked-items" className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
          {items.map(({ icon: ItemIcon, title, line }) => (
            <li key={title} className="flex items-center gap-3 px-4 py-3">
              <ItemIcon className={`w-4 h-4 shrink-0 ${t.item}`} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white">{title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{line}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const TONES = {
  indigo: {
    tile: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300',
    lock: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300',
    item: 'text-indigo-500 dark:text-indigo-400',
  },
  teal: {
    tile: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300',
    lock: 'bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300',
    item: 'text-teal-500 dark:text-teal-400',
  },
} as const
