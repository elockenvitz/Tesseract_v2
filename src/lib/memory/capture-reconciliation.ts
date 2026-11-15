/**
 * Does the Spine actually hold the events the canonical rows imply?
 *
 * ── Why a detector comes before a trigger ────────────────────────────────
 *
 * The four lifecycle writers run in the browser and `emit()` never throws:
 * a failure is a `console.warn` in one person's devtools and nothing else.
 * So the product cannot answer "how often does capture miss?", and until it
 * can, every proposed remedy is a guess about a number nobody has.
 *
 * The architecture audit guessed, and guessed wrong, in an instructive way.
 * It compared 35 events against 113 decision requests and 53 accepted
 * trades and reported 1.8% and 7.5% coverage. But the Spine's foundation
 * migration is `20260916180000` — 2026-09-16 — and almost all of those
 * canonical rows predate it. A writer cannot have missed an event for a row
 * that was written before the writer existed.
 *
 * Measured against the period the writers have actually existed, on
 * 2026-11-15 in production:
 *
 *   decision requests resolved since 2026-09-16        4
 *     of those carrying a `decision.recorded` event    2      50%
 *   accepted trades created since 2026-09-16           4
 *     of those carrying an `execution.recorded` event  4     100%
 *   trades reverted since 2026-09-16                   0
 *     of those carrying a `decision.reverted` event    0     n/a
 *
 * Two real conclusions, neither of which was available before:
 *
 *   1. The Spine is not broken. It is nearly populated for the window it
 *      has existed in, over a denominator of four. It looks empty because
 *      the desk has made four decisions in two months, not because the
 *      writers fail.
 *   2. There IS a genuine miss — 2 of 4 — and it was invisible. That is the
 *      defect worth fixing, and it is a visibility defect first.
 *
 * ── What this module is, and is not ──────────────────────────────────────
 *
 * It is READ-ONLY. It inserts nothing, updates nothing, and raises no
 * obligation. It answers one question — which canonical rows imply an event
 * the Spine does not hold — and it classifies the ones it cannot be sure
 * about rather than counting them against the writers.
 *
 * It is deliberately NOT a backfill. A backfill of STRUCTURE (this trade
 * was committed, at this time, by this actor) is defensible and is the
 * natural next step; a backfill of REASONING is a fabrication the product
 * would later cite as evidence. Separating the detector from the writer
 * keeps that line somewhere a reviewer can see it.
 *
 * ── The epoch, which is the whole correctness argument ───────────────────
 *
 * Every row is placed in one of three buckets, never two:
 *
 *   out_of_epoch   the canonical mutation happened before the writer for it
 *                  existed. NOT a miss. Backfillable later, by an explicit
 *                  decision, from structure only.
 *   captured       the expected event is present.
 *   missing        the mutation happened after the writer shipped and the
 *                  event is absent. This is the only bucket that counts as
 *                  a capture failure, and the only number worth acting on.
 *
 * Getting this wrong in either direction is costly. Count out-of-epoch rows
 * as misses and you conclude the writers are broken and go build a trigger
 * on `accepted_trades`, the product's most guarded write path, to fix a
 * problem that does not exist. Count missing rows as out-of-epoch and you
 * never find out that capture drops decisions.
 */

import { supabase } from '../supabase'
import { dedupeKeys, type LifecycleEventType } from './lifecycle-events'

/**
 * When each writer began to exist, as a date the DB can compare against.
 *
 * Sourced from the migration that created `memory_events`
 * (`supabase/migrations/20260916180000_memory_spine_foundation.sql`), not
 * from a guess and not from the earliest row present — the earliest row
 * present is a fact about usage, and using it as the epoch would make the
 * coverage number define itself.
 *
 * One epoch for all four writers because they shipped together. If a fifth
 * writer lands later it gets its own entry, because its coverage must not
 * be judged from before it existed.
 */
