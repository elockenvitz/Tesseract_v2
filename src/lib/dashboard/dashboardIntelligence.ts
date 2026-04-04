/**
 * dashboardIntelligence — Pure transform helpers for the Command Center dashboard.
 *
 * Converts CockpitViewModel data into presentation-ready structures:
 *   - getHeroDecision: extracts the single highest-priority decision item
 *   - rankDecisionItems: flattens & ranks all DECIDE items by composite score
 *   - buildBriefingInsights: synthesizes 2-4 narrative intelligence bullets
 *   - summarizeBottleneck: extracts pipeline health summary
 *
 * No React. No side effects. Pure functions only.
 */

import type { DashboardItem } from '../../types/dashboard-item'
import type { CockpitViewModel, CockpitBand } from '../../types/cockpit'
import type { ExecutionStats } from '../../components/dashboard/ExecutionSnapshotCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured priority factors for a single decision item */
export interface PriorityFactors {
  /** Short scannable fragments: ["stalled 17d", "2.0% weight", "blocking"] */
  fragments: string[]
  /** Joined one-liner: "stalled 17d · 2.0% weight · blocking" */
  summary: string
}

export interface RankedDecisionItem {
  rank: number
  item: DashboardItem
  compositeScore: number
  /** Synthesized one-line reason this item is ranked here */
  priorityReason: string
  /** Structured priority factors */
  factors: PriorityFactors
}

export interface BriefingInsight {
  id: string
  icon: 'bottleneck' | 'aging' | 'stale' | 'progress' | 'clear' | 'workload' | 'execution'
  text: string
  severity: 'critical' | 'warning' | 'info' | 'positive'
  ctaLabel?: string
  ctaAction?: () => void
}

export interface BottleneckSummary {
  stage: 'deciding' | 'modeling' | 'executing' | null
  label: string
  count: number
  medianDays: number
  oldestDays: number
  total: number
  isHealthy: boolean
}

// ---------------------------------------------------------------------------
// Composite priority score for a single DashboardItem
// ---------------------------------------------------------------------------

const SEV_SCORE = { HIGH: 40, MED: 15, LOW: 0 } as const

function compositeItemScore(item: DashboardItem): number {
  let score = 0

  // Severity
  score += SEV_SCORE[item.severity] ?? 0

  // Age: 3 points per day, accelerating after 7d
  const age = item.ageDays ?? 0
  score += age <= 7 ? age * 3 : 21 + (age - 7) * 5

  // Urgency meta boost
  if (item.meta?.urgency === 'urgent') score += 25
  else if (item.meta?.urgency === 'high') score += 15

  // Proposed weight: larger positions matter more
  if (item.meta?.proposedWeight != null) {
    score += Math.min(item.meta.proposedWeight * 3, 20)
  }

  // Pair trade complexity bonus
  if (item.meta?.isPairTrade) score += 5

  return score
}

// ---------------------------------------------------------------------------
// getHeroDecision — Extracts the single highest-priority DECIDE item
// ---------------------------------------------------------------------------

export function getHeroDecision(
  viewModel: CockpitViewModel,
): DashboardItem | null {
  const allDecideItems = viewModel.decide.stacks.flatMap(s => s.itemsAll)
  if (allDecideItems.length === 0) return null

  return allDecideItems.reduce((best, item) => {
    return compositeItemScore(item) > compositeItemScore(best) ? item : best
  })
}

// ---------------------------------------------------------------------------
// rankDecisionItems — Flattens all DECIDE items into a ranked list
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getPriorityFactors — Single source of truth for why an item is prioritized
// ---------------------------------------------------------------------------

