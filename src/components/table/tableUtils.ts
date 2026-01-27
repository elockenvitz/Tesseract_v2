/**
 * Professional Table Utilities
 * Formatting and helper functions for financial data display
 */

/**
 * Format a price with proper currency formatting
 * Examples: 1234.56 -> "$1,234.56", 0.5 -> "$0.50"
 */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—'

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Format a price change percentage
 * Examples: 2.5 -> "+2.50%", -1.23 -> "-1.23%"
 */
export function formatPriceChange(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—'

  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/**
 * Format large numbers with abbreviations
 * Examples: 1234567 -> "1.23M", 1234567890 -> "1.23B"
 */
export function formatLargeNumber(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—'

  const absValue = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (absValue >= 1e12) {
    return `${sign}${(absValue / 1e12).toFixed(2)}T`
  }
  if (absValue >= 1e9) {
    return `${sign}${(absValue / 1e9).toFixed(2)}B`
  }
  if (absValue >= 1e6) {
    return `${sign}${(absValue / 1e6).toFixed(2)}M`
  }
  if (absValue >= 1e3) {
    return `${sign}${(absValue / 1e3).toFixed(1)}K`
  }

  return value.toLocaleString()
}

/**
 * Format volume with appropriate units
 */
export function formatVolume(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—'
  return formatLargeNumber(value)
}

/**
 * Get the CSS class for price change direction
 */
export function getPriceChangeClass(change: number | null | undefined): 'up' | 'down' | 'neutral' {
  if (change == null || isNaN(change) || change === 0) return 'neutral'
  return change > 0 ? 'up' : 'down'
}

/**
 * Format a relative timestamp for display
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—'

  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Get staleness level for timestamps
 */
export function getTimestampFreshness(date: Date | string | null | undefined): 'recent' | 'normal' | 'stale' {
  if (!date) return 'stale'

  const d = typeof date === 'string' ? new Date(date) : date
  const diffMs = Date.now() - d.getTime()
  const diffHours = diffMs / 3600000

  if (diffHours < 24) return 'recent'
  if (diffHours < 168) return 'normal' // 1 week
  return 'stale'
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string | null | undefined, maxLength: number = 50): string {
  if (!text) return ''
  if (text.length <= maxLength) return text

  const truncated = text.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > maxLength * 0.7) {
    return truncated.substring(0, lastSpace) + '...'
  }

  return truncated + '...'
}

/**
 * Get initials from a name
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?'

  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/**
 * Sort comparison function for various data types
 */
export function createSortComparator<T>(
  field: keyof T,
  order: 'asc' | 'desc' = 'asc'
): (a: T, b: T) => number {
  const multiplier = order === 'asc' ? 1 : -1

  return (a: T, b: T) => {
    const aVal = a[field]
    const bVal = b[field]

    // Handle null/undefined
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1 * multiplier
    if (bVal == null) return -1 * multiplier

    // String comparison
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * multiplier
    }

    // Number comparison
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * multiplier
    }

    // Date comparison
    if (aVal instanceof Date && bVal instanceof Date) {
      return (aVal.getTime() - bVal.getTime()) * multiplier
    }

    return 0
  }
}