export const SPINE_EPOCH = '2026-09-16T00:00:00Z'

export type CaptureVerdict = 'captured' | 'missing' | 'out_of_epoch'

/** One canonical row and whether the Spine holds the event it implies. */
export interface CaptureRow {
  /** The canonical table this row lives in. */
  sourceType: 'decision_requests' | 'accepted_trades'
  sourceId: string
  /** The event that should exist for it. */
  expectedEventType: LifecycleEventType
  /** The deterministic key that event would carry. */
  dedupeKey: string
  /** When the canonical mutation happened. */
  occurredAt: string
  verdict: CaptureVerdict
}

export interface CaptureReport {
  epoch: string
  rows: CaptureRow[]
  counts: Record<CaptureVerdict, number>
  /**
   * Captured as a share of rows IN epoch. Null when nothing is in epoch,
   * which is an honest answer and not 0% — a writer with no opportunity to
   * fire has no coverage to report.
   */
  coverageInEpoch: number | null
}

/* ─────────────────────────── the pure core ──────────────────────────────── */

export interface ResolvedDecisionInput {
  id: string
  status: string
  /** When the PM resolved it. Null means never resolved. */
  reviewedAt: string | null
  acceptedTradeId: string | null
}

export interface CommittedTradeInput {
  id: string
  createdAt: string
  /** Set only when the trade has been reverted. */
  revertedAt?: string | null
}

export interface ReconcileInput {
  decisions: ResolvedDecisionInput[]
  trades: CommittedTradeInput[]
  /**
   * The `(event_type, source_id)` pairs `memory_events` already holds, as
   * `"<event_type>|<source_id>"`.
   *
   * ── Why NOT the dedupe key, which was the first design ───────────────
   *
   * Matching on the writers' `dedupe_key` looks obviously right and is
   * wrong, and production says so. `decision.recorded`'s key is
   *
   *     decision.recorded:<drId>:<status>:<acceptedTradeId ?? 'no-trade'>
   *
   * and on the inbox accept path the decision request is resolved — and the
   * event emitted — BEFORE the accepted trade exists. `accepted_trade_id`
   * is written by a later call. So both `decision.recorded` rows in
   * production carry `...:accepted:no-trade`, while the rows they describe
   * now carry a real trade id. Rebuilding the key from current state
   * reproduces neither.
   *
   * Measured 2026-11-15: key matching reported 0 captured / 4 missing;
   * matching on `(event_type, source_id)` reports 2 captured / 2 missing,
   * which is the truth.
   *
   * This matters well beyond the detector, and is written up rather than
   * worked around silently:
   *
   *   1. A key-based BACKFILL would insert a second event for every
   *      decision already recorded — it would rebuild the trade-bearing
   *      key, miss, and append. Into an append-only table. The brief's
   *      "retries cannot multiply the same historical fact" requirement is
   *      not met by the current key.
   *   2. The key's documented purpose is not achieved. It includes
   *      `accepted_trade_id` so that accept -> revert -> accept-again reads
   *      as two decisions; because the value is null at emit time on that
   *      path, both accepts produce `...:accepted:no-trade` and the SECOND
   *      one is swallowed as a duplicate. The key currently does the
   *      opposite of what its comment claims.
   *
   * Changing the writer's key is deliberately NOT done here: it would make
   * every existing row unmatchable by the new key, and it is a change to an
   * append-only table's idempotency contract, which deserves its own
   * review. Recommended fix is recorded in the phase report.
   */
  presentEventKeys: Iterable<string>
  epoch?: string
}

/** How a present event is identified. One shape, used on both sides. */
export function eventKey(eventType: LifecycleEventType | string, sourceId: string): string {
  return `${eventType}|${sourceId}`
}

