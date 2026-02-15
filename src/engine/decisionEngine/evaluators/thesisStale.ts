/**
 * Thesis Stale — ORANGE after 90 days, RED after 180 days.
 *
 * Always surfaces as an action item (stale thesis is actionable).
 * Category: risk.
 */

import type { DecisionItem, DecisionSeverity } from '../types'

const ORANGE_THRESHOLD_DAYS = 90
const RED_THRESHOLD_DAYS = 180

export function evaluateThesisStale(data: {
  thesisUpdates?: any[]
  now: Date
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.thesisUpdates) return items

  for (const thesis of data.thesisUpdates) {
    const updatedAt = new Date(thesis.updated_at)
    const daysSince = Math.floor((data.now.getTime() - updatedAt.getTime()) / 86400000)
    if (daysSince < ORANGE_THRESHOLD_DAYS) continue

    const severity: DecisionSeverity = daysSince >= RED_THRESHOLD_DAYS ? 'red' : 'orange'
    const ticker = thesis.asset_symbol || thesis.assets?.symbol || ''

    items.push({
      id: `thesis-stale-${thesis.asset_id}-${thesis.created_by || 'agg'}`,
      surface: 'action',
      severity,
      category: 'risk',
      title: 'Thesis May Be Stale',
      titleKey: 'THESIS_STALE',
      description: 'Research thesis has not been updated recently.',
      chips: [
        { label: 'Ticker', value: ticker },
        { label: 'Age', value: `${daysSince}d` },
      ].filter(c => c.value),
      context: {
        assetId: thesis.asset_id,
        assetTicker: ticker,
      },
      ctas: [
        { label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary', payload: { assetId: thesis.asset_id, assetTicker: ticker } },
      ],
      dismissible: false,
      decisionTier: 'coverage',
      sortScore: 0,
      createdAt: thesis.updated_at,
    })
  }

  return items
}
