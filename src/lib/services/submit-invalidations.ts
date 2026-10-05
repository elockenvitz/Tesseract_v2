/**
 * What has to be re-read after a recommendation is submitted.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * Submitting a recommendation left the originating Ideas tile showing the
 * pre-submit state. Measured against the code, not guessed: the submit
 * mutation invalidated five keys, and **two of them matched no query that
 * exists** — `trade-ideas` and `trade-queue`. They read as though the Ideas
 * surfaces were covered. They were not.
 *
 * The key that actually feeds the pipeline board is `trade-queue-items`,
 * and nothing invalidated it. It also sets no `staleTime` of its own, so it
 * inherits the 5-minute global default, and `refetchOnWindowFocus` is
 * globally `false` — so the tile could sit stale for five minutes with no
 * escape hatch short of a remount.
 *
 * This is the same drift `execute-invalidations.ts` was written to stop,
 * reproduced in the adjacent workflow: several submit call sites, each with
 * its own hand-written list, none agreeing. One of them — the pair-trade
 * submit on the kanban — omits `decision-requests` entirely, so a pair
 * recommendation never refreshed the Decision Inbox at all.
 *
 * ── What this does NOT fix ───────────────────────────────────────────────
 *
 * Most of the delay the PM sees is not cache staleness. `submitRecommendation`
 * makes ELEVEN strictly sequential awaited round trips before `onSuccess`
 * fires, several of them independent of one another, and the modal does not
 * even close until the last one lands. That is a latency question, not an
 * invalidation one, and it is documented rather than changed here.
 *
 * Each key is listed because submitting actually writes the table behind it:
 *
 *   trade-queue-items     the Ideas tile; reads the embedded decision_requests
 *   trade-queue-ideas     the same rows, as the Simulation list reads them
 *   decision-requests     the request itself — the Decision Inbox
 *   trade-lab-proposals   `trade_proposals` inserted or updated
 *   trade-proposals       the detail modal's own read of the same rows
 *   deciding-proposals    the kanban's read of the same rows
 *   proposals-for-idea    the review pane's read of the same rows
 *   proposal              the editor's own single-proposal read
 */

export const SUBMIT_INVALIDATION_KEYS = [
  'trade-queue-items',
  'trade-queue-ideas',
  'decision-requests',
  'trade-lab-proposals',
  'trade-proposals',
  'deciding-proposals',
  'proposals-for-idea',
  'proposal',
] as const

/**
 * Minimal shape of what we need from a QueryClient, so this is testable
 * without standing one up. Mirrors `execute-invalidations.ts`.
 */
interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown
}

/**
 * Re-read everything a submission changed.
 *
 * Prefix keys only — React Query matches non-exactly by default, so
 * `['decision-requests']` covers `['decision-requests','all',…]` without
 * needing to know the variants each surface composes.
 */
export function invalidateAfterSubmit(client: Invalidator): void {
  for (const key of SUBMIT_INVALIDATION_KEYS) {
    client.invalidateQueries({ queryKey: [key] })
  }
}
