/**
 * Who the product is for, in the three seats that buy it.
 *
 * ── Why this section exists ──────────────────────────────────────────────
 *
 * The page could describe the product completely and still leave every
 * individual reader to work out what it meant for THEM. An analyst, a PM
 * and a CIO want three different things from the same software.
 *
 * ── The trap this section is built to avoid ──────────────────────────────
 *
 * A role selector is the easiest place on a marketing page to ship the
 * same content three times. This page has already had that bug once: a
 * "what you actually work in" section that turned out to be the lifecycle
 * section with the nouns swapped, in the same order, and no heading could
 * fix it because the content was the duplicate.
 *
 * So the rule here is that each role gets a STRUCTURALLY DIFFERENT
 * artifact, not a reskin:
 *
 *   Analyst  a WORKSPACE  — a day, with what needs you and what moved
 *   PM       a DECISION   — one ruling, with the case and the pipeline
 *                           behind it
 *   CIO      a LEDGER     — the same name over years, accumulating, plus
 *                           how the desk actually decides
 *
 * A workspace, a decision and a ledger are three different shapes. If
 * someone later makes all three render the same component with different
 * strings, the section has regressed to what it replaced, and the test
 * `gives each role a different shape of artifact` is there to catch it.
 *
 * ── THE COPY IS DECLARATIVE, 2026-11-27 ─────────────────────────────────
 *
 * The three claims were imperatives aimed at the reader: "Be an investor,
 * not an information manager", "Lead a better-informed team without
 * chasing it", "Build a firm that gets sharper every year". The first in
 * particular is now explicitly out: telling an analyst what to be, on a
 * page they did not ask to read, is the register the whole editorial pass
 * was correcting. The headings describe the DESTINATION instead, and the
 * supporting points describe the environment rather than instructing
 * anyone to operate in it.
 *
 * ── Honesty ──────────────────────────────────────────────────────────────
 *
 * Same rules as every other figure: fictional eight-letter names, nothing
 * invented presented as measured, a visible illustration marker, and every
 * field corresponds to something the product really stores. The stage names
 * in the pipeline panel are the product's own canonical four; the coverage
 * rows are coverage assignments; the process rows are workflow stages with
 * their open requirements.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FLAGSHIP, ILLUSTRATIVE } from './ScreenFigures'
import { HEADER_PX, isStackedLayout, pinnedHeight, revealPanel } from './revealPanel'

function Col({ children }: { children: ReactNode }) {
  return (
    <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-slate-400">
      {children}
    </span>
  )
}

/**
 * The figure frame.
 *
 * ── Why the panels are PANES now ────────────────────────────────────────
 *
 * Each role used to render one card about 480px wide beside a column of
 * prose. The review was that the product demonstrations "feel too small
 * and abstract", and at that size they were: a single list in a box, with
 * the section's own text beating it for visual weight.
 *
 * The section is now full-canvas width and each figure is two or three
 * PANES divided by hairlines, which is how the application itself is laid
 * out. That is the difference between a marketing card and something that
 * reads as software.
 */
function Figure({ caption, context, children }: { caption: string; context: string; children: ReactNode }) {
  return (
    <figure
      data-illustration="true"
      data-role-figure
      className="relative overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.1]"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-white/[0.07] px-5 py-3.5 sm:px-6">
        <span className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-amber-300/80" />
          <span className="text-[16px] font-semibold tracking-tight text-white">{caption}</span>
          <span aria-hidden="true" className="text-slate-700">/</span>
          <span className="truncate text-[14px] text-slate-400">{context}</span>
        </span>
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-400">
          {ILLUSTRATIVE}
        </span>
      </figcaption>
      {children}
    </figure>
  )
}

