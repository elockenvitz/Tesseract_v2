/**
 * Workflow Name Suffix Utilities
 *
 * Helper functions for processing dynamic placeholders in workflow name suffixes.
 * These functions mirror the database functions in migration 20251023000000_add_unique_workflow_name_generator.sql
 * Keep them in sync to ensure consistent behavior between frontend preview and backend execution.
 *
 * Extracted from WorkflowsPage.tsx during refactoring.
 */

export function getCurrentQuarter(): number {
  const month = new Date().getMonth() + 1 // getMonth() returns 0-11
  return Math.ceil(month / 3)
}

export function getCurrentYear(): number {
  return new Date().getFullYear()
}

export function getQuarterMonths(quarter: number): { start: string; end: string } {
  const months = {
    1: { start: 'Jan', end: 'Mar' },
    2: { start: 'Apr', end: 'Jun' },
    3: { start: 'Jul', end: 'Sep' },
    4: { start: 'Oct', end: 'Dec' }
  }
  return months[quarter as keyof typeof months]
}

/**
 * Processes dynamic placeholders in workflow name suffixes
 *
 * Available placeholders:
 * - {Q} = Quarter number (1-4)
 * - {QUARTER} = Quarter with Q prefix (Q1-Q4)
 * - {YEAR} = Full year (e.g., 2025)
 * - {YY} = Short year (e.g., 25)
 * - {MONTH} = Current month abbreviation (e.g., Oct)
 * - {START_MONTH} = Quarter start month (e.g., Apr for Q2)
 * - {END_MONTH} = Quarter end month (e.g., Jun for Q2)
 * - {DATE} = Full date (e.g., "Oct 15 2025")
 * - {DAY} = Current day (e.g., 15)
 *
 * Example: "{Q}{YEAR}" becomes "42025" in Q4 2025
 *
 * NOTE: This function is for preview only. The actual backend uses
 * process_dynamic_suffix() in PostgreSQL which guarantees uniqueness.
 *
 * @param suffix - The template suffix with placeholders
 * @returns The processed suffix with placeholders replaced
 */
export function processDynamicSuffix(suffix: string): string {
  if (!suffix) return ''

  const now = new Date()
  const quarter = getCurrentQuarter()
  const year = getCurrentYear()
  const months = getQuarterMonths(quarter)
  const currentMonth = now.toLocaleString('en-US', { month: 'short' })
  const currentDay = now.getDate()
  const formattedDate = `${currentMonth} ${currentDay} ${year}`

  return suffix
    .replace(/{Q}/g, quarter.toString())
    .replace(/{QUARTER}/g, `Q${quarter}`)
    .replace(/{YEAR}/g, year.toString())
    .replace(/{YY}/g, year.toString().slice(-2))
    .replace(/{MONTH}/g, currentMonth)
    .replace(/{START_MONTH}/g, months.start)
    .replace(/{END_MONTH}/g, months.end)
    .replace(/{DATE}/g, formattedDate)
    .replace(/{DAY}/g, currentDay.toString())
}
