/**
 * What KIND of investment claim an idea is making, and how worked-through it is.
 *
 * ── Two axes, deliberately not one ────────────────────────────────────────
 *
 * The feed collapsed both into a single BUY/SELL badge, so a buy somebody
 * sketched this morning and a buy that has been through a full case ladder and
 * is sitting in front of a PM rendered identically. Those are not the same
 * object and a reader triaging a feed needs to tell them apart before reading a
 * word.
 *
 *   STANCE   — what the author currently believes they may want to do.
 *   MATURITY — how far the idea has been worked through.
 *
 * They are independent. `BUY · RESEARCHING` and `BUY · DECISION READY` are both
 * real and mean very different things, and neither is "a watch". There is no
 * WATCH stance in this product — `trade_queue_items.action` is
 * `buy | sell | add | trim` and every idea carries a direction. Rendering an
 * early-stage buy as "WATCH" would discard the direction its author actually
 * stated, which is the one thing they were most explicit about.
 *
 * ── Why ADD and TRIM are not folded into BUY and SELL ─────────────────────
 *
 * `hooks/ideas/types.ts` declared `TradeAction = 'buy' | 'sell'` while the
 * database enum has four values, so every `add` and every `trim` in the feed
 * was already being read through a type that said it could not exist. They are
 * different claims: buy and sell open and close a position, add and trim resize
 * one that is already on. A card that says BUY when the author said ADD is
 * describing a trade the desk is not being asked to do.
 *
 * ── Pure ──────────────────────────────────────────────────────────────────
 *
 * No hooks, no Supabase, no clock of its own beyond the `now` passed in. The
 * family a card resolves to is a property of its data, which means it is a
 * thing a test can assert rather than a thing you have to render to discover.
 */

/** The four real directions. Mirrors the `trade_queue_items.action` enum. */
export type IdeaStance = 'buy' | 'sell' | 'add' | 'trim'

/**
 * How the stance moves the book. Drives colour, never copy.
 *
 * `add` sits with `buy` and `trim` with `sell` for the accent, because the
 * direction of the money is the same. The LABEL never merges them — see the
 * header.
 */
export type StanceDirection = 'increase' | 'decrease'

/** Whether the stance opens/closes a position or resizes an existing one. */
export type StanceKind = 'entry' | 'adjust'

export interface StanceShape {
  stance: IdeaStance
  /** Uppercase, for the badge. The author's own verb. */
  label: string
  direction: StanceDirection
  kind: StanceKind
}

const STANCE: Record<IdeaStance, StanceShape> = {
  buy: { stance: 'buy', label: 'BUY', direction: 'increase', kind: 'entry' },
  sell: { stance: 'sell', label: 'SELL', direction: 'decrease', kind: 'entry' },
  add: { stance: 'add', label: 'ADD', direction: 'increase', kind: 'adjust' },
  trim: { stance: 'trim', label: 'TRIM', direction: 'decrease', kind: 'adjust' },
}

/**
 * The stance, or null when the row does not state one.
 *
 * Null rather than a default. A `buy` fallback would put a direction on a card
 * whose author never gave one, and the whole point of the badge is that it is
 * what they said.
 */
export function stanceOf(action: string | null | undefined): StanceShape | null {
  const a = String(action ?? '').trim().toLowerCase()
  return (STANCE as Record<string, StanceShape>)[a] ?? null
}

/**
 * How mature the idea is, normalised from the real `stage` column.
 *
 * ── Why the early stages collapse and the late ones do not ────────────────
 *
 * `aware`, `investigate` and `deep_research` are three words for "somebody is
 * still working on this", and the distinction between them is meaningful to the
 * analyst holding the work and noise to a colleague scanning a feed. They
 * normalise to one pill.
 *
 * `thesis_forming`, `ready_for_decision` and `deciding` each change what is
 * being asked of the reader — a view being written, a view waiting on a
 * decision, a decision in progress — so they keep their own labels.
 *
 * No new states are invented here. Every member maps from a stage the database
 * already stores.
 */