export function getPriorityFactors(item: DashboardItem): PriorityFactors {
  const fragments: string[] = []
  const age = item.ageDays ?? 0

  // Age / staleness — the strongest signal
  if (age >= 14) {
    fragments.push(`stalled ${age}d`)
  } else if (item.severity === 'HIGH' && age >= 10) {
    fragments.push(`stalled ${age}d`)
  } else if (age >= 10) {
    fragments.push(`${age}d open`)
  } else if (age >= 7) {
    fragments.push(`${age}d`)
  }

  // Severity (only if age didn't already communicate it)
  if (item.severity === 'HIGH' && age < 10) {
    fragments.push('high impact')
  }

  // Urgency / blocking
  if (item.meta?.urgency === 'urgent') {
    fragments.push('blocking')
  } else if (item.meta?.urgency === 'high') {
    fragments.push('high urgency')
  }

  // Exposure weight
  if (item.meta?.proposedWeight != null && item.meta.proposedWeight >= 1) {
    fragments.push(`${item.meta.proposedWeight.toFixed(1)}% weight`)
  }

  // Risk reduction signal
  const action = item.meta?.action
  if (action === 'Sell' || action === 'Trim') {
    fragments.push('risk reduction')
  }

  // Portfolio context
  if (item.portfolio?.name) {
    fragments.push(item.portfolio.name)
  }

  if (fragments.length === 0) {
    fragments.push('waiting on you')
  }

  return {
    fragments,
    summary: fragments.join(' \u00B7 '),
  }
}

// ---------------------------------------------------------------------------
// buildHeroConsequence — Generates "why this matters" + "if ignored" lines
// ---------------------------------------------------------------------------

export interface HeroConsequence {
  /** Sharp 1-line reason this decision matters */
  tension: string
  /** What happens if ignored — null if not applicable */
  ifIgnored: string | null
  /** Status descriptor: 'stalled' | 'at risk' | 'blocked' | 'misaligned' | 'aging' */
  status: 'stalled' | 'at risk' | 'blocked' | 'misaligned' | 'aging' | 'open'
  /** 2-3 short fragments explaining why this is #1 */
  whyFirst: string[]
  /** Structured priority factors */
  factors: PriorityFactors
}

export function buildHeroConsequence(item: DashboardItem): HeroConsequence {
  const age = item.ageDays ?? 0
  const action = item.meta?.action
  const weight = item.meta?.proposedWeight
  const urgency = item.meta?.urgency

  // Determine status
  let status: HeroConsequence['status'] = 'open'
  if (age >= 14) status = 'stalled'
  else if (age >= 10 && item.severity === 'HIGH') status = 'at risk'
  else if (item.severity === 'HIGH') status = 'at risk'
  else if (age >= 7) status = 'aging'
  if (urgency === 'urgent') status = 'blocked'

  // Build tension line — sharp, PM-level language
  let tension: string
  if (status === 'stalled') {
    tension = `Stalled ${age}d. Act now to avoid timing deterioration.`
  } else if (status === 'blocked') {
    tension = `Blocking downstream execution. Waiting on you.`
  } else if (status === 'at risk' && weight != null && weight >= 2) {
    tension = `${weight.toFixed(1)}% exposure misaligned \u2014 open ${age}d without resolution.`
  } else if (status === 'at risk') {
    tension = `High-impact, open ${age}d. Position deteriorating without action.`
  } else if (status === 'aging') {
    tension = `Open ${age}d \u2014 approaching decision window limit.`
  } else if (action && (action === 'Sell' || action === 'Trim')) {
    tension = 'Risk reduction trade waiting on you.'
  } else if (weight != null && weight >= 3) {
    tension = `${weight.toFixed(1)}% position change waiting on decision.`
  } else {
    tension = item.meta?.rationale
      ? item.meta.rationale.length > 90 ? item.meta.rationale.slice(0, 87) + '...' : item.meta.rationale
      : item.reason || 'Waiting on your decision.'
  }

  // Build "if ignored" line — consequence framing, no filler
  let ifIgnored: string | null = null
  if (age >= 14) {
    ifIgnored = `Delay is increasing risk of worse entry.`
  } else if (age >= 10 && item.severity === 'HIGH') {
    ifIgnored = `Further delay compounds position risk.`
  } else if (status === 'blocked') {
    ifIgnored = `Pipeline blocked until resolved.`
  } else if (action === 'Sell' || action === 'Trim') {
    ifIgnored = `Continued exposure to downside while unresolved.`
  }

  // Build "why #1" — 2-3 short fragments explaining top ranking
  const factors = getPriorityFactors(item)
  const whyFirst: string[] = []

  // Lead with the dominant ranking signal
  if (age >= 14) {
    whyFirst.push('Longest stalled decision')
  } else if (age >= 10) {
    whyFirst.push('Longest open decision')
  } else if (status === 'blocked') {
    whyFirst.push('Blocking execution')
  } else if (item.severity === 'HIGH') {
    whyFirst.push('Highest impact')
  } else if (age >= 7) {
    whyFirst.push('Longest aging')
  }

  // Secondary factors
  if (weight != null && weight >= 2) {
    whyFirst.push(`${weight.toFixed(1)}% exposure`)
  }
  if (urgency === 'urgent' && status !== 'blocked') {
    whyFirst.push('Blocking downstream')
  } else if (urgency === 'high') {
    whyFirst.push('High urgency')
  }
  if (action === 'Sell' || action === 'Trim') {
    whyFirst.push('Risk reduction')
  }

  // Ensure at least one fragment
  if (whyFirst.length === 0) {
    whyFirst.push('Top composite score')
  }

  return { tension, ifIgnored, status, whyFirst, factors }
}

