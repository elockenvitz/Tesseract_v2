/**
 * Rating Changed, No Follow-up — BLUE or ORANGE action item.
 *
 * Condition: rating changed in last 7 days AND no idea/proposal
 * updated since the change.
 * ORANGE if direction is a significant swing (e.g., BUY→SELL).
 * BLUE for minor changes.
 * Always surfaces as an action item (user should act on the gap).
 * Category: risk.
 */

import type { DecisionItem } from '../types'

const LOOKBACK_DAYS = 14

const SIGNIFICANT_SWINGS = new Set([
  'BUY→SELL', 'SELL→BUY',
  'OW→UW', 'UW→OW',
  'STRONG BUY→SELL', 'SELL→STRONG BUY',
])

export function evaluateRatingNoFollowup(data: {
  ratingChanges?: any[]
  tradeIdeas?: any[]
  now: Date
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.ratingChanges || data.ratingChanges.length === 0) return items

  // Build map: assetId → latest trade idea created_at
  const latestIdeaByAsset = new Map<string, string>()
  if (data.tradeIdeas) {
    for (const idea of data.tradeIdeas) {
      const existing = latestIdeaByAsset.get(idea.asset_id)
      if (!existing || idea.created_at > existing) {
        latestIdeaByAsset.set(idea.asset_id, idea.created_at)
      }
    }
  }

  for (const change of data.ratingChanges) {
    const changedAt = new Date(change.changed_at)
    const daysSince = Math.floor((data.now.getTime() - changedAt.getTime()) / 86400000)
    if (daysSince > LOOKBACK_DAYS) continue

    // Check if any idea was created/updated after the rating change
    const assetId = change.asset_id
    const latestIdea = latestIdeaByAsset.get(assetId)
    if (latestIdea && new Date(latestIdea) >= changedAt) continue

    const swingKey = `${(change.old_value || '').toUpperCase()}→${(change.new_value || '').toUpperCase()}`
    const isSignificant = SIGNIFICANT_SWINGS.has(swingKey)
    const ticker = change.asset_symbol || change.assets?.symbol || ''

    items.push({
      id: `i1-rating-${change.id || change.rating_id}-${daysSince}`,
      surface: 'action',
      severity: isSignificant ? 'orange' : 'blue',
      category: 'risk',
      title: 'Rating Changed, No Follow-up',
      titleKey: 'RATING_NO_FOLLOWUP',
      description: 'Rating changed without a corresponding trade idea.',
      chips: [
        { label: 'Ticker', value: ticker },
        { label: 'From', value: change.old_value || '?' },
        { label: 'To', value: change.new_value || '?' },
        { label: 'Changed', value: `${daysSince}d ago` },
      ].filter(c => c.value),
      context: {
        assetId,
        assetTicker: ticker,
        ratingFrom: change.old_value || undefined,
        ratingTo: change.new_value || undefined,
      },
      ctas: [
        { label: 'Create Idea', actionKey: 'OPEN_ASSET_CREATE_IDEA', kind: 'primary', payload: { assetId, assetTicker: ticker } },
      ],
      dismissible: false,
      decisionTier: 'integrity',
      sortScore: 0,
      createdAt: change.changed_at,
    })
  }

  return items
}
