import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeftRight, ArrowRight, BookOpen, FileSignature, Gavel, History,
  Layers, LineChart, Lock, RotateCcw, ShieldCheck, Sparkles, Users,
} from 'lucide-react'
import { TesseractLogo } from '../components/ui/TesseractLogo'
import { TesseractMark } from '../components/ui/TesseractMark'
import { hideBootLoader } from '../lib/boot-loader'

/**
 * The public front door.
 *
 * ── The constraint this page is written under ───────────────────────────
 *
 * Tesseract has a working core workflow and does NOT have commercial
 * market-data licensing, platform-provisioned AI, or a production
 * deployment with external users on it. A landing page that implied
 * otherwise would be the most expensive kind of wrong: a PM who arrives at
 * a demo expecting a Bloomberg substitute has already decided what this is
 * before the conversation starts, and the correction costs the meeting.
 *
 * So the page is positioned on the one thing that is real and is the
 * differentiator: the connected record of why decisions were made.
 *
 * No invented customers, logos, statistics, testimonials or metrics appear
 * on this page, and none should ever be added to it.
 *
 * WHERE THE SCOPE DISCLOSURES LIVE. They are deliberately spread rather
 * than massed. The design-partner section used to carry a three-bullet
 * panel headed "What we are honest about up front", which turned the one
 * part of the page meant to convert into a list of caveats. The same
 * information is still on the page, in the three places a reader meets it
 * naturally:
 *
 *   1. The hero states what Tesseract is not, above the fold.
 *   2. The ACT AI section splits running-today from not-yet-built, with the
 *      provider-key dependency named in the item it belongs to.
 *   3. The footer carries the pre-release and no-performance-claim line.
 *
 * That is a presentation change, not a reduction in candour. Do not
 * reintroduce a disclosure block into the conversion section, and do not
 * remove any of the three above to tidy the page up.
 *
 * ── The visual system ────────────────────────────────────────────────────
 *
 * EXPLICITLY DARK, AND THEME INDEPENDENT. No `dark:` variants anywhere in
 * this file, on purpose. `tailwind.config.js` sets `darkMode: 'class'`, and
 * a signed-out visitor has no app theme applied, so every `dark:` style on
 * the first version was dead: the page always rendered its LIGHT branch.
 * That is why it read as flat and under-coloured. A public marketing page
 * must also look identical for every visitor regardless of the theme they
 * last used inside the app, which a `dark:`-variant page cannot promise.
 *
 * COLOR. A near-black base with a blue undertone (#070b16) rather than
 * slate-950, carrying two low-opacity gradient fields and a blue-to-violet
 * accent. The accent appears in four places only: the eyebrow rules, the
 * hero's second line, the primary button, and the lifecycle icons. Premium
 * here means restraint with depth, not more hues.
 *
 * DEPTH. Surfaces are separated by translucency and a 1px inner highlight
 * (`ring-white/10` plus a top gradient hairline) instead of by a change of
 * background colour. That is what makes a dark page read as layered glass
 * rather than as black boxes on black.
 *
 * ── The mark is `TesseractLogo`, never `TesseractLoader` ──────────────────
 *
 * `TesseractLoader` is a LOADING INDICATOR: it renders the mark plus the
 * word "Loading..." and turns continuously at 4.5s. Mounted as the nav
 * logo it printed "Loading..." under the navigation bar permanently and
 * never stopped moving. `TesseractLogo` is the same geometry configured as
 * a logo: still at rest, turning only under a pointer at 15s, with
 * `showNodes={false}` and a lighter stroke, which its own comments explain
 * is what keeps a small mark from reading as a blob.
 *
 * ── Performance ──────────────────────────────────────────────────────────
 *
 * Lazily routed from `App.tsx` so none of this reaches the authenticated
 * entry chunk, a lane this codebase has already paid for once (the 8,950 kB
 * entry chunk). No images, no new dependencies, no web fonts: the only
 * graphic is the brand mark the app already draws, and every layout is CSS.
 */

/**
 * Where a demo request goes.
 *
 * The SAME variable the login page's `EarlyAccessNotice` reads, deliberately:
 * one address to configure, in one place, governing every inbound path. With
 * it unset the CTAs still work as navigation and the design-partner section
 * says plainly that the contact route is not configured yet, rather than
 * rendering a button that goes nowhere or a guessed address.
 *
 * `sales@tesseract.com` appears hard-coded in `AIConfigurationSection` and is
 * NOT used here. That domain is not ours.
 */
