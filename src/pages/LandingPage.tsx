import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, BookOpen, FileSignature, Gavel, History,
  Layers, LineChart, Lock, ShieldCheck, Sparkles, Users,
} from 'lucide-react'
import { TesseractLogo } from '../components/ui/TesseractLogo'
import { TesseractMark } from '../components/ui/TesseractMark'
import { hideBootLoader } from '../lib/boot-loader'

/**
 * The public front door.
 *
 * ── What was here before ─────────────────────────────────────────────────
 *
 * Nothing. `/` redirected to `/login` when there was no session and to
 * `/dashboard` when there was, so every visitor who had not already been
 * invited met a password box with no explanation of what it was for. There
 * was no page a prospective investment team or investor could be sent.
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
 * differentiator: the connected record of why decisions were made. Every
 * forward-looking capability is marked as planned, in the same typeface as
 * everything else, not in a footnote.
 *
 * No invented customers, logos, statistics, testimonials or metrics appear
 * on this page, and none should ever be added to it. There are no customers
 * yet; the design-partner section is the honest version of social proof.
 *
 * ── The visual system, and what was wrong with the first pass ────────────
 *
 * The first version read as templated, and the reasons were structural
 * rather than a matter of taste:
 *
 *  1. SIX surface changes down the page (white, tint, dark, tint, dark,
 *     white, light footer). Alternating bands are what a section-per-block
 *     generator produces. There are now TWO: one dark block carrying the
 *     hero and the lifecycle, one light body, closing dark. Sections inside
 *     the body are separated by a hairline, not a change of background.
 *  2. NO SCALE CONTRAST. The hero was `text-3xl sm:text-5xl` and every
 *     section head was `text-2xl sm:text-3xl`, so nine headings competed at
 *     roughly one size and nothing led. The hero now runs to `text-7xl` and
 *     section heads sit a full step below it.
 *  3. A COLORED UPPERCASE KICKER ON ALL EIGHT SECTIONS. Repeated eight
 *     times an accent stops being an accent. Kept where it orients the
 *     reader, dropped elsewhere.
 *  4. LONG MEASURE. Body copy ran to `max-w-3xl` inside a `max-w-6xl`
 *     column, which is around 100 characters a line. Prose is now capped in
 *     `ch`, so it wraps where it reads rather than where the grid ends.
 *  5. FAKE WINDOW CHROME. Each placeholder carried three grey circles
 *     imitating a title bar, around an empty box. Imitation chrome around
 *     nothing is the single cheapest-looking motif available, and it was
 *     repeated six times. The frames are now flat, titled panels.
 *  6. A BORDER ON EVERYTHING. `border-l-2` lists inside bordered cards
 *     inside tinted sections. Hierarchy now comes from space and weight,
 *     and a rule is drawn only where something genuinely divides.
 *
 * The brand mark is the one ornament, used three times at three scales: the
 * nav, a large still figure behind the hero, and the footer. It replaces the
 * generic blue radial that was the hero's only accent.
 *
 * ── The mark is `TesseractLogo`, never `TesseractLoader` ──────────────────
 *
 * The nav originally mounted `TesseractLoader`, which is a LOADING
 * INDICATOR: it renders the mark plus the word "Loading..." and turns
 * continuously at 4.5s. On a landing page that put the text "Loading..."
 * under the navigation bar permanently, and gave the page a logo that never
 * stopped moving.
 *
 * `TesseractLogo` is the same geometry configured as a logo: still at rest,
 * turning only under a pointer at 15s, with `showNodes={false}` and a
 * lighter stroke. Its own comments explain why that combination matters at
 * small sizes, in the same words a reader of this page used: sixteen dots
 * and a heavy stroke on a ~24px glyph close up the gaps between the lines
 * and it reads as a blob.
 *
 * ── Performance ──────────────────────────────────────────────────────────
 *
 * Lazily routed from `App.tsx` so none of this reaches the authenticated
 * entry chunk, which is a lane this codebase has already paid for once
 * (the 8,950 kB entry chunk). No images, no new dependencies, no web
 * fonts: the only graphic is the brand mark the app already draws, and the
 * lifecycle diagram is laid out with CSS.
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

/**
 * A body section.
 *
 * Asymmetric header: the title holds the left column and the lead sits in
 * the right, which is the layout that stops a long page reading as a stack
 * of identical slabs. Below `lg` it collapses to one column in reading
 * order, so the structure is a wide-screen affordance rather than a
 * requirement.
 *
 * `divide` draws the hairline that separates body sections, instead of the
 * alternating background tints this page used to change on every block.
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
    <section
      id={id}
      className={divide ? 'border-t border-slate-200/80 dark:border-slate-800' : undefined}
    >
      <div className={`${SHELL} py-20 sm:py-28`}>
        <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            {label && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-400">
                {label}
              </p>
            )}
            <h2
              className={`text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-slate-900 sm:text-4xl dark:text-white ${
                label ? 'mt-4' : ''
              }`}
            >
              {title}
            </h2>
          </div>
          {lead && (
            <div className="lg:col-span-5 lg:pt-2">
              <p className="max-w-[56ch] text-[15px] leading-[1.7] text-slate-600 dark:text-slate-400">
                {lead}
              </p>
            </div>
          )}
        </div>
        {children && <div className="mt-14 sm:mt-16">{children}</div>}
      </div>
    </section>
  )
}

/**
 * A product surface, named rather than shown.
 *
 * Authentic screenshots are not committed to this repository. The only
 * tenant with data in it is a synthetic QA organization, and two of the
 * surfaces a deck would most want to show (Outcomes attribution, execution
 * provenance) have fixes sitting in unmerged PRs. A screenshot taken today
 * would therefore show numbers we know to be wrong, presented as product.
 *
 * So each frame states what belongs in it and that the capture is pending.
 * A reviewer can see exactly what is missing, and nobody can mistake a
 * placeholder for a feature. `docs/commercial/demo-checklist.md` lists the
 * captures to take and the conditions each one needs.
 *
 * What changed in the visual pass: the three grey circles imitating a macOS
 * title bar are gone. Fake window chrome drawn around an empty box asks to
 * be read as a screenshot and then isn't one, which is worse than an
 * honest panel. The surface name now carries the frame, the pending note is
 * demoted to a footnote where it belongs, and the hairline is the only
 * decoration.
 */
