/**
 * A3: Idea Not Simulated — ORANGE after 3 days since idea creation.
 *
 * Condition: trade idea exists (active, no outcome), no proposal/variant found,
 * created >= 3 days ago.
 */

import type { DecisionItem } from '../types'

const UNSIMULATED_THRESHOLD_DAYS = 3

export function evaluateIdeaNotSimulated(data: {
  tradeIdeas?: any[]
  proposals?: any[]
  now: Date
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.tradeIdeas) return items

  // Build set of idea IDs that have proposals/variants
  const simulatedIds = new Set<string>()
  if (data.proposals) {
    for (const p of data.proposals) {
      if (p.trade_queue_item_id) simulatedIds.add(p.trade_queue_item_id)
    }
  }

  for (const idea of data.tradeIdeas) {
    // Only active ideas without an outcome
    if (idea.outcome != null) continue
    // Skip if already at deciding stage or beyond (has a proposal flow)
    if (idea.stage === 'deciding') continue
    // Skip if simulated
    if (simulatedIds.has(idea.id)) continue

    const createdAt = new Date(idea.created_at)
    const ageDays = Math.floor((data.now.getTime() - createdAt.getTime()) / 86400000)
    if (ageDays < UNSIMULATED_THRESHOLD_DAYS) continue

    const ticker = idea.assets?.symbol || idea.asset_symbol || ''
    const portfolio = idea.portfolios?.name || idea.portfolio_name || ''

    items.push({
      id: `a3-unsimulated-${idea.id}`,
      surface: 'action',
      severity: 'orange',
      category: 'process',
      title: 'Idea Not Simulated',
      titleKey: 'IDEA_NOT_SIMULATED',
      description: 'Trade idea created without portfolio impact test.',
      chips: [
        { label: 'Ticker', value: ticker },
        { label: 'Age', value: `${ageDays}d` },
        ...(portfolio ? [{ label: 'Portfolio', value: portfolio }] : []),
      ],
      context: {
        assetId: idea.asset_id,
        assetTicker: ticker,
        tradeIdeaId: idea.id,
        portfolioId: idea.portfolio_id,
        portfolioName: portfolio || undefined,
      },
      ctas: [
        { label: 'Simulate', actionKey: 'OPEN_TRADE_LAB_SIMULATION', kind: 'primary', payload: { assetId: idea.asset_id, tradeIdeaId: idea.id } },
      ],
      dismissible: false,
      decisionTier: 'capital',
      sortScore: 0,
      createdAt: idea.created_at,
    })
  }

  return items
}