const CONTACT_EMAIL = import.meta.env.VITE_ACCESS_REQUEST_EMAIL as string | undefined

const DEMO_SUBJECT = 'Tesseract demo request'
const PARTNER_SUBJECT = 'Tesseract design partnership'

function mailto(subject: string): string | null {
  if (!CONTACT_EMAIL) return null
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
}

/* ─────────────────────────────── primitives ─────────────────────────────── */

/** The page gutter, one definition so every band lines up with the nav. */
const SHELL = 'mx-auto w-full max-w-7xl px-6 sm:px-8 lg:px-12'

/** Accent gradient, used for rules, the hero line and the icon wash. */
const ACCENT_TEXT = 'bg-gradient-to-r from-sky-200 via-primary-300 to-violet-300 bg-clip-text text-transparent'

/** The 1px inner highlight that makes a translucent panel read as glass. */
const GLASS =
  'relative rounded-2xl bg-white/[0.035] ring-1 ring-inset ring-white/10 ' +
  'before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:h-px ' +
  'before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent'

/** An eyebrow label with a short accent rule, instead of flat coloured caps. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="h-px w-8 bg-gradient-to-r from-primary-400 to-violet-400" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{children}</p>
    </div>
  )
}

/**
 * A body section.
 *
 * Asymmetric header: the title holds the left column and the lead sits in
 * the right, which is the layout that stops a long page reading as a stack
 * of identical slabs. Below `lg` it collapses to one column in reading
 * order, so the structure is a wide-screen affordance rather than a
 * requirement.
 *
 * The divider is a gradient hairline that fades at both ends, not a full
 * width border. A hard 1px line edge to edge is the single most common tell
 * of a template; a rule that resolves into the background reads as
 * intentional.
 */
function Section({
  id, label, title, lead, children, divide = true,
}: {
  id: string
  label?: string
  title: string
  lead?: string
  children?: React.ReactNode
  divide?: boolean
}) {
  return (
    <section id={id} className="relative">
      {divide && (
        <div
          aria-hidden="true"
          className={`${SHELL} h-px bg-gradient-to-r from-transparent via-white/10 to-transparent`}
        />
      )}
      <div className={`${SHELL} py-20 sm:py-28`}>
        <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            {label && <Eyebrow>{label}</Eyebrow>}
            <h2
              className={`text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl ${
                label ? 'mt-5' : ''
              }`}
            >
              {title}
            </h2>
          </div>
          {lead && (
            <div className="lg:col-span-5 lg:pt-2">
              <p className="max-w-[56ch] text-[15px] leading-[1.75] text-slate-400">{lead}</p>
            </div>
          )}
        </div>
        {children && <div className="mt-14 sm:mt-16">{children}</div>}
      </div>
    </section>
  )
}

/*
 * `ProductShot` was removed here, deliberately, and should not come back.
 *
 * It rendered one placeholder panel per product surface: a bordered frame
 * containing a title, a sentence, and the line "Product capture pending.
 * This frame is a placeholder, not a rendering of the feature." Six of them
 * sat in a grid. The honesty was right and the form was wrong. Six boxes
 * drawn around nothing, each announcing that it contains nothing, is the
 * single most unfinished-looking element a page can carry, and it survived
 * two visual passes because it was never the styling that was at fault.
 *
 * The surfaces are now a dense index and the disclaimer is stated once at
 * section level. Nothing was softened: the page still says plainly that no
 * screenshots appear on it, and `landing-page.test.tsx` holds that to a
 * page-level assertion plus a hard zero on `<img>`.
 *
 * Real captures, when the blocking fixes merge, belong in this section as
 * images with the placeholder text deleted, not reintroduced as frames.
 * `docs/commercial/demo-checklist.md` lists which captures are safe to take
 * and which are blocked, and why.
 */

/**
 * A status marker that distinguishes what runs from what is planned.
 *
 * One per card header, rather than repeated beside every bullet. The same
 * badge printed three times in a list stops being read.
 */
