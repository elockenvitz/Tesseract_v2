import {
  CORE_SECTION_LABEL, CORE_THESIS_SECTIONS, SUPPORTING_SECTION_LABEL,
  type CoreSection, type SupportingSection,
} from '../../lib/research/case-state'

/**
 * What the case contains, and what is known about the name behind it.
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
 * pretend otherwise — no percentage, no ring, no grade, no colour scale.
 *
 * ── Why the ownership facts live here rather than in their own pane ───────
 *
 * They had one. A no-case card carried `Known`, `Start`, `Case` and `Respond`,
 * which meant four full-screen panes for a state whose entire truth is "there
 * is no written case" — and two of them held four short lines each against a
 * fixed one-screen canvas, so the card read as unfinished rather than composed.
 *
 * The section rows and the facts about the name answer one question between
 * them: what exists here. Composed into one pane they fill a screen; split
 * across two they each fail to. Every row is conditional, so a name with
 * nothing recorded gets a short pane rather than a table of dashes.
 *
 * ── Why no prose ──────────────────────────────────────────────────────────
 *
 * The candidate scan deliberately does not transfer contribution content, and
 * rendering the case text here would mean either a per-card query or a second
 * copy of `MobileCaseView` in a pane. The card says what state the case is in
 * and hands the reader to the editor that owns it; the footer does the handing.
 */

interface CasePaneProps {
  present: CoreSection[]
  /**
   * Supporting case fields that exist — business model, catalysts, estimates.
   *
   * Shown separately and labelled as supporting, because they are part of the
   * case and are NOT part of the view. Folding them into the three rows would
   * make the count mean two things; omitting them entirely is what let a card
   * claim nothing was written about NVDA when a business model was.
   */
  supporting?: SupportingSection[]
  /** ISO of the newest core-section save. An EDIT — never a judgment. */
  caseWrittenAt: string | null
  /** Days since that save. Null when the case has never been written. */
  daysSinceWritten: number | null
  /**
   * Days since a completed "reviewed, unchanged" judgment, where one is newer
   * than the last edit. Null otherwise — including when a review predates it.
   */
  daysSinceReviewed?: number | null

  // ── What is known about the name, all optional and all conditional ──────
  coverageOwners?: string[]
  held?: boolean
  portfolioName?: string | null
  portfolioCount?: number
  /** Current-snapshot weight. Null is never rendered as a zero. */
  weightPct?: number | null
  liveIdeas?: { id: string; action: string | null }[]
  /** Loose notes and thoughts filed against the name, case or no case. */
  evidenceCount?: number
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <span className="truncate text-right text-[13px] font-medium text-gray-800 dark:text-gray-100">
        {value}
      </span>
    </li>
  )
}

export function CasePane({
  present, supporting = [], caseWrittenAt, daysSinceWritten, daysSinceReviewed,
  coverageOwners = [], held = false, portfolioName = null, portfolioCount = 0,
  weightPct = null, liveIdeas = [], evidenceCount = 0,
}: CasePaneProps) {
  const has = new Set(present)

  const exposure = !held
    ? null
    : weightPct != null && Number.isFinite(weightPct)
      ? `${weightPct.toFixed(1)}%${portfolioName ? ` · ${portfolioName}` : ''}`
      // Held with no weight recorded, which is 26 of 36 current production
      // positions. Naming the book is true; inventing a number is not.
      : portfolioName ?? 'Held'

  const ideas = liveIdeas.length === 0
    ? null
    : liveIdeas.length === 1 && liveIdeas[0].action
      ? liveIdeas[0].action.toUpperCase()
      // Several: the count, never one picked arbitrarily.
      : `${liveIdeas.length} live`

  const facts = [
    coverageOwners.length ? { label: 'Covered by', value: coverageOwners.join(', ') } : null,
    exposure ? { label: 'Exposure', value: exposure } : null,
    portfolioCount > 1 ? { label: 'Books', value: String(portfolioCount) } : null,
    ideas ? { label: 'Live idea', value: ideas } : null,
    evidenceCount > 0
      ? { label: 'Notes on file', value: String(evidenceCount) }
      : null,
  ].filter((r): r is { label: string; value: string } => r != null)

  return (
    <div className="flex h-full flex-col justify-center gap-3" data-slot="case-pane">
      <div>
        {/* Names the SET, so three rows cannot read as the whole case. The
            template is eight fields; these are the three that state a view. */}
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Core thesis
        </p>

        <ul className="mt-2 space-y-1.5">
          {CORE_THESIS_SECTIONS.map(section => {
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
                {/* A tick and an em dash. Not a colour scale: a missing section
                    is work that is owed, not a fault, and rendering it red would
                    put a capital-break treatment on an empty text field. */}
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

        {/* Two clocks, two lines, and only where both are real. A completed
            review is why the card may be quiet; the write date is what the
            reader will actually find when they open the case. */}
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

      {supporting.length ? (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Supporting case
          </p>
          <ul className="mt-1.5 space-y-1">
            {supporting.map(sec => (
              <li key={sec} className="flex items-baseline justify-between gap-3" data-supporting={sec}>
                <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100">
                  {SUPPORTING_SECTION_LABEL[sec] ?? sec}
                </span>
                <span aria-label="written" className="text-[13px] text-gray-700 dark:text-gray-200">✓</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {facts.length ? (
        <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
          <ul className="space-y-1.5">
            {facts.map(f => <Fact key={f.label} {...f} />)}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
