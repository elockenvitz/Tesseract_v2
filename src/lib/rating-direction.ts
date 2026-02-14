/**
 * Rating direction inference and EV conflict detection.
 *
 * Maps analyst rating values (OW, BUY, etc.) to a directional signal
 * and detects when a user's rating contradicts their probability-weighted EV.
 *
 * For built-in system scales, direction is inferred from a static map.
 * For custom scales, direction must be explicitly set via a `direction`
 * field on each scale value. If missing, returns null (fail closed —
 * no EV mismatch badge shown rather than risk false positives).
 */

import type { RatingScaleValue } from '../hooks/useAnalystRatings'

export type RatingDirection = 'positive' | 'neutral' | 'negative'

/** Static map covering all 4 built-in system scales */
const KNOWN_DIRECTIONS: Record<string, RatingDirection> = {
  // Weight Scale
  OW: 'positive',
  N: 'neutral',
  UW: 'negative',
  // Buy/Hold/Sell
  BUY: 'positive',
  HOLD: 'neutral',
  SELL: 'negative',
  // Five-Tier
  STRONG_BUY: 'positive',
  STRONG_SELL: 'negative',
  // Numeric 1-5
  '1': 'positive',
  '2': 'positive',
  '3': 'neutral',
  '4': 'negative',
  '5': 'negative',
}

/**
 * Infer the directional signal of a rating value.
 *
 * 1. Check the static KNOWN_DIRECTIONS map (handles all built-in system scales).
 * 2. Check for explicit `direction` metadata on the scale value (custom scales).
 * 3. If neither matches, return null — fail closed (no EV mismatch badge).
 */
export function getRatingDirection(
  value: string,
  scaleValues: RatingScaleValue[]
): RatingDirection | null {
  // 1. Static map for built-in scales
  const normalized = value.toUpperCase().replace(/\s+/g, '_')
  if (KNOWN_DIRECTIONS[normalized]) return KNOWN_DIRECTIONS[normalized]

  // 2. Explicit direction metadata on the scale value (custom scales)
  const sv = scaleValues.find(v => v.value === value)
  if (sv && (sv as RatingScaleValueWithDirection).direction) {
    const dir = (sv as RatingScaleValueWithDirection).direction
    if (dir === 'positive' || dir === 'neutral' || dir === 'negative') return dir
  }

  // 3. Unknown — fail closed
  return null
}

/** Extended type for scale values that may carry explicit direction metadata */
interface RatingScaleValueWithDirection extends RatingScaleValue {
  direction?: 'positive' | 'neutral' | 'negative'
}

/**
 * Detect whether a rating direction conflicts with expected-value return.
 *
 * Thresholds are intentionally generous to avoid false positives:
 * - positive rating + EV <= -10% => conflict
 * - negative rating + EV >= +10% => conflict
 * - neutral rating + |EV| >= 20% => conflict
 */
export function isDirectionConflict(
  direction: RatingDirection,
  evReturn: number
): boolean {
  if (direction === 'positive' && evReturn <= -0.10) return true
  if (direction === 'negative' && evReturn >= 0.10) return true
  if (direction === 'neutral' && Math.abs(evReturn) >= 0.20) return true
  return false
}
