/**
 * Reading a historical recommendation honestly.
 *
 * Four surfaces render what was recommended — Decision Inbox, Outcomes,
 * Trade Book and the decision-story RPC — and all four currently reach for
 * current idea state when the historical value is missing. That substitution
 * is the defect: a blank falls back to today's thesis, and the blank is
 * invisible while the substitution looks like a record.
 *
 * This module resolves the historical content once, with three tiers, and
 * makes the tier explicit so a surface can label what it is showing instead
 * of implying provenance it does not have.
 *
 *   'version'   an immutable trade_proposal_versions row. Complete.
 *   'snapshot'  decision_requests.submission_snapshot. Sizing and identity
 *               only — it never held reasoning. Reasoning reads as NOT
 *               CAPTURED, not as empty.
 *   'none'      neither exists. Nothing is claimed.
 *
 * There is no fourth tier that reads current idea state, deliberately. If a
 * surface wants to show today's thinking it must ask for it separately and
 * label it as current — which is a different question from what was
 * recommended, and conflating the two is how a decision ends up appearing to
 * rest on reasoning that postdates it.
 */
import type { RecommendationVersion } from './recommendation-version'

export type HistoricalSource = 'version' | 'snapshot' | 'none'

/**
 * A field that may or may not have been preserved.
 *
 * `captured: false` is not the same as `value: null`. The first says we never
 * recorded this; the second says it was recorded as empty. Collapsing them is
 * what lets a UI print "No thesis" for a recommendation whose thesis simply
 * predates the freeze.
 */
export interface HistoricalField<T> {
  value: T | null
  captured: boolean
}

const absent = <T>(): HistoricalField<T> => ({ value: null, captured: false })
const captured = <T>(value: T | null): HistoricalField<T> => ({ value, captured: true })

export interface HistoricalRecommendation {
  source: HistoricalSource
  versionId: string | null
  versionNumber: number | null
  submittedAt: string | null
  /** What was asked for. */
  action: HistoricalField<string>
  weight: HistoricalField<number>
  shares: HistoricalField<number>
  sizingMode: HistoricalField<string>
  notes: HistoricalField<string>
  /** The thinking that accompanied it. */
  thesisText: HistoricalField<string>
  rationale: HistoricalField<string>
  conviction: HistoricalField<string>
  targetPrice: HistoricalField<number>
  stopLoss: HistoricalField<number>
  takeProfit: HistoricalField<number>
  timeHorizon: HistoricalField<string>
  theses: HistoricalField<RecommendationVersion['theses']>
  ideaStage: HistoricalField<string>
  /** Per-field origin, present only for version-backed rows. */
  provenance: Record<string, unknown> | null
  /**
   * True when the reasoning was never captured, so a surface can say so once
   * rather than printing "not captured" against eight separate fields.
   */
  reasoningUnavailable: boolean
}

/** The subset of a decision request this resolver needs. */
export interface DecisionRequestLike {
  proposal_version_id?: string | null
  submission_snapshot?: Record<string, unknown> | null
  sizing_weight?: number | null
  sizing_shares?: number | null
  sizing_mode?: string | null
  requested_action?: string | null
  created_at?: string | null
}

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Resolve what a decision request's recommendation actually said.
 *
 * `version` is passed in rather than fetched so callers that already joined
 * it — the Decision Inbox fetches a page of requests at once — do not issue
 * one query per row.
 */