function Status({ kind }: { kind: 'now' | 'planned' }) {
  const now = kind === 'now'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight ring-1 ring-inset ${
        now
          ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20'
          : 'bg-white/[0.04] text-slate-400 ring-white/10'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${now ? 'bg-emerald-400' : 'bg-slate-500'}`} />
      {now ? 'Available now' : 'Planned'}
    </span>
  )
}

/**
 * The linkage, drawn.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The page's central claim is "typed records that point at the one before
 * it, linked rather than filed". Every version of this page asserted that
 * in prose and then showed six empty placeholder boxes. A reader had no way
 * to see the thing being claimed, which is the real reason the page read as
 * generated: it described a mechanism it never demonstrated.
 *
 * ── Why it is not a fabrication ──────────────────────────────────────────
 *
 * This is a SCHEMA, not data. It names the row each stage writes and the
 * field that carries the reference to the row before it, and it is labelled
 * as the shape of the record rather than a capture of the product. There
 * are no prices, no tickers, no names, no numbers, and nothing here could
 * be mistaken for a screenshot of a tenant. The constraint on this page is
 * that nothing invented is presented as real; a structural diagram of our
 * own data model invents nothing.
 *
 * It also carries the argument the prose cannot: the arrow from the review
 * back to the research note is the reason this is a lifecycle and not a
 * list, and the dotted "frozen" marker is where the differentiator lives.
 */
const CHAIN: { record: string; via: string | null }[] = [
  { record: 'Research note', via: null },
  { record: 'Recommendation', via: 'cites the note' },
  { record: 'Frozen reasoning', via: 'version pinned at submission' },
  { record: 'Decision', via: 'references the frozen version' },
  { record: 'Accepted trade', via: 'authorized by the decision' },
  { record: 'Outcome review', via: 'graded against the original case' },
]

function RecordChain() {
  return (
    <figure className="relative overflow-hidden rounded-2xl bg-white/[0.025] p-6 ring-1 ring-inset ring-white/[0.08] sm:p-8">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />
      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] font-semibold tracking-tight text-white">
          How one decision is stored
        </span>
        <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-400 ring-1 ring-inset ring-white/10">
          Record shape, not a screenshot
        </span>
      </figcaption>

      <ol className="mt-7 space-y-0">
        {CHAIN.map(({ record, via }, i) => {
          const frozen = record === 'Frozen reasoning'
          return (
            <li key={record} className="relative flex gap-4">
              {/* The spine: a continuous line through every row but the last. */}
              <div className="flex w-5 shrink-0 flex-col items-center">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[#070b16] ${
                    frozen ? 'bg-violet-400' : 'bg-primary-400'
                  }`}
                />
                {i < CHAIN.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={`w-px flex-1 ${frozen ? 'bg-violet-400/30' : 'bg-primary-400/25'}`}
                    style={frozen ? { backgroundImage: 'none' } : undefined}
                  />
                )}
              </div>

              <div className={i < CHAIN.length - 1 ? 'pb-7' : ''}>
                <p className="text-[13px] font-semibold tracking-tight text-white">{record}</p>
                {via && (
                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-slate-500">
                    {via}
                  </p>
                )}
                {frozen && (
                  <p className="mt-1.5 max-w-[46ch] text-[12px] leading-relaxed text-violet-200/70">
                    Immutable. Later edits to the research create new versions
                    and never alter what the PM actually read.
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {/* The return leg, which is what makes it a loop rather than a list. */}
      <div className="mt-2 flex items-start gap-4">
        <div className="flex w-5 shrink-0 justify-center">
          <RotateCcw className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </div>
        <p className="max-w-[48ch] text-[12px] leading-relaxed text-slate-500">
          The review returns to the note, so the next decision on this name
          starts from what the firm already learned rather than from a blank
          page.
        </p>
      </div>
    </figure>
  )
}

/** A quiet bullet, so a list needs no border and no icon per row. */
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span aria-hidden="true" className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-slate-600" />
      <span className="text-[14px] leading-[1.75] text-slate-400">{children}</span>
    </li>
  )
}

/* ──────────────────────────────── the page ──────────────────────────────── */

/**
 * The lifecycle, complete.
 *
 * This ran Research, Recommend, Decide, Review, and stopped. Two stages of
 * the real chain were missing, and they are the two that make the claim
 * land:
 *
 *  - EXECUTE. A decision that never reaches the book is not a decision the
 *    firm acted on. `accepted_trades` is the only object in this system
 *    that represents a committed trade, and the record carries whether the
 *    fill was assumed from the approval or confirmed against holdings.
 *    Leaving it out skipped from a PM saying yes straight to grading the
 *    outcome, which is the gap every attribution argument falls into.
 *  - The RETURN. The review is not the end, it is the input to the next
 *    decision on that name. A lifecycle drawn as a line that stops implies
 *    a filing system; the point of the product is that it closes.
 *
 * Each `record` names the typed row the stage actually writes, which is
 * what `RecordChain` draws below it.
 */
