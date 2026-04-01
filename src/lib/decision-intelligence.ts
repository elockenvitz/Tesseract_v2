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
  | 'working'       // executed, positive/neutral outcome
  | 'hurting'       // executed, negative outcome
  | 'stalled'       // approved but not executed, aging
  | 'awaiting'      // approved recently, normal pending
  | 'unmatched'     // approved 30d+ with no trade
  | 'needs_review'  // executed but no post-mortem
  | 'rejected'      // decision was rejected
  | 'withdrawn'     // decision was cancelled
  | 'discretionary' // trade without decision
  | 'resolved'      // healthy, review complete

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

export const VERDICT_DISPLAY: Record<DecisionVerdict, {
  label: string
  color: string
  bgColor: string
  borderColor: string
}> = {
  working:       { label: 'Working',       color: 'text-emerald-700', bgColor: 'bg-emerald-50',  borderColor: 'border-l-emerald-400' },
  resolved:      { label: 'Resolved',      color: 'text-emerald-600', bgColor: 'bg-emerald-50',  borderColor: 'border-l-emerald-300' },
  hurting:       { label: 'Hurting',       color: 'text-red-700',     bgColor: 'bg-red-50',      borderColor: 'border-l-red-500' },
  stalled:       { label: 'Stalled',       color: 'text-amber-700',   bgColor: 'bg-amber-50',    borderColor: 'border-l-amber-400' },
  awaiting:      { label: 'Awaiting',      color: 'text-blue-600',    bgColor: 'bg-blue-50',     borderColor: 'border-l-blue-300' },
  unmatched:     { label: 'Unmatched',     color: 'text-red-600',     bgColor: 'bg-red-50',      borderColor: 'border-l-red-400' },
  needs_review:  { label: 'Needs Review',  color: 'text-orange-700',  bgColor: 'bg-orange-50',   borderColor: 'border-l-orange-400' },
  rejected:      { label: 'Rejected',      color: 'text-gray-500',    bgColor: 'bg-gray-100',    borderColor: 'border-l-gray-300' },
  withdrawn:     { label: 'Withdrawn',     color: 'text-gray-400',    bgColor: 'bg-gray-50',     borderColor: 'border-l-gray-200' },
  discretionary: { label: 'Ad Hoc',        color: 'text-violet-700',  bgColor: 'bg-violet-50',   borderColor: 'border-l-violet-400' },
}

// ─── Per-Row Intelligence ─────────────────────────────────────