function verdictFor(occurredAt: string | null, epoch: string, present: boolean): CaptureVerdict {
  // An unparseable or absent timestamp is treated as out of epoch rather
  // than as a miss. The alternative blames the writer for a row whose
  // position relative to the writer's existence is unknown.
  if (!occurredAt) return 'out_of_epoch'
  const t = Date.parse(occurredAt)
  if (!Number.isFinite(t) || t < Date.parse(epoch)) return 'out_of_epoch'
  return present ? 'captured' : 'missing'
}

/**
 * Compare canonical rows against the keys the Spine holds.
 *
 * Pure: no network, no clock, no `Date.now()`. The epoch is a parameter and
 * the present keys are an argument, so a test can state the whole world and
 * the result is a function of it.
 *
 * Presence is matched on `(event_type, source_id)`. The dedupe key is still
 * reported on every row, built from the writers' own `dedupeKeys` so it
 * cannot drift from them — but it is reported, not matched on. See
 * `presentEventKeys` for the production measurement that forced that
 * distinction.
 */
export function reconcileCapture(input: ReconcileInput): CaptureReport {
  const epoch = input.epoch ?? SPINE_EPOCH
  const present = new Set(input.presentEventKeys)
  const rows: CaptureRow[] = []

  for (const d of input.decisions) {
    rows.push({
      sourceType: 'decision_requests',
      sourceId: d.id,
      expectedEventType: 'decision.recorded',
      dedupeKey: dedupeKeys.decisionRecorded(d.id, d.status, d.acceptedTradeId ?? null),
      occurredAt: d.reviewedAt ?? '',
      verdict: verdictFor(d.reviewedAt, epoch, present.has(eventKey('decision.recorded', d.id))),
    })
  }

  for (const t of input.trades) {
    rows.push({
      sourceType: 'accepted_trades',
      sourceId: t.id,
      expectedEventType: 'execution.recorded',
      dedupeKey: dedupeKeys.executionRecorded(t.id),
      occurredAt: t.createdAt,
      verdict: verdictFor(t.createdAt, epoch, present.has(eventKey('execution.recorded', t.id))),
    })

    // A revert is expected ONLY for a trade that was actually reverted.
    // Expecting one for every trade would make the report say the product
    // fails to record reversals that never happened.
    if (t.revertedAt) {
      rows.push({
        sourceType: 'accepted_trades',
        sourceId: t.id,
        expectedEventType: 'decision.reverted',
        dedupeKey: dedupeKeys.decisionReverted(t.id),
        occurredAt: t.revertedAt,
        verdict: verdictFor(t.revertedAt, epoch, present.has(eventKey('decision.reverted', t.id))),
      })
    }
  }

  const counts: Record<CaptureVerdict, number> = { captured: 0, missing: 0, out_of_epoch: 0 }
  for (const r of rows) counts[r.verdict] += 1

  const inEpoch = counts.captured + counts.missing
  return {
    epoch,
    rows,
    counts,
    coverageInEpoch: inEpoch === 0 ? null : counts.captured / inEpoch,
  }
}

/**
 * `execution.recorded` is emitted from EVIDENCE, not from status.
 *
 * `createAcceptedTrade` emits only when `executionProven` is true, which
 * means the holdings apply reported that it actually moved shares;
 * `updateExecutionStatus` emits on a trader's attestation. A trade whose
 * holdings never applied and which nobody attested is CORRECTLY eventless.
 * The Spine refusing to assert an execution it did not observe is the
 * feature, not the gap, and a detector that ignored this would report a
 * shortfall the product must not close.
 *
 * Both of those paths leave `accepted_trades.execution_status = 'complete'`
 * (`finalizeTradeForHoldingsSource` auto-completes for paper and manual_eod
 * portfolios; a trader attestation sets it directly). `not_started` is the
 * live-feed case still awaiting a trader, and is rightly eventless.
 *
 * Deliberately does NOT read `holdings_source`: that column lives on
 * `portfolios`, not on `accepted_trades` — checked against the live
 * catalog, where `accepted_trades` has no such column. An earlier draft of
 * this file selected it, which would have made every call fail on an
 * unknown column. Production distribution on 2026-11-15: 49 `complete`,
 * 4 `not_started`, nothing else.
 */