const LIFECYCLE = [
  {
    icon: BookOpen,
    stage: 'Research',
    record: 'Research note',
    line: 'The written case, its evidence and its revisions, attached to the security rather than to a folder.',
  },
  {
    icon: FileSignature,
    stage: 'Recommend',
    record: 'Recommendation',
    line: 'An analyst puts a view forward. The reasoning behind it is frozen at submission, so what the PM read is what the record keeps.',
  },
  {
    icon: Gavel,
    stage: 'Decide',
    record: 'Decision',
    line: 'The PM accepts, rejects or defers, with the rationale captured as part of the decision instead of in a reply to a message.',
  },
  {
    icon: ArrowLeftRight,
    stage: 'Execute',
    record: 'Accepted trade',
    line: 'The approved trade becomes the firm’s committed record of what it actually did, carrying whether the fill was assumed from the approval or confirmed against the book.',
  },
  {
    icon: History,
    stage: 'Review',
    record: 'Outcome review',
    line: 'Later, the decision is revisited against what actually happened, and the review becomes part of the record too.',
  },
]

const PROBLEMS: [string, string][] = [
  ['Research evolves', 'The note that justified the position has been edited six times since. The version the PM actually read is gone.'],
  ['Recommendations change', 'A target moves, conviction shifts, the sizing is revised. Which version was the one that got approved?'],
  ['PMs disagree', 'A rejection or a deferral carries as much information as an approval, and it usually lives in a reply to a message.'],
  ['Positions get adjusted', 'Six months later the book looks nothing like the trade that was authorized, and nobody can reconstruct the path.'],
]

const MEMORY: [typeof Lock, string, string][] = [
  [Lock, 'Preserved reasoning', 'The case as it stood at the moment of decision, immune to later editing.'],
  [History, 'Decision history', 'Approvals, rejections and deferrals as records of equal standing, each with its rationale.'],
  [ShieldCheck, 'Accountability', 'Who decided, on what evidence, and when. Available without anyone reconstructing a thread.'],
  [Users, 'Continuity', 'A name handed between analysts or PMs arrives with its context, not as a blank page.'],
  [LineChart, 'Review and learning', 'Outcomes assessed against the original thesis, so the firm can tell judgement from luck.'],
  [Layers, 'A connected corpus', 'Research, ideas, recommendations, decisions and reviews as linked records, queryable as one body.'],
]

const SURFACES: [string, string][] = [
  ['Asset workspace', "The security, its instrument identity and price provenance, the firm's exposure, coverage, and the written case in one view."],
  ['Idea pipeline', 'Ideas moving through exploring, researching, developing and ready-to-recommend, with conviction and staleness visible.'],
  ['Recommendation and frozen reasoning', 'What the analyst submitted, preserved exactly as the PM received it, with later edits kept as versions rather than overwrites.'],
  ['Decision inbox', 'Recommendations awaiting a portfolio-manager decision, with accept, reject and defer each recorded as a first-class outcome.'],
  ['Historical decision record', 'Every decision the firm has made, with the case, the decision-maker, the rationale and the execution provenance attached.'],
  ['Outcome review', 'A structured review of whether the thesis played out, recorded against the decision it belongs to.'],
]

/** Primary and secondary button classes, so every CTA matches exactly. */
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-950/50 transition-all hover:bg-primary-500 hover:shadow-primary-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b16]'
const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-slate-200 ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/5 hover:ring-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b16]'

