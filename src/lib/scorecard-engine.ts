/**
 * Scorecard Interpretation Engine
 *
 * Transforms raw scorecard metrics into verdicts, flags, diagnostics,
 * behavioral insights, process breakdown analysis, recommended focus,
 * and outcome snapshots.
 *
 * This is the judgment layer — it takes data and produces institutional-grade
 * performance evaluation with actionable coaching.
 */

import type { AnalystScorecardData, PMScorecardData } from '../hooks/useScorecards'

// ─── Core Types ───────────────────────────────────────────────

export type Verdict = 'elite' | 'strong' | 'solid' | 'mixed' | 'developing' | 'weak' | 'critical' | 'insufficient'
export type Confidence = 'high' | 'moderate' | 'low' | 'insufficient'

export interface ScorecardVerdict {
  score: number
  verdict: Verdict
  confidence: Confidence
  headline: string
  interpretation: string
  flags: ScorecardFlag[]
  focus: string[]
}

export interface ScorecardFlag {
  label: string
  type: 'strength' | 'weakness' | 'warning' | 'info'
}

export interface OutcomeSnapshot {
  winners: number
  losers: number
  winRate: number | null
  avgMovePct: number | null
  totalDecisions: number
  executedDecisions: number
  pendingDecisions: number
  avgDelayCostBps: number | null
  summaryText: string
}

export interface ProcessStage {
  id: string
  label: string
  status: 'strong' | 'adequate' | 'weak' | 'failing' | 'unmeasurable'
  score: number | null
}

export interface ProcessBreakdown {
  stages: ProcessStage[]
  failurePoint: string | null
  failureSummary: string | null
}

export interface DiagnosticPillar {
  id: string
  title: string
  score: number | null
  strength: 'Strong' | 'Adequate' | 'Weak' | 'Critical' | 'Not yet measurable'
  metrics: { label: string; value: string }[]
  takeaway: string
  measurable: boolean
}

export interface BehaviorInsight {
  text: string
  severity: 'positive' | 'neutral' | 'negative'
}

export interface RosterEntry {
  userId: string
  name: string
  role: 'analyst' | 'pm' | 'both'
  score: number
  verdict: Verdict
  confidence: Confidence
  strongest: string | null
  weakest: string | null
  insight: string | null
  metrics: { label: string; value: string }[]
  rank: number | null
  teamContext: string | null // "#2 of 6" or "Below avg" or "Track record forming"
}

// ─── Config ───────────────────────────────────────────────────

function scoreToVerdict(score: number): Verdict {
  if (score >= 90) return 'elite'
  if (score >= 80) return 'strong'
  if (score >= 70) return 'solid'
  if (score >= 55) return 'mixed'
  if (score >= 40) return 'developing'
  if (score >= 25) return 'weak'
  return 'critical'
}

