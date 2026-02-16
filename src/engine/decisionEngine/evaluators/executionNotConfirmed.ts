/**
 * A2: Execution Not Confirmed — RED after 2 days post-approval.
 *
 * Condition: decision_outcome='accepted', outcome IS NULL, age >= 2d since decision.
 */

import type { DecisionItem } from '../types'

const EXECUTION_THRESHOLD_DAYS = 2

export function evaluateExecutionNotConfirmed(data: {
  tradeIdeas?: any[]
  now: Date
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.tradeIdeas) return items

  for (const idea of data.tradeIdeas) {
    if (idea.decision_outcome !== 'accepted' || idea.outcome != null) continue

    const decidedAt = new Date(idea.decided_at || idea.updated_at)
    const ageDays = Math.floor((data.now.getTime() - decidedAt.getTime()) / 86400000)
    if (ageDays < EXECUTION_THRESHOLD_DAYS) continue

    const portfolio = idea.portfolios?.name || idea.portfolio_name || 'Unknown'
    const ticker = idea.assets?.symbol || idea.asset_symbol || ''
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

    const action = pairActionLabel
      ?? (idea.action ? idea.action.charAt(0).toUpperCase() + idea.action.slice(1) : '')

    items.push({
      id: `a2-execution-${idea.id}`,
      surface: 'action',
      severity: 'red',
      category: 'process',
      title: isPair ? 'Pair Execution Not Confirmed' : 'Execution Not Confirmed',
      titleKey: 'EXECUTION_NOT_CONFIRMED',
      description: isPair
        ? `Approved pair trade ${ticker} has not been logged as executed.`
        : 'Approved trade has not been logged as executed.',
      chips: [
        { label: 'Portfolio', value: portfolio },
        { label: 'Ticker', value: ticker },
        ...(isPair ? [{ label: 'Type', value: 'Pair' }] : []),
        { label: 'Action', value: isPair ? '' : action },
        { label: 'Age', value: `${ageDays}d` },
      ].filter(c => c.value),
      context: {
        assetId: idea.asset_id,
        assetTicker: ticker,
        portfolioId: idea.portfolio_id,
        portfolioName: portfolio,
        tradeIdeaId,
        action,
        proposedWeight: idea.proposed_weight ?? undefined,
        isPairTrade: isPair || undefined,
      },
      ctas: [
        { label: 'Confirm', actionKey: 'OPEN_TRADE_QUEUE_EXECUTION', kind: 'primary', payload: { tradeIdeaId } },
      ],
      dismissible: false,
      decisionTier: 'capital',
      sortScore: 0,
      createdAt: idea.decided_at || idea.created_at,
    })
  }

  return items
}
