import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeftRight, ArrowRight, BookOpen, Boxes, FileSignature, Gavel, History,
  Layers, LineChart, Link2, ListChecks, Lock, Quote, RotateCcw, ShieldCheck,
  Sparkles, Target, Users,
} from 'lucide-react'
import { TesseractLogo } from '../components/ui/TesseractLogo'
import { TesseractMark } from '../components/ui/TesseractMark'
import { hideBootLoader } from '../lib/boot-loader'

/**
 * The public front door.
 *
 * ── What this page may and may not say ───────────────────────────────────
 *
 * RULE ONE, and it changed: the page describes what the product DOES and
 * says nothing about what is not built yet. An earlier version carried a
 * "Not yet built" column, a "Planned" badge, "early-stage", "pre-release",
 * and a panel announcing that no screenshots existed. All of that is gone
 * by instruction, and none of it should come back.
 *
 * That is NOT a licence to claim things that do not work. The constraint
 * simply moved: where a capability is not real, the capability is OMITTED
 * rather than listed-and-qualified. Platform-provisioned AI, proactive
 * surfacing of prior decisions and firm-level pattern analysis were all
 * removed from the page entirely on that basis, not reworded. If you are
 * tempted to add a feature here, the test is whether a design partner could
 * be shown it working in a thirty-minute call. If not, it does not go on
 * the page in any form, hedged or otherwise.
 *
 * Still absolutely prohibited, and these are not style preferences:
 * invented customers, logos, statistics, testimonials, metrics, valuations
 * or performance figures. There are none on this page. The footer keeps the
 * one line that is a legal necessity rather than a confession: nothing here
 * is an offer of securities, investment advice, or a performance claim.
 *
 * SCOPE POSITIONING IS NOT A CONFESSION. The hero still says Tesseract is
 * not a market-data terminal and not an execution system. That is a
 * statement about what category the product is in, and it is there because
 * a portfolio manager who arrives at a demo expecting a Bloomberg
 * substitute has already decided what this is before the conversation
 * starts. Saying what you are not is how a focused product sells; saying
 * what you have not finished is not. Keep the first, never add the second.
 *
 * ── The visual system ────────────────────────────────────────────────────
 *
 * The brief was that a dark background alone is not interesting. It is not,
 * and the fix is RHYTHM rather than more colour. Four mechanisms, in order
 * of how much they do:
 *
 *  1. ONE LIGHT BAND. The research section inverts to near-white. A long
 *     page in a single value register reads as one undifferentiated surface
 *     no matter how well each section is set, and an inversion halfway down
 *     is the single strongest signal that a human laid the page out. It is
 *     deliberately the section about capture, because that is the part of
 *     the product a reader is most likely to actually touch. Its palette is
 *     self-contained, with a gradient transition at both edges so the
 *     change arrives rather than cuts.
 *  2. TEXTURE. A fixed dot grid at 1.5% opacity over the whole dark page.
 *     Invisible as a pattern, decisive as a surface: it gives the
 *     background a material instead of a value.
 *  3. PER-SECTION ACCENT. Each band carries its own hue on its eyebrow
 *     rule and icons (blue, violet, cyan, emerald), so the page progresses
 *     instead of repeating. The hues are all from Tailwind's default
 *     palette; no dependency and no config change.
 *  4. DEPTH, not borders. Surfaces separate by translucency and a 1px
 *     inner highlight rather than by a box outline.
 *
 * THEME INDEPENDENT. No `dark:` variants anywhere in this file, on purpose.
 * `tailwind.config.js` sets `darkMode: 'class'` and a signed-out visitor has
 * no app theme applied, so every `dark:` style on the first version was dead
 * and the page always rendered its LIGHT branch. That is the actual reason
 * it read as under-coloured. A public page must also look identical for
 * every visitor regardless of the theme they last used inside the app.
 *
 * ── The mark is `TesseractLogo`, never `TesseractLoader` ─────────────────
 *
 * `TesseractLoader` is a LOADING INDICATOR: it renders the mark plus the
 * word "Loading..." and turns continuously at 4.5s. Mounted as the nav logo
 * it printed "Loading..." under the navigation bar permanently and never
 * stopped moving. `TesseractLogo` is the same geometry configured as a
 * logo: still at rest, turning only under a pointer at 15s, with
 * `showNodes={false}` and a lighter stroke, which its own comments explain
 * is what keeps a small mark from reading as a blob.
 *
 * ── Performance ──────────────────────────────────────────────────────────
 *
 * Lazily routed from `App.tsx` so none of this reaches the authenticated
 * entry chunk, a lane this codebase has already paid for once (the 8,950 kB
 * entry chunk). No images, no new dependencies, no web fonts: the only
 * graphic is the brand mark the app already draws, and every layout, every
 * texture and every diagram is CSS or inline SVG.
 */

