/**
 * Trade Book — lifecycle phase model.
 *
 * Every accepted_trade is in exactly ONE lifecycle phase, derived
 * deterministically from (execution_status, reconciliation_status,
 * staleness_flagged_at, holdings_source). This is the single source of
 * truth the entire Trade Book UI reads — the State pill, the Next
 * action column, the pipeline strip, the section headers, and the
 * batch-card rollups all compute off this function.
 *
 * Mental model for PM / Analyst / Trader alignment:
 *
 *   Active phases (needs attention from SOMEONE):
 *     - queued              → trader hasn't started
 *     - working             → trader is executing
 *     - awaiting_recon      → trader reported done, fills not confirmed
 *     - needs_review        → discrepancy or stale; PM must look
 *
 *   Terminal phases (no action needed):
 *     - settled             → fills confirmed, nothing to do
 *     - cancelled           → intentionally dropped
 *
 * For PAPER portfolios the flow collapses: every accepted trade jumps
 * straight to `settled` on commit (createAcceptedTrade finalizes
 * execution_status='complete' + reconciliation_status='matched'). The
 * six phases still exist for paper — they just only produce `settled`
 * and `cancelled` in practice.
 *
 * Do NOT surface `execution_status` or `reconciliation_status` directly
 * in the UI. Those are internal plumbing. Surface `LifecyclePhase`.
 */

import type {
  AcceptedTradeWithJoins,
  ExecutionStatus,
  ReconciliationStatus,
} from '../../types/trading'
import type { HoldingsSource } from '../../types/organization'

// ---------------------------------------------------------------------------
// Phase enum + sub-severity
// ---------------------------------------------------------------------------

export type LifecyclePhase =
  | 'queued'
  | 'working'
  | 'awaiting_recon'
  | 'needs_review'
  | 'settled'
  | 'cancelled'

/**
 * Sub-severity inside `needs_review`. `mismatch` means fills landed but
 * don't match the intended sizing (partial/deviated reconciliation).
 * `unmatched` means fills never landed at all OR the trade's been sitting
 * long enough that the sweeper flagged it.
 */
export type NeedsReviewSeverity = 'mismatch' | 'unmatched'

export interface LifecycleResult {
  phase: LifecyclePhase
  /** Only set when phase === 'needs_review'. */
  severity?: NeedsReviewSeverity
}

// ---------------------------------------------------------------------------
// Phase derivation
// ---------------------------------------------------------------------------

/**
 * Derive the lifecycle phase for a trade.
 *
 * Precedence:
 *   1. `cancelled` wins over everything (it's terminal intent)
 *   2. `needs_review` wins over active phases (a deviated/unmatched/stale
 *       row demands PM attention before the trader workflow matters)
 *   3. `awaiting_recon` vs `working` vs `queued` vs `settled` is then
 *       decided by (execution_status, reconciliation_status)
 *
 * holdings_source is accepted for future branching but is NOT currently
 * used — the derivation is portfolio-agnostic because paper portfolios
 * simply never produce anything other than `settled`/`cancelled`.
 */
export function tradeLifecyclePhase(
  trade: Pick<
    AcceptedTradeWithJoins,
    'execution_status' | 'reconciliation_status'
  > & {
    staleness_flagged_at?: string | null
  },
  _holdingsSource?: HoldingsSource,
): LifecycleResult {
  const exec = trade.execution_status as ExecutionStatus
  const recon = trade.reconciliation_status as ReconciliationStatus
  const isStale = !!trade.staleness_flagged_at

  // 1. Terminal: cancelled
  if (exec === 'cancelled') {
    return { phase: 'cancelled' }
  }

  // 2. Needs review — discrepancies and stale flags take priority over
  //    workflow state because a deviation means the reported outcome
  //    doesn't match reality and a human has to reconcile it.
  if (recon === 'partial' || recon === 'deviated') {
    return { phase: 'needs_review', severity: 'mismatch' }
  }
  if (recon === 'unmatched') {
    return { phase: 'needs_review', severity: 'unmatched' }
  }
  if (isStale) {
    // Stale sweeper flag while still pending reconciliation: the trade
    // has been sitting without a fill long enough to warrant review.
    return { phase: 'needs_review', severity: 'unmatched' }
  }

  // 3. Settled — fully done and reconciled.
  if (exec === 'complete' && recon === 'matched') {
    return { phase: 'settled' }
  }

  // 4. Awaiting reconciliation — trader reported done, fills not yet
  //    confirmed against holdings.
  if (exec === 'complete' && recon === 'pending') {
    return { phase: 'awaiting_recon' }
  }

  // 5. Working — trader actively executing.
  if (exec === 'in_progress') {
    return { phase: 'working' }
  }

  // 6. Queued — default for a committed trade that hasn't been touched.
  return { phase: 'queued' }
}

