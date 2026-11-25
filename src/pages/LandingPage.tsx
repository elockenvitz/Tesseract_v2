import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeftRight, ArrowRight, BookOpen, Boxes, FileSignature, Gavel, History,
  Layers, Link2, ListChecks, Lock, Quote, RotateCcw, ShieldCheck,
  Sparkles, Target, Users,
} from 'lucide-react'
// `LineChart` was dropped with the "Review and learning" memory item, which
// was the lifecycle's Review stage restated. An unused import is an eslint
// error here, so the icon list is a quiet check on content that left.
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

/**
 * The hero's second line.
 *
 * Was a three-stop sky to blue to teal gradient across the type. Gradient
 * text is the same category of thing as the aurora: it arrives with the
 * template, and once the background stopped shouting it was the loudest
 * remaining decoration on the page.
 *
 * It is now a monochrome fall from white to a cool grey. The sentence still
 * has two halves and a turn, which was the only job the colour was doing,
 * and a headline that recedes slightly on its second clause reads as
 * typeset rather than as filled in.
 */
const ACCENT_TEXT =
  'bg-gradient-to-br from-white via-slate-200 to-slate-400 bg-clip-text text-transparent'

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
const ACCENT_RULE = 'from-primary-400/90 to-primary-400/0'
const ACCENT_ICON = 'text-primary-300'
const ACCENT_NUM = 'text-primary-400/70'

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
      {/*
        One caption, not two. This had "How one decision is stored" on the
        left and a pill reading "Record shape" on the right, which are the
        same statement twice with a piece of chrome around the second.
      */}
      <figcaption className="text-[13px] font-semibold tracking-tight text-white">
        How one decision is stored
      </figcaption>

      <ol className="mt-7 space-y-0">
        {CHAIN.map(({ record, via }, i) => {
          const frozen = record === 'Frozen reasoning'
          return (
            <li key={record} className="relative flex gap-4">
              {/* The spine: a continuous line through every row but the last. */}
              <div className="flex w-5 shrink-0 flex-col items-center">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[#050710] ${
                    /*
                     * The frozen record was marked in cyan against the
                     * blue spine. With the page down to one accent hue, it
                     * is distinguished by VALUE instead: solid white
                     * against the accent, which is a bigger contrast step
                     * than two adjacent blues ever was.
                     */
                    frozen ? 'bg-white' : 'bg-primary-400'
                  }`}
                />
                {i < CHAIN.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={`w-px flex-1 ${frozen ? 'bg-white/30' : 'bg-primary-400/25'}`}
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
                  <p className="mt-1.5 max-w-[46ch] text-[12px] leading-relaxed text-slate-300">
                    Later edits create new versions and never alter what the
                    PM actually read.
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
    record: 'Research note',
    line: 'The written case, its evidence and its revisions live on the security itself, not in a folder or a thread.',
    so: 'The version that justified the position stays readable after the note has moved on.',
  },
  {
    icon: FileSignature,
    stage: 'Recommend',
    record: 'Recommendation',
    line: 'An analyst puts a view forward with its conviction, sizing and target, and submitting it freezes the reasoning behind it.',
    so: 'Nobody argues later about which draft was the one that got approved.',
  },
  {
    icon: Gavel,
    stage: 'Decide',
    record: 'Decision',
    line: 'The portfolio manager accepts, rejects or defers, and the rationale is captured with the decision rather than in a reply.',
    so: 'Rejections and deferrals become records the firm can study, which is where its unexamined judgement sits.',
  },
  {
    icon: ArrowLeftRight,
    stage: 'Execute',
    record: 'Accepted trade',
    line: 'The approval becomes the firm’s committed record of what it did, including whether the fill was assumed or confirmed against the book.',
    so: 'A position traces back to the argument that authorized it, not just to a timestamp.',
  },
  {
    icon: History,
    stage: 'Review',
    record: 'Outcome review',
    line: 'The decision is revisited against what actually happened, judged on the original thesis rather than the current price.',
    so: 'Judgement becomes separable from luck, because the claim and the result sit in one record.',
  },
]

/**
 * Four ways the reasoning goes missing. ONE SENTENCE EACH.
 *
 * Every item here was two sentences, and in a two-column grid that is the
 * difference between a list a reader scans and a list a reader abandons. The
 * second sentence was carrying the sting in each case, so each pair was
 * joined rather than halved: nothing was cut except the comma splice.
 */
const PROBLEMS: [string, string][] = [
  ['Research evolves', 'The note that justified the position has been edited six times since, and the version the PM actually read is gone.'],
  ['Recommendations change', 'A target moves, conviction shifts, sizing is revised, and nobody can say which version was the one that got approved.'],
  ['PMs disagree', 'A rejection carries as much information as an approval, and it usually lives in a reply to a message.'],
  ['Positions get adjusted', 'Six months on, the book looks nothing like the trade that was authorized, and nobody can retrace the path.'],
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
  [BookOpen, 'Notes that belong to the name', 'Research is written against the security, so opening a name a year later means the thinking is already there.'],
  [Quote, 'Fast capture, kept in place', 'A thought during a call lands on the right security in a couple of keystrokes and stays attached to it.'],
  [History, 'Versions instead of overwrites', 'Editing a note adds a version, so nothing a colleague relied on is silently replaced.'],
  [Layers, 'Themes across names', 'A view that spans several securities is its own subject, rather than being retyped into four separate notes.'],
  [Target, 'Price targets with a history', 'A target is a record with a lifecycle, so a revision is visible as a revision.'],
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

/**
 * Where the work happens. SHORT LINES, because this is a map.
 *
 * Every entry was a 20-word sentence stacking three or four attributes, so
 * six of them read as an argument rather than as a list of places. The
 * section before it already made the argument; this one only has to let a
 * reader picture the screens. Each line is now one clause.
 */
const SURFACES: [string, string][] = [
  ['Asset workspace', "The security, the firm's exposure, coverage and the written case in one view."],
  ['Idea pipeline', 'Ideas moving from exploring to ready-to-recommend, with conviction and staleness visible.'],
  /*
   * "preserved exactly as the PM received it" was here, and the repetition
   * gate caught it: that is the lifecycle's Recommend stage and the
   * diagram's frozen row, stated a third and fourth time. This section is a
   * MAP, so this entry says what is on the screen and leaves the guarantee
   * to the section that owns it.
   */
  ['Recommendation', 'What the analyst submitted, with its conviction, sizing and target.'],
  ['Decision inbox', 'Recommendations waiting on a portfolio manager, with accept, reject and defer all recorded.'],
  ['Decision record', 'Every decision the firm has made, with its case, its author and its rationale attached.'],
  ['Outcome review', 'A structured verdict on whether the thesis played out, attached to the decision.'],
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
  [Boxes, 'It knows where you are', 'The assistant sits in the workspace with the security you are looking at, and the portfolio it sits in, as context.'],
  [Link2, 'It reads the record, not the internet', 'Retrieval runs over your own research, ideas, recommendations and decisions, and works because they are typed and linked.'],
  [ShieldCheck, 'It cites what it used', 'Answers point at the records they came from, so a claim can be checked rather than taken on trust.'],
]

/** Primary and secondary button classes, so every CTA matches exactly. */
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-950/50 transition-all hover:bg-primary-500 hover:shadow-primary-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710]'
const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-slate-200 ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/5 hover:ring-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050710]'

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

            {/*
              Two sentences, and the second one is the payoff.

              This was one 31-word sentence followed by "It helps teams
              preserve reasoning, maintain context, and learn from decisions
              over time" — three abstractions in a row, which is the shape a
              reader skips. The claim is the same; it now lands.
            */}
            <p className="mt-9 max-w-[56ch] text-lg leading-[1.7] text-slate-300">
              It keeps research, recommendations, portfolio-manager decisions
              and outcomes as one linked record. A year from now, your firm can
              still see why it acted.
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
          <div className="grid gap-x-16 gap-y-9 sm:grid-cols-2">
            {PROBLEMS.map(([h, p]) => (
              <div key={h} className="border-l border-white/[0.09] pl-5">
                <h3 className="text-[15px] font-semibold tracking-tight text-white">{h}</h3>
                <p className="mt-2 max-w-[50ch] text-[14px] leading-[1.75] text-slate-400">{p}</p>
              </div>
            ))}
          </div>

          {/* The consequence, pulled out larger: it is the argument. */}
          {/*
            Two clauses, not three. The middle one, about separating a thesis
            that played out from one that was never tested, is the first
            clause again in different words, and a 42-word sentence set at
            24px loses its reader before the verdict arrives.
          */}
          <p className="mt-16 max-w-[60ch] text-pretty text-xl leading-[1.6] tracking-[-0.01em] text-slate-200 sm:text-2xl">
            A firm that cannot reconstruct its own reasoning cannot tell a
            correct call from a lucky one, and cannot hand a name to the next
            analyst without starting over.
          </p>
        </Section>

        {/* ── 3. The connected decision lifecycle ─────────────────────────── */}
        <Section
          id="lifecycle"
          tone="raised"
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
              {LIFECYCLE.map(({ icon: Icon, stage, record, line, so }, i) => (
                /*
                 * `data-lifecycle-stage` is a test hook, and it exists
                 * because the obvious selector was wrong again. A gate on
                 * `#lifecycle ol > li` also matches the six rows of
                 * `RecordChain`, which is an `ol` inside the same section,
                 * so it counted 11 stages. Position-based selectors in this
                 * file have now been wrong three times; name the thing.
                 */
                <li
                  key={stage}
                  data-lifecycle-stage=""
                  className="relative flex gap-5 pb-10 last:pb-0"
                >
                  <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#050710] ring-1 ring-inset ring-white/10">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/[0.07] to-transparent"
                    />
                    <Icon className={`relative h-[18px] w-[18px] ${ACCENT_ICON}`} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 pt-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`text-[11px] font-semibold tabular-nums tracking-[0.12em] ${ACCENT_NUM}`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="text-[15px] font-semibold tracking-tight text-white">{stage}</h3>
                      <span className="rounded bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-slate-400 ring-1 ring-inset ring-white/[0.08]">
                        {record}
                      </span>
                    </div>
                    <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.75] text-slate-400">{line}</p>
                    {/*
                      The consequence, set as a quiet second line.

                      This was a `dl` with "Keeps" and "So" as `dt` labels,
                      which put four pieces of text and two labels under
                      every stage. Two labels on two single items is chrome
                      that costs more attention than it directs, and the
                      indent plus the rule already say "this follows from
                      the line above". The label is gone; the rule stayed.
                    */}
                    <p className="mt-3 max-w-[54ch] border-l border-white/[0.08] pl-4 text-[12px] leading-[1.7] text-slate-500">
                      {so}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {/*
              Sticky, so the diagram is beside whichever stage you are
              reading.

              The two columns are very different heights: five stages run
              about twice the diagram's length, so a static right column
              finished near the top and left a tall empty gap beside stages
              three to five, which is the layout reading as unfinished. The
              stages and the record shape are the same object described two
              ways, and the whole reason they sit side by side is that each
              is weak alone.

              `self-start` is required: a grid item stretches by default, so
              `sticky` on a full-height box has nothing to travel in.

              The travel is BOUNDED, and the bound is inherent rather than a
              tuning choice: a sticky box cannot leave its own grid area, so
              it can move by the row height minus its own height and no
              further. Measured at 1920px that is 847 minus 570, or 277px.
              That is enough for what this needed — the browser shows the
              figure still on screen at every scroll position where any
              stage is on screen — but it is not an unlimited rail, and
              making the figure taller would eat the travel.
            */}
            <div className="lg:col-span-5 lg:sticky lg:top-24 lg:self-start">
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
                      className="h-px w-8 bg-gradient-to-r from-primary-600/90 to-primary-600/0"
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

        {/* ── 5. The product ─────────────────────────────────────────────── */}
        <Section
          id="product"
          divide={false}
          label="The product"
          title="One workspace, built around the security and the decision"
          /*
            Two sentences became one, and both cuts were duplication the
            repetition gate found. "the frozen case" is the fifth statement
            of the freezing guarantee, and "the record assembles itself as a
            side effect of the work" is the light band's own headline,
            reworded, one section earlier.
          */
          lead="Analysts work where the name lives, and portfolio managers decide from a queue rather than from a forwarded document."
        >
          {/*
            Unnumbered, and read as a two-column list of places rather than
            as a six-step process. These surfaces are concurrent views onto
            the same records, so numbering them asserted an order the product
            does not have. The row rules carry the structure the numerals
            were pretending to, and the hanging indent goes with them.
          */}
          <div className="grid gap-x-16 gap-y-0 sm:grid-cols-2">
            {SURFACES.map(([title, shows]) => (
              <div
                key={title}
                className="border-t border-white/[0.07] py-6 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
              >
                <h3 className="text-[15px] font-semibold tracking-tight text-white">{title}</h3>
                <p className="mt-1.5 max-w-[50ch] text-[13px] leading-[1.75] text-slate-400">
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
          {/*
            One sentence. This was two, and the first ("each surface is a view
            onto the same records") is the light band's closing line again.
            The example is the part that was doing work, so the example is
            what stayed.
          */}
          <p className="mt-12 max-w-[60ch] text-[14px] leading-[1.75] text-slate-400">
            A decision in the inbox and the same decision in the historical
            record are one row read two ways, so moving between surfaces never
            means re-entering anything.
          </p>
        </Section>

        {/* ── 6. Institutional memory ────────────────────────────────────── */}
        <Section
          id="memory"
          label="Institutional memory"
          title="The firm's accumulated decisions as an asset it owns"
          lead="Every investment organization can buy the same market data. What cannot be bought is a connected history of this firm's own judgement: what it considered, what it chose, what it declined, and what it learned."
        >
          {/* Three across from `sm` up. At six items this was 2-up then 3-up,
              which left a ragged last row; three items want one clean row. */}
          <div className="grid gap-x-16 gap-y-10 sm:grid-cols-3">
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
          tone="raised"
          label="ACT AI"
          title="An assistant whose advantage is that your record is structured"
          lead="ACT AI sits over the decision corpus. A general model can read a folder of documents; it cannot tell you which recommendation a decision approved, because that relationship does not exist in a folder. Here it does."
        >
          <div className="grid gap-5 lg:grid-cols-3">
            {INTELLIGENCE.map(([Icon, h, p]) => {
              const I = Icon as typeof Sparkles
              return (
                <div key={h} className={`${GLASS} p-7`}>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.05] ring-1 ring-inset ring-white/10">
                    <I className={`h-[17px] w-[17px] ${ACCENT_ICON}`} aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-[15px] font-semibold tracking-tight text-white">{h}</h3>
                  <p className="mt-2.5 text-[14px] leading-[1.75] text-slate-400">{p}</p>
                </div>
              )
            })}
          </div>

          <div className="mt-10 grid gap-x-16 gap-y-6 lg:grid-cols-2">
            <p className="max-w-[60ch] text-[14px] leading-[1.75] text-slate-400">
              It runs on your organization’s own provider key, held encrypted,
              so the firm controls which model its reasoning reaches.
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
                    subject={PARTNER_SUBJECT}
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
