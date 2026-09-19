/**
 * What has to be re-read after a trade is executed.
 *
 * Single-execute and bulk-execute run the SAME pipeline — `executeSimVariants`
 * — so they change the same rows. They did not invalidate the same things:
 * each kept its own hand-written list, and the single-trade one had drifted
 * five keys behind. A pilot executing one trade (which is what the mission asks
 * them to do) then opened Outcomes and saw pre-commit state, because
 * `decision-accountability` was only in the other list.
 *
 * Two lists that must agree is the defect. There is one now, and both call
 * sites use it.
 *
 * Each key below is here because `executeSimVariants` (or the
 * `createAcceptedTrade` it delegates to) actually writes the table behind it —
 * not because the other list happened to have it:
 *
 *   simulation            `simulations` — baseline re-fold      (:471)
 *   intent-variants       `simulation_trades` — hard-deleted    (:332)
 *   accepted-trades       the commit itself
 *   trade-batches         `trade_batches` — inserted            (:736)
 *   trade-lab-proposals   `trade_proposals` — orphans deactivated (:602)
 *   trade-queue-items     `trade_queue_items` — outcome advanced  (:550)
 *   trade-queue-ideas     the same rows, read by the Ideas surfaces
 *   decision-requests     `decision_requests` — siblings resolved (:633)
 *   decision-accountability  Outcomes' own key over accepted_trades
 *   portfolio-holdings    paper / manual_eod apply the trade to holdings
 *   desktop-portfolio     the Dashboard's own read of those holdings
 *   pilot-mission         an accepted_trade is what stage 3 is derived from
 *
 * The two holdings keys are new to both paths. A paper portfolio has its
 * holdings changed by the commit and nothing was asking for them again; a
 * live_feed portfolio leaves them pending, where the refetch is a no-op. Both
 * are correct, so neither needs a condition.
 */
import { pilotCommittedTradeKey } from '../pilot/pilot-unlocks'

export const EXECUTE_INVALIDATION_KEYS = [
  'simulation',
  'intent-variants',
  'accepted-trades',
  'trade-batches',
  'trade-lab-proposals',
  'trade-queue-items',
  'trade-queue-ideas',
  'decision-requests',
  'decision-accountability',
  'portfolio-holdings',
  'desktop-portfolio',
  'pilot-mission',
] as const

/** Minimal shape of what we need from a QueryClient, so this is testable
 *  without standing one up. */
interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown
  setQueryData: (key: readonly unknown[], data: unknown) => unknown
}

/**
 * Re-read everything a commit changed, and tell the pilot gate what we now
 * know for certain.
 *
 * The gate that opens Trade Book asks a query whether this pilot has any
 * committed trade in this org. Before the execute the honest answer was `false`
 * and it is cached as such; invalidating starts a refetch but leaves the old
 * `false` in place while it runs. So the reader pressed Execute, got the
 * Decision Recorded modal, clicked through to Trade Book, and was told it
 * "opens once you execute a trade".
 *
 * Nothing about that was unknown — the commit had just succeeded in this very
 * callback. Seeding the answer we already have is not a new source of truth
 * and not a delay; it is the existing cache being told the thing it is about
 * to go and discover. The refetch below still lands and overwrites it with the
 * server's own answer, and `usePilotMode` persists that to its localStorage
 * hint as usual, so a hard refresh reconstructs the same state.
 *
 * Skipped when we have no pilot identity — a non-pilot has no such gate.
 */
export function invalidateAfterExecute(
  client: Invalidator,
  pilot?: { orgId: string | null; userId: string | null | undefined },
): void {
  if (pilot?.orgId && pilot?.userId) {
    client.setQueryData(pilotCommittedTradeKey(pilot.orgId, pilot.userId), true)
  }
  for (const key of EXECUTE_INVALIDATION_KEYS) {
    client.invalidateQueries({ queryKey: [key] })
  }
}