export type IdeaMaturity =
  | 'researching'
  | 'thesis_forming'
  | 'decision_ready'
  | 'deciding'
  /** The row carries no stage, or one this map has never been taught. */
  | 'unknown'

export interface MaturityShape {
  maturity: IdeaMaturity
  /** Uppercase, for the secondary pill. Null when there is nothing to claim. */
  label: string | null
  /**
   * Whether the idea is asking the desk for something yet.
   *
   * Research is work in progress; a decision-ready idea is a request. The feed
   * uses this to rank, and the card uses it to choose its question.
   */
  awaitingDesk: boolean
}

const MATURITY: Record<string, MaturityShape> = {
  // Research pipeline v2.
  aware: { maturity: 'researching', label: 'RESEARCHING', awaitingDesk: false },
  investigate: { maturity: 'researching', label: 'RESEARCHING', awaitingDesk: false },
  deep_research: { maturity: 'researching', label: 'RESEARCHING', awaitingDesk: false },
  thesis_forming: { maturity: 'thesis_forming', label: 'THESIS FORMING', awaitingDesk: false },
  ready_for_decision: { maturity: 'decision_ready', label: 'DECISION READY', awaitingDesk: true },
  // Legacy stages. Still present on older rows — see `TradeStage`, which is a
  // union of both vocabularies because the column was never migrated.
  idea: { maturity: 'researching', label: 'RESEARCHING', awaitingDesk: false },
  working_on: { maturity: 'researching', label: 'RESEARCHING', awaitingDesk: false },
  modeling: { maturity: 'thesis_forming', label: 'THESIS FORMING', awaitingDesk: false },
  deciding: { maturity: 'deciding', label: 'DECIDING', awaitingDesk: true },
}

const UNKNOWN_MATURITY: MaturityShape = {
  maturity: 'unknown',
  // No pill. An idea whose stage we cannot read says nothing about its
  // maturity rather than guessing at it — a wrong pill here is a claim about
  // somebody else's work.
  label: null,
  awaitingDesk: false,
}

export function maturityOf(stage: string | null | undefined): MaturityShape {
  const s = String(stage ?? '').trim().toLowerCase()
  return MATURITY[s] ?? UNKNOWN_MATURITY
}

/**
 * Which visual an idea earns.
 *
 * ── The archetype rule, borrowed from Explore ─────────────────────────────
 *
 * One picture per card, chosen by what the card is ABOUT. `explore-spark`
 * established this and the reasoning carries: a scenario band with a sparkline
 * under it is two charts competing inside 178 pixels, and the reader has to
 * work out which one carries the claim.
 *
 * Order matters and the first match wins:
 *
 *   scenario    — a framework exists, so the price against it IS the claim.
 *   target      — one number to compare the price to.
 *   performance — no framework and no number, but a real path since the idea
 *                 was put up. "Has the market moved, or has our view changed?"
 *   narrative   — the argument is the content. Typography, and no chart.
 *
 * `narrative` is a real answer, not a fallback for failure. A thesis-led idea
 * with no target is a legitimate and common thing to write, and giving it a
 * decorative sparkline because there was space is exactly what the Explore pass
 * removed.
 */
export type IdeaFamily = 'scenario' | 'target' | 'performance' | 'narrative'

export interface IdeaShapeInput {
  action?: string | null
  stage?: string | null
  createdAt?: string | null
  targetPrice?: number | null
  /** A live/last-close price to compare a target against. */
  referencePrice?: number | null
  /** Distinct rungs on the asset's current case ladder. */
  ladderCaseCount?: number
  /** Whether a cached close series long enough to draw actually exists. */
  hasPriceHistory?: boolean
}

export interface IdeaShape {
  stance: StanceShape | null
  maturity: MaturityShape
  family: IdeaFamily
  /** Why this family. Rendered nowhere; asserted in tests, read in review. */
  reason: string
}

