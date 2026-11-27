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
/*
 * ── "Poor organization" was ACCUSATORY, and it was also wrong ───────────
 *
 * It told a prospect their firm is badly run. Nobody buys software that
 * opens by insulting them, and the diagnosis is not even right: these firms
 * are not disorganised, they are organised around documents, which is the
 * correct way to organise documents and the wrong way to keep an argument.
 *
 * "Scattered by design" moves the blame to the tool estate, which is where
 * it belongs, and is the more useful claim: the reader recognises it
 * instead of defending against it.
 */
const COSTS = [
  {
    key: 'scattered',
    title: 'Scattered by design',
    line: 'Every tool holds its own piece correctly, and none of them holds the argument that joins the pieces.',
    Visual: ScatterVisual,
  },
  {
    key: 'memory',
    title: 'It leaves when people leave',
    line: 'The reasoning was never a record, so it goes home with whoever wrote it.',
    Visual: BrokenChainVisual,
  },
  {
    key: 'alpha',
    title: 'Luck reads as skill',
    line: 'A call that worked for the wrong reason is indistinguishable from one that worked.',
    Visual: LuckVisual,
  },
]

/*
 * ── Why these are SVG now ───────────────────────────────────────────────
 *
 * The first versions were absolutely-positioned text chips. They had no
 * graphic weight at all: five grey labels floating in a box reads as a
 * rendering bug, not as a diagram, and the feedback was blunt about it.
 *
 * Each of these now draws ONE shape that carries the idea on its own, with
 * the label subordinate to the drawing rather than the other way round.
 * Gold is the only colour, and it marks the thing that is missing, so the
 * accent always points at the problem.
 */

function ScatterVisual() {
  /*
   * Five tools, each holding a fragment correctly, with no line between
   * any of them. The gap in the middle is the subject of the drawing: the
   * dashed ring is where the argument would live if anything held it.
   */
  /*
   * The nodes sit on a ring well clear of the centre. The first version put
   * them at arbitrary coordinates and two of them landed on top of the
   * dashed circle, so the drawing read as a collision rather than as a gap.
   * Polar placement makes the clearance a property of the layout instead of
   * something to eyeball.
   */
  /*
   * The viewBox is 280x170 on all three diagrams, which is close to the
   * aspect the box actually has. They were 196x170 and 220x180, so with the
   * default `preserveAspectRatio` each drawing scaled to fit the HEIGHT and
   * sat in the middle with dead space either side. The drawings looked
   * small and tentative for no reason other than the wrong ratio.
   */
  const CX = 140
  const CY = 115
  const nodes = ['Notes', 'Chat', 'Model', 'Deck', 'Email'].map((label, i) => {
    const a = (-Math.PI / 2) + (i * 2 * Math.PI) / 5
    return { label, cx: CX + 104 * Math.cos(a), cy: CY + 92 * Math.sin(a) }
  })

  /*
   * ── Making the BOX taller did not make the DRAWING bigger ─────────────
   *
   * First attempt went h-44 to h-60 and changed almost nothing, because an
   * SVG with the default `preserveAspectRatio` scales to fit whichever axis
   * binds. The viewBox was 280x170 (1.65:1) inside a box about 290x240
   * (1.21:1), so WIDTH bound: the drawing scaled by 1.04 either way and the
   * extra 64px became empty letterbox above and below.
   *
   * Two changes make the type actually readable. The viewBox is now
   * 280x230, which is the box's own ratio, so nothing is letterboxed; and
   * the type is specified at 12-13 user units instead of 8-9, which at this
   * scale lands near 12px on screen instead of near 9px.
   */
  return (
    <svg viewBox="0 0 280 230" className="h-60 w-full" role="presentation">
      <circle
        cx={CX} cy={CY} r="52"
        fill="none" stroke="rgb(251 191 36 / 0.45)" strokeWidth="1.25" strokeDasharray="4 5"
      />
      <text
        x={CX} y={CY - 4} textAnchor="middle"
        className="fill-amber-300/90 text-[12px] font-semibold uppercase"
        style={{ letterSpacing: '0.1em' }}
      >
        the why
      </text>
      <text x={CX} y={CY + 14} textAnchor="middle" className="fill-slate-500 text-[11px]">
        nothing holds it
      </text>

      {nodes.map(({ label, cx, cy }) => (
        <g key={label}>
          <rect
            x={cx - 30} y={cy - 12} width="60" height="24" rx="6"
            fill="rgb(255 255 255 / 0.05)" stroke="rgb(255 255 255 / 0.12)"
          />
          <text x={cx} y={cy + 5} textAnchor="middle" className="fill-slate-300 text-[12px]">
            {label}
          </text>
        </g>
      ))}
    </svg>
  )
}

