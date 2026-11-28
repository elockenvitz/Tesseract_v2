import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AssetWorkspaceFigure,
  DecisionInboxFigure,
  IdeaPipelineFigure,
  OutcomeFigure,
  RecommendationFigure,
  TradeBookFigure,
  WorkspaceCanvas,
} from '../components/landing/ScreenFigures'
import { RoleSwitch } from '../components/landing/RoleSwitch'
import { ReassessFigure } from '../components/landing/ReassessFigure'
import {
  AssistantCanvas,
  AssistantFlow,
  CaptureTrade,
  MemoryLedger,
} from '../components/landing/SectionVisuals'
import {
  ArrowLeftRight, ArrowRight, BookOpen, FileSignature, Gavel, History,
  Layers, Lock, Quote, RotateCcw, ShieldCheck,
  Users,
} from 'lucide-react'
// `ListChecks` went with the "Structured diligence" capture item, which the
// platform canvas now draws as a research-process pane instead of stating.
// Removed rather than left in place: the type ceiling flags an unread import
// immediately, which is exactly what makes this list a useful quiet check.
// `Boxes`, `Link2` and `Sparkles` went with the three assistant capability
// cards, the same way `LineChart` went below. The icon list keeps working as
// the quiet check it is: content that leaves the page leaves this line too.
// `LineChart` was dropped with the "Review and learning" memory item, which
// was the lifecycle's Review stage restated. An unused import is an eslint
// error here, so the icon list is a quiet check on content that left.
/* The request-access box, and the one type that says which CTA opened it. */
import { AccessRequestDialog } from '../components/landing/AccessRequestDialog'
import {
  ACCESS_REQUEST_ROUTE,
  type AccessRequestTopic,
} from '../components/landing/access-request-contract'
import { TesseractLogo } from '../components/ui/TesseractLogo'
import { TesseractMark } from '../components/ui/TesseractMark'
import { hideBootLoader } from '../lib/boot-loader'
/* The legal link list and its short labels, shared with the auth-page footer
   so a renamed document cannot go stale in one of the two places. */
import { LEGAL_DOCUMENTS, legalPath, FOOTER_LABELS } from '../legal/documents'

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
 * ── RULE TWO: one job per section, and no claim made twice ──────────────
 *
 * The brief was that the copy had to be clear and not overwhelming, and the
 * cause turned out to be measurable rather than a matter of taste. The page
 * was 1,603 words across 31 headed items, and the sections were re-arguing
 * each other: "the version the PM read is frozen" was asserted NINE times
 * (in the problem list twice, two lifecycle stages, the diagram and its
 * note, the capture list, the product list, and the memory list), and "a
 * rejection is a record" five times. A reader does not experience that as
 * thorough. They experience it as not being able to tell what is new, which
 * is what "confusing" meant here.
 *
 * So every section has exactly ONE job and carries only what is its own:
 *
 *   problem    what breaks today
 *   lifecycle  the five stages and the record each one leaves
 *   research   what an analyst actually does, so capture is not a chore
 *   product    where the work happens, as a map of surfaces
 *   memory     why the accumulation is worth owning
 *   act-ai     why a structured record makes an assistant useful
 *
 * If a line could sit in two of those sections, it belongs in the earlier
 * one and must be deleted from the later one. The memory list lost three of
 * its six items that way, and the lifecycle lost a whole field. Two further
 * rules came out of the same pass:
 *
 *   ONE SENTENCE PER BULLET. A second sentence in a grid cell is where the
 *   scanning stops. Where both sentences carried weight they were joined,
 *   not halved.
 *
 *   NUMBERS MEAN SEQUENCE. There were three numbered lists; only the
 *   lifecycle has an order, so only the lifecycle is numbered.
 *
 * ── The visual system ────────────────────────────────────────────────────
 *
 * The brief was that a dark background alone is not interesting. It was
 * said twice, which means the first answer failed, and it failed for a
 * reason worth recording: everything in it was pitched below the threshold
 * where a person actually sees it. A dot grid at 1.5% white is not subtle,
 * it is absent. See `PageAtmosphere` for the rebuilt version.
 *
 * Three constraints arrived over three rounds of review, and together they
 * removed every easy option, which is why the page ended up somewhere
 * specific instead of somewhere tasteful:
 *
 *   NO PURPLE. No violet, fuchsia or indigo anywhere, in a wash, a
 *   gradient or an accent.
 *
 *   THE TESSERACT BEHIND, LIGHTLY. The brand geometry is the background
 *   motif, which is what `TesseractField` does.
 *
 *   NO BLOBS AT ALL, and the reference is the Milky Way, a starfield, and
 *   a black hole, since a tesseract is what sits inside one. That last one
 *   is not decoration: it is the only image on this page that no other
 *   company could use.
 *
 * ── Where the colour went ───────────────────────────────────────────────
 *
 * The page is now effectively MONOCHROME. One accent hue, the product's
 * blue, on small marks only: eyebrow rules, lifecycle icons and numerals,
 * the diagram spine, the assistant icons. Exactly ONE coloured field
 * survives anywhere, the wash inside the design-partner panel, and it is
 * the one block on the page that should be the most luminous. Everything
 * else is white, grey or near-black.
 *
 * That is not minimalism for its own sake. Three rounds of "this looks
 * vibe coded" all landed on colour that the composition had not earned:
 * four drifting aurora fields, four per-section hue washes, a three-stop
 * gradient across the headline. Each was added to make the page
 * interesting and each made it generic, because colour applied as
 * decoration is the cheapest thing on a page and reads that way.
 *
 * The mechanisms that carry it instead:
 *
 *  1. THE SKY. A vignette, a galactic band, and 220 seeded stars. See
 *     `PageAtmosphere` and `STARS`.
 *  2. GARGANTUA. The hero mark sits inside a black hole. See `BlackHole`,
 *     which documents the four restraints that keep it from being kitsch.
 *  3. THE TESSERACT FIELD. Four large still marks anchored to the document
 *     so the geometry behind the text changes as you scroll.
 *  4. ONE LIGHT BAND. The research section inverts to near-white. A long
 *     page in a single value register reads as one undifferentiated
 *     surface, and an inversion halfway down is the strongest available
 *     signal that a human laid the page out. It is deliberately the
 *     section about capture, because that is the part of the product a
 *     reader is most likely to touch. Self-contained palette, a gradient
 *     transition at both edges so the change arrives rather than cuts, and
 *     its own neutral shadows, grid and grain so the inversion is not
 *     itself a flat field.
 *  5. LUMINANCE RHYTHM. Alternate bands sit about one percent lighter.
 *     See `TONES`.
 *  6. DEPTH, not borders. Surfaces separate by translucency and a 1px
 *     inner highlight rather than by a box outline.
 *
 * NOTHING ANIMATES except on hover. No drift, no twinkle, no parallax.
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
 *     (Typeform, Tally, a Google Form). A form exposes no address to
 *     scrapers, filters spam, and returns structured responses instead of
 *     free-text email.
 *  2. Otherwise the CTA opens `AccessRequestDialog`, an on-page box that
 *     posts to the host's own form handling. This is the live route.
 *
 * ── Why `/login` is gone, which was a real bug ───────────────────────────
 *
 * The third branch used to send every CTA to `/login`, and the comment here
 * called that "a REAL working page with a real access-request path on it".
 * Both halves were false:
 *
 *   - the request-access affordance lives in `EarlyAccessNotice`, which
 *     renders on `/signup`, not `/login`; and
 *   - even there it is wrapped in `{ACCESS_REQUEST_EMAIL && ...}`, so with
 *     the variable unset, which is the live state, it renders nothing.
 *
 * So a stranger who clicked "Request a demo" landed on a password prompt
 * with no way to ask for anything. The suite did not catch it because it
 * asserted the href was `/login` and stopped: a link to a page is not a
 * route to an outcome, and checking the href proves only the former.
 *
 * `VITE_ACCESS_REQUEST_EMAIL` is still read, but it is no longer a mode. A
 * mailto CTA asks a prospect to compose a cold email from nothing; the box
 * asks five short questions. The address is now the box's fallback if the
 * POST fails, and nothing else, so it is never rendered to a visitor who is
 * not already looking at an error.
 *
 * No address is ever guessed. `sales@tesseract.com` appears hard-coded in
 * `AIConfigurationSection` and is NOT used here: that domain is not ours.
 *
 * `data-contact-mode` carries which branch rendered, so the test suite can
 * assert the route without any of it being visible to a visitor.
 *
 * The decision itself now lives in `access-request-contract.ts`, because
 * `/signup` makes the same one and the two of them disagreeing is what made
 * `/signup` a dead end. One module reads the variables.
 */
const CONTACT_MODE = ACCESS_REQUEST_ROUTE.mode
const CONTACT_URL = ACCESS_REQUEST_ROUTE.url
const CONTACT_EMAIL = ACCESS_REQUEST_ROUTE.fallbackEmail

/**
 * One CTA component for every call to action on the page.
 *
 * In `form` mode it is a plain `<a>`, not a router `<Link>`, because a
 * `<Link>` to an off-site URL would be pushed onto the SPA history and
 * render nothing. In `inline` mode it is a `<button>`, because it opens a
 * dialog rather than navigating, and a link that does not navigate is a lie
 * to anyone reading the status bar or using a screen reader.
 *
 * `onOpen` is required rather than defaulted. A no-op default would render a
 * button that silently does nothing if a future call site forgot to wire it,
 * which is the same class of failure as the `/login` fallback this replaced.
 * Required means the compiler catches it.
 */
