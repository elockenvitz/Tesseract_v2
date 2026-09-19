/**
 * How much a name matters to this desk, from every claim the book can make
 * about it rather than from its size alone.
 *
 * ── What "materiality" was, and why one number was not enough ─────────────
 *
 * `materialityBand` reads one input: the position's weight in its heaviest
 * book. That is a real measure and it is the wrong one on its own, because a
 * desk holds three different reasons for a name to matter and size is only the
 * first:
 *
 *   SIZE      ten percent of one book is ten percent of one book
 *   BREADTH   one percent held in eight books is the firm's view, not a PM's
 *   ACTIVE    two percent against a five percent index weight is a three point
 *             UNDERWEIGHT — a deliberate bet, and invisible to a size band
 *
 * The third is the sharpest. Weight against the benchmark is what a manager is
 * actually paid on, and `materialityBand` cannot see it at all: an index-weight
 * position and a large active bet of the same size score identically.
 *
 * ── Why the strongest claim wins rather than a weighted sum ───────────────
 *
 * A sum needs coefficients and the coefficients would be invented. There is no
 * defensible exchange rate between "a point of active weight" and "one more
 * book holding it" — the same argument `feed-compose` makes for comparing its
 * repetition costs lexicographically instead of blending them.
 *
 * Taking the maximum needs no exchange rate and states something a reader would
 * agree with out loud: a name is as material as its strongest claim to be. A
 * one percent position that eight books hold and that is a point and a half
 * away from the index is material, and a size band alone calls it noise.
 *
 * It can only ever raise materiality, never lower it, so a large position stays
 * material even where the benchmark file is missing and the breadth is one.
 *
 * ── Where the numbers come from ───────────────────────────────────────────
 *
 * Both new bands reuse thresholds the product already draws. Nothing here
 * invents a level.
 */

import { CRITICAL_ACTIVE_PCT, MIN_ACTIVE_PCT } from './builders/activeRisk'

/**
 * What the book says about one name, collapsed from its per-portfolio rows.
 *
 * Every field is nullable and null means "not known", never zero.
 * `benchmarkPct` in particular distinguishes a book with no benchmark file
 * (null) from a file that does not list the name (0), and the difference
 * decides whether an active weight can be computed at all.
 */
export interface DeskExposure {
  /** The weight in the heaviest book that holds it. */
  weightPct?: number | null
  /** That book's benchmark weight, where a file exists. */
  benchmarkPct?: number | null
  /** Weight less benchmark, where both are real. */
  activePct?: number | null
  /** How many books hold it at all. */
  bookCount?: number | null
}

/**
 * How much of the desk holds this name.
 *
 * Two is where the product already draws the line: `usePortfolioLenses` will
 * not call a name crowded below two books, on the reasoning that one book
 * holding something is a position and two books holding it is a house view.
 * So one book scores below the middle and two clears it.
 *
 * Five tops out because past that the count stops distinguishing anything —
 * a name in five books and a name in nine are both "everybody owns it", and a
 * bigger number does not change what the reader does about it. The same
 * saturation argument `researchBaseFor` makes for a price move.
 */
export function breadthBand(bookCount: number | null | undefined): number {
  if (bookCount == null || !Number.isFinite(bookCount) || bookCount <= 0) return 0
  if (bookCount === 1) return 0.3
  if (bookCount === 2) return 0.55
  if (bookCount === 3) return 0.75
  if (bookCount === 4) return 0.9
  return 1
}

/**
 * How big a bet this is against the index, in either direction.
 *
 * The bands and the thresholds are `deviationBand`'s, transposed: below the
 * level that makes a finding at all it is a rounding difference, above the
 * level the product calls critical it is the portfolio's identity. Both
 * numbers are `activeRisk`'s own and are imported rather than restated.
 *
 * Absolute, because an underweight is a decision. A desk that holds two percent
 * of a name the index holds at seven has said something as loudly as one
 * holding nine, and a signed band would score the first as nothing.
 */
export function activeBand(activePct: number | null | undefined): number {
  if (activePct == null || !Number.isFinite(activePct)) return 0
  const size = Math.abs(activePct)
  if (size >= CRITICAL_ACTIVE_PCT) return 1
  if (size >= MIN_ACTIVE_PCT) return 0.6
  if (size > 0) return 0.25
  return 0
}

/**
 * The materiality of a name, as the strongest claim the book makes for it.
 *
 * Returns `sizeBand` untouched when the desk knows nothing beyond the weight,
 * so a caller that supplies no exposure — and every existing caller supplies
 * none — gets a bit-for-bit unchanged score.
 *
 * The size band is passed IN rather than computed here, and deliberately.
 * `materialityBand` lives in `feed-priority` alongside the weights it answers
 * to, and importing it would make these two modules import each other. That
 * cycle happens to resolve today through function hoisting and would break the
 * first time either file grew a top-level constant that the other read.
 */
export function deskMateriality(
  sizeBand: number,
  exposure: DeskExposure | null | undefined,
): number {
  if (!exposure) return sizeBand
  return Math.max(sizeBand, breadthBand(exposure.bookCount), activeBand(exposure.activePct))
}
