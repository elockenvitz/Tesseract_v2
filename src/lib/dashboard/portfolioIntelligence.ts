/**
 * portfolioIntelligence — Helpers for the Portfolio Command Center.
 *
 * Classifies holdings by status, derives attention items, and
 * surfaces portfolio-related work from the cockpit view model.
 *
 * All functions operate on real data from portfolio_holdings + dashboard items.
 */

import type { DashboardItem } from '../../types/dashboard-item'
import type { CockpitViewModel } from '../../types/cockpit'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HoldingStatus = 'at-risk' | 'stale' | 'opportunity' | 'ok'

export interface ClassifiedHolding {
  assetId: string
  symbol: string
  name: string
  sector: string | null
  shares: number
  price: number
  cost: number
  marketValue: number
  weight: number
  unrealizedPnl: number
  returnPct: number
  status: HoldingStatus
  statusReason: string
  /** Thesis age in days — null if no thesis */
  thesisAgeDays: number | null
  /** Related dashboard items for this holding */
  relatedItems: DashboardItem[]
}

export interface PortfolioAttentionGroup {
  status: HoldingStatus
  label: string
  holdings: ClassifiedHolding[]
}

export interface PortfolioWorkItem {
  id: string
  type: 'decision' | 'idea' | 'research'
  title: string
  ticker: string | null
  age: number
  reason: string
  onClick: () => void
}

export interface PortfolioPriority {
  id: string
  rank: number
  action: string
  reason: string
  ticker: string | null
  severity: 'critical' | 'warning' | 'info'
  onClick?: () => void
}

export interface PortfolioNarrative {
  /** 1-2 sentence summary of portfolio state */
  summary: string
  /** Key risk or opportunity callout */
  callout: string | null
  /** Suggested focus */
  focus: string | null
}

// ---------------------------------------------------------------------------
// classifyHolding — Determine status for a single holding
// ---------------------------------------------------------------------------

export function classifyHolding(
  holding: any,
  totalValue: number,
  relatedItems: DashboardItem[],
  now: Date = new Date(),
): ClassifiedHolding {
  const asset = holding.assets || {}
  const symbol = (asset.symbol || '').toLowerCase()
  const isCash = symbol.includes('cash') || symbol.includes('usd') || symbol.includes('money_market')
  const shares = parseFloat(holding.shares) || 0
  const price = parseFloat(holding.price) || 0
  const cost = parseFloat(holding.cost) || 0
  const marketValue = isCash ? shares * (price || cost || 1) : shares * price
  const weight = totalValue > 0 ? (marketValue / totalValue) * 100 : 0
  const costBasis = shares * cost
  const unrealizedPnl = isCash || price <= 0 ? 0 : marketValue - costBasis
  // Cash has no return. Otherwise guard: no cost basis or no price → 0%. Clamp -100% (no price data).
  const rawReturn = isCash ? 0 : (costBasis > 0 && price > 0 ? ((marketValue - costBasis) / costBasis) * 100 : 0)
  const returnPct = rawReturn <= -99.9 ? 0 : rawReturn

  // Thesis age
  const thesisUpdated = asset.updated_at ? new Date(asset.updated_at) : null
  const thesisAgeDays = thesisUpdated
    ? Math.floor((now.getTime() - thesisUpdated.getTime()) / 86400000)
    : null

  // Classify status
  let status: HoldingStatus = 'ok'
  let statusReason = 'On track'

  // At Risk: significant loss + stale thesis or high-impact dashboard items
  const hasHighImpactItems = relatedItems.some(i => i.severity === 'HIGH')
  const significantLoss = returnPct < -10
  const deepLoss = returnPct < -20

  if (deepLoss) {
    status = 'at-risk'
    statusReason = `${returnPct.toFixed(0)}% drawdown`
  } else if (significantLoss && (thesisAgeDays != null && thesisAgeDays > 90)) {
    status = 'at-risk'
    statusReason = `${returnPct.toFixed(0)}% loss + thesis ${thesisAgeDays}d stale`
  } else if (hasHighImpactItems) {
    status = 'at-risk'
    statusReason = 'High-impact decision pending'
  }

  // Stale: thesis too old
  if (status === 'ok' && thesisAgeDays != null && thesisAgeDays > 180) {
    status = 'stale'
    statusReason = `Thesis ${thesisAgeDays}d without review`
  } else if (status === 'ok' && thesisAgeDays != null && thesisAgeDays > 90) {
    status = 'stale'
    statusReason = `Thesis aging — ${thesisAgeDays}d`
  }

  // Opportunity: strong return + fresh thesis
  if (status === 'ok' && returnPct > 15 && (thesisAgeDays == null || thesisAgeDays < 60)) {
    status = 'opportunity'
    statusReason = `+${returnPct.toFixed(0)}% — consider adding`
  }

  return {
    assetId: asset.id || holding.asset_id || '',
    symbol: asset.symbol || '',
    name: asset.company_name || '',
    sector: asset.sector || null,
    shares,
    price,
    cost,
    marketValue,
    weight,
    unrealizedPnl,
    returnPct,
    status,
    statusReason,
    thesisAgeDays,
    relatedItems,
  }
}

