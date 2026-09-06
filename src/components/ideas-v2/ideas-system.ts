/**
 * The Ideas visual system.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * Every pass before this one improved the cards by REMOVING something that
 * looked cheap: pills, nested boxes, pastel fills, a chip, oversized numbers.
 * That was necessary and it is largely finished. What did not exist was a
 * positive system — every size, weight, colour and gap was a local judgement
 * made at the call site, which is why the surface improved in patches instead
 * of snapping into coherence, and why seven label sites had quietly drifted
 * into four different treatments.
 *
 * This is that system, in one place, so a value can be argued about once.
 *
 * ── What it is imitating, and what it is not ─────────────────────────────
 *
 * The reference is the professional terminal: information density, numbers set
 * as numbers, colour spent only where it means something, and alignment strict
 * enough that the eye can move down a column without re-finding it. What it is
 * NOT imitating is the decoration those tools are often remembered for — no
 * neon, no glow, no gradient, no chrome for its own sake. Precision is the
 * thing that reads as expensive.
 *
 * ── The rules ────────────────────────────────────────────────────────────
 *
 *   1. Four sizes of type on a card, and no more.
 *   2. Every number is tabular and monospaced. A column of figures must align
 *      on the decimal whether it is 7.4 or 932.40.
 *   3. Labels are quiet. They name a number; they never compete with it.
 *   4. Colour has three jobs (below) and no fourth. Everything else is ink,
 *      a grey, or a hairline.
 *   5. Space is a 4px rhythm. No half-steps.
 *   6. Nothing is enclosed that a rule can separate.
 */

/* -------------------------------------------------------------------- type */

/**
 * The identity of the object. The largest thing on the card, always — a card
 * that leads with a percentage instead of a name is a statistic, not an
 * investment object.
 */
export const TICKER = {
  featured: 'text-[26px] font-black leading-none tracking-[-0.03em]',
  standard: 'text-[18px] font-black leading-none tracking-[-0.025em]',
  compact: 'text-[15px] font-black leading-none tracking-[-0.02em]',
} as const

/** The company behind the ticker. Present, subordinate, never bold. */
export const COMPANY = 'text-[11px] font-normal text-gray-500 dark:text-gray-400'

/**
 * The written claim. The one piece of prose on the card, so it gets a reading
 * measure and normal weight — a bolded sentence is a headline, and this is an
 * argument.
 */
export const CLAIM = {
  featured: 'text-[13.5px] font-normal leading-[1.5] text-gray-800 dark:text-gray-200',
  standard: 'text-[12.5px] font-normal leading-[1.5] text-gray-800 dark:text-gray-200',
  compact: 'text-[12px] font-normal leading-[1.45] text-gray-800 dark:text-gray-200',
} as const

/**
 * A measured figure. Monospaced and tabular without exception.
 *
 * Subordinate to the ticker at every density. These were once larger than the
 * object they described, which is the single clearest tell of a consumer app
 * dressed as an analytical one.
 */
export const FIGURE = {
  featured: 'font-mono text-[19px] font-semibold tabular-nums leading-none tracking-[-0.01em]',
  standard: 'font-mono text-[17px] font-semibold tabular-nums leading-none tracking-[-0.01em]',
  compact: 'font-mono text-[14px] font-semibold tabular-nums leading-none tracking-[-0.01em]',
} as const

/**
 * The rubric under or beside a figure.
 *
 * One treatment, everywhere. It was 10px bold with wide tracking, borrowed
 * from the phone where a label sits alone on a large tile; ten of those on one
 * desktop field reads as shouting.
 */
export const LABEL = 'text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400'

/** Standing context: the book, the age, the conviction. A quiet line. */
export const META = 'text-[11px] font-normal text-gray-500 dark:text-gray-400'

/* ------------------------------------------------------------------- ink */

/**
 * Colour has four jobs.
 *
 *   accent   the reader's own state — what is selected, focused, interactive
 *   breach   spot outside the range the desk itself wrote
 *   pending  a decision nobody has taken
 *   move     which way a price went, and nothing else
 *
 * ── The fourth job was refused once, and that was wrong ──────────────────
 *
 * This file used to read: "Direction gets none of it. A sell is a stance, not
 * a warning… There is no green anywhere: a price that rose is not a grade."
 *
 * The first half of that is right and still holds. A STANCE takes no colour:
 * a sell is not painted red, a conviction is not graded, a maturity is not a
 * traffic light, and a fall since an idea was written is a reason to look
 * again rather than proof the thesis was wrong.
 *
 * The second half confused a judgement with a fact. Which way a price moved
 * is not a verdict on anybody's idea; it is the most-read number on the card,
 * and every instrument a professional actually uses encodes it exactly this
 * way. Refusing it did not make the surface more rigorous, it made it grey —
 * the single biggest reason the field kept reading as rudimentary.
 *
 * So `move` is spent on the price series, its fill, its end marker and the
 * return measured from the idea's own opening mark. Nowhere else. If a value
 * is an opinion rather than an observation, it does not get this colour.
 */
export const INK = {
  primary: 'text-gray-900 dark:text-gray-100',
  secondary: 'text-gray-500 dark:text-gray-400',
  accent: 'text-blue-600 dark:text-blue-400',
  breach: 'text-rose-700 dark:text-rose-400',
  pending: 'text-amber-700 dark:text-amber-400',
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-rose-600 dark:text-rose-500',
} as const

/** The only two lines on the surface: a separator, and a stronger separator. */
export const RULE = 'border-gray-200/80 dark:border-white/[0.08]'
export const RULE_STRONG = 'border-gray-300 dark:border-white/[0.16]'

/**
 * The card itself.
 *
 * No shadow. A drop shadow under every tile is what makes a field read as a
 * stack of floating panels rather than as one instrument, and it is the last
 * thing separating this from a generic SaaS dashboard. A single hairline and
 * the page's own ground do the work.
 *
 * Radius is small and constant. A large radius reads friendly; this surface is
 * meant to read precise.
 */
export const CARD =
  'rounded-[3px] border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-[#141a25]'

/** Hover and keyboard focus, stated once. Restrained on purpose. */
export const CARD_INTERACTIVE =
  'transition-colors duration-100 hover:border-gray-400 focus-within:border-gray-400 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-blue-600 dark:hover:border-white/25 dark:focus-within:border-white/25'

/* ----------------------------------------------------------------- space */

/**
 * A 4px rhythm, named.
 *
 * The card was carrying mt-1.5, mt-2, mt-2.5, mt-3, pt-1.5, pt-2 and pt-3 in
 * one component. Half-steps are what stop a column of cards from lining up
 * with each other, and nothing in this layout needed 6px.
 */
export const PAD = { featured: 'p-4', standard: 'p-3', compact: 'p-3' } as const
export const GAP = { tight: 'mt-2', normal: 'mt-3', loose: 'mt-4' } as const