export function rankDecisionItems(
  viewModel: CockpitViewModel,
): RankedDecisionItem[] {
  const allItems = viewModel.decide.stacks.flatMap(s => s.itemsAll)

  const scored = allItems.map(item => {
    const factors = getPriorityFactors(item)
    return {
      item,
      compositeScore: compositeItemScore(item),
      priorityReason: factors.summary,
      factors,
    }
  })

  scored.sort((a, b) => b.compositeScore - a.compositeScore)

  return scored.map((entry, idx) => ({
    rank: idx + 1,
    ...entry,
  }))
}

// ---------------------------------------------------------------------------
// Decision context — enriched data for the decision command center
// ---------------------------------------------------------------------------

export type DecisionTier = 'critical' | 'high' | 'standard'

export interface DecisionContext {
  /** Impact tier for grouping */
  tier: DecisionTier
  /** Why this decision matters — 2-3 short bullet fragments */
  impactBullets: string[]
  /** What's downstream — null if no dependencies */
  downstream: string | null
  /** Urgency reasoning */
  whyNow: string
}

export function getDecisionContext(item: DashboardItem): DecisionContext {
  const age = item.ageDays ?? 0
  const weight = item.meta?.proposedWeight
  const action = item.meta?.action
  const urgency = item.meta?.urgency

  // Determine tier
  let tier: DecisionTier = 'standard'
  if (item.severity === 'HIGH' || age >= 14 || urgency === 'urgent') {
    tier = 'critical'
  } else if (age >= 7 || urgency === 'high' || (weight != null && weight >= 2)) {
    tier = 'high'
  }

  // Build impact bullets
  const impactBullets: string[] = []
  if (weight != null && weight >= 1) {
    impactBullets.push(`${weight.toFixed(1)}% portfolio exposure`)
  }
  if (action === 'Sell' || action === 'Trim') {
    impactBullets.push('Risk reduction')
  } else if (action === 'Buy' || action === 'Add') {
    impactBullets.push('Capital deployment')
  }
  if (item.severity === 'HIGH') {
    impactBullets.push('High-impact position')
  }
  if (item.portfolio?.name) {
    impactBullets.push(item.portfolio.name)
  }

  // Downstream dependencies
  let downstream: string | null = null
  if (urgency === 'urgent') {
    downstream = 'Blocking downstream execution'
  } else if (age >= 14) {
    downstream = 'Stalling pipeline — other decisions waiting'
  }

  // Why now
  let whyNow: string
  if (age >= 14) {
    whyNow = `${age}d stalled — timing risk increasing`
  } else if (urgency === 'urgent') {
    whyNow = 'Blocking execution — act immediately'
  } else if (age >= 7) {
    whyNow = `${age}d open — approaching limit`
  } else if (item.severity === 'HIGH') {
    whyNow = 'High impact — early action preferred'
  } else {
    whyNow = `Open ${age}d`
  }

  return { tier, impactBullets, downstream, whyNow }
}

/** Pressure level for the decision queue */
export interface DecisionPressure {
  level: 'critical' | 'elevated' | 'normal' | 'clear'
  label: string
  total: number
  medianAge: number
  oldestAge: number
  criticalCount: number
}

