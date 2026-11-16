/**
 * One execution-evidence read, for every surface that reports on a trade.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `accepted_trades.execution_status` is a CLAIM. It says `complete` for a
 * trade the app watched move, for a trade a trader said moved at the desk,
 * and for a trade a PM approved under the pilot assumption that it would
 * move. Those are three different facts and the column cannot tell them
 * apart — the grade lives in `portfolio_trade_events.metadata.origin`, one
 * join away, and three surfaces were reading the claim instead:
 *
 *   - Outcomes, from `execution_status`
 *   - decisions-v2, from `execution_completed_at`
 *   - ACT AI `get_decisions`, from `execution_status`
 *
 * All three said "Executed" for a PM-assumed fill. None of them was wrong
 * about the column; they were reading the wrong record.
 *
 * ── Permission scope ────────────────────────────────────────────────────
 *
 * This runs on the caller's own Supabase client, so `portfolio_trade_events`
 * RLS applies unchanged and no surface sees evidence for a portfolio its
 * reader cannot already read. That has a consequence worth stating plainly:
 * a reader authorised for the TRADE but not for its evidence gets no grade,
 * which renders as an unqualified "Executed" — the behaviour that was there
 * before. The failure mode is losing a qualifier, never gaining a claim, and
 * that is the direction a wrong answer has to fail in.
 *
 * The same applies to an outright query failure: the read is best-effort and
 * returns an empty map rather than throwing, because a surface that cannot
 * grade its evidence must still render the trade.
 */
import { supabase } from '../supabase'
import { gradeTradeExecution } from './timeline'
import type { ExecutionProof } from '../../types/decision-timeline'

type EvidenceRow = {
  detected_by_system: boolean | null
  source_type: string | null
  metadata: Record<string, unknown> | null
}

/**
 * PostgREST caps URL length, and the filter is one id per trade. 100 keeps a
 * chunked request comfortably inside it while still being one round trip for
 * every realistic page of trades.
 */
const CHUNK = 100

/**
 * Grade the execution evidence for a set of trades.
 *
 * A trade absent from the returned map has no evidence this reader can see.
 * That is deliberately distinguishable from a trade mapped to
 * `'unattributed'`, which HAS a row that does not say where it came from —
 * see `gradeTradeExecution`.
 */
export async function fetchExecutionProofsForTrades(
  tradeIds: string[],
): Promise<Map<string, ExecutionProof>> {
  const proofs = new Map<string, ExecutionProof>()
  const ids = Array.from(new Set(tradeIds.filter(Boolean)))
  if (ids.length === 0) return proofs

  const byTrade = new Map<string, EvidenceRow[]>()

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    try {
      const { data, error } = await supabase
        .from('portfolio_trade_events')
        .select('metadata, detected_by_system, source_type')
        .in('metadata->>accepted_trade_id', chunk)
      if (error) {
        console.warn('[ExecutionEvidence] Could not read execution evidence', error)
        continue
      }
      for (const row of (data ?? []) as EvidenceRow[]) {
        const tradeId = typeof row.metadata?.accepted_trade_id === 'string'
          ? row.metadata.accepted_trade_id
          : null
        if (!tradeId) continue
        const list = byTrade.get(tradeId)
        if (list) list.push(row)
        else byTrade.set(tradeId, [row])
      }
    } catch (e) {
      console.warn('[ExecutionEvidence] Execution evidence read threw', e)
    }
  }

  for (const [tradeId, rows] of byTrade) {
    const grade = gradeTradeExecution(rows)
    if (grade) proofs.set(tradeId, grade)
  }
  return proofs
}
