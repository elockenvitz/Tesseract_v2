import { useState } from 'react'
import { clsx } from 'clsx'
import { Quote, HelpCircle } from 'lucide-react'

import type { ExploreVisual as Visual } from '../../lib/mobile/explore-visual'
import { fitsTheLabel, type YearRange } from '../../lib/market-data/daily-closes'
import { scenarioLabelsCollide } from '../../lib/mobile/explore-visual'
import { useWidth } from '../../lib/charts/use-width'

/**
 * The Explore card's picture, one small component per archetype.
 *
 * ── Why SVG and CSS rather than a chart library ───────────────────────────
 *
 * Every primitive here is a track, a marker and two labels. A charting
 * dependency would bring an axis engine, a scale system and a render loop to
 * draw a horizontal line with a dot on it, and the page can hold sixty of
 * these — the cost is per card, not per page. `ExploreSpark` already exists for
 * the one archetype that genuinely plots a series.
 *
 * ── Shared constraints, applied to all of them ────────────────────────────
 *
 * No pointer handlers ON THE PHONE. A phone card is a single tap target and
 * any child that captures a drag competes with the grid's own scroll — the
 * same rule that keeps `TileSparkline` inert. `card` density therefore stays
 * inert, byte for byte.
 *
 * `tile` density is a mouse, and there the rule costs the reader the answer:
 * a scenario axis draws three ticks and names none of them, so "which case
 * is that" needs the card opened. At `tile` the marks are hover- and
 * keyboard-reachable and report themselves in a fixed-height readout — no
 * drag, no pointer capture, nothing that can swallow a scroll, and the
 * desktop shell's `portalClick` already passes a <button> through without
 * reading it as "open this tile".
 *
 * No internal scroller. Nothing here reserves height it might not fill: an
 * archetype whose data is missing is never rendered, because
 * `exploreVisualFor` resolved it to `none` upstream.
 *
 * ── Colour ────────────────────────────────────────────────────────────────
 *
 * Semantic only. Red where a number is a downside breach, green where it is
 * upside, amber where the subject is lateness, and neutral everywhere else.
 * The tracks themselves are grey; the colour is on the marker, which is the
 * thing that carries the meaning.
 */

const TRACK = 'bg-gray-200 dark:bg-gray-700'

/**
 * How much room the picture has — the one thing these primitives were never
 * told.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 *
 * Every size in this file was chosen against a 178px phone cell, and every
 * comment below still cites that number. The desktop gallery then rendered
 * the same markup at 421px on a narrow tile and 881px on a wide one, and a
 * track is a percentage width with a fixed height: it does not get bigger
 * when the card does, it gets THINNER-LOOKING.
 *
 * Measured live at 1920x889 on AMZN's scenario card:
 *
 *   the modelled band          524 x 6px        — 87:1
 *   its two labels             810px apart, one in each bottom corner
 *   the whole picture          64px tall inside a 172px panel box
 *
 * So a bar that reads as a solid object on a phone reads as a hairline ruled
 * across a dashboard tile, and the pair of labels under it stop being a pair.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A picture is BOUNDED and WEIGHTED, never stretched. `tile` thickens every
 * track by roughly half, lifts the figures a step, and `ExploreVisualBlock`
 * caps the whole thing at a measure a label pair can span — past which extra
 * width buys no precision a reader can use and costs the picture its shape.
 *
 * `card` is the phone, byte-identical to what shipped. It is the default, so
 * every mobile caller is unchanged by construction rather than by inspection.
 *
 * The root margin belongs to the CALLER at tile density. On the phone the
 * picture follows prose directly and owns the gap; in the gallery it sits in
 * a container that already spaces it, and the two margins stacked.
 */
export type VisualDensity = 'card' | 'tile'

/**
 * Declared, not inferred. `as const` on the table below would make `Scale` the
 * literal type of the `card` row -- `root: "mt-2"` -- which the `tile` row
 * cannot satisfy, and every archetype would reject the scale it is handed.
 */
interface Scale {
  /** The gap above the picture, where the picture owns it. */
  root: string
  /** A filled progress or proportion track. */
  bar: string
  /** The modelled band on a range, drawn solid because it was stated. */
  band: string
  /** A hairline axis a marker sits on. */
  rule: string
  /** One segment of a multi-stage rail. */
  rail: string
  /** The row a range's marker is positioned within. */
  row: string
  /** A case tick on that row. */
  tick: string
  /** An endpoint dot. */
  dot: string
  /** The current-price marker, which must out-weigh the ticks. */
  marker: string
  /** The figure a picture leads with. */
  lead: string
  /** A signed move, one step under the lead. */
  move: string
  /** A price or weight read beside the picture. */
  value: string
  /** A caption or trailing sentence. */
  note: string
  /** Somebody's words, or a question. */
  body: string
}

const SCALE: Record<VisualDensity, Scale> = {
  card: {
    root: 'mt-2',
    bar: 'h-2', band: 'h-1.5', rule: 'h-px', rail: 'h-1',
    row: 'h-5', tick: 'h-2.5', dot: 'h-2 w-2', marker: 'h-3 w-3',
    lead: 'text-[17px]', move: 'text-[15px]', value: 'text-[13px]',
    note: 'text-[10px]', body: 'text-[14px]',
  },
  tile: {
    root: '',
    bar: 'h-3', band: 'h-2.5', rule: 'h-0.5', rail: 'h-1.5',
    row: 'h-6', tick: 'h-3.5', dot: 'h-2.5 w-2.5', marker: 'h-3.5 w-3.5',
    lead: 'text-[20px]', move: 'text-[17px]', value: 'text-[15px]',
    note: 'text-[11px]', body: 'text-[15px]',
  },
}

/**
 * The measure a bounded picture gets.
 *
 * 520px is where a two-ended label row stops reading as a pair: `BULL $180`
 * and `$253` at 881px apart are two unrelated captions in opposite corners.
 * It is also comfortably past every narrow tile (421px), so the cap costs
 * those nothing and changes only the cards that were being stretched.
 */
const MEASURE = 'max-w-[520px]'

/**
 * The archetypes that have something to do with extra height.
 *
 * `scenario_range` thickens its band; `quote` and `question` show the lines
 * that fit; `last_look` weights its endpoints. Every other kind is a fixed
 * arrangement of rows, so height would be void wherever it was put — those
 * stay centred in whatever box they are given, which is the best a picture
 * that cannot grow can do.
 *
 * A set rather than a prop per archetype: the caller cannot know which kind
 * it drew, and this is the one place that does.
 */
const GROWS = new Set<Visual['kind']>([
  'scenario_range', 'quote', 'question', 'last_look',
  'exposure', 'target_compare', 'workflow', 'timeline',
])

/**
 * The root of a picture that may take the room it is given.
 *
 * Centred rather than top-aligned: a bar and two labels pinned to the top of
 * a 300px box is a worse answer than the same thing in the middle of it. The
 * weight below is what actually spends the height; this just stops the
 * leftover collecting at one end.
 */
const fills = (s: Scale, grow?: boolean) =>
  clsx(s.root, grow && 'flex h-full min-h-0 flex-col justify-center')