export function computeDecisionPressure(
  viewModel: CockpitViewModel,
): DecisionPressure {
  const items = viewModel.decide.stacks.flatMap(s => s.itemsAll)
  if (items.length === 0) {
    return { level: 'clear', label: 'Clear', total: 0, medianAge: 0, oldestAge: 0, criticalCount: 0 }
  }

  const ages = items.map(i => i.ageDays ?? 0)
  const sorted = [...ages].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianAge = sorted.length % 2 !== 0 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2)
  const oldestAge = Math.max(...ages)
  const criticalCount = items.filter(i => i.severity === 'HIGH' || (i.ageDays ?? 0) >= 14).length

  let level: DecisionPressure['level'] = 'normal'
  if (criticalCount >= 3 || oldestAge >= 14) level = 'critical'
  else if (criticalCount >= 1 || medianAge >= 5) level = 'elevated'

  const label = level === 'critical' ? 'Critical'
    : level === 'elevated' ? 'Elevated'
      : 'Normal'

  return { level, label, total: items.length, medianAge, oldestAge, criticalCount }
}

/** Concentration detection */
export interface DecisionConcentration {
  portfolioName: string
  count: number
  total: number
  isConcentrated: boolean
}

export function detectDecisionConcentration(
  viewModel: CockpitViewModel,
): DecisionConcentration | null {
  const items = viewModel.decide.stacks.flatMap(s => s.itemsAll)
  if (items.length < 3) return null

  const byPortfolio = new Map<string, number>()
  for (const item of items) {
    if (item.portfolio?.name) {
      byPortfolio.set(item.portfolio.name, (byPortfolio.get(item.portfolio.name) ?? 0) + 1)
    }
  }

  const top = [...byPortfolio.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top || top[1] < 2) return null

  return {
    portfolioName: top[0],
    count: top[1],
    total: items.length,
    isConcentrated: top[1] >= 3 || (top[1] / items.length) >= 0.5,
  }
}

/** Group ranked items by tier */
export function groupByTier(
  ranked: RankedDecisionItem[],
): { critical: RankedDecisionItem[]; high: RankedDecisionItem[]; standard: RankedDecisionItem[] } {
  const critical: RankedDecisionItem[] = []
  const high: RankedDecisionItem[] = []
  const standard: RankedDecisionItem[] = []

  for (const r of ranked) {
    const ctx = getDecisionContext(r.item)
    if (ctx.tier === 'critical') critical.push(r)
    else if (ctx.tier === 'high') high.push(r)
    else standard.push(r)
  }

  return { critical, high, standard }
}

// ---------------------------------------------------------------------------
// buildBriefingInsights — Synthesize 2-4 narrative intelligence bullets
// ---------------------------------------------------------------------------

