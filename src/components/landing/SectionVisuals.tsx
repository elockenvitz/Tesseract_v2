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
 */
import type { ReactNode } from 'react'

/* ─────────────────────────────────────────────── 1. The cost of forgetting */

/**
 * Three named costs, each with its own small diagram.
 *
 * The section previously listed four ways reasoning goes missing, as four
 * sentences. Four descriptions of one problem read as one problem described
 * at length. These are three DISTINCT costs, each shown rather than stated,
 * and the third is the one that matters commercially: a firm that cannot
 * tell a correct call from a lucky one cannot compound its judgement.
 */
const COSTS = [
  {
    key: 'organization',
    title: 'Poor organization',
    line: 'The case for a position is spread across tools that do not know about each other.',
    Visual: ScatterVisual,
  },
  {
    key: 'memory',
    title: 'No memory',
    line: 'The analyst leaves and the reasoning leaves with them, because it was never a record.',
    Visual: BrokenChainVisual,
  },
  {
    key: 'alpha',
    title: 'Lost alpha',
    line: 'A call that worked for the wrong reason looks identical to one that worked.',
    Visual: LuckVisual,
  },
]

function ScatterVisual() {
  /* Deliberately unaligned: the point is that none of these sit together. */
  const places = [
    { label: 'Slack thread', x: 'left-0 top-2' },
    { label: 'Inbox', x: 'right-2 top-0' },
    { label: 'Deck v7', x: 'left-8 top-16' },
    { label: 'Shared drive', x: 'right-0 top-20' },
    { label: 'Someone&rsquo;s head', x: 'left-0 top-32' },
  ]
  return (
    <div className="relative h-44" aria-hidden="true">
      {places.map(({ label, x }) => (
        <span
          key={label}
          className={`absolute ${x} rounded-md bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400 ring-1 ring-inset ring-white/[0.08]`}
          dangerouslySetInnerHTML={{ __html: label }}
        />
      ))}
    </div>
  )
}