export const VERDICT_CONFIG: Record<Verdict, { label: string; color: string; bgColor: string; borderColor: string; ringColor: string }> = {
  elite:        { label: 'Elite',             color: 'text-purple-700', bgColor: 'bg-purple-50',   borderColor: 'border-purple-200',  ringColor: 'text-purple-600' },
  strong:       { label: 'Strong',            color: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200', ringColor: 'text-emerald-600' },
  solid:        { label: 'Solid',             color: 'text-blue-700',   bgColor: 'bg-blue-50',    borderColor: 'border-blue-200',    ringColor: 'text-blue-600' },
  mixed:        { label: 'Mixed',             color: 'text-amber-700',  bgColor: 'bg-amber-50',   borderColor: 'border-amber-200',   ringColor: 'text-amber-500' },
  developing:   { label: 'Developing',        color: 'text-orange-700', bgColor: 'bg-orange-50',  borderColor: 'border-orange-200',  ringColor: 'text-orange-500' },
  weak:         { label: 'Weak',              color: 'text-red-600',    bgColor: 'bg-red-50',     borderColor: 'border-red-200',     ringColor: 'text-red-500' },
  critical:     { label: 'Critical',          color: 'text-red-800',    bgColor: 'bg-red-100',    borderColor: 'border-red-400',     ringColor: 'text-red-700' },
  insufficient: { label: 'Insufficient Data', color: 'text-gray-500',   bgColor: 'bg-gray-50',    borderColor: 'border-gray-200',    ringColor: 'text-gray-300' },
}

export const CONFIDENCE_CONFIG: Record<Confidence, { label: string; color: string }> = {
  high:         { label: 'High confidence',    color: 'text-emerald-600' },
  moderate:     { label: 'Moderate confidence', color: 'text-blue-600' },
  low:          { label: 'Low confidence',     color: 'text-amber-600' },
  insufficient: { label: 'Insufficient data',  color: 'text-gray-400' },
}

function strengthLabel(score: number | null): DiagnosticPillar['strength'] {
  if (score === null) return 'Not yet measurable'
  if (score >= 75) return 'Strong'
  if (score >= 55) return 'Adequate'
  if (score >= 35) return 'Weak'
  return 'Critical'
}

function stageStatus(score: number | null): ProcessStage['status'] {
  if (score === null) return 'unmeasurable'
  if (score >= 75) return 'strong'
  if (score >= 55) return 'adequate'
  if (score >= 35) return 'weak'
  return 'failing'
}

function fmtPct(v: number | null): string { return v != null ? `${v.toFixed(0)}%` : '—' }
function fmtDays(v: number | null): string { return v != null ? `${v.toFixed(1)}d` : '—' }

// ─── Confidence ───────────────────────────────────────────────

function computeConfidence(sampleSize: number, measurablePillars: number, totalPillars: number): Confidence {
  if (sampleSize === 0) return 'insufficient'
  const coverage = totalPillars > 0 ? measurablePillars / totalPillars : 0
  if (sampleSize < 3 || coverage < 0.25) return 'insufficient'
  if (sampleSize < 5 || coverage < 0.5) return 'low'
  if (sampleSize < 15 || coverage < 0.75) return 'moderate'
  return 'high'
}

// ════════════════════════════════════════════════════════════════
// ANALYST
// ════════════════════════════════════════════════════════════════

function analystSampleSize(d: AnalystScorecardData): number {
  return d.priceTargets.total + d.ratings.totalRated + d.decisions.totalProposed
}
function analystResolvedCount(d: AnalystScorecardData): number {
  return (d.priceTargets.hit + d.priceTargets.missed) + d.ratings.totalRated + d.decisions.executedTotal
}

export function interpretAnalystScorecard(d: AnalystScorecardData | null): ScorecardVerdict {
  if (!d) return {
    score: 0, verdict: 'insufficient', confidence: 'insufficient',
    headline: 'No track record established.',
    interpretation: 'No price targets, ratings, or trade recommendations recorded. Begin setting targets and ratings to build an evaluable track record.',
    flags: [{ label: 'No activity recorded', type: 'info' }],
    focus: ['Set price targets on covered names', 'Assign ratings to build directional track record'],
  }

  const n = analystSampleSize(d)
  const resolved = analystResolvedCount(d)
  const pillars = buildAnalystPillars(d)
  const measurable = pillars.filter(p => p.measurable).length
  const score = d.compositeScore ?? 0
  const confidence = computeConfidence(n, measurable, pillars.length)
  const verdict = confidence === 'insufficient' ? 'insufficient' : scoreToVerdict(score)

  // Headline — strong, specific, executive-level
  let headline: string
  if (n === 0) headline = 'No track record established.'
  else if (resolved === 0) headline = 'Pipeline exists but no outcomes have resolved.'
  else if (verdict === 'elite') headline = 'Exceptional decision quality across all measured dimensions.'
  else if (verdict === 'strong') headline = 'Consistently strong calls with demonstrated edge.'
  else if (verdict === 'solid') headline = 'Performing well with room to sharpen conviction accuracy.'
  else if (verdict === 'mixed') headline = 'Some dimensions are working, others are not.'
  else if (verdict === 'developing') headline = 'Directional edge has not yet been demonstrated.'
  else if (verdict === 'weak') headline = 'Decision quality is below threshold across most dimensions.'
  else if (verdict === 'critical') headline = 'Persistent underperformance — process intervention required.'
  else headline = 'Too few resolved outcomes for reliable evaluation.'

  // Interpretation — consequence-driven
  const interp: string[] = []
  if (d.ratings.directionalHitRate != null) {
    interp.push(d.ratings.directionalHitRate >= 60
      ? `Directional instincts are sound (${d.ratings.directionalHitRate.toFixed(0)}% accuracy on ${d.ratings.totalRated} rated names)`
      : `Directional calls are inconsistent (${d.ratings.directionalHitRate.toFixed(0)}% accuracy) — ideas may be reaching the portfolio without sufficient edge`)
  }
  if (d.priceTargets.hitRate != null && d.priceTargets.hit + d.priceTargets.missed >= 2) {
    interp.push(d.priceTargets.hitRate >= 55
      ? `target accuracy at ${d.priceTargets.hitRate.toFixed(0)}%`
      : `targets hitting at only ${d.priceTargets.hitRate.toFixed(0)}% — conviction levels may be miscalibrated`)
  }
  if (d.decisions.executedTotal > 0 && d.decisions.executedHitRate != null) {
    interp.push(d.decisions.executedHitRate >= 55
      ? 'approved recommendations are generating positive outcomes'
      : 'approved recommendations are underperforming — thesis quality needs review')
  }
  let interpretation = interp.length > 0
    ? interp[0].charAt(0).toUpperCase() + interp[0].slice(1) + (interp.length > 1 ? '. ' + interp.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('. ') : '') + '.'
    : resolved === 0
      ? `${n} items in pipeline but none resolved. Cannot assess quality until outcomes materialize.`
      : 'Not enough resolved data for reliable conclusions.'
  if (confidence === 'low' && interp.length > 0) interpretation += ' Assessment is preliminary due to limited sample.'

  // Flags
  const flags: ScorecardFlag[] = []
  if (n > 0 && resolved === 0) flags.push({ label: 'Insufficient resolved outcomes', type: 'warning' })
  else if (n > 0 && n < 5) flags.push({ label: 'Shallow track record', type: 'warning' })
  if (d.ratings.directionalHitRate != null && d.ratings.directionalHitRate >= 65 && d.ratings.totalRated >= 3) flags.push({ label: 'Directional edge present', type: 'strength' })
  if (d.ratings.directionalHitRate != null && d.ratings.directionalHitRate < 40 && d.ratings.totalRated >= 3) flags.push({ label: 'Directional edge not established', type: 'weakness' })
  if (d.priceTargets.hitRate != null && d.priceTargets.hitRate >= 65 && d.priceTargets.hit + d.priceTargets.missed >= 3) flags.push({ label: 'Strong target discipline', type: 'strength' })
  if (d.priceTargets.hitRate != null && d.priceTargets.hitRate < 35 && d.priceTargets.hit + d.priceTargets.missed >= 3) flags.push({ label: 'Target quality inconsistent', type: 'weakness' })
  if (d.priceTargets.bullishBias != null && Math.abs(d.priceTargets.bullishBias) > 12) flags.push({ label: d.priceTargets.bullishBias > 0 ? 'Persistent bullish bias' : 'Persistent bearish bias', type: 'warning' })
  if (d.decisions.executedHitRate != null && d.decisions.executedHitRate >= 65 && d.decisions.executedTotal >= 3) flags.push({ label: 'Recommendations creating value', type: 'strength' })
  if (d.decisions.executedHitRate != null && d.decisions.executedHitRate < 35 && d.decisions.executedTotal >= 3) flags.push({ label: 'Signal quality inconsistent', type: 'weakness' })
  if (d.ratings.totalRated === 0 && n > 3) flags.push({ label: 'No ratings coverage', type: 'warning' })
  if (d.priceTargets.total === 0 && n > 3) flags.push({ label: 'No price targets set', type: 'warning' })

  // Focus
  const focus: string[] = []
  if (d.ratings.totalRated === 0) focus.push('Establish directional track record with ratings')
  else if (d.ratings.directionalHitRate != null && d.ratings.directionalHitRate < 45) focus.push('Improve directional quality before adding coverage')
  if (d.priceTargets.total === 0) focus.push('Set price targets to measure conviction accuracy')
  else if (d.priceTargets.hitRate != null && d.priceTargets.hitRate < 40 && d.priceTargets.hit + d.priceTargets.missed >= 3) focus.push('Recalibrate target levels — current hit rate is too low')
  if (d.decisions.totalProposed === 0) focus.push('Propose trade ideas to demonstrate conviction')
  else if (d.decisions.executedTotal === 0 && d.decisions.approved > 0) focus.push('Ensure approved ideas reach execution')
  if (d.priceTargets.bullishBias != null && Math.abs(d.priceTargets.bullishBias) > 15) focus.push('Address systematic bias in target setting')
  if (focus.length === 0 && resolved < 10) focus.push('Build larger resolved sample for reliable evaluation')

  return { score, verdict, confidence, headline, interpretation, flags: flags.slice(0, 4), focus: focus.slice(0, 3) }
}

export function buildAnalystOutcomeSnapshot(d: AnalystScorecardData | null): OutcomeSnapshot {
  if (!d) return { winners: 0, losers: 0, winRate: null, avgMovePct: null, totalDecisions: 0, executedDecisions: 0, pendingDecisions: 0, avgDelayCostBps: null, summaryText: 'No activity recorded.' }
  const total = d.decisions.totalProposed
  const executed = d.decisions.executedTotal
  const pending = Math.max(0, d.decisions.approved - executed)
  const winners = d.decisions.executedCorrect
  const losers = executed - winners
  const winRate = executed > 0 ? (winners / executed) * 100 : null

  let summaryText: string
  if (total === 0) summaryText = 'No trade recommendations — outcome quality not assessable.'
  else if (executed === 0) summaryText = `${d.decisions.approved} approved, none executed. Outcome quality cannot be measured until recommendations reach the portfolio.`
  else summaryText = winRate != null && winRate >= 55
    ? `${winners} of ${executed} executed recommendations moved in the intended direction.`
    : `${winners} of ${executed} worked. Win rate is below institutional threshold.`

  return { winners, losers, winRate, avgMovePct: null, totalDecisions: total, executedDecisions: executed, pendingDecisions: pending, avgDelayCostBps: null, summaryText }
}

const ANALYST_SKELETON_STAGES: ProcessStage[] = [
  { id: 'direction', label: 'Direction', status: 'unmeasurable', score: null },
  { id: 'targets', label: 'Targets', status: 'unmeasurable', score: null },
  { id: 'recommendations', label: 'Recommendations', status: 'unmeasurable', score: null },
  { id: 'calibration', label: 'Calibration', status: 'unmeasurable', score: null },
]

export function buildAnalystProcessBreakdown(d: AnalystScorecardData | null): ProcessBreakdown {
  if (!d) return { stages: ANALYST_SKELETON_STAGES, failurePoint: null, failureSummary: null }

  const dirScore = d.ratings.totalRated > 0 ? d.ratings.directionalHitRate : null
  const tgtScore = d.priceTargets.hit + d.priceTargets.missed > 0 ? d.priceTargets.overallScore : null
  const recScore = d.decisions.executedTotal > 0 ? d.decisions.executedHitRate : null
  const biasScore = d.priceTargets.total >= 3 && d.priceTargets.bullishBias != null
    ? Math.max(0, 100 - Math.abs(d.priceTargets.bullishBias) * 5) : null

  const stages: ProcessStage[] = [
    { id: 'direction', label: 'Direction', status: stageStatus(dirScore), score: dirScore },
    { id: 'targets', label: 'Targets', status: stageStatus(tgtScore), score: tgtScore },
    { id: 'recommendations', label: 'Recommendations', status: stageStatus(recScore), score: recScore },
    { id: 'calibration', label: 'Calibration', status: stageStatus(biasScore), score: biasScore },
  ]

  const failing = stages.filter(s => s.status === 'failing' || s.status === 'weak')
  const failurePoint = failing.length > 0 ? failing.sort((a, b) => (a.score ?? 999) - (b.score ?? 999))[0].label : null

  const summaryMap: Record<string, string> = {
    'Direction': 'Directional calls are not demonstrating edge — ideas may lack sufficient thesis rigor.',
    'Targets': 'Price targets are not landing — conviction levels or timeframes need recalibration.',
    'Recommendations': 'Approved ideas are underperforming post-execution.',
    'Calibration': 'Systematic bias detected — targets are skewed in one direction.',
  }

  return { stages, failurePoint, failureSummary: failurePoint ? summaryMap[failurePoint] || null : null }
}

const ANALYST_SKELETON_PILLARS: DiagnosticPillar[] = [
  {
    id: 'directional', title: 'Directional Skill', score: null, strength: 'Not yet measurable', measurable: false,
    metrics: [{ label: 'Correct', value: '—' }, { label: 'Hit rate', value: '—' }],
    takeaway: 'Tracks whether your bullish/bearish calls match subsequent price direction. Needs rated ideas to measure.',
  },
  {
    id: 'targets', title: 'Target Accuracy', score: null, strength: 'Not yet measurable', measurable: false,
    metrics: [{ label: 'Resolved', value: '—' }, { label: 'Pending', value: '—' }],
    takeaway: 'Tracks whether price targets are being hit. Needs targets with resolved outcomes.',
  },
  {
    id: 'recommendations', title: 'Recommendation Outcomes', score: null, strength: 'Not yet measurable', measurable: false,
    metrics: [{ label: 'Approved', value: '—' }, { label: 'Outcome', value: '—' }],
    takeaway: 'Tracks how approved ideas perform post-execution. Needs executed recommendations.',
  },
  {
    id: 'calibration', title: 'Conviction Calibration', score: null, strength: 'Not yet measurable', measurable: false,
    metrics: [{ label: 'Bias', value: '—' }, { label: 'Avg time to hit', value: '—' }],
    takeaway: 'Tracks systematic bias in target construction. Needs 3+ resolved targets.',
  },
]

export function buildAnalystPillars(d: AnalystScorecardData | null): DiagnosticPillar[] {
  if (!d) return ANALYST_SKELETON_PILLARS
  const dirScore = d.ratings.directionalHitRate
  const ptResolved = d.priceTargets.hit + d.priceTargets.missed
  const ptScore = d.priceTargets.overallScore
  const decScore = d.decisions.executedHitRate
  const biasScore = d.priceTargets.bullishBias != null && d.priceTargets.total >= 3
    ? Math.max(0, 100 - Math.abs(d.priceTargets.bullishBias) * 5) : null

  return [
    {
      id: 'directional', title: 'Directional Skill', score: dirScore,
      strength: d.ratings.totalRated === 0 ? 'Not yet measurable' : strengthLabel(dirScore),
      measurable: d.ratings.totalRated > 0,
      metrics: [
        { label: 'Correct', value: `${d.ratings.directionalCorrect} of ${d.ratings.totalRated}` },
        { label: 'Hit rate', value: fmtPct(dirScore) },
      ],
      takeaway: d.ratings.totalRated === 0
        ? 'No ratings assigned — directional edge cannot be assessed without coverage.'
        : dirScore != null && dirScore >= 60 ? 'Calls are directionally sound versus subsequent price movement.'
        : dirScore != null && dirScore < 40 ? 'Directional calls are inconsistent — thesis construction may need review.'
        : 'Middling accuracy. More resolved ratings needed to determine if edge exists.',
    },
    {
      id: 'targets', title: 'Target Accuracy', score: ptScore,
      strength: ptResolved === 0 ? 'Not yet measurable' : strengthLabel(ptScore),
      measurable: ptResolved > 0,
      metrics: [
        { label: 'Resolved', value: `${d.priceTargets.hit} hit · ${d.priceTargets.missed} missed` },
        { label: 'Pending', value: `${d.priceTargets.pending}` },
      ],
      takeaway: d.priceTargets.total === 0
        ? 'No price targets set — conviction accuracy cannot be measured.'
        : ptResolved === 0
          ? `${d.priceTargets.pending} targets pending. Too early to evaluate — outcomes must resolve first.`
          : ptScore != null && ptScore >= 60 ? `Hitting at ${d.priceTargets.hitRate?.toFixed(0)}% with ${d.priceTargets.avgAccuracy?.toFixed(0)}% precision.`
          : 'Target accuracy below standard. Review price level construction and timeframe assumptions.',
    },
    {
      id: 'recommendations', title: 'Recommendation Outcomes', score: decScore,
      strength: d.decisions.executedTotal === 0 ? 'Not yet measurable' : strengthLabel(decScore),
      measurable: d.decisions.executedTotal > 0,
      metrics: [
        { label: 'Approved', value: `${d.decisions.approved} of ${d.decisions.totalProposed}` },
        { label: 'Outcome', value: d.decisions.executedTotal > 0 ? `${d.decisions.executedCorrect}/${d.decisions.executedTotal} correct` : 'None executed' },
      ],
      takeaway: d.decisions.totalProposed === 0
        ? 'No trade ideas proposed — recommendation quality not evaluable.'
        : d.decisions.executedTotal === 0
          ? `${d.decisions.approved} approved but none executed. Recommendations are not reaching the portfolio.`
          : decScore != null && decScore >= 60 ? 'Approved recommendations are generating positive directional outcomes.'
          : 'Approved recommendations are underperforming. Ideas may need stronger thesis validation before proposal.',
    },
    {
      id: 'calibration', title: 'Conviction Calibration', score: biasScore,
      strength: d.priceTargets.total < 3 ? 'Not yet measurable' : strengthLabel(biasScore),
      measurable: d.priceTargets.total >= 3,
      metrics: [
        { label: 'Bias', value: d.priceTargets.bullishBias != null ? `${d.priceTargets.bullishBias > 0 ? '+' : ''}${d.priceTargets.bullishBias.toFixed(1)}%` : '—' },
        { label: 'Avg time to hit', value: fmtDays(d.priceTargets.avgDaysToHit) },
      ],
      takeaway: d.priceTargets.total < 3
        ? 'Fewer than 3 targets — insufficient data to assess systematic bias.'
        : biasScore != null && biasScore >= 70 ? 'Well calibrated — no persistent directional skew in targets.'
        : d.priceTargets.bullishBias != null && d.priceTargets.bullishBias > 10 ? 'Systematically overestimating upside. Targets are set too aggressively.'
        : d.priceTargets.bullishBias != null && d.priceTargets.bullishBias < -10 ? 'Systematically underestimating downside risk in target construction.'
        : 'Minor bias present. Monitor as more targets resolve.',
    },
  ]
}

export function buildAnalystInsights(d: AnalystScorecardData | null): BehaviorInsight[] {
  if (!d) return [{ text: 'No analyst activity yet. Insights will appear here as you rate ideas, set targets, and propose recommendations.', severity: 'neutral' }]
  const insights: BehaviorInsight[] = []
  const n = analystSampleSize(d)
  if (n === 0) return [{ text: 'No activity recorded. Begin setting targets and ratings to establish track record.', severity: 'neutral' }]

  if (d.priceTargets.pending > 0 && d.priceTargets.pending > d.priceTargets.hit + d.priceTargets.missed)
    insights.push({ text: `${d.priceTargets.pending} targets pending vs ${d.priceTargets.hit + d.priceTargets.missed} resolved — pipeline is front-loaded with unresolved conviction.`, severity: 'negative' })
  if (d.ratings.totalRated > 0 && d.priceTargets.total === 0)
    insights.push({ text: 'Ratings exist but no price targets — conviction precision is unmeasured.', severity: 'negative' })
  if (d.priceTargets.total > 0 && d.ratings.totalRated === 0)
    insights.push({ text: 'Targets set without ratings — directional edge is unvalidated.', severity: 'negative' })
  if (d.decisions.approved > 0 && d.decisions.executedTotal === 0)
    insights.push({ text: `${d.decisions.approved} approved ideas remain unexecuted — recommendations are stalled before reaching the portfolio.`, severity: 'negative' })
  if (d.decisions.executedHitRate != null && d.decisions.executedHitRate >= 70 && d.decisions.executedTotal >= 3)
    insights.push({ text: `${d.decisions.executedCorrect} of ${d.decisions.executedTotal} executed ideas working — idea quality is translating into portfolio value.`, severity: 'positive' })
  if (d.priceTargets.bullishBias != null && d.priceTargets.bullishBias > 15 && d.priceTargets.total >= 5)
    insights.push({ text: 'Persistent bullish bias suggests overconfidence in upside scenarios.', severity: 'negative' })
  if (d.decisions.approvalRate != null && d.decisions.approvalRate < 40 && d.decisions.totalProposed >= 5)
    insights.push({ text: `${d.decisions.approvalRate.toFixed(0)}% approval rate — proposals may need stronger thesis validation before submission.`, severity: 'negative' })
  if (d.ratings.directionalHitRate != null && d.ratings.directionalHitRate >= 65 && d.decisions.executedTotal === 0 && d.ratings.totalRated >= 3)
    insights.push({ text: 'Directional instincts are good but no ideas have been executed — edge is not being captured in the portfolio.', severity: 'negative' })

  if (insights.length === 0) insights.push({ text: 'Track record developing. More resolved outcomes will sharpen this assessment.', severity: 'neutral' })
  return insights.slice(0, 4)
}

// ════════════════════════════════════════════════════════════════
// PM
// ════════════════════════════════════════════════════════════════

function computePMScore(d: PMScorecardData): number {
  const components: { score: number; weight: number }[] = []
  if (d.directionalHitRate != null) components.push({ score: d.directionalHitRate, weight: 0.35 })
  if (d.executionRate != null) components.push({ score: d.executionRate, weight: 0.30 })
  if (d.avgExecutionLagDays != null) components.push({ score: Math.max(0, 100 - d.avgExecutionLagDays * 10), weight: 0.20 })
  if (d.totalDecisions > 0) components.push({ score: (d.decisionsExecuted / d.totalDecisions) * 100, weight: 0.15 })
  if (components.length === 0) return 0
  const tw = components.reduce((s, c) => s + c.weight, 0)
  return components.reduce((s, c) => s + c.score * (c.weight / tw), 0)
}

export function interpretPMScorecard(d: PMScorecardData | null): ScorecardVerdict {
  if (!d) return {
    score: 0, verdict: 'insufficient', confidence: 'insufficient',
    headline: 'No PM decisions to evaluate.',
    interpretation: 'PM performance requires approved decisions and executed trades. No activity found.',
    flags: [{ label: 'No decision activity', type: 'info' }],
    focus: ['Approve pending trade ideas', 'Establish decision-to-execution workflow'],
  }

  const pillars = buildPMPillars(d)
  const measurable = pillars.filter(p => p.measurable).length
  const score = computePMScore(d)
  const resolved = d.decisionsPositive + d.decisionsNegative
  const confidence = computeConfidence(d.totalDecisions, measurable, pillars.length)
  const verdict = confidence === 'insufficient' ? 'insufficient' : scoreToVerdict(score)

  let headline: string
  if (d.totalDecisions === 0) headline = 'No decisions to evaluate.'
  else if (verdict === 'elite') headline = 'Decision process is operating at institutional standard.'
  else if (verdict === 'strong') headline = 'Decisions are consistently adding portfolio value.'
  else if (verdict === 'solid') headline = 'Process is functional with minor execution gaps.'
  else if (verdict === 'mixed') headline = 'Decision quality is inconsistent — execution and follow-through need work.'
  else if (verdict === 'developing') headline = 'Process is not yet translating decisions into measurable outcomes.'
  else if (verdict === 'weak') headline = 'Decision process is breaking down at execution.'
  else if (verdict === 'critical') headline = 'Approvals are accumulating without reaching the portfolio. Process intervention required.'
  else headline = 'Too few executed decisions for reliable assessment.'

  const parts: string[] = []
  if (d.executionRate != null) {
    if (d.executionRate >= 80) parts.push(`Execution discipline is strong (${d.executionRate.toFixed(0)}% conversion)`)
    else if (d.executionRate < 50) parts.push(`Only ${d.executionRate.toFixed(0)}% of approvals are reaching the portfolio`)
    else parts.push(`Execution at ${d.executionRate.toFixed(0)}% — below the ${80}% threshold`)
  }
  if (d.directionalHitRate != null && resolved >= 2) {
    if (d.directionalHitRate >= 60) parts.push('decisions that reach execution are adding value')
    else if (d.directionalHitRate < 40) parts.push('more executed decisions are hurting than helping')
  }
  if (d.avgExecutionLagDays != null && d.avgExecutionLagDays > 5)
    parts.push(`${d.avgExecutionLagDays.toFixed(0)}-day average lag is likely costing entry quality`)

  let interpretation = parts.length > 0
    ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? '. ' + parts.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('. ') : '') + '.'
    : d.totalDecisions > 0 && resolved === 0
      ? `${d.totalDecisions} decisions made but no outcomes resolved. Cannot determine if decisions are creating or destroying value.`
      : 'More executed decisions needed for evaluation.'
  if (confidence === 'low' && parts.length > 0) interpretation += ' Assessment is preliminary.'

  const flags: ScorecardFlag[] = []
  if (d.totalDecisions < 5 && d.totalDecisions > 0) flags.push({ label: 'Shallow decision sample', type: 'warning' })
  if (d.executionRate != null && d.executionRate >= 85) flags.push({ label: 'Strong execution follow-through', type: 'strength' })
  if (d.executionRate != null && d.executionRate < 50) flags.push({ label: 'Approval-to-action breakdown', type: 'weakness' })
  if (d.decisionsPending > d.decisionsExecuted && d.totalDecisions > 3) flags.push({ label: 'Decision backlog accumulating', type: 'weakness' })
  if (d.avgExecutionLagDays != null && d.avgExecutionLagDays > 7) flags.push({ label: 'Significant execution delay', type: 'weakness' })
  if (d.avgExecutionLagDays != null && d.avgExecutionLagDays <= 2) flags.push({ label: 'Fast execution turnaround', type: 'strength' })
  if (d.totalDelayCostBps != null && d.totalDelayCostBps > 20) flags.push({ label: 'Material delay cost', type: 'weakness' })
  if (d.directionalHitRate != null && d.directionalHitRate >= 65 && resolved >= 3) flags.push({ label: 'Decision quality creating value', type: 'strength' })
  if (d.directionalHitRate != null && d.directionalHitRate < 35 && resolved >= 3) flags.push({ label: 'Outcome profile is negative', type: 'weakness' })

  const focus: string[] = []
  if (d.executionRate != null && d.executionRate < 60) focus.push('Close the approval-to-execution gap')
  if (d.decisionsPending > d.decisionsExecuted) focus.push('Clear pending decision backlog')
  if (d.avgExecutionLagDays != null && d.avgExecutionLagDays > 5) focus.push('Reduce decision-to-trade lag')
  if (d.directionalHitRate != null && d.directionalHitRate < 45 && resolved >= 3) focus.push('Strengthen thesis validation before approving')
  if (d.totalDecisions > 0 && resolved === 0) focus.push('Execute approved decisions to generate measurable outcomes')
  if (focus.length === 0 && d.totalDecisions < 10) focus.push('Build larger decision sample for reliable assessment')

  return { score, verdict, confidence, headline, interpretation, flags: flags.slice(0, 4), focus: focus.slice(0, 3) }
}

