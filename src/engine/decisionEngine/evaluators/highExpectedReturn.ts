/**
 * I3: High Expected Return, No Idea — BLUE.
 *
 * Condition: expectedReturn >= 25% and no active idea for the asset.
 * If expectedReturn data not available, skip gracefully.
 */

import type { DecisionItem } from '../types'

const EV_THRESHOLD = 0.25

export function evaluateHighExpectedReturn(data: {
  assets?: any[]
  tradeIdeas?: any[]
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.assets) return items

  // Build set of assetIds with active ideas
  const assetsWithIdeas = new Set<string>()
  if (data.tradeIdeas) {
    for (const idea of data.tradeIdeas) {
      if (idea.outcome == null) {
        assetsWithIdeas.add(idea.asset_id)
      }
    }
  }

  for (const asset of data.assets) {
    if (asset.expectedReturn == null) continue
    if (Math.abs(asset.expectedReturn) < EV_THRESHOLD) continue
    if (assetsWithIdeas.has(asset.id)) continue

    const evPct = Math.abs(asset.expectedReturn * 100).toFixed(0)
    const direction = asset.expectedReturn > 0 ? 'upside' : 'downside'
    const ticker = asset.symbol || ''

    items.push({
      id: `i3-ev-${asset.id}`,
      surface: 'intel',
      severity: 'blue',
      category: 'alpha',
      title: 'High EV, No Idea',
      titleKey: 'HIGH_EV_NO_IDEA',
      description: 'Model implies significant expected value with no trade idea.',
      chips: [
        { label: 'Ticker', value: ticker },
        { label: 'EV', value: `${evPct}% ${direction}` },
      ],
      context: {
        assetId: asset.id,
        assetTicker: ticker,
      },
      ctas: [
        { label: 'Create Idea', actionKey: 'OPEN_ASSET_CREATE_IDEA', kind: 'primary', payload: { assetId: asset.id, assetTicker: ticker } },
        { label: 'Dismiss', actionKey: 'DISMISS', kind: 'secondary' },
      ],
      dismissible: true,
      decisionTier: 'coverage',
      sortScore: 0,
    })
  }

  return items
}