export function tradeHasExecutionEvidence(trade: {
  execution_status?: string | null
}): boolean {
  return trade.execution_status === 'complete'
}

/* ──────────────────────────── the query layer ───────────────────────────── */

export interface FetchCaptureGapsOptions {
  epoch?: string
  /**
   * Cap on rows read per table. The detector is a diagnostic, not a page,
   * and an unbounded read of the decision chain is exactly what the
   * performance rules forbid on a rendered surface.
   */
  limit?: number
}

/**
 * Run the detector against the live database, read-only.
 *
 * Reads under the CALLER's RLS. `memory_events` SELECT is
 * `is_member_of_org(organization_id)` and the canonical tables are
 * org-scoped by their own policies, so this reports on the caller's
 * organizations and no others — no `service_role`, no definer helper, no
 * cross-tenant join. A platform-wide number would need a separate,
 * explicitly authorized path, and does not exist here on purpose.
 */
export async function fetchCaptureGaps(
  options: FetchCaptureGapsOptions = {},
): Promise<CaptureReport> {
  const epoch = options.epoch ?? SPINE_EPOCH
  const limit = options.limit ?? 500

  const [drRes, atRes, evRes] = await Promise.all([
    supabase
      .from('decision_requests')
      .select('id, status, reviewed_at, accepted_trade_id')
      .not('reviewed_at', 'is', null)
      .gte('reviewed_at', epoch)
      .order('reviewed_at', { ascending: false })
      .limit(limit),
    supabase
      .from('accepted_trades')
      .select('id, created_at, reverted_at, execution_status')
      .gte('created_at', epoch)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('memory_events')
      .select('event_type, source_id')
      .in('event_type', ['decision.recorded', 'execution.recorded', 'decision.reverted'])
      .limit(limit * 3),
  ])

  // An error here must not be reported as "everything is missing". A failed
  // read of `memory_events` would otherwise make every row look uncaptured,
  // which is the detector committing the very error it exists to prevent.
  if (drRes.error || atRes.error || evRes.error) {
    throw new Error(
      '[capture-reconciliation] read failed: ' +
        (drRes.error?.message || atRes.error?.message || evRes.error?.message),
    )
  }

  type DrRow = { id: string; status: string; reviewed_at: string | null; accepted_trade_id: string | null }
  type AtRow = {
    id: string; created_at: string; reverted_at: string | null
    execution_status: string | null
  }

  const decisions = ((drRes.data ?? []) as DrRow[]).map(d => ({
    id: d.id,
    status: d.status,
    reviewedAt: d.reviewed_at,
    acceptedTradeId: d.accepted_trade_id,
  }))

  const trades = ((atRes.data ?? []) as AtRow[])
    .filter(tradeHasExecutionEvidence)
    .map(t => ({ id: t.id, createdAt: t.created_at, revertedAt: t.reverted_at }))

  const presentEventKeys = ((evRes.data ?? []) as { event_type: string; source_id: string | null }[])
    .filter(e => !!e.source_id)
    .map(e => eventKey(e.event_type, e.source_id as string))

  return reconcileCapture({ decisions, trades, presentEventKeys, epoch })
}

/** One line per verdict, for a console or a log. Never for a user surface. */
export function formatCaptureReport(report: CaptureReport): string {
  const { counts, coverageInEpoch } = report
  const pct = coverageInEpoch === null ? 'n/a' : `${Math.round(coverageInEpoch * 100)}%`
  return [
    `epoch           ${report.epoch}`,
    `captured        ${counts.captured}`,
    `missing         ${counts.missing}`,
    `out_of_epoch    ${counts.out_of_epoch}  (predates the writer; not a miss)`,
    `coverage        ${pct}  (of rows in epoch only)`,
  ].join('\n')
}