export function buildPMOutcomeSnapshot(d: PMScorecardData | null): OutcomeSnapshot {
  if (!d) return { winners: 0, losers: 0, winRate: null, avgMovePct: null, totalDecisions: 0, executedDecisions: 0, pendingDecisions: 0, avgDelayCostBps: null, summaryText: 'No PM decisions recorded.' }
  const resolved = d.decisionsPositive + d.decisionsNegative
  const winRate = resolved > 0 ? (d.decisionsPositive / resolved) * 100 : null

  let summaryText: string
  if (d.totalDecisions === 0) summaryText = 'No decisions made — outcome profile cannot be assessed.'
  else if (d.decisionsExecuted === 0) summaryText = `${d.totalDecisions} approved but none executed. Decisions are not reaching the portfolio.`
  else if (resolved === 0) summaryText = `${d.decisionsExecuted} executed — awaiting price-based outcome resolution.`
  else if (winRate != null && winRate >= 55) summaryText = `${d.decisionsPositive} of ${resolved} resolved decisions helped. Net contribution is positive.`
  else summaryText = `${d.decisionsPositive} winners vs ${d.decisionsNegative} losers. Decision accuracy needs improvement.`

  return {
    winners: d.decisionsPositive, losers: d.decisionsNegative, winRate, avgMovePct: null,
    totalDecisions: d.totalDecisions, executedDecisions: d.decisionsExecuted,
    pendingDecisions: d.decisionsPending, avgDelayCostBps: d.totalDelayCostBps,
    summaryText,
  }
}

