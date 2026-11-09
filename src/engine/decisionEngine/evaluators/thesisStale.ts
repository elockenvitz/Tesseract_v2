/**
 * Thesis Stale — YELLOW after 90 days, ORANGE after 135 days, RED after 180 days.
 *
 * Always surfaces as an action item (stale thesis is actionable).
 * Category: risk.
 *
 * ── A date is not a reason ────────────────────────────────────────────────
 *
 * This fired on the calendar alone: `daysSince >= 90` and nothing else. It
 * never asked whether the book holds the name, so a thesis written 373 days
 * ago on WMT -- not a position, price moved -0.3% -- produced a RED tier-1
 * finding sitting in one of the four slots on Today, the most prominent
 * surface in the product. Nothing had happened. Nothing was at risk. The
 * only fact was that time had passed, which is true of every thesis every
 * morning.
 *
 * Measured live at 1920x889: all four of Today's slots were this finding,
 * and that is the same cause seen from the other end. One evaluator emitting
 * one item per aged thesis regardless of materiality floods the top tier, and
 * `diversify` then cannot find a "materially comparable" alternative to swap
 * in, because everything comparable is also a stale thesis.
 *
 * So age still raises the finding -- an unexamined case IS worth knowing
 * about -- but it no longer earns an interrupt on its own. Capital at risk
 * is what makes it urgent, and a name the book does not hold is capped at
 * the lowest severity and reports itself through Also watching instead of
 * taking a slot from something that happened.
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
  /**
   * The assets the book actually holds.
   *
   * Already fetched: `useDecisionEngine` queries `portfolio_holdings` to build
   * the coverage universe and then merges those ids with "assets this user has
   * written about", which is what made held and merely-researched
   * indistinguishable by the time an evaluator saw them. Kept separate costs
   * no round trip.
   *
   * Absent means unknown, and unknown is treated as not held -- the direction
   * that under-claims rather than the one that invents a position.
   */
  heldAssetIds?: ReadonlySet<string>
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

    const held = !!thesis.asset_id && !!data.heldAssetIds?.has(thesis.asset_id)

    /*
     * Age sets the severity only where capital is behind the case.
     *
     * An unheld name is capped at `yellow` however old its thesis is. Not
     * dropped: the work is still real and Today still counts it as
     * evaluated, so it reports itself in Also watching rather than
     * disappearing. What it loses is the claim on a slot.
     */
    const severity: DecisionSeverity = !held ? 'yellow'
      : daysSince >= RED_THRESHOLD_DAYS ? 'red'
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
        held,
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