/**
 * What a track weighs when it has room.
 *
 * Fixed steps, not percentages: a bar is read against the type beside it, and
 * one that scaled freely with a stretched tile would stop being a bar and
 * start being a block.
 *
 * ONE step above `tile`, not two. The first attempt went to h-3.5/h-2/h-1 and
 * the field came back "cheap and cheesy" -- at that weight a rounded track is
 * a lozenge, and sixty lozenges read as a toy. The room a stretched tile
 * gives is spent on the space AROUND the bar, not on the bar.
 */
const HEAVY = { bar: 'h-2.5', rail: 'h-1.5', rule: 'h-0.5', dot: 'h-3 w-3' }

/**
 * What an instrument is allowed to colour, and what each colour means.
 *
 * ── Why this is a vocabulary and not nine local choices ───────────────────
 *
 * The field was reported as bland, and measured it was: every mark in the
 * range axis, the dumbbell and the weight bar was `bg-gray-900` or
 * `bg-gray-400`, so fifty-six cards drew the same two greys and the only
 * colour anywhere was the headline percentage. Lines, as the report put it.
 *
 * The fix is NOT to tint things so they look livelier. `semantic-tone.ts`
 * records this codebase shipping colour-by-severity twice and removing it
 * twice, and the rule it settled on holds here: a colour has to mean one
 * thing, everywhere, or it is decoration that will eventually lie.
 *
 * So these are the only meanings, and they are properties of the DATA rather
 * than judgements about it:
 *
 *   down   the low end of something the desk itself stated -- its lowest
 *          case, a target under the last price. Not "bad": a bear case is
 *          not a problem, it is one of the numbers that was written down.
 *   up     the high end of the same. Not "good", for the same reason.
 *   base   the middle of a stated ladder, where there is one.
 *   scale  a measured quantity with no direction at all -- a position
 *          weight is neither up nor down, it is simply how big.
 *   mark   where the market actually is. Deliberately ink rather than a
 *          colour, because it is the one thing on the axis the desk did not
 *          choose, and it must not read as a fourth case.
 *
 * Severity is still absent, and still belongs to `tone` on the card around
 * this picture. Nothing here is allowed to compute it.
 */
const INK = {
  down: 'bg-rose-500 dark:bg-rose-400',
  up: 'bg-emerald-500 dark:bg-emerald-400',
  base: 'bg-slate-500 dark:bg-slate-400',
  scale: 'bg-indigo-500 dark:bg-indigo-400',
  mark: 'bg-gray-900 dark:bg-white',
} as const

/** The same five, as text. */
const INK_TEXT = {
  down: 'text-rose-600 dark:text-rose-400',
  up: 'text-emerald-600 dark:text-emerald-400',
  base: 'text-slate-600 dark:text-slate-400',
  scale: 'text-indigo-600 dark:text-indigo-400',
  mark: 'text-gray-900 dark:text-white',
} as const

type InkRole = keyof typeof INK

/**
 * Which end of the ladder a case sits on, from its PRICE rather than its name.
 *
 * The desk types these labels by hand -- "Bear", "Downside", "Street low" --
 * so matching on the word would colour one desk's ladder and leave the next
 * one's grey. Position in the sorted set is the fact the drawing actually
 * needs, and it cannot be spelled differently.
 *
 * A two-case ladder has no middle, which is why `base` is only returned when
 * there is something on both sides of it. A single case is `base` too: one
 * number is not a direction.
 */
function caseRole(price: number, prices: readonly number[]): InkRole {
  if (prices.length < 2) return 'base'
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  if (price <= lo) return 'down'
  if (price >= hi) return 'up'
  return 'base'
}

/** A small caps label. Used identically by every archetype so they read as a set. */
function Cap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx('text-[9px] font-bold uppercase tracking-wide text-gray-400', className)}>
      {children}
    </span>
  )
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)

/* `fitsTheLabel` lives with `YearRange` in `lib/market-data/daily-closes`,
   not here: it is a claim about data, it is unit-tested on its own, and a
   non-component export from this file breaks fast refresh for every
   archetype in it. */

/**
 * The price against the range somebody modelled.
 *
 * The marker is placed on a track that is the MODELLED range, with padding on
 * both sides so a price outside it still lands on the card. That asymmetry is
 * the point: a dot sitting past the end of the band is the whole finding, and
 * a scale that stretched to include it would put the price back inside the
 * picture and quietly undo the claim.
 *
 * ── Why this one grows and the measure does not bind it ───────────────────
 *
 * `MEASURE` caps every bounded picture at 520px because a label pair 810px
 * apart stops reading as a pair. This archetype is exempt, and the reason is
 * that it no longer has a label pair: each case names itself UNDER its own
 * tick, and the last price names itself under the marker. Width then buys
 * separation between the cases, which is the one thing the picture is for --
 * the same argument that exempts the plotted series.
 *
 * Measured on AMZN at 1920x889 before this: a 520px picture in an 881px box,
 * 361px of it void to the right, 72px tall in a 172px box.
 *
 * The axis also takes vertical room rather than sitting at a fixed 24px in
 * the middle of whatever it is given. The band, the rule and the ticks are
 * percentages of the axis row with pixel floors and ceilings, so the shape
 * holds on a phone cell and thickens on a stretched tile without ever
 * becoming a slab.
 */