const PM_SKELETON_STAGES: ProcessStage[] = [
  { id: 'approval', label: 'Approval', status: 'unmeasurable', score: null },
  { id: 'execution', label: 'Execution', status: 'unmeasurable', score: null },
  { id: 'timing', label: 'Timing', status: 'unmeasurable', score: null },
  { id: 'outcome', label: 'Outcome', status: 'unmeasurable', score: null },
]

export function buildPMProcessBreakdown(d: PMScorecardData | null): ProcessBreakdown {
  if (!d) return { stages: PM_SKELETON_STAGES, failurePoint: null, failureSummary: null }

  const resolved = d.decisionsPositive + d.decisionsNegative
  const qualityScore = resolved > 0 ? d.directionalHitRate : null
  const execScore = d.totalDecisions > 0 ? d.executionRate : null
  const timingScore = d.avgExecutionLagDays != null ? Math.max(0, 100 - d.avgExecutionLagDays * 10) : null
  const convScore = d.totalDecisions > 0 ? (d.decisionsExecuted / d.totalDecisions) * 100 : null

  const stages: ProcessStage[] = [
    { id: 'approval', label: 'Approval', status: d.totalDecisions > 0 ? 'strong' : 'unmeasurable', score: d.totalDecisions > 0 ? 80 : null },
    { id: 'execution', label: 'Execution', status: stageStatus(execScore), score: execScore },
    { id: 'timing', label: 'Timing', status: stageStatus(timingScore), score: timingScore },
    { id: 'outcome', label: 'Outcome', status: stageStatus(qualityScore), score: qualityScore },
  ]

  const failing = stages.filter(s => s.status === 'failing' || s.status === 'weak')
  const failurePoint = failing.length > 0 ? failing.sort((a, b) => (a.score ?? 999) - (b.score ?? 999))[0].label : null

  const summaryMap: Record<string, string> = {
    'Approval': 'Decision pipeline may need more throughput.',
    'Execution': 'Approvals are not converting into trades — the decision process is disconnected from the portfolio.',
    'Timing': 'Execution lag is creating material opportunity cost between approval and trade.',
    'Outcome': 'Executed decisions are underperforming — thesis quality or timing may be the issue.',
  }

  return { stages, failurePoint, failureSummary: failurePoint ? summaryMap[failurePoint] || null : null }
}

