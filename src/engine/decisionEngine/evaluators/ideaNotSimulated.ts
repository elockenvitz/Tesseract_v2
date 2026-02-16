/**
 * A3: Ideas Being Worked On — trade ideas in the pre-deciding pipeline.
 *
 * Captures ALL active trade ideas in 'idea' or 'simulating' stages.
 * These appear in ADVANCE as "Ideas Being Worked On" and can be
 * filtered to "Ideas Being Modeled" (simulating only) via the pipeline.
 */

import type { DecisionItem } from '../types'

export function evaluateIdeaNotSimulated(data: {
  tradeIdeas?: any[]
  proposals?: any[]
  now: Date
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.tradeIdeas) return items

  for (const idea of data.tradeIdeas) {
    // Only active ideas without an outcome
    if (idea.outcome != null) continue
    // Only pre-deciding stages (idea + simulating)
    if (idea.stage !== 'idea' && idea.stage !== 'simulating') continue

    const createdAt = new Date(idea.created_at)
    const ageDays = Math.floor((data.now.getTime() - createdAt.getTime()) / 86400000)

    const ticker = idea.assets?.symbol || idea.asset_symbol || ''
    const portfolio = idea.portfolios?.name || idea.portfolio_name || ''
    const isPair = !!idea._isPairTrade
    const tradeIdeaId = isPair ? idea._pairLegIds?.[0] ?? idea.id : idea.id

    // Build pair trade display strings
    const buyTickers: string[] = idea._buyTickers ?? []
    const sellTickers: string[] = idea._sellTickers ?? []
    const pairActionLabel = isPair
      ? [
          buyTickers.length > 0 ? `Buy ${buyTickers.join(', ')}` : null,
          sellTickers.length > 0 ? `Sell ${sellTickers.join(', ')}` : null,
        ].filter(Boolean).join(' / ')
      : null

    const isModeling = idea.stage === 'simulating'

    items.push({
      id: `a3-unsimulated-${idea.id}`,
      surface: 'action',
      severity: 'orange',
      category: 'process',
      title: isPair
        ? (isModeling ? 'Pair Trade Being Modeled' : 'Pair Trade Being Worked On')
        : (isModeling ? 'Idea Being Modeled' : 'Idea Being Worked On'),
      titleKey: 'IDEA_NOT_SIMULATED',
      description: isModeling
        ? (isPair ? `Pair trade ${ticker} is being modeled.` : 'Trade idea is being modeled.')
        : (isPair ? `Pair trade ${ticker} is in the pipeline.` : 'Trade idea is in the pipeline.'),
      chips: [
        { label: 'Ticker', value: ticker },
        ...(isPair ? [{ label: 'Type', value: 'Pair' }] : []),
        { label: 'Age', value: `${ageDays}d` },
        ...(portfolio ? [{ label: 'Portfolio', value: portfolio }] : []),
      ],
      context: {
        assetId: idea.asset_id,
        assetTicker: ticker,
        tradeIdeaId,
        portfolioId: idea.portfolio_id,
        portfolioName: portfolio || undefined,
        action: pairActionLabel
          ?? (idea.action ? idea.action.charAt(0).toUpperCase() + idea.action.slice(1) : undefined),
        proposedWeight: idea.proposed_weight ?? undefined,
        isPairTrade: isPair || undefined,
        stage: idea.stage,
      },
      ctas: [
        { label: 'Simulate', actionKey: 'OPEN_TRADE_LAB_SIMULATION', kind: 'primary', payload: { assetId: idea.asset_id, tradeIdeaId } },
      ],
      dismissible: false,
      decisionTier: 'capital',
      sortScore: 0,
      createdAt: idea.created_at,
    })
  }

  return items
}