function ScenarioRange({ v, s, grow, interactive, year }: {
  v: Extract<Visual, { kind: 'scenario_range' }>
  s: Scale
  /** The axis takes the room it is given instead of a fixed 24px. */
  grow?: boolean
  /** Marks report themselves on hover and by keyboard. Desktop only. */
  interactive?: boolean
  /**
   * The trailing-year high and low, where the caller has them.
   *
   * Context the axis did not have: "above your range" says nothing about
   * whether the market is also at the top of its own year or merely back
   * where it was in March. Drawn only on the grown axis -- a phone cell has
   * no room for four more marks -- and only when the window is one the label
   * can honestly be put on. See `fitsTheLabel`.
   */
  year?: YearRange | null
}) {
  /*
   * ── The scale, and when the year is allowed to stretch it ────────────────
   *
   * The modelled range is the scale, padded a third at each end, and that
   * asymmetry is deliberate: a marker past the end of the band IS the
   * finding, and a scale that stretched to swallow it would put the price
   * back inside the picture and quietly undo the claim.
   *
   * The year's extremes routinely fall outside that. They cannot be clamped
   * to the ends -- a clamped mark says "the 52-week high is right here" when
   * it is somewhere off the card -- so when there is a year to draw, the
   * domain opens to hold it and the modelled range becomes a REGION within
   * the year rather than the whole picture. Which is the more honest frame
   * anyway: the band is one claim on an axis, not the axis.
   */
  const span = v.high - v.low
  const pad = span * 0.34
  const usable = grow && year && fitsTheLabel(year) ? year : null
  const lo = usable ? Math.min(v.low, usable.low, v.current) - span * 0.08 : v.low - pad
  const hi = usable ? Math.max(v.high, usable.high, v.current) + span * 0.08 : v.high + pad
  const pos = (p: number) => ((p - lo) / (hi - lo)) * 100
  const clamp = (n: number) => Math.min(Math.max(n, 2), 98)

  const above = v.current > v.high
  const below = v.current < v.low
  const outside = above || below
  const edge = above ? v.high : v.low
  /* Only meaningful on a breach. `edge` falls back to `low` when the price is
     inside the range, so this is a positive number for an in-range card and
     the caller must gate on `outside` -- it reads "+25% below your range"
     otherwise, which is the opposite of true. The old outer `outside &&`
     hid that; reserving the row for hover took the guard away. */
  const deviation = edge > 0 ? ((v.current - edge) / edge) * 100 : null

  /*
   * What the reader is pointing at, or nothing.
   *
   * Hover and focus write the same state, so a mouse and the Tab key reach
   * the same answer. It is the mark's identity rather than its index, because
   * a case list that reorders between renders would otherwise move the
   * readout to a different case without the reader touching anything.
   */
  const [asked, setAsked] = useState<string | null>(null)
  const cases = v.cases ?? []
  /* The ladder's own extent, computed once: every tick and every label asks
     `caseRole` the same question, and recomputing min/max per mark would let
     two marks disagree if the list ever changed under them. */
  const casePrices = cases.map(c => c.price)
  const marks = [
    ...cases.map(c => ({ id: `case:${c.label}:${c.price}`, label: c.label, price: c.price, current: false })),
    { id: 'current', label: 'Last', price: v.current, current: true },
  ]
  const held = interactive ? marks.find(m => m.id === asked) ?? null : null
  /*
   * One format for the whole label row.
   *
   * `money` drops the cents at $100 and keeps them below it, which was
   * invisible while the two labels sat in opposite corners. Under their own
   * marks they are read as a row, and AMZN drew "BEAR $90.00 · BASE $120 ·
   * BULL $180" -- the same quantity written two ways, three inches apart.
   * The row decides once, on its largest member.
   */
  const whole = marks.some(m => m.price >= 100)
  const mark$ = (p: number) => whole ? `$${p.toFixed(0)}` : money(p)
  /* Distance from the last price, which is the question a case prompts:
     "how far is the market from what I said". Never from the case to itself. */
  const gap = held && !held.current && held.price > 0
    ? ((v.current - held.price) / held.price) * 100
    : null

  const ask = (id: string) => interactive
    ? {
      onMouseEnter: () => setAsked(id),
      onMouseLeave: () => setAsked(a => (a === id ? null : a)),
      onFocus: () => setAsked(id),
      onBlur: () => setAsked(a => (a === id ? null : a)),
    }
    : {}

  /**
   * The last price, folded into a case label when the two would collide.
   *
   * Every label in the row is centred on its own price, so a market trading a
   * few dollars from a modelled case puts two whole labels in the same place.
   * Measured on the Ideas lens at 1920: 2 of the 5 visible framework cards
   * had the last price lying across a case — "$179" over "Bear $180" by
   * 21.6px and "$403" over "Bull $400" by 19.8px, the labels' full height.
   *
   * The 52-week row underneath already dodges this by living on its own line,
   * and its comment gives the reason: a year low and a bear case are often
   * within a few dollars. The last price stands in exactly that relationship
   * to a case and never got the same care.
   *
   * Resolved by NAMING THEM TOGETHER rather than by moving either one. A
   * label that slides off its tick stops pointing at anything — the lesson
   * `ScenarioLadder` records from its own version of this, where drift of up
   * to 32px detached a label from the end it named — and a third row would
   * cost height the chart needs. One object, both facts, each still in its
   * own ink, sitting on the tick they share.
   */
  const [rowRef, rowPx] = useWidth<HTMLDivElement>(0)
  const labelChars = (m: { label: string; price: number; current: boolean }) =>
    (m.current ? mark$(m.price) : `${m.label} ${mark$(m.price)}`).length
  const currentMark = marks.find(m => m.current)!
  // Nearest, not first: a last price can sit inside two cases' labels at once,
  // and it belongs to the one it is actually next to.
  const mergedCase = marks
    .filter(m => !m.current && scenarioLabelsCollide(
      { centrePct: clamp(pos(m.price)), chars: labelChars(m) },
      { centrePct: clamp(pos(currentMark.price)), chars: labelChars(currentMark) },
      rowPx,
    ))
    .sort((a, b) =>
      Math.abs(a.price - currentMark.price) - Math.abs(b.price - currentMark.price))[0] ?? null

  return (
    <div
      data-explore-visual="scenario_range"
      className={clsx(s.root, grow && 'flex h-full min-h-0 flex-col justify-center')}
    >
      {/*
        One readout slot, and it never changes the picture's height.

        It leads with the deviation, because "the market escaped my range" is
        the finding and the band is the evidence for it. While a mark is held
        it says that mark instead. Both states occupy the same row, so
        pointing at a case cannot move the card under the cursor -- the same
        rule the carousel is sized by.
      */}
      {/* RESERVED where it can be filled, not rendered when it happens to
          have something to say. A card inside its range has no deviation to
          lead with, so the slot was absent -- and then the first hover
          INSERTED a row and pushed the axis down under the cursor, which is
          the one thing the fixed-height rule above exists to prevent. The
          row is held open whenever a hover could fill it. */}
      {(outside || interactive) && (
        <div
          className="mb-1.5 flex min-w-0 items-baseline gap-1.5"
          style={interactive ? { minHeight: 20 } : undefined}
        >
          {held ? (
            <>
              <span className={clsx(s.value, 'shrink-0 font-bold tabular-nums leading-none text-gray-900 dark:text-white')}>
                {money(held.price)}
              </span>
              <Cap className="min-w-0 truncate">
                {held.current ? 'last price' : held.label}
                {gap != null && ` · ${gap >= 0 ? '+' : ''}${gap.toFixed(0)}% vs last`}
              </Cap>
            </>
          ) : outside && deviation != null ? (
            <>
              <span
                data-scenario-deviation
                className={clsx(
                  s.lead, 'font-bold tabular-nums leading-none',
                  above ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {deviation >= 0 ? '+' : ''}{deviation.toFixed(0)}%
              </span>
              {/* Short enough to survive a 178px cell. "below your lowest case"
                  is 22 characters at 9px beside a 17px number, and it rendered
                  as "BELOW YOUR LOWES…" on every breach card in the grid — a
                  label that truncates mid-word tells the reader less than a
                  shorter one that fits. */}
              <Cap className="min-w-0 truncate">{above ? 'above your range' : 'below your range'}</Cap>
            </>
          ) : null}
        </div>
      )}

      {/*
        ── The axis, drawn as an instrument ──────────────────────────────────

        The previous version answered "the bars need to be larger" by making
        the band THICKER: a 22px solid grey pill with `rounded-full` ends, a
        5px rounded rule through it and a 16px filled circle in a white ring.
        Reported back as "cheap and cheesy", and that is the right word for
        it -- fat rounded pills and ringed dots are the vocabulary of a
        fitness app, not of an instrument someone sizes a position with.

        Height was never the problem; WEIGHT was. The same room spent on
        structure instead reads as a measurement:

          a baseline      one hairline the marks stand on, square ends
          the range       a tinted REGION with ruled edges, not a solid pill
          each case       a hairline rising off the baseline, its own height
          the market      a full-height hairline capped with a small diamond

        Nothing rounded, nothing filled except the 5px cap, and colour only
        on the one mark that carries meaning. The phone keeps the old drawing
        exactly -- see the branch below -- because at 178px there is no room
        for structure and a solid bar is the honest primitive.
      */}
      {grow ? (
        <div
          className="relative min-h-0 w-full flex-1"
          /* `marginBottom` where the year is drawn: its span and serifs hang
             5px below the baseline, and without the room they sit on top of
             the label row. */
          style={{ minHeight: 30, maxHeight: 76, marginBottom: usable ? 6 : 0 }}
        >
          {/* The modelled range, as a shaded region.
              Tinted ALONG its own axis -- rose at the low end, emerald at the
              high -- so the region states its own direction instead of being
              a grey smudge the marks happen to sit in. Low alpha, because it
              is the ground: the moment this competes with the ticks it has
              stopped being a background. */}
          <div
            data-scenario-band
            className="absolute bottom-0 h-[52%] bg-gradient-to-r from-rose-500/[0.14] via-slate-400/[0.10] to-emerald-500/[0.16] dark:from-rose-400/20 dark:via-slate-300/10 dark:to-emerald-400/20"
            style={{ left: `${pos(v.low)}%`, width: `${pos(v.high) - pos(v.low)}%` }}
          />
          {/* Its edges, ruled, and standing a little proud of the fill. This
              is what makes it a bounded region and not a smudge -- the two
              numbers were STATED and the drawing should say exactly where.
              Each edge takes the colour of the end it bounds, so the frame
              and the case standing on it agree.
              The region is deliberately SHORTER than the axis: at full height
              a tinted rectangle reads as an empty box waiting for content,
              which is what the first attempt looked like. */}
          {([['down', v.low], ['up', v.high]] as const).map(([role, p]) => (
            <div
              key={`edge-${role}`}
              data-scenario-edge={role}
              className={clsx('absolute bottom-0 h-[66%] w-0.5 opacity-70', INK[role])}
              style={{ left: `${pos(p)}%` }}
              aria-hidden
            />
          ))}
          {/* The baseline the marks stand on. */}
          <div className="absolute inset-x-0 bottom-0 h-px bg-gray-400 dark:bg-white/25" aria-hidden />

          {/* ── The year the market actually traded ────────────────────────
              Drawn BELOW the baseline, as a span with end serifs, so it
              reads as the ground the cases are claims about rather than as
              a fourth case. "Above your range" is a different statement
              from "above your range AND at the top of its year", and the
              axis could not previously tell them apart. */}
          {usable && (
            <>
              <div
                data-scenario-year
                className="absolute -bottom-[3px] h-px bg-gray-300 dark:bg-white/20"
                style={{ left: `${pos(usable.low)}%`, width: `${pos(usable.high) - pos(usable.low)}%` }}
                aria-hidden
              />
              {([['low', usable.low], ['high', usable.high]] as const).map(([which, p]) => (
                <div
                  key={`52-${which}`}
                  data-scenario-year-mark={which}
                  className="absolute -bottom-[5px] h-[5px] w-px bg-gray-400 dark:bg-white/30"
                  style={{ left: `${pos(p)}%` }}
                  aria-hidden
                />
              ))}
            </>
          )}

          {cases.map(c => {
            const id = `case:${c.label}:${c.price}`
            const on = held?.id === id
            /* Which end of the ladder this case is, by price. See `caseRole`:
               the colour is the case's own position in the set the desk
               wrote, not a verdict on it. */
            const role = caseRole(c.price, casePrices)
            /* The handle rides the TICK, not the hit area around it: every
               reader of this attribute -- the density guard among them -- is
               asking about the drawn mark, and the 20px button is a box. */
            const tick = (
              <span
                data-scenario-case={c.label}
                data-scenario-role={role}
                /* Taller than the region, so a case inside the range still
                   reads as a mark ON a scale rather than disappearing into
                   the tint behind it.
                   A hairline was the other half of "bland": at 1px a coloured
                   tick is indistinguishable from a grey one, so the weight
                   has to come up with the colour or the colour does nothing.
                   Held gets a third step and a cap, so pointing at a mark is
                   still visible against two neighbours that are already
                   coloured. */
                className={clsx(
                  'absolute bottom-0 block h-[80%] rounded-t-[1px]',
                  INK[role],
                  on ? 'w-1' : 'w-0.5',
                  on ? 'opacity-100' : 'opacity-80',
                )}
              />
            )
            return interactive ? (
              <button
                key={id}
                type="button"
                data-scenario-mark={c.label}
                aria-label={`${c.label} ${money(c.price)}`}
                className="absolute inset-y-0 flex w-5 -translate-x-1/2 items-end justify-center focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                style={{ left: `${clamp(pos(c.price))}%` }}
                {...ask(id)}
              >
                {tick}
              </button>
            ) : (
              <span
                key={id}
                className="absolute inset-y-0 flex w-px -translate-x-1/2 items-end"
                style={{ left: `${clamp(pos(c.price))}%` }}
              >
                {tick}
              </span>
            )
          })}

          {/* The market. A rule the full height of the axis, capped with a
              small diamond -- a marker that reads as placed rather than
              stuck on, and the only coloured thing in the picture. */}
          {(() => {
            /* Ink by default, and the breach colour only on a breach. The
               market is not one of the desk's cases and must not read as a
               fourth coloured tick -- see `INK.mark`. When it HAS broken out
               the colour is the finding, so it takes it. */
            const ink = outside
              ? above ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-rose-600 dark:bg-rose-400'
              : INK.mark
            const mark = (
              <>
                {/* The rule, now half a pixel heavier than the case ticks it
                    crosses. At 1px against coloured 2px ticks the one mark
                    that is not a claim was the faintest thing on the axis. */}
                <span className={clsx('absolute inset-y-0 w-0.5 opacity-90', ink)} aria-hidden />
                <span
                  data-scenario-current
                  className={clsx(
                    'absolute top-0 h-[7px] w-[7px] -translate-y-1/2 rotate-45 shadow-sm ring-1 ring-white transition-transform dark:ring-gray-900',
                    ink,
                    held?.current && 'scale-150',
                  )}
                />
              </>
            )
            return interactive ? (
              <button
                type="button"
                data-scenario-mark="current"
                aria-label={`Last price ${money(v.current)}`}
                className="absolute inset-y-0 flex w-6 -translate-x-1/2 justify-center focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                style={{ left: `${clamp(pos(v.current))}%` }}
                {...ask('current')}
              >
                {mark}
              </button>
            ) : (
              <span
                className="absolute inset-y-0 flex w-px -translate-x-1/2 justify-center"
                style={{ left: `${clamp(pos(v.current))}%` }}
              >
                {mark}
              </span>
            )
          })()}
        </div>
      ) : (
        <div className={clsx('relative', s.row)}>
          {/* The modelled band. Solid, because it is the thing that was
              stated, and because a 178px cell has no room for structure. */}
          <div
            data-scenario-band
            className={clsx('absolute top-1/2 -translate-y-1/2 rounded-full bg-gray-300 dark:bg-gray-600', s.band)}
            style={{ left: `${pos(v.low)}%`, width: `${pos(v.high) - pos(v.low)}%` }}
          />
          {/* The rest of the axis, so the marker has somewhere to be. */}
          <div className={clsx('absolute inset-x-0 top-1/2 -translate-y-1/2', s.rule, TRACK)} aria-hidden />
          {/* Every case gets a tick, so a three-case ladder does not read as two. */}
          {cases.map(c => (
            <div
              key={`${c.label}:${c.price}`}
              data-scenario-case={c.label}
              className={clsx('absolute top-1/2 w-px -translate-y-1/2 bg-gray-500 dark:bg-gray-400', s.tick)}
              style={{ left: `${clamp(pos(c.price))}%` }}
            />
          ))}
          <div
            data-scenario-current
            className={clsx(
              'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-gray-900',
              s.marker,
              outside
                ? above ? 'bg-emerald-500' : 'bg-rose-500'
                : 'bg-gray-900 dark:bg-white',
            )}
            style={{ left: `${clamp(pos(v.current))}%` }}
          />
        </div>
      )}

      {/*
        ── Where the labels go, and why the right-hand void is gone ──────────

        This was two captions, one in each bottom corner, `justify-between`.
        At 881px they were 810px apart: not a pair, just two unrelated strings
        in opposite corners of a card -- which is the reason `MEASURE` capped
        the picture at 520px and left 361px of the box empty.

        Anchored under their own marks instead, width is no longer something
        to absorb: it is what separates BEAR from BULL from the last price.
        Narrow tiles keep the corner pair, because three labels inside 421px
        would collide and a collision reads worse than a corner.
      */}
      {grow && cases.length > 0 ? (
        <div ref={rowRef} className={clsx('relative mt-1 w-full', usable ? 'h-[23px]' : 'h-3.5')}>
          {marks.map(m => {
            // Folded into the case it collides with, and drawn there instead.
            if (m.current && mergedCase) return null
            const merged = !m.current && mergedCase?.id === m.id ? currentMark : null
            return (
            <span
              key={m.id}
              data-scenario-label={m.current ? 'current' : m.label}
              data-scenario-merged={merged ? 'current' : undefined}
              className={clsx(
                'absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] font-bold uppercase leading-none tracking-wide tabular-nums',
                /* A label takes its mark's colour, so the row reads as the
                   axis rather than as a caption under it -- BEAR and the
                   tick it names are now one thing. Grey labels over coloured
                   ticks was the version that looked like a key for a chart
                   printed somewhere else. */
                m.current
                  ? 'text-gray-700 dark:text-gray-200'
                  : INK_TEXT[caseRole(m.price, casePrices)],
                held?.id === m.id ? 'opacity-100' : 'opacity-90',
              )}
              style={{ left: `${clamp(pos(m.price))}%` }}
            >
              {m.current ? mark$(m.price) : `${m.label} ${mark$(m.price)}`}
              {/* The last price keeps its own ink, so the pair still reads as
                  two facts rather than one longer case name. */}
              {merged && (
                <span className="ml-1 text-gray-700 dark:text-gray-200">
                  · {mark$(merged.price)}
                </span>
              )}
            </span>
            )
          })}
          {/* The year's two ends, on their own line in the lightest ink on
              the card -- they are the frame, and a frame that competes with
              the claim inside it has stopped being one. A second row rather
              than the same one, because a 52-week low and a bear case are
              often within a few dollars and the two labels would overlap. */}
          {usable && ([['low', usable.low], ['high', usable.high]] as const).map(([which, p]) => (
            <span
              key={`52label-${which}`}
              data-scenario-year-label={which}
              className="absolute top-[11px] -translate-x-1/2 whitespace-nowrap text-[8px] font-semibold uppercase leading-none tracking-wide tabular-nums text-gray-400 dark:text-gray-500"
              style={{ left: `${clamp(pos(p))}%` }}
              title={`52-week ${which} from closes ${usable.from} to ${usable.to}`}
            >
              52w {which} {mark$(p)}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
          <Cap className="min-w-0 truncate">{v.breachedLabel ? `${v.breachedLabel} ${money(edge)}` : `${money(v.low)}–${money(v.high)}`}</Cap>
          <span className={clsx('shrink-0 font-bold tabular-nums text-gray-700 dark:text-gray-200', s.note)}>
            {money(v.current)}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Current against target, including the case where there is no target.
 *
 * A dumbbell rather than a bar: two named points and the distance between them
 * is exactly the claim, and a filled bar would imply a magnitude relative to
 * zero that nobody means. The empty state keeps the geometry and dashes the far
 * end — "nobody has put a number here" said in the shape of the thing that is
 * missing.
 */
function TargetCompare({ v, s, grow }: {
  v: Extract<Visual, { kind: 'target_compare' }>
  s: Scale
  grow?: boolean
}) {
  const has = v.target != null
  const upside = has && v.current > 0 ? ((v.target! - v.current) / v.current) * 100 : null
  const dot = grow ? HEAVY.dot : s.dot
  /* Which way the target sits from the market. `null` where there is no
     target to point at, and where the two are equal -- a zero-length claim
     has no direction and must not be coloured as though it did. */
  const reach: InkRole | null = upside == null || Math.abs(upside) < 0.05
    ? null
    : upside > 0 ? 'up' : 'down'

  return (
    <div data-explore-visual="target_compare" className={fills(s, grow)}>
      <div className="flex items-baseline justify-between">
        <Cap>Current</Cap>
        <Cap>{v.targetLabel ?? 'Target'}</Cap>
      </div>
      {/* `min-w-0` on the row, and the money labels truncate rather than set a
          floor. Without both, a four-figure price and a four-figure target on a
          half-width card push the row past the column — which at 390px is a
          horizontally scrolling PAGE, not a clipped label. */}
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <span className={clsx('min-w-0 truncate font-bold tabular-nums text-gray-900 dark:text-white', s.value)}>
          {money(v.current)}
        </span>
        {/* The market end stays ink: it is where the price IS, not a number
            anybody chose. The far end and the span between them take the
            direction of the claim. */}
        <span className={clsx('shrink-0 rounded-full', INK.mark, dot)} aria-hidden />
        <span
          className={clsx(
            'min-w-0 flex-1 rounded-full',
            has
              ? clsx(
                  grow ? HEAVY.rule : s.rule,
                  /* The distance, drawn as a direction. A flat grey track
                     between two dots is the "bunch of lines" this card was;
                     the gradient runs from the market toward the target, so
                     the span says which way the claim points before any
                     number is read. */
                  reach === 'up'
                    ? 'bg-gradient-to-r from-gray-300 to-emerald-500 dark:from-gray-600 dark:to-emerald-400'
                    : reach === 'down'
                      ? 'bg-gradient-to-r from-gray-300 to-rose-500 dark:from-gray-600 dark:to-rose-400'
                      : TRACK,
                )
              /* No target: the dashed run to nowhere is kept, because the
                 shape of the absence IS the statement -- see the empty-state
                 note below. What changes is its ink. Grey said "this part of
                 the card is inactive"; every one of these is in fact a piece
                 of work nobody has done, which `semantic-tone` calls
                 `review` and draws amber. Unfinished, not broken. */
              : 'h-px border-t border-dashed border-amber-300 dark:border-amber-700/70',
          )}
          aria-hidden
        />
        {has ? (
          <>
            <span
              /* `'none'` rather than omitting the attribute: "this claim has
                 no direction" is a state worth being able to read, and an
                 absent attribute is indistinguishable from a dot that was
                 never drawn. */
              data-target-dot={reach ?? 'none'}
              className={clsx(
                'shrink-0 rounded-full border-2 bg-white dark:bg-gray-900', dot,
                reach === 'up' ? 'border-emerald-500 dark:border-emerald-400'
                  : reach === 'down' ? 'border-rose-500 dark:border-rose-400'
                    : 'border-gray-900 dark:border-white',
              )}
              aria-hidden
            />
            <span data-target-value className={clsx('min-w-0 truncate font-bold tabular-nums text-gray-900 dark:text-white', s.value)}>
              {money(v.target!)}
            </span>
          </>
        ) : (
          /* Not a zero, not a dash on the axis — a stated absence. Implying a
             number here is the one thing a no-target card must not do. */
          <span
            data-target-empty
            className={clsx('min-w-0 shrink truncate rounded border border-dashed border-amber-400 bg-amber-50 px-1.5 py-0.5 font-bold uppercase tracking-wide text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300', s.note)}
          >
            Not set
          </span>
        )}
      </div>
      {upside != null && (
        <p className={clsx(
          'mt-1 font-semibold tabular-nums', s.note,
          /* The readout agrees with the dot it describes. Grey here while the
             far end was coloured made the number look like a caption about
             someone else's chart. */
          reach ? INK_TEXT[reach] : 'text-gray-500 dark:text-gray-400',
        )}>
          {upside >= 0 ? '+' : ''}{upside.toFixed(0)}% to target
        </p>
      )}
    </div>
  )
}

/** "14 months", "3 weeks". Whole units — a horizon is not read to two decimals. */
function elapsed(ms: number): string {
  const days = Math.round(ms / 86_400_000)
  if (days < 14) return `${Math.max(days, 0)}d`
  if (days < 60) return `${Math.round(days / 7)}w`
  const m = Math.round(days / 30.44)
  return m < 24 ? `${m}mo` : `${(m / 12).toFixed(1)}y`
}

const shortDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

/**
 * Set → Due → Today, with the overrun drawn as its own stretch.
 *
 * The two spans are the finding: a twelve-month view four months late and a
 * three-month view four months late are the same absolute overrun and entirely
 * different failures. Prose collapses them into one "4mo"; two lengths of one
 * line cannot.
 */
function Elapsed({ v, now, s, grow }: {
  v: Extract<Visual, { kind: 'timeline' }>
  now: number
  s: Scale
  grow?: boolean
}) {
  const t0 = new Date(v.statedAt).getTime()
  if (!Number.isFinite(t0) || now <= t0) return null
  return (
    <div data-explore-visual="timeline" data-timeline-shape="elapsed" className={fills(s, grow)}>
      <div className={clsx('w-full rounded-full', grow ? HEAVY.bar : s.bar, TRACK)}>
        <div data-timeline-elapsed className="h-full w-full rounded-full bg-amber-400 dark:bg-amber-500" />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <Cap>Last {shortDate(v.statedAt)}</Cap>
        <span className={clsx('font-bold tabular-nums text-amber-600 dark:text-amber-400', s.note)}>
          {elapsed(now - t0)}
        </span>
      </div>
      <p className={clsx('mt-0.5 font-bold text-amber-600 dark:text-amber-400', s.note)}>
        {v.overdueLabel ?? 'since anything was recorded'}
      </p>
    </div>
  )
}

/**
 * With no `dueAt` there is no commitment to have missed.
 *
 * So there is nothing to split the track on: one stretch, the date it started,
 * and how long it has run. Coverage neglect is the case — nothing has happened
 * since a date, and nobody ever set a deadline. Drawing the amber "due" cap on
 * it would assert a promise nobody made, which is the rule `target_compare`
 * already follows when it refuses to draw a target that does not exist.
 *
 * The same primitive rather than a second one: an aging strip and a deadline
 * strip differ by whether a marker exists, which is a property of the data.
 */
function Timeline({ v, now, s, grow }: {
  v: Extract<Visual, { kind: 'timeline' }>
  now: number
  s: Scale
  grow?: boolean
}) {
  const dueAt = v.dueAt
  if (!dueAt) return <Elapsed v={v} now={now} s={s} grow={grow} />
  const t0 = new Date(v.statedAt).getTime()
  const t1 = new Date(dueAt).getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null
  const t2 = Math.max(now, t1 + 1)

  const honoured = t1 - t0
  const over = t2 - t1
  // Floored so a badly overdue view still shows the stretch it was given.
  const pct = Math.min(Math.max((honoured / (t2 - t0)) * 100, 22), 78)

  return (
    <div data-explore-visual="timeline" className={fills(s, grow)}>
      <div className={clsx('flex w-full items-stretch gap-0.5', grow ? HEAVY.bar : s.bar)}>
        <div className={clsx('rounded-l-full', TRACK)} style={{ width: `${pct}%` }} />
        <div
          data-timeline-overdue
          className="rounded-r-full bg-amber-400 dark:bg-amber-500"
          style={{ width: `${100 - pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <Cap>Set {shortDate(v.statedAt)}</Cap>
        <Cap className="text-amber-600 dark:text-amber-400">Due {shortDate(dueAt)}</Cap>
      </div>
      <p className={clsx('mt-0.5 font-bold text-amber-600 dark:text-amber-400', s.note)}>
        +{elapsed(over)} {v.overdueLabel ?? 'overdue'}
      </p>
    </div>
  )
}

/**
 * How much of a book rides on this.
 *
 * Scaled against a fixed 20% ceiling rather than against the largest weight on
 * the page: a bar whose meaning depends on its neighbours is a bar the reader
 * has to re-learn every scroll, and 20% is comfortably above any single
 * position in these books.
 */
function Exposure({ v, s, grow }: {
  v: Extract<Visual, { kind: 'exposure' }>
  s: Scale
  grow?: boolean
}) {
  const pct = Math.min((v.weightPct / 20) * 100, 100)
  return (
    <div data-explore-visual="exposure" className={fills(s, grow)}>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span data-exposure-value className={clsx('font-bold tabular-nums leading-none text-gray-900 dark:text-white', s.lead)}>
          {v.weightPct.toFixed(1)}%
        </span>
        <Cap className="min-w-0 truncate">{v.portfolioName ? `of ${v.portfolioName}` : 'of the book'}</Cap>
      </div>
      {/* The bar, with the scale it is read against.
          A weight has no direction -- 28% of a book is neither good nor bad
          -- so it takes `scale`, the one colour in the vocabulary that makes
          no claim. What it was missing was not colour but a RULER: a lone
          filled bar says "some" and nothing else, and the ticks at each
          quarter of the 20% span turn it back into a measurement. */}
      <div className={clsx('relative mt-1.5 w-full overflow-hidden rounded-full', grow ? HEAVY.bar : s.bar, TRACK)}>
        <div
          data-exposure-fill
          className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600 dark:from-indigo-400 dark:to-indigo-300"
          style={{ width: `${pct}%` }}
        />
        {grow && [25, 50, 75].map(t => (
          <span
            key={t}
            data-exposure-tick={t}
            className="absolute inset-y-0 w-px bg-white/55 dark:bg-gray-900/45"
            style={{ left: `${t}%` }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  )
}

/** Two weights that disagree, drawn to one scale so the gap is the picture. */
function Comparison({ v, s }: { v: Extract<Visual, { kind: 'comparison' }>; s: Scale }) {
  const max = Math.max(...v.rows.map(r => Math.abs(r.pct)), 1)
  return (
    <div data-explore-visual="comparison" className={clsx('space-y-1', s.root)}>
      {v.rows.map((r, i) => (
        <div key={r.label} className="flex min-w-0 items-center gap-1.5">
          <Cap className="w-[52px] shrink-0 truncate">{r.label}</Cap>
          <div className={clsx('min-w-0 flex-1 overflow-hidden rounded-full', s.bar, TRACK)}>
            <div
              data-comparison-bar={r.label}
              className={clsx('h-full rounded-full', i === 0 ? 'bg-gray-900 dark:bg-white' : 'bg-gray-400 dark:bg-gray-500')}
              style={{ width: `${(Math.abs(r.pct) / max) * 100}%` }}
            />
          </div>
          <span className={clsx('w-[38px] shrink-0 text-right font-bold tabular-nums text-gray-700 dark:text-gray-200', s.note)}>
            {r.pct.toFixed(1)}%
          </span>
        </div>
      ))}
      {v.deltaLabel && (
        <p className={clsx('pt-0.5 text-right font-bold text-gray-500 dark:text-gray-400', s.note)}>
          {v.deltaLabel}
        </p>
      )}
    </div>
  )
}

/**
 * The move since anybody looked, with the looking marked.
 *
 * `LAST LOOK → +21% → TODAY` rather than a year of closes: the window that
 * matters starts at the review, and a full-history chart puts the interesting
 * stretch somewhere in the middle of a line with nothing to mark it.
 */
function LastLook({ v, s, grow }: {
  v: Extract<Visual, { kind: 'last_look' }>
  s: Scale
  /** Takes vertical room by weight, never by stretching into a billboard. */
  grow?: boolean
}) {
  const up = v.movePct >= 0
  /* A dumbbell is one line by nature: given 115px it cannot grow a second
     row, so it spends the room on WEIGHT -- a thicker rule and larger
     endpoints, bounded -- and centres what is left. An archetype that cannot
     honestly use height says so by staying small, which is why the ceiling
     here is small. */
  const dot = grow ? 'h-3.5 w-3.5' : s.dot
  return (
    <div
      data-explore-visual="last_look"
      className={clsx(s.root, grow && 'flex h-full min-h-0 flex-col justify-center')}
    >
      <div className={clsx('flex min-w-0 items-center', grow ? 'gap-2' : 'gap-1.5')}>
        <span className={clsx('shrink-0 rounded-full border-2 border-gray-400 bg-white dark:border-gray-500 dark:bg-gray-900', dot)} aria-hidden />
        {/* The label gives way before the number does: "+21%" is the finding
            and "Last look 10mo" is context for it. */}
        {/* "Last look 10mo" is 14 characters between a dot, a rule and a
            number on a 178px card, and it drew as "LAST LOOK 1…" — the age
            truncated to a single digit, which is worse than no age at all
            because a reader cannot tell 1mo from 18mo. The card's own age
            stamp is in the header; this label only has to name the marker. */}
        <Cap className="shrink-0">Last look</Cap>
        {/* The run from the last look to today, drawn as a direction rather
            than a grey connector. The two ends were already coloured and the
            line between them was not, which is what made this card read as
            "a bunch of lines" with a number stuck on the end. */}
        <span
          data-lastlook-run
          className={clsx(
            'min-w-0 flex-1 rounded-full', grow ? 'h-1' : s.rule,
            up
              ? 'bg-gradient-to-r from-gray-300 to-emerald-500 dark:from-gray-600 dark:to-emerald-400'
              : 'bg-gradient-to-r from-gray-300 to-rose-500 dark:from-gray-600 dark:to-rose-400',
          )}
          aria-hidden
        />
        <span
          data-lastlook-move
          className={clsx(
            'shrink-0 font-bold tabular-nums leading-none', s.move,
            up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}
        >
          {up ? '+' : ''}{v.movePct.toFixed(0)}%
        </span>
        <span className={clsx('shrink-0 rounded-full', dot, up ? 'bg-emerald-500' : 'bg-rose-500')} aria-hidden />
      </div>
      <p className="mt-1 text-right text-[9px] font-bold uppercase tracking-wide text-gray-400">Today</p>
    </div>
  )
}

/** Where an authored thing has got to, as a rail rather than a chart. */
function Workflow({ v, s, grow }: {
  v: Extract<Visual, { kind: 'workflow' }>
  s: Scale
  grow?: boolean
}) {
  return (
    <div data-explore-visual="workflow" className={fills(s, grow)}>
      {v.direction && (
        <span
          data-workflow-direction={v.direction}
          className={clsx(
            'inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            v.direction === 'buy'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
          )}
        >
          {v.direction}
        </span>
      )}
      {/* ── The rail, and ONE label ──────────────────────────────────────
          Every stage used to be captioned, four of them across a 178px cell,
          which left ~40px each at 8px type: "Idea / MODE… / DECIDI… / Done".
          Two of the four words were unreadable, and the two that fitted were
          the two that say least.
          The rail already shows progress — filled segments to the left of the
          marker, empty to the right — so the only word carrying information the
          shape does not is the stage it has actually reached. One label, at a
          size that can be read, under a rail that keeps its four segments. */}
      <div className={clsx('flex items-center gap-1', v.direction && 'mt-1.5')}>
        {v.stages.map((stage, i) => (
          <div
            key={stage}
            data-workflow-stage={stage}
            data-active={i === v.activeIndex}
            className={clsx(
              'min-w-0 flex-1 rounded-full', grow ? HEAVY.rail : s.rail,
              i <= v.activeIndex ? 'bg-violet-500' : TRACK,
            )}
          />
        ))}
      </div>
      <p
        data-workflow-active-label
        className={clsx('mt-1.5 truncate font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400', s.note)}
      >
        {v.stages[v.activeIndex] ?? v.stages[0]}
      </p>
    </div>
  )
}

/** Somebody's words, as the hero. No chart, no metric, no track. */
function QuoteVisual({ v, s, grow }: {
  v: Extract<Visual, { kind: 'quote' }>
  s: Scale
  /** Shows the lines that FIT rather than a fixed count of them. */
  grow?: boolean
}) {
  return (
    <div
      data-explore-visual="quote"
      className={clsx(s.root, grow && 'flex h-full min-h-0 flex-col')}
    >
      <Quote className="h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-600" aria-hidden />
      {/* `line-clamp-4` is a count, and a count cannot know how tall the box
          is: in a tile stretched to a tall neighbour it showed four lines and
          left the rest of the room empty while the quote itself was still
          cut off. Clipped against the box instead, the extra height buys
          actual words -- which is the only honest thing prose can do with
          it. The clamp stays on the phone, where the box is fixed. */}
      <p
        data-quote-text
        className={clsx(
          'mt-1 font-medium italic leading-[1.4] text-gray-800 dark:text-gray-100',
          grow ? 'min-h-0 flex-1 overflow-hidden' : 'line-clamp-4',
          s.body,
        )}
      >
        {v.text}
      </p>
    </div>
  )
}

/**
 * The producer's own question, as the object.
 *
 * Deliberately NOT the quote treatment. A quote is somebody's stated view and
 * is set in italics as a thing that was said; this is a thing being ASKED, and
 * it reads as an open question — upright, with the mark of an unanswered
 * prompt beside it. The difference matters on a page carrying both.
 *
 * No answer buttons here. The card's action layer already owns what the reader
 * can do, and a second set of affordances inside the picture would be a fourth
 * place to click on a tile that has three.
 */
function QuestionVisual({ v, s, grow }: {
  v: Extract<Visual, { kind: 'question' }>
  s: Scale
  /** Shows the lines that FIT rather than a fixed count of them. See `QuoteVisual`. */
  grow?: boolean
}) {
  return (
    <div
      data-explore-visual="question"
      className={clsx(s.root, grow && 'flex h-full min-h-0 flex-col')}
    >
      {/* A question is work waiting on a person, which is `review` in the
          shared vocabulary. It was drawn as a 14px amber outline over grey
          prose, so on a tall card it read as an afterthought rather than as
          the one thing the card is asking. The icon is now filled and sits
          in its own tinted disc, and an amber rule runs down the prose, so
          the prompt reads as a prompt at a glance and at a distance. */}
      <span
        data-question-badge
        className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
        aria-hidden
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </span>
      {/* The prompt sits ON a tinted ground rather than beside a rule.
          A left border was the first attempt and it drew a 110px amber line
          down the card next to one line of text -- the same "line to
          nowhere" the rest of this pass is removing. A panel takes the
          height honestly instead: where the card is tall the callout is
          tall, and the question looks placed rather than stranded. */}
      {/*
        ── Two attempts that were wrong, and why there is no panel here ──────

        First a 2px amber rule down the left of the text: on a tall card
        that drew a 110px amber line beside one line of prose -- the same
        "line to nowhere" the rest of this pass exists to remove.

        Then a tinted callout around the text. Worse: stretched to the
        card's height it is a 200px amber rectangle holding one sentence,
        which is the same void as before only louder. Clamping it to hug the
        text fixed the look and broke a real rule -- the density guard
        requires this prose to show the lines that FIT rather than a fixed
        count, so a long question would have been cut at four lines on a
        card with room for eight.

        The lesson is that a GROUND cannot carry the signal here, because
        the ground is exactly what scales with the empty space. The badge
        above can: it is a fixed size at every height. So the prompt reads
        amber from the mark, not from a box, and the text keeps the height
        behaviour the guard pins.
      */}
      <p
        data-question-text
        className={clsx(
          'mt-1.5 font-semibold leading-[1.35] text-gray-800 dark:text-gray-100',
          grow ? 'min-h-0 flex-1 overflow-hidden' : 'line-clamp-3',
          s.body,
        )}
      >
        {v.text}
      </p>
    </div>
  )
}

interface ExploreVisualProps {
  visual: Visual
  /** The sparkline, injected — this component never reaches for price data. */
  sparkline?: React.ReactNode
  now?: number
  /**
   * How much room the picture has. Defaults to the phone, so every existing
   * caller is unchanged by construction. See `SCALE`.
   */
  density?: VisualDensity
  /**
   * The picture may take the room it is given rather than sitting at its
   * minimum in the middle of it.
   *
   * Set by the desktop gallery, where the grid stretches a tile to its row
   * and the picture is the element that wants the difference. Off by default,
   * so the phone is unchanged by construction.
   */
  fill?: boolean
  /**
   * The trailing-year high and low for this symbol, where the caller has
   * them. Only `scenario_range` draws them; every other archetype ignores it.
   */
  year?: YearRange | null
}

/**
 * One switch, so a new archetype is a new branch here and nothing else.
 *
 * `none` and `price_trend` both render whatever the caller injected: the first
 * gets nothing, and the second gets the existing sparkline rather than a second
 * implementation of one.
 */
export function ExploreVisualBlock({
  visual, sparkline, now, density = 'card', fill, year,
}: ExploreVisualProps) {
  const t = now ?? Date.now()
  const s = SCALE[density]
  /* A mouse, not a thumb. The phone card stays inert -- see the constraints
     at the top of this file -- so interactivity is `tile` density only, never
     the `fill` flag, which is about room rather than about input. */
  const grow = density === 'tile' && fill === true
  /* Interactivity ships WITH the instrument, not merely with the mouse. The
     marks are reachable because the grown axis draws full-height rules and
     a 20px column over each one; the bounded drawing has no such geometry,
     so a hit area there would be an invisible box over a 6px pill. */
  const interactive = grow

  const body = (() => {
    switch (visual.kind) {
      case 'scenario_range':
        return <ScenarioRange v={visual} s={s} grow={grow} interactive={interactive} year={year} />
      case 'target_compare': return <TargetCompare v={visual} s={s} grow={grow} />
      case 'timeline': return <Timeline v={visual} now={t} s={s} grow={grow} />
      case 'exposure': return <Exposure v={visual} s={s} grow={grow} />
      case 'comparison': return <Comparison v={visual} s={s} />
      case 'last_look': return <LastLook v={visual} s={s} grow={grow} />
      case 'workflow': return <Workflow v={visual} s={s} grow={grow} />
      case 'quote': return <QuoteVisual v={visual} s={s} grow={grow} />
      case 'question': return <QuestionVisual v={visual} s={s} grow={grow} />
      case 'price_trend': return sparkline ? <div data-explore-visual="price_trend">{sparkline}</div> : null
      // Typography carries it. Deliberately renders nothing rather than a box.
      case 'none': return null
    }
  })()

  /*
   * The measure, applied ONCE here rather than nine times below.
   *
   * Not on the phone: the cap is 520px and a phone cell is 178px, so a
   * wrapper there would be a div that does nothing, on sixty cards. And not
   * on the sparkline either — `price_trend` hands back whatever the caller
   * injected, and a plotted series is the one picture that genuinely reads
   * better the wider it gets. Bounding a chart would be the opposite of this
   * rule rather than an instance of it.
   */
  if (density === 'card' || body === null || visual.kind === 'price_trend') return body
  /* And not on a growing scenario axis, for the reason recorded on
     `ScenarioRange`: its labels moved onto their own marks, so it has no
     label pair left for the measure to protect, and the width it was being
     denied is what separates the cases. The wrapper also has to pass the
     height through, or a `flex-1` picture would be measured against a block
     that is only as tall as its content. */
  /*
   * Only the archetypes that can USE height get it.
   *
   * `flex-1` here overrides the box's own `justify-center`, which is what
   * centres a picture that cannot grow. So an archetype that would sit at
   * its minimum at the TOP of a tall box is worse off than one centred in
   * it, and the four that take the room say so by name.
   */
  if (grow && GROWS.has(visual.kind)) {
    return (
      <div
        className={clsx(
          'flex min-h-0 w-full flex-1 flex-col',
          visual.kind !== 'scenario_range' && MEASURE,
        )}
      >
        {body}
      </div>
    )
  }
  return <div className={MEASURE}>{body}</div>
}
