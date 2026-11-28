/**
 * The same decision, seen twice: when it was made, and when it was revisited.
 *
 * ── Why this is the strongest figure on the page ─────────────────────────
 *
 * Everything else here can be argued against by a PM who already has a
 * research system: they have notes, they have a process, they have a
 * meeting where decisions get made. What they do not have is the ability
 * to open a position eight months later and read WHAT THEY ACTUALLY
 * BELIEVED when they took it, as opposed to what they now remember
 * believing.
 *
 * That gap is invisible until you see the two columns side by side, which
 * is why this is a figure and not a paragraph. A paragraph claiming "you
 * can revisit the original reasoning" is a feature sentence. Two columns
 * showing a conviction that moved from High to Medium, against a named
 * assumption that turned out to be wrong, is an argument.
 *
 * ── WHAT CHANGED, 2026-11-27 ─────────────────────────────────────────────
 *
 * The review asked for this to become one of the most compelling parts of
 * the page, with more narrative depth and, specifically, for the
 * connection between the original thinking and the current judgement to be
 * VISUALLY OBVIOUS. It was two columns of five rows with a hairline
 * between them, which states adjacency and not linkage: nothing in the
 * drawing said the right column was reading the left one.
 *
 * Three changes:
 *
 *   ROW-FOR-ROW CORRESPONDENCE. The two columns are now one object with a
 *   shared row grid, so each piece of the original case sits on the same
 *   line as what became of it. The assumption is beside its verdict, the
 *   conviction beside where it moved to. That is the linkage, drawn.
 *
 *   A SPINE, with an arrow per row at `md` and up. Two columns side by
 *   side read as a comparison; two columns joined by arrows read as a
 *   derivation, which is what this is.
 *
 *   MORE OF THE CASE. Valuation and the portfolio action were missing from
 *   both sides, and they are the two rows a PM looks for first.
 *
 * ── The distinction this figure has to protect ───────────────────────────
 *
 * The right-hand column deliberately does NOT render a verdict on the
 * call. It renders what changed. The section's closing line says the thing
 * the product actually makes possible — that the outcome is only part of
 * the story, and that the original reasoning is what lets a firm look at
 * the rest. It does not claim to separate skill from luck on anyone's
 * behalf, and this figure must not either.
 *
 * Same honesty rules as every figure here: no price, no return, no
 * checkable claim about the real company, a visible illustrative marker,
 * and every field corresponding to something really stored. The name is
 * the page's flagship, so a reader arriving here has already followed this
 * same position through the workspace, the recommendation and the trade.
 */
import { FLAGSHIP, ILLUSTRATIVE } from './ScreenFigures'

/**
 * The decision, as corresponding pairs.
 *
 * `then` is what the record froze at submission. `now` is what the review
 * found. They are one array rather than two because the point of the
 * figure is that they are the same rows, and two arrays would let them
 * drift out of correspondence the first time anyone edited one of them.
 */
const ROWS: { field: string; then: string; now: string; moved?: boolean }[] = [
  {
    field: 'Thesis',
    then: 'Azure AI demand turns today’s capex into durable margin',
    now: 'Intact in direction, slower in timing',
  },
  {
    field: 'Key assumption',
    then: 'Monetization follows the build inside two quarters',
    now: 'Wrong. It took a third quarter',
    moved: true,
  },
  {
    field: 'Principal risk',
    then: 'Capex outrunning monetization, or supply limiting the build',
    now: 'The first one happened, and it was on the list',
  },
  {
    field: 'Valuation',
    then: 'Base case built on the two-quarter path',
    now: 'Rebuilt on the later schedule',
    moved: true,
  },
  {
    field: 'Conviction',
    then: 'High',
    now: 'Medium, lowered and dated',
    moved: true,
  },
  {
    field: 'Action',
    then: 'Approved. Initiated, sized to the stated conviction',
    now: 'Position held. Sizing is the open question',
  },
]

export function ReassessFigure() {
  return (
    <figure
      data-illustration="true"
      className="relative overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.1]"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-white/[0.07] px-5 py-4 sm:px-7">
        <span className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-amber-300/80" />
          <span data-security-name className="truncate font-mono text-[16px] text-white">
            {FLAGSHIP.ticker}
          </span>
          <span aria-hidden="true" className="text-slate-700">/</span>
          <span className="truncate text-[16px] font-medium text-slate-300">
            Decision review
          </span>
        </span>
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-400">
          {ILLUSTRATIVE}
        </span>
      </figcaption>

      {/* The two column headers, which carry the time gap. They sit above
          the rows rather than inside each column, so the grid below reads
          as one table with two sides instead of two lists. */}
      <div className="grid border-b border-white/[0.07] md:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)]">
        <p className="px-5 pt-5 text-[12px] font-medium uppercase tracking-[0.12em] text-slate-400 sm:px-7">
          When the decision was made
        </p>
        <span aria-hidden="true" className="hidden md:block" />
        <p className="px-5 pb-5 pt-4 text-[12px] font-medium uppercase tracking-[0.12em] text-amber-300/80 sm:px-7 md:pt-5">
          Eight months later
        </p>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {ROWS.map(({ field, then, now, moved }) => (
          <div
            key={field}
            className="grid items-start gap-y-2 px-5 py-5 sm:px-7 md:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] md:gap-y-0"
          >
            <div>
              <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-slate-400">
                {field}
              </p>
              <p className="mt-1.5 text-[17px] leading-[1.55] text-slate-400">{then}</p>
            </div>

            {/*
              THE SPINE. One arrow per row, so each line of the original
              case visibly becomes the line beside it. `hidden md:flex`
              because below that breakpoint the two halves stack, and an
              arrow pointing right at a block that is now underneath is
              worse than no arrow.

              The gold marks the rows where the view actually MOVED, which
              is the fastest read in the figure: three of six changed, and
              you can see which three without reading a word.
            */}
            <div className="hidden items-center justify-center md:flex md:pt-7">
              <span
                aria-hidden="true"
                className={`text-[18px] ${moved ? 'text-amber-300' : 'text-slate-700'}`}
              >
                &#8594;
              </span>
            </div>

            <div className="md:pl-1">
              <p
                className={`text-[12px] font-medium uppercase tracking-[0.1em] ${
                  moved ? 'text-amber-300/80' : 'text-slate-400'
                }`}
              >
                {moved ? 'Changed' : 'Unchanged'}
              </p>
              <p
                className={`mt-1.5 text-[17px] leading-[1.55] ${
                  moved ? 'text-white' : 'text-slate-300'
                }`}
              >
                {now}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-y-4 border-t border-white/[0.07] px-5 py-5 sm:px-7 md:grid-cols-2 md:gap-x-10">
        <p className="text-[14px] leading-relaxed text-slate-400">
          The left column was frozen at submission. Later edits created
          versions and never altered it.
        </p>
        <p className="text-[14px] leading-relaxed text-slate-400">
          The assumption that failed was one the analyst had already named, so
          the live question is sizing.
        </p>
      </div>
    </figure>
  )
}