export function inferDecisionIntelligence(row: AccountabilityRow): DecisionIntelligence {
  const move = row.move_since_decision_pct
  const execMove = row.move_since_execution_pct
  const bestMove = move ?? execMove
  const isBullish = row.direction === 'buy' || row.direction === 'add' || row.direction === 'long'
  const directionalMove = bestMove != null ? (isBullish ? bestMove : -bestMove) : null
  const reviewState = getReviewState(row)
  const lagDays = row.execution_lag_days ?? row.days_since_decision ?? 0
  const decisionAge = row.days_since_decision ?? 0
  const ageSeverity: DecisionIntelligence['ageSeverity'] = decisionAge > 21 ? 'overdue' : decisionAge > 7 ? 'aging' : 'fresh'

  // Format result label
  let resultLabel: string | null = null
  let resultDirection: DecisionIntelligence['resultDirection'] = null
  if (bestMove != null) {
    resultLabel = `${bestMove >= 0 ? '+' : ''}${bestMove.toFixed(1)}%`
    resultDirection = directionalMove != null ? (directionalMove > 0.5 ? 'positive' : directionalMove < -0.5 ? 'negative' : 'neutral') : null
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

  // ── Executed — determine quality
  const isPositive = resultDirection === 'positive'
  const isNegative = resultDirection === 'negative'

  // Check review state
  if (reviewState === 'needs_review') {
    return {
      verdict: isNegative ? 'hurting' : 'needs_review',
      verdictLabel: isNegative ? 'Hurting' : 'Needs Review',
      primaryIssue: isNegative
        ? `${row.asset_symbol || 'Stock'} ${resultLabel || 'down'} — review missing`
        : 'Executed — post-mortem not captured',
      actionNeeded: 'Complete review',
      urgency: isNegative ? 'critical' : 'medium',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity,
    }
  }

  // Executed with negative outcome
  if (isNegative) {
    return {
      verdict: 'hurting',
      verdictLabel: 'Hurting',
      primaryIssue: `${row.asset_symbol || 'Position'} moving against thesis`,
      actionNeeded: reviewState !== 'reviewed' ? 'Review outcome' : null,
      urgency: reviewState !== 'reviewed' ? 'high' : 'medium',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity,
    }
  }

  // Executed with positive outcome and review complete
  if (reviewState === 'reviewed') {
    return {
      verdict: 'resolved',
      verdictLabel: 'Resolved',
      primaryIssue: `${row.asset_symbol || 'Position'} working — review complete`,
      actionNeeded: null,
      urgency: 'none',
      resultLabel, resultDirection,
      ageDays: decisionAge, ageSeverity: null,
    }
  }

  // Executed, working
  return {
    verdict: 'working',
    verdictLabel: 'Working',
    primaryIssue: isPositive ? `${row.asset_symbol || 'Position'} moving in the right direction` : `${row.asset_symbol || 'Position'} flat since execution`,
    actionNeeded: reviewState !== 'captured' && reviewState !== 'reviewed' ? 'Capture rationale' : null,
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
    discretionary: number
    awaiting: number
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
    discretionary: intels.filter(i => i.intel.verdict === 'discretionary').length,
    awaiting: intels.filter(i => i.intel.verdict === 'awaiting').length,
    rejected: intels.filter(i => i.intel.verdict === 'rejected').length,
    withdrawn: intels.filter(i => i.intel.verdict === 'withdrawn').length,
    approved: approvedRows.length,
    executed: executedRows.length,
    resolved: resolvedPositive,
  }

  const urgentCount = intels.filter(i => i.intel.urgency === 'critical' || i.intel.urgency === 'high').length
  const problemCount = counts.hurting + counts.stalled + counts.unmatched + counts.needsReview

  // Health level
  let level: ProcessHealthLevel = 'healthy'
  if (urgentCount > 0 || counts.hurting > 2) level = 'critical'
  else if (problemCount > counts.working && counts.total > 3) level = 'degraded'
  else if (problemCount > 0) level = 'attention'

  // Primary breakdown
  const breakdowns = [
    { area: 'Execution', score: counts.stalled + counts.awaiting },
    { area: 'Outcome quality', score: counts.hurting * 2 },
    { area: 'Review discipline', score: counts.needsReview },
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
    headline = 'Review discipline gap — executed trades lack post-mortem.'
    narrative = `${counts.needsReview} executed decision${counts.needsReview !== 1 ? 's' : ''} missing rationale capture.`
  } else if (primaryBreakdown === 'Trade matching') {
    headline = 'Trade matching problem — approved decisions have no matched trades.'
    narrative = `${counts.unmatched} decision${counts.unmatched !== 1 ? 's' : ''} unmatched after 30+ days.`
  } else {
    headline = `${problemCount} decision${problemCount !== 1 ? 's' : ''} need attention.`
    narrative = 'Multiple areas need intervention.'
  }

  // Recommendations
  const recommendations: string[] = []
  if (counts.stalled > 0) recommendations.push(`Execute or cancel ${counts.stalled} stalled approval${counts.stalled !== 1 ? 's' : ''}`)
  if (counts.hurting > 0 && counts.needsReview > 0) recommendations.push(`Review ${counts.needsReview} decision${counts.needsReview !== 1 ? 's' : ''} with missing post-mortem`)
  else if (counts.needsReview > 0) recommendations.push(`Complete ${counts.needsReview} post-mortem review${counts.needsReview !== 1 ? 's' : ''}`)
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
      key: 'review', label: 'needs review', count: counts.needsReview,
      color: 'text-orange-700', bgColor: 'bg-orange-50', activeColor: 'border-orange-300 bg-orange-100 text-orange-800',
      icon: 'pencil', filterFn: i => i.verdict === 'needs_review',
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
