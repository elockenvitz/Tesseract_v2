import { CORE_SECTIONS, CORE_SECTION_LABEL, type CoreSection } from '../../lib/research/case-state'

/**
 * Which parts of the case exist, and which do not.
 *
 * ── Presence, never a score ───────────────────────────────────────────────
 *
 * The tempting rendering is a progress bar: two of three sections written, so
 * 67% complete. That number would be false in both directions. A case with all
 * three sections written in one line each is not finished, and a case with a
 * thorough thesis and no risks section is not two-thirds of anything — the
 * sections are different kinds of work, not interchangeable units of it.
 *
 * So this is three literal rows with a tick or a dash. Presence is a fact the
 * data supports. Quality is not recorded anywhere and this pane does not
 * pretend otherwise — which is also why there is no percentage, no ring, no
 * grade and no colour scale.
 *
 * ── Why no prose ──────────────────────────────────────────────────────────
 *
 * The candidate scan deliberately does not transfer contribution content, and
 * rendering the case text here would mean either a per-card query or a second
 * copy of `MobileCaseView` inside a 90px pane. The card's job is to say what
 * state the case is in and hand the reader to the editor that owns it; the
 * action footer already does the handing.
 */

interface CasePaneProps {
  present: CoreSection[]
  /** ISO of the newest core-section save. An EDIT — never a judgment. */
  caseWrittenAt: string | null
  /** Days since that save. Null when the case has never been written. */
  daysSinceWritten: number | null
  /**
   * Days since a completed "reviewed, unchanged" judgment, where one is newer
   * than the last edit. Null otherwise — including when a review predates it.
   */
  daysSinceReviewed?: number | null
}

function span(days: number): string {
  return days >= 365 ? `${(days / 365).toFixed(1)} years` : `${days} day${days === 1 ? '' : 's'}`
}

function writtenLine(caseWrittenAt: string | null, days: number | null): string {
  if (!caseWrittenAt || days == null) return 'Never written'
  const d = new Date(caseWrittenAt)
  const when = Number.isNaN(d.getTime())
    ? ''
    : ` · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
  // "Last written" means an edit, always. It reads `caseWrittenAt` and nothing
  // else, so a judgment can never make this sentence claim prose that is not
  // there — which is precisely what a single shared anchor allowed.
  return `Last written ${span(days)} ago${when}`
}

export function CasePane({ present, caseWrittenAt, daysSinceWritten, daysSinceReviewed }: CasePaneProps) {
  const has = new Set(present)

  return (
    <div className="flex h-full flex-col justify-center" data-slot="case-pane">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        The case
      </p>

      <ul className="mt-2 space-y-1.5">
        {CORE_SECTIONS.map(section => {
          const written = has.has(section)
          return (
            <li
              key={section}
              className="flex items-baseline justify-between gap-3"
              data-section={section}
              data-written={written ? 'yes' : 'no'}
            >
              <span
                className={
                  written
                    ? 'text-[13px] font-medium text-gray-800 dark:text-gray-100'
                    : 'text-[13px] text-gray-400 dark:text-gray-500'
                }
              >
                {CORE_SECTION_LABEL[section]}
              </span>
              {/* A tick and an em dash. Not a colour scale: a missing section is
                  work that is owed, not a fault, and rendering it red would put
                  a capital-break treatment on an empty text field. */}
              <span
                aria-label={written ? 'written' : 'not written'}
                className={
                  written
                    ? 'text-[13px] text-gray-700 dark:text-gray-200'
                    : 'text-[13px] text-gray-300 dark:text-gray-600'
                }
              >
                {written ? '✓' : '—'}
              </span>
            </li>
          )
        })}
      </ul>

      {/* Two clocks, two lines, and only where both are real.
          A completed review is why the card may be quiet; the write date is
          what the reader will actually find when they open the case. Stating
          one without the other is how the pane came to imply recent prose. */}
      {daysSinceReviewed != null ? (
        <p className="mt-2.5 text-[11px] text-gray-500 dark:text-gray-400">
          Reviewed {span(daysSinceReviewed)} ago · unchanged
        </p>
      ) : null}
      <p
        className={
          daysSinceReviewed != null
            ? 'mt-0.5 text-[11px] text-gray-400 dark:text-gray-500'
            : 'mt-2.5 text-[11px] text-gray-500 dark:text-gray-400'
        }
      >
        {writtenLine(caseWrittenAt, daysSinceWritten)}
      </p>
    </div>
  )
}
