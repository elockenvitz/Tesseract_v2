/**
 * A1: Proposal Awaiting Decision — RED after 3 days pending.
 *
 * Condition: trade idea in 'deciding' stage, decision_outcome IS NULL, age >= 3d.
 *
 * When user is an analyst (not the proposal's owner/PM), the item shows
 * "Awaiting PM" status with a "Prompt PM" CTA instead of "Review".
 */

import type { DecisionItem } from '../types'

const STALLED_THRESHOLD_DAYS = 3

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
    if (ageDays < STALLED_THRESHOLD_DAYS) continue

    const portfolio = idea.portfolios?.name || idea.portfolio_name || 'Unknown'
    const ticker = idea.assets?.symbol || idea.asset_symbol || ''

    // Analyst who didn't create the proposal → can't review, can only prompt PM
    const isCreator = data.userId && idea.created_by === data.userId
    const needsPM = isAnalyst && !isCreator

    const ctas = needsPM
      ? [{
          label: 'Prompt PM',
          actionKey: 'OPEN_PROMPT_PM' as const,
          kind: 'primary' as const,
          payload: {
            assetId: idea.asset_id,
            assetTicker: ticker,
            portfolioId: idea.portfolio_id,
            tradeIdeaId: idea.id,
            prefillText: `Proposal for ${ticker} in ${portfolio} has been awaiting decision for ${ageDays} days. Can you review?`,
          },
        }]
      : [{
          label: 'Review',
          actionKey: 'OPEN_TRADE_QUEUE_PROPOSAL' as const,
          kind: 'primary' as const,
          payload: { tradeIdeaId: idea.id },
        }]

    items.push({
      id: `a1-proposal-${idea.id}`,
      surface: 'action',
      severity: 'red',
      category: 'process',
      title: needsPM ? 'Awaiting PM' : 'Proposal Awaiting Decision',
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      description: needsPM
        ? `Proposal for ${ticker} needs PM decision (${ageDays}d).`
        : 'Proposal pending longer than expected.',
      chips: [
        { label: 'Portfolio', value: portfolio },
        { label: 'Ticker', value: ticker },
        { label: 'Age', value: `${ageDays}d` },
      ].filter(c => c.value),
      context: {
        assetId: idea.asset_id,
        assetTicker: ticker,
        portfolioId: idea.portfolio_id,
        portfolioName: portfolio,
        tradeIdeaId: idea.id,
        action: idea.action ? idea.action.charAt(0).toUpperCase() + idea.action.slice(1) : undefined,
        urgency: idea.urgency || undefined,
        rationale: idea.rationale || undefined,
      },
      ctas,
      dismissible: false,
      decisionTier: 'capital',
      sortScore: 0, // computed in postprocess
      createdAt: idea.created_at,
    })
  }

  return items
}
