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
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FLAGSHIP, ILLUSTRATIVE } from './ScreenFigures'

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
      <div className="grid gap-px bg-white/[0.06] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
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
            Maturity, not status. Whether a name was recommended or ruled on is
            a separate record.
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

          <dl className="mt-4 space-y-3.5">
            {[
              ['The claim', FLAGSHIP.thesis],
              ['Conviction', 'High, raised from Medium after the channel work'],
              ['Catalysts', 'Copilot seat disclosure, then the next capex guide'],
              ['Key risks', 'Capex outrunning monetization, or supply limiting the build'],
              ['Valuation', 'Base, bull and bear, each on its own Azure growth path'],
              ['Portfolio', `${FLAGSHIP.book}, held, below the target weight`],
            ].map(([term, def]) => (
              <div key={term} className="grid grid-cols-[6.5rem_1fr] gap-x-4">
                <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">
                  {term}
                </dt>
                <dd className="text-[14px] leading-relaxed text-slate-300">{def}</dd>
              </div>
            ))}
          </dl>

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
            <span className="text-[14px] text-slate-400">
              Each one is recorded with its reasoning.
            </span>
          </div>
        </Pane>
      </div>
    </Figure>
  )
}

/* ── INVESTMENT LEADERSHIP: a ledger, and how the desk decides ─────────── */

const LEDGER = [
  { year: 'Year one', marks: 3, note: 'Initiated, then added to twice' },
  { year: 'Year two', marks: 5, note: 'Thesis revised, one risk realised' },
  { year: 'Year three', marks: 7, note: 'Exited, and the review says why' },
]

/* Process visibility, drawn as the firm's own throughput rather than as a
   score on a person. See the note in `ROLES` on why that distinction is
   load-bearing here. */
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
          <Col>Activity on one name</Col>
          <ul className="mt-4 space-y-4">
            {LEDGER.map(({ year, marks, note }) => (
              <li key={year} className="grid grid-cols-[5.5rem_1fr] items-start gap-x-4">
                <Col>{year}</Col>
                <div>
                  <span aria-hidden="true" className="flex flex-wrap gap-1.5">
                    {Array.from({ length: marks }, (_, i) => (
                      <span key={i} className="h-5 w-2.5 rounded-sm bg-amber-300/45" />
                    ))}
                  </span>
                  <p className="mt-2 text-[14px] leading-relaxed text-slate-400">{note}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            The analyst who opened this name no longer works here. The reasoning
            did not leave with them.
          </p>
        </Pane>

        <Pane>
          <Col>How the firm decides, visible</Col>
          <dl className="mt-4 space-y-4">
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
            A view of the process, not a score on a person. What is visible is
            how decisions were reached.
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
    claim: 'More time for investment thinking.',
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
    claim: 'Greater clarity. Stronger investment judgement.',
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
      'An institutional foundation for research, judgement and experience that outlasts any individual investor. More effective teams, and continuity through the changes a firm goes through.',
    Artifact: CioLedger,
    points: [
      ['Knowledge survives a departure', 'A leaver costs the firm a person rather than a decade of context.'],
      ['The process becomes legible', 'How the firm actually decides, rather than how it describes deciding.'],
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
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const { seat, claim, lead, Artifact, points } = ROLES[active]

  function move(to: number) {
    const next = (to + ROLES.length) % ROLES.length
    setActive(next)
    tabs.current[next]?.focus()
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
      <div
        role="tablist"
        aria-label="Who Tesseract is for"
        onKeyDown={onKeyDown}
        className="grid gap-2 sm:grid-cols-3"
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
              onClick={() => setActive(i)}
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
              className={`group rounded-lg px-4 pb-4 pt-3.5 text-left ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710] ${
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
                className={`mt-3.5 block text-[20px] font-semibold tracking-tight transition-colors ${
                  on ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              >
                {s}
              </span>
            </button>
          )
        })}
      </div>

      <div
        id="role-panel"
        role="tabpanel"
        aria-labelledby={`role-tab-${active}`}
        tabIndex={-1}
        className="mt-12 focus:outline-none"
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
          one for a judgement a screenshot answers in a second.

          Claim left, lead right, figure full width beneath. Still three
          steps of weight; the first step just uses the whole measure now.
        */}
        <div className="grid gap-x-16 gap-y-5 lg:grid-cols-12">
          <h3 className="text-pretty text-2xl font-semibold leading-[1.15] tracking-[-0.025em] text-white sm:text-[2rem] lg:col-span-6">
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
            className="max-w-[62ch] text-[17px] leading-[1.75] text-slate-400 lg:col-span-6 lg:col-start-7 lg:pt-1.5"
          >
            {lead}
          </p>
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
        <div data-role-figure-column className="mt-10 lg:min-h-[480px]">
          <Artifact />
        </div>

        <dl className="mt-12 grid gap-x-12 gap-y-9 sm:grid-cols-3">
          {points.map(([term, def]) => (
            <div key={term} className="border-t border-amber-300/25 pt-5">
              <dt className="text-[17px] font-semibold leading-snug tracking-tight text-white">
                {term}
              </dt>
              <dd className="mt-2 max-w-[44ch] text-[16px] leading-[1.7] text-slate-400">{def}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="sr-only">Showing what Tesseract does for {seat}.</p>
    </div>
  )
}
