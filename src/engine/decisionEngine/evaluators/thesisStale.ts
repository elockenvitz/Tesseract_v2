/**
 * Thesis Stale — YELLOW after 90 days, ORANGE after 135 days, RED after 180 days.
 *
 * Always surfaces as an action item (stale thesis is actionable).
 * Category: risk.
 */

import type { DecisionItem, DecisionSeverity } from '../types'
import { thesisAgeDays } from '../../../lib/memory/thesis-review'

const YELLOW_THRESHOLD_DAYS = 90
const ORANGE_THRESHOLD_DAYS = 135
const RED_THRESHOLD_DAYS = 180

export function evaluateThesisStale(data: {
  thesisUpdates?: any[]
  /**
   * Newest `thesis.reviewed` per asset id.
   *
   * Stale means nobody has looked, not merely that nobody has typed. Without
   * this the only way to clear the finding was to edit a thesis that did not
   * need editing, so it returned every morning and "three people read this and
   * agreed" was indistinguishable from "nobody has looked in 100 days".
   */
  thesisReviews?: Map<string, string>
  now: Date
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.thesisUpdates) return items

  for (const thesis of data.thesisUpdates) {
    // The later of written and last confirmed. `thesis.updated_at` is still
    // the date shown anywhere this item is rendered; only the clock moves.
    const daysSince = thesisAgeDays(
      thesis.updated_at,
      data.thesisReviews?.get(thesis.asset_id) ?? null,
      data.now,
    ) ?? 0
    if (daysSince < YELLOW_THRESHOLD_DAYS) continue

    const severity: DecisionSeverity =
      daysSince >= RED_THRESHOLD_DAYS ? 'red'
      : daysSince >= ORANGE_THRESHOLD_DAYS ? 'orange'
      : 'yellow'
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