function BrokenChainVisual() {
  return (
    <div className="relative h-44 pt-3" aria-hidden="true">
      <ol className="space-y-3">
        {[
          { label: 'Thesis', gone: false },
          { label: 'Why it was sized that way', gone: true },
          { label: 'What the PM pushed back on', gone: true },
          { label: 'The position', gone: false },
        ].map(({ label, gone }) => (
          <li key={label} className="flex items-center gap-3">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                gone ? 'bg-transparent ring-1 ring-dashed ring-white/25' : 'bg-primary-400'
              }`}
            />
            <span
              className={`text-[11px] ${
                gone ? 'text-slate-600 line-through decoration-slate-700' : 'text-slate-300'
              }`}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[10px] uppercase tracking-[0.14em] text-slate-600">
        Two links gone. The position remains.
      </p>
    </div>
  )
}

function LuckVisual() {
  return (
    <div className="h-44 pt-3" aria-hidden="true">
      <div className="space-y-2.5">
        {[
          { claim: 'Margin recovery', result: 'Worked', truth: 'For that reason', good: true },
          { claim: 'Margin recovery', result: 'Worked', truth: 'For another reason', good: false },
        ].map(({ claim, result, truth, good }) => (
          <div
            key={truth}
            className="rounded-lg bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.07]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">{claim}</span>
              <span className="text-[11px] font-medium text-slate-200">{result}</span>
            </div>
            <p
              className={`mt-1.5 text-[10px] uppercase tracking-[0.12em] ${
                good ? 'text-primary-300' : 'text-slate-600'
              }`}
            >
              {truth}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-[0.14em] text-slate-600">
        Indistinguishable on returns alone.
      </p>
    </div>
  )
}

export function CostOfForgetting() {
  return (
    <ul className="grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {COSTS.map(({ key, title, line, Visual }) => (
        <li key={key} data-cost={key}>
          <h3 className="text-[15px] font-semibold tracking-tight text-white">{title}</h3>
          <p className="mt-2 max-w-[38ch] text-[13px] leading-[1.75] text-slate-400">{line}</p>
          <div className="mt-6 rounded-xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/[0.06]">
            <Visual />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ──────────────────────────────────────────── 2. Capture costs you nothing */

/**
 * The answer to "so this is more admin for my analysts".
 *
 * The section's own headline already said the record assembles itself out of
 * work an analyst was going to do anyway, and then listed six capture
 * surfaces, which reads as six more things to keep up to date. The fear is
 * reasonable and a list cannot answer it. This shows the trade directly:
 * what an analyst types on the left, what the firm gets on the right, with
 * nothing in between for them to do.
 */
export function CaptureTrade() {
  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[1fr_auto_1fr]">
      <figure
        data-illustration="true"
        className="rounded-2xl bg-white p-5 ring-1 ring-inset ring-slate-900/10"
      >
        <figcaption className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold tracking-tight text-slate-900">
            What the analyst types
          </span>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
            Illustration
          </span>
        </figcaption>
        <div className="mt-4 rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-900/[0.06]">
          <p data-security-name className="font-mono text-[11px] text-slate-500">
            NORTHWIND
          </p>
          <p className="mt-2 text-[13px] leading-[1.7] text-slate-700">
            New plant slipped a quarter. Still think margin recovery lands, but
            the timing case is weaker. Target down to the low fifties.
          </p>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          A note they were going to write regardless.
        </p>
      </figure>

      {/* The arrow, and the claim it is making. */}
      <div className="flex items-center justify-center lg:flex-col lg:gap-3">
        <span aria-hidden="true" className="text-[18px] text-slate-600 lg:rotate-90">
          &#8594;
        </span>
        <span className="ml-3 text-[10px] uppercase tracking-[0.14em] text-slate-600 lg:ml-0 lg:[writing-mode:vertical-rl]">
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
        className="rounded-2xl bg-slate-900 p-5 ring-1 ring-inset ring-slate-900/10"
      >
        <figcaption className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold tracking-tight text-white">
            What the firm now has
          </span>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
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
              <span className="text-[12px] text-white">{what}</span>
              <span className="text-[11px] text-slate-400">{how}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          Typed records, created by the writing. Nobody filed anything.
        </p>
      </figure>
    </div>
  )
}

/* ─────────────────────────────────────────────── 3. Memory that accumulates */

/**
 * Institutional memory as a thing that GROWS, which a three-item grid
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
      className="rounded-2xl bg-white/[0.025] p-5 ring-1 ring-inset ring-white/[0.08] sm:p-6"
    >
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold tracking-tight text-white">
          One name, one year
        </span>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
          Illustration
        </span>
      </figcaption>

      <p data-security-name className="mt-4 font-mono text-[12px] tracking-tight text-white">
        NORTHWIND
      </p>

      <ol className="relative mt-4">
        <div
          aria-hidden="true"
          className="absolute bottom-4 left-[29px] top-4 w-px bg-gradient-to-b from-primary-400/10 via-primary-400/30 to-primary-400/60"
        />
        {rows.map(({ when, what, kind }) => (
          <li key={when} className="relative flex items-start gap-4 py-2.5">
            <span className="w-7 shrink-0 text-right font-mono text-[11px] text-slate-500">
              {when}
            </span>
            <span className="relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-400 ring-2 ring-[#050710]" />
            <span className="min-w-0">
              <span className="block text-[12px] text-white">{what}</span>
              <span className="mt-0.5 block text-[10px] uppercase tracking-[0.12em] text-slate-500">
                {kind}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {/*
        The rejection is listed FIRST and labelled, because a firm's declined
        names are the half of its judgement that normally leaves no trace,
        and that is the part this section is actually selling.
      */}
      <p className="mt-4 border-t border-white/[0.07] pt-4 text-[11px] leading-relaxed text-slate-500">
        The rejection is a record too, which is why the firm can study what it
        declined and not only what it owns.
      </p>
    </figure>
  )
}

/* ───────────────────────────────────────────────────────── 4. The assistant */

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
 */
export function AssistantFlow() {
  return (
    <ol className="grid gap-x-10 gap-y-10 lg:grid-cols-3">
      {[
        {
          step: 'Your model, your key',
          line: 'Point it at the provider and model your firm already pays for.',
          Body: () => (
            <div className="space-y-2">
              {[
                { name: 'Anthropic', on: true },
                { name: 'OpenAI', on: false },
                { name: 'Google', on: false },
              ].map(({ name, on }) => (
                <div
                  key={name}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-[12px] ring-1 ring-inset ${
                    on
                      ? 'bg-white/[0.06] text-white ring-white/20'
                      : 'text-slate-500 ring-white/[0.07]'
                  }`}
                >
                  {name}
                  {on && <span className="text-[10px] uppercase tracking-[0.12em]">In use</span>}
                </div>
              ))}
            </div>
          ),
        },
        {
          step: 'You choose what it reads',
          line: 'The record is yours, so which parts it may see is a setting, not a guess.',
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
                  className="flex items-center gap-2.5 text-[12px] text-slate-300"
                >
                  <span
                    className={`flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 ${
                      on ? 'justify-end bg-primary-500/70' : 'justify-start bg-white/10'
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
          step: 'The answer stays, and it is tagged',
          line: 'It is attached to the objects it is about, so it is there next quarter.',
          Body: () => (
            <div className="rounded-lg bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.07]">
              <p className="text-[12px] leading-relaxed text-slate-300">
                Where did the margin case first weaken?
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.07] pt-3">
                {['Asset', 'Idea', 'Research note'].map(t => (
                  <span
                    key={t}
                    className="rounded bg-primary-500/10 px-2 py-0.5 text-[10px] font-medium text-primary-200 ring-1 ring-inset ring-primary-400/25"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ),
        },
      ].map(({ step, line, Body }, i) => (
        <li key={step} data-assistant-step={step}>
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
              className={`h-px w-6 shrink-0 ${i === 0 ? 'bg-primary-400' : 'bg-white/20'}`}
            />
            <h3 className="text-[15px] font-semibold tracking-tight text-white">{step}</h3>
          </div>
          <p className="mt-2 max-w-[40ch] text-[13px] leading-[1.75] text-slate-400">{line}</p>
          <div className="mt-5 rounded-xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/[0.06]">
            <Body />
          </div>
        </li>
      ))}
    </ol>
  )
}

/* Shared by nothing yet, exported so a section can frame a figure caption. */
export function VisualNote({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[11px] leading-relaxed text-slate-500">{children}</p>
}