const PM_SKELETON_PILLARS: DiagnosticPillar[] = [
  {
    id: 'decision-quality', title: 'Decision Quality', score: null, strength: 'Not yet measurable', measurable: false,
    metrics: [{ label: 'Outcome', value: '—' }, { label: 'Hit rate', value: '—' }],
    takeaway: 'Tracks whether approved decisions move in the intended direction. Needs resolved outcomes.',
  },
  {
    id: 'execution', title: 'Execution Discipline', score: null, strength: 'Not yet measurable', measurable: false,
    metrics: [{ label: 'Traded', value: '—' }, { label: 'Stalled', value: '—' }],
    takeaway: 'Tracks how many approvals convert into trades. Needs approved decisions.',
  },
  {
    id: 'timing', title: 'Timing & Delay Cost', score: null, strength: 'Not yet measurable', measurable: false,
    metrics: [{ label: 'Avg lag', value: '—' }, { label: 'Delay cost', value: '—' }],
    takeaway: 'Tracks approval-to-execution lag and cost of delay. Needs executed decisions with timestamps.',
  },
]

export function buildPMPillars(d: PMScorecardData | null): DiagnosticPillar[] {
  if (!d) return PM_SKELETON_PILLARS
  const resolved = d.decisionsPositive + d.decisionsNegative
  const timingScore = d.avgExecutionLagDays != null ? Math.max(0, 100 - d.avgExecutionLagDays * 10) : null

  return [
    {
      id: 'decision-quality', title: 'Decision Quality', score: d.directionalHitRate,
      strength: resolved === 0 ? 'Not yet measurable' : strengthLabel(d.directionalHitRate),
      measurable: resolved > 0,
      metrics: [
        { label: 'Outcome', value: resolved > 0 ? `${d.decisionsPositive} helped · ${d.decisionsNegative} hurt` : 'No outcomes' },
        { label: 'Hit rate', value: fmtPct(d.directionalHitRate) },
      ],
      takeaway: resolved === 0
        ? 'No decisions have resolved with price data — execute and hold positions to generate outcome signal.'
        : d.directionalHitRate != null && d.directionalHitRate >= 60 ? 'Approved decisions are moving positions in the right direction.'
        : 'Decision accuracy below threshold — review idea screening rigor before approving.',
    },
    {
      id: 'execution', title: 'Execution Discipline', score: d.executionRate,
      strength: d.totalDecisions === 0 ? 'Not yet measurable' : strengthLabel(d.executionRate),
      measurable: d.totalDecisions > 0,
      metrics: [
        { label: 'Traded', value: `${d.decisionsExecuted} of ${d.totalDecisions}` },
        { label: 'Stalled', value: `${d.decisionsPending}` },
      ],
      takeaway: d.totalDecisions === 0 ? 'No decisions made.'
        : d.executionRate != null && d.executionRate >= 80 ? 'Approvals are reliably converting into positions.'
        : d.executionRate != null && d.executionRate < 50 ? 'More approvals are stalling than executing. The decision process is disconnected from portfolio action.'
        : 'Conversion is inconsistent. Determine if delays are intentional or process-driven.',
    },
    {
      id: 'timing', title: 'Timing & Delay Cost', score: timingScore,
      strength: d.avgExecutionLagDays == null ? 'Not yet measurable' : strengthLabel(timingScore),
      measurable: d.avgExecutionLagDays != null,
      metrics: [
        { label: 'Avg lag', value: fmtDays(d.avgExecutionLagDays) },
        { label: 'Delay cost', value: d.totalDelayCostBps != null ? `${d.totalDelayCostBps > 0 ? '+' : ''}${d.totalDelayCostBps.toFixed(0)} bps` : '—' },
      ],
      takeaway: d.avgExecutionLagDays == null ? 'No executed decisions with timing data — cannot assess delay cost until trades are executed.'
        : d.avgExecutionLagDays <= 2 ? 'Fast execution. Delay cost is minimal.'
        : d.avgExecutionLagDays > 7 ? `${d.avgExecutionLagDays.toFixed(0)}-day lag is likely creating material opportunity cost.`
        : 'Execution timing is adequate. Monitor for drift.',
    },
  ]
}

