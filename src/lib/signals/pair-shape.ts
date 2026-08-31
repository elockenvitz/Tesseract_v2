import { isTerminalIdea, type IdeaLifecycleRow } from '../trade-status-semantics'

/**
 * What a pair trade IS, derived from the rows the database actually holds.
 *
 * ── One object, not two ───────────────────────────────────────────────────
 *
 * A pair is a relative view: the claim is that one side does better than the
 * other, and neither half is the investment on its own. Everything here treats
 * the group as the unit — its liveness, its sides, its identity — because the
 * failure mode is rendering two miniature single-name cards glued together and
 * letting the reader infer a relationship that nothing on screen states.
 *
 * ── Audited against production before it was written ──────────────────────
 *
 * Five pair groups exist in total. Nothing here assumes a shape the data does
 * not have: `pair_leg_type` is NULL on every leg that reaches the feed, one
 * live group carries ten legs, and one carries two `buy` legs on the same
 * side. Each of those broke an assumption the obvious implementation makes.
 */

/** Long or short — or neither, when the action does not say. */
export type LegSide = 'long' | 'short' | 'unknown'

export interface PairLegRow extends IdeaLifecycleRow {
  id?: string
  action?: string | null
  /** Authoritative where present. NULL on every production leg audited. */
  pair_leg_type?: string | null
  symbol?: string | null
}

/**
 * Which side of the pair a leg sits on.
 *
 * ── Why `action` and not `pair_leg_type` ──────────────────────────────────
 *
 * Because the column is empty. `pair_leg_type` is the field designed for this
 * and it is NULL on every leg reaching the feed in production — it is only
 * written by `createPairTrade`, and no live pair went through that path. It is
 * still read FIRST, so the moment rows start carrying it the derivation gets
 * better without a code change; the action is the fallback, not the rule.
 *
 * ── Why `unknown` exists ──────────────────────────────────────────────────
 *
 * An action outside the four the enum defines cannot be placed, and guessing
 * would put a name under "Short" that nobody said to short. The card shows the
 * raw action instead, which is at least what the author wrote.
 */
export function legSide(leg: PairLegRow | null | undefined): LegSide {
  if (!leg) return 'unknown'
  const declared = String(leg.pair_leg_type ?? '').trim().toLowerCase()
  if (declared === 'long' || declared === 'short') return declared
  switch (String(leg.action ?? '').trim().toLowerCase()) {
    case 'buy':
    case 'add':
      return 'long'
    case 'sell':
    case 'trim':
      return 'short'
    default:
      return 'unknown'
  }
}

/**
 * A leg that was deleted is not part of the pair at all.
 *
 * ── The distinction this protects ─────────────────────────────────────────
 *
 * Deleted and terminal are different facts and collapsing them gets the pair's
 * liveness backwards. A deleted leg was removed from the structure — somebody
 * edited the pair — whereas a terminal leg is work that finished. Counting a
 * deletion as "finished" would make a pair whose only surviving legs are open
 * look settled, which is exactly the wrong answer.
 *
 * Production has one group of ten legs where six are deleted; treating those
 * six as executed would have made a live four-leg pair read as terminal.
 */
export function isDeletedLeg(leg: PairLegRow | null | undefined): boolean {
  return String(leg?.status ?? '').trim().toLowerCase() === 'deleted'
}

/** The legs that still constitute the pair. */
export function survivingLegs<T extends PairLegRow>(legs: readonly T[]): T[] {
  return legs.filter(l => !isDeletedLeg(l))
}

export interface PairParentRow {
  deleted_at?: string | null
  status?: string | null
}

/**
 * Is this pair still an open question?
 *
 * ── The rule, and why it is this rule ─────────────────────────────────────
 *
 * There is no pair-level outcome column, so liveness is a property of the
 * legs. In order:
 *
 *   1. A deleted parent, or a parent with a terminal status, closes the pair.
 *      Only one parent row exists in production and it belongs to a fully
 *      deleted group, so this is a coarse gate that rarely fires.
 *   2. Deleted legs are removed — they are not part of the structure.
 *   3. Of what survives, the pair is LIVE if ANY leg is live.
 *   4. A pair with no surviving legs is not a pair.
 *
 * Step 3 is `any`, not `all`, and that is the interesting choice. A pair whose
 * long side has been executed and whose short side is still being modelled is
 * very much a live question — arguably the most live thing in the feed, since
 * the desk is now half-on. Requiring every leg to be open would hide it at the
 * moment it most needs a second opinion.
 */
export function pairIsLive(
  legs: readonly PairLegRow[],
  parent?: PairParentRow | null,
): boolean {
  if (parent?.deleted_at) return false
  if (parent && isTerminalIdea({ status: parent.status, outcome: null })) return false
  const surviving = survivingLegs(legs)
  if (surviving.length === 0) return false
  return surviving.some(l => !isTerminalIdea(l))
}

export interface PairSides<T extends PairLegRow> {
  long: T[]
  short: T[]
  /** Legs whose action could not be placed. Shown as themselves. */
  unknown: T[]
  /** Deleted legs, kept out of every side but counted for the record. */
  deletedCount: number
}

/**
 * The pair's structure, from its surviving legs.
 *
 * Sides can be empty and that is a real state, not an error: production holds
 * a group whose surviving legs are two `buy`s and two `sell`s, and another
 * where the only cached side is the long. A one-sided pair is a half-built
 * pair, which is worth seeing.
 */
export function pairSides<T extends PairLegRow>(legs: readonly T[]): PairSides<T> {
  const surviving = survivingLegs(legs)
  return {
    long: surviving.filter(l => legSide(l) === 'long'),
    short: surviving.filter(l => legSide(l) === 'short'),
    unknown: surviving.filter(l => legSide(l) === 'unknown'),
    deletedCount: legs.length - surviving.length,
  }
}

/**
 * A compact side label: "LLY · PFE", or "LLY · PFE · +6" when it will not fit.
 *
 * Production's widest pair has ten legs, so a card that lists every symbol
 * would push everything else off screen. The full list belongs in the detail;
 * the card says what the side is and how much more there is.
 */
export function sideLabel(legs: readonly PairLegRow[], max = 2): string {
  const symbols = legs.map(l => (l.symbol ?? '').trim().toUpperCase()).filter(Boolean)
  if (symbols.length === 0) return ''
  const shown = symbols.slice(0, max)
  const rest = symbols.length - shown.length
  return rest > 0 ? `${shown.join(' · ')} · +${rest}` : shown.join(' · ')
}

/**
 * Would this pair qualify for a relative-performance chart?
 *
 * ── Why this exists with no UI behind it ──────────────────────────────────
 *
 * The spread visual is deferred because NO live pair in production can support
 * it: not one has cached price history on both sides. This encodes the rule
 * that decides, so when coverage arrives the chart slots in behind a predicate
 * that is already written and already tested, rather than behind a judgement
 * call made months later by whoever picks the work up.
 *
 * It is deliberately not rendered anywhere. A card that says "chart
 * unavailable" is a card advertising its own gap.
 *
 * The requirement is BOTH SIDES: a normalised comparison needs two series, and
 * one side's tape tells you nothing about a relative claim. `minPoints` mirrors
 * the chart's own floor — two points is the minimum that draws a line.
 */
export function hasDefensiblePairHistory(
  legs: readonly PairLegRow[],
  closesFor: (symbol: string) => number,
  minPoints = 2,
): boolean {
  const sides = pairSides(legs)
  const covered = (group: readonly PairLegRow[]) =>
    group.some(l => !!l.symbol && closesFor(l.symbol) >= minPoints)
  return covered(sides.long) && covered(sides.short)
}