export function buildBriefingInsights(
  viewModel: CockpitViewModel,
  pipelineStats: ExecutionStats,
  onScrollToBand?: (band: CockpitBand) => void,
  onOpenTradeQueue?: (filter?: string) => void,
): BriefingInsight[] {
  const insights: BriefingInsight[] = []

  // 0. Top priority decision — why it's #1
  const decideItemsAll = viewModel.decide.stacks.flatMap(s => s.itemsAll)
  if (decideItemsAll.length > 0) {
    const hero = getHeroDecision(viewModel)
    if (hero) {
      const factors = getPriorityFactors(hero)
      const ticker = hero.asset?.ticker
      const action = hero.meta?.action
      const label = ticker
        ? `${action ? action + ' ' : ''}${ticker}`
        : hero.title
      // Only the first 2 non-portfolio factors for brevity
      const topFactors = factors.fragments
        .filter(f => f !== hero.portfolio?.name)
        .slice(0, 2)
        .join(' + ')
      insights.push({
        id: 'top-priority',
        icon: 'aging',
        text: `Top priority: ${label}${topFactors ? ` \u2014 ${topFactors}` : ''}.`,
        severity: hero.severity === 'HIGH' ? 'critical' : 'warning',
        ctaLabel: 'Act now',
        ctaAction: () => hero.primaryAction.onClick(),
      })
    }
  }

  // 1. Pipeline bottleneck
  const bottleneck = summarizeBottleneck(pipelineStats)
  if (!bottleneck.isHealthy && bottleneck.stage) {
    insights.push({
      id: 'bottleneck',
      icon: 'bottleneck',
      text: `${bottleneck.label} bottleneck \u2014 ${bottleneck.count} stalled, median ${bottleneck.medianDays}d.`,
      severity: bottleneck.medianDays >= 7 ? 'critical' : 'warning',
      ctaLabel: `Unblock`,
      ctaAction: () => onOpenTradeQueue?.(bottleneck.stage!),
    })
  }

  // 2. Most urgent aging decision (skip if same as hero — already covered above)
  const hero0 = decideItemsAll.length > 0 ? getHeroDecision(viewModel) : null
  const oldestDecision = decideItemsAll.reduce<DashboardItem | null>((oldest, item) => {
    if (!oldest) return item
    return (item.ageDays ?? 0) > (oldest.ageDays ?? 0) ? item : oldest
  }, null)

  if (oldestDecision && (oldestDecision.ageDays ?? 0) >= 7 && oldestDecision.id !== hero0?.id) {
    const days = oldestDecision.ageDays ?? 0
    const ticker = oldestDecision.asset?.ticker
    const action = oldestDecision.meta?.action
    const label = ticker
      ? `${action ? action + ' ' : ''}${ticker}`
      : oldestDecision.title
    const risk = days >= 14
      ? `${label} stalled ${days}d \u2014 execution risk increasing.`
      : `${label} open ${days}d without resolution.`
    insights.push({
      id: 'aging',
      icon: 'aging',
      text: risk,
      severity: days >= 14 ? 'critical' : 'warning',
      ctaLabel: 'Act now',
      ctaAction: () => oldestDecision.primaryAction.onClick(),
    })
  }

  // 3. Stale thesis coverage risk
  const thesisStack = viewModel.advance.stacks.find(s => s.kind === 'thesis')
  if (thesisStack && thesisStack.count > 0) {
    const redCount = thesisStack.itemsAll.filter(i => i.severity === 'HIGH').length
    const text = redCount > 0
      ? `Coverage degrading \u2014 ${redCount} thesis${redCount !== 1 ? 'es' : ''} stale >180d.`
      : `${thesisStack.count} thesis${thesisStack.count !== 1 ? 'es' : ''} beyond review window.`
    insights.push({
      id: 'stale',
      icon: 'stale',
      text,
      severity: redCount > 0 ? 'warning' : 'info',
      ctaLabel: 'Review coverage',
      ctaAction: () => onScrollToBand?.('ADVANCE'),
    })
  }

  // 4. Overdue deliverables
  const advanceTotal = viewModel.advance.totalItems
  const projectStack = viewModel.advance.stacks.find(s => s.kind === 'project')
  const delivStack = viewModel.advance.stacks.find(s => s.kind === 'deliverable')
  const overdueDelivs = delivStack?.itemsAll.filter(
    i => i.meta?.overdueDays != null && i.meta.overdueDays > 0
  ).length ?? 0

  if (overdueDelivs > 0) {
    const maxOverdue = Math.max(0, ...delivStack!.itemsAll.map(i => i.meta?.overdueDays ?? 0))
    insights.push({
      id: 'deliverables',
      icon: 'workload',
      text: `${overdueDelivs} deliverable${overdueDelivs !== 1 ? 's' : ''} overdue \u2014 worst ${maxOverdue}d late.`,
      severity: 'warning',
      ctaLabel: 'Open projects',
      ctaAction: () => onScrollToBand?.('ADVANCE'),
    })
  }

  // 5. Execution gap — approved but not acted on
  const executingCount = pipelineStats.stages.executing.count
  const executingOldest = pipelineStats.stages.executing.oldestDays ?? 0
  if (executingCount > 0) {
    const risk = executingOldest >= 5
      ? `Execution gap \u2014 ${executingCount} approved, oldest ${executingOldest}d unexecuted.`
      : `${executingCount} approved trade${executingCount !== 1 ? 's' : ''} not yet executed.`
    insights.push({
      id: 'execution',
      icon: 'execution',
      text: risk,
      severity: executingCount >= 3 || executingOldest >= 5 ? 'warning' : 'info',
      ctaLabel: 'Close gap',
      ctaAction: () => onOpenTradeQueue?.('executing'),
    })
  }

  // 6. Positive signal: if DECIDE is clear
  if (decideItemsAll.length === 0 && advanceTotal === 0) {
    insights.push({
      id: 'clear',
      icon: 'clear',
      text: 'No blockers. Decision queue and pipeline clear.',
      severity: 'positive',
    })
  } else if (decideItemsAll.length === 0) {
    insights.push({
      id: 'progress',
      icon: 'progress',
      text: `Decisions clear. ${advanceTotal} research item${advanceTotal !== 1 ? 's' : ''} in flight.`,
      severity: 'positive',
    })
  }

  // Cap at 4 insights, prioritize by severity
  const severityOrder = { critical: 0, warning: 1, info: 2, positive: 3 }
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return insights.slice(0, 4)
}