export function buildPMInsights(d: PMScorecardData | null): BehaviorInsight[] {
  if (!d) return [{ text: 'No PM activity yet. Insights will appear here as you approve ideas, execute trades, and outcomes resolve.', severity: 'neutral' }]
  const insights: BehaviorInsight[] = []

  if (d.totalDecisions === 0) return [{ text: 'No approved decisions in the system. Begin approving ideas to build PM track record.', severity: 'neutral' }]

  if (d.decisionsPending > d.decisionsExecuted && d.totalDecisions > 3)
    insights.push({ text: `${d.decisionsPending} approvals are stalled — decisions are not reaching the portfolio.`, severity: 'negative' })
  if (d.avgExecutionLagDays != null && d.avgExecutionLagDays > 7 && d.decisionsExecuted > 0)
    insights.push({ text: `${d.avgExecutionLagDays.toFixed(0)}-day average lag between approval and trade. Entry quality is likely degrading.`, severity: 'negative' })
  if (d.totalDelayCostBps != null && d.totalDelayCostBps > 30)
    insights.push({ text: `Estimated ${d.totalDelayCostBps.toFixed(0)} bps delay cost per trade. Faster execution would improve entry prices.`, severity: 'negative' })
  if (d.directionalHitRate != null && d.directionalHitRate >= 70 && d.decisionsPositive + d.decisionsNegative >= 3)
    insights.push({ text: `${d.decisionsPositive} of ${d.decisionsPositive + d.decisionsNegative} resolved decisions helped. Decision quality is net positive.`, severity: 'positive' })
  if (d.directionalHitRate != null && d.directionalHitRate < 35 && d.decisionsPositive + d.decisionsNegative >= 3)
    insights.push({ text: 'Negative outcomes outweigh positive — approvals may be happening before ideas are fully validated.', severity: 'negative' })
  if (d.executionRate != null && d.executionRate >= 90 && d.totalDecisions >= 5)
    insights.push({ text: 'Near-complete execution follow-through. Pipeline is functioning.', severity: 'positive' })

  if (insights.length === 0) insights.push({ text: 'Track record developing. More resolved decisions will sharpen assessment.', severity: 'neutral' })
  return insights.slice(0, 4)
}

