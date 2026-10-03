/**
 * The one place the app loads open obligations.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * `evaluateTradeReviewOwed` has always been able to voice an open
 * `trade_review` obligation, and has never once done so. Not because the
 * rule is wrong, and not because nothing writes obligations — the Trade Book
 * sync does — but because `data.tradeReviewObligations` is an OPTIONAL field
 * that neither caller of `runGlobalDecisionEngine` passes. The evaluator's
 * first line is `if (!data.tradeReviewObligations?.length) return []`, so it
 * returns an empty array on every run in the live application.
 *
 * Obligations were written and read by nothing. This is the read.
 *
 * ── Why one hook ─────────────────────────────────────────────────────────
 *
 * Two engine call sites need the same rows, and `useTradeReviewObligations`
 * already had its own query for the Trade Book sync. Three queries for one
 * question is how "open obligation" comes to mean three slightly different
 * things. This is built on `fetchObligations` — the canonical resolver —
 * and the Trade Book hook now delegates to it rather than issuing its own.
 *
 * ── Fan-out ──────────────────────────────────────────────────────────────
 *
 * Two requests total, regardless of how many obligations come back: one for
 * the obligations, one batched lookup for the display fields of all their
 * subjects. Never one per obligation.
 */
import { useQuery } from '@tanstack/react-query'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  fetchObligations,
  fetchTradeSubjectDisplay,
  type ObligationRow,
} from '../lib/memory/due-obligations'
import { OBLIGATION_KINDS, type ObligationKind } from '../lib/memory/obligations'
import type { DueState } from '../lib/memory/obligations'
import type { OpenTradeReviewObligation } from '../engine/decisionEngine/evaluators/tradeReviewOwed'

export const OPEN_OBLIGATIONS_KEY = ['memory', 'obligations', 'open'] as const

export interface EnrichedObligation extends ObligationRow {
  asset_symbol: string | null
  company_name: string | null
  asset_id: string | null
  portfolio_name: string | null
  resolved_portfolio_id: string | null
}

/**
 * Open obligations of one kind, with their subjects' display fields.
 *
 * `dueStates` defaults to every state rather than to 'due' alone: the Trade
 * Book sync needs all open rows to decide what to clear, and a
 * `trade_review` obligation has a null `due_at` in practice —
 * `execution_expected_by` is set on 0 of 53 production trades — so filtering
 * to 'due' here would return nothing and quietly reproduce the bug this hook
 * exists to fix.
 */
export function useOpenObligations(
  kind: ObligationKind,
  opts?: { dueStates?: DueState[]; ownerId?: string | null; enabled?: boolean },
) {
  const { currentOrgId } = useOrganization()
  const dueStates = opts?.dueStates ?? (['due', 'scheduled', 'open_ended'] as DueState[])

  return useQuery({
    queryKey: [...OPEN_OBLIGATIONS_KEY, currentOrgId, kind, dueStates.join(','), opts?.ownerId ?? 'any'],
    enabled: !!currentOrgId && opts?.enabled !== false,
    staleTime: 60_000,
    queryFn: async (): Promise<EnrichedObligation[]> => {
      const rows = await fetchObligations({
        organizationId: currentOrgId!,
        kinds: [kind],
        dueStates,
        ownerId: opts?.ownerId ?? undefined,
      })
      if (rows.length === 0) return []

      // One batched lookup for the whole page of obligations.
      const tradeIds = rows.filter(r => r.subject_type === 'trade').map(r => r.subject_id)
      const display = await fetchTradeSubjectDisplay(tradeIds)

      return rows.map(r => {
        const d = display.get(r.subject_id)
        return {
          ...r,
          asset_symbol: d?.symbol ?? null,
          company_name: d?.companyName ?? null,
          asset_id: d?.assetId ?? null,
          portfolio_name: d?.portfolioName ?? null,
          resolved_portfolio_id: d?.portfolioId ?? null,
        }
      })
    },
  })
}

/**
 * The shape `evaluateTradeReviewOwed` declares, built from the rows above.
 *
 * Kept as a mapping rather than widening the evaluator's input: the
 * evaluator's semantics are not broadened by this slice, only fed.
 */
export function toTradeReviewObligations(
  rows: EnrichedObligation[] | undefined,
): OpenTradeReviewObligation[] {
  return (rows ?? []).map(r => ({
    id: r.id,
    subject_id: r.subject_id,
    organization_id: r.organization_id,
    owner_id: r.owner_id,
    raised_at: r.raised_at,
    due_at: r.due_at,
    asset_symbol: r.asset_symbol,
    portfolio_name: r.portfolio_name,
  }))
}

/**
 * Open `trade_review` obligations, ready for the decision engine.
 *
 * Returns `[]` while loading and `[]` on failure. Absent obligations are not
 * an error: the engine runs a dozen evaluators and one unavailable input
 * must degrade to "this evaluator found nothing", never to a blank surface.
 */
export function useTradeReviewObligationsForEngine(): OpenTradeReviewObligation[] {
  const { data } = useOpenObligations(OBLIGATION_KINDS.tradeReview)
  return toTradeReviewObligations(data)
}
