/**
 * Decision Intelligence Engine
 *
 * Derives per-row verdicts, primary breakdowns, action cues, and urgency
 * from AccountabilityRow data. Also builds a live process health summary
 * across all decisions.
 *
 * This turns the Decisions tab from a passive log into a live
 * decision-monitoring and accountability surface.
 */

import type { AccountabilityRow } from '../types/decision-accountability'

// ─── Types ────────────────────────────────────────────────────

export type DecisionVerdict =
  | 'working'        // executed, positive/neutral outcome
  | 'hurting'        // executed, negative outcome
  | 'stalled'        // approved but not executed, aging
  | 'awaiting'       // approved recently, normal pending
  | 'unmatched'      // approved 30d+ with no trade
  | 'needs_review'   // executed but no rationale text yet (Add Rationale)
  | 'evaluate'       // rationale exists but no decision-quality evaluation yet (Evaluate Decision)
  | 'rejected'       // decision was rejected
  | 'withdrawn'      // decision was cancelled
  | 'discretionary'  // trade without decision
  | 'resolved'       // executed AND reviewed — decision quality captured

export type Urgency = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface DecisionIntelligence {
  verdict: DecisionVerdict
  verdictLabel: string
  primaryIssue: string
  actionNeeded: string | null
  urgency: Urgency
  resultLabel: string | null
  resultDirection: 'positive' | 'negative' | 'neutral' | null
  ageDays: number | null // days since decision/event — used for time pressure
  ageSeverity: 'fresh' | 'aging' | 'overdue' | null
}

/**
 * Short, human-readable explanation for each verdict — surfaced as a
 * hover tooltip on the verdict badge in Outcomes so a PM who sees
 * "Needs Review" or "Stalled" can understand *why* at a glance without
 * having to look up the semantics elsewhere. Keep each entry to 1–2
 * sentences: what the state means, and what the PM is expected to do
 * about it. Rendered as a plain `title` attribute, so no markup / line
 * breaks here — one continuous sentence reads best in the OS tooltip.
 */
export const VERDICT_EXPLANATIONS: Record<DecisionVerdict, string> = {
  working:
    'Executed and moving with the thesis. Tesseract is monitoring the outcome — capture a quick reflection if you want this on the record.',
  resolved:
    'Reflection captured. Tesseract has the context it needs to feed this decision back into your scorecards.',
  hurting:
    'Executed but moving against the thesis. Review what changed and decide whether the original case still holds.',
  stalled:
    'Approved but not yet executed and the clock is running. Either execute it or withdraw the decision so it stops sitting in limbo.',
  awaiting:
    'Approved recently and pending execution. Normal state — no action needed yet.',
  unmatched:
    'Approved 30+ days ago with no matching trade on the book. Either execute it or mark it withdrawn so Outcomes stops flagging it.',
  needs_review:
    'The trade executed but no rationale was captured. Add the missing context so Tesseract can interpret why you made the call.',
  evaluate:
    'Tesseract is monitoring this decision. Add a short reflection when you have a view on whether the thesis played out.',
  rejected:
    'The decision was rejected at approval. No trade was made — kept on the log for accountability.',
  withdrawn:
    'The decision was cancelled before execution. No trade was made.',
  discretionary:
    'A trade was made without going through the decision process. Add a rationale to bring it into the accountability loop.',
}

export const VERDICT_DISPLAY: Record<DecisionVerdict, {
  label: string
  color: string
  bgColor: string
  borderColor: string
}> = {
  working:       { label: 'Working',       color: 'text-emerald-700', bgColor: 'bg-emerald-50',  borderColor: 'border-l-emerald-400' },
  resolved:      { label: 'Reviewed',      color: 'text-emerald-700', bgColor: 'bg-emerald-50',  borderColor: 'border-l-emerald-300' },
  hurting:       { label: 'Hurting',       color: 'text-red-700',     bgColor: 'bg-red-50',      borderColor: 'border-l-red-500' },
  stalled:       { label: 'Stalled',       color: 'text-amber-700',   bgColor: 'bg-amber-50',    borderColor: 'border-l-amber-400' },
  awaiting:      { label: 'Awaiting',      color: 'text-blue-600',    bgColor: 'bg-blue-50',     borderColor: 'border-l-blue-300' },
  unmatched:     { label: 'Unmatched',     color: 'text-red-600',     bgColor: 'bg-red-50',      borderColor: 'border-l-red-400' },
  needs_review:  { label: 'Needs Context', color: 'text-orange-700',  bgColor: 'bg-orange-50',   borderColor: 'border-l-orange-400' },
  evaluate:      { label: 'Monitoring',    color: 'text-blue-700',    bgColor: 'bg-blue-50',     borderColor: 'border-l-blue-400' },
  rejected:      { label: 'Rejected',      color: 'text-gray-500',    bgColor: 'bg-gray-100',    borderColor: 'border-l-gray-300' },
  withdrawn:     { label: 'Withdrawn',     color: 'text-gray-400',    bgColor: 'bg-gray-50',     borderColor: 'border-l-gray-200' },
  discretionary: { label: 'Ad Hoc',        color: 'text-violet-700',  bgColor: 'bg-violet-50',   borderColor: 'border-l-violet-400' },
}