export function resolveHistoricalRecommendation(
  request: DecisionRequestLike | null | undefined,
  version?: RecommendationVersion | null,
): HistoricalRecommendation {
  if (version) {
    return {
      source: 'version',
      versionId: version.id,
      versionNumber: version.version_number,
      submittedAt: version.submitted_at ?? version.created_at,
      action: captured(version.action),
      weight: captured(version.weight),
      shares: captured(version.shares),
      sizingMode: captured(version.sizing_mode),
      notes: captured(version.notes),
      thesisText: captured(version.thesis_text),
      rationale: captured(version.rationale),
      conviction: captured(version.conviction),
      targetPrice: captured(version.target_price),
      stopLoss: captured(version.stop_loss),
      takeProfit: captured(version.take_profit),
      timeHorizon: captured(version.time_horizon),
      theses: captured(version.theses ?? []),
      ideaStage: captured(version.idea_stage),
      provenance: version.captured_from ?? null,
      reasoningUnavailable: false,
    }
  }

  const snapshot = request?.submission_snapshot
  const hasSnapshot = !!snapshot && Object.keys(snapshot).length > 0

  if (hasSnapshot) {
    // The snapshot's keys, verified against all 70 populated rows in
    // production: action, symbol, company_name, portfolio_name, weight,
    // shares, sizing_mode, sizing_context, notes, proposal_type,
    // requester_name, requester_email, submitted_at, baseline_weight,
    // proposal_created_at. Sizing and identity. No reasoning, ever — which
    // is why every reasoning field below is `absent()` and not a lookup.
    const s = snapshot as Record<string, unknown>
    return {
      source: 'snapshot',
      versionId: null,
      versionNumber: null,
      submittedAt: str(s.submitted_at) ?? request?.created_at ?? null,
      action: captured(str(s.action) ?? request?.requested_action ?? null),
      weight: captured(num(s.weight) ?? request?.sizing_weight ?? null),
      shares: captured(num(s.shares) ?? request?.sizing_shares ?? null),
      sizingMode: captured(str(s.sizing_mode) ?? request?.sizing_mode ?? null),
      notes: captured(str(s.notes)),
      thesisText: absent(),
      rationale: absent(),
      conviction: absent(),
      targetPrice: absent(),
      stopLoss: absent(),
      takeProfit: absent(),
      timeHorizon: absent(),
      theses: absent(),
      ideaStage: absent(),
      provenance: null,
      reasoningUnavailable: true,
    }
  }

  // Neither. The request's own columns still hold the sizing it was raised
  // with — those are durable and are not reasoning, so they are honest to
  // show. Everything else is unknown and is reported as unknown.
  return {
    source: 'none',
    versionId: null,
    versionNumber: null,
    submittedAt: request?.created_at ?? null,
    action: request?.requested_action != null ? captured(request.requested_action) : absent(),
    weight: request?.sizing_weight != null ? captured(request.sizing_weight) : absent(),
    shares: request?.sizing_shares != null ? captured(request.sizing_shares) : absent(),
    sizingMode: request?.sizing_mode != null ? captured(request.sizing_mode) : absent(),
    notes: absent(),
    thesisText: absent(),
    rationale: absent(),
    conviction: absent(),
    targetPrice: absent(),
    stopLoss: absent(),
    takeProfit: absent(),
    timeHorizon: absent(),
    theses: absent(),
    ideaStage: absent(),
    provenance: null,
    reasoningUnavailable: true,
  }
}

/**
 * One line a surface can show in place of historical reasoning it does not
 * have. Returns null when the reasoning IS available.
 *
 * Centralised so every surface says the same true thing. "This recommendation
 * predates reasoning capture" is a fact about our record keeping; "no thesis
 * was given" is a claim about the analyst, and we are not entitled to it.
 */
export function reasoningFallbackNote(h: HistoricalRecommendation): string | null {
  if (!h.reasoningUnavailable) return null
  return h.source === 'snapshot'
    ? 'Submitted before investment reasoning was captured. Sizing and action shown are from the original submission; the thesis at that time was not recorded.'
    : 'No submission record was captured for this decision. Nothing shown here is a reconstruction of what was recommended.'
}

/**
 * Did the PM decide something other than what was recommended?
 *
 * Takes the decided sizing from the accepted trade and compares it with the
 * recommended sizing from the frozen version. Both are returned; neither
 * overwrites the other. A PM accepting +100bps at +50bps must not make the
 * record say the analyst recommended +50.
 */
export interface RecommendedVsDecided {
  recommendedWeight: number | null
  recommendedShares: number | null
  recommendedAction: string | null
  decidedWeight: number | null
  decidedShares: number | null
  decidedAction: string | null
  modified: boolean
  /** False when we cannot tell, so "unmodified" is never assumed. */
  comparable: boolean
}

export function compareRecommendedWithDecided(
  historical: HistoricalRecommendation,
  decided: {
    target_weight?: number | null
    target_shares?: number | null
    action?: string | null
  } | null | undefined,
): RecommendedVsDecided {
  const recommendedWeight = historical.weight.captured ? historical.weight.value : null
  const recommendedShares = historical.shares.captured ? historical.shares.value : null
  const recommendedAction = historical.action.captured ? historical.action.value : null
  const decidedWeight = decided?.target_weight ?? null
  const decidedShares = decided?.target_shares ?? null
  const decidedAction = decided?.action ?? null

  const weightComparable = recommendedWeight != null && decidedWeight != null
  const sharesComparable = recommendedShares != null && decidedShares != null
  const actionComparable = recommendedAction != null && decidedAction != null
  const comparable = weightComparable || sharesComparable || actionComparable

  // Weights are numeric(…) out of Postgres and arrive as JS numbers that have
  // already been rounded by the column's scale, so an exact compare is safe
  // here — but a hair of tolerance costs nothing and stops 2.4999999 reading
  // as a PM modification.
  const modified =
    (weightComparable && Math.abs((recommendedWeight as number) - (decidedWeight as number)) > 1e-9) ||
    (sharesComparable && recommendedShares !== decidedShares) ||
    (actionComparable && recommendedAction !== decidedAction)

  return {
    recommendedWeight,
    recommendedShares,
    recommendedAction,
    decidedWeight,
    decidedShares,
    decidedAction,
    modified,
    comparable,
  }
}
