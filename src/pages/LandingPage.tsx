import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, BookOpen, FileSignature, Gavel, History,
  Layers, LineChart, Lock, ShieldCheck, Sparkles, Users,
} from 'lucide-react'
import { TesseractLoader } from '../components/ui/TesseractLoader'
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
 * ── Performance ──────────────────────────────────────────────────────────
 *
 * Lazily routed from `App.tsx` so none of this reaches the authenticated
 * entry chunk, which is a lane this codebase has already paid for once
 * (the 8,950 kB entry chunk). No images, no new dependencies, no web
 * fonts: the only graphic is the brand mark the app already draws on a
 * canvas, and the lifecycle diagram is laid out with CSS.
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

function Section({
  id, label, title, lead, children, tone = 'light',
}: {
  id: string
  label?: string
  title: string
  lead?: string
  children?: React.ReactNode
  tone?: 'light' | 'tint' | 'dark'
}) {
  const bg =
    tone === 'dark' ? 'bg-slate-950 text-slate-100'
    : tone === 'tint' ? 'bg-slate-50 dark:bg-slate-900/40'
    : 'bg-white dark:bg-slate-900'

  return (
    <section id={id} className={bg}>
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24 lg:px-8">
        {label && (
          <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${
            tone === 'dark' ? 'text-primary-300' : 'text-primary-600 dark:text-primary-400'
          }`}>
            {label}
          </p>
        )}
        <h2 className={`mt-3 text-2xl font-semibold tracking-tight sm:text-3xl ${
          tone === 'dark' ? 'text-white' : 'text-slate-900 dark:text-white'
        }`}>
          {title}
        </h2>
        {lead && (
          <p className={`mt-4 max-w-3xl text-base leading-relaxed ${
            tone === 'dark' ? 'text-slate-300' : 'text-slate-600 dark:text-slate-300'
          }`}>
            {lead}
          </p>
        )}
        {children && <div className="mt-12">{children}</div>}
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
 */
function ProductShot({ title, shows }: { title: string; shows: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
        <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
        <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
        <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
        <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">{title}</span>
      </div>
      <div className="flex min-h-[180px] flex-col justify-center gap-2 px-6 py-8">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{shows}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Product capture pending. This frame is a placeholder, not a rendering of the feature.
        </p>
      </div>
    </figure>
  )
}

/** A status marker that distinguishes what runs from what is planned. */
function Status({ kind }: { kind: 'now' | 'planned' }) {
  const now = kind === 'now'
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
      now
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
    }`}>
      {now ? 'Available now' : 'Planned'}
    </span>
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
    <div className="min-h-screen bg-white dark:bg-slate-900">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5 lg:px-8" aria-label="Main">
          <a href="#top" className="flex items-center gap-2.5 text-white">
            <div ref={markRef} className="h-7 w-7">
              <TesseractLoader size={28} compact />
            </div>
            <span className="text-base font-semibold tracking-tight">Tesseract</span>
          </a>
          <div className="flex items-center gap-2 sm:gap-5">
            <a href="#lifecycle" className="hidden text-sm text-slate-300 hover:text-white sm:block">
              How it works
            </a>
            <a href="#partners" className="hidden text-sm text-slate-300 hover:text-white sm:block">
              Design partners
            </a>
            <Link
              to="/login"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 hover:text-white"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
      <section id="top" className="relative overflow-hidden bg-slate-950">
        {/* One restrained accent: a soft radial, no gradient wash, no mesh. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ background: 'radial-gradient(60rem 30rem at 70% -10%, #60a5fa, transparent 70%)' }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32 lg:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-300">
            A decision operating system for investment teams
          </p>
          <h1 className="mt-5 max-w-4xl text-3xl font-semibold leading-[1.15] tracking-tight text-white sm:text-5xl">
            Every investment decision has a story.
            <span className="block text-slate-400">Make sure your firm remembers it.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300">
            Tesseract connects investment research, recommendations,
            portfolio-manager decisions and subsequent outcomes in one
            institutional workspace. It helps teams preserve reasoning,
            maintain context, and learn from decisions over time.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            {demoHref ? (
              <a
                href={demoHref}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Request a demo <ArrowRight className="h-4 w-4" />
              </a>
            ) : (
              <a
                href="#partners"
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Request a demo <ArrowRight className="h-4 w-4" />
              </a>
            )}
            <a
              href="#lifecycle"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-slate-500 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              Explore the platform
            </a>
          </div>

          {/* Said on the hero, not buried. A PM who learns this at minute
              forty of a demo has spent forty minutes on the wrong question. */}
          <p className="mt-10 max-w-2xl text-sm leading-relaxed text-slate-400">
            Tesseract is an early-stage institutional platform with a working
            core workflow. It is not a market-data terminal, an execution
            system, or a replacement for the tools your desk already runs. It
            is the layer that remembers why you did what you did.
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
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {[
            ['Research evolves', 'The note that justified the position has been edited six times since. The version the PM actually read is gone.'],
            ['Recommendations change', 'A target moves, conviction shifts, the sizing is revised. Which version was the one that got approved?'],
            ['PMs disagree', 'A rejection or a deferral carries as much information as an approval, and it usually lives in a reply to a message.'],
            ['Positions get adjusted', 'Six months later the book looks nothing like the trade that was authorized, and nobody can reconstruct the path.'],
          ].map(([h, p]) => (
            <div key={h} className="border-l-2 border-slate-200 pl-5 dark:border-slate-700">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">{h}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{p}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-3xl text-base leading-relaxed text-slate-700 dark:text-slate-200">
          The consequence is not an administrative one. A team that cannot
          reconstruct its own reasoning cannot tell a correct call from a lucky
          one, cannot separate a thesis that played out from a thesis that was
          never tested, and cannot hand a name from one analyst to the next
          without starting again.
        </p>
      </Section>

      {/* ── 3. The connected decision lifecycle ─────────────────────────── */}
      <Section
        id="lifecycle"
        tone="dark"
        label="The connected decision lifecycle"
        title="Research, recommend, decide, review. Linked, not filed."
        lead="Each stage in Tesseract is a typed record that points at the one before it. That linkage is the product. It is what makes a decision reviewable a year later rather than merely archived."
      >
        <ol className="grid gap-4 lg:grid-cols-4">
          {LIFECYCLE.map(({ icon: Icon, stage, line }, i) => (
            <li key={stage} className="relative rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/10 text-primary-300">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="text-xs font-semibold tabular-nums text-slate-500">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">{stage}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{line}</p>
              {/* The arrow between stages, on wide screens only. The
                  relationship between stages IS the story, so it is drawn
                  rather than left to the reading order. */}
              {i < LIFECYCLE.length - 1 && (
                <ArrowRight
                  aria-hidden="true"
                  className="absolute -right-[11px] top-1/2 hidden h-5 w-5 -translate-y-1/2 text-slate-700 lg:block"
                />
              )}
            </li>
          ))}
        </ol>
      </Section>

      {/* ── 4. The product ──────────────────────────────────────────────── */}
      <Section
        id="product"
        tone="tint"
        label="The product"
        title="One workspace, built around the security and the decision"
        lead="Analysts work where the name lives. PMs decide from a queue that shows them the frozen case, not a forwarded document. The record assembles itself as a side effect of the work."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <ProductShot
            title="Asset workspace"
            shows="The security, its instrument identity and price provenance, the firm's exposure, coverage, and the written case in one view."
          />
          <ProductShot
            title="Idea pipeline"
            shows="Ideas moving through exploring, researching, developing and ready-to-recommend, with conviction and staleness visible."
          />
          <ProductShot
            title="Recommendation and frozen reasoning"
            shows="What the analyst submitted, preserved exactly as the PM received it, with later edits kept as versions rather than overwrites."
          />
          <ProductShot
            title="Decision inbox"
            shows="Recommendations awaiting a portfolio-manager decision, with accept, reject and defer each recorded as a first-class outcome."
          />
          <ProductShot
            title="Historical decision record"
            shows="Every decision the firm has made, with the case, the decision-maker, the rationale and the execution provenance attached."
          />
          <ProductShot
            title="Outcome review"
            shows="A structured review of whether the thesis played out, recorded against the decision it belongs to."
          />
        </div>
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          Captures are pending rather than mocked up. We would rather show you
          the live product in a scheduled walkthrough than publish a rendering
          of it.
        </p>
      </Section>

      {/* ── 5. Institutional memory ─────────────────────────────────────── */}
      <Section
        id="memory"
        label="Institutional memory"
        title="The firm's accumulated decisions as an asset it owns"
        lead="Every investment organization can buy the same market data. What cannot be bought is a connected history of this firm's own judgement: what it considered, what it chose, what it declined, and what it learned."
      >
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [Lock, 'Preserved reasoning', 'The case as it stood at the moment of decision, immune to later editing.'],
            [History, 'Decision history', 'Approvals, rejections and deferrals as records of equal standing, each with its rationale.'],
            [ShieldCheck, 'Accountability', 'Who decided, on what evidence, and when. Available without anyone reconstructing a thread.'],
            [Users, 'Continuity', 'A name handed between analysts or PMs arrives with its context, not as a blank page.'],
            [LineChart, 'Review and learning', 'Outcomes assessed against the original thesis, so the firm can tell judgement from luck.'],
            [Layers, 'A connected corpus', 'Research, ideas, recommendations, decisions and reviews as linked records, queryable as one body.'],
          ].map(([Icon, h, p]) => {
            const I = Icon as typeof Lock
            return (
              <div key={h as string}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
                  <I className="h-[18px] w-[18px]" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">{h as string}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{p as string}</p>
              </div>
            )
          })}
        </div>
        <p className="mt-10 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Tesseract makes a firm's reasoning retrievable. It does not promise
          better returns, and no part of this platform should be read as a
          forecast of investment performance.
        </p>
      </Section>

      {/* ── 6. ACT AI ───────────────────────────────────────────────────── */}
      <Section
        id="act-ai"
        tone="tint"
        label="ACT AI"
        title="A contextual assistant that reads your firm's record, not the internet"
        lead="ACT AI is the intelligence layer over the decision corpus. Its value comes from the fact that the corpus is typed and linked: it can answer questions about your own research and decisions because those are records, not a folder of documents."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800/50">
            <h3 className="flex items-center gap-3 text-base font-semibold text-slate-900 dark:text-white">
              <Sparkles className="h-[18px] w-[18px] text-primary-600 dark:text-primary-400" />
              Running today
            </h3>
            <ul className="mt-5 space-y-4">
              {[
                'Conversational assistant inside the workspace, with the current security and portfolio as context.',
                'Retrieval over the firm\'s own research, ideas, recommendations and decision records.',
                'Answers that cite the records they came from, so a claim can be checked.',
              ].map(t => (
                <li key={t} className="flex gap-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  <Status kind="now" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800/50">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Planned, and not yet built
            </h3>
            <ul className="mt-5 space-y-4">
              {[
                'Platform-provisioned AI with per-organization budgets and usage accounting. Today the assistant runs on a key the firm supplies.',
                'Proactive surfacing of a prior decision when a similar one comes up.',
                'Firm-level pattern analysis across decisions and outcomes.',
              ].map(t => (
                <li key={t} className="flex gap-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  <Status kind="planned" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          ACT AI assists the people who make the decisions. It does not manage
          portfolios, place orders, or produce recommendations on its own
          authority.
        </p>
      </Section>

      {/* ── 7. Founding design partners ─────────────────────────────────── */}
      <Section
        id="partners"
        tone="dark"
        label="Founding design partners"
        title="Help shape the next generation of investment decision infrastructure"
        lead="We are selecting a small number of investment teams to evaluate Tesseract and shape its institutional rollout. This is a guided evaluation and a design partnership, not an offer of unrestricted production access."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            {[
              ['Early access to a defined evaluation', 'A scoped walkthrough and a structured trial of the decision workflow, with us in the room.'],
              ['Direct input into priorities', 'The sequence of what gets built next, decided with the desks that will use it.'],
              ['Collaboration on workflows', 'Your recommendation and decision process, modelled properly rather than approximated.'],
              ['A path to becoming an early commercial partner', 'Preferential terms when the commercial release is ready, on terms agreed in writing at that point.'],
            ].map(([h, p]) => (
              <div key={h} className="border-l-2 border-slate-700 pl-5">
                <h3 className="text-base font-semibold text-white">{h}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{p}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-7">
            <h3 className="text-base font-semibold text-white">What we are honest about up front</h3>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-slate-400">
              <li>
                Commercial market-data licensing for external users is not yet
                in place. A pilot's price and news coverage is a dependency we
                are resolving, not a feature we are claiming.
              </li>
              <li>
                Platform-provisioned AI is not yet available. ACT AI currently
                runs on a key your firm supplies.
              </li>
              <li>
                This is a pre-release platform. It is not a production
                deployment with external users on it today.
              </li>
            </ul>

            <div className="mt-7">
              {partnerHref ? (
                <a
                  href={partnerHref}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  Discuss a design partnership <ArrowRight className="h-4 w-4" />
                </a>
              ) : (
                /* No guessed address, and no button that goes nowhere. */
                <div
                  data-testid="contact-unconfigured"
                  className="rounded-lg border border-dashed border-slate-700 px-5 py-4 text-sm text-slate-400"
                >
                  <p className="font-semibold text-slate-200">
                    Contact route not configured
                  </p>
                  <p className="mt-1.5 leading-relaxed">
                    This deployment has no contact address set, so there is no
                    button here yet. Set <code className="text-slate-300">VITE_ACCESS_REQUEST_EMAIL</code> to
                    turn the demo and partnership requests on across the site.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* ── 8. Closing CTA ──────────────────────────────────────────────── */}
      <section id="contact" className="bg-white dark:bg-slate-900">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center sm:py-24 lg:px-8">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
            See the decision loop on a real security
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
            Thirty minutes, one name, start to finish: research, a
            recommendation, a portfolio-manager decision, and the record it
            leaves behind.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            {demoHref ? (
              <a
                href={demoHref}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                Request a demo <ArrowRight className="h-4 w-4" />
              </a>
            ) : (
              <a
                href="#partners"
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                Request a demo <ArrowRight className="h-4 w-4" />
              </a>
            )}
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-500"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8 dark:text-slate-400">
          <p>Tesseract. A decision operating system for investment teams.</p>
          <p className="text-xs">
            Pre-release. Nothing on this page is an offer of securities, investment advice, or a performance representation.
          </p>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