// ---------------------------------------------------------------------------
// classifyAllHoldings — Process all holdings for a portfolio
// ---------------------------------------------------------------------------

export function classifyAllHoldings(
  holdings: any[],
  dashboardItems: DashboardItem[],
): ClassifiedHolding[] {
  const totalValue = holdings.reduce(
    (sum, h) => sum + (parseFloat(h.shares) || 0) * (parseFloat(h.price) || 0),
    0,
  )

  // Index dashboard items by asset ID for fast lookup
  const itemsByAsset = new Map<string, DashboardItem[]>()
  for (const item of dashboardItems) {
    if (item.asset?.id) {
      if (!itemsByAsset.has(item.asset.id)) itemsByAsset.set(item.asset.id, [])
      itemsByAsset.get(item.asset.id)!.push(item)
    }
  }

  const classified = holdings.map(h => {
    const assetId = h.assets?.id || h.asset_id || ''
    const related = itemsByAsset.get(assetId) ?? []
    return classifyHolding(h, totalValue, related)
  })

  // Sort: at-risk first, then stale, then opportunity, then ok. Within each: by weight desc.
  const statusOrder: Record<HoldingStatus, number> = { 'at-risk': 0, stale: 1, opportunity: 2, ok: 3 }
  classified.sort((a, b) => {
    const s = statusOrder[a.status] - statusOrder[b.status]
    if (s !== 0) return s
    return b.weight - a.weight
  })

  return classified
}

// ---------------------------------------------------------------------------
// getPortfolioAttentionGroups — Group holdings by status (non-ok only)
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<HoldingStatus, string> = {
  'at-risk': 'At Risk',
  stale: 'Needs Review',
  opportunity: 'Opportunity',
  ok: 'On Track',
}

export function getPortfolioAttentionGroups(
  classified: ClassifiedHolding[],
): PortfolioAttentionGroup[] {
  const groups: PortfolioAttentionGroup[] = []

  for (const status of ['at-risk', 'stale', 'opportunity'] as HoldingStatus[]) {
    const items = classified.filter(h => h.status === status)
    if (items.length > 0) {
      groups.push({
        status,
        label: GROUP_LABELS[status],
        holdings: items.slice(0, 5), // Max 5 per group
      })
    }
  }

  return groups
}

// ---------------------------------------------------------------------------
// getPortfolioWorkItems — Surface work tied to this portfolio
// ---------------------------------------------------------------------------

