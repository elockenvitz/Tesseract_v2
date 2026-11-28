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
 * These are diagrams and drawn representations, never screenshots, and they
 * never name a real security. `ScreenFigures.tsx` carries the longer note on
 * why the placeholder names are eight letters and the gate that enforces it.
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
            What somebody writes
          </span>
          {/* slate-600, not the dark sections' slate-400: this card is
              WHITE. slate-400 on white measures 2.56:1 and this marker is
              the one piece of text on the figure a reader must not miss. */}
          <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-600">
            Illustration
          </span>
        </figcaption>
        <div className="mt-4 rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-900/[0.06]">
          <p data-security-name className="font-mono text-[14px] text-slate-600">
            NORTHWIND
          </p>
          <p className="mt-2 text-[17px] leading-[1.7] text-slate-700">
            New plant slipped a quarter. Still think margin recovery lands, but
            the timing case is weaker. Target down to the low fifties.
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
            What the firm now has
          </span>
          <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-400">
            Illustration
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
          Typed records, created by the writing. Nobody filed anything.
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
          Illustration
        </span>
      </figcaption>

      <p data-security-name className="mt-4 font-mono text-[14px] tracking-tight text-white">
        NORTHWIND
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
        names are the half of its judgement that normally leaves no trace,
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
 * NO ANSWER TEXT IS SHOWN, deliberately. A drawn answer is a fabricated
 * one, and a fabricated analytical answer on a public page is the single
 * easiest way to lose a technical buyer. The figure shows the question and
 * the retrieval, which is the part that is ours.
 */
const ASKS = [
  {
    q: 'What were the strongest arguments against this recommendation?',
    reads: ['Recommendation', 'PM ruling', 'Rejections on this name'],
  },
  {
    q: 'Which names in my coverage need a thesis review?',
    reads: ['Coverage', 'Research notes', 'Open process stages'],
  },
  {
    q: 'What did we believe when we added to this position?',
    reads: ['Decision', 'Reasoning frozen at submission', 'Trade Book entry'],
  },
]

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
            NORTHWIND
          </span>
          <span aria-hidden="true" className="text-slate-700">/</span>
          <span className="truncate text-[14px] text-slate-400">
            Recommendation, awaiting a ruling
          </span>
        </span>
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-400">
          Illustration
        </span>
      </figcaption>

      <div className="grid gap-px bg-white/[0.06] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* ── Left: what gets asked ───────────────────────────────────── */}
        <div className="bg-[#07090e] p-5 sm:p-7">
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-slate-400">
            Questions it can take from here
          </p>
          <ul className="mt-5 space-y-3">
            {ASKS.map(({ q }, i) => (
              <li
                key={q}
                className={`rounded-xl px-4 py-3.5 ring-1 ring-inset ${
                  i === 0
                    ? 'bg-amber-400/[0.08] ring-amber-300/25'
                    : 'bg-white/[0.02] ring-white/[0.07]'
                }`}
              >
                <p
                  className={`text-[16px] leading-[1.55] ${
                    i === 0 ? 'text-white' : 'text-slate-400'
                  }`}
                >
                  {q}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            Each of these needs a relationship between records. A folder of
            documents holds the documents and not the relationship.
          </p>
        </div>

        {/* ── Right: what it goes and reads ───────────────────────────── */}
        <div className="bg-[#07090e] p-5 sm:p-7">
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-amber-300/80">
            What it reads to answer the first one
          </p>
          <ol className="mt-5 space-y-4">
            {ASKS[0].reads.map((r, i) => (
              <li key={r} className="relative pl-6">
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-[0.45rem] size-2 rounded-full bg-amber-300/80 ring-4 ring-amber-300/10"
                />
                {i < ASKS[0].reads.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[0.22rem] top-[1.15rem] h-[calc(100%+0.6rem)] w-px bg-amber-300/25"
                  />
                )}
                <p className="text-[16px] font-semibold tracking-tight text-white">{r}</p>
              </li>
            ))}
          </ol>

          <div className="mt-6 rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.07]">
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-slate-400">
              And the answer carries them
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {['Cited: recommendation', 'Cited: PM rationale', 'Cited: prior rejection'].map(t => (
                <span
                  key={t}
                  className="rounded bg-amber-400/10 px-2 py-0.5 text-[12px] font-medium text-amber-200 ring-1 ring-inset ring-amber-300/25"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-3.5 text-[14px] leading-relaxed text-slate-400">
              So the reasoning can be checked against the record it came from
              rather than taken on trust.
            </p>
          </div>

          {/*
            NO DRAWN ANSWER. See the note on this component: a fabricated
            analytical answer is the fastest way to lose the only reader
            who matters here.
          */}
          <p className="mt-5 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-400">
            The reply is not reproduced here. What the assistant retrieves is
            ours to show; what a model writes on the day is not.
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
           * Was "Your model, your key", which led with BYOK. That is a
           * procurement detail and it was carrying the first panel, where
           * the reader is deciding whether to keep reading. Broadened to
           * the thing a buyer actually wants to hear: you are not locked to
           * one vendor's model. The key is still mentioned, as the
           * mechanism, in the line rather than the heading.
           */
          step: 'The model is a choice',
          line: 'Pick the provider and model the work suits, on your own account and key.',
          Body: () => (
            <div className="space-y-2">
              {[
                { name: 'Anthropic', on: true },
                { name: 'OpenAI', on: false },
                { name: 'Google', on: false },
              ].map(({ name, on }) => (
                <div
                  key={name}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-[14px] ring-1 ring-inset ${
                    on
                      ? 'bg-amber-400/10 text-white ring-amber-300/30'
                      : 'text-slate-400 ring-white/[0.07]'
                  }`}
                >
                  {name}
                  {on && (
                    <span className="text-[12px] uppercase tracking-[0.12em] text-amber-300">
                      In use
                    </span>
                  )}
                </div>
              ))}
            </div>
          ),
        },
        {
          step: 'The context is a setting',
          line: 'Which parts of the record it may read is configured, not assumed.',
          Body: () => (
            <div className="space-y-2">
              {[
                ['Thesis', true],
                ['Outcomes', true],
                ['Notes', true],
                ['Discussions', false],
              ].map(([label, on]) => (
                <div
                  key={String(label)}
                  className="flex items-center gap-2.5 text-[14px] text-slate-300"
                >
                  <span
                    className={`flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 ${
                      on ? 'justify-end bg-amber-400/80' : 'justify-start bg-white/10'
                    }`}
                  >
                    <span className="h-3 w-3 rounded-full bg-white" />
                  </span>
                  {label}
                </div>
              ))}
            </div>
          ),
        },
        {
          /*
           * The panel that answers "so what". Everywhere else, an assistant
           * answer is a message in a thread that is gone by Thursday. Here
           * it lands ON the objects it concerns, which makes it findable
           * from the name rather than from remembering you once asked.
           */
          step: 'The answer stays findable',
          line: 'It attaches to the name, the idea and the note it drew on.',
          Body: () => (
            <div className="rounded-lg bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.07]">
              <p className="text-[14px] leading-relaxed text-slate-300">
                Where did the margin case first weaken?
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
