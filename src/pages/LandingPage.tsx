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
  AssistantFlow,
  CaptureTrade,
  CostOfForgetting,
  MemoryLedger,
} from '../components/landing/SectionVisuals'
import {
  ArrowLeftRight, ArrowRight, BookOpen, FileSignature, Gavel, History,
  Layers, ListChecks, Lock, Quote, RotateCcw, ShieldCheck,
  Users,
} from 'lucide-react'
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

/** The page gutter, one definition so every band lines up with the nav. */
const SHELL = `mx-auto w-full max-w-7xl ${GUTTER}`

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
        2. GALACTIC BAND. One soft diagonal of dust across the frame.

        A starfield with no structure is a scatter of dots. The band is what
        makes it read as a sky, and it is also what the stars are clustered
        along, so the two layers describe the same object rather than
        sitting on top of each other.

        White at three percent, feathered at both edges by the gradient's
        own transparent stops. `rotate` on a generously oversized element,
        so the band's ends are off-frame and it never reads as a stripe with
        two visible terminations.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
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
        3. STARFIELD. One SVG, 220 circles, seeded. See `STARS` for why the
        distribution is skewed and clustered rather than uniform, and why it
        must not be random.
      */}
      <svg
        aria-hidden="true"
        data-starfield=""
        className="pointer-events-none fixed inset-0 z-0 h-full w-full"
        focusable="false"
      >
        {STARS.map((s, i) => (
          <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#fff" opacity={s.o} />
        ))}
      </svg>

      {/*
        4. COLUMN GRID, dimmed from 5.5% to 3.5%.

        Kept on purpose, and the tension is the point: an observatory grid
        over a photograph of space is precisely this product's register. It
        is also the layer that stops the sky becoming a wallpaper, because
        it keeps asserting that the page is an instrument. The outer two
        lines land on the text edge, which ties the structure to the type
        rather than laying a grid over it.
      */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 flex justify-center">
        <div className={`flex h-full w-full max-w-7xl ${GUTTER} justify-between`}>
          {[0, 1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="h-full w-px bg-gradient-to-b from-transparent via-white/[0.035] to-transparent"
            />
          ))}
        </div>
      </div>

      {/* 5. Grain, which in this context reads as sensor noise, which is
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
function Section({
  id, label, title, lead, children, divide = true, tone = 'base',
}: {
  id: string
  label?: string
  title: string
  lead?: string
  children?: React.ReactNode
  divide?: boolean
  tone?: Tone
}) {
  return (
    <section id={id} className="relative isolate">
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
      <div className={`${SHELL} py-20 sm:py-28`}>
        <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            {label && <Eyebrow>{label}</Eyebrow>}
            <h2
              /* sm:text-[2.5rem] = 40px, up from text-4xl's 36, so the step
                 from a section title to its now-17px lead still reads. */
              className={`text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-[2.5rem] ${
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
                <p className="mt-1.5 font-mono text-[14px] leading-relaxed text-slate-500">
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
        <p className="flex items-start gap-2.5 text-[14px] leading-relaxed text-slate-500">
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
                  on ? ACCENT_NUM : 'text-slate-600'
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
            <span className="text-[16px] text-slate-500">
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
              <p className="mt-5 flex items-center gap-2 text-[14px] text-slate-500">
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
                <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-slate-500">
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
const CAPTURE: [typeof BookOpen, string, string][] = [
  [Quote, 'Fast capture, kept in place', 'A thought during a call lands on the right security in a couple of keystrokes and stays attached to it.'],
  [History, 'Versions instead of overwrites', 'Editing a note adds a version, so nothing a colleague relied on is silently replaced.'],
  [Layers, 'Themes across names', 'A view that spans several securities is its own subject, rather than being retyped into four separate notes.'],
  [ListChecks, 'Structured diligence', 'Checklists and requirements make a repeated process something the firm can see the state of.'],
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
const MEMORY: [typeof Lock, string, string][] = [
  [Lock, 'It outlasts the team', 'Reasoning stays with the firm when an analyst leaves, instead of in their drive, their inbox and their head.'],
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
              <a href="#partners" className="hidden rounded-md px-3 py-2 text-[16px] font-medium text-slate-400 transition-colors hover:text-white sm:block">
                Design partners
              </a>
              <Link
                to="/login"
                className="ml-2 rounded-lg px-3.5 py-2 text-[16px] font-semibold text-slate-200 ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/5 hover:ring-white/30"
              >
                Sign in
              </Link>
            </div>
          </nav>
        </header>

        {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
        <section id="top" className="relative isolate overflow-hidden">
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
            <h1 className="mt-7 max-w-[18ch] text-pretty text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Better decisions today.
              <span className="mt-2 block text-slate-400">
                A smarter firm <span className="text-white">every year after.</span>
              </span>
            </h1>

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
            <p className="mt-9 max-w-[58ch] text-lg leading-[1.7] text-slate-300">
              Give your analysts more time to think, your portfolio managers
              the context to act, and your firm an investment process that
              gets sharper with every decision it makes.
            </p>

            <div className="mt-11 flex flex-wrap items-center gap-3">
              <ContactCta topic="demo" label="Request a demo" className={BTN_PRIMARY} onOpen={openRequest} />
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
            {/*
              ── Was a 13px apology in a 64ch column against the left rule ──

              The sentence was right and the setting was wrong. Category
              positioning is the most confident thing the hero says, and it
              was set smaller and greyer than everything around it, which
              made a deliberate claim read as a caveat somebody added later.

              The claim is unchanged and the phrasing is now three short
              declaratives at size, across the full measure, with the three
              things the record answers spread beneath them. "Not a
              market-data terminal" and "execution system" survive verbatim
              because a gate holds them on the hero, and because they are
              still the fastest way to stop a PM arriving at a demo
              expecting a Bloomberg substitute.
            */}
            <div className="mt-16 border-t border-white/10 pt-10">
              <p className="max-w-[46ch] text-pretty text-xl font-medium leading-[1.45] tracking-[-0.01em] text-slate-200 sm:text-2xl">
                Not a market-data terminal. Not an execution system.
                <span className="block text-slate-400">
                  The record of why your firm acted.
                </span>
              </p>

              {/*
                ── A THREE-ITEM `dl` WAS HERE AND WAS CUT, 2026-11-27 ──────

                It read: "Why it was bought / Who decided, and on what /
                Whether the thesis held", each with a line of gloss.

                Every one of those is now SHOWN rather than asserted, and
                within two screens of here. The platform canvas directly
                below lists the research note, the recommendation, the
                decision and the outcome review hanging off one name; the
                reassess section renders the original case beside what
                changed eight months later.

                Three abstract promises immediately above the concrete
                proof of the same three things is the repetition this page
                keeps paying for. The hero is better for ending on the
                category line and handing the reader straight to the
                product.

                The hero also had to lose roughly this many words:
                the page crossed its 1,600-word ratchet when the roles and
                reassess sections landed, and the rule on this repo is to
                cut before raising a ratchet. This was the fat.
              */}
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
        <section id="platform" className="relative scroll-mt-24">
          <div className={`${SHELL} py-24 sm:py-32`}>
            <Eyebrow>The platform</Eyebrow>
            <div className="mt-6 grid gap-x-16 gap-y-7 lg:grid-cols-12">
              {/* Was "Your whole investment process, in one place that
                  understands how it fits together" — 13 words over three
                  lines, and the last seven of them were a claim the
                  canvas underneath proves better than any clause can. */}
              <h2 className="text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:text-[2.5rem] lg:col-span-7">
                One name. Every piece of work your firm did on it.
              </h2>
              <div className="lg:col-span-5">
                <p className="max-w-[46ch] text-[17px] leading-[1.75] text-slate-400">
                  Investment teams do not need another place to put things.
                  They need the research, the idea, the recommendation, the
                  decision and the review to be one connected object instead
                  of five systems that have never met.
                </p>
                <p className="mt-5 max-w-[46ch] text-[17px] leading-[1.75] text-slate-400">
                  From the first question on a name to what you learned from
                  owning it.
                </p>
              </div>
            </div>

            <div className="mt-14">
              <WorkspaceCanvas />
            </div>
          </div>
        </section>

        {/* ── 3. The problem ──────────────────────────────────────────────── */}
        <Section
          id="problem"
          label="Why it matters"
          title="The reasoning behind a decision is the first thing a firm loses"
          lead="Investment organizations have research, market data, spreadsheets, notes, chat and trading systems. What they rarely have is one durable record of why a position was taken."
        >
          {/*
            NUMBERS MEAN SEQUENCE, and this is not one.

            The page carried three numbered lists: these four problems 01-04,
            the five lifecycle stages 01-05, and six product surfaces 01-06.
            Numbering everything makes a page read as one long enumerated
            document and, worse, implies an order that only one of the three
            actually has. The lifecycle keeps its numerals because its order
            is the argument; these four are concurrent failures, and the
            product surfaces are parallel views.

            A left rule replaces the numeral, which also retires a
            `pl-[calc(0.75rem+1.4em)]` hanging indent that existed only to
            align a paragraph under a two-character number.
          */}
          {/*
            ── Four descriptions became three COSTS, each one shown ────────

            This listed four ways reasoning goes missing, as four sentences
            in four identical boxes: research evolves, recommendations
            change, PMs disagree, positions get adjusted. All true, and all
            the same observation at four angles, which reads as one problem
            described at length rather than as a reason to buy anything.

            They are now three distinct costs with a diagram each: poor
            organization, no memory, lost alpha. The third is the one that
            matters commercially and the old list never named it.
          */}
          <CostOfForgetting />

          {/* The consequence, pulled out larger: it is the argument. */}
          {/*
            Two clauses, not three. The middle one, about separating a thesis
            that played out from one that was never tested, is the first
            clause again in different words, and a 42-word sentence set at
            24px loses its reader before the verdict arrives.
          */}
          {/*
            ── Was one 32-word sentence with two subordinate clauses ───────

            "A firm that cannot reconstruct its own reasoning cannot tell a
            correct call from a lucky one, and cannot hand a name to the
            next analyst without starting over."

            Both halves were true and the sentence asked a reader to hold a
            negative subject across two negative predicates before the point
            arrived. At 24px that loses people mid-clause.

            Now: a short claim, then the consequence as its own line. The
            compounding idea is the sharper one and it was buried at the
            end, so it goes last and alone.
          */}
          {/*
            Side by side, not stacked in a 52ch column.

            The claim and its elaboration were two paragraphs down the left
            third of a 1440px band, which left two thirds of the section's
            closing statement empty and made the most quotable line on the
            page look like a caption. Across the full measure the claim gets
            the scale it is written for, and the elaboration sits beside it
            as a second voice rather than under it as a footnote.
          */}
          <div className="mt-20 grid gap-x-16 gap-y-6 border-t border-white/10 pt-12 lg:grid-cols-12">
            <p className="text-pretty text-2xl leading-[1.25] tracking-[-0.02em] text-slate-100 sm:text-3xl lg:col-span-7 lg:text-[2.5rem]">
              A firm that cannot say why it was right cannot repeat it.
            </p>
            <p className="max-w-[44ch] text-pretty text-[17px] leading-[1.8] text-slate-400 lg:col-span-5 lg:pt-2">
              Judgement is the only thing a firm compounds that it cannot buy.
              Without a record, every name starts over and every lesson is
              learned once.
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
        <Section
          id="roles"
          label="Built for the desk"
          title="Three seats. Three different days. One system underneath."
          lead="An analyst, a portfolio manager and a CIO want different things from the same software, and only one of them signs. The other two decide whether it survives the pilot."
        >
          <RoleSwitch />
        </Section>

        {/* ── 5. The connected decision lifecycle ─────────────────────────── */}
        <Section
          id="lifecycle"
          tone="raised"
          label="The connected decision lifecycle"
          title="Research, develop, recommend, decide, execute, review. Linked, not filed."
          lead="Each stage is a typed record that points at the one before it. That linkage is the product: it is what makes a decision reviewable a year later rather than merely archived."
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
        <section id="research" className="relative">
          <div
            aria-hidden="true"
            className="h-24 bg-gradient-to-b from-transparent to-[#f7f8fa] sm:h-32"
          />
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
              <div className={`flex h-full w-full max-w-7xl ${GUTTER} justify-between`}>
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
            <div className={`${SHELL} pb-20 pt-4 sm:pb-28`}>
              <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="h-px w-8 bg-gradient-to-r from-amber-500/90 to-amber-500/0"
                    />
                    <p className="text-[14px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Research and capture
                    </p>
                  </div>
                  {/*
                    Was "out of work an ANALYST was going to do anyway".
                    Narrowing it to the analyst made the section read as a
                    feature for one seat, when the same claim covers the PM
                    writing a rationale and the committee leaving a note.
                    "Work already done" is the general form and it is the
                    stronger promise.
                  */}
                  <h2 className="mt-5 text-pretty text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-slate-900 sm:text-[2.5rem]">
                    The record assembles itself out of work already done
                  </h2>
                </div>
                <div className="lg:col-span-5 lg:pt-2">
                  <p className="max-w-[56ch] text-[17px] leading-[1.75] text-slate-600">
                    No firm adopts a system that asks its people to write
                    things down a second time, after the fact, for somebody
                    else’s benefit. So capture is not a step. It is where the
                    writing already happens.
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

              <p className="mt-16 text-[14px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Where the writing already happens
              </p>
              <div className="mt-8 grid gap-x-14 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                {CAPTURE.map(([Icon, h, p]) => {
                  const I = Icon as typeof BookOpen
                  return (
                    <div key={h}>
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-slate-900/[0.08]">
                        {/* amber-600, not amber-300: this one is on the LIGHT band. */}
                        <I className="h-[17px] w-[17px] text-amber-600" aria-hidden="true" />
                      </span>
                      <h3 className="mt-4 text-[18px] font-semibold tracking-tight text-slate-900">{h}</h3>
                      <p className="mt-2 max-w-[44ch] text-[16px] leading-[1.75] text-slate-600">{p}</p>
                    </div>
                  )
                })}
              </div>

              {/* The turn back to the lifecycle, so this band is part of the
                  argument rather than a feature list parked in the middle. */}
              <p className="mt-14 max-w-[60ch] text-pretty text-lg leading-[1.6] text-slate-700 sm:text-xl">
                Every one of these is a typed record rather than a document,
                which is the only reason the chain above can exist: a
                recommendation can cite a note because the note is a row.
              </p>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="h-24 bg-gradient-to-b from-[#f7f8fa] to-transparent sm:h-32"
          />
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
        <Section
          id="reassess"
          tone="raised"
          label="Changing your mind, well"
          title="When the facts change, know exactly what to revisit"
          lead="Markets move and theses age. Deciding whether a position is still right means knowing why it was taken, in the words used at the time rather than the ones memory supplies later."
        >
          <ReassessFigure />

          <div className="mt-14 grid gap-x-16 gap-y-8 lg:grid-cols-2">
            <p className="max-w-[48ch] text-pretty text-2xl leading-[1.35] tracking-[-0.015em] text-white sm:text-[2rem]">
              A bad outcome is not a bad decision.
            </p>
            <p className="max-w-[52ch] text-[17px] leading-[1.75] text-slate-400">
              Separating the two requires the original case, and most firms
              cannot produce it. Without it every review collapses into
              whether the position made money, which teaches a desk to avoid
              being wrong rather than to think well.
            </p>
          </div>
        </Section>

        {/* ── 8. Institutional memory ────────────────────────────────────── */}
        <Section
          id="memory"
          label="Institutional memory"
          title="The firm's accumulated decisions as an asset it owns"
          lead="Every investment organization can buy the same market data. What cannot be bought is a connected history of this firm's own judgement: what it considered, what it chose, what it declined, and what it learned."
        >
          {/*
            The three claims KEPT, and given something to stand next to.

            The argument here is entirely about elapsed time: none of this is
            worth anything in month one and it is the firm's most valuable
            asset in year three. Three paragraphs cannot show accumulation,
            so the ledger does, and the claims sit beside it rather than
            carrying the section alone.
          */}
          <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[1fr_1fr]">
            <ul className="space-y-8">
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
            <div className="lg:pt-1">
              <MemoryLedger />
            </div>
          </div>
          <p className="mt-14 max-w-[64ch] text-[16px] leading-[1.75] text-slate-500">
            Tesseract makes a firm's reasoning retrievable. It does not promise
            better returns, and no part of this platform should be read as a
            forecast of investment performance.
          </p>
        </Section>

        {/* ── 7. ACT AI ──────────────────────────────────────────────────── */}
        <Section
          id="act-ai"
          tone="raised"
          label="ACT AI"
          title="An assistant whose advantage is that your record is structured"
          lead="ACT AI sits over the decision corpus. A general model can read a folder of documents; it cannot tell you which recommendation a decision approved, because that relationship does not exist in a folder. Here it does."
        >
          {/*
            ── Three capability cards became the three STEPS of using it ───

            The cards said it knows where you are, it reads the record not
            the internet, and it cites what it used. All still true, and all
            still said: they are the lead and the closing lines now. What
            they could not do was show the part a buyer actually asks about,
            which is whose model it runs on and what happens to the answer
            afterwards.

            EVERY CLAIM IN `AssistantFlow` WAS CHECKED AGAINST PRODUCTION,
            not against this repo, because the two disagree. The note on that
            component lists the tables. The short version: bring-your-own
            model, per-user control of what it may read, and tagged
            conversations are all deployed; ARTIFACTS ARE NOT, so they are
            not on the page.
          */}
          <AssistantFlow />

          <div className="mt-14 grid gap-x-16 gap-y-6 lg:grid-cols-2">
            {/*
              The three capabilities the cards used to carry, kept verbatim
              and moved here. Their gate is a content requirement rather than
              a label, so the words survive the restyle: dropping them in the
              rewrite is exactly what it exists to catch, and it did.
            */}
            <p className="max-w-[60ch] text-[16px] leading-[1.75] text-slate-400">
              It knows where you are, it reads the record, not the internet,
              and it cites what it used. It runs on your organization&rsquo;s own
              provider key, held encrypted, so the firm controls which model
              its reasoning reaches.
            </p>
            <p className="max-w-[60ch] text-[16px] leading-[1.75] text-slate-500">
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
                    /*
                     * The one place a coloured wash survives, and it is
                     * deliberate: this is the conversion panel, the single
                     * block on the page that should be the most luminous.
                     * It is the brand blue rather than a second hue, and
                     * it is the ONLY coloured field left anywhere on the
                     * page, which is what makes it read as emphasis
                     * instead of as decoration. Everything else is white,
                     * grey or near-black.
                     */
                    'radial-gradient(40rem 20rem at 50% -20%, rgba(56,118,246,0.17), transparent 65%)',
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
                <ContactCta topic="demo" label="Request a demo" className={BTN_PRIMARY} onOpen={openRequest} />
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
                  <span className="text-[16px] font-semibold tracking-[-0.01em] text-white">Tesseract</span>
                </div>
                <p className="mt-3 text-[16px] text-slate-500">
                  A decision operating system for investment teams.
                </p>
              </div>
              <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-2 text-[16px] text-slate-500">
                <a href="#platform" className="transition-colors hover:text-white">Platform</a>
                <a href="#roles" className="transition-colors hover:text-white">Who it's for</a>
                <a href="#lifecycle" className="transition-colors hover:text-white">How it works</a>
                <a href="#reassess" className="transition-colors hover:text-white">Decision reviews</a>
                <a href="#memory" className="transition-colors hover:text-white">Memory</a>
                <a href="#act-ai" className="transition-colors hover:text-white">ACT AI</a>
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
            {/*
              16px, not 14. This is the page's only legal statement and the
              one paragraph where small type is a liability rather than a
              style choice: a disclaimer nobody can read is a disclaimer
              that does not do its job. The grey is enough to keep it quiet.
            */}
            <p className="mt-10 border-t border-white/[0.06] pt-6 text-[16px] leading-[1.75] text-slate-600">
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
              className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-slate-600"
            >
              {LEGAL_DOCUMENTS.map(doc => (
                <Link
                  key={doc.id}
                  to={legalPath(doc.id)}
                  data-legal-document={doc.id}
                  className="transition-colors hover:text-slate-300"
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
