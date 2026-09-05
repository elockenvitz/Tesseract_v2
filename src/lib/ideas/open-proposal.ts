import type { TradeQueueStatus } from '../../types/trading'
import { isTerminalIdea, type IdeaLifecycleRow } from '../trade-status-semantics'

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
  'approved',
]

/**
 * Whether a row is a proposal somebody could still argue about.
 *
 * ── The bug this closes ───────────────────────────────────────────────────
 *
 * `OPEN_PROPOSAL_STATUSES` was the whole test, and it is a STATUS list — so
 * finished work qualified as open. Measured read-only against production:
 * 125 rows matched the list, 12 of them were terminal by outcome, and all 11
 * rows with `status = 'approved'` carried `outcome = 'executed'`. Executed
 * trades were being served to the mobile feed as live proposals, ranked
 * against real ones, and offered a response control asking whether the desk
 * should put them on.
 *
 * ── Why 'approved' is still in the list above ─────────────────────────────
 *
 * Because removing it would fix today's data and not the bug. The list is a
 * coarse, indexable, server-side filter; it cannot see `outcome`, and a status
 * list can only ever be right for as long as status and outcome agree. They
 * are written by different paths and nothing reconciles them, so the fix has
 * to be an explicit liveness check rather than a shorter list.
 *
 * The two therefore do different jobs: the list narrows the query, and this
 * decides. An `approved` row with no outcome — which is what the legacy
 * approval path writes — is still caught, because `approved` is a terminal
 * status in its own right.
 */
export function isOpenProposal(row: IdeaLifecycleRow | null | undefined): boolean {
  if (!row) return false
  if (isTerminalIdea(row)) return false
  const status = String(row.status ?? '').trim().toLowerCase()
  return (OPEN_PROPOSAL_STATUSES as string[]).includes(status)
}

/**
 * ── Why `working_on` and `modeling` are absent ────────────────────────────
 *
 * They are members of the `TradeQueueStatus` TypeScript union and they do not
 * exist in the database. `trade_queue_status` has exactly ten labels: idea,
 * discussing, approved, rejected, executed, cancelled, deleted, deciding,
 * simulating, archived.
 *
 * That mismatch was invisible to the compiler — the union is hand-written and
 * nothing checks it against the enum — and catastrophic at runtime. PostgREST
 * rejects an entire `in.(...)` list when one member is not a valid enum label,
 * so the query did not return fewer rows: it returned an ERROR. The caller
 * destructures `const { data } = await q` and never touches `error`, so a
 * failed request became `data: null`, then `if (!data) return []`, and every
 * single-name trade idea vanished with nothing logged anywhere.
 *
 * This is the sixth cause behind "I see no trade ideas", and the only one that
 * was never a ranking or filtering decision — the rows were never fetched at
 * all. Every earlier fix was real, and every one of them was downstream of a
 * query that had already failed.
 *
 * If a status is added to the product, it goes in the enum first.
 */

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
 * A pair is open when ANY leg is open — now judged on liveness, not status.
 *
 * The status-only version above is kept for callers that genuinely have
 * nothing but statuses. This is the one a caller with rows should use: a pair
 * whose every leg has been executed is not a live question, and under the old
 * test it was, because `approved` and `executed` legs matched the list.
 */
export function pairIsOpenFromRows(legs: (IdeaLifecycleRow | null | undefined)[]): boolean {
  return legs.some(isOpenProposal)
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
 * An upper bound on legs in one pair, for sizing the READ WINDOW only.
 *
 * ── What this does and does not govern ────────────────────────────────────
 *
 * Only `pairLegWindow`, which decides how many leg rows to fetch so that a
 * page's worth of pairs can be grouped without one being split across the read
 * boundary. It is not a creation limit, not validation, and it must never
 * truncate a pair that exists — a half-rendered pair is worse than a slower
 * query.
 *
 * Raised from six because the comment above it was measured wrong: it said
 * "the widest in production has four", and production holds a group of TEN.
 * Six was never exceeded in practice only because the other filters cut that
 * group to four legs before grouping — an accident, not a margin. Twelve
 * covers the real widest with headroom, and the window stays bounded.
 *
 * Creation policy is untouched; this is the display path.
 */
export const MAX_LEGS_PER_PAIR = 12

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

/**
 * How far back an open proposal stays visible, in days.
 *
 * ── Why proposals ignore the feed's rolling window ────────────────────────
 *
 * The feed widens a time window as the reader scrolls — 90 days, then 30 more
 * per page — which is right for sources that arrive constantly. Trade ideas do
 * not: measured against production on 2026-08-21, the reporting org had 23
 * open single proposals and exactly ONE created in the last 90 days. The rest
 * ran from February to July. So the Ideas filter showed one idea, and reaching
 * the others meant scrolling about ten pages to let the window creep out.
 *
 * That is the wrong constraint twice over. A proposal is in the feed because it
 * is still open to argument, and being open has nothing to do with when it was
 * written — a February idea nobody has executed, rejected or cancelled is
 * arguably MORE worth surfacing than one raised last week, not less. Status
 * already bounds this source; age should not bound it again.
 *
 * Still bounded, because an unbounded feed query is a table scan waiting to
 * happen — just bounded by something unrelated to scroll depth.
 */
export const PROPOSAL_DAYS_BACK = 365

/**
 * Which lower bound a proposal query should use.
 *
 * An explicit `timeRange` from the reader always wins: somebody who asks for
 * the last week means it, and quietly serving them a year would be the same
 * class of mistake in the other direction.
 */
export function proposalWindowDays(
  timeRange: 'day' | 'week' | 'month' | 'all' | undefined,
  scrolledWindowDays: number,
): number {
  if (timeRange && timeRange !== 'all') return scrolledWindowDays
  return PROPOSAL_DAYS_BACK
}
