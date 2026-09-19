import { ArrowRight, Users } from 'lucide-react'
import { clsx } from 'clsx'
import { useHasCoverage } from '../../hooks/useMyCoverage'

/**
 * One line saying what the reader follows, and the way to change it.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * The full setup card stayed on the pilot home after coverage was declared,
 * sitting under Getting Started: a search box, a suggestion list and a save
 * button, all for a question that had already been answered. It was the
 * largest thing on a screen whose subject was supposed to be the mission.
 *
 * The card earns its size while it is the whole screen and the reader has
 * nothing else to do. Afterwards the only live facts are how many names they
 * follow and where to go to change them, and both fit on one line.
 *
 * ── Why it points at the app rather than reopening the picker ────────────
 *
 * Because the app is now reachable. Coverage opens for a pilot the moment
 * they declare any, through the pilot access map — so editing coverage is an
 * ordinary thing they do in the ordinary place, not a second onboarding
 * surface that happens to live on the home screen.
 *
 * Renders nothing without coverage: the setup card is the surface then, and
 * two things saying the same thing is how the home got crowded in the first
 * place.
 */
export function CoverageSummaryBanner({
  onOpen,
  className,
}: {
  /** Opens the canonical Coverage app. Omitted where it is not reachable. */
  onOpen?: () => void
  className?: string
}) {
  const { count, isLoading } = useHasCoverage()

  if (isLoading || count === 0) return null

  return (
    <div
      data-slot="coverage-summary-banner"
      className={clsx(
        'flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 dark:border-gray-700 dark:bg-gray-800',
        className,
      )}
    >
      <Users className="h-4 w-4 shrink-0 text-primary-500" />
      <p className="min-w-0 flex-1 text-xs leading-snug text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-gray-900 dark:text-white">
          Following {count} {count === 1 ? 'name' : 'names'}.
        </span>{' '}
        Tesseract uses this to decide what to put in front of you.
      </p>
      {onOpen && (
        <button
          type="button"
          data-slot="coverage-summary-banner-open"
          onClick={onOpen}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/30"
        >
          Manage coverage
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