function ProductShot({ title, shows }: { title: string; shows: string }) {
  return (
    <figure className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-6 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-700">
      <figcaption className="text-[13px] font-semibold tracking-tight text-slate-900 dark:text-white">
        {title}
      </figcaption>
      <p className="mt-3 flex-1 text-[13px] leading-[1.65] text-slate-600 dark:text-slate-400">
        {shows}
      </p>
      <p className="mt-5 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Product capture pending. This frame is a placeholder, not a rendering of the feature.
      </p>
    </figure>
  )
}

/**
 * A status marker that distinguishes what runs from what is planned.
 *
 * One per card header now, rather than repeated beside every bullet. The
 * same badge printed three times in a six-item list stops being read.
 */
function Status({ kind }: { kind: 'now' | 'planned' }) {
  const now = kind === 'now'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight ${
        now
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${now ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {now ? 'Available now' : 'Planned'}
    </span>
  )
}

/** A quiet bullet, so a list needs no border and no icon per row. */
function Bullet({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <li className="flex gap-3.5">
      <span
        aria-hidden="true"
        className={`mt-[9px] h-1 w-1 shrink-0 rounded-full ${dark ? 'bg-slate-600' : 'bg-slate-300 dark:bg-slate-600'}`}
      />
      <span
        className={`text-[14px] leading-[1.7] ${
          dark ? 'text-slate-400' : 'text-slate-600 dark:text-slate-400'
        }`}
      >
        {children}
      </span>
    </li>
  )
}

/* ──────────────────────────────── the page ──────────────────────────────── */

const LIFECYCLE = [
  {
    icon: BookOpen,
    stage: 'Research',
    line: 'The written case, its evidence and its revisions, attached to the security rather than to a folder.',
  },
  {
    icon: FileSignature,
    stage: 'Recommend',
    line: 'An analyst puts a view forward. The reasoning behind it is frozen at submission, so what the PM read is what the record keeps.',
  },
  {
    icon: Gavel,
    stage: 'Decide',
    line: 'The PM accepts, rejects or defers, with the rationale captured as part of the decision instead of in a reply to a message.',
  },
  {
    icon: History,
    stage: 'Review',
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

const PARTNER_OFFER: [string, string][] = [
  ['Early access to a defined evaluation', 'A scoped walkthrough and a structured trial of the decision workflow, with us in the room.'],
  ['Direct input into priorities', 'The sequence of what gets built next, decided with the desks that will use it.'],
  ['Collaboration on workflows', 'Your recommendation and decision process, modelled properly rather than approximated.'],
  ['A path to becoming an early commercial partner', 'Preferential terms when the commercial release is ready, on terms agreed in writing at that point.'],
]

/** Primary and secondary button classes, so every CTA matches exactly. */
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2'
const BTN_ON_DARK =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-100 transition-colors hover:border-white/30 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950'

export function LandingPage() {
  const markRef = useRef<HTMLDivElement>(null)

  /*
   * Release the static boot loader.
   *
   * `#tesseract-boot-loader` is painted by index.html OUTSIDE `#root` at
   * `position: fixed`, `inset: 0`, `z-index: 2147483647`, with an opaque
   * background, and React's mount deliberately does not remove it. It stops
   * covering the page only once something adds `.is-fading`, which is what
   * `hideBootLoader()` does — and `pointer-events: none` lives in that class,
   * so until then the overlay also swallows every click.
   *
   * `/` for a signed-out visitor renders this page and nothing else.
   * `ProtectedRoute` never runs for a public route, and this page is not
   * inside `AuthLayout`, so NEITHER existing caller of `hideBootLoader()`
   * fires. Without this the page rendered correctly and was then covered by
   * "Loading…" indefinitely on every cold load.
   *
   * That is the identical defect AuthLayout was fixed for; its comment notes
   * it was moved into the layout so the next public route could not
   * reintroduce it. This route is outside that layout, so it has to call it
   * itself. Idempotent, and a no-op when the overlay is absent.
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
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/*
        ── The dark block: nav, hero and lifecycle ────────────────────────
        One continuous dark surface rather than a dark nav sitting on a
        white hero. The nav is transparent and inherits it, so there is no
        seam at the top of the page and no border to draw.
      */}
      <div className="relative isolate overflow-hidden bg-slate-950">
        {/*
          The brand mark as the hero's accent, at rest.

          It replaces a generic blue radial gradient. A large still figure
          of the actual mark is both quieter and more specific than a glow,
          and it is the same geometry as the nav logo, so the page has one
          ornament at three scales instead of an unrelated decoration.

          Held static deliberately: motion belongs to hover. The `fill` and
          weight are tuned the way `TesseractLogo` documents for legibility
          rather than left at the loader's defaults.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 hidden opacity-[0.07] md:block lg:-right-16 lg:top-0"
        >
          <TesseractMark size={620} periodMs={15000} animate={false} weight={1} fill={1.25} showNodes={false} />
        </div>
        {/* A single soft lift behind the copy, so the text never sits on bare black. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(70rem 36rem at 15% -20%, rgba(96,165,250,0.10), transparent 65%)' }}
        />

        <header className="relative">
          <nav className={`${SHELL} flex items-center justify-between py-5`} aria-label="Main">
            <a href="#top" className="group flex items-center gap-3 text-white">
              {/*
                `TesseractLogo`, not `TesseractLoader`. The loader renders the
                word "Loading..." beneath the mark and turns continuously; as
                a nav logo that printed "Loading" under the navigation bar
                permanently and never stopped moving. This one is still at
                rest and turns only under a pointer.
              */}
              <div ref={markRef} className="shrink-0">
                <TesseractLogo size={30} />
              </div>
              <span className="text-[15px] font-semibold tracking-[-0.01em]">Tesseract</span>
            </a>
            <div className="flex items-center gap-1 sm:gap-2">
              <a
                href="#lifecycle"
                className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-slate-300 transition-colors hover:text-white sm:block"
              >
                How it works
              </a>
              <a
                href="#product"
                className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-slate-300 transition-colors hover:text-white md:block"
              >
                Product
              </a>
              <a
                href="#partners"
                className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-slate-300 transition-colors hover:text-white sm:block"
              >
                Design partners
              </a>
              <Link
                to="/login"
                className="ml-1 rounded-lg border border-white/15 px-3.5 py-2 text-[13px] font-semibold text-slate-100 transition-colors hover:border-white/30 hover:bg-white/5"
              >
                Sign in
              </Link>
            </div>
          </nav>
        </header>

        {/* ── 1. Hero ───────────────────────────────────────────────────── */}
        <section id="top" className={`${SHELL} relative pb-24 pt-20 sm:pb-32 sm:pt-28`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-300">
            A decision operating system for investment teams
          </p>

          {/*
            The hero is the only element on the page allowed this much size.
            It was `text-3xl sm:text-5xl` against section heads at
            `text-2xl sm:text-3xl`, which is not enough separation to lead a
            page. The second line is held quieter so the sentence has a
            subject and a turn rather than two equal shouts.
          */}
          <h1 className="mt-6 max-w-[20ch] text-pretty text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
            Every investment decision has a story.
            <span className="mt-2 block text-slate-500">Make sure your firm remembers it.</span>
          </h1>

          <p className="mt-9 max-w-[62ch] text-lg leading-[1.65] text-slate-300">
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
            <a href="#lifecycle" className={BTN_ON_DARK}>
              Explore the platform
            </a>
          </div>

          {/*
            Said on the hero, not buried. A PM who learns this at minute
            forty of a demo has spent forty minutes on the wrong question.

            Given a rule and a narrow measure so it reads as a deliberate
            statement of scope rather than as small print trailing the
            buttons, which is how it read when it was another grey paragraph.
          */}
          <p className="mt-14 max-w-[64ch] border-l border-white/15 pl-5 text-[13px] leading-[1.75] text-slate-400">
            Tesseract is an early-stage institutional platform with a working
            core workflow. It is not a market-data terminal, an execution
            system, or a replacement for the tools your desk already runs. It
            is the layer that remembers why you did what you did.
          </p>
        </section>

        {/* ── 3. The connected decision lifecycle ───────────────────────── */}
        <section id="lifecycle" className="relative border-t border-white/10">
          <div className={`${SHELL} py-20 sm:py-28`}>
            <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-300">
                  The connected decision lifecycle
                </p>
                <h2 className="mt-4 text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl">
                  Research, recommend, decide, review. Linked, not filed.
                </h2>
              </div>
              <div className="lg:col-span-5 lg:pt-2">
                <p className="max-w-[56ch] text-[15px] leading-[1.7] text-slate-400">
                  Each stage in Tesseract is a typed record that points at the
                  one before it. That linkage is the product. It is what makes
                  a decision reviewable a year later rather than merely
                  archived.
                </p>
              </div>
            </div>

            {/*
              The four stages as a connected run.

              A hairline runs behind the row on wide screens, so the stages
              read as one chain rather than four cards that happen to be
              adjacent. The index is the anchor at the left of each step;
              the boxed-card treatment is gone, because four bordered boxes
              in a row is the arrangement that made this look generated.
            */}
            <ol className="relative mt-14 grid gap-x-10 gap-y-12 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
              <div
                aria-hidden="true"
                className="absolute left-0 right-0 top-[15px] hidden h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent lg:block"
              />
              {LIFECYCLE.map(({ icon: Icon, stage, line }, i) => (
                <li key={stage} className="relative">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 ring-1 ring-inset ring-white/10">
                      <Icon className="h-4 w-4 text-primary-300" aria-hidden="true" />
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums tracking-[0.12em] text-slate-600">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="mt-5 text-[15px] font-semibold tracking-tight text-white">{stage}</h3>
                  <p className="mt-2.5 max-w-[42ch] text-[13px] leading-[1.7] text-slate-400">{line}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      {/* ── 2. The problem ──────────────────────────────────────────────── */}
      <Section
        id="problem"
        label="The problem"
        title="The reasoning behind a decision is the first thing a firm loses"
        lead="Investment organizations have research, market data, spreadsheets, notes, chat and trading systems. What they rarely have is one durable record of why a position was taken."
        divide={false}
      >
        {/*
          Four points on a two-column grid, each opening with a numeral
          rather than sitting behind a left border. Space and a tabular index
          carry the structure; the borders were doing work that air does
          better, and four of them stacked read as a form.
        */}
        <div className="grid gap-x-16 gap-y-10 sm:grid-cols-2">
          {PROBLEMS.map(([h, p], i) => (
            <div key={h}>
              <div className="flex items-baseline gap-3">
                <span className="text-[11px] font-semibold tabular-nums tracking-[0.12em] text-slate-400 dark:text-slate-600">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{h}</h3>
              </div>
              <p className="mt-2.5 max-w-[50ch] pl-[calc(0.75rem+1.4em)] text-[14px] leading-[1.7] text-slate-600 dark:text-slate-400">
                {p}
              </p>
            </div>
          ))}
        </div>

        {/* The consequence, pulled out at a larger size: it is the argument. */}
        <p className="mt-16 max-w-[68ch] text-pretty text-xl leading-[1.55] tracking-[-0.01em] text-slate-800 sm:text-2xl dark:text-slate-200">
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map(([title, shows]) => (
            <ProductShot key={title} title={title} shows={shows} />
          ))}
        </div>
        <p className="mt-8 max-w-[64ch] text-[13px] leading-[1.7] text-slate-500 dark:text-slate-500">
          Captures are pending rather than mocked up. We would rather show you
          the live product in a scheduled walkthrough than publish a rendering
          of it.
        </p>
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
                <I className="h-[18px] w-[18px] text-primary-600 dark:text-primary-400" aria-hidden="true" />
                <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{h}</h3>
                <p className="mt-2.5 max-w-[44ch] text-[14px] leading-[1.7] text-slate-600 dark:text-slate-400">{p}</p>
              </div>
            )
          })}
        </div>
        <p className="mt-14 max-w-[64ch] text-[13px] leading-[1.7] text-slate-500">
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
          <div className="rounded-xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-center justify-between gap-4">
              <h3 className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
                <Sparkles className="h-[17px] w-[17px] text-primary-600 dark:text-primary-400" aria-hidden="true" />
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

          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-7 dark:border-slate-800 dark:bg-slate-900/20">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
                Not yet built
              </h3>
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
        <p className="mt-8 max-w-[64ch] text-[13px] leading-[1.7] text-slate-500">
          ACT AI assists the people who make the decisions. It does not manage
          portfolios, place orders, or produce recommendations on its own
          authority.
        </p>
      </Section>

      {/* ── 7. Founding design partners ────────────────────────────────── */}
      <section id="partners" className="border-t border-slate-200/80 bg-slate-950 dark:border-slate-800">
        <div className={`${SHELL} py-20 sm:py-28`}>
          <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-300">
                Founding design partners
              </p>
              <h2 className="mt-4 text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl">
                Help shape the next generation of investment decision infrastructure
              </h2>
            </div>
            <div className="lg:col-span-5 lg:pt-2">
              <p className="max-w-[56ch] text-[15px] leading-[1.7] text-slate-400">
                We are selecting a small number of investment teams to evaluate
                Tesseract and shape its institutional rollout. This is a guided
                evaluation and a design partnership, not an offer of
                unrestricted production access.
              </p>
            </div>
          </div>

          <div className="mt-14 grid gap-x-16 gap-y-12 sm:mt-16 lg:grid-cols-12">
            <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:col-span-7">
              {PARTNER_OFFER.map(([h, p]) => (
                <div key={h}>
                  <h3 className="text-[15px] font-semibold tracking-tight text-white">{h}</h3>
                  <p className="mt-2.5 max-w-[44ch] text-[13px] leading-[1.7] text-slate-400">{p}</p>
                </div>
              ))}
            </div>

            {/*
              The honesty panel, and the only place on the page that gets a
              filled card. It is the thing a prospect should actually read,
              so it is the one element allowed to look like a callout.
            */}
            <div className="lg:col-span-5">
              <div className="rounded-xl bg-white/[0.04] p-7 ring-1 ring-inset ring-white/10">
                <h3 className="text-[15px] font-semibold tracking-tight text-white">
                  What we are honest about up front
                </h3>
                <ul className="mt-5 space-y-3.5">
                  <Bullet dark>
                    Commercial market-data licensing for external users is not
                    yet in place. A pilot's price and news coverage is a
                    dependency we are resolving, not a feature we are claiming.
                  </Bullet>
                  <Bullet dark>
                    Platform-provisioned AI is not yet available. ACT AI
                    currently runs on a key your firm supplies.
                  </Bullet>
                  <Bullet dark>
                    This is a pre-release platform. It is not a production
                    deployment with external users on it today.
                  </Bullet>
                </ul>

                <div className="mt-7">
                  {partnerHref ? (
                    <a
                      href={partnerHref}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    >
                      Discuss a design partnership
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : (
                    /* No guessed address, and no button that goes nowhere. */
                    <div
                      data-testid="contact-unconfigured"
                      className="rounded-lg border border-dashed border-white/20 px-5 py-4 text-[13px] text-slate-400"
                    >
                      <p className="font-semibold text-slate-200">Contact route not configured</p>
                      <p className="mt-1.5 leading-[1.7]">
                        This deployment has no contact address set, so there is
                        no button here yet. Set{' '}
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
        </div>
      </section>

      {/* ── 8. Closing CTA ─────────────────────────────────────────────── */}
      <section id="contact" className="border-t border-slate-200/80 dark:border-slate-800">
        <div className={`${SHELL} py-24 sm:py-32`}>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-slate-900 sm:text-5xl dark:text-white">
              See the decision loop on a real security
            </h2>
            <p className="mx-auto mt-6 max-w-[56ch] text-[17px] leading-[1.65] text-slate-600 dark:text-slate-400">
              Thirty minutes, one name, start to finish: research, a
              recommendation, a portfolio-manager decision, and the record it
              leaves behind.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <a href={demoHref ?? '#partners'} className={BTN_PRIMARY}>
                Request a demo
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <div className={`${SHELL} py-12`}>
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              {/* The mark's third and smallest appearance, closing the page. */}
              <div className="flex items-center gap-2.5">
                <TesseractLogo size={22} />
                <span className="text-[14px] font-semibold tracking-[-0.01em] text-slate-900 dark:text-white">
                  Tesseract
                </span>
              </div>
              <p className="mt-3 text-[13px] text-slate-500 dark:text-slate-400">
                A decision operating system for investment teams.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-2 text-[13px] text-slate-500 dark:text-slate-400">
              <a href="#lifecycle" className="transition-colors hover:text-slate-900 dark:hover:text-white">How it works</a>
              <a href="#product" className="transition-colors hover:text-slate-900 dark:hover:text-white">Product</a>
              <a href="#partners" className="transition-colors hover:text-slate-900 dark:hover:text-white">Design partners</a>
              <Link to="/login" className="transition-colors hover:text-slate-900 dark:hover:text-white">Sign in</Link>
            </nav>
          </div>
          <p className="mt-10 border-t border-slate-200 pt-6 text-[12px] leading-[1.7] text-slate-400 dark:border-slate-800 dark:text-slate-500">
            Pre-release. Nothing on this page is an offer of securities, investment advice, or a performance representation.
          </p>
        </div>
      </footer>

    </div>
  )
}

export default LandingPage