// ---------------------------------------------------------------------------
// summarizeBottleneck — Pipeline health summary
// ---------------------------------------------------------------------------

export function summarizeBottleneck(stats: ExecutionStats): BottleneckSummary {
  const stages = [
    { key: 'deciding' as const, label: 'Deciding', detail: stats.stages.deciding },
    { key: 'modeling' as const, label: 'Modeling', detail: stats.stages.modeling },
    { key: 'executing' as const, label: 'Executing', detail: stats.stages.executing },
  ].filter(s => s.detail.count > 0)

  const total = stats.stages.deciding.count + stats.stages.modeling.count + stats.stages.executing.count

  if (stages.length === 0) {
    return { stage: null, label: 'Clear', count: 0, medianDays: 0, oldestDays: 0, total: 0, isHealthy: true }
  }

  const worst = stages.reduce((w, s) => {
    const wAge = w.detail.medianDays ?? 0
    const sAge = s.detail.medianDays ?? 0
    return sAge > wAge ? s : w
  })

  const medianDays = worst.detail.medianDays ?? 0
  const oldestDays = worst.detail.oldestDays ?? 0

  return {
    stage: worst.key,
    label: worst.label,
    count: worst.detail.count,
    medianDays,
    oldestDays,
    total,
    isHealthy: medianDays < 3,
  }
}

// ===========================================================================
// FOCUS STACK — Daily work entry point
// ===========================================================================

export interface FocusDiscussItem {
  id: string
  title: string
  reason: string
  items: DashboardItem[]
}

export interface FocusUnblockItem {
  id: string
  title: string
  reason: string
  age: number
  onClick?: () => void
}

export interface FocusStackData {
  /** The single most important item — work on this now */
  now: DashboardItem | null
  /** Next 2-4 highest priority items */
  next: RankedDecisionItem[]
  /** Items that need team discussion */
  discuss: FocusDiscussItem[]
  /** Items blocking progress */
  unblock: FocusUnblockItem[]
  /** True when all sections are empty */
  isEmpty: boolean
}

// ---------------------------------------------------------------------------
// getDiscussionItems — Surface items needing team discussion
// ---------------------------------------------------------------------------

export function getDiscussionItems(viewModel: CockpitViewModel): FocusDiscussItem[] {
  const items: FocusDiscussItem[] = []
  const allDecideItems = viewModel.decide.stacks.flatMap(s => s.itemsAll)

  // 1. Portfolio concentration — multiple decisions in same portfolio
  const byPortfolio = new Map<string, DashboardItem[]>()
  for (const item of allDecideItems) {
    if (item.portfolio?.name) {
      const key = item.portfolio.name
      if (!byPortfolio.has(key)) byPortfolio.set(key, [])
      byPortfolio.get(key)!.push(item)
    }
  }
  for (const [name, pItems] of byPortfolio) {
    if (pItems.length >= 2) {
      items.push({
        id: `discuss-concentration-${name}`,
        title: `${pItems.length} decisions in ${name}`,
        reason: 'Concentrated decision load — coordinate priorities',
        items: pItems,
      })
    }
  }

  // 2. High exposure decisions — large position changes need alignment
  const highExposure = allDecideItems.filter(
    i => i.meta?.proposedWeight != null && i.meta.proposedWeight >= 2.5,
  )
  if (highExposure.length > 0) {
    items.push({
      id: 'discuss-high-exposure',
      title: `${highExposure.length} large position change${highExposure.length !== 1 ? 's' : ''}`,
      reason: 'Significant exposure shifts — team alignment needed',
      items: highExposure,
    })
  }

  // 3. Stale high-impact theses — coverage gaps affecting decisions
  const thesisStack = viewModel.advance.stacks.find(s => s.kind === 'thesis')
  const staleHighImpact = thesisStack?.itemsAll.filter(i => i.severity === 'HIGH') ?? []
  if (staleHighImpact.length >= 2) {
    items.push({
      id: 'discuss-stale-thesis',
      title: `${staleHighImpact.length} thesis${staleHighImpact.length !== 1 ? 'es' : ''} critically stale`,
      reason: 'Coverage blind spots — discuss research priorities',
      items: staleHighImpact,
    })
  }

  return items.slice(0, 3)
}