export function getPortfolioWorkItems(
  viewModel: CockpitViewModel,
  portfolioId: string,
): PortfolioWorkItem[] {
  const items: PortfolioWorkItem[] = []

  // Decisions tied to this portfolio
  const decisions = viewModel.decide.stacks
    .flatMap(s => s.itemsAll)
    .filter(i => i.portfolio?.id === portfolioId)

  for (const d of decisions.slice(0, 3)) {
    items.push({
      id: d.id,
      type: 'decision',
      title: d.meta?.action ? `${d.meta.action} ${d.asset?.ticker || d.title}` : d.title,
      ticker: d.asset?.ticker ?? null,
      age: d.ageDays ?? 0,
      reason: d.severity === 'HIGH' ? 'high impact' : `${d.ageDays ?? 0}d open`,
      onClick: () => d.primaryAction.onClick(),
    })
  }

  // Ideas in pipeline for this portfolio
  const simStack = viewModel.advance.stacks.find(s => s.kind === 'simulation')
  const pipelineIdeas = simStack?.itemsAll.filter(i => i.portfolio?.id === portfolioId) ?? []
  for (const idea of pipelineIdeas.slice(0, 2)) {
    items.push({
      id: idea.id,
      type: 'idea',
      title: idea.asset?.ticker ? `${idea.meta?.action || 'Idea'} ${idea.asset.ticker}` : idea.title,
      ticker: idea.asset?.ticker ?? null,
      age: idea.ageDays ?? 0,
      reason: 'in pipeline',
      onClick: () => idea.primaryAction.onClick(),
    })
  }

  // Thesis work for this portfolio
  const thesisStack = viewModel.advance.stacks.find(s => s.kind === 'thesis')
  const thesisItems = thesisStack?.itemsAll.filter(i => i.portfolio?.id === portfolioId) ?? []
  for (const t of thesisItems.slice(0, 2)) {
    items.push({
      id: t.id,
      type: 'research',
      title: t.asset?.ticker ? `${t.asset.ticker} thesis` : t.title,
      ticker: t.asset?.ticker ?? null,
      age: t.ageDays ?? 0,
      reason: t.severity === 'HIGH' ? 'critically stale' : 'aging',
      onClick: () => t.primaryAction.onClick(),
    })
  }

  return items.slice(0, 6)
}

// ---------------------------------------------------------------------------
// generatePortfolioNarrative — Opinionated summary of portfolio state
// ---------------------------------------------------------------------------

export function generatePortfolioNarrative(
  classified: ClassifiedHolding[],
  workItems: PortfolioWorkItem[],
): PortfolioNarrative {
  const atRisk = classified.filter(h => h.status === 'at-risk')
  const stale = classified.filter(h => h.status === 'stale')
  const opportunities = classified.filter(h => h.status === 'opportunity')
  const decisions = workItems.filter(w => w.type === 'decision')
  const totalLosers = classified.filter(h => h.returnPct < -5)
  const totalReturn = classified.reduce((s, h) => s + h.unrealizedPnl, 0)

  // Build summary
  const parts: string[] = []

  if (atRisk.length > 0) {
    const tickers = atRisk.slice(0, 3).map(h => h.symbol).join(', ')
    parts.push(`${atRisk.length} position${atRisk.length !== 1 ? 's' : ''} at risk (${tickers})`)
  }

  if (decisions.length > 0) {
    parts.push(`${decisions.length} decision${decisions.length !== 1 ? 's' : ''} waiting`)
  }

  if (stale.length >= 3) {
    parts.push(`${stale.length} theses stale`)
  }

  const summary = parts.length > 0
    ? parts.join(', ') + '.'
    : totalReturn >= 0
      ? `Portfolio on track. ${classified.length} positions, no immediate issues.`
      : `Portfolio underperforming. ${totalLosers.length} position${totalLosers.length !== 1 ? 's' : ''} in drawdown.`

  // Build callout — the single most important thing
  let callout: string | null = null
  if (atRisk.length > 0 && decisions.length > 0) {
    const topRisk = atRisk[0]
    callout = `${topRisk.symbol} at ${topRisk.returnPct.toFixed(0)}% with ${topRisk.thesisAgeDays ?? '?'}d stale thesis — resolve or reduce.`
  } else if (atRisk.length >= 3) {
    const totalAtRiskWeight = atRisk.reduce((s, h) => s + h.weight, 0)
    callout = `${totalAtRiskWeight.toFixed(1)}% of portfolio weight is at risk.`
  } else if (decisions.length >= 2) {
    callout = `${decisions.length} decisions stalling — blocking portfolio action.`
  }

  // Build focus suggestion
  let focus: string | null = null
  if (atRisk.length > 0) {
    focus = `Resolve ${atRisk.slice(0, 2).map(h => h.symbol).join(' and ')} first.`
  } else if (decisions.length > 0) {
    focus = `Clear decision queue — ${decisions[0].title}.`
  } else if (stale.length > 0) {
    focus = `Review stale coverage: ${stale.slice(0, 2).map(h => h.symbol).join(', ')}.`
  } else if (opportunities.length > 0) {
    focus = `Evaluate adding to ${opportunities[0].symbol} (+${opportunities[0].returnPct.toFixed(0)}%).`
  }

  return { summary, callout, focus }
}