// ─── Formatting helpers ───────────────────────────────────────

/** Format the signed dollar impact (`impact_proxy`) compact. Returns
 *  null when magnitude is tiny so the label doesn't carry a noisy
 *  "+$12" tail for effectively-zero P&L. Sign matches the move — if
 *  the move helped, dollars read as positive; if the move hurt, negative. */
function formatImpactDollars(impact: number | null | undefined, movePositive: boolean): string | null {
  if (impact == null || !Number.isFinite(impact)) return null
  const magnitude = Math.abs(impact)
  if (magnitude < 100) return null
  const sign = movePositive ? '+' : '−'
  if (magnitude >= 1_000_000) return `${sign}$${(magnitude / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1_000) return `${sign}$${(magnitude / 1_000).toFixed(0)}K`
  return `${sign}$${Math.round(magnitude)}`
}

// ─── Per-Row Intelligence ─────────────────────────────────────

export function inferDecisionIntelligence(row: AccountabilityRow): DecisionIntelligence {
  // `move_since_decision_pct` and `move_since_execution_pct` are ALREADY
  // directionalized by `computeDirectionalMove` at source: positive means
  // the price moved favorably for the decision's direction (rose for a
  // buy/add, fell for a sell/trim), negative means it moved against.
  // Do NOT re-directionalize here — doing so double-negated bearish
  // decisions and flipped "Helping" / "Hurting" labels. The raw bullish/
  // bearish signal is already baked in.
  const move = row.move_since_decision_pct
  const execMove = row.move_since_execution_pct
  const bestMove = move ?? execMove
  const directionalMove = bestMove
  const reviewState = getReviewState(row)
  const lagDays = row.execution_lag_days ?? row.days_since_decision ?? 0
  const decisionAge = row.days_since_decision ?? 0
  const ageSeverity: DecisionIntelligence['ageSeverity'] = decisionAge > 21 ? 'overdue' : decisionAge > 7 ? 'aging' : 'fresh'

  // Format result label — sign reflects whether the move helped (+) or
  // hurt (−) the decision, matching what resultDirection conveys. We
  // also append the dollar impact when `impact_proxy` is available so
  // the PM sees P&L in cash terms, not just a percentage. When there's
  // no reliable price move the cell stays blank (honest "we don't know
  // yet") rather than showing a trade-size substitute that reads like
  // a P&L number and confuses the user.
  let resultLabel: string | null = null
  let resultDirection: DecisionIntelligence['resultDirection'] = null
  if (bestMove != null) {
    const pctSign = bestMove >= 0 ? '+' : ''
    const pctPart = `${pctSign}${bestMove.toFixed(1)}%`
    const dollarPart = formatImpactDollars(row.impact_proxy, bestMove >= 0)
    resultLabel = dollarPart ? `${pctPart} · ${dollarPart}` : pctPart
    resultDirection = directionalMove != null
      ? directionalMove > 0.5
        ? 'positive'
        : directionalMove < -0.5
          ? 'negative'
          : 'neutral'
      : null
  }

  // ── Discretionary trade (no decision backing it)
  if (row.source === 'discretionary') {
    return {
      verdict: 'discretionary',
      verdictLabel: 'Ad Hoc Trade',
      primaryIssue: 'Trade made outside decision process',
      actionNeeded: reviewState === 'needs_review' ? 'Add rationale' : null,
      urgency: reviewState === 'needs_review' ? 'medium' : 'low',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity: null,
    }
  }

  // ── Rejected
  if (row.stage === 'rejected') {
    const sym = row.asset_symbol || 'Stock'
    let issue: string
    if (directionalMove != null && directionalMove > 2) issue = `${sym} moved ${bestMove != null && bestMove >= 0 ? '+' : ''}${bestMove?.toFixed(1)}% — would have been right`
    else if (directionalMove != null && directionalMove < -2) issue = `Rejection avoided a loss — ${sym} down since`
    else issue = `${sym} flat since rejection`
    return {
      verdict: 'rejected',
      verdictLabel: 'Rejected',
      primaryIssue: issue,
      actionNeeded: null,
      urgency: 'none',
      resultLabel: bestMove != null ? `${bestMove >= 0 ? '+' : ''}${bestMove.toFixed(1)}%` : null,
      resultDirection,
      ageDays: decisionAge, ageSeverity: null,
    }
  }

  // ── Cancelled / Withdrawn
  if (row.stage === 'cancelled') {
    return {
      verdict: 'withdrawn',
      verdictLabel: 'Withdrawn',
      primaryIssue: 'Idea withdrawn before decision',
      actionNeeded: null,
      urgency: 'none',
      resultLabel: null, resultDirection: null,
      ageDays: decisionAge, ageSeverity: null,
    }
  }

  // ── Approved but not executed
  if (row.execution_status === 'pending') {
    const isStalled = lagDays > 14
    const sym = row.asset_symbol || 'Stock'
    let issue: string
    if (isStalled && bestMove != null && Math.abs(bestMove) > 1) {
      issue = `${sym} moved ${bestMove >= 0 ? '+' : ''}${bestMove.toFixed(1)}% while stalled`
    } else if (isStalled) {
      issue = `Not executed — capital not deployed`
    } else {
      issue = `Awaiting trade execution`
    }
    return {
      verdict: isStalled ? 'stalled' : 'awaiting',
      verdictLabel: isStalled ? 'Stalled' : 'Awaiting Execution',
      primaryIssue: issue,
      actionNeeded: isStalled ? 'Execute or cancel' : null,
      urgency: isStalled ? (lagDays > 30 ? 'critical' : 'high') : 'low',
      resultLabel: bestMove != null ? `${bestMove >= 0 ? '+' : ''}${bestMove.toFixed(1)}% missed` : 'Pending',
      resultDirection: directionalMove != null && directionalMove > 1 ? 'negative' : null,
      ageDays: lagDays, ageSeverity,
    }
  }

  // ── Approved but unmatched (30d+ with no trade)
  if (row.execution_status === 'unmatched') {
    return {
      verdict: 'unmatched',
      verdictLabel: 'Unmatched',
      primaryIssue: bestMove != null ? `${row.asset_symbol || 'Stock'} moved ${bestMove >= 0 ? '+' : ''}${bestMove.toFixed(1)}% — no matched trade` : 'No matching trade found',
      actionNeeded: 'Match trade or mark skipped',
      urgency: 'high',
      resultLabel: bestMove != null ? `${bestMove >= 0 ? '+' : ''}${bestMove.toFixed(1)}% missed` : null,
      resultDirection,
      ageDays: decisionAge, ageSeverity: 'overdue',
    }
  }

  // ── Executed — determine quality.
  // Working/Hurting verdicts claim the decision is "playing out" one way
  // or the other, which requires enough elapsed time for price movement
  // to be meaningful. On day-0 (same-session trades) a noisy stale-price
  // comparison can produce a huge directional move that misrepresents
  // reality. Require at least one full day of age before claiming a
  // positive or negative verdict — younger trades stay "Executed" and
  // the result number speaks for itself.
  const MIN_DAYS_FOR_VERDICT = 1
  const hasMeaningfulAge = decisionAge >= MIN_DAYS_FOR_VERDICT
  const isPositive = hasMeaningfulAge && resultDirection === 'positive'
  const isNegative = hasMeaningfulAge && resultDirection === 'negative'

  // ── Decision-quality gate ────────────────────────────────────
  // Three explicit states drive the badge so the PM sees a clear next
  // step instead of one generic "needs review" label:
  //   needs_review = no rationale captured → "Explain decision"
  //   evaluate     = rationale exists but no quality eval → "Evaluate decision"
  //   reviewed     = quality + thesis + sizing assessed → "Reviewed"
  // Negative-outcome rows still escalate to 'hurting' so the impact
  // signal isn't drowned out by the workflow signal.

  // No rationale at all — the entry-level gap. The badge label
  // stays short ("Needs Context" / "Hurting") for the table; the
  // diagnostic sub-reason rides on `primaryIssue` so the Insight
  // column tells the PM *why* this row is flagged, not just that
  // it is. A negative outcome still escalates to 'hurting' so the
  // impact signal leads.
  if (reviewState === 'needs_review') {
    const move = row.move_since_decision_pct
    const moveMag = move != null ? Math.abs(move) : 0
    const sym = row.asset_symbol || 'this'
    const dir = String(row.direction || '').toLowerCase()
    const isIncrease = dir === 'buy' || dir === 'add' || dir === 'initiate' || dir === 'increase'
    const isReduce = dir === 'sell' || dir === 'trim' || dir === 'exit' || dir === 'reduce'
    const verb = isIncrease ? (dir === 'buy' || dir === 'initiate' ? `Bought ${sym}` : `Added to ${sym}`)
              : isReduce   ? (dir === 'sell' || dir === 'exit' ? `Sold ${sym}` : `Trimmed ${sym}`)
              : sym
    // STATE in the table reads as a multi-factor diagnosis:
    // action verb + symbol leads, sub-tag captures the result-tier
    // interpretation (skill vs timing, diverging, weakness, etc.).
    // The right-panel INSIGHT covers WHAT it means in full — these
    // two surfaces complement, not duplicate.
    let subtag: string
    if (move != null && move <= -5) {
      subtag = isReduce ? 'risk reduced before weakness' : 'outcome diverging materially'
    } else if (move != null && move >= 5) {
      subtag = isReduce ? 'upside left on the table' : 'strong outcome — skill or timing?'
    } else if (move != null && move <= -1.5) {
      subtag = isReduce ? 'early move favours the trim' : 'early move against the call'
    } else if (move != null && move >= 1.5) {
      subtag = isReduce ? 'upside continuing — re-entry?' : 'early signal favours the call'
    } else if (decisionAge < 7) {
      subtag = 'capture reasoning while it\'s fresh'
    } else if (resultDirection === 'positive' || resultDirection === 'negative') {
      subtag = 'outcome forming — capture rationale'
    } else {
      subtag = 'no reasoning recorded'
    }
    return {
      verdict: isNegative ? 'hurting' : 'needs_review',
      verdictLabel: isNegative ? 'Hurting' : 'Needs Context',
      primaryIssue: `${verb} — ${subtag}`,
      actionNeeded: 'Add context',
      urgency: isNegative ? 'critical' : 'medium',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity,
    }
  }

  // Negative outcome with rationale captured — surface as 'hurting'
  // regardless of whether the user has reflected. Action shifts from
  // "review outcome" → "view review" once they've reflected.
  if (isNegative) {
    return {
      verdict: 'hurting',
      verdictLabel: 'Hurting',
      primaryIssue: `${row.asset_symbol || 'Position'} moving against thesis`,
      actionNeeded: reviewState !== 'reviewed' ? 'Review outcome' : 'View review',
      urgency: reviewState !== 'reviewed' ? 'high' : 'medium',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity,
    }
  }

  // Reviewed — the user has captured a reflection (thesis_played_out
  // or process note). Tesseract has the context it needs to feed
  // this back into scorecards.
  if (reviewState === 'reviewed') {
    return {
      verdict: 'resolved',
      verdictLabel: 'Reviewed',
      primaryIssue: '',
      actionNeeded: 'View review',
      urgency: 'none',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity: null,
    }
  }

  // Rationale exists but the user hasn't reflected on the outcome
  // yet. We call this "Monitoring" — Tesseract is still observing,
  // waiting for the PM's view on whether the thesis played out.
  if (reviewState === 'in_progress' || reviewState === 'captured') {
    return {
      verdict: 'evaluate',
      verdictLabel: 'Monitoring',
      primaryIssue: '',
      actionNeeded: 'Review outcome',
      urgency: 'medium',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity,
    }
  }

  // Executed without a positive-or-negative signal — could be neutral
  // ("flat since execution") or we simply don't have reliable price
  // data yet. Either way, calling this "Working" is too confident —
  // "Working" implies the thesis is playing out. Downgrade to a
  // neutral "Executed" verdict when there's no directional signal.
  const hasSignal = resultDirection === 'positive' || resultDirection === 'negative'
  const sym = row.asset_symbol || 'Position'
  const needsCapture = reviewState !== 'captured' && reviewState !== 'reviewed'

  if (hasSignal && isPositive) {
    return {
      verdict: 'working',
      verdictLabel: 'Working',
      primaryIssue: '',
      actionNeeded: needsCapture ? 'Capture rationale' : 'Review why this worked',
      urgency: 'none',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity: null,
    }
  }

  // Executed with no directional signal — neutral state. The "Issue"
  // column is reserved for actual problems; a quietly-executed trade
  // doesn't belong there. Leave primaryIssue blank.
  return {
    verdict: 'working',
    verdictLabel: 'Executed',
    primaryIssue: '',
    actionNeeded: needsCapture ? 'Capture rationale' : null,
    urgency: 'none',
    resultLabel, resultDirection,
    ageDays: decisionAge, ageSeverity: null,
  }
}

function getReviewState(row: AccountabilityRow): 'needs_review' | 'in_progress' | 'captured' | 'reviewed' | null {
  if (row.execution_status !== 'executed') return null
  if (row.matched_executions.some(e => e.rationale_status === 'reviewed')) return 'reviewed'
  if (row.matched_executions.some(e => e.rationale_status === 'complete')) return 'captured'
  if (row.matched_executions.some(e => e.has_rationale)) return 'in_progress'
  return 'needs_review'
}

// ─── Live Process Health Summary ──────────────────────────────

export type ProcessHealthLevel = 'healthy' | 'attention' | 'degraded' | 'critical'

export interface ProcessFlowStage {
  label: string
  count: number
  rate: number | null // conversion rate from previous stage
  status: 'strong' | 'adequate' | 'weak' | 'failing'
}

export interface ProcessHealth {
  level: ProcessHealthLevel
  headline: string
  narrative: string // longer explanation
  primaryBreakdown: string | null
  recommendations: string[]
  flow: ProcessFlowStage[] // the pipeline stages
  counts: {
    total: number
    working: number
    hurting: number
    stalled: number
    unmatched: number
    needsReview: number
    /** Rationale captured but no decision-quality evaluation yet. */
    needsEvaluation: number
    discretionary: number
    awaiting: number
    rejected: number
    withdrawn: number
    approved: number
    executed: number
    resolved: number
  }
}

export const HEALTH_DISPLAY: Record<ProcessHealthLevel, { label: string; color: string; bgColor: string; borderColor: string }> = {
  healthy:   { label: 'Healthy',   color: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200' },
  attention: { label: 'Attention', color: 'text-amber-700',   bgColor: 'bg-amber-50',   borderColor: 'border-amber-200' },
  degraded:  { label: 'Degraded',  color: 'text-orange-700',  bgColor: 'bg-orange-50',  borderColor: 'border-orange-200' },
  critical:  { label: 'Critical',  color: 'text-red-700',     bgColor: 'bg-red-50',     borderColor: 'border-red-300' },
}

export function buildProcessHealth(rows: AccountabilityRow[]): ProcessHealth {
  const intels = rows.map(r => ({ row: r, intel: inferDecisionIntelligence(r) }))

  // Pipeline counts
  const decisionRows = rows.filter(r => r.source !== 'discretionary')
  const approvedRows = decisionRows.filter(r => r.stage === 'approved')
  const executedRows = approvedRows.filter(r => r.execution_status === 'executed' || r.execution_status === 'possible_match')
  const resolvedPositive = intels.filter(i => i.intel.verdict === 'working' || i.intel.verdict === 'resolved').length

  const counts = {
    total: rows.length,
    working: intels.filter(i => i.intel.verdict === 'working' || i.intel.verdict === 'resolved').length,
    hurting: intels.filter(i => i.intel.verdict === 'hurting').length,
    stalled: intels.filter(i => i.intel.verdict === 'stalled').length,
    unmatched: intels.filter(i => i.intel.verdict === 'unmatched').length,
    needsReview: intels.filter(i => i.intel.verdict === 'needs_review').length,
    needsEvaluation: intels.filter(i => i.intel.verdict === 'evaluate').length,
    discretionary: intels.filter(i => i.intel.verdict === 'discretionary').length,
    awaiting: intels.filter(i => i.intel.verdict === 'awaiting').length,
    rejected: intels.filter(i => i.intel.verdict === 'rejected').length,
    withdrawn: intels.filter(i => i.intel.verdict === 'withdrawn').length,
    approved: approvedRows.length,
    executed: executedRows.length,
    resolved: resolvedPositive,
  }

  const urgentCount = intels.filter(i => i.intel.urgency === 'critical' || i.intel.urgency === 'high').length
  const problemCount = counts.hurting + counts.stalled + counts.unmatched + counts.needsReview + counts.needsEvaluation

  // Health level
  let level: ProcessHealthLevel = 'healthy'
  if (urgentCount > 0 || counts.hurting > 2) level = 'critical'
  else if (problemCount > counts.working && counts.total > 3) level = 'degraded'
  else if (problemCount > 0) level = 'attention'

  // Primary breakdown
  const breakdowns = [
    { area: 'Execution', score: counts.stalled + counts.awaiting },
    { area: 'Outcome quality', score: counts.hurting * 2 },
    { area: 'Review discipline', score: counts.needsReview + counts.needsEvaluation },
    { area: 'Trade matching', score: counts.unmatched * 2 },
  ].filter(b => b.score > 0).sort((a, b) => b.score - a.score)
  const primaryBreakdown = breakdowns.length > 0 ? breakdowns[0].area : null

  // Process flow pipeline
  const execRate = counts.approved > 0 ? (counts.executed / counts.approved) * 100 : null
  const outcomeRate = counts.executed > 0 ? (counts.resolved / counts.executed) * 100 : null

  const flow: ProcessFlowStage[] = [
    {
      label: 'Approved', count: counts.approved, rate: null,
      status: counts.approved > 0 ? 'strong' : 'adequate',
    },
    {
      label: 'Executed', count: counts.executed, rate: execRate,
      status: execRate == null ? 'adequate' : execRate >= 75 ? 'strong' : execRate >= 50 ? 'adequate' : execRate >= 25 ? 'weak' : 'failing',
    },
    {
      label: 'Positive', count: counts.resolved, rate: outcomeRate,
      status: outcomeRate == null ? 'adequate' : outcomeRate >= 60 ? 'strong' : outcomeRate >= 40 ? 'adequate' : 'weak',
    },
  ]

  // Headline + Narrative
  let headline: string
  let narrative: string
  if (counts.total === 0) {
    headline = 'No decisions to monitor.'
    narrative = ''
  } else if (level === 'healthy') {
    headline = 'Decision process is operating normally.'
    narrative = `${counts.working} decision${counts.working !== 1 ? 's' : ''} working as intended.`
  } else if (primaryBreakdown === 'Execution') {
    headline = 'Execution breakdown — approvals are not converting into portfolio action.'
    narrative = `${counts.stalled + counts.awaiting} decision${counts.stalled + counts.awaiting !== 1 ? 's are' : ' is'} pending execution.${counts.stalled > 0 ? ` ${counts.stalled} stalled beyond 14 days.` : ''}`
  } else if (primaryBreakdown === 'Outcome quality') {
    headline = 'Outcome quality problem — executed decisions are underperforming.'
    narrative = `${counts.hurting} decision${counts.hurting !== 1 ? 's are' : ' is'} hurting the portfolio.${counts.needsReview > 0 ? ` ${counts.needsReview} need review.` : ''}`
  } else if (primaryBreakdown === 'Review discipline') {
    headline = 'Your decisions aren\'t being fully reviewed.'
    narrative = counts.needsEvaluation > 0
      ? `Tesseract can track what happened and surface what to consider, but ${counts.needsReview} decision${counts.needsReview !== 1 ? 's are' : ' is'} missing context and ${counts.needsEvaluation} ${counts.needsEvaluation !== 1 ? 'are' : 'is'} still being monitored — missing reflection makes the feedback loop weaker.`
      : `Tesseract can track what happened and surface what to consider, but ${counts.needsReview} decision${counts.needsReview !== 1 ? 's are' : ' is'} missing context — missing reflection makes the feedback loop weaker.`
  } else if (primaryBreakdown === 'Trade matching') {
    headline = 'Trade matching problem — approved decisions have no matched trades.'
    narrative = `${counts.unmatched} decision${counts.unmatched !== 1 ? 's' : ''} unmatched after 30+ days.`
  } else {
    headline = `${problemCount} decision${problemCount !== 1 ? 's' : ''} need attention.`
    narrative = 'Multiple areas need intervention.'
  }

  // Recommendations — order by sequence the PM actually performs:
  // first add context to bare decisions, then review monitored ones,
  // then chase down execution/matching gaps.
  const recommendations: string[] = []
  if (counts.needsReview > 0) recommendations.push(`Add context to ${counts.needsReview} decision${counts.needsReview !== 1 ? 's' : ''}`)
  if (counts.needsEvaluation > 0) recommendations.push(`Review ${counts.needsEvaluation} outcome${counts.needsEvaluation !== 1 ? 's' : ''}`)
  if (counts.stalled > 0) recommendations.push(`Execute or cancel ${counts.stalled} stalled approval${counts.stalled !== 1 ? 's' : ''}`)
  if (counts.unmatched > 0) recommendations.push(`Resolve ${counts.unmatched} unmatched trade${counts.unmatched !== 1 ? 's' : ''}`)
  if (counts.discretionary > 0) recommendations.push(`Add context to ${counts.discretionary} discretionary trade${counts.discretionary !== 1 ? 's' : ''}`)

  return { level, headline, narrative, primaryBreakdown, recommendations: recommendations.slice(0, 3), flow, counts }
}

// ─── Smart Chip Definitions ──────────────────────────────────

export interface SmartChip {
  key: string
  label: string
  count: number
  color: string
  bgColor: string
  activeColor: string
  icon: 'alert' | 'clock' | 'check' | 'link' | 'pencil' | 'zap' | 'target' | 'trending-down'
  filterFn: (intel: DecisionIntelligence) => boolean
}

export function buildSmartChips(counts: ProcessHealth['counts']): SmartChip[] {
  return [
    {
      key: 'all', label: 'all', count: counts.total,
      color: 'text-gray-600', bgColor: 'bg-white', activeColor: 'border-gray-400 bg-gray-100 text-gray-800',
      icon: 'target', filterFn: () => true,
    },
    {
      key: 'hurting', label: 'hurting', count: counts.hurting,
      color: 'text-red-700', bgColor: 'bg-red-50', activeColor: 'border-red-300 bg-red-100 text-red-800',
      icon: 'trending-down', filterFn: i => i.verdict === 'hurting',
    },
    {
      key: 'stalled', label: 'stalled', count: counts.stalled + counts.awaiting,
      color: 'text-amber-700', bgColor: 'bg-amber-50', activeColor: 'border-amber-300 bg-amber-100 text-amber-800',
      icon: 'clock', filterFn: i => i.verdict === 'stalled' || i.verdict === 'awaiting',
    },
    {
      key: 'unmatched', label: 'unmatched', count: counts.unmatched,
      color: 'text-red-600', bgColor: 'bg-red-50', activeColor: 'border-red-300 bg-red-100 text-red-800',
      icon: 'link', filterFn: i => i.verdict === 'unmatched',
    },
    {
      key: 'review', label: 'needs context', count: counts.needsReview,
      color: 'text-orange-700', bgColor: 'bg-orange-50', activeColor: 'border-orange-300 bg-orange-100 text-orange-800',
      icon: 'pencil', filterFn: i => i.verdict === 'needs_review',
    },
    {
      key: 'evaluate', label: 'monitoring', count: counts.needsEvaluation,
      color: 'text-blue-700', bgColor: 'bg-blue-50', activeColor: 'border-blue-300 bg-blue-100 text-blue-800',
      icon: 'pencil', filterFn: i => i.verdict === 'evaluate',
    },
    {
      key: 'working', label: 'working', count: counts.working,
      color: 'text-emerald-700', bgColor: 'bg-emerald-50', activeColor: 'border-emerald-300 bg-emerald-100 text-emerald-800',
      icon: 'check', filterFn: i => i.verdict === 'working' || i.verdict === 'resolved',
    },
    {
      key: 'discretionary', label: 'ad hoc', count: counts.discretionary,
      color: 'text-violet-700', bgColor: 'bg-violet-50', activeColor: 'border-violet-300 bg-violet-100 text-violet-800',
      icon: 'zap', filterFn: i => i.verdict === 'discretionary',
    },
    {
      key: 'rejected', label: 'rejected', count: counts.rejected,
      color: 'text-gray-500', bgColor: 'bg-gray-50', activeColor: 'border-gray-300 bg-gray-100 text-gray-800',
      icon: 'target', filterFn: i => i.verdict === 'rejected',
    },
    {
      key: 'withdrawn', label: 'withdrawn', count: counts.withdrawn,
      color: 'text-gray-400', bgColor: 'bg-gray-50', activeColor: 'border-gray-300 bg-gray-100 text-gray-700',
      icon: 'target', filterFn: i => i.verdict === 'withdrawn',
    },
  ]
}
