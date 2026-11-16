/**
 * Execution proof grades, for the Edge runtime.
 *
 * A deliberate mirror of `src/lib/asset-decisions/timeline.ts`
 * (`gradeExecutionProof`, `gradeTradeExecution`) and the `ExecutionProof`
 * union in `src/types/decision-timeline.ts`. The frontend module imports from
 * `src/`, which Deno cannot resolve, and this file is Deno-free on purpose so
 * the unit suite can exercise it -- the same arrangement
 * `_shared/research-results.ts` already uses.
 *
 * `supabase/functions/_shared/__tests__` has no runner of its own, so the
 * guard against the two copies drifting is a unit test in `src/lib/ai`, which
 * reads BOTH files and compares the grades they produce. If you add a grade or
 * an origin here, add it there, or that test fails.
 *
 * ── Why ACT AI needs this at all ────────────────────────────────────────
 *
 * `get_decisions` reported `execution_status` verbatim: "execution complete".
 * That column says `complete` for a fill the app watched, a fill a trader
 * reported from the desk, and a fill the pilot assumed because a PM approved
 * it. An assistant repeating the column was asserting a market event on the
 * strength of a policy. The grade is one join away and the model should have
 * it, because a reader asking "did we actually buy it" is asking this
 * question, not the status question.
 */

export type ExecutionProof =
  | "broker_confirmed"
  | "verified"
  | "attested"
  | "assumed"
  | "backfilled"
  | "unattributed";

/** Strongest first. The order IS the meaning; see `gradeTradeExecution`. */
export const PROOF_STRENGTH: readonly ExecutionProof[] = [
  "broker_confirmed",
  "verified",
  "attested",
  "assumed",
  "backfilled",
  "unattributed",
];

/**
 * How each grade is said to a model, in a sentence it cannot round off.
 *
 * Not the UI's short labels. "Observed" alone invites the model to write
 * "observed execution", which a reader will hear as a market observation --
 * so each phrase names WHO stands behind the claim, and the two that nobody
 * stands behind say so outright.
 */
export const PROOF_PHRASE: Record<ExecutionProof, string> = {
  broker_confirmed: "confirmed by an external broker",
  verified:
    "applied to Tesseract's model book and observed there; no external confirmation",
  attested: "reported executed by a person; not observed by any system",
  assumed:
    "ASSUMED under pilot policy because a PM approved it; nobody observed or confirmed a fill",
  backfilled: "imported by a migration, not recorded by a live execution",
  unattributed: "recorded without provenance; how it executed is not known",
};

/** Grade one `portfolio_trade_events` row. Mirrors `gradeExecutionProof`. */
export function gradeExecutionProof(row: {
  detected_by_system: boolean | null;
  source_type: string | null;
  metadata: Record<string, unknown> | null;
}): ExecutionProof {
  const origin = typeof row.metadata?.origin === "string" ? row.metadata.origin : null;

  if (origin === "broker_confirmed") return "broker_confirmed";
  if (origin === "trader_attested") return "attested";
  if (origin === "pm_assumed_execution") return "assumed";
  if (origin === "paper_execute_backfill") return "backfilled";

  // Observation is the CONJUNCTION of both stamps, not either one.
  if (row.detected_by_system === true && row.source_type === "holdings_diff") {
    return "verified";
  }
  return "unattributed";
}

/**
 * Grade a trade from all of its evidence rows. Strongest row wins.
 *
 * `null` for no rows, which is NOT `"unattributed"`: no record that it
 * executed, versus a record that does not say how.
 */
export function gradeTradeExecution(
  rows: Array<{
    detected_by_system: boolean | null;
    source_type: string | null;
    metadata: Record<string, unknown> | null;
  }>,
): ExecutionProof | null {
  if (rows.length === 0) return null;
  const grades = rows.map(gradeExecutionProof);
  for (const g of PROOF_STRENGTH) {
    if (grades.includes(g)) return g;
  }
  return "unattributed";
}

/**
 * Group evidence rows by the trade they belong to and grade each.
 *
 * The caller passes rows it already read with ITS OWN client, so RLS decides
 * what is in here. A trade with no visible evidence is simply absent from the
 * result, and the caller must render that as "not known", never as a fill.
 */
export function gradeTradesFromEvidence(
  rows: Array<{
    detected_by_system: boolean | null;
    source_type: string | null;
    metadata: Record<string, unknown> | null;
  }>,
): Map<string, ExecutionProof> {
  const byTrade = new Map<string, typeof rows>();
  for (const row of rows) {
    const tradeId = typeof row.metadata?.accepted_trade_id === "string"
      ? row.metadata.accepted_trade_id
      : null;
    if (!tradeId) continue;
    const list = byTrade.get(tradeId);
    if (list) list.push(row);
    else byTrade.set(tradeId, [row]);
  }
  const out = new Map<string, ExecutionProof>();
  for (const [tradeId, tradeRows] of byTrade) {
    const grade = gradeTradeExecution(tradeRows);
    if (grade) out.set(tradeId, grade);
  }
  return out;
}