/* ──────────────────────────── where requests go ──────────────────────────── */

/**
 * Two seams, one fallback, and NO leaked configuration.
 *
 * ── Why this was changed ─────────────────────────────────────────────────
 *
 * The previous version rendered, to any visitor, a panel reading "Contact
 * route not configured. Set VITE_ACCESS_REQUEST_EMAIL to turn the demo and
 * partnership requests on across the site." That is an internal deployment
 * note printed on the public front door. It is the single worst thing that
 * was on this page: it tells a prospective customer that nobody finished
 * setting the site up.
 *
 * ── The order, and why ───────────────────────────────────────────────────
 *
 *  1. `VITE_ACCESS_REQUEST_URL` wins if set: an external intake form
 *     (Typeform, Tally, a Google Form). This is the chosen route. A form
 *     exposes no address to scrapers, filters spam, and returns structured
 *     responses instead of free-text email.
 *  2. `VITE_ACCESS_REQUEST_EMAIL` is the existing variable, already read by
 *     the login page's `EarlyAccessNotice`. Kept so one address still
 *     governs every inbound path if a mailbox is preferred later.
 *  3. Otherwise the buttons go to `/login`, which is a REAL working page
 *     with a real access-request path on it. A visitor reaches somewhere
 *     that functions, the label changes to match the destination, and
 *     nothing on the page says anything about configuration.
 *
 * No address is ever guessed. `sales@tesseract.com` appears hard-coded in
 * `AIConfigurationSection` and is NOT used here: that domain is not ours.
 *
 * `data-contact-mode` carries which branch rendered, so the test suite can
 * assert the fallback without any of it being visible to a visitor.
 */
const CONTACT_URL = import.meta.env.VITE_ACCESS_REQUEST_URL as string | undefined
const CONTACT_EMAIL = import.meta.env.VITE_ACCESS_REQUEST_EMAIL as string | undefined

type ContactMode = 'form' | 'email' | 'signin'

const CONTACT_MODE: ContactMode = CONTACT_URL ? 'form' : CONTACT_EMAIL ? 'email' : 'signin'

function contactHref(subject: string): string {
  if (CONTACT_URL) return CONTACT_URL
  if (CONTACT_EMAIL) return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
  return '/login'
}

const DEMO_SUBJECT = 'Tesseract demo request'
const PARTNER_SUBJECT = 'Tesseract design partnership'

/**
 * One CTA component for every call to action on the page.
 *
 * It resolves the destination, picks the label to match it, and renders a
 * router `<Link>` for the internal fallback but a plain `<a>` for an
 * external form or a mailto, because a `<Link>` to an off-site URL would be
 * pushed onto the SPA history and render nothing.
 */
