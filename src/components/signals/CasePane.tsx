import {
  CORE_SECTION_LABEL, CORE_THESIS_SECTIONS, SUPPORTING_SECTION_LABEL, whyNow,
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
  /**
   * Say "Missing" instead of drawing an em dash.
   *
   * ── Why this is opt-in rather than the default ──────────────────────────
   *
   * On a Research card the absent rows are the subject and the reader arrived
   * to read them; a tick and a dash is the right register, and the dash is
   * deliberately not a colour scale, because a missing section is work that is
   * owed rather than a fault.
   *
   * On a Portfolio card the pane is EVIDENCE for a claim made above it — real
   * capital with no view behind it — and the reader is scanning, not reading.
   * A row of grey dashes reads as an empty form at a glance; the word says
   * what the dash means without making it louder or turning it red.
   *
   * Opt-in so Research renders exactly as it did.
   */
  absenceEmphasis?: boolean
  /**
   * Open the thesis editor at this section.
   *
   * Optional, and the rows are inert without it — the pane is also rendered
   * where there is nothing to write into. Given a handler, a section stops
   * being a label with a word beside it and becomes the way in: the card that
   * says a thesis is missing is the card you write it from.
   */
  onSection?: (section: CoreSection) => void
  /**
   * Lead with WHY NOW rather than with the ownership table.
   *
   * Set by the authoring framings, where the reader's question is not "what is
   * missing" — the three blank rows answer that — but "why this one, out of
   * forty-five". Off elsewhere, where the card already has an event to lead
   * with and the same facts are supporting detail.
   */
  motivate?: boolean
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
  present, supporting = [], caseWrittenAt, daysSinceWritten, daysSinceReviewed, onSection,
  coverageOwners = [], held = false, portfolioName = null, portfolioCount = 0,
  weightPct = null, liveIdeas = [], evidenceCount = 0, motivate = false,
  absenceEmphasis = false,
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

  /**
   * The supporting facts, in the order they earn their place.
   *
   * ── Why the order matters more than the count ─────────────────────────────
   *
   * This pane has a fixed screen and used to overflow it: "Notes on file" — the
   * least decision-bearing row here — was rendering underneath the carousel
   * dots on a dense card. The fix is not smaller type. Coverage, exposure and
   * the write date change what a reader does; a note tally does not, so it goes
   * last and is the first thing to fall off the bottom rather than the first
   * thing to be clipped.
   */
  const facts = [
    exposure ? { label: 'Exposure', value: exposure } : null,
    coverageOwners.length ? { label: 'Covered by', value: coverageOwners.join(', ') } : null,
    ideas ? { label: 'Live idea', value: ideas } : null,
    portfolioCount > 1 ? { label: 'Books', value: String(portfolioCount) } : null,
    evidenceCount > 0
      ? { label: 'Notes on file', value: String(evidenceCount) }
      : null,
  ].filter((r): r is { label: string; value: string } => r != null)

  /** The authoring framings lead with this instead of the fact table. */
  const reasons = motivate
    ? whyNow({ held, weightPct, portfolioName, liveIdeas, evidenceCount, coverageOwners })
    : []

  return (
    /**
     * `min-h-0` and `overflow-hidden`, so content cannot escape downward.
     *
     * The pane sits in a fixed band above the carousel dots and the sticky
     * footer. Without a min-height floor a flex child refuses to shrink below
     * its content and simply renders through whatever is beneath it — which is
     * exactly how "Notes on file" came to sit under the dots.
     */
    <div
      className="flex h-full min-h-0 flex-col justify-center gap-3 overflow-hidden"
      data-slot="case-pane"
    >
      {reasons.length ? (
        <div data-slot="why-now">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Why now
          </p>
          <ul className="mt-1.5 space-y-1">
            {reasons.map(r => (
              <li key={r} className="text-[13px] font-medium text-gray-800 dark:text-gray-100">
                {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="min-h-0">
        {/* Names the SET, so three rows cannot read as the whole case. The
            template is eight fields; these are the three that state a view. */}
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Core thesis
        </p>

        <ul className="mt-2 space-y-0.5">
          {CORE_THESIS_SECTIONS.map(section => {
            const written = has.has(section)
            /**
             * A missing section is the actionable one.
             *
             * A written section already has somewhere to go — the case itself —
             * and offering to "write" it would be the wrong verb. What the
             * reader needs from this card is the way into the part that is not
             * there, so only the gaps are controls.
             */
            const actionable = !!onSection && !written
            return (
              <li
                key={section}
                className="list-none"
                data-section={section}
                data-written={written ? 'yes' : 'no'}
              >
              {actionable ? (
              <button
                type="button"
                onClick={() => onSection!(section)}
                data-section-action={section}
                aria-label={`Write ${CORE_SECTION_LABEL[section]}`}
                className={'flex min-h-[36px] w-full items-center justify-between gap-3 '
                  + '-mx-2 rounded-lg px-2 text-left transition-colors '
                  + 'active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 '
                  + 'focus-visible:ring-primary-500/40 dark:active:bg-gray-800'}
              >
                <span className="text-[13px] text-gray-400 dark:text-gray-500">
                  {CORE_SECTION_LABEL[section]}
                </span>
                <span
                  aria-label="not written"
                  className={absenceEmphasis
                    ? 'text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'
                    : 'text-[13px] text-gray-300 dark:text-gray-600'}
                >
                  {absenceEmphasis ? 'Missing' : '—'}
                </span>
              </button>
              ) : (
              <div className="flex min-h-[28px] items-center justify-between gap-3">
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
                      : absenceEmphasis
                        // Legible at a glance without being an alarm: a
                        // categorical word, not a colour and not a bar. There
                        // is no partial state to express — a section is
                        // written or it is not — so nothing here may read as
                        // progress toward something.
                        ? 'text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'
                        : 'text-[13px] text-gray-300 dark:text-gray-600'
                  }
                >
                  {written ? '✓' : absenceEmphasis ? 'Missing' : '—'}
                </span>
              </div>
              )}
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

      {/* Suppressed under `motivate`: the same facts are the Why-now list
          directly above, and printing them twice is the repetition §29 is
          about rather than a second useful region. */}
      {facts.length && !motivate ? (
        <div className="min-h-0 border-t border-gray-100 pt-3 dark:border-gray-800">
          <ul className="space-y-1.5">
            {facts.map(f => <Fact key={f.label} {...f} />)}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
