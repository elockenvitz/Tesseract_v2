import type { TradeQueueStatus } from '../../types/trading'

/**
 * What counts as an idea in the Ideas feed.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * It existed twice, differently, and the disagreement was visible on a phone.
 *
 * Single trade ideas were fetched with `status = 'idea'`. Pair trades were
 * fetched with no status filter at all — deliberately, to fix an earlier bug
 * where pairs never reached the feed, with the reasoning that an approved or
 * executed pair is still the team's position on a relationship between two
 * names. Each rule was defensible alone. Together they were not: in the
 * reporting org that is 4 single ideas against every pair ever created, so the
 * Ideas filter looked like a list of pair trades with a few ideas mixed in.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * An idea is a proposal that is still open — something a person could still
 * argue about, change, or decide. Once it has been executed, rejected,
 * cancelled or archived, the argument is over. It may still be worth seeing,
 * but as a decision or a piece of history, which the feed has other card kinds
 * for. Putting settled trades under "Ideas" makes the filter a list of
 * everything that ever happened.
 *
 * `working_on` and `modeling` are included: they are research states, and work
 * in progress is exactly what a colleague would want to weigh in on.
 */
export const OPEN_PROPOSAL_STATUSES: TradeQueueStatus[] = [
  'idea',
  'discussing',
  'simulating',
  'deciding',
  'working_on',
  'modeling',
  'approved',
]

/**
 * A pair is open when ANY leg is.
 *
 * Legs carry their own status and do not always move together — a pair whose
 * long leg is approved and short leg is still being modelled is very much a
 * live question. Requiring every leg to be open would hide it at exactly the
 * moment it most needs a second opinion.
 */
export function pairIsOpen(legStatuses: (string | null | undefined)[]): boolean {
  const open = new Set<string>(OPEN_PROPOSAL_STATUSES)
  return legStatuses.some(s => !!s && open.has(s))
}

/**
 * How many pair trades one feed page may contribute.
 *
 * Small on purpose. A pair is one card describing a relationship between two
 * names, and a page of fifteen that is mostly pairs reads as a feed about
 * pairs. Three leaves room for the rest of the page to be about everything
 * else, which is what a mixed feed is for.
 */
export const PAIRS_PER_PAGE = 3

/**
 * A generous upper bound on legs in one pair. The widest in production has
 * four; six leaves headroom without making the read unbounded.
 */
export const MAX_LEGS_PER_PAIR = 6

/** Which pairs, of those available, belong to the page starting at `offset`. */
export function pairPageSlice(offset: number, pageSize: number): [number, number] {
  const page = Math.max(0, Math.floor(offset / pageSize))
  return [page * PAIRS_PER_PAGE, (page + 1) * PAIRS_PER_PAGE]
}

/**
 * How many legs to read so that `pairPageSlice` can be satisfied at this depth.
 *
 * Pairs are grouped from legs, and a pair split across a read boundary would
 * render as two half-pairs — so the window has to cover every pair up to and
 * including this page's slice rather than sliding to it. It grows linearly with
 * scroll depth and stays bounded, in the same spirit as the feed's widening
 * time window.
 *
 * The invariant that matters, and that the tests assert: the window is always
 * large enough to contain the slice, for every page, even in the worst case
 * where every pair carries the maximum number of legs.
 */
export function pairLegWindow(offset: number, pageSize: number): number {
  const [, to] = pairPageSlice(offset, pageSize)
  return to * MAX_LEGS_PER_PAIR
}