// ---------------------------------------------------------------------------
// Phase presentation metadata
// ---------------------------------------------------------------------------

export interface PhaseMeta {
  /** Short label shown on pills/strips. */
  label: string
  /** Tailwind classes for the pill background + text. */
  pillClass: string
  /** Tailwind classes for a colored dot marker. */
  dotClass: string
  /**
   * Whether this phase still needs attention from someone. Active phases
   * are always visible in the default view; terminal phases roll up.
   */
  isActive: boolean
  /** Display order in the pipeline strip (left → right). */
  order: number
}

export const PHASE_META: Record<LifecyclePhase, PhaseMeta> = {
  queued: {
    label: 'Queued',
    pillClass:
      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dotClass: 'bg-gray-400 dark:bg-gray-500',
    isActive: true,
    order: 1,
  },
  working: {
    label: 'Working',
    pillClass:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    dotClass: 'bg-blue-500 dark:bg-blue-400',
    isActive: true,
    order: 2,
  },
  awaiting_recon: {
    label: 'Awaiting recon',
    pillClass:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    isActive: true,
    order: 3,
  },
  needs_review: {
    label: 'Needs review',
    pillClass:
      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    dotClass: 'bg-red-500 dark:bg-red-400',
    isActive: true,
    order: 4,
  },
  settled: {
    label: 'Settled',
    pillClass:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
    isActive: false,
    order: 5,
  },
  cancelled: {
    label: 'Cancelled',
    pillClass:
      'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 line-through',
    dotClass: 'bg-gray-300 dark:bg-gray-600',
    isActive: false,
    order: 6,
  },
}

/**
 * Human copy for the `needs_review` sub-severity. Used to stamp a small
 * secondary badge next to the State pill so PMs can tell at a glance
 * whether the issue is "fills landed but don't match" vs "no fills at all."
 */
export const SEVERITY_META: Record<
  NeedsReviewSeverity,
  { label: string; pillClass: string }
> = {
  mismatch: {
    label: 'Mismatch',
    pillClass:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  unmatched: {
    label: 'Unmatched',
    pillClass:
      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
}

// ---------------------------------------------------------------------------
// Next-action copy
// ---------------------------------------------------------------------------

/**
 * One-line description of who owns the next step for this trade. Drives
 * the "Next action" column in the table so every role can answer
 * "what's on my plate?" at a glance without cross-referencing two
 * status fields.
 *
 * Keep this purely informational — no imperative ("Click here to...")
 * copy, no role-specific phrasing beyond who's responsible.
 */
export function nextActionCopy(result: LifecycleResult): string {
  switch (result.phase) {
    case 'queued':
      return 'Waiting on trader'
    case 'working':
      return 'Trader executing'
    case 'awaiting_recon':
      return 'Reconciling against holdings'
    case 'needs_review':
      return result.severity === 'mismatch'
        ? 'PM: review fill vs intent'
        : 'PM: fills missing'
    case 'settled':
      return '—'
    case 'cancelled':
      return '—'
  }
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

export type TradeWithPhase<T> = T & { __phase: LifecycleResult }

/**
 * Tag every trade with its phase in a single pass so downstream
 * grouping/counting code doesn't re-derive it per-read.
 */
export function tagTradesWithPhase<
  T extends Pick<
    AcceptedTradeWithJoins,
    'execution_status' | 'reconciliation_status'
  > & { staleness_flagged_at?: string | null },
>(trades: T[], holdingsSource?: HoldingsSource): TradeWithPhase<T>[] {
  return trades.map((t) => ({
    ...t,
    __phase: tradeLifecyclePhase(t, holdingsSource),
  }))
}

/**
 * Count trades by phase. Zero-fills every phase so UI strips can render
 * all six buckets even when some are empty (empty state matters for the
 * pipeline strip — "Queued 0" tells you nothing is waiting, which is
 * information).
 */
export function countByPhase<T>(
  taggedTrades: TradeWithPhase<T>[],
): Record<LifecyclePhase, number> {
  const counts: Record<LifecyclePhase, number> = {
    queued: 0,
    working: 0,
    awaiting_recon: 0,
    needs_review: 0,
    settled: 0,
    cancelled: 0,
  }
  for (const t of taggedTrades) {
    counts[t.__phase.phase]++
  }
  return counts
}