function ContactCta({
  subject, label, className, children,
}: {
  subject: string
  label: string
  className: string
  children?: React.ReactNode
}) {
  const href = contactHref(subject)
  const text = CONTACT_MODE === 'signin' ? 'Request access' : label
  const body = (
    <>
      {text}
      {children ?? <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </>
  )
  if (CONTACT_MODE === 'signin') {
    return (
      <Link to={href} className={className} data-contact-mode={CONTACT_MODE}>
        {body}
      </Link>
    )
  }
  return (
    <a
      href={href}
      className={className}
      data-contact-mode={CONTACT_MODE}
      {...(CONTACT_MODE === 'form' ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {body}
    </a>
  )
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

/**
 * Per-section accent.
 *
 * A long page where every section is the same blue reads as one section
 * repeated. Each band gets its own hue on the eyebrow rule and its icons,
 * which is enough to make the page feel like it progresses without
 * introducing a second design language. All four are Tailwind defaults.
 */
const ACCENTS = {
  blue: { rule: 'from-primary-400 to-violet-400', icon: 'text-primary-300', num: 'text-primary-400/70' },
  violet: { rule: 'from-violet-400 to-fuchsia-400', icon: 'text-violet-300', num: 'text-violet-400/70' },
  cyan: { rule: 'from-cyan-400 to-primary-400', icon: 'text-cyan-300', num: 'text-cyan-400/70' },
  emerald: { rule: 'from-emerald-400 to-cyan-400', icon: 'text-emerald-300', num: 'text-emerald-400/70' },
} as const

type Accent = keyof typeof ACCENTS

/** An eyebrow label with a short accent rule, instead of flat coloured caps. */
function Eyebrow({ children, accent = 'blue' }: { children: React.ReactNode; accent?: Accent }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={`h-px w-8 bg-gradient-to-r ${ACCENTS[accent].rule}`} />
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
  id, label, title, lead, children, divide = true, accent = 'blue',
}: {
  id: string
  label?: string
  title: string
  lead?: string
  children?: React.ReactNode
  divide?: boolean
  accent?: Accent
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
            {label && <Eyebrow accent={accent}>{label}</Eyebrow>}
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
 * `Bullet` was removed here. It rendered one row of the ACT AI section's
 * two-column "Running today" / "Not yet built" lists, and both of those
 * lists are gone: the first became three described capability cards, and
 * the second was deleted from the page entirely rather than reworded. With
 * no bulleted list left anywhere on the page the component had no caller.
 */

/* ─────────────────────────────── the diagram ─────────────────────────────── */

/**
 * The linkage, drawn.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * The page's central claim is "typed records that point at the one before
 * it, linked rather than filed". Every earlier version asserted that in
 * prose and then showed six empty placeholder boxes. A reader had no way to
 * see the thing being claimed, which is the real reason the page read as
 * generated: it described a mechanism it never demonstrated.
 *
 * ── Why it is not a fabrication, and why it is not a screenshot ─────────
 *
 * This is a SCHEMA. It names the row each stage writes and the field that
 * carries the reference to the row before it. There are no prices, no
 * tickers, no names, no numbers, no invented data of any kind, and nothing
 * here imitates product chrome, so there is nothing to mistake it for. A
 * structural diagram of our own data model invents nothing.
 *
 * It also carries the argument the prose cannot: the arrow from the review
 * back to the research note is the reason this is a lifecycle and not a
 * list, and the violet marker is where the differentiator lives.
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
          Record shape
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

/* ──────────────────────────────── content ──────────────────────────────── */

/**
 * The lifecycle, complete and deepened.
 *
 * It ran Research, Recommend, Decide, Review and stopped, which skipped
 * from a PM saying yes straight to grading the outcome. Two stages were
 * missing and both carry the argument:
 *
 *  - EXECUTE. A decision that never reaches the book is not a decision the
 *    firm acted on. `accepted_trades` is the only object in this system
 *    that represents a committed trade, and the record carries whether the
 *    fill was assumed from the approval or confirmed against holdings.
 *  - The RETURN. The review is the input to the next decision on that name.
 *    A lifecycle drawn as a line that stops implies a filing system.
 *
 * Each stage now carries three things rather than one sentence, because
 * "shows more on each aspect of the lifecycle" was the brief and because a
 * one-line stage is an assertion while a stage with a record, a captured
 * field and a stated consequence is an explanation:
 *
 *   `record`  the typed row the stage writes, which `RecordChain` draws
 *   `line`    what happens at this stage
 *   `keeps`   what is retained that would otherwise be lost
 *   `so`      the consequence a year later, which is the actual pitch
 */
const LIFECYCLE = [
  {
    icon: BookOpen,
    stage: 'Research',
    record: 'Research note',
    line: 'The written case, its evidence and its revisions live on the security itself rather than in a folder, a drive or a thread.',
    keeps: 'Every revision, with the author and the moment of each change.',
    so: 'The version that justified the position is still readable after the note has moved on six times.',
  },
  {
    icon: FileSignature,
    stage: 'Recommend',
    record: 'Recommendation',
    line: 'An analyst puts a view forward with its conviction, its sizing and its target, and submission freezes the reasoning behind it.',
    keeps: 'The case exactly as the portfolio manager received it, pinned as a version.',
    so: 'Nobody has to argue later about which draft was the one that got approved.',
  },
  {
    icon: Gavel,
    stage: 'Decide',
    record: 'Decision',
    line: 'The portfolio manager accepts, rejects or defers, and the rationale is captured as part of the decision instead of as a reply to a message.',
    keeps: 'Rejections and deferrals as first-class records, not absences.',
    so: 'The firm can study what it declined, which is where most of its unexamined judgement sits.',
  },
  {
    icon: ArrowLeftRight,
    stage: 'Execute',
    record: 'Accepted trade',
    line: 'The approved trade becomes the firm’s committed record of what it actually did, carrying whether the fill was assumed from the approval or confirmed against the book.',
    keeps: 'The authorizing decision, and the provenance of the price the record was built on.',
    so: 'A position traces back to the argument that authorized it, not just to a timestamp.',
  },
  {
    icon: History,
    stage: 'Review',
    record: 'Outcome review',
    line: 'Later, the decision is revisited against what actually happened, and the review is written against the original thesis rather than against the current price.',
    keeps: 'The grade and its reasoning, attached to the decision it judges.',
    so: 'Judgement becomes separable from luck, because the claim and the result are in the same record.',
  },
]

const PROBLEMS: [string, string][] = [
  ['Research evolves', 'The note that justified the position has been edited six times since. The version the PM actually read is gone.'],
  ['Recommendations change', 'A target moves, conviction shifts, the sizing is revised. Which version was the one that got approved?'],
  ['PMs disagree', 'A rejection or a deferral carries as much information as an approval, and it usually lives in a reply to a message.'],
  ['Positions get adjusted', 'Six months later the book looks nothing like the trade that was authorized, and nobody can reconstruct the path.'],
]

/**
 * The capture layer.
 *
 * "Do we want to show more about notetaking" was asked directly, and the
 * answer is yes, for a reason that is about selling rather than about
 * completeness: the lifecycle section explains what the firm GETS, and an
 * analyst reading it has no idea what their own day looks like. The record
 * only assembles itself if capture is somewhere an analyst would actually
 * work, so this section is the one that answers "what am I doing all day",
 * and it is the inverted band because it is the part of the product a
 * reader is most likely to touch first.
 *
 * Every item here is a surface that exists. Nothing aspirational was added
 * to round the list out to six.
 */
const CAPTURE: [typeof BookOpen, string, string][] = [
  [BookOpen, 'Notes that belong to the name', 'Research is written against the security, not against a document that happens to mention it. Open the name a year later and the thinking is already there.'],
  [Quote, 'Fast capture, kept in place', 'A quick thought during a call lands on the right security in a couple of keystrokes and stays attached to it, instead of in a notebook nobody opens again.'],
  [History, 'Versions instead of overwrites', 'Editing a note adds a version. Nothing that someone else may have relied on is silently replaced.'],
  [Layers, 'Themes across names', 'A view that spans several securities is its own subject, so the work that applies to a theme is not retyped into four separate notes.'],
  [Target, 'Price targets with a history', 'A target is a record with a lifecycle rather than a number in a cell, so a revision is visible as a revision.'],
  [ListChecks, 'Structured diligence', 'Checklists and requirements turn a repeated process into something the firm can see the state of, with the supporting material attached where it was used.'],
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

/**
 * What the assistant does, stated as capability rather than as a roadmap.
 *
 * The "Not yet built" column that used to sit beside this is gone, and the
 * three items it listed were REMOVED from the page rather than reworded,
 * which is the honest way to comply with "no reference to what isn't built".
 * Everything below is something the assistant does today.
 */
const INTELLIGENCE: [typeof Sparkles, string, string][] = [
  [Boxes, 'It knows where you are', 'The assistant is in the workspace, with the security you are looking at and the portfolio it sits in as context, so a question does not start by re-establishing what you are working on.'],
  [Link2, 'It reads the record, not the internet', 'Retrieval runs over the firm’s own research, ideas, recommendations and decisions. Its usefulness comes from the corpus being typed and linked rather than a folder of documents.'],
  [ShieldCheck, 'It cites what it used', 'Answers point at the records they came from, so a claim can be checked rather than taken. An assistant over investment reasoning that cannot be audited is not usable at a firm.'],
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

      {/*
        A dot grid, fixed, at 1.5% white.

        This is the cheapest meaningful answer to "more interesting than a
        dark background". It is not visible as a pattern at any normal
        viewing distance; what it does is give the background a MATERIAL
        rather than a value, so large empty areas read as a surface instead
        of as absence. 28px pitch, 1px dots, pure CSS, no asset.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.015) 1px, transparent 0)',
          backgroundSize: '28px 28px',
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
              <a href="#research" className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-slate-400 transition-colors hover:text-white md:block">
                Research
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
              The only element on the page allowed this much size. The second
              line takes the accent gradient so the sentence has a subject
              and a turn rather than two equal shouts.
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
              <ContactCta subject={DEMO_SUBJECT} label="Request a demo" className={BTN_PRIMARY} />
              <a href="#lifecycle" className={BTN_GHOST}>
                Explore the platform
              </a>
            </div>

            {/*
              Category positioning, above the fold.

              This says what Tesseract is NOT, which is a different thing
              from saying what is unfinished. A PM who learns at minute
              forty of a demo that this is not a market-data terminal has
              spent forty minutes on the wrong question. The previous
              version of this paragraph also called the platform
              "early-stage" with a "working core workflow"; that part is
              gone and should not come back.
            */}
            <p className="mt-14 max-w-[64ch] border-l border-white/10 pl-5 text-[13px] leading-[1.8] text-slate-500">
              Tesseract is not a market-data terminal, an execution system,
              or a replacement for the tools your desk already runs. It sits
              alongside them and keeps the one thing none of them holds: why
              you did what you did.
            </p>
          </div>
        </section>

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

        {/* ── 3. The connected decision lifecycle ─────────────────────────── */}
        <Section
          id="lifecycle"
          accent="violet"
          label="The connected decision lifecycle"
          title="Research, recommend, decide, execute, review. Linked, not filed."
          lead="Each stage is a typed record that points at the one before it. That linkage is the product: it is what makes a decision reviewable a year later rather than merely archived."
        >
          {/*
            Stages left, the record shape right.

            The prose claims linkage; the diagram beside it shows the
            linkage. Side by side is the whole point, because each is weak
            alone: the stages without the chain are five abstractions, and
            the chain without the stages is a schema with no narrative.

            Each stage carries what it KEEPS and the consequence a year
            later, not just a description. A one-line stage is an assertion.
          */}
          <div className="grid gap-x-16 gap-y-12 lg:grid-cols-12">
            <ol className="relative lg:col-span-7">
              {/* A spine down the stages, so they read as one run. */}
              <div
                aria-hidden="true"
                className="absolute bottom-6 left-5 top-6 w-px bg-gradient-to-b from-transparent via-white/12 to-transparent"
              />
              {LIFECYCLE.map(({ icon: Icon, stage, record, line, keeps, so }, i) => (
                <li key={stage} className="relative flex gap-5 pb-10 last:pb-0">
                  <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#070b16] ring-1 ring-inset ring-white/10">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500/20 to-primary-500/10"
                    />
                    <Icon className="relative h-[18px] w-[18px] text-violet-200" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 pt-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[11px] font-semibold tabular-nums tracking-[0.12em] text-violet-400/70">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="text-[15px] font-semibold tracking-tight text-white">{stage}</h3>
                      <span className="rounded bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-slate-400 ring-1 ring-inset ring-white/[0.08]">
                        {record}
                      </span>
                    </div>
                    <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.75] text-slate-400">{line}</p>
                    <dl className="mt-3.5 max-w-[54ch] space-y-1.5 border-l border-white/[0.08] pl-4">
                      <div className="flex flex-wrap gap-x-2 text-[12px] leading-[1.7]">
                        <dt className="font-semibold text-slate-500">Keeps</dt>
                        <dd className="text-slate-400">{keeps}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2 text-[12px] leading-[1.7]">
                        <dt className="font-semibold text-slate-500">So</dt>
                        <dd className="text-slate-400">{so}</dd>
                      </div>
                    </dl>
                  </div>
                </li>
              ))}
            </ol>

            <div className="lg:col-span-5">
              <RecordChain />
            </div>
          </div>
        </Section>

        {/*
          ── 4. Research and capture: THE INVERTED BAND ────────────────────

          The one light section on the page, and the main structural answer
          to "I need something more interesting besides just a dark
          background". A long page in one value register reads as a single
          surface however well each section is set; an inversion halfway
          down is the strongest available signal that a person laid the page
          out rather than a template.

          It is this section rather than another because the subject is what
          an analyst does all day, which is the part of the product a reader
          is most likely to picture themselves using. A light band also
          suits a section about writing.

          The palette is SELF-CONTAINED: slate-900 on #f7f8fa, with its own
          borders. It does not use `dark:` variants and it does not depend on
          any class on <html>. The gradient strips at both edges are what
          make the change arrive instead of cut.
        */}
        <section id="research" className="relative">
          <div
            aria-hidden="true"
            className="h-24 bg-gradient-to-b from-transparent to-[#f7f8fa] sm:h-32"
          />
          <div className="bg-[#f7f8fa]">
            <div className={`${SHELL} pb-20 pt-4 sm:pb-28`}>
              <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="h-px w-8 bg-gradient-to-r from-primary-600 to-violet-600"
                    />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Research and capture
                    </p>
                  </div>
                  <h2 className="mt-5 text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-slate-900 sm:text-4xl">
                    The record assembles itself out of work an analyst was going to do anyway
                  </h2>
                </div>
                <div className="lg:col-span-5 lg:pt-2">
                  <p className="max-w-[56ch] text-[15px] leading-[1.75] text-slate-600">
                    No firm adopts a system that asks analysts to document
                    their decisions a second time, after the fact, for
                    somebody else’s benefit. So capture is not a step. It is
                    where the writing already happens.
                  </p>
                </div>
              </div>

              <div className="mt-14 grid gap-x-14 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 sm:mt-16">
                {CAPTURE.map(([Icon, h, p]) => {
                  const I = Icon as typeof BookOpen
                  return (
                    <div key={h}>
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-slate-900/[0.08]">
                        <I className="h-[17px] w-[17px] text-primary-600" aria-hidden="true" />
                      </span>
                      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-slate-900">{h}</h3>
                      <p className="mt-2 max-w-[44ch] text-[14px] leading-[1.75] text-slate-600">{p}</p>
                    </div>
                  )
                })}
              </div>

              {/* The turn back to the lifecycle, so this band is part of the
                  argument rather than a feature list parked in the middle. */}
              <p className="mt-14 max-w-[68ch] text-pretty text-lg leading-[1.6] text-slate-700 sm:text-xl">
                Every one of these is a typed record rather than a document.
                That is the only reason the decision chain further up can
                exist: a recommendation can cite a note because the note is a
                row, not a file somebody attached.
              </p>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="h-24 bg-gradient-to-b from-[#f7f8fa] to-transparent sm:h-32"
          />
        </section>

        {/* ── 5. The product ─────────────────────────────────────────────── */}
        <Section
          id="product"
          accent="cyan"
          divide={false}
          label="The product"
          title="One workspace, built around the security and the decision"
          lead="Analysts work where the name lives. PMs decide from a queue that shows them the frozen case, not a forwarded document. The record assembles itself as a side effect of the work."
        >
          <div className="grid gap-x-16 gap-y-0 sm:grid-cols-2">
            {SURFACES.map(([title, shows], i) => (
              <div
                key={title}
                className="border-t border-white/[0.07] py-7 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] tabular-nums text-cyan-400/60">
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

          {/*
            The section-level note that used to live here announced that no
            product screenshots appeared on the page and that captures were
            pending. That is an internal status report, and it is gone.

            The page still contains zero `<img>` elements and nothing that
            imitates product chrome, and the test suite holds both. The
            difference is that the page no longer TELLS a visitor about the
            absence. When captures are taken they belong in this section as
            images; see `docs/commercial/demo-checklist.md` for which are
            safe to take.
          */}
          <p className="mt-12 max-w-[68ch] text-[14px] leading-[1.75] text-slate-400">
            Each surface is a view onto the same records, which is why moving
            between them does not mean re-entering anything. A decision in the
            inbox and the same decision in the historical record are one row,
            read two ways.
          </p>
        </Section>

        {/* ── 6. Institutional memory ────────────────────────────────────── */}
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

        {/* ── 7. ACT AI ──────────────────────────────────────────────────── */}
        <Section
          id="act-ai"
          accent="emerald"
          label="ACT AI"
          title="An assistant whose advantage is that your record is structured"
          lead="ACT AI sits over the decision corpus. A general model can read a folder of documents; it cannot tell you which recommendation a decision approved, because that relationship does not exist in a folder. Here it does."
        >
          <div className="grid gap-5 lg:grid-cols-3">
            {INTELLIGENCE.map(([Icon, h, p]) => {
              const I = Icon as typeof Sparkles
              return (
                <div key={h} className={`${GLASS} p-7`}>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20">
                    <I className="h-[17px] w-[17px] text-emerald-300" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-[15px] font-semibold tracking-tight text-white">{h}</h3>
                  <p className="mt-2.5 text-[14px] leading-[1.75] text-slate-400">{p}</p>
                </div>
              )
            })}
          </div>

          <div className="mt-10 grid gap-x-16 gap-y-6 lg:grid-cols-2">
            <p className="max-w-[60ch] text-[14px] leading-[1.75] text-slate-400">
              The assistant runs on your organization’s own provider key, held
              encrypted, so the firm keeps control of which model its
              reasoning is sent to and what it spends.
            </p>
            <p className="max-w-[60ch] text-[13px] leading-[1.75] text-slate-500">
              ACT AI assists the people who make the decisions. It does not
              manage portfolios, place orders, or produce recommendations on
              its own authority.
            </p>
          </div>
        </Section>

        {/*
          ── 8. Become a design partner ────────────────────────────────────

          An invitation: who we are looking for, what they get, one action.

          The information-dense version of this section carried a four-item
          benefits grid beside a panel headed "What we are honest about up
          front", which made the one part of the page meant to convert into
          a list of reasons to hesitate. The caveat panel is gone and the
          scope line that followed it ("not an offer of unrestricted
          production access") is gone too, by instruction.
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

                <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                  <ContactCta
                    subject={PARTNER_SUBJECT}
                    label="Become a design partner"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-black/30 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b16]"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 9. Closing CTA ─────────────────────────────────────────────── */}
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
                recommendation, a portfolio-manager decision, the trade it
                authorized, and the record it leaves behind.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <ContactCta subject={DEMO_SUBJECT} label="Request a demo" className={BTN_PRIMARY} />
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
                <a href="#research" className="transition-colors hover:text-white">Research</a>
                <a href="#product" className="transition-colors hover:text-white">Product</a>
                <a href="#partners" className="transition-colors hover:text-white">Design partners</a>
                <Link to="/login" className="transition-colors hover:text-white">Sign in</Link>
              </nav>
            </div>
            {/*
              The one remaining disclosure, and it stays.

              This is not a status confession, it is the line that keeps a
              page describing investment software from reading as investment
              advice or a performance claim. "Pre-release." used to open it
              and has been removed.
            */}
            <p className="mt-10 border-t border-white/[0.06] pt-6 text-[12px] leading-[1.75] text-slate-600">
              Nothing on this page is an offer of securities, investment advice, or a performance representation.
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default LandingPage