function BrokenChainVisual() {
  /*
   * A chain whose middle is missing. The two surviving links are solid and
   * far apart; the gap between them is drawn AS A GAP rather than as
   * struck-through text, because the subject is absence.
   */
  const rows = [
    { label: 'The position', y: 26, kept: true },
    { label: 'Why that size', y: 92, kept: false },
    { label: 'The pushback', y: 152, kept: false },
    { label: 'The thesis', y: 210, kept: true },
  ]
  return (
    <svg viewBox="0 0 280 230" className="h-60 w-full" role="presentation">
      {rows.map(({ label, y, kept }, i) => {
        const next = rows[i + 1]
        const solid = kept && next?.kept
        return (
          <g key={label}>
            {next && (
              <line
                x1="22" y1={y + 14} x2="22" y2={next.y - 14}
                stroke={solid ? 'rgb(251 191 36 / 0.5)' : 'rgb(255 255 255 / 0.1)'}
                strokeWidth="1.25"
                strokeDasharray={solid ? undefined : '3 6'}
              />
            )}
            {kept ? (
              <rect x="11" y={y - 11} width="22" height="22" rx="6" fill="rgb(251 191 36 / 0.9)" />
            ) : (
              <rect
                x="11" y={y - 11} width="22" height="22" rx="6"
                fill="none" stroke="rgb(255 255 255 / 0.16)" strokeDasharray="3 4"
              />
            )}
            <text
              x="46" y={y + 5}
              className={kept ? 'fill-slate-200 text-[13px]' : 'fill-slate-600 text-[13px]'}
            >
              {label}
            </text>
            {!kept && (
              <text
                x="46" y={y + 21}
                className="fill-slate-700 text-[10px] uppercase"
                style={{ letterSpacing: '0.1em' }}
              >
                gone
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function LuckVisual() {
  /*
   * Two tracks that arrive at the same place. Returns alone cannot tell
   * them apart, which is why they are drawn as two lines ending on the
   * same point, with only the REASON differing. The gold track is the one
   * whose thesis actually played out.
   */
  return (
    /*
     * Labels sit BELOW their own curve rather than on it. The first
     * version put "played out" directly over the gold path and "Both
     * worked" on top of the end point, so three things occupied the same
     * 20px band. Each track now owns a horizontal lane.
     */
    <svg viewBox="0 0 280 230" className="h-60 w-full" role="presentation">
      <text x="2" y="16" className="fill-slate-500 text-[11px] uppercase" style={{ letterSpacing: '0.1em' }}>
        Same thesis, two paths
      </text>

      <path d="M6 62 C 90 62, 150 58, 196 56" fill="none" stroke="rgb(251 191 36 / 0.85)" strokeWidth="2" />
      <text x="6" y="84" className="fill-amber-300 text-[12px]">the thesis played out</text>

      <path
        d="M6 162 C 80 162, 130 86, 196 60" fill="none"
        stroke="rgb(255 255 255 / 0.22)" strokeWidth="2" strokeDasharray="4 5"
      />
      <text x="6" y="184" className="fill-slate-500 text-[12px]">something else did</text>

      <circle cx="200" cy="58" r="6" fill="rgb(255 255 255 / 0.9)" />
      <text x="212" y="62" className="fill-slate-200 text-[12px]">Worked</text>

      <line x1="2" y1="204" x2="278" y2="204" stroke="rgb(255 255 255 / 0.08)" />
      <text x="2" y="222" className="fill-slate-600 text-[10px] uppercase" style={{ letterSpacing: '0.1em' }}>
        Returns cannot separate these
      </text>
    </svg>
  )
}

export function CostOfForgetting() {
  return (
    <ul className="grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {COSTS.map(({ key, title, line, Visual }) => (
        /*
          `flex-col` with `mt-auto` on the figure, so the three diagrams
          share a baseline. The descriptions run two or three lines and
          without this the first column's figure sat 25px below the other
          two, which reads as a column that failed to lay out rather than as
          a deliberate difference.
        */
        <li key={key} data-cost={key} className="flex flex-col">
          <h3 className="text-[15px] font-semibold tracking-tight text-white">{title}</h3>
          <p className="mt-2 max-w-[38ch] text-[13px] leading-[1.75] text-slate-400">{line}</p>
          <div className="mt-auto pt-6">
            <div className="rounded-xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/[0.06]">
              <Visual />
            </div>
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
            What somebody writes
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
          A note somebody was going to write regardless.
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
        {/* Said "One name, one year" while the figure draws three of them. */}
        <span className="text-[13px] font-semibold tracking-tight text-white">
          One name, three years
        </span>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
          Illustration
        </span>
      </figcaption>

      <p data-security-name className="mt-4 font-mono text-[12px] tracking-tight text-white">
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
      <div className="mt-5 space-y-2.5">
        {[
          { year: 'Year one', marks: 4, gold: 1 },
          { year: 'Year two', marks: 9, gold: 3 },
          { year: 'Year three', marks: 16, gold: 6 },
        ].map(({ year, marks, gold }) => (
          <div key={year} className="flex items-center gap-3">
            {/* w-16 wrapped "Year three" onto two lines and threw the row off its marks. */}
            <span className="w-20 shrink-0 text-[10px] uppercase tracking-[0.1em] text-slate-500">
              {year}
            </span>
            <span className="flex flex-wrap gap-1">
              {Array.from({ length: marks }, (_, i) => (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 rounded-[2px] ${
                    i < gold ? 'bg-amber-400/90' : 'bg-white/[0.09]'
                  }`}
                />
              ))}
            </span>
          </div>
        ))}
      </div>

      <ol className="mt-5 space-y-2 border-t border-white/[0.07] pt-4">
        {rows.map(({ when, what, kind }) => (
          <li key={when} className="flex items-baseline gap-3">
            <span className="w-7 shrink-0 font-mono text-[10px] text-slate-500">{when}</span>
            <span className="min-w-0 flex-1 text-[12px] leading-snug text-slate-200">{what}</span>
            <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-amber-300/80">
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
          /*
           * Was "Your model, your key", which led with BYOK. That is a
           * procurement detail and it was carrying the first panel, where
           * the reader is deciding whether to keep reading. Broadened to
           * the thing a buyer actually wants to hear: you are not locked to
           * one vendor's model. The key is still mentioned, as the
           * mechanism, in the line rather than the heading.
           */
          step: 'Use the model you want',
          line: 'Pick the provider and model the work suits, on your own key. Nothing here is tied to one vendor.',
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
                      ? 'bg-amber-400/10 text-white ring-amber-300/30'
                      : 'text-slate-500 ring-white/[0.07]'
                  }`}
                >
                  {name}
                  {on && (
                    <span className="text-[10px] uppercase tracking-[0.12em] text-amber-300">
                      In use
                    </span>
                  )}
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
           *
           * Drawn as the answer BECOMING something: the question, then the
           * tags it attached itself to, then the line about where it turns
           * up later. That last line is the whole argument of the section.
           */
          step: 'The answer becomes part of the record',
          line: 'It attaches to the name, the idea and the note it drew on, so the next person finds it without knowing it exists.',
          Body: () => (
            <div className="rounded-lg bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.07]">
              <p className="text-[12px] leading-relaxed text-slate-300">
                Where did the margin case first weaken?
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.07] pt-3">
                {['Asset', 'Idea', 'Research note'].map(t => (
                  <span
                    key={t}
                    className="rounded bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200 ring-1 ring-inset ring-amber-300/25"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                <span aria-hidden="true" className="text-amber-300">&#8627;</span>
                Opens with the name a year from now, beside the thesis it
                questioned.
              </p>
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
            <h3 className="text-[15px] font-semibold tracking-tight text-white">{step}</h3>
          </div>
          <p className="mt-2 max-w-[40ch] text-[13px] leading-[1.75] text-slate-400">{line}</p>
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
  return <p className="mt-4 text-[11px] leading-relaxed text-slate-500">{children}</p>
}
