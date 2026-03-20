/**
 * Trade position change classification.
 *
 * Maps current weight + target weight to a human-readable position change label.
 * This is display-only — the underlying TradeAction enum (buy/sell/add/trim) is unchanged.
 *
 * Rules:
 * - New Long: from 0% to positive
 * - New Short: from 0% to negative
 * - Add: increasing position in same direction
 * - Reduce: decreasing position toward zero
 * - Close: going to exactly 0%
 */

export type PositionChangeLabel = 'New Long' | 'New Short' | 'Add' | 'Reduce' | 'Close' | 'Flip to Short' | 'Flip to Long'

export function classifyPositionChange(
  currentWeight: number,
  targetWeight: number | null,
): PositionChangeLabel | null {
  if (targetWeight == null) return null

  // Close: going to zero
  if (targetWeight === 0 && currentWeight !== 0) return 'Close'

  // New position: from zero to non-zero
  if (currentWeight === 0 || Math.abs(currentWeight) < 0.005) {
    if (targetWeight > 0) return 'New Long'
    if (targetWeight < 0) return 'New Short'
    return null
  }

  // Flip direction
  if (currentWeight > 0 && targetWeight < 0) return 'Flip to Short'
  if (currentWeight < 0 && targetWeight > 0) return 'Flip to Long'

  // Long position changes
  if (currentWeight > 0) {
    if (targetWeight > currentWeight) return 'Add'
    if (targetWeight < currentWeight) return 'Reduce'
    return null
  }

  // Short position changes
  if (currentWeight < 0) {
    if (targetWeight < currentWeight) return 'Add'     // more short
    if (targetWeight > currentWeight) return 'Reduce'  // covering
    return null
  }

  return null
}

/** Color config for position change labels */
export const POSITION_CHANGE_COLORS: Record<PositionChangeLabel, { text: string; bg: string }> = {
  'New Long':  { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  'New Short': { text: 'text-red-700 dark:text-red-400',         bg: 'bg-red-100 dark:bg-red-900/30' },
  'Add':       { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  'Reduce':    { text: 'text-red-700 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/20' },
  'Close':         { text: 'text-gray-700 dark:text-gray-300',       bg: 'bg-gray-100 dark:bg-gray-800' },
  'Flip to Short': { text: 'text-red-700 dark:text-red-400',         bg: 'bg-red-100 dark:bg-red-900/30' },
  'Flip to Long':  { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
}

/**
 * Get a display label from the stored TradeAction + context.
 * Falls back to the raw action if no weight context is available.
 */
export function getTradeActionLabel(
  action: string,
  currentWeight?: number,
  targetWeight?: number | null,
): string {
  // If we have weight context, use the proper classification
  if (currentWeight !== undefined && targetWeight !== undefined && targetWeight !== null) {
    const label = classifyPositionChange(currentWeight, targetWeight)
    if (label) return label
  }

  // Fallback: map raw DB action to display
  switch (action) {
    case 'buy':  return 'Buy'
    case 'sell': return 'Sell'
    case 'add':  return 'Add'
    case 'trim': return 'Reduce'
    default:     return action.charAt(0).toUpperCase() + action.slice(1)
  }
}