/**
 * An idea has to be old enough for "since" to mean anything.
 *
 * The same five days `explore-spark` uses, and for the same reason it gives:
 * a proposal posted this morning has no path worth drawing, and a two-point
 * line implying a trend from six hours of trading is a stronger claim than the
 * data supports. Kept as its own constant rather than imported because
 * `explore-spark` is Explore-owned and this module must not make its threshold
 * load-bearing for a second surface — if either moves, that is a decision, not
 * a side effect.
 */
export const IDEA_MIN_AGE_DAYS = 5

const DAY = 86_400_000

export function ideaAgeDays(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return (now - t) / DAY
}

export function ideaShapeFor(i: IdeaShapeInput, now: number = Date.now()): IdeaShape {
  const stance = stanceOf(i.action)
  const maturity = maturityOf(i.stage)
  const age = ideaAgeDays(i.createdAt, now)

  const shape = (family: IdeaFamily, reason: string): IdeaShape =>
    ({ stance, maturity, family, reason })

  // A ladder needs two distinct rungs to describe a range — the same bar
  // `selectCurrentLadders` applies. One case is a target wearing a scenario's
  // name, and it belongs to the target family where it can be compared.
  if ((i.ladderCaseCount ?? 0) >= 2) {
    return shape('scenario', `ladder has ${i.ladderCaseCount} cases`)
  }

  /**
   * A target is enough to BE a target idea. Pricing it is the pane's problem.
   *
   * This once required a reference price too, on the reasoning that the visual
   * is a gap between two numbers. That conflated what the card is ABOUT with
   * what can be drawn today: an idea whose author committed to $310 is a
   * target idea whether or not this name has a cached close, and demoting it to
   * `narrative` would hide the one number they were most explicit about.
   *
   * The reference price is not available honestly at build time in any case.
   * `assets.current_price` carries no timestamp, and `price-snapshot` is
   * explicit that a number whose vintage is hidden by its label is the defect,
   * not a shortcut. So the pane fetches the dated close itself and degrades to
   * "target, no gap" when there is none — see `IdeaTargetBar`.
   */
  if (i.targetPrice != null && i.targetPrice > 0) {
    return shape('target', 'author committed to a target')
  }

  if (i.hasPriceHistory && age != null && age >= IDEA_MIN_AGE_DAYS) {
    return shape('performance', `no framework; ${Math.round(age)}d of path since the idea`)
  }

  return shape(
    'narrative',
    age != null && age < IDEA_MIN_AGE_DAYS
      ? `too new to chart (${Math.round(age)}d)`
      : 'no framework, no target, no drawable path',
  )
}

/**
 * Whether two pieces of an idea are making the SAME claim.
 *
 * ── Why this is not `a === b` ─────────────────────────────────────────────
 *
 * `thesis_text` and `rationale` are separate columns and are routinely filled
 * with the same sentence — the quick-capture path writes one field, the full
 * builder writes the other, and an author who edits in both leaves two copies
 * that differ only by a trailing space, a smart quote, or a wrapping `<p>` from
 * the rich-text editor. Exact comparison declares those different and the
 * detail view prints the same paragraph twice, which is what was reported.
 *
 * So the comparison is on the CLAIM, not the bytes: markup stripped, entities
 * and whitespace collapsed, case and terminal punctuation ignored. Deliberately
 * not fuzzy beyond that — two genuinely different sentences that happen to
 * share an opening clause are different claims and both deserve to be shown.
 */
export function sameClaim(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) =>
    String(v ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/[‘’“”]/g, "'")
      .replace(/\s+/g, ' ')
      .replace(/[.!?;:,\s]+$/, '')
      .trim()
      .toLowerCase()
  const x = norm(a)
  const y = norm(b)
  // Two empties are not "the same claim" — they are two absences, and the
  // caller renders neither.
  return x.length > 0 && x === y
}
