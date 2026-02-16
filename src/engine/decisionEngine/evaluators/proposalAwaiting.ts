/**
 * A1: Proposal Awaiting Decision — age-based severity tiers.
 *
 * Tiers: Stale (10d+ red), Aging (5d+ orange), Waiting (<5d blue).
 * Urgency field from the trade idea bumps severity up one tier.
 *
 * When user is an analyst (not the proposal's owner/PM), the item shows
 * "Awaiting PM" status with a "Prompt PM" CTA instead of "Review".
 */

import type { DecisionItem, DecisionSeverity } from '../types'

const STALE_THRESHOLD_DAYS = 10
const AGING_THRESHOLD_DAYS = 5

function proposalSeverity(ageDays: number): DecisionSeverity {
  if (ageDays >= STALE_THRESHOLD_DAYS) return 'red'
  if (ageDays >= AGING_THRESHOLD_DAYS) return 'orange'
  return 'blue'
}

export function evaluateProposalAwaiting(data: {
  tradeIdeas?: any[]
  now: Date
  userId?: string
  role?: string
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.tradeIdeas) return items

  const isAnalyst = data.role === 'analyst'

  for (const idea of data.tradeIdeas) {
    if (idea.stage !== 'deciding' || idea.decision_outcome != null) continue

    const updatedAt = new Date(idea.updated_at || idea.created_at)
    const ageDays = Math.floor((data.now.getTime() - updatedAt.getTime()) / 86400000)

    const portfolio = idea.portfolios?.name || idea.portfolio_name || 'Unknown'
    const ticker = idea.assets?.symbol || idea.asset_symbol || ''
    const isPair = !!idea._isPairTrade

    // Analyst who didn't create the proposal → can't review, can only prompt PM
    const isCreator = data.userId && idea.created_by === data.userId
    const needsPM = isAnalyst && !isCreator

    // For pair trades, navigate to the first leg's trade queue entry
    const tradeIdeaId = isPair ? idea._pairLegIds?.[0] ?? idea.id : idea.id

    const ctas = needsPM
      ? [{
          label: 'Prompt PM',
          actionKey: 'OPEN_PROMPT_PM' as const,
          kind: 'primary' as const,
          payload: {
            assetId: idea.asset_id,
            assetTicker: ticker,
            portfolioId: idea.portfolio_id,
            tradeIdeaId,
            prefillText: `Proposal for ${ticker} in ${portfolio} has been awaiting decision for ${ageDays} days. Can you review?`,
          },
        }]
      : [{
          label: 'Review',
          actionKey: 'OPEN_TRADE_QUEUE_PROPOSAL' as const,
          kind: 'primary' as const,
          payload: { tradeIdeaId },
        }]

    // Build pair trade display strings
    const buyTickers: string[] = idea._buyTickers ?? []
    const sellTickers: string[] = idea._sellTickers ?? []
    const pairActionLabel = isPair
      ? [
          buyTickers.length > 0 ? `Buy ${buyTickers.join(', ')}` : null,
          sellTickers.length > 0 ? `Sell ${sellTickers.join(', ')}` : null,
        ].filter(Boolean).join(' / ')
      : null

    const title = needsPM
      ? (isPair ? 'Awaiting PM Decision' : 'Awaiting PM Decision')
      : (isPair ? 'Awaiting Your Decision' : 'Awaiting Your Decision')

    items.push({
      id: `a1-proposal-${idea.id}`,
      surface: 'action',
      severity: proposalSeverity(ageDays),
      category: 'process',
      title,
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      description: needsPM
        ? `Your proposal for ${ticker} needs PM sign-off (${ageDays}d).`
        : `${ticker} proposal needs your decision (${ageDays}d).`,
      chips: [
        { label: 'Portfolio', value: portfolio },
        { label: 'Ticker', value: ticker },
        ...(isPair ? [{ label: 'Type', value: 'Pair' }] : []),
        { label: 'Age', value: `${ageDays}d` },
      ].filter(c => c.value),
      context: {
        assetId: idea.asset_id,
        assetTicker: ticker,
        portfolioId: idea.portfolio_id,
        portfolioName: portfolio,
        tradeIdeaId,
        action: pairActionLabel
          ?? (idea.action ? idea.action.charAt(0).toUpperCase() + idea.action.slice(1) : undefined),
        urgency: idea.urgency || undefined,
        rationale: idea.rationale || undefined,
        proposedWeight: idea.proposed_weight ?? undefined,
        isPairTrade: isPair || undefined,
      },
      ctas,
      dismissible: false,
      decisionTier: 'capital',
      sortScore: 0, // computed in postprocess
      createdAt: idea.updated_at || idea.created_at,
    })
  }

  return items
}
