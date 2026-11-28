/**
 * The visual devices for the page's explanatory sections.
 *
 * ── Why these exist ──────────────────────────────────────────────────────
 *
 * Six consecutive sections were a heading over a list of headed text items.
 * The writing was fine, which was the trap: a reader could not tell the
 * sections apart, so good sentences blurred into one surface. Each device
 * below is deliberately a DIFFERENT shape from its neighbours, so the page
 * changes gear as you scroll rather than restating itself in one register.
 *
 * ── The constraint every one of them is held to ──────────────────────────
 *
 * These are diagrams and drawn representations, never screenshots. They name
 * real, widely held securities, and `ScreenFigures.tsx` carries the longer
 * note on why that changed, what replaced the old safety property, and the
 * gate that enforces it. The short version: no price, no return, no
 * checkable claim about the company, and an illustrative marker on every
 * caption.
 *
 * ── `CostOfForgetting` AND ITS THREE SVGs WERE DELETED, 2026-11-27 ───────
 *
 * They drew the problem section: a ring of five tools around a dashed hole
 * ("nothing holds the why"), a chain with its middle links missing, and two
 * paths arriving at the same outcome ("returns cannot separate these").
 *
 * I built them and the review was right to cut them. Two were abstract
 * allegories that a sentence says better, and the standing rule here is
 * that a diagram must show what prose cannot. The third, luck reading as
 * skill, was the sharp one, and it did not die: it is now ARGUED ON A
 * NAMED DECISION in `ReassessFigure`, with the original case beside what
 * changed, which is the same point with evidence instead of a metaphor.
 *
 * Deleted rather than left unused, because an unread export is how a page
 * ends up with two sources of truth for its own argument, and because the
 * type ceiling flags it the moment nothing renders it. Git has the
 * drawings if they are ever wanted.
 */
import type { ReactNode } from 'react'
import { FLAGSHIP, ILLUSTRATIVE } from './ScreenFigures'

/* ─────────────────────── 1. Capture costs you nothing ───────────────────── */

/**
 * The answer to "so this is more admin for my analysts".
 *
 * The section's own headline already promises that the intelligence is
 * captured in the course of the work, and then lists capture surfaces,
 * which reads as more things to keep up to date. The fear is reasonable and
 * a list cannot answer it. This shows the trade directly: what an analyst
 * types on the left, what the firm gets on the right, with nothing in
 * between for them to do.
 */
