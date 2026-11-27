/**
 * Faithful representations of real Tesseract screens, drawn in code.
 *
 * ── Why these exist ──────────────────────────────────────────────────────
 *
 * The landing page carried 1,542 words, zero images and six consecutive
 * sections of the same shape: a heading over a list of headed text items.
 * Every claim about the product was a sentence about the product. A reader
 * could finish the page without ever seeing what any of it looks like.
 *
 * ── The rule these are held to, which is stricter than "no screenshots" ──
 *
 * These are NOT screenshots and NOT invented features. Every field shown
 * corresponds to something the product really stores: an idea's stage and
 * conviction, a recommendation's sizing and target, the three decisions a
 * portfolio manager can take, a trade carrying the decision that authorized
 * it, an outcome judged against the original thesis.
 *
 * THE COMPANY NAMES ARE FICTIONAL, AND DELIBERATELY NOT TICKER-SHAPED.
 * Real tickers were the obvious choice and are the wrong one: "NVDA,
 * conviction High" on a public page is a view on a real security, and this
 * product is not an investment adviser and gives no investment advice. An
 * eight-letter name in a ticker column is self-evidently a placeholder to
 * anyone in the industry, which is exactly the read we want.
 *
 * Every figure carries a visible illustration marker AND `data-illustration`
 * for the test gate. See `nothing on the page imitates real data` in
 * `landing-page.test.tsx` for the gate this replaced and why.
 */
import type { ReactNode } from 'react'