// ---------------------------------------------------------------------------
// getPortfolioTopPriorities — Ranked actions for the portfolio
// ---------------------------------------------------------------------------

export function getPortfolioTopPriorities(
  classified: ClassifiedHolding[],
  workItems: PortfolioWorkItem[],
): PortfolioPriority[] {
  const priorities: PortfolioPriority[] = []

  // 1. At-risk positions with decisions
  const atRiskWithDecisions = classified
    .filter(h => h.status === 'at-risk' && h.relatedItems.some(i => i.type === 'DECISION'))
  for (const h of atRiskWithDecisions.slice(0, 2)) {
    const decision = h.relatedItems.find(i => i.type === 'DECISION')
    priorities.push({
      id: `priority-decision-${h.assetId}`,
      rank: 0,
      action: `Resolve ${h.symbol}`,
      reason: `${h.returnPct.toFixed(0)}% + decision stalling`,
      ticker: h.symbol,
      severity: 'critical',
      onClick: decision?.primaryAction.onClick,
    })
  }

  // 2. Stalled decisions (not already covered by at-risk)
  const coveredTickers = new Set(priorities.map(p => p.ticker))
  const stalledDecisions = workItems
    .filter(w => w.type === 'decision' && w.age >= 7 && !coveredTickers.has(w.ticker))
  for (const d of stalledDecisions.slice(0, 2)) {
    priorities.push({
      id: `priority-stalled-${d.id}`,
      rank: 0,
      action: d.title,
      reason: `${d.age}d stalled`,
      ticker: d.ticker,
      severity: d.age >= 14 ? 'critical' : 'warning',
      onClick: d.onClick,
    })
  }

  // 3. At-risk positions without decisions
  const atRiskNoDecision = classified
    .filter(h => h.status === 'at-risk' && !atRiskWithDecisions.includes(h))
  for (const h of atRiskNoDecision.slice(0, 2)) {
    priorities.push({
      id: `priority-risk-${h.assetId}`,
      rank: 0,
      action: `Review ${h.symbol}`,
      reason: h.statusReason,
      ticker: h.symbol,
      severity: 'warning',
    })
  }

  // 4. Stale high-weight positions
  const staleHeavy = classified
    .filter(h => h.status === 'stale' && h.weight >= 3 && !coveredTickers.has(h.symbol))
  for (const h of staleHeavy.slice(0, 1)) {
    priorities.push({
      id: `priority-stale-${h.assetId}`,
      rank: 0,
      action: `Update ${h.symbol} thesis`,
      reason: `${h.weight.toFixed(1)}% weight, thesis ${h.thesisAgeDays}d old`,
      ticker: h.symbol,
      severity: 'warning',
    })
  }

  // 5. Pipeline ideas to advance
  const pipelineIdeas = workItems.filter(w => w.type === 'idea' && w.age >= 5)
  if (pipelineIdeas.length > 0) {
    priorities.push({
      id: 'priority-pipeline',
      rank: 0,
      action: `Advance ${pipelineIdeas.length} stalled idea${pipelineIdeas.length !== 1 ? 's' : ''}`,
      reason: `oldest ${Math.max(...pipelineIdeas.map(i => i.age))}d in pipeline`,
      ticker: null,
      severity: 'info',
    })
  }

  // Rank and cap
  return priorities.slice(0, 5).map((p, i) => ({ ...p, rank: i + 1 }))
}