export function LandingPage() {
  const markRef = useRef<HTMLDivElement>(null)

  /*
   * Release the static boot loader.
   *
   * `#tesseract-boot-loader` is painted by index.html OUTSIDE `#root` at
   * `position: fixed`, `inset: 0`, `z-index: 2147483647`, with an opaque
   * background, and React's mount deliberately does not remove it. It stops
   * covering the page only once something adds `.is-fading`, which is what
   * `hideBootLoader()` does, and `pointer-events: none` lives in that class,
   * so until then the overlay also swallows every click.
   *
   * `/` for a signed-out visitor renders this page and nothing else.
   * `ProtectedRoute` never runs for a public route, and this page is not
   * inside `AuthLayout`, so NEITHER existing caller fires. Without this the
   * page rendered correctly and was then covered by "Loading…" forever.
   *
   * Idempotent, and a no-op when the overlay is absent.
   */
  useEffect(() => { hideBootLoader() }, [])

  // The page title is the one SEO signal that differs by route in a SPA, and
  // "Investment Intelligence" is the app's title, not this page's pitch.
  useEffect(() => {
    const previous = document.title
    document.title = 'Tesseract | A decision operating system for investment teams'
    const desc = document.querySelector('meta[name="description"]')
    const previousDesc = desc?.getAttribute('content') ?? null
    desc?.setAttribute(
      'content',
      'Tesseract connects investment research, recommendations, portfolio-manager decisions and outcome reviews in one institutional workspace, so a firm keeps the reasoning behind its decisions.',
    )
    return () => {
      document.title = previous
      if (desc && previousDesc !== null) desc.setAttribute('content', previousDesc)
    }
  }, [])

  const demoHref = mailto(DEMO_SUBJECT)
  const partnerHref = mailto(PARTNER_SUBJECT)

  return (
    <div className="min-h-screen bg-[#070b16] text-slate-200 antialiased">
      {/*
        Two gradient fields over the whole page, fixed so they do not scroll
        with the content. This is what stops a dark page reading as flat
        black: the base never appears unmodulated. Both are far below the
        threshold where a gradient becomes a decoration you notice.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(60rem 40rem at 12% -10%, rgba(59,130,246,0.13), transparent 60%),' +
            'radial-gradient(50rem 36rem at 88% 8%, rgba(139,92,246,0.10), transparent 62%)',
        }}
      />

      <div className="relative z-10">
        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#070b16]/80 backdrop-blur-xl">
          <nav className={`${SHELL} flex items-center justify-between py-4`} aria-label="Main">
            <a href="#top" className="flex items-center gap-3 text-white">
              {/*
                `TesseractLogo`, not `TesseractLoader`. The loader renders the
                word "Loading..." beneath the mark and turns continuously; as
                a nav logo that printed "Loading" under the navigation bar
                permanently. This one is still at rest and turns on hover.
              */}
              <div ref={markRef} className="shrink-0">
                <TesseractLogo size={30} />
              </div>
              <span className="text-[15px] font-semibold tracking-[-0.01em]">Tesseract</span>
            </a>
            <div className="flex items-center gap-1">
              <a href="#lifecycle" className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-slate-400 transition-colors hover:text-white sm:block">
                How it works
              </a>
              <a href="#product" className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-slate-400 transition-colors hover:text-white md:block">
                Product
              </a>
              <a href="#partners" className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-slate-400 transition-colors hover:text-white sm:block">
                Design partners
              </a>
              <Link
                to="/login"
                className="ml-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-slate-200 ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/5 hover:ring-white/30"
              >
                Sign in
              </Link>
            </div>
          </nav>
        </header>

        {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
        <section id="top" className="relative isolate overflow-hidden">
          {/*
            The brand mark as the hero's figure, at rest.

            Replaces a generic blue radial. A large still rendering of the
            actual mark is quieter and more specific than a glow, and it is
            the same geometry as the nav logo, so the page has one ornament
            at three scales rather than an unrelated decoration. Held static
            deliberately: motion belongs to hover.
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-32 -top-20 hidden opacity-[0.09] md:block lg:-right-20"
          >
            <TesseractMark size={660} periodMs={15000} animate={false} weight={0.9} fill={1.25} showNodes={false} />
          </div>

          <div className={`${SHELL} relative pb-24 pt-20 sm:pb-32 sm:pt-28`}>
            <Eyebrow>A decision operating system for investment teams</Eyebrow>

            {/*
              The only element on the page allowed this much size. It was
              text-3xl/5xl against section heads at text-2xl/3xl, which is
              not enough separation to lead a page. The second line takes the
              accent gradient so the sentence has a subject and a turn
              rather than two equal shouts.
            */}
            <h1 className="mt-7 max-w-[20ch] text-pretty text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Every investment decision has a story.
              <span className={`mt-2 block ${ACCENT_TEXT}`}>Make sure your firm remembers it.</span>
            </h1>

            <p className="mt-9 max-w-[62ch] text-lg leading-[1.7] text-slate-300">
              Tesseract connects investment research, recommendations,
              portfolio-manager decisions and subsequent outcomes in one
              institutional workspace. It helps teams preserve reasoning,
              maintain context, and learn from decisions over time.
            </p>

            <div className="mt-11 flex flex-wrap items-center gap-3">
              <a href={demoHref ?? '#partners'} className={BTN_PRIMARY}>
                Request a demo
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <a href="#lifecycle" className={BTN_GHOST}>
                Explore the platform
              </a>
            </div>

            {/*
              Said on the hero, not buried. A PM who learns this at minute
              forty of a demo has spent forty minutes on the wrong question.
              This is scope-setting, and it is one of the three places the
              page is candid about what is not built. See the file header.
            */}
            <p className="mt-14 max-w-[64ch] border-l border-white/10 pl-5 text-[13px] leading-[1.8] text-slate-500">
              Tesseract is an early-stage institutional platform with a working
              core workflow. It is not a market-data terminal, an execution
              system, or a replacement for the tools your desk already runs. It
              is the layer that remembers why you did what you did.
            </p>
          </div>
        </section>

        {/* ── 3. The connected decision lifecycle ─────────────────────────── */}
        <Section
          id="lifecycle"
          label="The connected decision lifecycle"
          title="Research, recommend, decide, review. Linked, not filed."
          lead="Each stage in Tesseract is a typed record that points at the one before it. That linkage is the product. It is what makes a decision reviewable a year later rather than merely archived."
        >
          {/*
            The four stages as a connected run. A gradient hairline sits
            behind the row on wide screens so they read as one chain rather
            than four adjacent cards. Four bordered boxes in a row was the
            arrangement that made this look generated.
          */}
          {/*
            Stages left, the record shape right.

            The prose claims linkage; the diagram beside it shows the
            linkage. Putting them side by side is the whole point, because
            each one is weak alone: the stages without the chain are five
            abstractions, and the chain without the stages is a schema with
            no narrative.
          */}
          <div className="grid gap-x-16 gap-y-12 lg:grid-cols-12">
            <ol className="relative lg:col-span-7">
              {/* A spine down the stages, so they read as one run. */}
              <div
                aria-hidden="true"
                className="absolute bottom-6 left-5 top-6 w-px bg-gradient-to-b from-transparent via-white/12 to-transparent"
              />
              {LIFECYCLE.map(({ icon: Icon, stage, record, line }, i) => (
                <li key={stage} className="relative flex gap-5 pb-9 last:pb-0">
                  <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#070b16] ring-1 ring-inset ring-white/10">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary-500/20 to-violet-500/10"
                    />
                    <Icon className="relative h-[18px] w-[18px] text-primary-300" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 pt-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[11px] font-semibold tabular-nums tracking-[0.12em] text-primary-400/70">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="text-[15px] font-semibold tracking-tight text-white">{stage}</h3>
                      <span className="rounded bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-slate-400 ring-1 ring-inset ring-white/[0.08]">
                        {record}
                      </span>
                    </div>
                    <p className="mt-2 max-w-[52ch] text-[13px] leading-[1.75] text-slate-400">{line}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="lg:col-span-5">
              <RecordChain />
            </div>
          </div>
        </Section>

        {/* ── 2. The problem ──────────────────────────────────────────────── */}
        <Section
          id="problem"
          label="The problem"
          title="The reasoning behind a decision is the first thing a firm loses"
          lead="Investment organizations have research, market data, spreadsheets, notes, chat and trading systems. What they rarely have is one durable record of why a position was taken."
        >
          <div className="grid gap-x-16 gap-y-10 sm:grid-cols-2">
            {PROBLEMS.map(([h, p], i) => (
              <div key={h}>
                <div className="flex items-baseline gap-3">
                  <span className="text-[11px] font-semibold tabular-nums tracking-[0.12em] text-primary-400/70">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-[15px] font-semibold tracking-tight text-white">{h}</h3>
                </div>
                <p className="mt-2.5 max-w-[50ch] pl-[calc(0.75rem+1.4em)] text-[14px] leading-[1.75] text-slate-400">
                  {p}
                </p>
              </div>
            ))}
          </div>

          {/* The consequence, pulled out larger: it is the argument. */}
          <p className="mt-16 max-w-[68ch] text-pretty text-xl leading-[1.6] tracking-[-0.01em] text-slate-200 sm:text-2xl">
            A team that cannot reconstruct its own reasoning cannot tell a
            correct call from a lucky one, cannot separate a thesis that played
            out from a thesis that was never tested, and cannot hand a name from
            one analyst to the next without starting again.
          </p>
        </Section>

        {/* ── 4. The product ─────────────────────────────────────────────── */}
        <Section
          id="product"
          label="The product"
          title="One workspace, built around the security and the decision"
          lead="Analysts work where the name lives. PMs decide from a queue that shows them the frozen case, not a forwarded document. The record assembles itself as a side effect of the work."
        >
          {/*
            A surface index, not six empty windows.

            This was six identical panels, each imitating a product frame
            and each repeating the same twelve-word placeholder disclaimer.
            Six boxes drawn around nothing, saying "nothing here" six times,
            is the most unfinished-looking thing a page can do, and it was
            the element that kept reading as generated however the rest was
            tuned.

            The information is the same and the honesty is the same. The
            disclaimer is stated ONCE, clearly, at the section level where it
            belongs, instead of being tiled. A reader learns what the product
            contains from a dense index far faster than from six frames they
            have to scan individually.
          */}
          <div className="grid gap-x-16 gap-y-0 sm:grid-cols-2">
            {SURFACES.map(([title, shows], i) => (
              <div
                key={title}
                className="group border-t border-white/[0.07] py-7 transition-colors first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] tabular-nums text-primary-400/60">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-[15px] font-semibold tracking-tight text-white">{title}</h3>
                </div>
                <p className="mt-2 max-w-[50ch] pl-[calc(0.75rem+1.9em)] text-[13px] leading-[1.75] text-slate-400">
                  {shows}
                </p>
              </div>
            ))}
          </div>

          {/* The disclosure, once, where it reads as a position rather than
              as six captions. */}
          <div className="mt-12 flex max-w-[72ch] gap-4 rounded-xl bg-white/[0.02] p-5 ring-1 ring-inset ring-white/[0.07]">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500"
            />
            <p className="text-[13px] leading-[1.75] text-slate-400">
              <span className="font-semibold text-slate-200">
                No product screenshots appear on this page.
              </span>{' '}
              Captures are pending rather than mocked up, and nothing above is a
              rendering of a feature. We would rather walk you through the live
              product on a scheduled call than publish an illustration of it.
            </p>
          </div>
        </Section>

        {/* ── 5. Institutional memory ────────────────────────────────────── */}
        <Section
          id="memory"
          label="Institutional memory"
          title="The firm's accumulated decisions as an asset it owns"
          lead="Every investment organization can buy the same market data. What cannot be bought is a connected history of this firm's own judgement: what it considered, what it chose, what it declined, and what it learned."
        >
          <div className="grid gap-x-16 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {MEMORY.map(([Icon, h, p]) => {
              const I = Icon as typeof Lock
              return (
                <div key={h}>
                  <I className="h-[18px] w-[18px] text-primary-300" aria-hidden="true" />
                  <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-white">{h}</h3>
                  <p className="mt-2.5 max-w-[44ch] text-[14px] leading-[1.75] text-slate-400">{p}</p>
                </div>
              )
            })}
          </div>
          <p className="mt-14 max-w-[64ch] text-[13px] leading-[1.75] text-slate-500">
            Tesseract makes a firm's reasoning retrievable. It does not promise
            better returns, and no part of this platform should be read as a
            forecast of investment performance.
          </p>
        </Section>

        {/* ── 6. ACT AI ──────────────────────────────────────────────────── */}
        <Section
          id="act-ai"
          label="ACT AI"
          title="A contextual assistant that reads your firm's record, not the internet"
          lead="ACT AI is the intelligence layer over the decision corpus. Its value comes from the fact that the corpus is typed and linked: it can answer questions about your own research and decisions because those are records, not a folder of documents."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className={`${GLASS} p-7`}>
              <div className="flex items-center justify-between gap-4">
                <h3 className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white">
                  <Sparkles className="h-[17px] w-[17px] text-primary-300" aria-hidden="true" />
                  Running today
                </h3>
                <Status kind="now" />
              </div>
              <ul className="mt-6 space-y-3.5">
                {[
                  'Conversational assistant inside the workspace, with the current security and portfolio as context.',
                  "Retrieval over the firm's own research, ideas, recommendations and decision records.",
                  'Answers that cite the records they came from, so a claim can be checked.',
                ].map(t => <Bullet key={t}>{t}</Bullet>)}
              </ul>
            </div>

            <div className="rounded-2xl p-7 ring-1 ring-inset ring-white/[0.07]">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-[15px] font-semibold tracking-tight text-white">Not yet built</h3>
                <Status kind="planned" />
              </div>
              <ul className="mt-6 space-y-3.5">
                {[
                  'Platform-provisioned AI with per-organization budgets and usage accounting. Today the assistant runs on a key your firm supplies.',
                  'Proactive surfacing of a prior decision when a similar one comes up.',
                  'Firm-level pattern analysis across decisions and outcomes.',
                ].map(t => <Bullet key={t}>{t}</Bullet>)}
              </ul>
            </div>
          </div>
          <p className="mt-8 max-w-[64ch] text-[13px] leading-[1.75] text-slate-500">
            ACT AI assists the people who make the decisions. It does not manage
            portfolios, place orders, or produce recommendations on its own
            authority.
          </p>
        </Section>

        {/*
          ── 7. Become a design partner ──────────────────────────────────────

          This was a wall of information: a four-item benefits grid beside a
          three-bullet panel headed "What we are honest about up front". The
          section whose job is to convert was the densest on the page, and it
          led with caveats.

          It is now an invitation: who we are looking for, one line of scope,
          one action. The candour it used to carry has not been dropped from
          the page; it lives in the hero, in the ACT AI split and in the
          footer, which is where a reader meets it in context rather than as
          a list of reasons to hesitate. See the file header.
        */}
        <section id="partners" className="relative">
          <div
            aria-hidden="true"
            className={`${SHELL} h-px bg-gradient-to-r from-transparent via-white/10 to-transparent`}
          />
          <div className={`${SHELL} py-24 sm:py-32`}>
            <div className={`${GLASS} overflow-hidden px-8 py-14 sm:px-14 sm:py-20`}>
              {/* A soft accent field inside the panel, so the page's most
                  important block is also its most luminous. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'radial-gradient(40rem 20rem at 50% -20%, rgba(99,102,241,0.18), transparent 65%)',
                }}
              />
              <div className="relative mx-auto max-w-3xl text-center">
                <Eyebrow>
                  <span className="sr-only">Section: </span>Founding design partners
                </Eyebrow>
                <h2 className="mt-6 text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-5xl">
                  Become a founding design partner
                </h2>
                <p className="mx-auto mt-6 max-w-[58ch] text-[17px] leading-[1.7] text-slate-300">
                  We are working with a small number of investment teams to shape
                  how Tesseract reaches the institutional market. You get the
                  product modelled around your own recommendation and decision
                  process, and direct say over what gets built next.
                </p>
                <p className="mx-auto mt-5 max-w-[58ch] text-[13px] leading-[1.75] text-slate-500">
                  A guided evaluation with us in the room. This is not an offer
                  of unrestricted production access.
                </p>

                <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                  {partnerHref ? (
                    <a
                      href={partnerHref}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-black/30 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b16]"
                    >
                      Become a design partner
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : (
                    /* No guessed address, and no button that goes nowhere. */
                    <div
                      data-testid="contact-unconfigured"
                      className="mx-auto max-w-md rounded-lg px-5 py-4 text-left text-[13px] text-slate-400 ring-1 ring-inset ring-white/15"
                    >
                      <p className="font-semibold text-slate-200">Contact route not configured</p>
                      <p className="mt-1.5 leading-[1.75]">
                        This deployment has no contact address set, so there is no
                        button here yet. Set{' '}
                        <code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-slate-200">
                          VITE_ACCESS_REQUEST_EMAIL
                        </code>{' '}
                        to turn the demo and partnership requests on across the site.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 8. Closing CTA ─────────────────────────────────────────────── */}
        <section id="contact" className="relative">
          <div
            aria-hidden="true"
            className={`${SHELL} h-px bg-gradient-to-r from-transparent via-white/10 to-transparent`}
          />
          <div className={`${SHELL} py-24 sm:py-32`}>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-5xl">
                See the decision loop on a real security
              </h2>
              <p className="mx-auto mt-6 max-w-[56ch] text-[17px] leading-[1.7] text-slate-400">
                Thirty minutes, one name, start to finish: research, a
                recommendation, a portfolio-manager decision, and the record it
                leaves behind.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <a href={demoHref ?? '#partners'} className={BTN_PRIMARY}>
                  Request a demo
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <Link to="/login" className={BTN_GHOST}>
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="border-t border-white/[0.06]">
          <div className={`${SHELL} py-12`}>
            <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
              <div>
                {/* The mark's third and smallest appearance, closing the page. */}
                <div className="flex items-center gap-2.5">
                  <TesseractLogo size={22} />
                  <span className="text-[14px] font-semibold tracking-[-0.01em] text-white">Tesseract</span>
                </div>
                <p className="mt-3 text-[13px] text-slate-500">
                  A decision operating system for investment teams.
                </p>
              </div>
              <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-2 text-[13px] text-slate-500">
                <a href="#lifecycle" className="transition-colors hover:text-white">How it works</a>
                <a href="#product" className="transition-colors hover:text-white">Product</a>
                <a href="#partners" className="transition-colors hover:text-white">Design partners</a>
                <Link to="/login" className="transition-colors hover:text-white">Sign in</Link>
              </nav>
            </div>
            <p className="mt-10 border-t border-white/[0.06] pt-6 text-[12px] leading-[1.75] text-slate-600">
              Pre-release. Nothing on this page is an offer of securities, investment advice, or a performance representation.
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default LandingPage