// ─── Roster ───────────────────────────────────────────────────

function buildInsightForRoster(d: AnalystScorecardData | PMScorecardData | null, mode: 'analyst' | 'pm'): string | null {
  if (!d) return 'Track record not yet established.'
  if (mode === 'analyst') {
    const a = d as AnalystScorecardData
    const n = analystSampleSize(a)
    if (n === 0) return 'No activity recorded.'
    if (analystResolvedCount(a) === 0) return `${n} items in pipeline, none resolved.`
    if (a.ratings.directionalHitRate != null && a.ratings.directionalHitRate >= 65) return `Strong directional accuracy (${a.ratings.directionalHitRate.toFixed(0)}%).`
    if (a.decisions.executedTotal > 0 && a.decisions.executedHitRate != null && a.decisions.executedHitRate < 40) return 'Approved ideas underperforming.'
    return null
  }
  const p = d as PMScorecardData
  if (p.totalDecisions === 0) return 'No decisions recorded.'
  if (p.executionRate != null && p.executionRate < 50) return `Only ${p.executionRate.toFixed(0)}% execution rate.`
  if (p.directionalHitRate != null && p.directionalHitRate >= 65) return 'Decisions adding value.'
  if (p.decisionsPending > p.decisionsExecuted) return 'Decision backlog growing.'
  return null
}