// ---------------------------------------------------------------------------
// getUnblockItems — Surface process friction and blockers
// ---------------------------------------------------------------------------

export function getUnblockItems(
  viewModel: CockpitViewModel,
  pipelineStats: ExecutionStats,
): FocusUnblockItem[] {
  const items: FocusUnblockItem[] = []

  // 1. Pipeline bottleneck
  const bottleneck = summarizeBottleneck(pipelineStats)
  if (!bottleneck.isHealthy) {
    items.push({
      id: 'unblock-bottleneck',
      title: `${bottleneck.label} bottleneck — ${bottleneck.count} stalled`,
      reason: `Median ${bottleneck.medianDays}d in stage`,
      age: bottleneck.medianDays,
    })
  }

  // 2. Stalled decisions (>14d)
  const stalledDecisions = viewModel.decide.stacks
    .flatMap(s => s.itemsAll)
    .filter(i => (i.ageDays ?? 0) >= 14)
  if (stalledDecisions.length > 0) {
    const oldest = Math.max(...stalledDecisions.map(i => i.ageDays ?? 0))
    items.push({
      id: 'unblock-stalled-decisions',
      title: `${stalledDecisions.length} decision${stalledDecisions.length !== 1 ? 's' : ''} stalled >14d`,
      reason: `Oldest: ${oldest}d — needs escalation or resolution`,
      age: oldest,
      onClick: stalledDecisions[0]?.primaryAction.onClick,
    })
  }

  // 3. Overdue deliverables
  const delivStack = viewModel.advance.stacks.find(s => s.kind === 'deliverable')
  const overdueDelivs = delivStack?.itemsAll.filter(
    i => i.meta?.overdueDays != null && i.meta.overdueDays > 0,
  ) ?? []
  if (overdueDelivs.length > 0) {
    const maxOverdue = Math.max(...overdueDelivs.map(i => i.meta?.overdueDays ?? 0))
    items.push({
      id: 'unblock-deliverables',
      title: `${overdueDelivs.length} deliverable${overdueDelivs.length !== 1 ? 's' : ''} overdue`,
      reason: `Worst: ${maxOverdue}d late`,
      age: maxOverdue,
    })
  }

  // 4. Ideas stuck in pipeline
  const simStack = viewModel.advance.stacks.find(s => s.kind === 'simulation')
  if (simStack && simStack.oldestAgeDays > 14) {
    items.push({
      id: 'unblock-pipeline-ideas',
      title: `${simStack.count} idea${simStack.count !== 1 ? 's' : ''} stuck in pipeline`,
      reason: `Oldest: ${simStack.oldestAgeDays}d — advance or discard`,
      age: simStack.oldestAgeDays,
    })
  }

  // Sort by age descending, cap at 3
  items.sort((a, b) => b.age - a.age)
  return items.slice(0, 3)
}

// ---------------------------------------------------------------------------
// buildFocusStack — Assembles the complete focus stack
// ---------------------------------------------------------------------------

export function buildFocusStack(
  viewModel: CockpitViewModel,
  pipelineStats: ExecutionStats,
): FocusStackData {
  const now = getHeroDecision(viewModel)
  const ranked = rankDecisionItems(viewModel)

  // Next: items 2-5 (skip the hero)
  const next = now
    ? ranked.filter(r => r.item.id !== now.id).slice(0, 4)
    : ranked.slice(0, 4)

  const discuss = getDiscussionItems(viewModel)
  const unblock = getUnblockItems(viewModel, pipelineStats)

  return {
    now,
    next,
    discuss,
    unblock,
    isEmpty: !now && next.length === 0 && discuss.length === 0 && unblock.length === 0,
  }
}
