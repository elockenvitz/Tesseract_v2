/**
 * Who the product is for, in the three seats that buy it.
 *
 * ── Why this section exists ──────────────────────────────────────────────
 *
 * The page could describe the product completely and still leave every
 * individual reader to work out what it meant for THEM. An analyst, a PM
 * and a CIO want three different things from the same software, and only
 * one of those three signs the contract while a different one decides
 * whether the pilot survives.
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
 *   Analyst  a QUEUE      — things ranked by what needs you first
 *   PM       an APPROVAL  — one item, with the case attached to it
 *   CIO      a LEDGER     — the same name over years, accumulating
 *
 * A queue, a decision and a ledger are three different shapes. If someone
 * later makes all three render the same component with different strings,
 * the section has regressed to what it replaced, and the test
 * `gives each role a different shape of artifact` is there to catch it.
 *
 * ── Honesty ──────────────────────────────────────────────────────────────
 *
 * Same rules as every other figure: fictional eight-letter names, nothing
 * invented presented as measured, a visible illustration marker, and every
 * field corresponds to something the product really stores.
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

function Col({ children }: { children: ReactNode }) {
  return (
    <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-slate-500">
      {children}
    </span>
  )
}

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure
      data-illustration="true"
      data-role-figure
      className="relative overflow-hidden rounded-2xl bg-white/[0.025] p-5 ring-1 ring-inset ring-white/[0.08] sm:p-6"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[16px] font-semibold tracking-tight text-white">{caption}</span>
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-500">
          Illustration
        </span>
      </figcaption>
      <div className="mt-5">{children}</div>
    </figure>
  )
}

/* ── ANALYST: a queue ──────────────────────────────────────────────────── */

const QUEUE = [
  { name: 'NORTHWIND', why: 'Earnings in four days', tag: 'Prep due', hot: true },
  { name: 'VERIDIAN', why: 'Thesis untouched since the guidance cut', tag: 'Review', hot: true },
  { name: 'HALDEN', why: 'Two diligence questions still open', tag: 'Open', hot: false },
  { name: 'CALDERA', why: 'Price target passed, no note yet', tag: 'Revisit', hot: false },
]

