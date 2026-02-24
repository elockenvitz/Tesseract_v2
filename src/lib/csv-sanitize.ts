/**
 * CSV cell sanitizer — prevents formula injection in Excel/Google Sheets.
 *
 * Cells starting with =, +, -, @, \t, \r are interpreted as formulas.
 * We prefix them with a single-tick inside the quoted value.
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/

/**
 * Sanitize a value for safe inclusion in a CSV cell.
 * - Converts to string, escapes double quotes
 * - Prefixes formula-triggering characters with '
 * - Returns a double-quoted CSV cell
 */
export function csvSanitizeCell(value: unknown): string {
  if (value == null) return '""'
  const str = String(value)
  if (str === '') return '""'
  const escaped = str.replace(/"/g, '""')
  if (FORMULA_PREFIX.test(escaped)) {
    return `"'${escaped}"`
  }
  return `"${escaped}"`
}
