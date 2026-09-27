/**
 * The honest answer for a Templates section that is desktop authoring work.
 *
 * Three of the four Templates sections are built on interactions a phone
 * cannot perform. The Excel mapper defines named cell ranges by dragging
 * across a grid roughly 2,400px wide — `SnapshotRangeEditor` listens on
 * `mousedown`/`mouseenter`/`mouseup` and on nothing else, so on touch a drag
 * scrolls the container instead of selecting; its detected-field accept and
 * reject controls appear on hover, and the first tap where they should be
 * creates a new mapping instead. Research Layout is a twelve-column
 * drag-and-resize grid inside a fixed 340px pane. The Investment Case editor
 * is three panes side by side.
 *
 * Reproducing any of that on touch is a large build for work nobody sensibly
 * does on a phone, and the product had already written that down: the mobile
 * surface registry marks Templates `read-only` with the note "authoring stays
 * on desktop". It simply had no enforcement behind it, so the full desktop UI
 * rendered anyway and looked usable until it was touched.
 *
 * This says so instead. It is not a dead end: the section is still named, the
 * count of what is there is still shown when the caller knows it, and the way
 * back is a normal control rather than a clipped icon.
 */

import type { ReactNode } from 'react'
import { Monitor, ChevronLeft } from 'lucide-react'

export interface DesktopAuthoringNoticeProps {
  /** The section as the tab strip names it, e.g. "Excel Extraction". */
  title: string
  /** Why this is desktop work, in the user's terms — not "unsupported". */
  reason: string
  /** Optional read-only summary the phone CAN usefully show. */
  children?: ReactNode
  /** Returns to the Templates landing section. */
  onBack?: () => void
}

export function DesktopAuthoringNotice({
  title,
  reason,
  children,
  onBack,
}: DesktopAuthoringNoticeProps) {
  return (
    <div data-slot="desktop-authoring-notice" className="py-6">
      <div className="mx-auto max-w-sm text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
          <Monitor aria-hidden className="h-5 w-5 text-gray-400" />
        </span>

        <h2 className="mt-3 text-[15px] font-semibold text-gray-900 dark:text-white">
          {title} is built on desktop
        </h2>
        {/* The specific reason, so this reads as a property of the work rather
            than as the phone being second-class. */}
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
          {reason}
        </p>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 px-4 text-[14px] font-medium text-gray-700 active:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:active:bg-gray-800"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
            Back to Templates
          </button>
        )}
      </div>

      {/* Whatever the phone can still usefully read. Kept below the notice so
          the explanation is not buried under a list. */}
      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}