export function CaptureTrade() {
  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[1fr_auto_1fr]">
      <figure
        data-illustration="true"
        className="rounded-2xl bg-white p-5 ring-1 ring-inset ring-slate-900/10 sm:p-6"
      >
        <figcaption className="flex items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold tracking-tight text-slate-900">
            Research in the moment
          </span>
          {/* slate-600, not the dark sections' slate-400: this card is
              WHITE. slate-400 on white measures 2.56:1 and this marker is
              the one piece of text on the figure a reader must not miss. */}
          <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-600">
            {ILLUSTRATIVE}
          </span>
        </figcaption>
        <div className="mt-4 rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-900/[0.06]">
          <p data-security-name className="font-mono text-[14px] text-slate-600">
            {FLAGSHIP.ticker}
          </p>
          <p className="mt-2 text-[17px] leading-[1.7] text-slate-700">
            Monetization is a quarter behind the note. The direction holds, the
            timing is weaker, and the sizing assumed the faster path.
          </p>
        </div>
        <p className="mt-4 text-[14px] leading-relaxed text-slate-600">
          A note somebody was going to write regardless.
        </p>
      </figure>

      {/* The arrow, and the claim it is making. */}
      <div className="flex items-center justify-center lg:flex-col lg:gap-3">
        <span aria-hidden="true" className="text-[18px] text-slate-600 lg:rotate-90">
          &#8594;
        </span>
        <span className="ml-3 text-[12px] uppercase tracking-[0.14em] text-slate-600 lg:ml-0 lg:[writing-mode:vertical-rl]">
          No filing step
        </span>
      </div>

      {/*
        A TRUE dark card, `bg-slate-900`, not the translucent `bg-white/[0.025]`
        the dark sections use.

        The first draft reused the dark-section surface here and the whole
        card rendered invisible: white text on `rgba(255,255,255,0.025)` over
        the light band's #f7f8fa is white on white. Caught by looking at the
        render, not by any test, because every assertion about this section
        passed while half of it could not be seen.

        An opaque dark card is also the right call on the merits: it is the
        product, sitting against the analyst's own white note, so the
        contrast carries the meaning rather than just fixing the bug.
      */}
      <figure
        data-illustration="true"
        className="rounded-2xl bg-slate-900 p-5 ring-1 ring-inset ring-slate-900/10 sm:p-6"
      >
        <figcaption className="flex items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold tracking-tight text-white">
            Connected investment history
          </span>
          <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-400">
            {ILLUSTRATIVE}
          </span>
        </figcaption>
        <ul className="mt-4 space-y-2.5">
          {[
            ['Research note', 'versioned, on the name'],
            ['Price target', 'with the old one kept'],
            ['Thesis update', 'linked to the open idea'],
          ].map(([what, how]) => (
            <li
              key={what}
              className="flex items-baseline justify-between gap-3 rounded-lg bg-white/[0.06] px-3 py-2.5 ring-1 ring-inset ring-white/10"
            >
              <span className="text-[16px] text-white">{what}</span>
              <span className="text-[14px] text-slate-400">{how}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[14px] leading-relaxed text-slate-400">
          Created by the writing. Nobody filed anything.
        </p>
      </figure>
    </div>
  )
}

/* ───────────────────── 2. Intelligence that accumulates ─────────────────── */

/**
 * Institutional intelligence as a thing that GROWS, which a three-item grid
 * cannot show. The device is a ledger with a year on it, because the
 * argument is entirely about elapsed time: none of this is worth anything
 * in month one and it is the firm's most valuable asset in year three.
 */
export function MemoryLedger() {
  const rows = [
    { when: 'Mar', what: 'Declined on valuation', kind: 'Rejection' },
    { when: 'Jul', what: 'Thesis revisited after the miss', kind: 'Review' },
    { when: 'Nov', what: 'Bought, smaller than first proposed', kind: 'Decision' },
  ]
  return (
    <figure
      data-illustration="true"
      className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-inset ring-white/[0.1] sm:p-7"
    >
      <figcaption className="flex items-baseline justify-between gap-3">
        {/* Said "One name, one year" while the figure draws three of them. */}
        <span className="text-[16px] font-semibold tracking-tight text-white">
          One name, three years
        </span>
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-400">
          {ILLUSTRATIVE}
        </span>
      </figcaption>

      <p data-security-name className="mt-4 font-mono text-[14px] tracking-tight text-white">
        {FLAGSHIP.ticker}
      </p>

      {/*
        ── A ledger that gets DENSER, not a three-item timeline ───────────

        The first version was three dots down a line, which is a timeline:
        it says these things happened in this order and nothing about
        accumulation. The whole argument of this section is that the asset
        compounds, so the drawing has to show quantity changing.

        Each year is a row of marks. The faint ones are the firm's other
        activity on the name, the solid gold ones are what this section is
        selling, and year three has visibly more of both than year one. The
        three labelled entries hang off the last row, so the detail and the
        accumulation are the same picture rather than two.
      */}
      <div className="mt-5 space-y-3">
        {[
          { year: 'Year one', marks: 4, gold: 1 },
          { year: 'Year two', marks: 9, gold: 3 },
          { year: 'Year three', marks: 16, gold: 6 },
        ].map(({ year, marks, gold }) => (
          <div key={year} className="flex items-center gap-3">
            {/* w-16 wrapped "Year three" onto two lines and threw the row off its marks. */}
            <span className="w-20 shrink-0 text-[12px] uppercase tracking-[0.1em] text-slate-400">
              {year}
            </span>
            <span className="flex flex-wrap gap-1">
              {Array.from({ length: marks }, (_, i) => (
                <span
                  key={i}
                  className={`h-3 w-3 rounded-[2px] ${
                    i < gold ? 'bg-amber-400/90' : 'bg-white/[0.09]'
                  }`}
                />
              ))}
            </span>
          </div>
        ))}
      </div>

      <ol className="mt-6 space-y-2.5 border-t border-white/[0.07] pt-5">
        {rows.map(({ when, what, kind }) => (
          <li key={when} className="flex items-baseline gap-3">
            <span className="w-7 shrink-0 font-mono text-[12px] text-slate-400">{when}</span>
            <span className="min-w-0 flex-1 text-[16px] leading-snug text-slate-200">{what}</span>
            <span className="shrink-0 text-[12px] uppercase tracking-[0.12em] text-amber-300/80">
              {kind}
            </span>
          </li>
        ))}
      </ol>

      {/*
        The rejection is listed FIRST and labelled, because a firm's declined
        names are the half of its judgment that normally leaves no trace,
        and that is the part this section is actually selling.
      */}
      <p className="mt-5 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
        The rejection is a record too, which is why the firm can study what it
        declined and not only what it owns.
      </p>
    </figure>
  )
}

/* ──────────────────────────── 3. ACT AI, the canvas ─────────────────────── */

/**
 * THE FLAGSHIP ACT AI DEMONSTRATION.
 *
 * ── Why the section needed this ─────────────────────────────────────────
 *
 * ACT AI was sold on its PROPERTIES: which model it runs, what it is
 * allowed to read, where the answer is filed. Those are the three panels of
 * `AssistantFlow` below and they are all true and all deployed. None of
 * them demonstrates the only claim worth making to this audience, which is
 * that the thing understands an investment process. A question strip got
 * closer and was still a list of sentences in boxes.
 *
 * This shows the mechanism: where the assistant is standing, what it was
 * asked, WHICH RECORDS IT WENT AND READ, and that the answer carries them
 * back as citations. The argument against a general chatbot is not argued,
 * it is visible — a model with your documents in a folder cannot produce
 * the middle column.
 *
 * ── EVERY RECORD NAMED HERE IS READ BY A DEPLOYED TOOL ──────────────────
 *
 * This is the constraint that shaped the content, and it cut two of the
 * questions the brief proposed. The deployed `ai-chat` function exposes
 * twelve retrieval tools: get_asset, search_assets, get_portfolio,
 * get_theme, search_team_notes, get_decisions, get_workflows,
 * get_watchlists, get_coverage, get_idea_pipeline, get_pending_decisions
 * and get_outstanding_work.
 *
 * NO TOOL READS `note_versions` OR `asset_field_history`. So:
 *
 *   NOT ON THE PAGE  "What has changed in our thesis since we initiated?"
 *                    and "Where has conviction changed across my
 *                    coverage?" Both need version history retrieval, which
 *                    is not wired to the assistant. The tables exist
 *                    (1,066 and 131 rows in production) and the product
 *                    shows the history in its own UI; the ASSISTANT cannot
 *                    read it, and a demo would expose that in one question.
 *
 *   ON THE PAGE      the three below, each mapped to a named tool. The
 *                    arguments against a recommendation come from
 *                    get_decisions, which returns the PM's ruling on each
 *                    request with the context it was submitted with.
 *                    Coverage staleness comes from get_coverage plus
 *                    get_outstanding_work. What was believed at the time
 *                    comes from get_decisions, because the submission
 *                    context is frozen on the request.
 *
 * ── THE ANSWER IS DRAWN NOW, AND HERE IS WHY THAT IS SAFE ───────────────
 *
 * This figure used to show the question and the retrieval and stop there,
 * on the argument that a drawn answer is a fabricated one. The page owner
 * overruled it, correctly: a visitor who never sees an answer cannot tell
 * why an assistant standing inside the firm's record beats a chat window,
 * and the retrieval chain alone reads as plumbing.
 *
 * The risk was never "an answer appears". It was "an answer makes a
 * checkable claim about a real company, or implies a capability the
 * product does not have". So the drawn answer is built to do neither:
 *
 *   - it states no price, no number and nothing about Microsoft that
 *     anybody could check against a filing. Every line is about the
 *     FIRM'S OWN case, which is illustrative by construction
 *   - it is reachable with the tools that are actually deployed. The
 *     comparison is between the reasoning frozen on the decision
 *     (`get_decisions`) and the thesis as it stands today (`get_asset`),
 *     with the open research from `get_outstanding_work`. It is NOT a
 *     version-history diff, because no deployed tool reads
 *     `note_versions` or `asset_field_history`, and a figure implying one
 *     would fail in the first demo
 *   - the caption carries the illustrative marker like every other figure,
 *     and the closing line says the wording on the day is the model's
 *     while the record it reads is the firm's
 */
const PRIMARY_ASK = 'What has changed in our thesis since we added to MSFT?'

/* The shape the answer takes, which is the product's shape rather than a
   paragraph: what survived, what moved, what to look at again, what nobody
   has done yet. */
const ANSWER: [string, string][] = [
  ['Still holds', 'The capex-to-margin case, and both catalysts the note named.'],
  ['Changed', 'Monetization was argued to follow within two quarters. The current thesis has it a quarter later.'],
  ['Reassess', 'The base case runs on the earlier schedule, and the position was sized to it.'],
  ['Not yet researched', 'Whether supply, rather than demand, is now the binding constraint.'],
]

const CITED = ['Decision, reasoning frozen at submission', 'Thesis, version 4', 'Open research process']

/*
 * The follow-up questions used to be listed here AND again in
 * `AssistantFlow` below. Two lists of example questions eleven inches
 * apart is the page arguing with itself, so the canvas now carries the one
 * question it answers and the flow carries the rest.
 */

export function AssistantCanvas() {
  return (
    <figure
      data-illustration="true"
      data-assistant-canvas
      className="relative overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.1]"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      {/*
        The context strip. This is the whole difference between ACT AI and a
        chat window: the assistant is standing somewhere, and where it is
        standing is a typed object rather than a conversation title.
      */}
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-white/[0.07] px-5 py-3.5 sm:px-7">
        <span className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-amber-300/80" />
          <span className="text-[14px] font-medium text-slate-300">ACT AI</span>
          <span aria-hidden="true" className="text-slate-700">/</span>
          <span data-security-name className="truncate font-mono text-[14px] text-white">
            {FLAGSHIP.ticker}
          </span>
          <span aria-hidden="true" className="text-slate-700">/</span>
          <span className="truncate text-[14px] text-slate-400">
            Position held in {FLAGSHIP.book}
          </span>
        </span>
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-400">
          {ILLUSTRATIVE}
        </span>
      </figcaption>

      <div className="grid gap-px bg-white/[0.06] lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* ── Left: the question, and the answer to it ────────────────── */}
        <div className="bg-[#07090e] p-5 sm:p-7">
          <div className="rounded-xl bg-amber-400/[0.08] px-4 py-3.5 ring-1 ring-inset ring-amber-300/25">
            <p className="text-[17px] leading-[1.55] text-white">{PRIMARY_ASK}</p>
          </div>

          {/* The answer, in the four parts a PM actually wants separated.
              Labelled rather than written as prose, because the shape is
              half the argument: a generic assistant returns a paragraph,
              this one returns a position on each part of the case. */}
          <dl className="mt-5 space-y-4">
            {ANSWER.map(([label, body]) => (
              <div key={label} className="grid gap-x-4 gap-y-1 sm:grid-cols-[9.5rem_1fr]">
                <dt className="text-[12px] font-medium uppercase tracking-[0.1em] text-amber-300/80">
                  {label}
                </dt>
                <dd className="text-[16px] leading-[1.65] text-slate-300">{body}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-6 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            Every line traces to the record it came from.
          </p>
        </div>

        {/* ── Right: where the answer came from, and what else it takes ─ */}
        <div className="bg-[#07090e] p-5 sm:p-7">
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-slate-400">
            Where it looked
          </p>
          <ol className="mt-5 space-y-4">
            {CITED.map((r, i) => (
              <li key={r} className="relative pl-6">
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-[0.45rem] size-2 rounded-full bg-amber-300/80 ring-4 ring-amber-300/10"
                />
                {i < CITED.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[0.22rem] top-[1.15rem] h-[calc(100%+0.6rem)] w-px bg-amber-300/25"
                  />
                )}
                <p className="text-[16px] font-semibold tracking-tight text-white">{r}</p>
              </li>
            ))}
          </ol>

          <p className="mt-6 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            The wording on the day is the model&rsquo;s. What it reads is the
            firm&rsquo;s own record.
          </p>
        </div>
      </div>
    </figure>
  )
}

/* ─────────────────── 4. The assistant's supporting controls ─────────────── */

/**
 * ── Every claim here was checked against PRODUCTION, not against the repo
 *
 * `organization_ai_config` carries `byok_provider`, `byok_model`,
 * `byok_enabled` and `byok_secret_id`, so bringing your own model and key is
 * real and deployed. `user_ai_config` carries `include_thesis`,
 * `include_outcomes`, `include_notes`, `include_discussions` and
 * `include_price_history`, so choosing what the assistant may read is real.
 * `ai_conversation_tags` is `(conversation_id, tag_type, tag_id)`, so an
 * answer really is tagged to the typed objects it concerns and really does
 * persist.
 *
 * DELIBERATELY ABSENT: artifacts. `ai_artifacts` DOES NOT EXIST in the
 * production database. The migration is written and unapplied, the client
 * code has an explicit "table is not there" branch, and advertising it would
 * be a cheque the demo cannot cash. It belongs here the week the table
 * lands, and not before.
 *
 * ── DEMOTED TO A SUPPORTING ROW, 2026-11-27 ─────────────────────────────
 *
 * This used to BE the ACT AI section. Three equal cards about the model
 * picker, the read-scope switches and conversation tagging, carrying the
 * whole case for the assistant. They are procurement answers, and leading
 * with them undersold the opportunity badly — the review said so and it is
 * right. `AssistantCanvas` above is now the demonstration and these are
 * the controls underneath it, drawn smaller and introduced as such.
 */
export function AssistantFlow() {
  return (
    <ol className="grid gap-x-10 gap-y-9 sm:grid-cols-3">
      {[
        {
          /*
           * ── THE PROVIDER PANEL IS DELETED, 2026-11-28 ──────────────────
           *
           * It read "The model is a choice. Pick the provider and model the
           * work suits, on your own account and key", over a list of three
           * vendors. Two things were wrong with it and the page owner named
           * both: a provider account is a procurement answer rather than a
           * reason to want the product, and anchoring the public pitch to
           * the current bring-your-own-key implementation means rewriting
           * this section the day that changes.
           *
           * The capability is unchanged and undisclosed nowhere it matters:
           * it stays in onboarding, in the product's own settings, and in
           * the trust section as firm-level control over the AI context. It
           * is simply not a selling point any more.
           *
           * ── AND THE THREE PANELS ARE NOW THE THREE DIMENSIONS ──────────
           *
           * The canvas above answers one question about a position that
           * already exists, which left the whole section reading as a
           * recall tool: ask it what you decided, and it will tell you.
           * That is the smallest part of what it does and the least
           * interesting reason to buy it.
           *
           * So the row underneath is research and analysis, investment
           * judgment, and institutional intelligence. The first two are
           * deliberately PROSPECTIVE, because the question a reader needs
           * answered is whether this is useful before a decision as well
           * as after one.
           *
           * Every question listed is answerable by a retrieval tool the
           * deployed assistant actually has: coverage, open process
           * stages, team notes, theses, decisions, the idea pipeline and
           * outstanding work. Nothing here needs a tool that does not
           * exist.
           */
          step: 'Research and analysis',
          line: 'Investment questions, answered against the firm’s own work.',
          Body: () => (
            <ul className="space-y-2">
              {[
                'What does our research already say about this name?',
                'Which of our theses does this news touch?',
              ].map(q => (
                <li
                  key={q}
                  className="rounded-lg bg-white/[0.02] px-3 py-2 text-[14px] leading-[1.5] text-slate-300 ring-1 ring-inset ring-white/[0.07]"
                >
                  {q}
                </li>
              ))}
            </ul>
          ),
        },
        {
          step: 'Investment judgment',
          line: 'It examines the assumptions, tests the conviction and names the gaps.',
          Body: () => (
            <ul className="space-y-2">
              {[
                'Which assumption is doing the most work here?',
                'What did we say would make us wrong?',
              ].map(q => (
                <li
                  key={q}
                  className="rounded-lg bg-white/[0.02] px-3 py-2 text-[14px] leading-[1.5] text-slate-300 ring-1 ring-inset ring-white/[0.07]"
                >
                  {q}
                </li>
              ))}
            </ul>
          ),
        },
        {
          /*
           * The panel that answers "so what". Everywhere else, an assistant
           * answer is a message in a thread that is gone by Thursday. Here
           * it lands ON the objects it concerns, which makes it findable
           * from the name rather than from remembering you once asked.
           */
          step: 'Institutional intelligence',
          line: 'Earlier research and decisions inform the question, and the answer attaches to them.',
          Body: () => (
            <div className="rounded-lg bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.07]">
              <p className="text-[14px] leading-relaxed text-slate-300">
                Has anyone here looked at this before?
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.07] pt-3">
                {['Asset', 'Idea', 'Research note'].map(t => (
                  <span
                    key={t}
                    className="rounded bg-amber-400/10 px-2 py-0.5 text-[12px] font-medium text-amber-200 ring-1 ring-inset ring-amber-300/25"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ),
        },
      ].map(({ step, line, Body }, i) => (
        /* `flex-col` + `mt-auto` below, so the three figures share a
           baseline however many lines each description runs to. */
        <li key={step} data-assistant-step={step} className="flex flex-col">
          {/*
            NO NUMERALS, and a gate caught the first draft using them.
            `numbers only the list that has an order` holds the whole page to
            one numbered run, the lifecycle, because a numeral asserts a
            sequence. These three are things that are true at once about how
            the assistant runs, not steps to work through, so the marker is
            a rule rather than a number.
          */}
          <div className="flex items-baseline gap-3">
            <span
              aria-hidden="true"
              className={`h-px w-6 shrink-0 ${i === 0 ? 'bg-amber-400' : 'bg-white/20'}`}
            />
            <h3 className="text-[17px] font-semibold tracking-tight text-white">{step}</h3>
          </div>
          <p className="mt-2 max-w-[40ch] text-[16px] leading-[1.7] text-slate-400">{line}</p>
          <div className="mt-auto pt-5">
            <div className="rounded-xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/[0.06]">
              <Body />
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

/* Shared by nothing yet, exported so a section can frame a figure caption. */
export function VisualNote({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[14px] leading-relaxed text-slate-400">{children}</p>
}