/** One pane inside a figure. Opaque, so panes separate by their own edge. */
function Pane({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-[#07090e] p-5 sm:p-6 ${className}`}>{children}</div>
}

/* ── ANALYSTS: a working day ───────────────────────────────────────────── */

const QUEUE = [
  { name: 'MSFT', why: 'Earnings in four days, prep stage open', tag: 'Prep due', hot: true },
  { name: 'NVDA', why: 'Thesis untouched since the last guide', tag: 'Review', hot: true },
  { name: 'AVGO', why: 'Two diligence requirements still open', tag: 'Open', hot: false },
  { name: 'V', why: 'Price target passed, no note since', tag: 'Revisit', hot: false },
]

/* Changes across coverage. Every one of these is a field the product keeps
   a dated history for, which is why the column can exist at all. */
const MOVED = [
  ['Conviction', 'NVDA, High to Medium'],
  ['Price target', 'V, raised, prior kept'],
  ['Thesis', 'MSFT, version 4 of 4'],
  ['Idea stage', 'AVGO, now developing'],
]

function AnalystWorkspace() {
  return (
    <Figure caption="Research workspace" context="Your coverage, this morning">
      <div className="grid gap-px bg-white/[0.06] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Pane>
          <Col>Needs you first</Col>
          <ul className="mt-4 divide-y divide-white/[0.05]">
            {QUEUE.map(({ name, why, tag, hot }) => (
              <li key={name} className="flex items-start justify-between gap-4 py-3.5 first:pt-0">
                <div className="min-w-0">
                  <p data-security-name className="font-mono text-[14px] tracking-tight text-white">
                    {name}
                  </p>
                  <p className="mt-1 text-[14px] leading-relaxed text-slate-400">{why}</p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[14px] font-medium ring-1 ring-inset ${
                    hot
                      ? 'bg-amber-400/10 text-amber-200 ring-amber-300/25'
                      : 'bg-white/[0.04] text-slate-300 ring-white/10'
                  }`}
                >
                  {tag}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            Ordered from the work already in the system, not from a status form.
          </p>
        </Pane>

        {/*
          THE SECOND PANE IS THE ONE THAT MAKES THIS A DAY RATHER THAN A
          LIST. A queue says what to do. "What moved" says what changed
          while you were not looking, which is the thing an analyst
          currently reconstructs by reading four systems.
        */}
        <Pane>
          <Col>What moved since you last looked</Col>
          <dl className="mt-4 space-y-3.5">
            {/* The label column is 7rem, not 5.5rem: "PRICE TARGET" at
                12px uppercase with 0.08em tracking does not fit 5.5rem
                and was wrapping onto two lines, knocking that one row out
                of alignment with the other three.

                This comment lives HERE, above the map, rather than as the
                first thing inside the arrow body, where a JSX comment is
                a syntax error because the parenthesised body has to begin
                with the element. Same shape as the known trap about a JSX
                comment under a guard, and I hit it again.

                Then I hit a second one writing this note: quoting a JSX
                comment's own delimiters INSIDE a JSX comment ends it at
                the quote, and the remainder becomes JSX text. Hence the
                delimiters are described here in words. */}
            {MOVED.map(([term, def]) => (
              <div key={term} className="grid grid-cols-[7rem_1fr] gap-x-3">
                <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">
                  {term}
                </dt>
                <dd className="text-[16px] leading-relaxed text-slate-300">{def}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            Each change keeps what it changed from.
          </p>
        </Pane>
      </div>
    </Figure>
  )
}

/* ── PORTFOLIO MANAGERS: a decision, with the team behind it ──────────── */

/* The product's own canonical pipeline stages, in order of maturity. */
const PIPELINE = [
  { stage: 'Ready to recommend', names: 'MSFT', on: true },
  { stage: 'Developing', names: 'AVGO, COST', on: false },
  { stage: 'Researching', names: 'NVDA', on: false },
  { stage: 'Exploring', names: 'V, JPM', on: false },
]

function PmDecision() {
  return (
    <Figure caption="Decision Inbox" context="One ruling, with its case">
      {/* The ruling pane carries six labelled rows and needs the width.
          At the old 1:1.3 split its value column was 261px on a 1280
          laptop, every row wrapped to two lines, and the panel ran past
          the fold. 0.85:1.4 buys it 60px, which is three rows back. */}
      <div className="grid gap-px bg-white/[0.06] lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.5fr)]">
        {/*
          THE PIPELINE PANE IS NEW, and it is the brief's point about
          showing the RELATIONSHIP rather than the mechanics of clicking
          Approve. A ruling in isolation is a form. A ruling with the
          desk's pipeline beside it is the PM's actual job: knowing what
          is coming before it arrives.
        */}
        <Pane>
          <Col>What the desk is working on</Col>
          <ul className="mt-4 space-y-2">
            {PIPELINE.map(({ stage, names, on }) => (
              <li
                key={stage}
                className={`rounded-lg px-3 py-2.5 ring-1 ring-inset ${
                  on ? 'bg-amber-400/[0.08] ring-amber-300/25' : 'ring-white/[0.07]'
                }`}
              >
                <p className={`text-[14px] font-medium ${on ? 'text-white' : 'text-slate-300'}`}>
                  {stage}
                </p>
                <p data-security-name className="mt-1 font-mono text-[14px] text-slate-400">
                  {names}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            Maturity, not status. Recommending is a separate record.
          </p>
        </Pane>

        <Pane>
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
            <div>
              <p data-security-name className="font-mono text-[14px] tracking-tight text-white">
                {FLAGSHIP.ticker}
              </p>
              <p className="mt-1 text-[14px] text-slate-400">
                Add · 180 bps · from {FLAGSHIP.analyst}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-amber-400/10 px-2 py-0.5 text-[14px] font-medium text-amber-200 ring-1 ring-inset ring-amber-300/25">
              Awaiting you
            </span>
          </div>

          <dl className="mt-4 space-y-3">
            {[
              ['The claim', FLAGSHIP.thesis],
              /* "High, raised from Medium after the channel work" wrapped
                 to a second line at 1280 and nowhere else, which was the
                 whole 21px by which this panel missed a stable section
                 height. The claim that matters is that conviction records
                 WHAT MOVED IT, and that survives the cut. */
              ['Conviction', 'High, raised after the channel work'],
              ['Catalysts', 'Copilot seat disclosure, then the next capex guide'],
              /* Shortened to hold the panel inside one 1280x720 viewport.
                 Both values wrapped to a third line at that width, which
                 is where the PM panel ran 40px past the fold. */
              ['Key risks', 'Capex outrunning monetization, or supply limits'],
              /* 310 held + the 180 bps being requested in the header = the
                 490 target. Change one and change all three. */
              ['Portfolio', `${FLAGSHIP.book}, 310 bps held against a 490 bps target`],
            ].map(([term, def]) => (
              <div key={term} className="grid grid-cols-[5.5rem_1fr] gap-x-3">
                <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">
                  {term}
                </dt>
                <dd className="text-[14px] leading-relaxed text-slate-300">{def}</dd>
              </div>
            ))}
          </dl>

          {/*
            ── THE VALUATION IS DRAWN NOW, NOT DESCRIBED ──────────────────

            This was a seventh row of the list above, reading "Bull, base
            and bear, each on its own Azure path". A recommendation whose
            valuation is one more line of prose is a form. What a PM is
            actually weighing is how much of the case sits in each
            scenario, and that is a shape rather than a sentence.

            THE NUMBERS ARE HYPOTHETICAL AND THE PAGE SAYS SO. A target,
            a scenario weight and an expected return are an analyst's
            assumptions, not quotes; an investment professional reads a
            valuation band without them and sees a diagram rather than a
            product. What this page must never print is FACTUAL market
            data about a real company: a real share price, a real return,
            a real dated event. The marker in this block and the gate
            behind it draw exactly that line.

            THE ARITHMETIC IS INTERNALLY CONSISTENT and meant to survive
            an analyst checking it. Against the $450 reference: 620 is
            +38%, 540 is +20%, 380 is -16%. The weights sum to 100 and
            the probability-weighted target is .25(620) + .55(540) +
            .20(380) = $528, which is +17%. Changing one number here
            means changing the line underneath.

            The capability is real and shipped: the asset overview
            carries bull, base and bear as a weighted distribution rather
            than a single target.
          */}
          <div className="mt-4 border-t border-white/[0.07] pt-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <Col>Valuation</Col>
              <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">
                Hypothetical
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {[
                { name: 'Bull', w: 'w-[25%]', on: false, pt: '$620', p: '25%', r: '+38%' },
                { name: 'Base', w: 'w-[55%]', on: true, pt: '$540', p: '55%', r: '+20%' },
                { name: 'Bear', w: 'w-[20%]', on: false, pt: '$380', p: '20%', r: '-16%' },
              ].map(({ name, w, on, pt, p, r }) => (
                <li key={name} className="grid grid-cols-[2.75rem_1fr] items-center gap-x-3">
                  <span className={`text-[14px] font-medium ${on ? 'text-white' : 'text-slate-400'}`}>
                    {name}
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]"
                    >
                      <span
                        className={`block h-full rounded-full ${w} ${
                          on ? 'bg-amber-300/70' : 'bg-amber-300/30'
                        }`}
                      />
                    </span>
                    {/* `tabular-nums` so the three rows read as a column.
                        Without it the digits are proportional and $620
                        sits a few pixels off $540, which is the detail
                        that makes a figure look drawn rather than real. */}
                    <span className="shrink-0 font-mono text-[14px] tabular-nums text-slate-300">
                      <span className={on ? 'text-white' : undefined}>{pt}</span>
                      <span className="ml-2.5 inline-block w-[3.5ch] text-right text-slate-400">
                        {p}
                      </span>
                      <span className="ml-2.5 inline-block w-[4.5ch] text-right">{r}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {/* The reference price is stated so the three returns above
                are checkable rather than decorative, and the weighted
                line is the feature itself: the product carries a
                distribution, not a single target. */}
            <p className="mt-2.5 text-[12px] leading-tight text-slate-400">
              Weighted <span className="font-mono tabular-nums text-slate-300">$528</span>,{' '}
              <span className="font-mono tabular-nums text-slate-300">+17%</span> on a{' '}
              <span className="font-mono tabular-nums text-slate-300">$450</span> reference.
            </p>
          </div>

          {/*
            Reject and Defer are drawn at the SAME weight as Approve,
            because the argument of the whole product is that a rejection
            is a record. Greying them out would contradict the page.
          */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
            {['Approve', 'Reject', 'Defer'].map(verb => (
              <span
                key={verb}
                className="rounded-md bg-white/[0.04] px-2.5 py-1 text-[14px] font-medium text-slate-300 ring-1 ring-inset ring-white/10"
              >
                {verb}
              </span>
            ))}
            {/* The trailing "Each one is recorded with its reasoning."
                went here: it fitted beside the pills at 1440 and wrapped
                to a second row at 1280, which cost this panel 29px at
                exactly the width where it had none to spare. The claim
                is not lost. The left pane says a recommendation is its
                own record, and the whole page argues it. */}
          </div>
        </Pane>
      </div>
    </Figure>
  )
}

/* ── INVESTMENT LEADERSHIP: a ledger, and how the desk decides ─────────── */

/*
 * ── THE TICK-MARK LEDGER IS GONE, AND THE RAIL ABSORBED IT ──────────────
 *
 * The left pane used to stack two visuals: three rows of amber tick
 * marks standing for "activity" (3, then 5, then 7) above a conviction
 * rail. Two problems. The tick marks were the weakest drawing on the
 * page, because a count of records is not a thing a CIO wants; and the
 * two together made this the tallest panel of the three, which broke
 * the single-viewport requirement on a 1280x720 laptop by 39px.
 *
 * One visual now. The rail carries the years, the conviction at each
 * one and what moved it, which is what the tick marks were gesturing at
 * without saying.
 */

/* Process visibility, drawn as the firm's own throughput rather than as a
   score on a person. See the note in `ROLES` on why that distinction is
   load-bearing here. */
/**
 * Conviction, as it moved, over the same three years.
 *
 * ── Why this is here ────────────────────────────────────────────────────
 *
 * The leadership pane said two things: work accumulated, and the process
 * is visible. Both are true and neither is the thing a CIO is actually
 * buying. The question underneath "an investment organization that
 * learns" is whether the firm can see how its views change, which is the
 * one piece of institutional memory nobody has on paper.
 *
 * Every field here is stored: conviction is a value with a dated history,
 * the thesis carries versions, and the review that lowered it is a record
 * pointing at the assumption it failed on. The figure draws the history,
 * it does not compute anything from it.
 *
 * `level` is a height, not a number. A conviction scale is ordinal, and
 * printing "3 of 5" beside a real ticker would be a quantitative claim
 * this page has no business making.
 */
const CONVICTION: { at: string; level: 'High' | 'Medium'; why: string }[] = [
  { at: 'Yr 1', level: 'High', why: 'Initiated, then added to twice' },
  { at: 'Yr 2', level: 'High', why: 'Thesis revised, case intact' },
  { at: 'Yr 2', level: 'Medium', why: 'A named risk was realized' },
  { at: 'Yr 3', level: 'Medium', why: 'Exited, and the review says why' },
]

const PROCESS = [
  ['How recommendations get decided', 'the reasoning behind each ruling, kept'],
  ['What the firm declined', 'as retrievable as what it acted on'],
  ['What the reviews found', 'read against the original case'],
]

function CioLedger() {
  return (
    <Figure caption="Institutional intelligence" context="One name, three years, two analysts">
      <div className="grid gap-px bg-white/[0.06] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Pane>
          {/*
            Four dated moments on one name, drawn as heights rather than
            as a score. High is the full track, Medium is half of it,
            and the step down lands on the moment that caused it.
            Conviction is an ordinal value with a dated history in the
            product, so this draws a record; it computes nothing, and it
            prints no number, because "3 of 5" beside a real ticker
            would be a quantitative claim this page has no business
            making.
          */}
          <Col>How the view changed, and when</Col>
          <div className="mt-5 grid grid-cols-4 gap-2.5">
            {CONVICTION.map(({ at, level, why }, i) => (
              <div key={i} className="flex flex-col">
                <span aria-hidden="true" className="flex h-16 items-end">
                  <span
                    className={`w-full rounded-t-sm ${
                      level === 'High' ? 'h-16 bg-amber-300/55' : 'h-8 bg-amber-300/30'
                    }`}
                  />
                </span>
                {/*
                  A BASELINE UNDER ALL FOUR, drawn per column so it
                  bridges the gaps. Without it the four bars read as
                  four unrelated quantities; with it they read as one
                  track over time, which is the whole point of the
                  figure.
                */}
                <span aria-hidden="true" className="-mx-1.5 mt-px block h-px bg-white/15" />
                {/*
                  Level and moment on ONE line, and NOT in the uppercase
                  tracked style the other labels use: "MEDIUM · YR TWO"
                  wrapped to two lines in a 96px column while
                  "HIGH · YR ONE" did not, so the sentences underneath
                  sat at two different heights.
                */}
                <span className="mt-2.5 text-[12px] font-medium text-slate-400">
                  {level} &middot; {at}
                </span>
                <span className="mt-1.5 text-[14px] leading-[1.4] text-slate-300">{why}</span>
              </div>
            ))}
          </div>

          <p className="mt-5 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            The analyst who opened this name has gone. The investment
            knowledge remains with the firm.
          </p>
        </Pane>

        <Pane>
          <Col>How the firm decides, visible</Col>
          <dl className="mt-4 space-y-3.5">
            {PROCESS.map(([term, def]) => (
              <div key={term} className="border-t border-amber-300/20 pt-3.5 first:border-t-0 first:pt-0">
                <dt className="text-[14px] font-medium text-white">{term}</dt>
                <dd className="mt-1 text-[14px] leading-relaxed text-slate-400">{def}</dd>
              </div>
            ))}
          </dl>
          {/*
            NOT A SCORECARD, and this sentence is the guardrail. The brief
            is explicit that this experience must not read as monitoring
            individuals, and a page about process visibility is one
            sentence away from implying exactly that. So the subject is the
            PROCESS, and the figure says so in its own words.
          */}
          <p className="mt-5 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            A view of the process, not a score on anyone.
          </p>
        </Pane>
      </div>
    </Figure>
  )
}

/* ── The roles ─────────────────────────────────────────────────────────── */

const ROLES = [
  {
    seat: 'Analysts',
    shape: 'workspace',
    claim: 'More time for differentiated research.',
    lead:
      'A research environment where coverage, investment theses, valuation assumptions and emerging ideas come together. Less time reconstructing information, more time developing a differentiated view.',
    Artifact: AnalystWorkspace,
    points: [
      ['The day starts already ordered', 'Coverage, open process stages and what has gone quiet, in one place.'],
      ['Previous research stays reachable', 'The case, the risks and the history live on the security itself.'],
      ['A recommendation is the next step, not a new document', 'It assembles from research that already exists.'],
    ],
  },
  {
    seat: 'Portfolio managers',
    shape: 'decision',
    claim: 'Greater clarity. Stronger investment judgment.',
    lead:
      'A more complete view of the investment team, the ideas taking shape and the reasoning behind portfolio decisions. An environment where conviction can evolve alongside the facts.',
    Artifact: PmDecision,
    points: [
      ['The pipeline is visible before it arrives', 'What the desk is developing, and how mature each name is.'],
      ['A recommendation arrives as an argument', 'Conviction, catalysts, valuation and risks, not a one-line request.'],
      ['A view that changed shows what changed it', 'Conviction carries when it moved, and against which assumption.'],
    ],
  },
  {
    seat: 'Investment leadership',
    shape: 'ledger',
    claim: 'An investment organization that learns.',
    lead:
      'An institutional foundation for research, judgment and experience that outlasts any individual investor. More effective teams, and continuity through the changes a firm goes through.',
    Artifact: CioLedger,
    points: [
      /*
         Was "Knowledge survives a departure" and "The process becomes
         legible". Both true, both written from the inside: the first
         makes the whole leadership case about attrition, and the second
         is a word a CIO would not use about their own firm. The value
         is the same and the subject is now the organization rather than
         its records.
      */
      ['Knowledge that outlasts individuals', 'Prior work stays on the name, so a departure costs a person rather than a decade of context.'],
      ['Greater visibility into investment decisions', 'How the firm actually decides, rather than how it describes deciding.'],
      /*
         Was "Every decision adds to the next one", which is the same
         accumulation claim as the point above it and the section's own
         closing line. The brief is explicit that this seat must not reduce
         to recordkeeping, so the third point is the thing the record makes
         possible rather than a third way of saying there is one.
      */
      ['Firm-specific intelligence has something to stand on', 'The assistant reasons over the firm’s own record, not a generic corpus.'],
    ],
  },
] as const

export function RoleSwitch() {
  const [active, setActive] = useState(0)
  const [fading, setFading] = useState(false)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const sticky = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { seat, claim, lead, Artifact, points } = ROLES[active]

  /*
    A 160ms cross-fade on the panel when the seat changes.

    Two reasons it is written as state and a frame rather than as an
    animation: this page asserts that it injects no stylesheet of its own
    and declares no inline `animation`, which is how the aurora drift got
    out and how a twinkling star would get back in; and a transition that
    only runs on a deliberate click cannot become ambient motion.

    Two frames, not one. A single rAF can land in the same paint as the
    state change, and the element then goes from opacity-0 to opacity-1
    with nothing in between, which is a flicker rather than a fade.
  */
  useEffect(() => {
    if (!fading) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setFading(false))
    })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [fading])

  function select(i: number) {
    /*
      The already-selected seat is a no-op, deliberately. Without this
      guard a second tap on the current tab would scroll the page on a
      phone, which is the single most confusing thing a tab can do.
    */
    if (i === active) return
    setFading(true)
    setActive(i)

    /*
      ── REPOSITION ON A PHONE, NEVER ON A DESKTOP ────────────────────

      Above `xl` the selector and the whole demonstration share one
      viewport, so the scroll position is already right and moving it
      would be the disorienting thing. Below `xl` the section stacks to
      roughly two screens, and a visitor who switches seats two thirds
      of the way down lands two thirds of the way down the NEW seat,
      having never seen its headline.

      After the paint, not during it: the panel's box is read from the
      DOM and the new seat's content has to be in place first.
    */
    if (!isStackedLayout()) return
    requestAnimationFrame(() => {
      revealPanel(panel.current, HEADER_PX + pinnedHeight(sticky.current))
    })
  }

  function move(to: number) {
    const next = (to + ROLES.length) % ROLES.length
    select(next)
    /*
      `preventScroll`. The tablist is sticky inside this section, so
      focusing a tab normally costs nothing — but on a short laptop the
      browser will still nudge the page to satisfy the scroll-into-view,
      and the brief is explicit that switching seats must not reposition
      anything.
    */
    tabs.current[next]?.focus({ preventScroll: true })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const k = e.key
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return
    e.preventDefault()
    if (k === 'Home') return move(0)
    if (k === 'End') return move(ROLES.length - 1)
    move(active + (k === 'ArrowRight' ? 1 : -1))
  }

  return (
    <div>
      {/*
        ── THE SELECTOR IS STICKY, AND THAT IS THE FIX ───────────────────

        The complaint: pick a seat, scroll down to read it, and the
        selector has left the viewport. Switching to another seat meant
        scrolling back up, so most visitors saw one of three experiences.

        Sticky at `top-[4.5rem]`, which clears the 73px global header.
        Scoped to this component's own root, so it releases at the end of
        the section and never follows the reader into the lifecycle. The
        surface is opaque: the figure scrolls underneath it, and at 95%
        the pane rules read straight through.

        The three tabs are a ROW at every width now, not a stacked grid
        below `sm`. Three stacked tabs are ~150px of permanently sticky
        furniture on a phone, which is a worse problem than the one this
        solves.
      */}
      <div
        ref={sticky}
        className="sticky top-[4.5rem] z-20 -mx-4 bg-[#050710] px-4 pb-3 pt-2 sm:-mx-6 sm:px-6"
      >
      <div
        role="tablist"
        aria-label="Who Tesseract is for"
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-2"
      >
        {ROLES.map(({ seat: s, shape }, i) => {
          const on = i === active
          return (
            <button
              key={s}
              ref={el => { tabs.current[i] = el }}
              type="button"
              role="tab"
              data-role-seat={s}
              data-role-shape={shape}
              id={`role-tab-${i}`}
              aria-selected={on}
              aria-controls="role-panel"
              aria-label={s}
              tabIndex={on ? 0 : -1}
              onClick={() => select(i)}
              /*
                ── THE UNSELECTED TABS DID NOT LOOK CLICKABLE ─────────────
                They rendered as bare text on the page background: no
                surface, and a `bg-white/12` rule that is about a 3%
                luminance step on #050710 and therefore invisible. A
                visitor had no way to know two thirds of this section
                existed, which for a role selector is the whole feature.

                Every tab now sits on its own ring, and the rule above an
                unselected one is drawn at an opacity a display can
                actually resolve. Selected still wins by a filled surface
                and a full amber rule, so the current choice is never
                ambiguous.
              */
              className={`group min-h-[48px] rounded-lg px-3 pb-2.5 pt-2.5 text-left ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710] sm:px-4 sm:pb-3 ${
                on
                  ? 'bg-white/[0.07] ring-white/15'
                  : 'ring-white/[0.08] hover:bg-white/[0.035] hover:ring-white/20'
              }`}
            >
              <span
                aria-hidden="true"
                className={`block h-0.5 w-full rounded-full transition-colors ${
                  on ? 'bg-amber-400' : 'bg-white/25 group-hover:bg-amber-400/50'
                }`}
              />
              <span
                className={`mt-2 block text-balance text-[14px] font-semibold leading-tight tracking-tight transition-colors sm:mt-2.5 sm:text-[20px] ${
                  on ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              >
                {s}
              </span>
            </button>
          )
        })}
      </div>
      </div>

      <div
        ref={panel}
        id="role-panel"
        role="tabpanel"
        aria-labelledby={`role-tab-${active}`}
        tabIndex={-1}
        /*
          A FLOOR ON THE PANEL ITSELF, not just on its two columns.

          The columns differ by role and the panel takes the taller of
          them, so per-column floors still let the section change height
          when a seat is picked. Measured at 1280, 1366, 1440 and 1920:
          the tallest of the six column heights is 551px, so 556 holds
          every combination with a hair to spare and nothing clips.

          Only at `xl`, where the two-column composition applies. Below
          that the panel stacks and a fixed floor would be dead space.
        */
        className={`mt-8 transition-opacity duration-150 ease-out focus:outline-none motion-reduce:transition-none xl:min-h-[573px] ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/*
          ── THE CLAIM LEADS, FULL WIDTH, AND THE FIGURE IS BELOW IT ──────

          This was a 5/7 split: the claim and three points in a narrow left
          column, a card on the right. At canvas width that left the
          headline reading as a caption beside a box.

          The claim is now the panel's own headline across the measure, the
          figure takes the full width under it, and the three points sit as
          a row of three beneath. That is three steps of weight instead of
          two columns competing, and it is also what lets the figure be
          wide enough to read.
        */}
        {/*
          ── AND NOW THE CLAIM AND THE LEAD SIT SIDE BY SIDE ──────────────

          The note above describes the move from a 5/7 split to a stacked
          claim, and that was right about the figure. It was wrong about
          the text: `max-w-[46ch]` over `max-w-[62ch]` left the claim and
          its paragraph in a narrow left column with roughly two thirds of
          a 1,312px canvas empty beside them, which read as an unfinished
          layout rather than as breathing room.

          Found by looking at the render at 1440. The measurement that
          would have caught it — a text block occupying 33% of its
          container — is not one any gate here takes, and I am not adding
          one for a judgment a screenshot answers in a second.

          Claim left, lead right, figure full width beneath. Still three
          steps of weight; the first step just uses the whole measure now.
        */}
        {/*
          ── ONE VIEWPORT, HORIZONTAL ──────────────────────────────────────

          The panel used to stack: claim and lead across the measure, the
          figure full width beneath, then three points in a row. That is
          roughly 1,320px of section, and at 1440x900 it meant the
          selector had scrolled off before the figure was fully visible.
          Measured, not assumed, before this change.

          Now it is two columns at `lg`: the argument on the left in a
          fixed 23rem track, the product on the right taking everything
          else. The three points move under the claim as a stacked list
          rather than a row of three, which is what frees the vertical
          space. Below `lg` it falls back to the stack, where a phone has
          no horizontal room to spend anyway.

          `items-start` so the two columns do not stretch to match, and a
          floor on each so switching seats cannot resize the section.
        */}
        {/*
          `xl`, not `lg`. The figures split into side-by-side panes at
          1024, and if the outer split fired at the same width the panes
          would be ~320px each on a 1280 laptop, which is where a dl row
          of `6.5rem` plus a value stops being readable. Between 1024 and
          1279 the panel stacks and the sticky selector carries the
          switching friction instead.
        */}
        <div className="grid items-start gap-x-14 gap-y-9 xl:grid-cols-[23rem_minmax(0,1fr)]">
        <div data-role-argument className="xl:min-h-[480px]">
          {/* 24px, not the 32px it was. The claim now lives in a 23rem
              track; at 32px every one of the three wrapped to four lines
              and the column read as a pull quote rather than a heading. */}
          <h3 className="text-pretty text-2xl font-semibold leading-[1.2] tracking-[-0.025em] text-white">
            {claim}
          </h3>
          {/*
            `data-section-lead`: this is a section lead, not a bullet.

            `keeps every bullet to a single sentence` finds headed items
            by taking each h3 and reading the first p beside it, and it
            exempts section leads by design — but the leads it was written
            against sit under an h2, so the selector cannot tell this one
            apart. The marker says which rule applies rather than loosening
            the rule.

            It matters here because each role's lead is a less/more
            contrast across two sentences, and collapsing it to one throws
            away the only rhetorical move in the paragraph.
          */}
          <p
            data-section-lead
            className="mt-4 max-w-[62ch] text-[16px] leading-[1.7] text-slate-400"
          >
            {lead}
          </p>

          <dl className="mt-7 space-y-5">
            {points.map(([term, def]) => (
              <div key={term} className="border-t border-amber-300/25 pt-4">
                <dt className="text-[16px] font-semibold leading-snug tracking-tight text-white">
                  {term}
                </dt>
                <dd className="mt-1.5 max-w-[46ch] text-[16px] leading-[1.6] text-slate-400">{def}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/*
          A FIXED FLOOR ON THE FIGURE COLUMN.

          The lifecycle section shipped a bug where picking a different tab
          resized the whole section, because the tallest panel was taller
          than the one whose height the container had been set from. The
          three figures here are two-pane rows of different depths, so the
          floor is the tallest of the three and a test asserts it rather
          than trusting that whoever edits a figure next will re-measure.
        */}
        <div data-role-figure-column className="lg:min-h-[480px] xl:min-h-[480px]">
          <Artifact />
        </div>
        </div>
      </div>

      <p className="sr-only">Showing what Tesseract does for {seat}.</p>
    </div>
  )
}