function AnalystQueue() {
  return (
    <Figure caption="Your morning, ranked">
      <ul className="divide-y divide-white/[0.05]">
        {QUEUE.map(({ name, why, tag, hot }) => (
          <li key={name} className="flex items-start justify-between gap-4 py-3.5">
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
      <p className="mt-4 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-500">
        Assembled from the work already in the system, not from a status form
        somebody asked you to fill in.
      </p>
    </Figure>
  )
}

/* ── PM: one approval, with its case attached ──────────────────────────── */

function PmApproval() {
  return (
    <Figure caption="A recommendation, with its case attached">
      <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
        <div>
          <p data-security-name className="font-mono text-[14px] tracking-tight text-white">
            NORTHWIND
          </p>
          <p className="mt-1 text-[14px] text-slate-400">Initiate · 180 bps · from A. Reyes</p>
        </div>
        <span className="shrink-0 rounded-md bg-amber-400/10 px-2 py-0.5 text-[14px] font-medium text-amber-200 ring-1 ring-inset ring-amber-300/25">
          Awaiting you
        </span>
      </div>

      <dl className="mt-4 space-y-3">
        {[
          ['The claim', 'Margin recovery as the new plant reaches scale'],
          ['What would break it', 'A second delay to the ramp, or input costs holding'],
          ['Conviction', 'High, raised from Medium after the site visit'],
        ].map(([term, def]) => (
          <div key={term} className="grid grid-cols-[8.5rem_1fr] gap-x-4">
            <dt className="text-[14px] font-medium text-slate-400">{term}</dt>
            <dd className="text-[14px] leading-relaxed text-slate-300">{def}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
        {['Approve', 'Reject', 'Defer'].map(verb => (
          <span
            key={verb}
            className="rounded-md bg-white/[0.04] px-2.5 py-1 text-[14px] font-medium text-slate-300 ring-1 ring-inset ring-white/10"
          >
            {verb}
          </span>
        ))}
        <span className="ml-auto self-center text-[14px] text-slate-500">
          Whichever you pick is recorded with your reasoning.
        </span>
      </div>
    </Figure>
  )
}

/* ── CIO: a ledger across years ────────────────────────────────────────── */

const LEDGER = [
  { year: 'Year one', marks: 3, note: 'Initiated, then added to twice' },
  { year: 'Year two', marks: 5, note: 'Thesis revised, one risk realised' },
  { year: 'Year three', marks: 7, note: 'Exited, and the review says why' },
]

function CioLedger() {
  return (
    <Figure caption="One name, three years, two analysts">
      <ul className="space-y-4">
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
      <p className="mt-5 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-500">
        The analyst who opened this name no longer works here. The reasoning
        did not leave with them.
      </p>
    </Figure>
  )
}

/* ── The roles ─────────────────────────────────────────────────────────── */

const ROLES = [
  {
    seat: 'Analysts',
    shape: 'queue',
    claim: 'Be an investor, not an information manager.',
    lead:
      'Less time spent finding what you already wrote, rebuilding context and answering where things stand. More time on the part of the job that is actually yours.',
    Artifact: AnalystQueue,
    points: [
      ['You open to what matters', 'Your names, ordered by what needs you first.'],
      ['Nothing is re-found', 'The case, the risks and the history live on the security.'],
      ['The write-up is the work', 'A recommendation assembles from research you already did.'],
    ],
  },
  {
    seat: 'Portfolio managers',
    shape: 'approval',
    claim: 'Lead a better-informed team without chasing it.',
    lead:
      'See what the desk is working on, where conviction is moving and which calls are waiting on you, without a round of meetings to assemble the picture.',
    Artifact: PmApproval,
    points: [
      ['Decisions arrive with the case', 'You judge the argument, not a one-line request.'],
      ['Conviction is visible as it moves', 'A view that changed shows when, and on what.'],
      ['Your reasoning is captured once', 'What you decided and why is kept with the decision.'],
    ],
  },
  {
    seat: 'Investment leadership',
    shape: 'ledger',
    claim: 'Build a firm that gets sharper every year.',
    lead:
      'The judgement your people develop is the one asset you cannot buy and the one most likely to walk out of the building. This is where it accumulates instead.',
    Artifact: CioLedger,
    points: [
      ['Knowledge survives the team', 'A departure costs you a person, not a decade of context.'],
      ['Process becomes visible', 'How the firm actually decides, rather than how it says it does.'],
      ['The record compounds', 'Every decision adds to what the next one can be judged against.'],
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
              className={`group rounded-lg px-4 pb-3.5 pt-3 text-left ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710] ${
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
                className={`mt-3 block text-[18px] font-semibold tracking-tight transition-colors ${
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
        <div className="grid gap-x-14 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h3 className="text-pretty text-2xl font-semibold leading-[1.2] tracking-[-0.02em] text-white sm:text-3xl">
              {claim}
            </h3>
            {/*
              `data-section-lead`: this is a section lead, not a bullet.

              `keeps every bullet to a single sentence` finds headed items
              by taking each h3 and reading the first p beside it, and it
              exempts section leads by design — but the leads it was
              written against sit under an h2, so the selector cannot tell
              this one apart. The marker says which rule applies rather
              than loosening the rule.

              It matters here because each role's lead is a less/more
              contrast across two sentences, and collapsing it to one
              throws away the only rhetorical move in the paragraph.
            */}
            <p
              data-section-lead
              className="mt-5 max-w-[44ch] text-[17px] leading-[1.75] text-slate-400"
            >
              {lead}
            </p>

            <dl className="mt-9 space-y-5">
              {points.map(([term, def]) => (
                <div key={term} className="border-t border-amber-300/20 pt-4">
                  <dt className="text-[16px] font-semibold tracking-tight text-white">{term}</dt>
                  <dd className="mt-1.5 max-w-[42ch] text-[16px] leading-[1.7] text-slate-400">
                    {def}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/*
            A FIXED FLOOR ON THE FIGURE COLUMN.

            The lifecycle section shipped a bug where picking a different
            tab resized the whole section, because the tallest panel was
            taller than the one whose height the container had been set
            from. Measured here across all three: 452px is the tallest, so
            that is the floor, and a test asserts it rather than trusting
            that whoever edits a figure next will re-measure.
          */}
          <div data-role-figure-column className="lg:col-span-7 lg:min-h-[452px]">
            <Artifact />
          </div>
        </div>
      </div>

      <p className="sr-only">Showing what Tesseract does for {seat}.</p>
    </div>
  )
}