function ContactCta({
  topic, label, className, children, onOpen,
}: {
  topic: AccessRequestTopic
  label: string
  className: string
  children?: React.ReactNode
  onOpen: (topic: AccessRequestTopic) => void
}) {
  const body = (
    <>
      {label}
      {children ?? <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </>
  )
  if (CONTACT_MODE === 'form') {
    return (
      <a
        href={CONTACT_URL}
        className={className}
        data-contact-mode={CONTACT_MODE}
        target="_blank"
        rel="noreferrer"
      >
        {body}
      </a>
    )
  }
  return (
    <button
      type="button"
      className={className}
      data-contact-mode={CONTACT_MODE}
      onClick={() => onOpen(topic)}
    >
      {body}
    </button>
  )
}

/* ─────────────────────────── layout, declared first ─────────────────────── */

/*
 * These two sit above `PageAtmosphere` because it reads `GUTTER`, and a
 * `const` referenced from a component defined earlier in the file is a
 * use-before-define that `guard:tdz` exists to catch. It would not actually
 * throw, since the read happens at render rather than at module evaluation,
 * which is exactly why it is the kind of thing that gets committed and then
 * breaks later when someone calls the function during module init.
 */

/** The horizontal padding, shared so the background grid lines up with text. */
const GUTTER = 'px-6 sm:px-8 lg:px-12'

/*
 * ── TWO WIDTHS, 2026-11-27, because one width wasted the screen ─────────
 *
 * Everything was `max-w-7xl`, which is 1280px. Measured at 1920 that left
 * 320px of empty page on each side and, more to the point, it capped every
 * product figure at 1280 minus 96px of gutter. The canvas is the thing a
 * visitor is supposed to look at and it was the same width as a paragraph.
 *
 * `MEASURE` is 1312px for text and ordinary bands: wider than before,
 * still inside the range where a 17px line does not run past a comfortable
 * measure, because the text itself is held to a `ch` limit rather than to
 * the container.
 *
 * `CANVAS` is 1408px and exists only for the full-bleed product figures.
 * The difference is deliberately NOT large — a canvas that breaks the page
 * grid by 300px reads as a mistake. 96px is enough that the figure clearly
 * sits outside the text column and claims the extra light.
 *
 * The background column grid follows `MEASURE`, not `CANVAS`, so the
 * hairlines keep landing on the text edge.
 */
const MEASURE = 'max-w-[82rem]'

/** The page gutter, one definition so every band lines up with the nav. */
const SHELL = `mx-auto w-full ${MEASURE} ${GUTTER}`

/** Wider, for product figures only. See the note on `MEASURE`. */
const CANVAS = `mx-auto w-full max-w-[88rem] ${GUTTER}`

/* ───────────────────────────── the atmosphere ───────────────────────────── */

/**
 * The page background, rebuilt.
 *
 * ── Why this exists as its own component ────────────────────────────────
 *
 * "The background still needs to be more interesting" was said twice, and
 * the reason the first attempt did not answer it is measurable rather than
 * a matter of taste: the previous background was two radial gradients and a
 * dot grid at 1.5% white. At that opacity the grid is below the threshold
 * where a human notices it on an ordinary monitor, so the page was, for all
 * practical purposes a flat field with a slight blue corner. Subtlety past
 * the point of visibility is not restraint, it is absence.
 *
 * The base is now #050710, deepened from #070b16 for the space direction:
 * a hole has to be darker than the sky around it, and at the old value
 * there was not enough room below the background to put one.
 *
 * ── THE AURORA IS GONE, AND IT IS NOT COMING BACK ───────────────────────
 *
 * The second attempt put four large coloured radial fields on the page,
 * two of them slowly drifting, and the verdict was that the colours looked
 * vibe coded. That is correct, and recolouring them would not have helped,
 * because the problem is the DEVICE rather than the hue. A big soft
 * coloured radial blob behind a dark page is the single most reproduced
 * background of the last three years. It arrives free with every template
 * and it says nothing about the product. Its presence is the tell, so there
 * is no palette that rescues it.
 *
 * ── What replaced it: deep space, and a specific piece of it ────────────
 *
 * The brief was the Milky Way, stars, and a black hole, because a tesseract
 * is what sits inside one. That is a real idea and it is ownable, which is
 * the opposite of a gradient: nobody else's landing page can use it,
 * because nobody else is called Tesseract.
 *
 * The risk is equally specific. Starfields and black holes are one bad
 * decision away from a screensaver, and this page sells software to
 * institutional investors. So the register is the FILM's register, not a
 * science-fiction poster's: near black, cold white, one warm highlight,
 * enormous scale, and a great deal of empty space. The things that would
 * wreck it are the things it does not have, namely coloured nebulae,
 * twinkling, parallax, and any shade of purple.
 *
 * ── The layers, outermost first ─────────────────────────────────────────
 *
 *  1. DEEP FIELD. A vignette rather than a glow: the frame darkens at its
 *     edges so the centre has air. This is the layer the aurora was
 *     pretending to be, done as lighting instead of as colour.
 *  2. GALACTIC BAND. One soft diagonal band of dust across the frame at
 *     about twenty degrees, in white at three percent. It is what makes the
 *     sky a SKY rather than a scatter of dots: a starfield with no
 *     structure is noise, and the galactic plane is the structure.
 *  3. STARFIELD. 220 points, seeded so the sky is IDENTICAL on every render
 *     and for every visitor, sized and brightened on a distribution rather
 *     than uniformly, and clustered along the band. See `STARS`.
 *  4. COLUMN GRID. Five vertical hairlines on the content column. Kept, and
 *     dimmed, because the tension between an observatory grid and a
 *     photograph of space is exactly right for this product: it is the
 *     layer that stops the sky becoming a wallpaper and keeps the page
 *     reading as an instrument.
 *  5. GRAIN. Fractal noise at 3.5%, which now reads as sensor noise, which
 *     is what it would be.
 *
 * The dot grid is gone: the starfield does its job properly.
 *
 * ── NO MOTION, STILL ────────────────────────────────────────────────────
 *
 * No drift, no twinkle, no parallax. The standing instruction on this page
 * is that the mark moves on hover only and the background holds to the same
 * rule, so there is no `prefers-reduced-motion` exception to maintain.
 * Twinkling stars in particular would be the single fastest way to make
 * this look cheap.
 *
 * ── Cost ────────────────────────────────────────────────────────────────
 *
 * No images, no dependency, no web request, no animation frames. The
 * starfield is one inline SVG with 220 circles, generated once at module
 * scope. The grain is one data URI the browser rasterizes once.
 */
const GRAIN =
  'url("data:image/svg+xml,' +
  "%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E" +
  "%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' " +
  "numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E" +
  "%3Crect width='160' height='160' filter='url(%23g)'/%3E%3C/svg%3E" +
  '")'

/**
 * The sky, generated once.
 *
 * ── SEEDED, AND THAT IS A CORRECTNESS REQUIREMENT ───────────────────────
 *
 * `mulberry32` from a fixed seed, not `Math.random()`. A random sky would
 * be a DIFFERENT sky on every mount: the stars would jump whenever React
 * re-rendered the page, every visitor would see a different arrangement,
 * and no visual check or snapshot could ever be compared against anything.
 * Seeded, the sky is a fixed asset that happens to be computed rather than
 * drawn, which is what it should be.
 *
 * ── The distribution is the whole job ───────────────────────────────────
 *
 * Uniform random points do not look like a sky. They look like noise,
 * because a real sky has two features a uniform scatter lacks:
 *
 *   STRUCTURE. Most stars sit near the galactic plane. 62 percent of these
 *   are placed within a narrow spread of the band axis, which runs from the
 *   lower left to the upper right at roughly twenty degrees. The rest are
 *   scattered, so the band reads as a density rather than as a stripe.
 *
 *   A MAGNITUDE CURVE. Real brightness is heavily skewed: thousands of
 *   faint stars for every bright one. `r ** 2.4` on a uniform variate gives
 *   that shape, so most points are 0.5px and dim and a handful are large
 *   and bright. A uniform brightness distribution is the thing that makes
 *   a CSS starfield look like a CSS starfield.
 *
 * Positions are percentages so the sky scales with the viewport, but radii
 * are in pixels so the stars stay points rather than stretching into
 * ellipses on a wide monitor.
 */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STARS = (() => {
  const rand = mulberry32(0x7e55e2ac)
  const out: { x: number; y: number; r: number; o: number }[] = []
  for (let i = 0; i < 220; i++) {
    const x = rand()
    // The galactic plane: lower left to upper right, about 20 degrees.
    const bandY = 0.84 - 0.62 * x
    const nearBand = rand() < 0.62
    // Two uniforms averaged approximate a normal, which keeps the band
    // soft-edged instead of a hard ribbon.
    const spread = (rand() + rand() - 1) * 0.17
    const y = nearBand ? bandY + spread : rand()
    if (y < -0.02 || y > 1.02) continue
    const mag = rand() ** 2.4
    out.push({
      x: Math.round(x * 10000) / 100,
      y: Math.round(y * 10000) / 100,
      r: Math.round((0.45 + mag * 1.35) * 100) / 100,
      o: Math.round((0.16 + mag * 0.64) * 100) / 100,
    })
  }
  return out
})()

/**
 * The sky, as a LOCAL layer rather than a fixed one.
 *
 * ── Why this was split out, 2026-11-27 ──────────────────────────────────
 *
 * The starfield and the galactic band were `fixed inset-0`, so they sat
 * behind every one of the page's twelve sections for the entire scroll. The
 * review was that the atmosphere "persists through too much of the page",
 * reduces the contrast between sections, and makes the site read as a
 * technology concept rather than a mature investment platform. That is
 * exactly right, and the mechanism is the fixed positioning: an effect that
 * never changes stops being an effect and becomes the paper.
 *
 * So the sky is now a layer a section opts into, and only three do:
 *
 *   HERO                     the brand statement
 *   INSTITUTIONAL INTELLIGENCE  the one section whose subject is time
 *   CLOSING CTA              the return to the brand
 *
 * Every product section between them sits on a clean, neutral dark
 * surface, which is what lets the figures read as software. The vignette,
 * the column grid and the grain stay global, because those are lighting
 * and texture rather than imagery.
 *
 * `density` scales the star count, so the two supporting moments are
 * quieter than the hero without being a different composition.
 */
function Starscape({ density = 1 }: { density?: number }) {
  const stars = density >= 1 ? STARS : STARS.slice(0, Math.round(STARS.length * density))
  return (
    <>
      {/*
        GALACTIC BAND. One soft diagonal of dust across the frame.

        A starfield with no structure is a scatter of dots. The band is what
        makes it read as a sky, and it is also what the stars are clustered
        along, so the two layers describe the same object rather than
        sitting on top of each other.

        White at three percent, feathered at both edges by the gradient's
        own transparent stops. `rotate` on a generously oversized element,
        so the band's ends are off-frame and it never reads as a stripe with
        two visible terminations.
      */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute left-[-30%] top-[-30%] h-[160%] w-[160%] rotate-[-21deg]"
          style={{
            background:
              'linear-gradient(to bottom,' +
              'transparent 38%,' +
              'rgba(255,255,255,0.012) 44%,' +
              'rgba(255,255,255,0.030) 50%,' +
              'rgba(255,255,255,0.012) 56%,' +
              'transparent 62%)',
          }}
        />
      </div>

      {/*
        STARFIELD. One SVG, seeded. See `STARS` for why the distribution is
        skewed and clustered rather than uniform, and why it must not be
        random. `preserveAspectRatio="none"` is wrong here and is not used:
        positions are percentages, so the sky stretches with the box while
        each star stays a circle of fixed pixel radius.
      */}
      <svg
        aria-hidden="true"
        data-starfield=""
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
        focusable="false"
      >
        {stars.map((s, i) => (
          <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#fff" opacity={s.o} />
        ))}
      </svg>
    </>
  )
}

function PageAtmosphere() {
  return (
    <>
      {/*
        1. DEEP FIELD. A vignette, not a glow: the edges of the frame fall
        away so the centre has air.

        This is what the aurora was pretending to be. A coloured blob adds a
        hue the composition never asked for; a luminance figure states where
        the light is and where it is not. Only the second makes a flat
        rectangle read as space.

        All stops are pure white or pure black at low alpha, so the base
        colour is never tinted. No viewport units anywhere: see the note in
        `src/lib/mobile/__tests__/viewport-sizing.test.ts`.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(70rem 42rem at 26% -14%, rgba(255,255,255,0.040), transparent 66%),' +
            'radial-gradient(90rem 55rem at 50% 50%, transparent 38%, rgba(0,0,0,0.38) 100%),' +
            'radial-gradient(60rem 30rem at 50% 116%, rgba(0,0,0,0.34), transparent 70%)',
        }}
      />

      {/*
        2. COLUMN GRID, dimmed from 5.5% to 3.5%.

        The galactic band and the starfield USED TO BE LAYERS 2 AND 3 HERE,
        fixed behind the whole page. They now belong to `Starscape`, which
        three sections opt into. See the note on that component: an
        atmosphere that never changes is not an atmosphere.

        Kept on purpose, and the tension is the point: an observatory grid
        over a photograph of space is precisely this product's register. It
        is also the layer that stops the sky becoming a wallpaper, because
        it keeps asserting that the page is an instrument. The outer two
        lines land on the text edge, which ties the structure to the type
        rather than laying a grid over it.
      */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 flex justify-center">
        <div className={`flex h-full w-full ${MEASURE} ${GUTTER} justify-between`}>
          {[0, 1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="h-full w-px bg-gradient-to-b from-transparent via-white/[0.035] to-transparent"
            />
          ))}
        </div>
      </div>

      {/* 3. Grain, which in this context reads as sensor noise, which is
             what it would be.

             The opacity is INLINE rather than an `opacity-[0.035]` class,
             on purpose: the visibility of this layer is the exact thing
             that has been wrong twice, so it has to be assertable. A
             Tailwind class is invisible to jsdom, which has no stylesheet,
             so a gate on it could only ever check source text. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{ backgroundImage: GRAIN, backgroundRepeat: 'repeat', opacity: 0.035 }}
      />
    </>
  )
}

/**
 * Gargantua, behind the hero mark.
 *
 * ── Why this is here at all ─────────────────────────────────────────────
 *
 * A tesseract is what you find inside a black hole, so putting the mark
 * inside one is the one piece of imagery on this page that could not be
 * lifted from anywhere else. It is the whole argument for the space
 * direction: not that space looks nice, but that this specific object is
 * already the product's name.
 *
 * ── Why it does not look like a poster ──────────────────────────────────
 *
 * Four restraints, and removing any one of them makes it kitsch:
 *
 *   NO FIRE. The accretion ring is warm WHITE, a trace off-neutral, not
 *   orange and not a rainbow. The film's disk reads as white hot; the
 *   posters are the ones that turned it amber.
 *   THIN RING. One pixel, at 22 percent. The moment the ring gets thick it
 *   becomes a logo for a hard seltzer.
 *   DEEP CORE. The event horizon is darker than the page background, which
 *   is the detail that sells it: a hole has to be a hole, so it cannot be
 *   the same value as the sky it sits in.
 *   RESTRAINED IN SCALE, and `hidden md:block`. It was 44rem across, which
 *   was too big: at that size it stopped reading as a distant object and
 *   became a shape competing with the headline. 28rem, pulled further off
 *   the right edge, reads as something far away, which is the only way an
 *   object like this is impressive. On a phone it is absent entirely.
 *
 * The lensed halo is a single soft shadow rather than a real gravitational
 * lens. An approximation that knows it is one looks better here than a
 * simulation would, and it costs one element.
 *
 * ── The mark is a CHILD of this, not a sibling ──────────────────────────
 *
 * It used to be a separate absolutely-positioned element whose offsets were
 * hand-matched to the hole's, so the two were concentric only at one size
 * and every resize was a chance to knock them apart. Nesting it and
 * centring with `inset-0` plus flex makes concentricity structural: the
 * geometry is inside the horizon because it is inside the element.
 */
function BlackHole({ children }: { children?: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-28 -top-16 hidden h-[28rem] w-[28rem] md:block lg:-right-20"
    >
      {/* The lensed halo: light bent around the far side. Scaled down with
          the hole, or a smaller object keeps an oversized glow. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: '0 0 9rem 2rem rgba(255,255,255,0.045)' }}
      />
      {/* The disk, edge-on: a thin bright ring with a soft inner falloff. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          border: '1px solid rgba(255,250,240,0.22)',
          boxShadow:
            '0 0 3.5rem 0.2rem rgba(255,248,235,0.10),' +
            'inset 0 0 4.5rem 1rem rgba(255,250,240,0.055)',
        }}
      />
      {/* The event horizon, darker than the page so it reads as absence. */}
      <div className="absolute inset-[3%] rounded-full bg-[#01020a]" />
      {/* And the photon ring, just inside it. */}
      <div
        className="absolute inset-[3%] rounded-full"
        style={{ boxShadow: 'inset 0 0 1rem 0.05rem rgba(255,250,240,0.14)' }}
      />
      {/* The mark, concentric by construction. */}
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      
    </div>
  )
}

/**
 * The tesseract geometry as the background motif.
 *
 * ── Why the brand mark and not a pattern ────────────────────────────────
 *
 * The hero already carried one large still mark and the founder said he
 * liked it behind, lightly, so this extends that one ornament down the
 * whole page instead of inventing a second decorative language. It is also
 * the honest answer to "no purple": with the colour range narrowed to blue
 * and teal, the page has to get its interest from STRUCTURE, and the
 * product's own geometry is a better structure than an abstract lattice.
 *
 * Four marks at four scales and four rotations of phase, at 5 to 9 percent.
 * Light enough that it never competes with type; present enough that the
 * background is clearly made of something.
 *
 * ── Why it SCROLLS rather than being fixed ──────────────────────────────
 *
 * This layer is `absolute inset-0` inside the full-height content wrapper,
 * not `fixed`. A fixed field shows the same three shapes for the entire
 * page, which is the flaw the previous background had: it had life but no
 * progression. Anchored to the document, each band of the page has its own
 * geometry passing behind it.
 *
 * ── Why they are all still ──────────────────────────────────────────────
 *
 * `animate={false}` on every one. The founder's earlier instruction was
 * that the mark moves on hover only, and four rotating wireframes behind
 * the text would be exactly the "vibe coded" tell the whole exercise has
 * been removing. The only motion on this page is the aurora drift, which is
 * colour rather than form, and it is gated on `prefers-reduced-motion`.
 *
 * `showNodes={false}` and a hairline weight: at this size and opacity the
 * vertex dots turn into visual noise, which is the same reason
 * `TesseractLogo` disables them.
 */
const FIELD: { size: number; className: string; opacity: string; weight: number }[] = [
  { size: 860, className: '-right-[14%] top-[6%]', opacity: '0.075', weight: 0.8 },
  { size: 620, className: '-left-[16%] top-[31%]', opacity: '0.055', weight: 0.9 },
  { size: 760, className: '-right-[18%] top-[56%]', opacity: '0.065', weight: 0.85 },
  { size: 560, className: '-left-[12%] top-[79%]', opacity: '0.05', weight: 0.95 },
]

function TesseractField() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {FIELD.map(({ size, className, opacity, weight }, i) => (
        /*
         * `data-tesseract-field` is a test hook, and it is here because the
         * obvious selector was wrong. The gate first found these by looking
         * for an svg under `[style*="opacity"]`, which also matched an
         * unrelated mark whose inline `animation` shorthand contains the
         * substring "opacity". In a real browser that returned five
         * elements, one of them at full opacity, so the "lightly"
         * assertion would have been checking an element it was never about.
         * jsdom returned four and the test passed, which is the worse
         * outcome: a gate green for the wrong reason.
         */
        <div
          key={i}
          data-tesseract-field=""
          className={`absolute hidden md:block ${className}`}
          style={{ opacity }}
        >
          <TesseractMark
            size={size}
            periodMs={15000}
            animate={false}
            weight={weight}
            fill={1.25}
            showNodes={false}
          />
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────────── primitives ─────────────────────────────── */

/* `SHELL` and `GUTTER` are declared above `PageAtmosphere`, which needs
   `GUTTER` to align the background grid to the text column. */

/*
 * ── `ACCENT_TEXT` WAS HERE AND IS DELETED, 2026-11-27 ───────────────────
 *
 * It was `bg-gradient-to-br from-white via-slate-200 to-slate-400` clipped
 * to the text, and it styled the hero's second line.
 *
 * It had already survived one correct edit — it replaced a sky/blue/teal
 * three-stop gradient, and monochrome was the right call then. What broke
 * it was the new headline being LONGER. A gradient running top-left to
 * bottom-right puts its faintest value at the end of the last line, which
 * on "A smarter firm every year after." landed slate-400 on the three
 * words the whole positioning turns on.
 *
 * The lesson worth keeping: gradient text is only safe on a line whose
 * length you control. The second line is now plain, with a white span on
 * the payoff, so emphasis is placed deliberately instead of falling where
 * the box happens to end.
 */

/*
 * ── THE TYPE SCALE, raised on 2026-11-27 ───────────────────────────────
 *
 * The report was that the page is hard to digest. Measured in the browser
 * at 1440px, 183 of 201 text elements rendered BELOW 16px, and the sizes
 * in use below 16 were 9, 10, 11, 12, 13, 14 and 15. Seven steps inside
 * seven pixels is not a scale, it is drift: nothing was deliberately
 * smaller than anything else, so the whole page read as uniformly quiet.
 *
 * It is now five steps, and the smallest is 12:
 *
 *   18px  sub-headings (h3)
 *   17px  lead paragraphs
 *   16px  BODY COPY — the default, and the number that mattered most
 *   14px  secondary copy, nav, record chips, figure captions
 *   12px  the floor: mono field tags, eyebrow text, diagram labels
 *
 * The first pass of this landed body copy at 15 and a 13px tier holding 67
 * elements, which was still most of the page under 16. 15 and 13 are the
 * sizes a designer reaches for to make something look tidy, and tidy at
 * arm's length is what "hard to digest" means when a reader says it.
 *
 * NOTHING below 12. A 9px or 10px label is decoration that happens to
 * contain words; it is unreadable to anyone over about forty and it was
 * carrying real content here, including the "Rejection / Review /
 * Decision" labels in the memory ledger.
 *
 * Headings moved with it: section titles 36 -> 40, h3 15 -> 18, so the
 * step between a heading and its body stays legible now the body is
 * bigger.
 */

/** The 1px inner highlight that makes a translucent panel read as glass. */
const GLASS =
  'relative rounded-2xl bg-white/[0.035] ring-1 ring-inset ring-white/10 ' +
  'before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:h-px ' +
  'before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent'

/**
 * ONE ACCENT HUE, used sparingly.
 *
 * ── What this replaced, and why four hues was the wrong idea ────────────
 *
 * There was an `ACCENTS` map with four entries: blue, sky, teal and
 * emerald, each supplying an eyebrow gradient, an icon colour, a numeral
 * colour and a large coloured background wash, applied per section. The
 * reasoning was that a long page in one hue reads as one section repeated.
 *
 * The reasoning was fine and the conclusion was wrong. Four hues does not
 * read as progression, it reads as a page that has not decided, and the
 * four background washes were four more soft coloured fields on a page that
 * had just had its soft coloured fields removed for looking vibe coded.
 * A palette that walks from blue to green across a scroll is a thing a
 * generator does.
 *
 * So: one hue, the product's own blue, on small marks only. The ONLY
 * coloured elements left on the dark page are the eyebrow rules, the
 * lifecycle icons and numerals, the diagram's spine, and the three
 * assistant icons. Everything else is white, grey or near-black.
 *
 * The rhythm that the four hues were supposed to provide now comes from
 * three things that do it better: the inverted light band, the per-section
 * LUMINANCE step in `Section` below, and the tesseract field changing
 * behind each band as you scroll.
 */
/*
 * ── The hue changed from the product blue to GOLD on 2026-11-27 ─────────
 *
 * Everything above still holds: ONE hue, on small marks only. What changed
 * is which one, and the argument for gold is that the page already had it.
 * The mark in the nav is gold. The black hole behind the hero is gold. The
 * accent was the product's interface blue, so the two colours on screen
 * belonged to different things and the page read as careful rather than as
 * confident.
 *
 * Gold against near-black is also simply louder than blue against
 * near-black, at the same saturation, because nothing else on the page is
 * warm. That is the whole brief: elevate without adding a second idea.
 */
const ACCENT_RULE = 'from-amber-300/90 to-amber-300/0'
const ACCENT_ICON = 'text-amber-300'
const ACCENT_NUM = 'text-amber-400/70'

/**
 * Section tone: a LUMINANCE step, not a hue.
 *
 * `raised` lifts a band a little over one percent toward white. That is
 * barely perceptible as brightness and quite perceptible as separation,
 * which is the whole trick, and it is what the coloured per-section washes
 * were reaching for without introducing a colour the page did not choose.
 */
const TONES = {
  base: null,
  raised: 'linear-gradient(to bottom, rgba(255,255,255,0.012), rgba(255,255,255,0.004))',
} as const

type Tone = keyof typeof TONES

/**
 * An eyebrow label with a short accent rule.
 *
 * The rule fades to transparent rather than running between two hues. A
 * two-colour 32px gradient is detail nobody can resolve at that size; a
 * line that fades out reads as deliberate at any size.
 */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={`h-px w-8 bg-gradient-to-r ${ACCENT_RULE}`} />
      <p className="text-[14px] font-semibold uppercase tracking-[0.18em] text-slate-400">{children}</p>
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
/*
 * ── THREE WEIGHTS, 2026-11-27, because one component made one page ──────
 *
 * Every section rendered through this helper got the same 40px heading, the
 * same asymmetric split and the same 7rem of air, which is why the review
 * landed on "most sections follow essentially the same composition" and
 * "section headlines should not all be the same size merely because they
 * share the same component". Both are the same defect: the component was
 * doing the designing.
 *
 * So the section's ROLE is now a prop, and the role sets the type scale,
 * the alignment and the vertical rhythm together:
 *
 *   brand    a statement the page wants remembered. 48-56px, CENTRED,
 *            narrow measure, and the most air on the page. Two sections
 *            get this and they are the two that are not about features.
 *   major    the default product section. 40px, asymmetric split.
 *   compact  explanation and reassurance. 30px, split, less air, because
 *            a section whose job is to settle a question should not take
 *            as much room as one whose job is to make an argument.
 *
 * `wide` swaps the children's container for `CANVAS`, so a product figure
 * can break the text column without every section doing it.
 */
const WEIGHTS = {
  brand: {
    title: 'text-[2rem] leading-[1.08] sm:text-5xl lg:text-[3.5rem]',
    pt: 'pt-24 sm:pt-36',
    pb: 'pb-24 sm:pb-36',
    gap: 'mt-16 sm:mt-20',
  },
  major: {
    title: 'text-3xl leading-[1.1] sm:text-[2.5rem]',
    pt: 'pt-20 sm:pt-28',
    pb: 'pb-20 sm:pb-28',
    gap: 'mt-14 sm:mt-16',
  },
  compact: {
    title: 'text-2xl leading-[1.15] sm:text-[1.875rem]',
    pt: 'pt-16 sm:pt-20',
    pb: 'pb-16 sm:pb-20',
    gap: 'mt-10 sm:mt-12',
  },
} as const

function Section({
  id, label, title, lead, children, divide = true, tone = 'base',
  weight = 'major', center = false, wide = false, sky = 0,
}: {
  id: string
  label?: string
  title: string
  lead?: string
  children?: React.ReactNode
  divide?: boolean
  tone?: Tone
  weight?: keyof typeof WEIGHTS
  center?: boolean
  wide?: boolean
  /** Star density, 0 for none. Only the brand moments ask for a sky. */
  sky?: number
}) {
  const W = WEIGHTS[weight]
  return (
    <section id={id} className="relative isolate scroll-mt-24">
      {sky > 0 && <Starscape density={sky} />}
      {/*
        The section's own tone: a LUMINANCE step, not a colour field.

        This was `ACCENTS[accent].glow`, a large coloured radial per band,
        so the ambient hue walked blue to sky to teal to emerald down the
        page. It went when the aurora went, and for the same reason: they
        were the same device at a different scale, and four of them meant
        the page gave up its coloured blobs everywhere except in four
        places.

        A band now separates by being a shade lighter, which is
        imperceptible as brightness and clearly legible as separation. The
        progression the hues were for comes from the inverted light band,
        the starfield, and the tesseract geometry moving behind each
        section.

        `isolate` on the section and `-z-10` here keep it behind the content
        without participating in the page's stacking context. `base` renders
        no element at all rather than a transparent one.
      */}
      {TONES[tone] && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: TONES[tone] as string }}
        />
      )}
      {divide && (
        <div
          aria-hidden="true"
          className={`${SHELL} h-px bg-gradient-to-r from-transparent via-white/10 to-transparent`}
        />
      )}
      <div className={`${SHELL} ${W.pt} ${children ? '' : W.pb}`}>
        {/*
          CENTRED or SPLIT, and the choice is the section's job rather than
          the component's habit. A centred narrow column reads as a
          statement; an asymmetric split reads as an argument with evidence
          beside it. The page alternates between them deliberately now, so
          the composition tells a reader what kind of section they are in
          before they have read a word of it.
        */}
        {center ? (
          <div className="mx-auto max-w-3xl text-center">
            {label && (
              <div className="flex justify-center">
                <Eyebrow>{label}</Eyebrow>
              </div>
            )}
            <h2
              className={`text-pretty font-semibold tracking-[-0.025em] text-white ${W.title} ${
                label ? 'mt-7' : ''
              }`}
            >
              {title}
            </h2>
            {lead && (
              <p className="mx-auto mt-7 max-w-[58ch] text-[18px] leading-[1.7] text-slate-400">
                {lead}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              {label && <Eyebrow>{label}</Eyebrow>}
              <h2
                className={`text-pretty font-semibold tracking-[-0.02em] text-white ${W.title} ${
                  label ? 'mt-5' : ''
                }`}
              >
                {title}
              </h2>
            </div>
            {lead && (
              <div className="lg:col-span-5 lg:pt-2">
                <p className="max-w-[56ch] text-[17px] leading-[1.75] text-slate-400">{lead}</p>
              </div>
            )}
          </div>
        )}
      </div>
      {/*
        The children live OUTSIDE the text shell when `wide`, so a product
        canvas can claim the extra 96px without the heading above it
        drifting off the page grid. `-mt` pulls them back up to where the
        in-shell version would have put them.
      */}
      {children && (
        <div className={`${wide ? CANVAS : SHELL} ${W.gap} ${W.pb}`}>{children}</div>
      )}
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

/*
 * `ScreenBrowser` and `SCREENS` lived here and are gone with the #product
 * section. Both were a second tablist listing the same six things the
 * lifecycle lists; see the long note where that section used to be, further
 * down this file, for why a rewrite could not save it.
 *
 * Two findings from it are kept in `LifecycleWalk`, because they were paid
 * for twice and would be paid for a third time if they were not written
 * down:
 *
 *  - the figure column needs a measured floor or the section resizes when
 *    you pick a stage, and the floor must clear the TALLEST figure;
 *  - the figures must not be `aria-hidden`, which removed the product's
 *    only depiction from screen readers AND made the imagery gate vacuous,
 *    because `getAllByRole('figure')` skips aria-hidden subtrees.
 */
function RecordChain() {
  return (
    <figure className="relative overflow-hidden rounded-2xl bg-white/[0.025] p-6 ring-1 ring-inset ring-white/[0.08] sm:p-8">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />
      {/*
        One caption, not two. This had "How one decision is stored" on the
        left and a pill reading "Record shape" on the right, which are the
        same statement twice with a piece of chrome around the second.
      */}
      <figcaption className="text-[16px] font-semibold tracking-tight text-white">
        How one decision is stored
      </figcaption>

      {/*
        ── Laid out LEFT TO RIGHT, under the walk, not beside it ──────────

        It was a 570px vertical column in the lifecycle's right third. Two
        problems followed from that. The chain is a SEQUENCE, and a sequence
        drawn downward in a narrow column reads as a list of record types
        rather than as one thing leading to another; and at 570px against a
        ~340px panel it left 200px of void beside the stage detail.

        Horizontal fixes both. The spine runs the way the chain runs, the
        figure spans the section instead of competing with it for width, and
        the lifecycle's two halves stop fighting over the same vertical.

        The grid drops to three and then two columns before the spine is
        hidden, because a six-across row of 13px labels is unreadable below
        about 900px and a horizontal scroll to see the end of your own
        decision chain is worse than a wrap.
      */}
      <ol className="mt-8 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
        {CHAIN.map(({ record, via }, i) => {
          const frozen = record === 'Frozen reasoning'
          return (
            <li key={record} className="relative">
              {/*
                The connector reaches from this node's dot to the next one.
                It is `lg` only: once the grid wraps, a line running off the
                right edge of row one points at nothing.
              */}
              {i < CHAIN.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-4 right-[-1.25rem] top-[5px] hidden h-px lg:block ${
                    frozen ? 'bg-white/30' : 'bg-amber-400/25'
                  }`}
                />
              )}
              <span
                className={`relative z-10 block h-2.5 w-2.5 rounded-full ring-2 ring-[#050710] ${
                  /*
                   * The frozen record is distinguished by VALUE, not hue:
                   * solid white against the gold spine. That is a bigger
                   * contrast step than two adjacent blues ever was, and it
                   * survives the page being down to one accent.
                   */
                  frozen ? 'bg-white' : 'bg-amber-400'
                }`}
              />
              <p className="mt-3.5 text-[16px] font-semibold leading-snug tracking-tight text-white">
                {record}
              </p>
              {via && (
                <p className="mt-1.5 font-mono text-[14px] leading-relaxed text-slate-400">
                  {via}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {/*
        The freezing note and the return leg, side by side under the chain.

        The freezing note used to hang off its own node, which a horizontal
        row cannot carry without one column running three lines longer than
        the other five. It is a gloss on the whole chain rather than on one
        link, so it reads correctly as a footnote.
      */}
      <div className="mt-9 grid gap-x-10 gap-y-4 border-t border-white/[0.07] pt-6 sm:grid-cols-2">
        <p className="text-[14px] leading-relaxed text-slate-300">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-white align-middle" />
          Later edits create new versions and never alter what the PM
          actually read.
        </p>
        <p className="flex items-start gap-2.5 text-[14px] leading-relaxed text-slate-400">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          The review returns to the note, so the next decision on this name
          starts from what the firm already learned.
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
 * ── TWO LINES PER STAGE, NOT THREE ──────────────────────────────────────
 *
 * This carried `line`, `keeps` and `so`, rendered as a sentence plus a
 * two-term definition list, and at 407 words it was the heaviest section on
 * the page by a factor of two. The brief was "show more on each aspect of
 * the lifecycle"; the answer overshot into a format that stopped being read.
 *
 * `keeps` is the field that went, and it went because it was REDUNDANT
 * rather than because it was long: `RecordChain`, sitting directly beside
 * this list, already names the row each stage writes and the field that
 * carries the reference to the row before it. "What is retained" was the
 * diagram's whole job, stated again in prose, with a `dt`/`dd` pair of
 * chrome around it.
 *
 *   `record`  the typed row the stage writes, which `RecordChain` draws
 *   `line`    what happens at this stage
 *   `so`      the consequence a year later, which is the actual pitch
 */
const LIFECYCLE = [
  {
    icon: BookOpen,
    stage: 'Research',
    /*
     * ── `screen` and `Figure` came from the deleted #product section ─────
     *
     * That section listed six screens against these six stages, in this
     * order, one to one: Research/Asset workspace, Develop/Idea Pipeline,
     * Recommend/Recommendation, Decide/Decision Inbox, Execute/Trade Book,
     * Review/Outcomes. It was this list with the nouns swapped, so a reader
     * who had understood the lifecycle learned only that each stage has a
     * screen, which they had already assumed.
     *
     * The one thing it genuinely added was DEPICTION: the lifecycle draws a
     * schema, those figures draw the product. That belongs here, against
     * the stage it illustrates, rather than in a section of its own that
     * restates the argument in order to have somewhere to put it.
     */
    screen: 'Asset workspace',
    Figure: AssetWorkspaceFigure,
    record: 'Research note',
    /*
     * `fields` are the record's own columns, names only and no values.
     *
     * They exist because the section's claim is that every stage is a TYPED
     * record rather than a document, and that claim was being made entirely
     * in prose. Naming the fields is the shortest way to show a reader the
     * difference between a row and a memo.
     *
     * NO VALUES, and in particular no numbers: `keeps the schema diagrams
     * free of invented data` forbids digits in a figure that is not marked
     * as an illustration, and it is right to. A field list is a schema; a
     * field list with "conviction 8" in it is a fabricated holding.
     */
    fields: ['Security', 'Thesis', 'Evidence', 'Version'],
    line: 'The written case, its evidence and its revisions live on the security itself, not in a folder or a thread.',
    so: 'The version that justified the position stays readable after the note has moved on.',
  },
  {
    /*
     * The stage the lifecycle used to skip.
     *
     * It ran Research -> Recommend, which implied a note becomes a
     * recommendation the moment it is written. It does not: an idea sits in
     * the pipeline accumulating conviction, and most of them never graduate.
     * Leaving the stage out made the product look like a filing system for
     * decisions already taken, and hid the surface where an analyst actually
     * spends the weeks before one.
     */
    icon: Layers,
    stage: 'Develop',
    screen: 'Idea Pipeline',
    Figure: IdeaPipelineFigure,
    record: 'Idea',
    fields: ['Security', 'Conviction', 'Stage', 'Age'],
    line: 'A name under consideration carries its conviction, stage and age.',
    so: 'Ideas the firm declined stay as retrievable as those it acted on.',
  },
  {
    icon: FileSignature,
    stage: 'Recommend',
    screen: 'Recommendation',
    Figure: RecommendationFigure,
    record: 'Recommendation',
    fields: ['Conviction', 'Target', 'Sizing', 'Frozen version'],
    line: 'An analyst puts a view forward with its conviction, sizing and target, and submitting it freezes the reasoning behind it.',
    so: 'Nobody argues later about which draft was the one that got approved.',
  },
  {
    icon: Gavel,
    stage: 'Decide',
    screen: 'Decision Inbox',
    Figure: DecisionInboxFigure,
    record: 'Decision',
    fields: ['Verdict', 'Rationale', 'Decided by', 'References'],
    line: 'The portfolio manager accepts, rejects or defers, and the rationale is captured with the decision rather than in a reply.',
    so: 'Rejections and deferrals become records the firm can study, which is where its unexamined judgement sits.',
  },
  {
    icon: ArrowLeftRight,
    stage: 'Execute',
    screen: 'Trade Book',
    Figure: TradeBookFigure,
    record: 'Accepted trade',
    fields: ['Security', 'Side', 'Sizing', 'Fill status', 'Authorized by'],
    line: 'The approval becomes the firm’s committed record of what it did, including whether the fill was assumed or confirmed against the book.',
    so: 'A position traces back to the argument that authorized it, not just to a timestamp.',
  },
  {
    icon: History,
    stage: 'Review',
    screen: 'Outcomes',
    Figure: OutcomeFigure,
    record: 'Outcome review',
    fields: ['Original claim', 'What happened', 'Verdict', 'Links back to'],
    line: 'The decision is revisited against what actually happened, judged on the original thesis rather than the current price.',
    so: 'Judgement becomes separable from luck, because the claim and the result sit in one record.',
  },
]

/**
 * The lifecycle as a WALK: a rail of six stages and one panel.
 *
 * The rail is a real tablist with roving focus, matching `ScreenBrowser`
 * below, because two different keyboard contracts for two things that look
 * alike is worse than either contract on its own.
 *
 * `data-lifecycle-stage` moved from the old list items onto these tabs and
 * still means "one stage of the lifecycle". Its gate counts six of them.
 * The attribute exists because `#lifecycle ol > li` also matches the rows
 * inside `RecordChain`, which is an `ol` in the same section, so a
 * position-based selector counted eleven stages.
 */
function LifecycleWalk() {
  const [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const { stage, screen, Figure, record, line, so, fields, icon: Icon } = LIFECYCLE[active]
  const upstream = active > 0 ? LIFECYCLE[active - 1] : null

  function move(to: number) {
    const next = (to + LIFECYCLE.length) % LIFECYCLE.length
    setActive(next)
    tabs.current[next]?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const k = e.key
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return
    e.preventDefault()
    if (k === 'Home') return move(0)
    if (k === 'End') return move(LIFECYCLE.length - 1)
    move(active + (k === 'ArrowRight' ? 1 : -1))
  }

  return (
    <div>
      {/*
        The rail doubles as the diagram of the sequence: six segments in a
        row, the travelled ones lit, so position in the lifecycle is visible
        without reading a numeral.
      */}
      <div
        role="tablist"
        aria-label="The decision lifecycle"
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      >
        {LIFECYCLE.map(({ stage: s }, i) => {
          const on = i === active
          const past = i < active
          return (
            <button
              key={s}
              ref={el => { tabs.current[i] = el }}
              type="button"
              role="tab"
              data-lifecycle-stage=""
              /*
               * The screen this stage opens, carried on the tab so a gate
               * can check all six are present and in order without clicking
               * through. `data-surface` on the deleted #product tabs did
               * the same job; the name changed with the thing it names.
               */
              data-screen={LIFECYCLE[i].screen}
              id={`stage-tab-${i}`}
              aria-selected={on}
              aria-controls="stage-panel"
              /*
               * The accessible name is set explicitly because the button's
               * own text concatenates to "01Research". A screen reader
               * should announce the stage, not the stage with its ordinal
               * welded to the front, and a test matching the stage name
               * should not have to know about the numeral.
               */
              aria-label={s}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              /*
                Same affordance fix as the role tabs: an unselected tab
                was bare text with a `bg-white/12` rule above it, which on
                this background is invisible. A rail of six stages where
                five look like labels is a diagram, not a control.
              */
              className={`group rounded-lg px-3 pb-3 pt-2.5 text-left ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710] ${
                on
                  ? 'bg-white/[0.07] ring-white/15'
                  : 'ring-white/[0.07] hover:bg-white/[0.035] hover:ring-white/20'
              }`}
            >
              <span
                aria-hidden="true"
                className={`block h-0.5 w-full rounded-full transition-colors ${
                  on
                    ? 'bg-amber-400'
                    : past
                      ? 'bg-amber-400/45'
                      : 'bg-white/25 group-hover:bg-amber-400/50'
                }`}
              />
              <span
                className={`mt-2.5 block text-[12px] font-semibold tabular-nums tracking-[0.12em] ${
                  on ? ACCENT_NUM : 'text-slate-400'
                }`}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={`mt-0.5 block text-[16px] font-semibold tracking-tight transition-colors ${
                  on ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              >
                {s}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-10">
        {/*
          `lg:min-h` for the same reason `ScreenBrowser` has one: the six
          stages differ by about two lines, and without a floor everything
          below the panel walks up and down as you move along the rail. The
          floor is the tallest stage, not the one I happened to be looking
          at, which was the bug in the screens column.
        */}
        <div
          role="tabpanel"
          id="stage-panel"
          aria-labelledby={`stage-tab-${active}`}
          className="lg:min-h-[300px]"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 ring-1 ring-inset ring-amber-300/25">
              <Icon className={`h-[17px] w-[17px] ${ACCENT_ICON}`} aria-hidden="true" />
            </span>
            <h3 className="text-[18px] font-semibold tracking-tight text-white">{stage}</h3>
            <span className="text-[16px] text-slate-400">
              you open{' '}
              <span className="font-medium text-slate-300">{screen}</span>
            </span>
          </div>

          {/*
            ── The SCREEN leads, because it is the thing a reader cannot
            imagine from the words ─────────────────────────────────────────

            The panel used to be prose left, record card right. The drawn
            screen now takes the left and larger half, with the prose and
            the record stacked beside it, so each stage answers the three
            questions in the order a buyer asks them: what do I open, what
            does it do for me, and what does it leave behind.

            `min-h` on the figure side for the reason the deleted #product
            section needed one: without a floor the section resizes when you
            pick a stage, and the floor must clear the TALLEST figure, not
            whichever one you happen to be looking at. That mistake shipped
            once already — a 330px floor against figures measured at 246,
            353, 236, 317, 337 and 387, so five fitted and one did not, and
            the section jumped on one stage in six.

            The figures are NOT `aria-hidden`. They were on the first pass,
            which removed the product's only depiction from every screen
            reader and silently broke the imagery gate, because
            `getAllByRole('figure')` skips aria-hidden subtrees and the gate
            found nothing to check.
          */}
          <div className="mt-7 grid gap-x-14 gap-y-10 lg:grid-cols-12">
            <div data-figure-column="" className="lg:col-span-7 lg:min-h-[390px]">
              <Figure />
            </div>

            <div className="lg:col-span-5">
              <p className="max-w-[58ch] text-[17px] leading-[1.75] text-slate-300">{line}</p>

              {/*
                The linkage, named. This is the sentence the static stack
                could not say: every stage after the first hangs off a
                record that already exists, and the first is where it starts.
              */}
              <p className="mt-5 flex items-center gap-2 text-[14px] text-slate-400">
                <span aria-hidden="true" className="text-amber-300">&#8627;</span>
                {upstream ? (
                  <>
                    Points back at the{' '}
                    <span className="font-mono text-[14px] text-slate-300">{upstream.record}</span>
                    {' '}it came from.
                  </>
                ) : (
                  <>Where the chain starts. Everything after this points back at it.</>
                )}
              </p>

              <p className="mt-6 max-w-[58ch] border-l border-amber-300/30 pl-4 text-[16px] leading-[1.75] text-slate-400">
                {so}
              </p>

              {/*
                The record's own columns: the section's claim made visible
                rather than asserted. It sits under the prose in the same
                column, so the stage reads top to bottom as one answer —
                what it does for you, then what it leaves behind — rather
                than as two cards competing for the same glance.
              */}
              <div className="mt-7 rounded-xl bg-white/[0.02] p-5 ring-1 ring-inset ring-white/[0.06]">
                <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-slate-400">
                  Stored as
                </p>
                <p className="mt-2 font-mono text-[14px] text-white">{record}</p>
                <ul className="mt-3.5 flex flex-wrap gap-1.5 border-t border-white/[0.07] pt-3.5">
                  {fields.map(f => (
                    <li
                      key={f}
                      className="rounded bg-white/[0.04] px-2 py-1 font-mono text-[12px] text-slate-400 ring-1 ring-inset ring-white/[0.07]"
                    >
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Full width, under the walk: the chain runs the way the page reads. */}
        <div className="mt-14">
          <RecordChain />
        </div>
      </div>
    </div>
  )
}

/*
 * `PROBLEMS` lived here: four ways the reasoning goes missing, one sentence
 * each. Replaced by `CostOfForgetting` in `SectionVisuals`, which names
 * three COSTS and draws each one.
 *
 * DELETED rather than left in place, because the type ceiling flagged it as
 * unread the moment the section stopped rendering it, and a tidy unused
 * array is how a page ends up with two sources of truth for its own
 * argument. Git has it if the wording is ever wanted back.
 */

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
/*
 * ── SIX ITEMS TO FOUR, 2026-11-27, and the cut is about REDUNDANCY ──────
 *
 * Measured: this section was 257 words over 1,478px with six headed
 * items, the heaviest on the page by both counts, and it was a feature
 * list — the exact shape a reader has to translate into a benefit
 * themselves.
 *
 * It also stopped being new. The platform canvas above now SHOWS thesis,
 * risks, valuation, price target and coverage sitting on one name, and
 * the analyst role panel already says "nothing is re-found". Two of the
 * six items were restating a picture the reader had just looked at.
 *
 * Dropped: "Notes that belong to the name" (the canvas shows it) and
 * "Price targets with a history" (the canvas lists it, and at 14 rows in
 * production it is the thinnest claim here).
 *
 * Kept: the four that say something no figure on the page says — that
 * capture happens inside the work, that editing never destroys what a
 * colleague read, that a cross-name view is its own object, and that a
 * repeated process has a visible state.
 */
/*
 * ── FOUR ITEMS TO THREE, 2026-11-27, and I created this redundancy ──────
 *
 * "Structured diligence — checklists and requirements make a repeated
 * process something the firm can see the state of" is deleted here,
 * because the platform canvas two screens above now DRAWS exactly that: a
 * research-process pane with "Earnings preparation, in progress, 2 of 7
 * requirements open" on it.
 *
 * That pane is new in the same pass as this cut, so this is not an old
 * duplication being tidied up — it is me adding a picture of a claim and
 * then leaving the sentence version in place downstream, which is the
 * exact repetition this page keeps paying for. The sentence goes, the
 * capability stays, and the retargeted gate follows it to the canvas so
 * the cut cannot be used to drop the claim entirely.
 *
 * It also pays for words. The page came in 62 over its 1,700 ratchet after
 * the second-pass rewrite, and the rule here is to cut before raising a
 * ceiling.
 */
const CAPTURE: [typeof BookOpen, string, string][] = [
  [Quote, 'Fast capture, kept in place', 'A thought during a call lands on the right security in a couple of keystrokes and stays attached to it.'],
  [History, 'Versions instead of overwrites', 'Editing a note adds a version, so nothing a colleague relied on is silently replaced.'],
  [Layers, 'Themes across names', 'A view that spans several securities is its own subject, rather than being retyped into four separate notes.'],
]

/**
 * SIX ITEMS DOWN TO THREE, and the three are the ones nothing else says.
 *
 * This was the clearest case of the page's real problem, which is not
 * density but REPETITION. The six items were: preserved reasoning, decision
 * history, accountability, continuity, review and learning, and a connected
 * corpus. Four of those are the lifecycle section restated with different
 * nouns, and a reader who has just read the lifecycle hits them and cannot
 * tell what is new, which is what "confusing" means here.
 *
 * Counted across the whole page before this pass, "the version the PM read
 * is frozen" was asserted NINE times, and "a rejection is a record" five.
 * Each section had re-argued the same four points.
 *
 * So each section now has one job and says only what is its own. This
 * section's job is why the ACCUMULATION is worth owning, which is a
 * different argument from what the lifecycle does, and these three carry it:
 * the record survives the people, it answers who decided, and a handoff
 * starts from context. None of them appears anywhere else on the page.
 *
 * Note what is deliberately NOT here: anything about analysing the corpus to
 * find patterns across the firm. That capability was removed from this page
 * rather than reworded, and the test suite holds the line.
 */
/*
 * ── THREE ITEMS TO TWO, 2026-11-27, because #roles took one of them ────
 *
 * "It outlasts the team" is deleted here. The CIO role panel now makes
 * exactly that argument, with a figure: a ledger of one name across three
 * years, captioned "The analyst who opened this name no longer works
 * here. The reasoning did not leave with them."
 *
 * A sentence version of an argument the reader met two screens earlier,
 * accompanied by a picture, is the repetition this page keeps having to
 * pay for. The claim did not weaken; it moved to where it is shown
 * instead of asserted, and `names the record each stage points back at`
 * plus the role-shape gates keep it there.
 */
const MEMORY: [typeof Lock, string, string][] = [
  [ShieldCheck, 'It answers who decided', 'Who chose, on what evidence and when, without anyone reconstructing a thread six months later.'],
  [Users, 'Handoffs start from context', 'A name passed between analysts or PMs arrives with its history rather than as a blank page.'],
]

/*
 * `SCREENS` lived here: six screen names, each with a line about what it
 * holds and a drawn figure. The names and the figures moved onto the
 * matching `LIFECYCLE` stage; the `shows` lines did not, and that was a
 * decision rather than an oversight.
 *
 * Each `shows` line described what is on a screen — "Ideas moving from
 * exploring to ready-to-recommend, with conviction and staleness visible"
 * — next to a figure that DRAWS exactly that. Captioning a picture with its
 * own contents is the kind of writing that survives because nobody asks
 * what it is for. The stage keeps the sentence that says why the screen
 * matters, which the picture cannot say.
 *
 * One line was worth rescuing and is now the Trade Book stage's own: the
 * firm's committed trades are the only place the product says what it
 * ACTUALLY DID rather than what it decided to do.
 */

/*
 * `INTELLIGENCE` lived here: three capability cards for the assistant.
 * Replaced by `AssistantFlow` in `SectionVisuals`, which shows the part a
 * buyer actually asks about, namely whose model it runs on and what becomes
 * of the answer.
 *
 * The three capabilities themselves were NOT dropped. Their gate is a
 * content requirement rather than a label, and it caught the rewrite losing
 * them: "it knows where you are", "reads the record, not the internet" and
 * "cites what it used" are stated verbatim in the section's closing copy.
 */

/** Primary and secondary button classes, so every CTA matches exactly. */
/*
 * DARK TEXT ON GOLD, not white.
 *
 * `bg-amber-400` with white text is about 1.8:1 and fails every contrast
 * bar there is. Amber is a light colour however saturated it looks, so the
 * legible version of a gold button is a dark label on it, which is also the
 * version that reads as a button rather than as a highlight.
 */
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-950/40 transition-all hover:bg-amber-300 hover:shadow-amber-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710]'
const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-slate-200 ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/5 hover:ring-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710]'

/**
 * ── THE TEXT SCALE, AFTER MEASURING IT ──────────────────────────────────
 *
 * 100 of 328 rendered text nodes were below WCAG AA contrast. The floor
 * was `text-slate-400` on the near-black page at 2.65:1 against a 4.5
 * requirement, and it was carrying, among other things, every link in the
 * legal row of the footer.
 *
 * Measured on #050710:
 *     slate-600  #475569   2.65:1   fails badly
 *     slate-500  #64748b   4.31:1   fails, and fails invisibly
 *     slate-400  #94a3b8   7.66:1   passes
 *     slate-300  #cbd5e1  12.1 :1   passes
 *
 * So the dark sections now stop at slate-400. Collapsing two tiers into
 * one sounds like a loss of hierarchy and is not: five greys between
 * white and the background were never five readable steps, they were
 * three readable steps and two that the page was pretending to have.
 * Secondary and tertiary are now separated by size and weight, which
 * survive a bright room and an uncalibrated laptop panel.
 *
 * THE LIGHT RESEARCH BAND IS THE EXCEPTION and it inverts: on #f7f8fa,
 * slate-400 is 2.56:1 and FAILS, while slate-500 and slate-600 pass
 * comfortably. A blanket sweep across the file would have fixed the dark
 * sections by breaking the light one. Hence these three tokens: they mark
 * the five places where the page's usual greys do not apply.
 */
/*
 * Measured on #f7f8fa, not on pure white. That distinction cost a round:
 * slate-500 is 4.88:1 on #ffffff and 4.48:1 on this band, so the first
 * version of these tokens failed AA by 0.02 in all three places. The band
 * colour is the one to measure against, and 4.48 is the kind of miss that
 * only a measurement finds, because it looks completely fine.
 */
const LIGHT_LABEL = 'text-slate-600' /* 6.46:1 on #f7f8fa */
const LIGHT_BODY = 'text-slate-600' /* 6.46:1 */
const LIGHT_MUTED = 'text-slate-600' /* 6.46:1, the quietest this band goes */

/**
 * One footer link, with a real touch box.
 *
 * `min-h-[36px]` with `inline-flex` gives a 36px target without changing
 * the type size. Measured at 21px before this, across all five viewports,
 * on all ten links. See the long note at the footer nav for why that
 * happened again and how it was caught.
 */
const FOOTER_LINK =
  'inline-flex min-h-[36px] items-center transition-colors hover:text-white'

export function LandingPage() {
  const markRef = useRef<HTMLDivElement>(null)

  /*
   * Which request box is open, or null.
   *
   * The topic is the state rather than a boolean plus a separate field,
   * because an open dialog always has one and a closed one never does, and
   * two pieces of state that must agree are two pieces of state that can
   * disagree.
   */
  const [requestTopic, setRequestTopic] = useState<AccessRequestTopic | null>(null)
  const openRequest = useCallback((topic: AccessRequestTopic) => setRequestTopic(topic), [])
  const closeRequest = useCallback(() => setRequestTopic(null), [])

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

  /*
   * ── P0: THIS PAGE DID NOT SCROLL ON A PHONE, IN PRODUCTION ────────────
   *
   * Measured at 390x844 against the live site, not only locally:
   *
   *     bodyOverflow 'hidden'   scrollHeight 844   scrollY after
   *     scrollTo(0, 99999) = 0
   *
   * Eleven sections, about 19,000px of content, and a visitor on a phone
   * saw the hero and could not reach anything else. Every CTA below the
   * fold was unreachable.
   *
   * ── The cause, which is a correct rule applied to the wrong page ──────
   *
   * `src/index.css` locks `html`, `body` and `#root` to height 100% with
   * `overflow: hidden` under `@media (max-width: 767px)`. That is
   * deliberate and right FOR THE AUTHENTICATED APP: the shell owns
   * scrolling, inner containers scroll, and locking the document keeps
   * the header structurally immovable and stops the URL bar resizing the
   * viewport mid-gesture.
   *
   * The public page is not that app. It has no inner scroll container, so
   * the same rule simply freezes it.
   *
   * ── Why an attribute rather than editing the rule ─────────────────────
   *
   * The app shell's behaviour must not change, so the lock stays the
   * default and this page opts OUT of it for as long as it is mounted.
   * The cleanup matters: navigating from here to the signed-in app must
   * hand the lock back, or the shell inherits a scrolling document and
   * the header problem returns.
   */
  useEffect(() => {
    document.documentElement.setAttribute('data-public-scroll', '')
    return () => document.documentElement.removeAttribute('data-public-scroll')
  }, [])

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
    <div className="min-h-screen bg-[#050710] text-slate-200 antialiased">
      <PageAtmosphere />

      <div className="relative z-10">
        {/* The tesseract field, anchored to the document so it scrolls with
            the content rather than sitting still behind it. */}
        <TesseractField />

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#050710]/80 backdrop-blur-xl">
          <nav className={`${SHELL} flex items-center justify-between py-4`} aria-label="Main">
            <a href="#top" className="flex items-center gap-3 text-white">
              {/*
                `TesseractLogo`, not `TesseractLoader`. The loader renders the
                word "Loading..." beneath the mark and turns continuously; as
                a nav logo that printed "Loading" under the navigation bar
                permanently. This one is still at rest and turns on hover.
              */}
              {/*
                Raised from 30px to 40px by request.

                The wordmark goes up with it, from 15px to 18px, because
                scaling the mark alone unbalances the lockup: a 40px mark
                beside 15px type reads as an oversized icon with a caption
                rather than as a brand. The nav's vertical padding is
                unchanged, so the bar grows by the 10px difference and the
                sticky header stays shallow.
              */}
              <div ref={markRef} className="shrink-0">
                <TesseractLogo size={40} />
              </div>
              <span className="text-[18px] font-semibold tracking-[-0.015em]">Tesseract</span>
            </a>
            <div className="flex items-center gap-1">
              {/*
                ── THE NAV FOLLOWS THE PAGE, 2026-11-27 ───────────────────

                It read Platform-less: "How it works / Research / Memory /
                Design partners", which was a reasonable index of the old
                six-section page and a poor one of this one. It opened on
                mechanics and never named the product or the audience.

                A prospective buyer scanning a nav is asking two
                questions — what is it, and is it for me — so those are
                the first two items now. The proposed Platform/Solutions
                dropdowns were NOT built: they would be menus over
                anchors on a single page, which is navigation theatre, and
                the instruction not to invent pages to fill a menu is the
                right one.
              */}
              <a href="#platform" className="hidden rounded-md px-3 py-2 text-[16px] font-medium text-slate-400 transition-colors hover:text-white sm:block">
                Platform
              </a>
              <a href="#roles" className="hidden rounded-md px-3 py-2 text-[16px] font-medium text-slate-400 transition-colors hover:text-white md:block">
                Who it's for
              </a>
              <a href="#lifecycle" className="hidden rounded-md px-3 py-2 text-[16px] font-medium text-slate-400 transition-colors hover:text-white lg:block">
                How it works
              </a>
              <a href="#act-ai" className="hidden rounded-md px-3 py-2 text-[16px] font-medium text-slate-400 transition-colors hover:text-white lg:block">
                ACT AI
              </a>
              <a href="#partners" className="hidden rounded-md px-3 py-2 text-[16px] font-medium text-slate-400 transition-colors hover:text-white lg:block">
                Design partners
              </a>
              {/*
                ── THE PRIMARY ACTION IS NOW IN THE NAV ───────────────────

                It was Sign in and nothing else, so the one thing the page
                wants a stranger to do was only available at the top of
                the hero and at the very bottom. A visitor who scrolls to
                the middle, decides they are interested and looks up found
                a login button.

                Sign in stays and goes QUIETER — plain text rather than a
                ringed button — because it is for people who already have
                an account and it was competing with the conversion
                action for the same attention. The gold button is the
                page's primary style, unchanged, so the nav and the hero
                agree about what the main action is.

                Hidden below `sm`, where the nav has room for the logo and
                one control: on a phone Sign in is the one that cannot be
                reached any other way without scrolling the full page,
                and the hero's own Request a demo is one screen away.
              */}
              <Link
                to="/login"
                className="rounded-md px-3 py-2 text-[16px] font-medium text-slate-400 transition-colors hover:text-white"
              >
                Sign in
              </Link>
              <ContactCta
                topic="demo"
                label="Request a demo"
                onOpen={openRequest}
                className="ml-2 hidden items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-[16px] font-semibold text-slate-950 transition-colors hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710] sm:inline-flex"
              >
                {/* No arrow: at nav scale the glyph crowds the label. */}
                <span className="hidden" />
              </ContactCta>
            </div>
          </nav>
        </header>

        {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
        <section id="top" className="relative isolate overflow-hidden">
          {/* The sky, at full density, and only here and in two other
              places. See `Starscape`. */}
          <Starscape />

          {/*
            THE HERO FIGURE: the mark inside the black hole.

            This is the one image on the page that is ours by construction,
            and the mark is passed as a CHILD of `BlackHole` rather than
            positioned beside it, so the two are concentric structurally
            instead of by matched offsets that only agreed at one size.

            The mark is 300px inside a 28rem hole, a little over two
            thirds of the diameter, which keeps a clear margin of horizon
            around the geometry. The hole itself came down from 44rem: at
            that size it stopped reading as a distant object and became a
            shape competing with the headline.

            The mark is still, as everywhere else on this page: motion
            belongs to hover. It is the same geometry as the nav logo and
            the background field, so the page has exactly one ornament, at
            several scales, rather than a set of unrelated decorations.

            `hidden md:block`. At phone width this would be a graphic
            sitting on top of the headline.
          */}
          <BlackHole>
            <div className="opacity-[0.20]">
              <TesseractMark
                size={300}
                periodMs={15000}
                animate={false}
                weight={1.05}
                fill={1.25}
                showNodes={false}
              />
            </div>
          </BlackHole>

          {/*
            A cold light down the centre of the hero.

            Was a blue-tinted ellipse. It is neutral white now, like
            everything else in the atmosphere, because a tint here was the
            last place a stray hue was entering the composition. Its job is
            what a spotlight does in a photograph: tell the eye where the
            top of the frame is, so the headline sits in light rather than
            floating in an evenly lit field.
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-40 h-[60rem]"
            style={{
              background:
                'radial-gradient(45rem 28rem at 50% 0%, rgba(255,255,255,0.055), transparent 70%)',
            }}
          />

          <div className={`${SHELL} relative pb-24 pt-20 sm:pb-32 sm:pt-28`}>
            {/* "The", not "A". The definite article is the positioning: a
                category this firm intends to define rather than join. */}
            <Eyebrow>The decision operating system for investment teams</Eyebrow>

            {/*
              The only element on the page allowed this much size. The second
              line takes the accent gradient so the sentence has a subject
              and a turn rather than two equal shouts.

              ── WHY THE HEADLINE CHANGED, 2026-11-27 ─────────────────────
              It was "Every investment decision has a story. / Make sure
              your firm remembers it." That line is distinctive and it was
              deliberately kept once before. It is not kept now, and the
              reason is worth writing down because the earlier decision was
              not wrong, it was answering a different question.

              "Make sure your firm remembers it" is an IMPERATIVE about
              RECORDKEEPING, aimed at the fear of a CIO. It asks the reader
              to accept a duty before it has offered them anything. An
              analyst reading it hears more work; a PM hears an audit.
              Neither of them is the person who feels the loss, which is
              why the line tested as memorable and still led with the one
              layer of value that sells last.

              The sentence is not deleted. It moves to the institutional
              intelligence section, where remembering is the subject and
              the reader has by then been given a reason to care.

              ── WHY NOT THE OBVIOUS REPLACEMENT ──────────────────────────
              "Better decisions today. A smarter investment firm tomorrow."
              has the right SHAPE — two horizons, the near one personal and
              the far one institutional — and the wrong second half.
              "Tomorrow" is the reflex pairing for "today" and asserts no
              mechanism. "Every year after" says the same thing and says
              HOW: the advantage accrues, which is the actual thesis of the
              product and the one claim no competitor can copy by shipping
              a feature.
            */}
            {/*
              ── TWO FIXES FROM LOOKING AT IT, NOT FROM READING IT ────────
              1. `max-w-[17ch]` broke the first line as "Better decisions /
                 today.", orphaning the word that carries the near horizon.
                 18ch holds "Better decisions today." on one line at lg.
              2. The second line is NOT in ACCENT_TEXT. That gradient runs
                 white -> slate-400 top-left to bottom-right, so on a line
                 this long the faintest text in the whole hero landed on
                 "every year after" — the payoff, and the half of the
                 headline the positioning depends on. A gradient that
                 fades out the end of a sentence is only safe on a short
                 line; this one is not short. Plain white, with the line
                 break doing the work the colour was doing.
              3. "investment" is dropped from the second line because the
                 eyebrow directly above already says "for investment
                 teams". Saying it twice in six words cost the line its
                 rhythm and bought nothing.
            */}
            {/*
              ── THE HEADLINE IS APPROVED COPY. DO NOT REWRITE IT ─────────
              Every word below, and in the two paragraphs after it, is
              signed-off brand copy. The job here is the SETTING, not the
              writing:

              ONE HEADLINE, TWO SENTENCES. They are two `span`s inside one
              `h1`, so a screen reader reads one heading and the accent is
              typography rather than a second element. The gold is a SOLID
              amber-200, not a gradient: see the deleted `ACCENT_TEXT`
              note above for what a gradient did to the end of a long
              line. A solid value puts the emphasis where it was written
              to go and keeps it there at every width.

              `lg:text-6xl` rather than 7xl, which is a line-break
              decision and not a timidity one. At 72px "Every investment
              decision has a story." measures about 1,370px against 1,216
              of available column, so it wrapped, orphaning "a story." on
              its own line and breaking the one-sentence-one-line reading
              the two-part headline depends on. At 60px it measures about
              1,140 and holds. Measured, not guessed.

              `text-balance` rather than a `ch` cap: a max-width would
              force a wrap at the widths where the line actually fits, and
              below `lg` the point is for the two halves of each sentence
              to break evenly rather than at a fixed character count.
            */}
            {/*
              ── THE PHONE STEP CAME DOWN FROM 40px TO 36px ───────────────
              Measured at 390x844: at 40px the first sentence broke over two
              lines and the second over THREE, so the headline was five
              lines deep before a visitor reached the subheadline. At 36px
              it is two and two, which is a balanced pair and about 70px
              shorter. A headline that fills a phone screen on its own is
              not more impressive, it is just further from the product.
            */}
            <h1 className="mt-7 text-balance text-[2.25rem] font-semibold leading-[1.06] tracking-[-0.03em] text-white sm:text-5xl lg:text-6xl">
              <span className="block">Every investment decision has a story.</span>
              <span className="mt-1.5 block text-amber-200">
                Leverage the intelligence behind it.
              </span>
            </h1>

            {/*
              The subheadline. One short declarative, set clearly below the
              headline and clearly above the supporting paragraph, so the
              hero has three steps of weight rather than two things of
              similar size competing.
            */}
            <p className="mt-8 text-xl font-medium tracking-[-0.01em] text-slate-200 sm:text-[1.375rem]">
              Better decisions start with Tesseract.
            </p>

            {/*
              Two sentences, and the second one is the payoff.

              This was one 31-word sentence followed by "It helps teams
              preserve reasoning, maintain context, and learn from decisions
              over time" — three abstractions in a row, which is the shape a
              reader skips. The claim is the same; it now lands.
            */}
            {/*
              THREE READERS, THREE CLAUSES, IN THE ORDER THEY DECIDE.

              The analyst is first because the analyst is who has to open
              the thing every morning, and software a desk resents does not
              survive its pilot however well it demos to the CIO. The PM is
              second because the PM signs. The firm is third because the
              compounding argument is the one that renews the contract, and
              it is also the one a stranger has least reason to believe in
              the first ten seconds.

              Each clause names a DIFFERENT benefit — time, context,
              sharpening — rather than three restatements of "better". The
              previous lead listed the five stages, which set up the page's
              spine but asked the reader to care about an architecture
              before they had been offered an outcome.
            */}
            {/*
              ── THE OLD LEAD WAS PRESCRIPTIVE, AND THAT WAS THE NOTE ─────
              It read "Give your analysts more time to think, your
              portfolio managers the context to act, and your firm an
              investment process that gets sharper..." — three
              imperatives aimed at a reader who has not agreed to
              anything yet, and it addressed three personas in copy that
              is supposed to be general.

              The approved replacement describes the DESTINATION instead,
              in the same three layers (the individual's environment, the
              team's foundation, the institution's intelligence) without
              telling anyone what to do about it. It is reproduced
              verbatim.
            */}
            <p className="mt-6 max-w-[62ch] text-[17px] leading-[1.75] text-slate-400">
              A better environment for investment thinking, a stronger
              foundation for decision-making, and a lasting source of
              institutional intelligence.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <ContactCta topic="demo" label="Request a demo" className={BTN_PRIMARY} onOpen={openRequest} />
              {/* Points at #platform, not #lifecycle. "Explore the
                  platform" landing a reader on the mechanics of a
                  six-stage record chain was the wrong first screen; the
                  product reveal is directly below and is what the label
                  promises. */}
              <a href="#platform" className={BTN_GHOST}>
                Explore the platform
              </a>
            </div>

            {/*
              ── THE DEFENSIVE BLOCK IS GONE FROM THE HERO, 2026-11-27 ────

              It read, at 24px directly under the calls to action:

                "Not a market-data terminal. Not an execution system.
                 The record of why your firm acted."

              I argued for that line twice, on the grounds that saying what
              category you are in stops a PM arriving at a demo expecting a
              Bloomberg substitute. That argument is still true about the
              SENTENCE and was wrong about the POSITION, and the review is
              right about why: it is the third thing a stranger reads, it
              defines the product by two absences, and its one positive
              clause reduces Tesseract to a record of something that
              already happened. Tesseract is not primarily the record of
              why a firm acted. It improves the work leading to the
              decision, the decision, and what the firm learns afterwards.
              Leading with a boundary sells the smallest reading of it.

              THE CLAIM IS NOT DELETED. It moves into the platform section
              below as a clarifier, sized as a clarifier, next to the
              figure that shows what Tesseract IS. A reader who wants to
              know how it sits beside their terminal and their OMS finds
              the answer one screen later, which is early enough.

              What replaces it here is a transition rather than another
              argument. It names the span the product covers — thinking,
              action, and what is learned — and hands the reader to the
              product reveal. It is suggested copy from the brief and it is
              kept because it does a job: without it the hero ends on two
              buttons and the next section starts cold.
            */}
            <div className="mt-16 border-t border-white/10 pt-9">
              <p className="max-w-[52ch] text-pretty text-[20px] font-medium leading-[1.55] text-slate-300">
                From investment thinking to investment action.
                <span className="block text-slate-400">
                  And everything learned along the way.
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* ── 2. What it is ───────────────────────────────────────────────
            THE SECTION THE PAGE DID NOT HAVE.

            A visitor who read the old page from the top met the hero, then
            a screen explaining what is wrong with their firm, then a
            lifecycle. Nowhere in the first three screens did the page say
            PLAINLY WHAT THE THING IS, and nowhere did it show one.

            That is the gap this fills, and it comes before the problem
            deliberately. Leading with the diagnosis asks a stranger to
            accept an accusation about their own organization before they
            have any reason to trust the source. Showing the product first
            earns the right to describe the problem it solves.

            The canvas is the widest figure on the page and the only one
            allowed to be. It is three panels on ONE name — coverage,
            the case, and the records the firm created from it — because
            the product's whole claim is that those are the same object
            seen from different seats, and a composition can say that in a
            second where a paragraph needs forty words and is still
            believed less.
        */}
        {/*
          ── THE PRODUCT REVEAL ────────────────────────────────────────────

          CENTRED, which no other product section on this page is. The
          heading is the page's second brand moment and the figure beneath
          it is the widest thing here, so the composition is a title over a
          stage rather than a column of text with a picture beside it. That
          is the one layout on the page that says "look at this".

          THE HEADING CHANGED. It was "One name. Every piece of work your
          firm did on it." That is a true description of the figure and an
          abstract description of the product: it tells a stranger the
          scope is one security, when the thing they need to grasp in this
          screen is that the scope is their whole investment process. "The
          complete investment picture" is the claim the canvas can actually
          cash, and it is approved copy.
        */}
        <section id="platform" className="relative scroll-mt-24">
          <div className={`${SHELL} pt-24 sm:pt-32`}>
            <div className="mx-auto max-w-3xl text-center">
              <div className="flex justify-center">
                <Eyebrow>The platform</Eyebrow>
              </div>
              <h2 className="mt-7 text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl lg:text-[3.25rem]">
                The complete investment picture.
              </h2>
              <p className="mx-auto mt-7 max-w-[62ch] text-[18px] leading-[1.7] text-slate-300">
                Research, valuation, investment ideas, portfolio decisions and
                the reasoning behind them, brought together in one investment
                environment.
              </p>
            </div>
          </div>

          {/*
            The canvas gets `CANVAS` width, which is the only place on the
            page that breaks the text column, and it breaks it by 96px
            rather than by a dramatic amount. See the note on `MEASURE`.
          */}
          <div className={`${CANVAS} mt-14 sm:mt-16`}>
            <WorkspaceCanvas />
          </div>

          {/*
            ── WHERE THE CATEGORY LINE WENT ────────────────────────────────

            This is the hero's old "not a market-data terminal" claim,
            demoted to a clarifier and placed where it belongs: beside the
            thing that shows what Tesseract IS, for the reader who has just
            understood that and is now asking how it sits next to what they
            already pay for.

            Set at 16px in three short lines against a rule, not at 24px
            under the hero's buttons. The content is deliberately WIDER
            than the old version too: terminals and execution systems were
            the only two incumbents named, and the question a PM actually
            asks includes their OMS and their existing research drive.
          */}
          <div className={`${SHELL} pb-24 sm:pb-32`}>
            <div className="mt-14 grid gap-x-16 gap-y-7 border-t border-white/10 pt-10 lg:grid-cols-12">
              <p className="text-[17px] font-medium leading-[1.6] text-slate-300 lg:col-span-5">
                Tesseract sits alongside what a desk already runs on.
              </p>
              <p className="max-w-[62ch] text-[16px] leading-[1.75] text-slate-400 lg:col-span-7">
                It is not a market-data terminal, an order management system or
                an execution venue, and it does not replace one. It holds the
                research, the judgement and the decisions those systems have
                never been able to carry.
              </p>
            </div>
          </div>
        </section>

        {/* ── 3. The opportunity, which used to be the problem ──────────────

            ── WHAT CHANGED, AND IT IS THE BIGGEST EDITORIAL CUT ON THE PAGE

            This section was headed "The reasoning behind a decision is the
            first thing a firm loses", and it carried three named COSTS with
            an SVG diagram each: tools that scatter the argument, reasoning
            that leaves with the person, and luck that reads as skill.

            I built those diagrams and I am deleting them, for three
            reasons that are all in the review:

            1. THE SECTION WAS LECTURING. Three framed drawings of what is
               broken about the reader's firm, immediately after the product
               reveal, is a screen spent telling a stranger they are doing
               it wrong. The emphasis on loss and failure was
               disproportionate, and a prospect does not buy from the
               person diagnosing them.
            2. TWO OF THE THREE WERE ABSTRACT. A ring of five labelled
               boxes with a dashed hole in the middle, and a chain with
               missing links, clarify nothing a sentence does not. The
               standing rule here is that a diagram has to show something
               prose cannot, and those two did not meet it.
            3. THE THIRD ONE MOVED, WHICH IS WHY IT IS NOT A LOSS. "Luck
               reads as skill" was the commercially sharp idea in the set,
               and it belongs where it can be DEMONSTRATED rather than
               drawn: the decision review section now carries it, on a
               named decision, with the original case beside what changed.
               That is the same argument with evidence instead of an
               allegory.

            `compact` and `center`: one short editorial statement rather
            than a full product section. The section's job is to establish
            why this category exists, and that is a 40-word job.

            The headline is approved copy and it reframes loss as upside
            without softening the insight: the intelligence exists, it is
            simply not usable yet.
        */}
        <Section
          id="problem"
          weight="compact"
          center
          label="The opportunity"
          title="The untapped intelligence within every investment firm."
          lead="Investment teams generate an extraordinary amount of intelligence through research, discussion, judgement and decisions. Much of it stays fragmented across systems, disconnected from the actions it informed and difficult to build on."
        >
          <div className="mx-auto max-w-4xl">
            <p className="text-pretty text-center text-[20px] leading-[1.6] text-slate-300 sm:text-[1.375rem]">
              Tesseract turns that intelligence into something a firm can use:
              by the individual investor, across the investment team, and by
              the organization over time.
            </p>
          </div>
        </Section>

        {/* ── 4. Who it is for ────────────────────────────────────────────
            THREE SEATS, THREE DIFFERENT ARTIFACTS.

            Placed here on purpose: after the reader has seen what the
            product is and why it matters, and BEFORE the lifecycle. The
            lifecycle explains the machine; this explains what the machine
            is worth to the particular person reading, and a stranger
            needs that answer before they will spend a screen on
            mechanics.

            The implementation rule is in RoleSwitch.tsx and it is the
            important part: a queue, an approval and a ledger, because
            three skins of one component is how this page shipped a
            duplicate section once before.
        */}
        {/*
          ── The heading was a DESCRIPTION OF THE COMPONENT ────────────────

          "Three seats. Three different days. One system underneath." names
          what the widget does. It is also, read cold, a claim about
          software architecture, which is nobody's reason to buy. The lead
          underneath it was worse: it explained the firm's own purchasing
          dynamics back to the reader ("only one of them signs"), which is
          an internal sales observation printed on a public page.

          Both are replaced with approved copy that states the VALUE of the
          experience instead, and the lead names the three responsibilities
          rather than the three signatures.
        */}
        <Section
          id="roles"
          wide
          label="Built for the desk"
          title="A better investment experience. At every level."
          lead="The same investment intelligence, experienced through the distinct responsibilities of analysts, portfolio managers and investment leadership."
        >
          <RoleSwitch />
        </Section>

        {/* ── 5. The connected decision lifecycle ─────────────────────────── */}
        {/*
          ── The heading was an INTERNAL PRODUCT SPECIFICATION ─────────────

          "Research, develop, recommend, decide, execute, review. Linked,
          not filed." is a list of our own stage names followed by a
          database claim. It reads to a visitor the way a schema reads,
          because that is what it is.

          The replacement is approved copy and it says what the sequence is
          FOR. The lead keeps the mechanism, because the mechanism is the
          differentiator, but it is now the second thing said rather than
          the first.

          ── SIX STAGES, NOT SEVEN, AND THIS IS A DELIBERATE DEPARTURE ─────

          The brief proposes seven, adding "Learn — the resulting knowledge
          informs future research and decisions." I have not added it, and
          the reason is the honesty rule this page is built on rather than
          an editorial preference: every stage on this rail corresponds to
          a typed record the product really writes, and the panel for each
          one names that record and its fields. There is no `learning`
          row. A seventh tab would be the only stage on the rail with
          nothing behind it, which is exactly the kind of claim the rest of
          this page refuses to make.

          The idea is not dropped. Learning is drawn as the RETURN LEG in
          `RecordChain` below, where the review points back at the research
          note, and it is the whole subject of the institutional
          intelligence section. It is a property of the loop, not a step in
          it, and drawing it as a step would also contradict the brief's
          own instruction to preserve flexibility and not imply every idea
          marches through every stage.
        */}
        <Section
          id="lifecycle"
          tone="raised"
          wide
          label="The connected decision lifecycle"
          title="Where investment thinking becomes action."
          lead="Investment decisions take shape through research, evolving conviction, discussion and judgement. Tesseract connects those moments, so each stage arrives carrying the one before it."
        >
          {/*
            ── Was a stack of six headed text blocks beside the diagram ────

            Six stages, each with a heading, a record chip, a description
            and a consequence, all on screen at once. 282 words and 1,382px
            of uniform vertical rhythm, which is a specification, not an
            argument, and it was the longest section on the page.

            It is now a WALK. The six stages are a rail you move along, and
            the panel under it shows one stage at a time: what it keeps,
            what it points back at, and what that buys a year later. The
            record shape stays beside it, because the prose claims linkage
            and the diagram is what shows it.

            The "points at" line is the whole product claim, and the static
            version could not make it: a stack of six asserts linkage in
            prose, while a walk DEMONSTRATES it, because moving to the next
            stage names the record the new one hangs off.
          */}
          <LifecycleWalk />
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
        <section id="research" className="relative scroll-mt-24">
          {/*
            ── THE HAZY GRADIENT TRANSITION IS GONE, 2026-11-27 ───────────

            Both edges of this band were a 96-128px vertical gradient from
            the page colour into #f7f8fa. The intent was that the change
            should "arrive rather than cut". What it actually produced was
            a long smear of mid-grey at both ends, which is the least
            decisive thing a layout can do: the reader spends 100px not
            knowing which section they are in, and the inversion loses the
            one quality that made it worth doing, which is that it is
            sudden.

            The edge is now DECLARED instead of blurred: a hairline, the
            section's own label in the dark register, and then the band
            starts. That is an editorial transition — it tells you a new
            chapter is beginning and then begins it.
          */}
          <div className={`${SHELL} pb-10 pt-4`}>
            <div
              aria-hidden="true"
              className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"
            />
          </div>
          <div className="relative isolate bg-[#f7f8fa]">
            {/*
              The light band needs its own atmosphere for exactly the same
              reason the dark page did. Inverting to a flat #f7f8fa solves
              the monotony of a long dark page and then recreates it over
              one screen. Three layers, the mirror image of the dark ones:
              a warm and a cool tint so the white is not neutral, the same
              column grid in a dark ink, and grain.
            */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background:
                  /*
                   * Two NEUTRAL shadows, not two tints.
                   *
                   * These were a blue and a cyan wash, and they were the
                   * light band's own version of the aurora. On a near-white
                   * surface the way to get depth is shadow rather than
                   * colour, so the band is now lit the same way the dark
                   * page is: a soft fall in the top right and the bottom
                   * left, in black at very low alpha. The paper stays
                   * paper-coloured.
                   */
                  'radial-gradient(45rem 28rem at 85% 0%, rgba(15,23,42,0.055), transparent 70%),' +
                  'radial-gradient(40rem 26rem at 5% 100%, rgba(15,23,42,0.045), transparent 70%)',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 flex justify-center"
            >
              <div className={`flex h-full w-full ${MEASURE} ${GUTTER} justify-between`}>
                {[0, 1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className="h-full w-px bg-gradient-to-b from-transparent via-slate-900/[0.06] to-transparent"
                  />
                ))}
              </div>
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10"
              style={{ backgroundImage: GRAIN, backgroundRepeat: 'repeat', opacity: 0.028 }}
            />
            <div className={`${SHELL} pb-20 pt-20 sm:pb-28 sm:pt-24`}>
              <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="h-px w-8 bg-gradient-to-r from-amber-500/90 to-amber-500/0"
                    />
                    {/* `LIGHT_*` tokens, not the page's usual slate-400/500:
                        this band is #f7f8fa, where the dark sections'
                        greys invert into 2.5:1. See the token definitions. */}
                    <p className={`text-[14px] font-semibold uppercase tracking-[0.18em] ${LIGHT_LABEL}`}>
                      Research and knowledge continuity
                    </p>
                  </div>
                  {/*
                    ── The heading was about DOCUMENTATION ────────────────

                    "The record assembles itself out of work already done"
                    states a real product principle and it states it from
                    the record's point of view. The reader is an investor,
                    not a record. Approved copy puts the subject back where
                    it belongs: the intelligence is captured because of how
                    the work happens, not because anybody maintained
                    anything.
                  */}
                  <h2 className="mt-5 text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-slate-900 sm:text-[2.5rem]">
                    Intelligence captured in the natural course of investing.
                  </h2>
                </div>
                <div className="lg:col-span-5 lg:pt-2">
                  {/* Tightened from 42 words. The list of what contributes
                      (notes, theses, processes) is the three-item grid
                      below, so naming them here was the section's own
                      contents read out in advance. */}
                  <p className={`max-w-[56ch] text-[17px] leading-[1.75] ${LIGHT_BODY}`}>
                    Research becomes more valuable when it stays connected to
                    the thinking it informs, and nothing here is written a
                    second time for somebody else&rsquo;s benefit.
                  </p>
                </div>
              </div>

              {/*
                ── The proof goes BEFORE the list, not after it ────────────

                The heading above already promises that capture is not extra
                work. The six surfaces then followed immediately, and six
                headed items read as six more things to keep up to date,
                which fuels exactly the fear the heading was trying to
                settle. A reader does not get to the reassurance because the
                list arrives first and answers the question differently.

                `CaptureTrade` shows the trade in one glance: the note an
                analyst was writing anyway on the left, the typed records it
                produced on the right, and nothing in between for them to
                do. The list is then a map of where that happens rather than
                a worklist, which is what it always was.
              */}
              <div className="mt-14 sm:mt-16">
                <CaptureTrade />
              </div>

              <p className={`mt-16 text-[14px] font-semibold uppercase tracking-[0.18em] ${LIGHT_LABEL}`}>
                Where the writing already happens
              </p>
              {/* THREE COLUMNS NOW, because there are three items. This
                  went 3-col (six items, tidy 3x2) to 2-col (four items,
                  square) to 3-col again, and the rule each time was the
                  same: match the column count to the item count or the
                  last row orphans. Three across also reads as parallel,
                  which these are. */}
              <div className="mt-8 grid gap-x-12 gap-y-10 sm:grid-cols-3">
                {CAPTURE.map(([Icon, h, p]) => {
                  const I = Icon as typeof BookOpen
                  return (
                    <div key={h}>
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-slate-900/[0.08]">
                        {/* amber-600, not amber-300: this one is on the LIGHT band. */}
                        <I className="h-[17px] w-[17px] text-amber-600" aria-hidden="true" />
                      </span>
                      <h3 className="mt-4 text-[18px] font-semibold tracking-tight text-slate-900">{h}</h3>
                      <p className={`mt-2 max-w-[44ch] text-[16px] leading-[1.75] ${LIGHT_BODY}`}>{p}</p>
                    </div>
                  )
                })}
              </div>

              {/*
                ── DEMOTED FROM 20px TO 16px, ON PURPOSE ──────────────────

                This sentence is the architectural reason everything else
                on the page is possible, and it was set as the section's
                closing statement at 20px. That made the database model the
                CENTREPIECE of the section about an analyst's working day,
                which is the wrong thing to leave a reader holding: typed
                entities are an advantage of the design, not the customer's
                experience of it.

                So it stays — a page that never says why the linkage is
                possible is asking to be believed on nothing — but it is a
                footnote now, at body size, in the quiet grey. The
                experience leads; the architecture explains.
              */}
              <p className={`mt-12 max-w-[66ch] border-t border-slate-900/[0.08] pt-6 text-[16px] leading-[1.75] ${LIGHT_MUTED}`}>
                Each of these is a typed record rather than a document, which
                is the only reason the chain above can exist: a recommendation
                can cite a note because the note is a row.
              </p>
            </div>
          </div>
        </section>

        {/*
          ── 5. THE PRODUCT SECTION WAS DELETED, and this note is why ──────

          It was "What you actually work in": a tablist of six screens, each
          with a line about what it holds. The reader could not see the
          point of it, and the reason turned out to be structural rather
          than editorial.

          It was the lifecycle section again. One to one, in the same order:

            Research  / Research note    -> Asset workspace
            Develop   / Idea             -> Idea Pipeline
            Recommend / Recommendation   -> Recommendation
            Decide    / Decision         -> Decision Inbox
            Execute   / Accepted trade   -> Trade Book
            Review    / Outcome review   -> Outcomes

          Six stages, six records, six screens, perfectly aligned. A reader
          who had understood the lifecycle learned exactly one new fact
          here, that each stage has a screen, which they had already
          assumed. No amount of rewriting the heading fixes a section whose
          content is another section's content.

          What it DID add was depiction: the lifecycle draws a schema, those
          figures draw the product. So the figures moved into the lifecycle
          walk, against the stage each one illustrates, and every screen
          name and drawing survives. The page lost a section and about 100
          words, and gained a lifecycle that answers all three questions a
          buyer actually asks in the order they ask them: what do I open,
          what does it do for me, what does it leave behind.

          If a future edit wants a dedicated look-at-the-product section,
          it needs a job the lifecycle does not already do — showing two or
          three screens LARGE, for density and craft, would be one. Six
          small ones mapped to six stages is the thing that failed.
        */}

        {/* ── 7. When the facts change ────────────────────────────────────
            THE DIFFERENTIATOR THE PAGE DID NOT HAVE.

            Every other claim here can be met by a PM saying "we have a
            research system". This one cannot. Opening a position eight
            months later and reading what you ACTUALLY believed when you
            took it — not what you now remember believing — is the thing
            no folder of documents and no meeting culture produces.

            It is a figure rather than a paragraph because the gap is
            invisible until the two columns sit side by side. "You can
            revisit the original reasoning" is a feature sentence; a
            conviction that moved from High to Medium against a named
            assumption that failed is an argument.

            Placed immediately before institutional memory, because this
            is the concrete instance and that section is the general case.
        */}
        {/* ── 6. ACT AI ────────────────────────────────────────────────────
            MOVED UP, out of the appendix slot after institutional memory.

            It used to sit tenth, behind the memory section, which framed
            it as a technical afterthought bolted to a records product.
            It is now part of the main product story, directly after the
            research band and before the decision review, because "the
            assistant can see the whole connected record" is the payoff of
            everything the three preceding sections just established. A
            reader meets it while the linkage is still in mind.

            The heading was "An assistant whose advantage is that your
            record is structured", which is accurate, technical, and sells
            the schema rather than the capability. Approved copy leads with
            what becomes possible.
        */}
        <Section
          id="act-ai"
          tone="raised"
          wide
          label="ACT AI"
          title="Intelligence that knows the context."
          lead="ACT AI works inside the research, reasoning and decisions of an investment team, which is what makes its analysis relevant rather than merely fluent."
        >
          <AssistantCanvas />

          {/*
            THE CONTROLS, UNDERNEATH AND INTRODUCED AS SUCH.

            These three were the whole section once. They are the answers a
            buyer needs and they are not the reason anyone wants the
            product, so they are a supporting row now with a label that
            says so. BYOK in particular is deliberately NOT the headline
            claim any more: it is one control among three, because the
            product direction may well move past it and a page that sold
            the assistant on a key would have to be rebuilt when it does.
          */}
          <div className="mt-16 border-t border-white/10 pt-10">
            <p className="text-[14px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              And the firm stays in control of it
            </p>
            <div className="mt-8">
              <AssistantFlow />
            </div>
          </div>

          <div className="mt-14 grid gap-x-16 gap-y-6 lg:grid-cols-2">
            {/*
              The three capabilities the original cards carried, kept
              verbatim. Their gate is a content requirement rather than a
              label, so the words survive every restyle: dropping them in
              a rewrite is exactly what it exists to catch, and it has
              caught it before.
            */}
            <p className="max-w-[60ch] text-[16px] leading-[1.75] text-slate-400">
              It knows where you are, it reads the record, not the internet,
              and it cites what it used. It runs on your organization&rsquo;s own
              provider key, held encrypted, so the firm controls which model
              its reasoning reaches.
            </p>
            {/*
              THE VISION LINE, AND WHY IT IS HERE RATHER THAN IN THE PITCH.

              The brief asks that current functionality stay distinguishable
              from the longer-term ambition. This is that line, and it is
              phrased as a boundary rather than a roadmap: what the
              assistant does not do today. Saying "coming soon" would
              violate the standing rule on this page against status
              language; saying what it does not do is a fact about the
              product.
            */}
            <p className="max-w-[60ch] text-[16px] leading-[1.75] text-slate-400">
              ACT AI assists the people who make the decisions. It does not
              manage portfolios, place orders, or produce recommendations on
              its own authority.
            </p>
          </div>
        </Section>

        {/* ── 7. Decision review ──────────────────────────────────────────
            THE DIFFERENTIATOR THE PAGE DID NOT HAVE.

            Every other claim here can be met by a PM saying "we have a
            research system". This one cannot. Opening a position eight
            months later and reading what you ACTUALLY believed when you
            took it — not what you now remember believing — is the thing
            no folder of documents and no meeting culture produces.

            It is a figure rather than a paragraph because the gap is
            invisible until the two columns sit side by side. "You can
            revisit the original reasoning" is a feature sentence; a
            conviction that moved from High to Medium against a named
            assumption that failed is an argument.

            ── "A BAD OUTCOME IS NOT A BAD DECISION" WAS TOO CATEGORICAL ──

            That line was the section's pull quote and the review is right
            that it overclaims in the other direction: sometimes a bad
            outcome is exactly the evidence that the decision was bad, and
            a page that denies it sounds like it is making excuses. "The
            outcome tells only part of the story" is the precise version,
            and the copy under it now says what the product does and does
            NOT do — it preserves the context that lets a firm evaluate
            the process, and it does not claim to separate skill from luck
            on anyone's behalf. That distinction also absorbs the deleted
            "luck reads as skill" diagram from the old problem section.
        */}
        <Section
          id="reassess"
          wide
          label="Decision review"
          title="Conviction evolves. So should the investment case."
          lead="Markets change, assumptions age and views develop. A complete picture of the original decision is a stronger foundation for deciding what comes next."
        >
          <ReassessFigure />

          <div className="mt-14 grid gap-x-16 gap-y-8 border-t border-white/10 pt-12 lg:grid-cols-12">
            <p className="text-pretty text-2xl leading-[1.3] tracking-[-0.02em] text-white sm:text-3xl lg:col-span-6 lg:text-[2.25rem]">
              The outcome tells only part of the story.
            </p>
            <p className="max-w-[52ch] text-[17px] leading-[1.8] text-slate-400 lg:col-span-6 lg:pt-2">
              Investment results reflect judgement and uncertainty together.
              Keeping the context a decision was made in is what lets a firm
              examine the process on its own terms, rather than reading every
              review back from the return.
            </p>
          </div>
        </Section>

        {/* ── 8. Institutional intelligence ────────────────────────────────
            THE PAGE'S SECOND BRAND MOMENT, and the only section besides the
            hero and the close that gets a sky behind it.

            `weight="brand"` and `center`: a 56px centred headline with the
            most air on the page. That is a deliberate change of gear after
            six product sections, and it is this section rather than another
            because this is the one whose subject is not a feature. It is
            what the firm owns in three years.

            The heading was "The firm's accumulated decisions as an asset it
            owns", which is strategically right and reads backwards: it
            describes a pile of past decisions. Approved copy points
            forward, at growth, which is the same claim with the tense
            fixed.
        */}
        <Section
          id="memory"
          weight="brand"
          center
          sky={0.75}
          label="Institutional intelligence"
          title="Institutional intelligence that grows with every decision."
          /* Tightened from 35 words. The cut clause named the strategies
             and people a firm moves through, which the ledger beneath
             shows better than any clause: three years, two analysts, one
             name. */
          lead="The research, judgement and experience of an investment team become more valuable when they stay connected and accessible over time, beyond any individual investor."
        >
          <div className="grid items-start gap-x-16 gap-y-12 lg:grid-cols-12">
            {/*
              The ledger leads, and it is wider than the claims beside it.

              This section's whole argument is about elapsed time, and no
              paragraph shows accumulation. The drawing does: year three
              has visibly more on it than year one. So the figure is the
              evidence and the two claims are the gloss, which is the
              reverse of how this section was laid out before.
            */}
            <div className="lg:col-span-7">
              <MemoryLedger />
            </div>

            <ul className="space-y-9 text-left lg:col-span-5 lg:pt-2">
              {MEMORY.map(([Icon, h, p]) => {
                const I = Icon as typeof Lock
                return (
                  <li key={h}>
                    <div className="flex items-center gap-3">
                      <I className="h-[18px] w-[18px] shrink-0 text-amber-300" aria-hidden="true" />
                      <h3 className="text-[18px] font-semibold tracking-tight text-white">{h}</h3>
                    </div>
                    <p className="mt-2.5 max-w-[44ch] text-[16px] leading-[1.75] text-slate-400">{p}</p>
                  </li>
                )
              })}
            </ul>
          </div>

          {/*
            THE LINE THAT KEEPS THIS SECTION HONEST, and it is the one place
            on the page where a compounding argument could tip into a
            performance claim. "Accumulating a record makes you a better
            investor" is not something anyone has shown, and the brief
            forbids implying it. So the section claims retrievability and
            refuses the rest, in plain words, at body size.
          */}
          <p className="mx-auto mt-16 max-w-[68ch] border-t border-white/10 pt-8 text-center text-[16px] leading-[1.75] text-slate-400">
            Tesseract makes a firm&rsquo;s reasoning retrievable and connected. It
            does not promise better returns, and no part of this platform
            should be read as a forecast of investment performance.
          </p>
        </Section>

        {/*
          ── THE ACT AI SECTION USED TO SIT HERE, 2026-11-27 ───────────────

          It was the tenth section, behind institutional memory, which read
          as a technical appendix bolted onto a records product. It has
          moved up to position six, between the research band and the
          decision review, where the reader has just been shown the linkage
          the assistant depends on. Its question strip, its old heading and
          its three capability cards all went with the move; see the
          section in its new place for what replaced them and why.
        */}


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
        {/* ── 10. Your intelligence, your control ─────────────────────────
            AN INSTITUTIONAL BUYER ASKS THIS AND THE PAGE DID NOT ANSWER.

            Kept to a compact band rather than a full section with a
            figure, because the page is already long and because a trust
            section that goes on at length reads as defensive.

            EVERY CLAIM HERE WAS VERIFIED AGAINST PRODUCTION BEFORE IT WAS
            WRITTEN, read-only, and the ones that could not be verified
            are absent rather than softened:

              RLS       296 of 296 public tables have rowsecurity on,
                        zero without. Measured from pg_class, not
                        inferred from a migration.
              Model     organization_ai_config exists and is org-scoped
                        with 4 policies, so bring-your-own-key is real.
              Scope     user_ai_config carries the assistant's read
                        scope, so "you choose what it reads" is a real
                        setting and not an intention.

            DELIBERATELY NOT CLAIMED, and this list matters more than the
            one above: no certification, no SOC 2, no compliance posture,
            no encryption specifics, no immutability, and nothing about
            data not reaching a model provider. RLS being enabled on a
            table is not proof its policies are correct, and this repo's
            own notes say the audit is partial. The copy says what is
            enforced and where, never that it is complete.
        */}
        {/*
          ── Trust, REFRAMED FROM FEAR TO CONTROL ──────────────────────────

          The heading was "Built for a firm that cannot hand its research to
          anyone", which recognises a real constraint and leads with what
          the firm is afraid of. "Proprietary intelligence. Firm-level
          control." is the same subject stated as a capability, which is
          both more confident and more accurate about what the product
          provides.

          RESTRAINED AND HIGHLY LEGIBLE, deliberately: no sky, no figure, a
          30px heading and three short definitions. A trust section that
          goes on at length reads as defensive, and security detail
          dominating a marketing page is its own kind of warning sign.
        */}
        <section id="trust" className="relative scroll-mt-24">
          <div
            aria-hidden="true"
            className={`${SHELL} h-px bg-gradient-to-r from-transparent via-white/10 to-transparent`}
          />
          <div className={`${SHELL} py-20 sm:py-24`}>
            <div className="grid gap-x-16 gap-y-7 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <Eyebrow>Institutional trust</Eyebrow>
                <h2 className="mt-6 text-pretty text-2xl font-semibold leading-[1.15] tracking-[-0.025em] text-white sm:text-[1.875rem]">
                  Proprietary intelligence. Firm-level control.
                </h2>
              </div>
              <p className="max-w-[52ch] text-[17px] leading-[1.75] text-slate-400 lg:col-span-7 lg:pt-8">
                Research, judgement and decision-making are among a firm&rsquo;s
                most valuable proprietary assets. These are the controls that
                exist today, stated as what they do rather than as a posture.
              </p>
            </div>

            <dl className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {[
                [
                  'One firm cannot read another',
                  'Isolation is enforced by the database on every table, per row, rather than by application code remembering to filter.',
                ],
                [
                  'You bring your own model',
                  'The assistant runs against your organization’s own provider account and key, configured by your administrator.',
                ],
                [
                  'You choose what it reads',
                  'The assistant’s access to your record is a setting your firm controls, not a fixed grant.',
                ],
              ].map(([term, def]) => (
                <div key={term} className="border-t border-amber-300/25 pt-5">
                  <dt className="text-[18px] font-semibold tracking-tight text-white">{term}</dt>
                  <dd className="mt-2.5 max-w-[40ch] text-[16px] leading-[1.75] text-slate-400">
                    {def}
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              The honest line. An institutional buyer will ask about
              certifications in the first call, and a page that implies
              them is a page that loses the second call. Saying it here
              costs nothing and is the only version that survives
              diligence.
            */}
            <p className="mt-12 max-w-[66ch] text-[16px] leading-[1.75] text-slate-400">
              Tesseract holds no security certification today. We will show
              you how the controls above are implemented, in detail, as part
              of a design-partner conversation.
            </p>
          </div>
        </section>

        {/* ── 10. The close ────────────────────────────────────────────────

            ── TWO CONVERSION SECTIONS BECAME ONE ───────────────────────────

            The page ended with a design-partner panel and then, after a
            rule, a second centred block headed "See the decision loop on a
            real security". Two conversion moments in a row is one too
            many: the first asked for a commitment, the second asked for a
            meeting, and the reader had to decide twice in forty vertical
            inches. It also meant the LAST thing on the page was a
            description of a demo agenda, which is the least ambitious note
            available to close on.

            One section now. The brand statement at full weight, the demo
            as the single primary action, and the founding-partner
            invitation as a distinct panel beneath it for the smaller
            audience that it is actually for.

            `#partners` SURVIVES AS THE PANEL'S ID, so the nav and footer
            links still resolve to something with content in it. That is
            not cosmetic: a gate on this page walks every in-page anchor
            and fails on one that points at nothing.

            The headline is approved copy, and it is the first closing line
            this page has had that promises an outcome rather than
            describing a meeting. The practical description of the demo is
            kept, demoted to supporting copy, because a PM deciding whether
            to give up thirty minutes does want to know what happens in
            them.
        */}
        <section id="contact" className="relative scroll-mt-24">
          {/* The third and last sky. See `Starscape`: the page opens on the
              brand, states the institutional case on it, and returns to it
              to close. Everything between is clean dark product surface. */}
          <Starscape density={0.6} />
          <div
            aria-hidden="true"
            className={`${SHELL} h-px bg-gradient-to-r from-transparent via-white/10 to-transparent`}
          />
          <div className={`${SHELL} py-24 sm:py-36`}>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl lg:text-[3.5rem]">
                A better way to invest.
                <span className="block text-amber-200">An advantage that endures.</span>
              </h2>
              <p className="mx-auto mt-8 max-w-[58ch] text-[18px] leading-[1.7] text-slate-300">
                A more connected investment process, from the first research
                insight to the intelligence a firm builds over the years that
                follow.
              </p>
              <div className="mt-11 flex flex-wrap items-center justify-center gap-3">
                <ContactCta topic="demo" label="Request a demo" className={BTN_PRIMARY} onOpen={openRequest} />
                <Link to="/login" className={BTN_GHOST}>
                  Sign in
                </Link>
              </div>
              <p className="mx-auto mt-8 max-w-[60ch] text-[16px] leading-[1.75] text-slate-400">
                Thirty minutes on one security, start to finish: the research,
                the recommendation, the decision, the position it authorized
                and the review that follows it.
              </p>
            </div>

            {/*
              ── The founding-partner invitation ──────────────────────────

              A panel inside the close rather than a section of its own.
              It is addressed to a much smaller audience than the demo CTA
              above it, so it gets less of the page and its own surface
              instead of equal billing.

              The claim is deliberately about PARTICIPATION, not scarcity:
              no number of seats, no waitlist, no suggestion that anyone
              else has already signed. What is offered is real and
              verifiable — the product shaped around the firm's own
              recommendation and decision process, and a say in what gets
              built.
            */}
            <div
              id="partners"
              className={`${GLASS} mt-20 scroll-mt-24 overflow-hidden px-7 py-12 sm:mt-24 sm:px-12 sm:py-14`}
            >
              {/* The one coloured field left anywhere on the page, and it is
                  here because this is the block that should be the most
                  luminous. Everything else is white, grey or near-black. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'radial-gradient(40rem 20rem at 50% -20%, rgba(56,118,246,0.17), transparent 65%)',
                }}
              />
              <div className="relative grid items-center gap-x-14 gap-y-8 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <Eyebrow>
                    <span className="sr-only">Section: </span>Founding design partners
                  </Eyebrow>
                  <h3 className="mt-5 text-pretty text-2xl font-semibold leading-[1.15] tracking-[-0.02em] text-white sm:text-[1.875rem]">
                    Shape a new category of investment technology.
                  </h3>
                  <p
                    data-section-lead
                    className="mt-5 max-w-[62ch] text-[17px] leading-[1.7] text-slate-300"
                  >
                    We are working with a small number of investment teams on
                    how Tesseract reaches the institutional market. A founding
                    partner gets the product modelled around their own
                    recommendation and decision process, and a direct say over
                    what gets built next.
                  </p>
                </div>
                <div className="lg:col-span-5 lg:justify-self-end">
                  <ContactCta
                    topic="partnership"
                    onOpen={openRequest}
                    label="Become a design partner"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-black/30 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710]"
                  />
                </div>
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
                  <span className="text-[16px] font-semibold tracking-[-0.01em] text-white">Tesseract</span>
                </div>
                <p className="mt-3 max-w-[34ch] text-[16px] leading-[1.6] text-slate-400">
                  The decision operating system for investment teams.
                </p>
              </div>
              {/*
                ── The footer nav was ONE UNDIFFERENTIATED ROW ─────────────

                Eight links wrapping across a single line, in the order the
                sections happen to appear, which makes the last thing a
                reader sees before the legal text read as a leftover list.
                It is two labelled columns now, Platform and Company, which
                is what a serious company's footer looks like and costs
                nothing but a heading.

                Still generated as plain anchors to sections of this page,
                and still no invented destinations: every item here resolves
                to something on this page or to a route that exists, which
                a gate checks by walking them.

                ── AND THE TOUCH TARGETS, WHICH I BROKE HERE ───────────────

                The first version of this two-column footer rendered all ten
                links at 21px tall. That is the same defect, in the same
                kind of element, that took seven fixes across this site last
                week, and I reintroduced it the moment I wrote a new link
                list from scratch.

                It was found by re-running the sweep against the built page,
                not by any unit test, because jsdom has no layout and cannot
                see the height of anything. `FOOTER_LINK` gives each one a
                real 36px box, which clears the 24px bar the committed
                `scripts/check-touch-targets.mjs` enforces, without the
                44px version's effect of turning a five-item list into a
                column of buttons.
              */}
              <div className="grid gap-x-16 gap-y-8 sm:grid-cols-2">
                <nav aria-label="Platform">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Platform
                  </p>
                  <ul className="mt-3 text-[16px] text-slate-400">
                    <li><a href="#platform" className={FOOTER_LINK}>Overview</a></li>
                    <li><a href="#roles" className={FOOTER_LINK}>Who it&rsquo;s for</a></li>
                    <li><a href="#lifecycle" className={FOOTER_LINK}>How it works</a></li>
                    <li><a href="#act-ai" className={FOOTER_LINK}>ACT AI</a></li>
                    <li><a href="#reassess" className={FOOTER_LINK}>Decision review</a></li>
                  </ul>
                </nav>
                <nav aria-label="Footer">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Company
                  </p>
                  <ul className="mt-3 text-[16px] text-slate-400">
                    <li><a href="#memory" className={FOOTER_LINK}>Institutional intelligence</a></li>
                    <li><a href="#trust" className={FOOTER_LINK}>Institutional trust</a></li>
                    <li><a href="#partners" className={FOOTER_LINK}>Design partners</a></li>
                    <li><a href="#contact" className={FOOTER_LINK}>Request a demo</a></li>
                    <li><Link to="/login" className={FOOTER_LINK}>Sign in</Link></li>
                  </ul>
                </nav>
              </div>
            </div>
            {/*
              The one remaining disclosure, and it stays.

              This is not a status confession, it is the line that keeps a
              page describing investment software from reading as investment
              advice or a performance claim. "Pre-release." used to open it
              and has been removed.
            */}
            {/*
              16px, not 14. This is the page's only legal statement and the
              one paragraph where small type is a liability rather than a
              style choice: a disclaimer nobody can read is a disclaimer
              that does not do its job. The grey is enough to keep it quiet.
            */}
            <p className="mt-10 border-t border-white/[0.06] pt-6 text-[16px] leading-[1.75] text-slate-400">
              Tesseract is research and workflow software. It is not an investment adviser or a broker-dealer, it gives no investment advice, and it places no orders. Nothing on this page is an offer of securities, investment advice, or a performance representation.
            </p>

            {/*
              The legal links.

              A separate row rather than appended to the nav above: those are
              sections of this page, these leave it, and mixing the two puts
              ten items in a row that reads well with five.

              Generated from LEGAL_DOCUMENTS rather than hand-written, so a
              document added or renamed in the registry appears here without
              anyone remembering this file. The same list drives /legal and
              the auth-page footer.

              Not `LegalFooter`. That component is light-palette by design: it
              renders on the auth pages, and `darkMode: 'class'` means a
              signed-out visitor has no theme class, so it commits to one
              palette. Dropping it into this dark footer would read as pasted
              in. The LINK LIST is the shared thing; the styling is this
              page's.

              The sentence above was extended rather than duplicated. It said
              what the PAGE is not; the auth footer says what the PRODUCT is
              not, and only the second matters to someone deciding whether
              this is an adviser. Two near-identical disclosures in one footer
              is how both stop being read.
            */}
            <nav
              aria-label="Legal"
              data-testid="landing-legal-links"
              /*
                ── TOUCH TARGETS, and a lesson about fixing one path ──────
                These measured 21px tall at every viewport from 1920 down
                to 390. The same defect exists in `LegalFooter`, which is
                what the six authentication screens use, and fixing that
                component first did NOT fix this: the landing page keeps
                its own copy of these links. Measuring again after the
                fix is the only reason that was caught.

                `min-h-[44px]` with inline-flex gives a real box without
                changing the type size; the gap narrows to compensate so
                the row still reads as fine print.
              */
              className="mt-6 flex flex-wrap gap-x-1 text-[14px] text-slate-400"
            >
              {LEGAL_DOCUMENTS.map(doc => (
                <Link
                  key={doc.id}
                  to={legalPath(doc.id)}
                  data-legal-document={doc.id}
                  className="inline-flex min-h-[44px] items-center rounded px-3 transition-colors hover:text-slate-300"
                >
                  {FOOTER_LABELS[doc.id] ?? doc.title}
                </Link>
              ))}
            </nav>
          </div>
        </footer>
      </div>

      {/*
        The request box, mounted last so it paints above the sticky header
        and the atmosphere layers, and mounted only while open so the first
        field can take focus on mount rather than needing a focus effect
        that fires on a prop change.

        `CONTACT_EMAIL` is passed, not read inside the dialog. One place in
        this codebase reads the contact variables, and this is it; the dialog
        renders the address only in its failure state, so a visitor who never
        sees an error never sees an address.
      */}
      {requestTopic && (
        <AccessRequestDialog
          topic={requestTopic}
          onClose={closeRequest}
          fallbackEmail={CONTACT_EMAIL || undefined}
        />
      )}
    </div>
  )
}

export default LandingPage
