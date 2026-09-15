/**
 * What a pilot's seeded artifact is allowed to be, once the pilot is over.
 *
 * The pilot ships real rows: a handful of trade ideas and a decision request,
 * marked `pilot_seed` in `origin_metadata` (trade_queue_items) or in
 * `submission_snapshot` (decision_requests). While the pilot is running they
 * ARE the work -- the mission is completed on them, and hiding them would
 * empty the product the reader is being shown.
 *
 * After graduation they are history. They stay stored, with their provenance
 * and every record they produced intact, and every archival surface still
 * shows them. What they must not do is masquerade as operational work: a
 * seeded idea nobody started is not "an idea being worked", and a seeded
 * request nobody answered is not a decision awaiting one. A graduated reader's
 * Dashboard would otherwise measure the tour instead of their book.
 *
 * ── The line is "did a person act on it", not "was it seeded" ─────────────
 *
 * Bogey Cap's pilot ends with the seeded MSFT idea decided and executed by the
 * reader. That decision and that trade are genuine work that happens to have
 * begun from a seeded row, and suppressing them would delete the pilot's one
 * real outcome from the record. So a seeded artifact leaves the operational
 * surfaces only while it is still in the state the seed left it in.
 *
 * Nothing here deletes, archives or writes. It is a read-side rule, applied by
 * the Dashboard lenses, so all of them answer the question the same way.
 */

/** Rows that may carry the marker, in the two shapes the database uses. */
export interface SeedMetadataRow {
  origin_metadata?: unknown
  submission_snapshot?: unknown
}

/** True when this row was planted by the pilot seeder. */
export function isPilotSeedRow(row: SeedMetadataRow | null | undefined): boolean {
  if (!row) return false
  return hasSeedFlag(row.origin_metadata) || hasSeedFlag(row.submission_snapshot)
}

function hasSeedFlag(meta: unknown): boolean {
  return !!meta && typeof meta === 'object'
    && (meta as Record<string, unknown>).pilot_seed === true
}

/** A row as the rule sees it, whatever surface read it. */
export interface SeedJudgeable {
  /** Planted by the pilot seeder. */
  pilotSeed?: boolean | null
  /**
   * Whether a person has since acted on it -- decided it, executed it, moved
   * it on. An acted-on seed is that person's work and stays operational.
   */
  actedOn?: boolean | null
}

/**
 * Whether this row may still be counted, ranked and described as live work.
 *
 * `hasGraduated` is the pilot's own flag (`usePilotMode`). Before graduation
 * everything is operational, seeds included.
 */
export function isOperationalAfterPilot(
  row: SeedJudgeable, { hasGraduated }: { hasGraduated: boolean },
): boolean {
  if (!hasGraduated) return true
  if (!row.pilotSeed) return true
  return !!row.actedOn
}

/** The operational subset, in order, leaving the rest exactly where they are. */
export function operationalAfterPilot<T extends SeedJudgeable>(
  rows: readonly T[], opts: { hasGraduated: boolean },
): T[] {
  return rows.filter(r => isOperationalAfterPilot(r, opts))
}
