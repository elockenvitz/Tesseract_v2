/**
 * Pure helpers for the asset Decision Memory timeline.
 *
 * Separate from `useAssetDecisionTimeline` on purpose. These are the parts
 * with no I/O — the sort rule, the display parse, and the execution-proof
 * grading — and they are imported by the component as well as the hook. The
 * desktop harness resolves the HOOK to a fixture stub, so anything the
 * component needs at render time has to live somewhere the stub does not
 * replace, or the harness renders against half-missing exports.
 */

import type { ExecutionProof } from '../../types/decision-timeline'

/** `portfolio_trade_events.event_date` is a DATE; everything else is timestamptz. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Sort key for the merged timeline.
 *
 * Sorting the list with `String.localeCompare` put every execution BELOW the
 * decisions that caused it, because '2026-06-02' sorts before
 * '2026-06-02T14:11:00Z' on the shared prefix. Epoch milliseconds fix the
 * comparison.
 *
 * A bare date parses as UTC midnight, which would still place an execution
 * before a same-day decision carrying a real time — so dates are nudged to
 * the END of their day. An execution is a consequence; on the only
 * information available it belongs after that day's decisions, not before.
 *
 * This nudge is for ORDERING ONLY. Display goes through
 * `parseTimelineDate`, which keeps the calendar date intact.
 */
export function timelineSortKey(timestamp: string): number {
  if (DATE_ONLY.test(timestamp)) {
    return Date.parse(`${timestamp}T23:59:59.999Z`)
  }
  const t = Date.parse(timestamp)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Parse a timeline timestamp for DISPLAY.
 *
 * `new Date('2026-06-02')` is specified to parse as UTC midnight, so in any
 * negative-offset zone it renders as the PREVIOUS day — a trade executed on
 * 2 June showed as "Jun 1" for every reader in the Americas. A DATE carries
 * no time and no zone: it means that calendar day wherever it is read, so it
 * is constructed in LOCAL time.
 *
 * Full timestamps are instants and are parsed normally — converting those to
 * the reader's local day is correct and already worked.
 */
export function parseTimelineDate(timestamp: string): Date {
  if (DATE_ONLY.test(timestamp)) {
    const [y, mo, d] = timestamp.split('-').map(Number)
    return new Date(y, mo - 1, d)
  }
  return new Date(timestamp)
}

/** True when a timestamp carries no time of day. */
export function isDateOnly(timestamp: string): boolean {
  return DATE_ONLY.test(timestamp)
}

/**
 * Grade an execution row's proof.
 *
 * Reads only what the writer stamps — `EXECUTION_ORIGIN` in
 * `lib/services/accepted-trade-service.ts:1448` is the vocabulary. Never
 * infers from timestamps, and never upgrades an absence of evidence into
 * evidence.
 */
export function gradeExecutionProof(row: {
  detected_by_system: boolean | null
  source_type: string | null
  metadata: Record<string, unknown> | null
}): ExecutionProof {
  const origin = typeof row.metadata?.origin === 'string' ? row.metadata.origin : null

  // A declared origin is the most specific thing available, so it wins.
  if (origin === 'trader_attested') return 'attested'
  if (origin === 'pm_assumed_execution') return 'assumed'
  if (origin === 'paper_execute_backfill') return 'backfilled'

  // Observation is the CONJUNCTION of both stamps, not either one. A row
  // claiming `holdings_diff` without `detected_by_system` was not observed.
  if (row.detected_by_system === true && row.source_type === 'holdings_diff') {
    return 'verified'
  }

  return 'unattributed'
}
