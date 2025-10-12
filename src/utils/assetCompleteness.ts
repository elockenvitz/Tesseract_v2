/**
 * Calculates the completeness percentage of an asset based on filled fields.
 *
 * Tracks the following fields:
 * - Thesis tab (3 fields, 50% weight):
 *   - thesis
 *   - where_different
 *   - risks_to_thesis
 *
 * - Outcomes tab (3 fields, 50% weight):
 *   - bull case price target
 *   - base case price target
 *   - bear case price target
 */

interface PriceTarget {
  type: 'bull' | 'base' | 'bear'
  price?: number | null
}

interface AssetCompletenessData {
  thesis?: string | null
  where_different?: string | null
  risks_to_thesis?: string | null
  priceTargets?: PriceTarget[]
}

/**
 * Checks if a text field is meaningfully filled (not just whitespace)
 */
function isFieldFilled(field: string | null | undefined): boolean {
  return !!field && field.trim().length > 0
}

/**
 * Checks if a price target exists
 */
function hasPriceTarget(priceTargets: PriceTarget[] | undefined, caseType: 'bull' | 'base' | 'bear'): boolean {
  if (!priceTargets) return false
  const target = priceTargets.find(pt => pt.type === caseType)
  return !!target && target.price !== null && target.price !== undefined && target.price > 0
}

/**
 * Calculates the completeness percentage for an asset
 * Returns a value between 0 and 100
 */
export function calculateAssetCompleteness(data: AssetCompletenessData): number {
  // Thesis tab fields (50% of total weight, 16.67% each)
  const thesisFields = [
    isFieldFilled(data.thesis),
    isFieldFilled(data.where_different),
    isFieldFilled(data.risks_to_thesis)
  ]

  const thesisScore = thesisFields.filter(Boolean).length / thesisFields.length

  // Outcomes tab fields (50% of total weight, 16.67% each)
  const outcomeFields = [
    hasPriceTarget(data.priceTargets, 'bull'),
    hasPriceTarget(data.priceTargets, 'base'),
    hasPriceTarget(data.priceTargets, 'bear')
  ]

  const outcomeScore = outcomeFields.filter(Boolean).length / outcomeFields.length

  // Calculate weighted average (50% thesis, 50% outcomes)
  const totalScore = (thesisScore * 0.5) + (outcomeScore * 0.5)

  // Convert to percentage and round to nearest integer
  return Math.round(totalScore * 100)
}

/**
 * Gets a human-readable status based on completeness percentage
 */
export function getCompletenessStatus(completeness: number): {
  label: string
  color: string
} {
  if (completeness >= 90) {
    return { label: 'Complete', color: 'green' }
  } else if (completeness >= 70) {
    return { label: 'Nearly Complete', color: 'blue' }
  } else if (completeness >= 40) {
    return { label: 'In Progress', color: 'yellow' }
  } else if (completeness >= 10) {
    return { label: 'Started', color: 'orange' }
  } else {
    return { label: 'Empty', color: 'gray' }
  }
}