export function buildAnalystRosterEntry(userId: string, name: string, d: AnalystScorecardData | null): RosterEntry {
  const v = interpretAnalystScorecard(d)
  const pillars = buildAnalystPillars(d)
  const scored = pillars.filter(p => p.measurable && p.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return {
    userId, name, role: 'analyst', score: v.score, verdict: v.verdict, confidence: v.confidence,
    strongest: scored.length > 0 ? scored[0].title : null,
    weakest: scored.length > 1 ? scored[scored.length - 1].title : null,
    insight: buildInsightForRoster(d, 'analyst'),
    metrics: d ? [
      { label: 'Targets', value: `${d.priceTargets.total}` },
      { label: 'Ratings', value: `${d.ratings.totalRated}` },
      { label: 'Ideas', value: `${d.decisions.totalProposed}` },
    ] : [],
    rank: null, teamContext: null, // populated by caller
  }
}

export function buildPMRosterEntry(userId: string, name: string, d: PMScorecardData | null): RosterEntry {
  const v = interpretPMScorecard(d)
  const pillars = buildPMPillars(d)
  const scored = pillars.filter(p => p.measurable && p.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return {
    userId, name, role: 'pm', score: v.score, verdict: v.verdict, confidence: v.confidence,
    strongest: scored.length > 0 ? scored[0].title : null,
    weakest: scored.length > 1 ? scored[scored.length - 1].title : null,
    insight: buildInsightForRoster(d, 'pm'),
    metrics: d ? [
      { label: 'Decisions', value: `${d.totalDecisions}` },
      { label: 'Exec rate', value: fmtPct(d.executionRate) },
      { label: 'Hit rate', value: fmtPct(d.directionalHitRate) },
    ] : [],
    rank: null, teamContext: null,
  }
}

/** Populate rank and teamContext on roster entries after all are built */
export function rankRosterEntries(entries: RosterEntry[]): RosterEntry[] {
  const withData = entries.filter(e => e.verdict !== 'insufficient')
  const sorted = [...withData].sort((a, b) => b.score - a.score)
  const avgScore = withData.length > 0 ? withData.reduce((s, e) => s + e.score, 0) / withData.length : 0

  return entries.map(e => {
    if (e.verdict === 'insufficient') {
      return { ...e, rank: null, teamContext: 'Track record forming' }
    }
    const idx = sorted.findIndex(s => s.userId === e.userId)
    const rank = idx >= 0 ? idx + 1 : null
    let teamContext: string | null = null
    if (rank != null && withData.length >= 2) {
      const diff = Math.round(e.score - avgScore)
      if (rank === 1) teamContext = `#1 of ${withData.length}`
      else if (rank === withData.length) teamContext = `#${rank} of ${withData.length}`
      else if (diff >= 10) teamContext = `Above avg (+${diff})`
      else if (diff <= -10) teamContext = `Below avg (${diff})`
      else teamContext = `#${rank} of ${withData.length}`
    }
    return { ...e, rank, teamContext }
  })
}
