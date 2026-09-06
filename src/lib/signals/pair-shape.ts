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
  /**
   * The size the desk wrote down for this leg, if any.
   *
   * On the interface rather than cast in, because `pairWeightingIsDefined`
   * genuinely depends on them: a basket cannot be aggregated without a stored
   * allocation. Both are NULL on every pair leg in production.
   */
  proposed_weight?: number | null
  proposed_shares?: number | null
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
 * The legs that make up the expression as recorded.
 *
 * ── Deleted and terminal are not the same exclusion ───────────────────────
 *
 * A DELETED leg was removed from the structure — somebody edited the pair, and
 * it is not part of the trade any more. A TERMINAL leg is part of the recorded
 * pair whose work has finished: production's `2e22…` carries a CLOV leg with
 * `outcome = 'executed'` and `status = 'deciding'`, never deleted. Dropping it
 * because it executed would silently redefine the pair as the legs that happen
 * still to be open, and then chart something narrower than the trade while
 * calling it the trade.
 *
 * So inclusion excludes deletions only. Whether an included leg is finished is
 * a question about the pair's liveness, answered separately by `pairIsLive`.
 */
export function includedLegs<T extends PairLegRow>(legs: readonly T[]): T[] {
  return survivingLegs(legs)
}

/** A leg carries a durable size the desk actually wrote down. */
function legHasWeight(leg: PairLegRow): boolean {
  return leg.proposed_weight != null || leg.proposed_shares != null
}

/**
 * Is there price data for the WHOLE expression?
 *
 * Every included leg, on both sides. Not "some leg on each side" — that was
 * the bug this replaces. With LONG {LLY, PFE} and SHORT {GH, CLOV}, coverage
 * for LLY and GH alone lets you draw LLY against GH, which is a real chart of
 * a different, smaller trade. Presenting it as the pair's relative performance
 * would misattribute a two-name comparison to a four-name expression.
 *
 * Both sides must also be non-empty: a one-sided group has no relationship to
 * chart.
 */
export function hasPairPriceCoverage(
  legs: readonly PairLegRow[],
  closesFor: (symbol: string) => number,
  minPoints = 2,
): boolean {
  const sides = pairSides(legs)
  if (sides.long.length === 0 || sides.short.length === 0) return false
  const covered = (l: PairLegRow) => !!l.symbol && closesFor(l.symbol) >= minPoints
  return sides.long.every(covered) && sides.short.every(covered)
}

/**
 * Is the pair's shape one we can aggregate honestly?
 *
 * ── One-against-one needs no weights ──────────────────────────────────────
 *
 * A normalised comparison of a single long against a single short is fully
 * defined: index both to 100 at the window's start and the divergence IS the
 * relative return. There is no allocation question to answer, so nothing has
 * to be assumed.
 *
 * ── A basket does, and the data has none ──────────────────────────────────
 *
 * The moment a side holds two names, the pair's return depends on how they are
 * weighted, and every answer is a different trade. Audited read-only across
 * every pair leg in production: `proposed_weight`, `proposed_shares` and
 * `target_price` are NULL on all of them. So there is no stored allocation to
 * read, and the only way to draw a multi-leg pair today would be to assume
 * equal weighting — an invented number presented as the desk's position.
 *
 * This returns false for those, deliberately, and will start returning true on
 * its own if legs ever carry real sizes.
 */
export function pairWeightingIsDefined(legs: readonly PairLegRow[]): boolean {
  const sides = pairSides(legs)
  if (sides.long.length === 0 || sides.short.length === 0) return false
  // The 1x1 case: nothing to allocate, so nothing to assume.
  if (sides.long.length === 1 && sides.short.length === 1) return true
  // Any basket needs a real size on every leg it contains.
  return [...sides.long, ...sides.short].every(legHasWeight)
}

/**
 * Can the pair's relative performance be represented honestly?
 *
 * ── Why this is two questions and not one ─────────────────────────────────
 *
 * The predicate this replaces conflated them under the name "defensible
 * history", and the name is what made the error easy to miss: having data is
 * not the same as being able to represent the object. A four-leg pair with two
 * covered legs has data. What it does not have is a way to say what the PAIR
 * did.
 *
 * So coverage answers "does the data exist" and weighting answers "does the
 * structure permit an aggregation nobody invented". Both must hold.
 *
 * Rendered nowhere. There is no spread chart, no placeholder, and no
 * "unavailable" message — this exists so that when coverage arrives the chart
 * slots in behind a rule that was written and tested while the constraints
 * were fresh, rather than behind a judgement made later by whoever picks it up.
 */
export function canRepresentPairPerformance(
  legs: readonly PairLegRow[],
  closesFor: (symbol: string) => number,
  minPoints = 2,
): boolean {
  return hasPairPriceCoverage(legs, closesFor, minPoints)
    && pairWeightingIsDefined(legs)
}
