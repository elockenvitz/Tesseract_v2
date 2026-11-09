import { ArrowLeft } from 'lucide-react'

/**
 * The way back to the section the reader left.
 *
 * ── Where it belongs, which took two tries ────────────────────────────────
 *
 * It was first drawn at the top of the WORK PANE, on the reasoning that the
 * pane is what the reader wants out of. That is the wrong half of the screen.
 * Pressing it does not close the pane so much as give the SECTION its full
 * width back, and the thing it restores is on the left -- so a control above
 * the pane points away from where the press lands, and reads as "dismiss this
 * panel" rather than "go back to Portfolio".
 *
 * Above the browse column it sits over the list it is about to widen, which
 * is what a back control is supposed to do.
 *
 * ── One component, every host ─────────────────────────────────────────────
 *
 * Two shells draw it and three lenses are behind it. A copy per host is how
 * the label and the hit target start disagreeing, which is the same failure
 * the surface tokens were written for.
 */
export function BackToSection({ backTo, onBack }: {
  /**
   * The section the reader came from, in the words its own tab uses. Not a
   * route: the host decides what going back means, and here it means putting
   * the workspace away and giving the section its full width again.
   */
  backTo: string
  onBack: () => void
}) {
  return (
    <button
      onClick={onBack}
      className="-ml-1 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
    >
      <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
      {/* The section's name is in the VISIBLE text, not only in an
          `aria-label`: the reader deciding whether to press this is looking at
          it, not listening to it. */}
      Back to {backTo}
    </button>
  )
}