/* The surface every figure sits on, so they read as one family. */
function Frame({
  caption,
  children,
  className = '',
}: {
  caption: string
  children: ReactNode
  className?: string
}) {
  return (
    <figure
      data-illustration="true"
      className={`relative overflow-hidden rounded-2xl bg-white/[0.025] p-5 ring-1 ring-inset ring-white/[0.08] sm:p-6 ${className}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold tracking-tight text-white">{caption}</span>
        {/*
          The illustration marker is INSIDE the figcaption, so a screen
          reader meets it as part of the figure's label rather than as a
          stray span after the content.
        */}
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
          Illustration
        </span>
      </figcaption>
      <div className="mt-5">{children}</div>
    </figure>
  )
}

/* A small labelled chip, the product's own vocabulary for state. */
function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'solid' }) {
  const tones = {
    muted: 'bg-white/[0.04] text-slate-300 ring-white/10',
    accent: 'bg-amber-400/10 text-amber-200 ring-amber-300/25',
    solid: 'bg-white/90 text-slate-900 ring-white/40',
  }
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/* A column heading inside a figure. */
function Col({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
      {children}
    </span>
  )
}

const IDEAS = [
  { name: 'NORTHWIND', stage: 'Ready to recommend', conviction: 'High', age: 'touched 3d ago', hot: true },
  { name: 'VERIDIAN', stage: 'Developing', conviction: 'Medium', age: 'touched 11d ago', hot: false },
  { name: 'HALDEN', stage: 'Exploring', conviction: 'Low', age: 'touched 6w ago', hot: false },
]

export function IdeaPipelineFigure() {
  return (
    <Frame caption="Idea Pipeline">
      <div className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-white/[0.07] pb-2">
        <Col>Name</Col>
        <Col>Conviction</Col>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {IDEAS.map(({ name, stage, conviction, age, hot }) => (
          <li key={name} className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-3">
            <div className="min-w-0">
              <p data-security-name className="font-mono text-[12px] tracking-tight text-white">{name}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-2">
                <Chip tone={hot ? 'accent' : 'muted'}>{stage}</Chip>
                <span className="text-[11px] text-slate-500">{age}</span>
              </p>
            </div>
            <Chip tone={hot ? 'solid' : 'muted'}>{conviction}</Chip>
          </li>
        ))}
      </ul>
      {/*
        The staleness line is the point of this screen and the reason it is
        the first figure on the page. A pipeline that shows only what is hot
        is a watchlist; one that shows how long a name has gone untouched is
        a management surface.
      */}
      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        Age is shown because a stale idea is a finding, not an omission.
      </p>
    </Frame>
  )
}

export function AssetWorkspaceFigure() {
  return (
    <Frame caption="Asset workspace">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <p data-security-name className="font-mono text-[12px] tracking-tight text-white">NORTHWIND</p>
          <p className="mt-1 text-[11px] text-slate-400">Covered by A. Reyes</p>
        </div>
        <Chip tone="accent">Held in Core Equity</Chip>
      </div>
      {/*
        Tabs drawn as STATIC labels, because this figure is not the
        interactive one. The page has exactly one widget a visitor can
        operate, and a second thing that looks operable but is not would
        teach them the first one is fake too.
      */}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {['Thesis', 'Notes', 'Price targets', 'Models', 'History'].map((t, i) => (
          <span
            key={t}
            className={
              i === 0
                ? 'border-b border-white pb-1 text-[11px] font-medium text-white'
                : 'pb-1 text-[11px] text-slate-500'
            }
          >
            {t}
          </span>
        ))}
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-slate-300">
        Margin recovery as the new plant reaches scale.
      </p>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        The written case, the firm&rsquo;s exposure and the history sit on the
        name itself, not in a folder.
      </p>
    </Frame>
  )
}

export function RecommendationFigure() {
  return (
    <Frame caption="Recommendation">
      <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <p data-security-name className="font-mono text-[12px] tracking-tight text-white">NORTHWIND</p>
          <Chip tone="muted">Submitted</Chip>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <dt><Col>Conviction</Col></dt>
            <dd className="mt-1 text-[12px] text-white">High</dd>
          </div>
          <div>
            <dt><Col>Sizing</Col></dt>
            <dd className="mt-1 text-[12px] text-white">Overweight</dd>
          </div>
        </dl>
      </div>
      {/*
        The frozen marker is the single most load-bearing claim on the whole
        page, so this figure states it as a property OF THE RECORD rather
        than as another sentence of prose underneath.
      */}
      <p className="mt-4 flex items-center gap-2 text-[11px] leading-relaxed text-slate-500">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/70" aria-hidden="true" />
        Submitting froze the reasoning behind it. Later edits start a new version.
      </p>
    </Frame>
  )
}

export function DecisionInboxFigure() {
  return (
    <Frame caption="Decision Inbox">
      <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p data-security-name className="font-mono text-[12px] tracking-tight text-white">NORTHWIND</p>
            <p className="mt-1 text-[11px] text-slate-400">Add to Core Equity, from A. Reyes</p>
          </div>
          <Chip tone="accent">Awaiting you</Chip>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.07] pt-4">
          <div>
            <dt><Col>Conviction</Col></dt>
            <dd className="mt-1 text-[12px] text-white">High</dd>
          </div>
          <div>
            <dt><Col>Proposed weight</Col></dt>
            <dd className="mt-1 text-[12px] text-white">Overweight</dd>
          </div>
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-lg bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-slate-900">
          Accept
        </span>
        <span className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-300 ring-1 ring-inset ring-white/15">
          Reject
        </span>
        <span className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-300 ring-1 ring-inset ring-white/15">
          Defer
        </span>
      </div>
      {/*
        Reject and Defer are drawn at the SAME weight as Accept, because the
        whole argument of the product is that a rejection is a record. A
        marketing figure that greys them out would contradict the page.
      */}
      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        All three are recorded with their rationale. A rejection is a decision.
      </p>
    </Frame>
  )
}

export function TradeBookFigure() {
  return (
    <Frame caption="Trade Book">
      <ul className="space-y-3">
        {[
          { name: 'NORTHWIND', side: 'Buy', book: 'Core Equity', confirmed: true },
          { name: 'VERIDIAN', side: 'Trim', book: 'Core Equity', confirmed: false },
        ].map(({ name, side, book, confirmed }) => (
          <li key={name} className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.06]">
            <div className="flex items-center justify-between gap-3">
              <p data-security-name className="font-mono text-[12px] tracking-tight text-white">{name}</p>
              <Chip tone={confirmed ? 'muted' : 'accent'}>
                {confirmed ? 'Confirmed' : 'Assumed fill'}
              </Chip>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {side} into {book}
            </p>
            {/*
              The link back to the decision is the entire reason this screen
              is on the page. Drawn as a real affordance, because in the
              product it is one.
            */}
            <p className="mt-3 flex items-center gap-1.5 border-t border-white/[0.07] pt-3 text-[11px] text-amber-300">
              <span aria-hidden="true">&#8599;</span>
              Opens the decision that authorized it
            </p>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

export function OutcomeFigure() {
  return (
    <Frame caption="Outcomes">
      <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.06]">
        <p data-security-name className="font-mono text-[12px] tracking-tight text-white">NORTHWIND</p>
        <dl className="mt-4 space-y-3">
          <div>
            <dt><Col>The thesis that was argued</Col></dt>
            <dd className="mt-1 text-[12px] leading-relaxed text-slate-300">
              Margin recovery as the new plant reaches scale.
            </dd>
          </div>
          <div className="border-t border-white/[0.07] pt-3">
            <dt><Col>What happened</Col></dt>
            <dd className="mt-1 text-[12px] leading-relaxed text-slate-300">
              Plant delayed. The position worked on an unrelated re-rating.
            </dd>
          </div>
          <div className="border-t border-white/[0.07] pt-3">
            <dt><Col>Verdict</Col></dt>
            <dd className="mt-1.5">
              <Chip tone="accent">Right outcome, wrong reason</Chip>
            </dd>
          </div>
        </dl>
      </div>
      {/*
        This verdict is the one that matters and the one a returns-based
        review cannot produce. It is the figure's entire argument.
      */}
      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        Scored against the claim that was made, so judgement separates from luck.
      </p>
    </Frame>
  )
}
