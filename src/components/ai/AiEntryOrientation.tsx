/**
 * Why the pane was opened — one line, dismissible, and not a context list.
 *
 * ── What it replaces, and why that had to go ─────────────────────────────
 *
 * The AI pane rendered `EngagementContextHeader`, which drew four things
 * stacked: the ticker, the object label, the issue title and detail, and then
 * a heading reading "Context already supplied to the model" over a row of
 * chips from `contextChipsFor`. Opening ACT AI from a CEG tile produced, as
 * the reader saw it:
 *
 *     CEG  CEG
 *     CEG is trading below every case you modelled
 *     CONTEXT ALREADY SUPPLIED TO THE MODEL
 *     ✓ Asset CEG   ✓ Spot $xx.xx   ✓ Raised by valuationBreach
 *
 * Four separate faults in one band:
 *
 *   1. The ticker twice, because `symbol` is "CEG" and `label` is also "CEG"
 *      for an asset whose company name is absent. Two fields, one fact.
 *   2. A heading claiming to list what the model was given, over chips built
 *      from the engagement request -- which is not what the model is given.
 *      `tags` is. The two could and did disagree, and this was the half the
 *      reader could not remove.
 *   3. `Raised by valuationBreach`: an evaluator key rendered as a value.
 *   4. The whole band is undismissable, so a reader who had read it kept it
 *      forever, and a reader who removed the asset from the composer's row
 *      watched this one go on announcing it.
 *
 * ── What this does instead ───────────────────────────────────────────────
 *
 * It says why the reader is here, in the surface's own words, once. It does
 * not say what the model will receive -- the active-context row by the
 * composer is the only thing that says that, because it is the only thing
 * that decides it. And it closes.
 *
 * The suggested question is OFFERED, never sent and never pre-filled by this
 * component: the host places it in the composer so the reader can edit it,
 * and only for an entry that named an event. See `lib/ai/active-context`.
 */
import { clsx } from 'clsx'
import { Info, X } from 'lucide-react'
import type { ActiveContextEvent } from '../../lib/ai/active-context'

export interface AiEntryOrientationProps {
  event: ActiveContextEvent
  /** Dismiss the line. The event is not context, so this detaches nothing. */
  onDismiss: () => void
  className?: string
}

export function AiEntryOrientation({ event, onDismiss, className }: AiEntryOrientationProps) {
  return (
    <div
      data-testid="ai-entry-orientation"
      className={clsx(
        'flex-shrink-0 flex items-start gap-2 border-b px-3 py-2',
        'border-gray-200/80 bg-gray-50/70 dark:border-white/10 dark:bg-white/[0.03]',
        className,
      )}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium leading-snug text-gray-900 dark:text-gray-100">
          {event.title}
        </p>
        {event.detail && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-gray-600 dark:text-gray-400">
            {event.detail}
          </p>
        )}
      </div>
      <button
        type="button"
        data-testid="ai-orientation-dismiss"
        aria-label="Dismiss why you are here"
        onClick={onDismiss}
        className="-mr-1 shrink-0 rounded p-1 text-gray-400 hover:bg-black/5 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
