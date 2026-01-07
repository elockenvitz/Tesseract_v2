import * as XLSX from 'xlsx'
import type { FieldMapping, DetectionRules, ModelTemplate, DynamicFieldMapping } from '../hooks/useModelTemplates'

// ============================================================================
// TYPES
// ============================================================================

export interface ParsedValue {
  field: string
  cell: string
  rawValue: any
  formattedValue: string | number | null
  type: FieldMapping['type']
  label?: string
  // For estimate fields
  metricKey?: string
  periodType?: 'annual' | 'quarterly'
  fiscalYear?: number
  fiscalQuarter?: number
}

export interface ParseResult {
  success: boolean
  values: ParsedValue[]
  errors: string[]
  sheetNames: string[]
  detectedTemplate?: ModelTemplate
}

// ============================================================================
// CELL REFERENCE PARSING
// ============================================================================

/**
 * Parse an Excel cell reference like "Summary!B5" or "B5"
 * Returns { sheet: string | null, cell: string }
 */
function parseCellReference(ref: string): { sheet: string | null; cell: string } {
  // Trim whitespace and handle edge cases
  const trimmed = ref.trim()
  if (!trimmed) {
    return { sheet: null, cell: '' }
  }

  const match = trimmed.match(/^(?:(.+)!)?([A-Z]+[0-9]+)$/i)
  if (!match) {
    return { sheet: null, cell: trimmed }
  }
  return {
    sheet: match[1]?.trim() || null,
    cell: match[2].toUpperCase()
  }
}

/**
 * Get cell value from a workbook given a cell reference
 * Returns found: true if cell has data, empty: true if cell exists but is empty
 */
function getCellValue(
  workbook: XLSX.WorkBook,
  cellRef: string,
  defaultSheet?: string
): { value: any; found: boolean; empty?: boolean; sheetFound?: boolean } {
  const { sheet: sheetName, cell } = parseCellReference(cellRef)
  let targetSheet = sheetName || defaultSheet

  if (!targetSheet) {
    return { value: null, found: false, sheetFound: false }
  }

  // Try exact match first
  let worksheet = workbook.Sheets[targetSheet]

  // If not found, try case-insensitive match
  if (!worksheet) {
    const lowerTarget = targetSheet.toLowerCase()
    const matchingSheet = workbook.SheetNames.find(
      name => name.toLowerCase() === lowerTarget
    )
    if (matchingSheet) {
      worksheet = workbook.Sheets[matchingSheet]
    }
  }

  // Last resort: if we have a sheet name prefix but it doesn't match,
  // try the first sheet as fallback
  if (!worksheet && sheetName && workbook.SheetNames.length > 0) {
    worksheet = workbook.Sheets[workbook.SheetNames[0]]
  }

  if (!worksheet) {
    return { value: null, found: false, sheetFound: false }
  }

  // Try exact cell reference
  let cellData = worksheet[cell]

  // If not found, try uppercase (XLSX typically uses uppercase)
  if (!cellData && cell !== cell.toUpperCase()) {
    cellData = worksheet[cell.toUpperCase()]
  }

  if (!cellData) {
    // Cell exists in range but is empty
    return { value: null, found: false, empty: true, sheetFound: true }
  }

  // Return the value (v) or formatted text (w)
  return {
    value: cellData.v !== undefined ? cellData.v : cellData.w,
    found: true,
    sheetFound: true
  }
}

// ============================================================================
// VALUE FORMATTING
// ============================================================================

/**
 * Format a raw cell value based on the field type
 */
function formatValue(
  rawValue: any,
  type: FieldMapping['type']
): string | number | null {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return null
  }

  switch (type) {
    case 'currency':
    case 'number':
    case 'percent':
    case 'multiple':
      // Try to parse as number
      // For multiples, strip trailing 'x' if present
      let valueToProcess = rawValue
      if (type === 'multiple' && typeof rawValue === 'string') {
        valueToProcess = rawValue.replace(/x$/i, '').trim()
      }
      const num = typeof valueToProcess === 'number' ? valueToProcess : parseFloat(String(valueToProcess).replace(/[$,]/g, ''))
      if (isNaN(num)) return null
      // For percent, check if already decimal (0.05) or whole (5)
      if (type === 'percent' && Math.abs(num) > 1) {
        return num / 100
      }
      return num

    case 'date':
      // Excel dates are numbers (days since 1900)
      if (typeof rawValue === 'number') {
        const date = XLSX.SSF.parse_date_code(rawValue)
        if (date) {
          return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
        }
      }
      return String(rawValue)

    case 'text':
    default:
      return String(rawValue)
  }
}

/**
 * Format a value for display based on the field type
 * This adds visual formatting like currency symbols, percent signs, and 'x' for multiples
 */
export function formatValueForDisplay(
  value: string | number | null,
  type: FieldMapping['type']
): string {
  if (value === null || value === undefined) {
    return '—'
  }

  const num = typeof value === 'number' ? value : parseFloat(String(value))

  switch (type) {
    case 'currency':
      if (isNaN(num)) return String(value)
      // Format with commas and 2 decimal places
      return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    case 'percent':
      if (isNaN(num)) return String(value)
      // Assume decimal format (0.25 = 25%), display as percentage
      return (num * 100).toFixed(1) + '%'

    case 'multiple':
      if (isNaN(num)) return String(value)
      // Display with 'x' suffix
      return num.toFixed(1) + 'x'

    case 'number':
      if (isNaN(num)) return String(value)
      return num.toLocaleString('en-US', { maximumFractionDigits: 2 })

    case 'date':
    case 'text':
    default:
      return String(value)
  }
}

// ============================================================================
// TEMPLATE DETECTION
// ============================================================================

/**
 * Check if a workbook matches a template's detection rules
 */
function matchesDetectionRules(
  workbook: XLSX.WorkBook,
  filename: string,
  rules: DetectionRules
): boolean {
  // Check filename patterns
  if (rules.filename_patterns && rules.filename_patterns.length > 0) {
    const filenameMatches = rules.filename_patterns.some(pattern => {
      // Convert glob pattern to regex
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        'i'
      )
      return regex.test(filename)
    })
    if (!filenameMatches) return false
  }

  // Check required sheet names
  if (rules.sheet_names && rules.sheet_names.length > 0) {
    const sheetNames = workbook.SheetNames.map(s => s.toLowerCase())
    const hasAllSheets = rules.sheet_names.every(name =>
      sheetNames.includes(name.toLowerCase())
    )
    if (!hasAllSheets) return false
  }

  // Check cell values
  if (rules.cell_checks && rules.cell_checks.length > 0) {
    for (const check of rules.cell_checks) {
      const { value, found } = getCellValue(workbook, check.cell, workbook.SheetNames[0])
      if (!found) return false

      const strValue = String(value).toLowerCase()

      if (check.equals && strValue !== check.equals.toLowerCase()) {
        return false
      }
      if (check.contains && !strValue.includes(check.contains.toLowerCase())) {
        return false
      }
    }
  }

  return true
}

/**
 * Auto-detect which template matches a workbook
 */
export function detectTemplate(
  workbook: XLSX.WorkBook,
  filename: string,
  templates: ModelTemplate[]
): ModelTemplate | null {
  for (const template of templates) {
    if (template.detection_rules && Object.keys(template.detection_rules).length > 0) {
      if (matchesDetectionRules(workbook, filename, template.detection_rules)) {
        return template
      }
    }
  }
  return null
}

// ============================================================================
// MAIN PARSING FUNCTION
// ============================================================================

/**
 * Parse an Excel file using a template's field mappings
 */
export function parseExcelFile(
  workbook: XLSX.WorkBook,
  template: ModelTemplate
): ParseResult {
  const values: ParsedValue[] = []
  const errors: string[] = []
  const sheetNames = workbook.SheetNames

  // Default to first sheet if no sheet specified in cell references
  const defaultSheet = sheetNames[0]

  for (const mapping of template.field_mappings) {
    if (!mapping.cell) {
      errors.push(`No cell reference for field "${mapping.field}"`)
      continue
    }

    const { value: rawValue, found } = getCellValue(workbook, mapping.cell, defaultSheet)

    if (!found) {
      if (mapping.required) {
        errors.push(`Required cell ${mapping.cell} not found for field "${mapping.field}"`)
      }
      continue
    }

    const formattedValue = formatValue(rawValue, mapping.type)

    values.push({
      field: mapping.field,
      cell: mapping.cell,
      rawValue,
      formattedValue,
      type: mapping.type,
      label: mapping.label,
      metricKey: mapping.metricKey,
      periodType: mapping.periodType,
      fiscalYear: mapping.fiscalYear,
      fiscalQuarter: mapping.fiscalQuarter
    })
  }

  return {
    success: errors.length === 0,
    values,
    errors,
    sheetNames
  }
}

/**
 * Read an Excel file from a File object
 */
export async function readExcelFile(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, { type: 'array' })
        resolve(workbook)
      } catch (err) {
        reject(new Error('Failed to parse Excel file'))
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsArrayBuffer(file)
  })
}

/**
 * Main entry point: read and parse an Excel file
 */
export async function processExcelFile(
  file: File,
  template: ModelTemplate,
  allTemplates?: ModelTemplate[]
): Promise<ParseResult & { file: File; workbook: XLSX.WorkBook }> {
  const workbook = await readExcelFile(file)

  // Try to auto-detect template if not specified
  let detectedTemplate: ModelTemplate | undefined
  if (allTemplates && allTemplates.length > 0) {
    const detected = detectTemplate(workbook, file.name, allTemplates)
    if (detected) {
      detectedTemplate = detected
    }
  }

  const result = parseExcelFile(workbook, template)

  return {
    ...result,
    file,
    workbook,
    detectedTemplate
  }
}

// ============================================================================
// DYNAMIC FIELD MAPPING - Label-based extraction
// ============================================================================

export interface DynamicExtractedField {
  field: string           // Generated field ID, e.g., "eps_fy2026"
  cell: string            // Cell reference where value was found
  rawValue: any
  formattedValue: string | number | null
  type: FieldMapping['type']
  label: string           // Human-readable label, e.g., "EPS FY 2026"
  year?: number
  quarter?: number
  mappingId: string       // ID of the DynamicFieldMapping that generated this
}

/**
 * Convert column letter to 0-based index (A=0, B=1, ..., Z=25, AA=26, etc.)
 */
function columnToIndex(col: string): number {
  let index = 0
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64)
  }
  return index - 1
}

/**
 * Convert 0-based index to column letter
 */
function indexToColumn(index: number): string {
  let col = ''
  let n = index + 1
  while (n > 0) {
    const remainder = (n - 1) % 26
    col = String.fromCharCode(65 + remainder) + col
    n = Math.floor((n - 1) / 26)
  }
  return col
}

/**
 * Find the row number (1-indexed) that matches the row label criteria
 */
function findRowByLabel(
  worksheet: XLSX.WorkSheet,
  rowMatch: DynamicFieldMapping['row_match'],
  maxRows: number = 100
): number | null {
  const labelCol = rowMatch.label_column.toUpperCase()

  for (let row = 1; row <= maxRows; row++) {
    const cellRef = `${labelCol}${row}`
    const cell = worksheet[cellRef]
    if (!cell) continue

    const value = String(cell.v || cell.w || '').trim()
    if (!value) continue

    // Check equals first (more specific)
    if (rowMatch.label_equals) {
      if (value.toLowerCase() === rowMatch.label_equals.toLowerCase()) {
        return row
      }
    }
    // Then check contains
    else if (rowMatch.label_contains) {
      if (value.toLowerCase().includes(rowMatch.label_contains.toLowerCase())) {
        return row
      }
    }
  }

  return null
}

/**
 * Scan column headers and extract year/quarter information
 */
function scanColumnHeaders(
  worksheet: XLSX.WorkSheet,
  columnMatch: DynamicFieldMapping['column_match']
): Array<{ column: string; year: number; quarter?: number; headerValue: string }> {
  const results: Array<{ column: string; year: number; quarter?: number; headerValue: string }> = []

  const headerRow = columnMatch.header_row
  const startCol = columnMatch.start_column ? columnToIndex(columnMatch.start_column.toUpperCase()) : 1 // Default to B
  const endCol = columnMatch.end_column ? columnToIndex(columnMatch.end_column.toUpperCase()) : 25 // Default to Z

  const yearRegex = columnMatch.year_pattern ? new RegExp(columnMatch.year_pattern, 'i') : null
  const quarterRegex = columnMatch.quarter_pattern ? new RegExp(columnMatch.quarter_pattern, 'i') : null

  for (let colIdx = startCol; colIdx <= endCol; colIdx++) {
    const colLetter = indexToColumn(colIdx)
    const cellRef = `${colLetter}${headerRow}`
    const cell = worksheet[cellRef]

    if (!cell) continue

    const headerValue = String(cell.v || cell.w || '').trim()
    if (!headerValue) continue

    // Try quarter pattern first (more specific)
    if (quarterRegex) {
      const qMatch = headerValue.match(quarterRegex)
      if (qMatch) {
        const quarter = parseInt(qMatch[1], 10)
        const year = parseInt(qMatch[2], 10)
        if (!isNaN(quarter) && !isNaN(year) && quarter >= 1 && quarter <= 4) {
          results.push({ column: colLetter, year, quarter, headerValue })
          continue
        }
      }
    }

    // Try year pattern
    if (yearRegex) {
      const yMatch = headerValue.match(yearRegex)
      if (yMatch) {
        const year = parseInt(yMatch[1], 10)
        if (!isNaN(year) && year >= 1900 && year <= 2100) {
          results.push({ column: colLetter, year, headerValue })
        }
      }
    }
  }

  return results
}

/**
 * Generate field ID from pattern and year/quarter
 */
function generateFieldId(pattern: string, year: number, quarter?: number): string {
  let fieldId = pattern
    .replace('{year}', String(year))
    .replace('{YEAR}', String(year))

  if (quarter !== undefined) {
    fieldId = fieldId
      .replace('{quarter}', String(quarter))
      .replace('{QUARTER}', String(quarter))
      .replace('{q}', String(quarter))
      .replace('{Q}', String(quarter))
  }

  return fieldId
}

/**
 * Generate human-readable label from field pattern and year/quarter
 */
function generateLabel(name: string, year: number, quarter?: number): string {
  if (quarter !== undefined) {
    return `${name} Q${quarter} ${year}`
  }
  return `${name} FY ${year}`
}

/**
 * Apply year filter to determine if a year should be included
 */
function passesYearFilter(year: number, filter?: DynamicFieldMapping['year_filter']): boolean {
  if (!filter) return true

  if (filter.min_year !== undefined && year < filter.min_year) return false
  if (filter.max_year !== undefined && year > filter.max_year) return false

  if (filter.relative_to_current !== undefined) {
    const currentYear = new Date().getFullYear()
    const minYear = currentYear + filter.relative_to_current
    const maxYear = currentYear + Math.abs(filter.relative_to_current)
    if (year < minYear || year > maxYear) return false
  }

  return true
}

/**
 * Extract values using a single dynamic field mapping
 */
export function extractDynamicFields(
  workbook: XLSX.WorkBook,
  mapping: DynamicFieldMapping
): DynamicExtractedField[] {
  const results: DynamicExtractedField[] = []

  // Determine which sheet to use
  const sheetName = mapping.row_match.sheet || workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) return results

  // Find the data row
  const dataRow = findRowByLabel(worksheet, mapping.row_match)
  if (dataRow === null) return results

  // Scan column headers for year/quarter info
  const columns = scanColumnHeaders(worksheet, mapping.column_match)

  // Extract values at intersections
  for (const col of columns) {
    // Apply year filter
    if (!passesYearFilter(col.year, mapping.year_filter)) continue

    const cellRef = `${col.column}${dataRow}`
    const cell = worksheet[cellRef]

    if (!cell) continue

    const rawValue = cell.v !== undefined ? cell.v : cell.w
    const formattedValue = formatValue(rawValue, mapping.type)

    const fieldId = generateFieldId(mapping.field_pattern, col.year, col.quarter)
    const label = generateLabel(mapping.name, col.year, col.quarter)
    const fullCellRef = workbook.SheetNames.length > 1 ? `${sheetName}!${cellRef}` : cellRef

    results.push({
      field: fieldId,
      cell: fullCellRef,
      rawValue,
      formattedValue,
      type: mapping.type,
      label,
      year: col.year,
      quarter: col.quarter,
      mappingId: mapping.id
    })
  }

  return results
}

/**
 * Extract all dynamic fields from a workbook using all dynamic mappings
 */
export function extractAllDynamicFields(
  workbook: XLSX.WorkBook,
  dynamicMappings: DynamicFieldMapping[]
): DynamicExtractedField[] {
  const results: DynamicExtractedField[] = []

  for (const mapping of dynamicMappings) {
    const extracted = extractDynamicFields(workbook, mapping)
    results.push(...extracted)
  }

  return results
}

/**
 * Preview what a dynamic mapping would extract (for UI feedback)
 */
export function previewDynamicMapping(
  workbook: XLSX.WorkBook,
  mapping: DynamicFieldMapping
): {
  success: boolean
  rowFound: boolean
  rowNumber: number | null
  columnsFound: Array<{ column: string; year: number; quarter?: number; headerValue: string }>
  extractedFields: DynamicExtractedField[]
  errors: string[]
} {
  const errors: string[] = []

  // Determine which sheet to use
  const sheetName = mapping.row_match.sheet || workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  if (!worksheet) {
    errors.push(`Sheet "${sheetName}" not found`)
    return { success: false, rowFound: false, rowNumber: null, columnsFound: [], extractedFields: [], errors }
  }

  // Find the data row
  const dataRow = findRowByLabel(worksheet, mapping.row_match)
  if (dataRow === null) {
    const criteria = mapping.row_match.label_equals
      ? `equals "${mapping.row_match.label_equals}"`
      : `contains "${mapping.row_match.label_contains}"`
    errors.push(`No row found where column ${mapping.row_match.label_column} ${criteria}`)
  }

  // Scan column headers
  const columns = scanColumnHeaders(worksheet, mapping.column_match)
  if (columns.length === 0) {
    errors.push(`No columns found matching the year/quarter pattern in row ${mapping.column_match.header_row}`)
  }

  // Extract fields
  const extractedFields = dataRow !== null ? extractDynamicFields(workbook, mapping) : []

  return {
    success: errors.length === 0,
    rowFound: dataRow !== null,
    rowNumber: dataRow,
    columnsFound: columns,
    extractedFields,
    errors
  }
}

// ============================================================================
// HELPERS FOR SYNC
// ============================================================================

export interface PriceTargetData {
  scenario: 'Bull' | 'Base' | 'Bear'
  price: number
}

export interface ThesisData {
  thesis?: string
  where_different?: string
  risks_to_thesis?: string
  key_catalysts?: string
  investment_summary?: string
}

export interface SyncData {
  priceTargets: PriceTargetData[]
  rating?: string
  estimates: Array<{
    metricKey: string
    periodType: 'annual' | 'quarterly'
    fiscalYear: number
    fiscalQuarter?: number
    value: number
  }>
  thesis?: ThesisData
}

/**
 * Convert parsed values to sync-ready data structure
 */
export function prepareDataForSync(values: ParsedValue[]): SyncData {
  const result: SyncData = {
    priceTargets: [],
    estimates: []
  }

  for (const val of values) {
    if (val.formattedValue === null) continue

    // Handle known fields
    switch (val.field) {
      case 'price_target':
        result.priceTargets.push({
          scenario: 'Base',
          price: typeof val.formattedValue === 'number'
            ? val.formattedValue
            : parseFloat(String(val.formattedValue))
        })
        break

      case 'bull_price_target':
        result.priceTargets.push({
          scenario: 'Bull',
          price: typeof val.formattedValue === 'number'
            ? val.formattedValue
            : parseFloat(String(val.formattedValue))
        })
        break

      case 'bear_price_target':
        result.priceTargets.push({
          scenario: 'Bear',
          price: typeof val.formattedValue === 'number'
            ? val.formattedValue
            : parseFloat(String(val.formattedValue))
        })
        break

      case 'rating':
        result.rating = String(val.formattedValue)
        break

      // Thesis fields
      case 'thesis':
        if (!result.thesis) result.thesis = {}
        result.thesis.thesis = String(val.formattedValue)
        break

      case 'where_different':
        if (!result.thesis) result.thesis = {}
        result.thesis.where_different = String(val.formattedValue)
        break

      case 'risks_to_thesis':
        if (!result.thesis) result.thesis = {}
        result.thesis.risks_to_thesis = String(val.formattedValue)
        break

      case 'key_catalysts':
        if (!result.thesis) result.thesis = {}
        result.thesis.key_catalysts = String(val.formattedValue)
        break

      case 'investment_summary':
        if (!result.thesis) result.thesis = {}
        result.thesis.investment_summary = String(val.formattedValue)
        break

      default:
        // Check if it's an estimate field
        if (val.metricKey && val.fiscalYear) {
          result.estimates.push({
            metricKey: val.metricKey,
            periodType: val.periodType || 'annual',
            fiscalYear: val.fiscalYear,
            fiscalQuarter: val.fiscalQuarter,
            value: typeof val.formattedValue === 'number'
              ? val.formattedValue
              : parseFloat(String(val.formattedValue))
          })
        }
    }
  }

  return result
}

// ============================================================================
// SMART FIELD DETECTION
// ============================================================================

export interface DetectedField {
  cell: string
  sheet: string
  label: string
  value: any
  suggestedField: string
  suggestedType: 'currency' | 'number' | 'percent' | 'text' | 'date'
  confidence: 'high' | 'medium' | 'low'
}

// Common patterns to look for
// NOTE: More specific patterns must come BEFORE less specific ones
// e.g., "FCF Margin" before "FCF", "EBITDA Margin" before "EBITDA"
const FIELD_PATTERNS: Array<{
  pattern: RegExp
  field: string
  type: 'currency' | 'number' | 'percent' | 'text' | 'date'
  label: string
}> = [
  // Price targets
  { pattern: /price\s*target/i, field: 'price_target', type: 'currency', label: 'Price Target' },
  { pattern: /bull\s*(case|price|target)/i, field: 'bull_price_target', type: 'currency', label: 'Bull Price Target' },
  { pattern: /bear\s*(case|price|target)/i, field: 'bear_price_target', type: 'currency', label: 'Bear Price Target' },
  { pattern: /base\s*(case|price|target)/i, field: 'price_target', type: 'currency', label: 'Base Price Target' },
  { pattern: /upside/i, field: 'bull_price_target', type: 'currency', label: 'Upside Target' },
  { pattern: /downside/i, field: 'bear_price_target', type: 'currency', label: 'Downside Target' },

  // Rating
  { pattern: /^rating$/i, field: 'rating', type: 'text', label: 'Rating' },
  { pattern: /recommendation/i, field: 'rating', type: 'text', label: 'Recommendation' },

  // EPS
  { pattern: /eps\s*(fy)?(\d{2,4})?/i, field: 'eps', type: 'currency', label: 'EPS' },
  { pattern: /earnings\s*per\s*share/i, field: 'eps', type: 'currency', label: 'EPS' },

  // Revenue
  { pattern: /revenue\s*growth/i, field: 'revenue_growth', type: 'percent', label: 'Revenue Growth' },
  { pattern: /revenue/i, field: 'revenue', type: 'currency', label: 'Revenue' },
  { pattern: /sales/i, field: 'revenue', type: 'currency', label: 'Revenue' },
  { pattern: /top\s*line/i, field: 'revenue', type: 'currency', label: 'Revenue' },

  // EBITDA - margin patterns BEFORE base pattern
  { pattern: /ebitda\s*margin/i, field: 'ebitda_margin', type: 'percent', label: 'EBITDA Margin' },
  { pattern: /ebitda/i, field: 'ebitda', type: 'currency', label: 'EBITDA' },

  // Net Income
  { pattern: /net\s*income/i, field: 'net_income', type: 'currency', label: 'Net Income' },

  // FCF - margin patterns BEFORE base pattern
  { pattern: /fcf\s*margin/i, field: 'fcf_margin', type: 'percent', label: 'FCF Margin' },
  { pattern: /free\s*cash\s*flow\s*margin/i, field: 'fcf_margin', type: 'percent', label: 'FCF Margin' },
  { pattern: /fcf\s*yield/i, field: 'fcf_yield', type: 'percent', label: 'FCF Yield' },
  { pattern: /^fcf$/i, field: 'fcf', type: 'currency', label: 'Free Cash Flow' },
  { pattern: /free\s*cash\s*flow/i, field: 'fcf', type: 'currency', label: 'Free Cash Flow' },

  // Margins
  { pattern: /gross\s*margin/i, field: 'gross_margin', type: 'percent', label: 'Gross Margin' },
  { pattern: /operating\s*margin/i, field: 'operating_margin', type: 'percent', label: 'Operating Margin' },
  { pattern: /net\s*margin/i, field: 'net_margin', type: 'percent', label: 'Net Margin' },
  { pattern: /profit\s*margin/i, field: 'net_margin', type: 'percent', label: 'Profit Margin' },

  // Valuation
  { pattern: /p\/e|pe\s*ratio/i, field: 'pe_ratio', type: 'number', label: 'P/E Ratio' },
  { pattern: /ev\/ebitda/i, field: 'ev_ebitda', type: 'number', label: 'EV/EBITDA' },
  { pattern: /ev\/sales/i, field: 'ev_sales', type: 'number', label: 'EV/Sales' },
  { pattern: /p\/s|ps\s*ratio/i, field: 'ps_ratio', type: 'number', label: 'P/S Ratio' },
]

// Fiscal year patterns
const FY_PATTERN = /(?:fy|f)?['\s]?(\d{2,4})(?:e|a)?/i

// Pattern to detect years in headers (2020-2035 range, with optional FY prefix, E/A suffix)
const YEAR_HEADER_PATTERN = /^(?:fy|f)?['\s]?(\d{4}|\d{2})(?:\s*[ea])?$/i
const QUARTER_HEADER_PATTERN = /^(?:q([1-4]))?['\s]?(?:fy|f)?['\s]?(\d{4}|\d{2})(?:\s*[ea])?$/i

/**
 * Detect the type of a cell based on its Excel number format
 * Returns 'currency', 'percent', 'multiple', 'number', or null if unknown
 */
function detectTypeFromFormat(cell: XLSX.CellObject): 'currency' | 'percent' | 'multiple' | 'number' | null {
  if (!cell) return null

  // Check cell format string (z property)
  const format = cell.z || ''
  // Check formatted text (w property) - what's displayed in Excel
  const formattedText = cell.w || ''

  // Currency patterns: $, £, €, ¥, or accounting format with currency
  if (/[$£€¥]|"USD"|"EUR"|"GBP"|_\(\$/.test(format)) {
    return 'currency'
  }

  // Percent pattern: ends with % or contains %
  if (/%/.test(format)) {
    return 'percent'
  }

  // Multiple pattern: format contains "x" suffix or formatted text ends with 'x'
  // Common Excel formats: 0.0"x", #,##0.0"x", 0.00"x"
  if (/"x"/.test(format) || /x\s*$/.test(format)) {
    return 'multiple'
  }
  // Also check the displayed text - if it ends with 'x' and the raw value is a number
  if (cell.t === 'n' && /\d+\.?\d*x\s*$/i.test(formattedText)) {
    return 'multiple'
  }

  // If it's a number cell with no special format, return 'number'
  if (cell.t === 'n') {
    // Check if value looks like a percentage (between -1 and 1, often percentages)
    const val = cell.v as number
    if (Math.abs(val) <= 1 && Math.abs(val) > 0) {
      // Could be a percent, but not certain - return null to use pattern default
      return null
    }
    return 'number'
  }

  return null
}

/**
 * Parse a year from a cell value, returns null if not a valid year
 */
function parseYearFromHeader(value: string): number | null {
  if (!value) return null
  const trimmed = value.trim()

  // Try quarter pattern first (Q1 2024, Q1'24, etc.)
  const quarterMatch = trimmed.match(QUARTER_HEADER_PATTERN)
  if (quarterMatch) {
    let year = parseInt(quarterMatch[2])
    if (year < 100) year += 2000
    if (year >= 2015 && year <= 2035) return year
  }

  // Try year pattern (2024, FY2024, FY24, 2024E, etc.)
  const yearMatch = trimmed.match(YEAR_HEADER_PATTERN)
  if (yearMatch) {
    let year = parseInt(yearMatch[1])
    if (year < 100) year += 2000
    if (year >= 2015 && year <= 2035) return year
  }

  return null
}

/**
 * Scan a sheet for year headers in rows and columns
 * Returns maps of column index -> year and row index -> year
 */
function scanForYearHeaders(sheet: XLSX.WorkSheet, range: XLSX.Range): {
  columnYears: Map<number, number>
  rowYears: Map<number, number>
} {
  const columnYears = new Map<number, number>()
  const rowYears = new Map<number, number>()

  // Scan first 5 rows for column year headers
  for (let row = range.s.r; row <= Math.min(range.s.r + 4, range.e.r); row++) {
    for (let col = range.s.c; col <= Math.min(range.e.c, 50); col++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
      const cell = sheet[cellRef]
      if (!cell) continue

      const value = String(cell.v || '').trim()
      const year = parseYearFromHeader(value)

      if (year && !columnYears.has(col)) {
        columnYears.set(col, year)
      }
    }
  }

  // Scan first 3 columns for row year headers
  for (let col = range.s.c; col <= Math.min(range.s.c + 2, range.e.c); col++) {
    for (let row = range.s.r; row <= Math.min(range.e.r, 100); row++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
      const cell = sheet[cellRef]
      if (!cell) continue

      const value = String(cell.v || '').trim()
      const year = parseYearFromHeader(value)

      if (year && !rowYears.has(row)) {
        rowYears.set(row, year)
      }
    }
  }

  return { columnYears, rowYears }
}

/**
 * Scan a workbook and detect potential field mappings
 */
export function detectFields(workbook: XLSX.WorkBook): DetectedField[] {
  const detected: DetectedField[] = []
  const seen = new Set<string>() // Avoid duplicate field+cell combos
  const usedCells = new Set<string>() // Track cells already assigned to prevent same cell for multiple fields

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')

    // First, scan for year headers in this sheet
    const { columnYears, rowYears } = scanForYearHeaders(sheet, range)

    // Scan cells for labels
    for (let row = range.s.r; row <= Math.min(range.e.r, 100); row++) {
      for (let col = range.s.c; col <= Math.min(range.e.c, 30); col++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
        const cell = sheet[cellRef]

        if (!cell || cell.t !== 's') continue // Only check string cells

        const cellValue = String(cell.v || '').trim()
        if (!cellValue || cellValue.length > 50) continue // Skip empty or very long

        // Check against patterns - use first matching pattern only (more specific patterns are listed first)
        let matchedPattern = false
        for (const fieldPattern of FIELD_PATTERNS) {
          if (matchedPattern) break // Only use first matching pattern
          if (!fieldPattern.pattern.test(cellValue)) continue
          matchedPattern = true

          const timeSeriesMetrics = ['eps', 'revenue', 'revenue_growth', 'ebitda', 'ebitda_margin', 'net_income', 'fcf', 'fcf_margin', 'fcf_yield', 'gross_margin', 'operating_margin', 'net_margin']
          const isTimeSeries = timeSeriesMetrics.includes(fieldPattern.field)

          // If we have column year headers and this is a time-series metric,
          // scan ALL columns with year headers on this row
          if (isTimeSeries && columnYears.size > 0) {
            for (const [yearCol, year] of columnYears) {
              // Skip if this column is at or before the label column
              if (yearCol <= col) continue

              const adjRef = XLSX.utils.encode_cell({ r: row, c: yearCol })
              const adjCell = sheet[adjRef]
              if (!adjCell) continue

              // Check if it looks like a value
              const hasValue = adjCell.t === 'n' ||
                (adjCell.t === 's' && /^[\d$,.\-]+$/.test(String(adjCell.v)))
              if (!hasValue) continue

              const fullRef = `${sheetName}!${adjRef}`

              // Skip if this cell is already used by another field
              if (usedCells.has(fullRef)) continue

              const field = `${fieldPattern.field}_fy${year}`
              const key = `${field}:${fullRef}`

              if (seen.has(key)) continue
              seen.add(key)
              usedCells.add(fullRef)

              // Detect type from cell format, fall back to pattern default
              const detectedType = detectTypeFromFormat(adjCell) || fieldPattern.type

              detected.push({
                cell: fullRef,
                sheet: sheetName,
                label: `${cellValue} (${year})`,
                value: adjCell.v,
                suggestedField: field,
                suggestedType: detectedType,
                confidence: 'high'
              })
            }

            // Also check row year headers for this metric
            if (rowYears.size > 0) {
              for (const [yearRow, year] of rowYears) {
                if (yearRow <= row) continue

                const adjRef = XLSX.utils.encode_cell({ r: yearRow, c: col })
                const adjCell = sheet[adjRef]
                if (!adjCell) continue

                const hasValue = adjCell.t === 'n' ||
                  (adjCell.t === 's' && /^[\d$,.\-]+$/.test(String(adjCell.v)))
                if (!hasValue) continue

                const fullRef = `${sheetName}!${adjRef}`

                // Skip if this cell is already used by another field
                if (usedCells.has(fullRef)) continue

                const field = `${fieldPattern.field}_fy${year}`
                const key = `${field}:${fullRef}`

                if (seen.has(key)) continue
                seen.add(key)
                usedCells.add(fullRef)

                // Detect type from cell format, fall back to pattern default
                const detectedType = detectTypeFromFormat(adjCell) || fieldPattern.type

                detected.push({
                  cell: fullRef,
                  sheet: sheetName,
                  label: `${cellValue} (${year})`,
                  value: adjCell.v,
                  suggestedField: field,
                  suggestedType: detectedType,
                  confidence: 'high'
                })
              }
            }
          } else {
            // For non-time-series fields or when no year headers found,
            // use original adjacent cell logic
            const adjacentCells = [
              { ref: XLSX.utils.encode_cell({ r: row, c: col + 1 }), row, col: col + 1 }, // right
              { ref: XLSX.utils.encode_cell({ r: row + 1, c: col }), row: row + 1, col }, // below
              { ref: XLSX.utils.encode_cell({ r: row, c: col + 2 }), row, col: col + 2 }, // 2 right
              { ref: XLSX.utils.encode_cell({ r: row + 1, c: col + 1 }), row: row + 1, col: col + 1 }, // diagonal
            ]

            for (const adj of adjacentCells) {
              const adjCell = sheet[adj.ref]
              if (!adjCell) continue

              const hasValue = adjCell.t === 'n' ||
                (adjCell.t === 's' && /^[\d$,.\-]+$/.test(String(adjCell.v)))
              if (!hasValue) continue

              const fullRef = `${sheetName}!${adj.ref}`

              // Skip if this cell is already used by another field
              if (usedCells.has(fullRef)) continue

              let field = fieldPattern.field

              // Check for year in adjacent cell's column/row
              let yearFromHeader: number | null = null
              if (columnYears.has(adj.col)) {
                yearFromHeader = columnYears.get(adj.col)!
              } else if (rowYears.has(adj.row)) {
                yearFromHeader = rowYears.get(adj.row)!
              }

              // Try year from label if no header year
              const fyMatch = cellValue.match(FY_PATTERN)
              if (yearFromHeader && isTimeSeries) {
                field = `${field}_fy${yearFromHeader}`
              } else if (fyMatch && isTimeSeries) {
                let year = parseInt(fyMatch[1])
                if (year < 100) year += 2000
                field = `${field}_fy${year}`
              }

              const key = `${field}:${fullRef}`
              if (seen.has(key)) continue
              seen.add(key)
              usedCells.add(fullRef)

              const hasYear = yearFromHeader !== null || fyMatch !== null
              const confidence: 'high' | 'medium' | 'low' = hasYear ? 'high' : 'medium'

              // Detect type from cell format, fall back to pattern default
              const detectedType = detectTypeFromFormat(adjCell) || fieldPattern.type

              detected.push({
                cell: fullRef,
                sheet: sheetName,
                label: yearFromHeader ? `${cellValue} (${yearFromHeader})` : cellValue,
                value: adjCell.v,
                suggestedField: field,
                suggestedType: detectedType,
                confidence
              })

              break // Found a value for this label
            }
          }
        }
      }
    }
  }

  // Sort by confidence and field name
  return detected.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 }
    const confDiff = confOrder[a.confidence] - confOrder[b.confidence]
    if (confDiff !== 0) return confDiff
    return a.suggestedField.localeCompare(b.suggestedField)
  })
}

/**
 * Get a preview of what would be extracted from a workbook using a template
 */
export function previewExtraction(
  workbook: XLSX.WorkBook,
  template: { field_mappings: Array<{ field: string; cell: string; type: string; label?: string }> }
): Array<{
  field: string
  cell: string
  label?: string
  value: any
  formattedValue: any
  found: boolean
  empty?: boolean
}> {
  const preview: Array<{
    field: string
    cell: string
    label?: string
    value: any
    formattedValue: any
    found: boolean
    empty?: boolean
  }> = []

  const defaultSheet = workbook.SheetNames[0]

  for (const mapping of template.field_mappings) {
    const { value, found, empty } = getCellValue(workbook, mapping.cell, defaultSheet)
    const formatted = found ? formatValue(value, mapping.type as any) : null

    preview.push({
      field: mapping.field,
      cell: mapping.cell,
      label: mapping.label,
      empty,
      value: found ? value : null,
      formattedValue: formatted,
      found
    })
  }

  return preview
}

// ============================================================================
// DYNAMIC MAPPING AUTO-DETECTION
// ============================================================================

export interface DetectedDynamicMapping {
  id: string
  name: string
  field_pattern: string
  row_match: {
    label_column: string
    label_contains: string
    sheet: string
  }
  column_match: {
    header_row: number
    year_pattern: string
    start_column: string
    end_column: string
  }
  type: 'currency' | 'number' | 'percent' | 'text' | 'date'
  // For UI display
  rowLabel: string
  rowNumber: number
  detectedYears: number[]
  sampleValues: Array<{ year: number; column: string; value: any }>
  confidence: 'high' | 'medium' | 'low'
}

// Metrics that make sense for dynamic (time-series) extraction
// Patterns are flexible - can appear anywhere in the label
// NOTE: More specific patterns MUST come BEFORE less specific ones
// e.g., "Revenue Growth" before "Revenue", "EPS Growth" before "EPS"
const DYNAMIC_METRIC_PATTERNS: Array<{
  pattern: RegExp
  name: string
  fieldBase: string
  type: 'currency' | 'number' | 'percent'
}> = [
  // EPS - growth patterns before base pattern
  { pattern: /\beps\s*growth\b/i, name: 'EPS Growth', fieldBase: 'eps_growth', type: 'percent' },
  { pattern: /\bdiluted\s*eps\b/i, name: 'Diluted EPS', fieldBase: 'diluted_eps', type: 'currency' },
  { pattern: /\beps\b/i, name: 'EPS', fieldBase: 'eps', type: 'currency' },
  { pattern: /earnings\s*per\s*share/i, name: 'EPS', fieldBase: 'eps', type: 'currency' },
  // Revenue - growth patterns before base pattern
  { pattern: /\brevenue\s*growth\b/i, name: 'Revenue Growth', fieldBase: 'rev_growth', type: 'percent' },
  { pattern: /\btotal\s*revenue\b/i, name: 'Revenue', fieldBase: 'revenue', type: 'currency' },
  { pattern: /\bnet\s*sales\b/i, name: 'Revenue', fieldBase: 'revenue', type: 'currency' },
  { pattern: /\brevenue\b/i, name: 'Revenue', fieldBase: 'revenue', type: 'currency' },
  { pattern: /\bsales\b/i, name: 'Revenue', fieldBase: 'revenue', type: 'currency' },
  // EBITDA - margin before base
  { pattern: /\bebitda\s*margin\b/i, name: 'EBITDA Margin', fieldBase: 'ebitda_margin', type: 'percent' },
  { pattern: /\bebitda\b/i, name: 'EBITDA', fieldBase: 'ebitda', type: 'currency' },
  // Net Income
  { pattern: /\bnet\s*income\b/i, name: 'Net Income', fieldBase: 'net_income', type: 'currency' },
  { pattern: /\bnet\s*earnings\b/i, name: 'Net Income', fieldBase: 'net_income', type: 'currency' },
  // FCF - margin before base
  { pattern: /\bfcf\s*margin\b/i, name: 'FCF Margin', fieldBase: 'fcf_margin', type: 'percent' },
  { pattern: /\bfree\s*cash\s*flow\b/i, name: 'FCF', fieldBase: 'fcf', type: 'currency' },
  { pattern: /\bfcf\b/i, name: 'FCF', fieldBase: 'fcf', type: 'currency' },
  // Margins
  { pattern: /\bgross\s*margin\b/i, name: 'Gross Margin', fieldBase: 'gross_margin', type: 'percent' },
  { pattern: /\boperating\s*margin\b/i, name: 'Operating Margin', fieldBase: 'op_margin', type: 'percent' },
  { pattern: /\bnet\s*margin\b/i, name: 'Net Margin', fieldBase: 'net_margin', type: 'percent' },
  { pattern: /\bprofit\s*margin\b/i, name: 'Profit Margin', fieldBase: 'profit_margin', type: 'percent' },
  // Profits
  { pattern: /\bgross\s*profit\b/i, name: 'Gross Profit', fieldBase: 'gross_profit', type: 'currency' },
  { pattern: /\boperating\s*income\b/i, name: 'Operating Income', fieldBase: 'op_income', type: 'currency' },
  { pattern: /\boperating\s*profit\b/i, name: 'Operating Profit', fieldBase: 'op_income', type: 'currency' },
  // Other
  { pattern: /\bcapex\b|capital\s*expenditure/i, name: 'CapEx', fieldBase: 'capex', type: 'currency' },
  { pattern: /\bd&a\b|\bdep.*amort/i, name: 'D&A', fieldBase: 'dna', type: 'currency' },
  { pattern: /\bdepreciation\b/i, name: 'Depreciation', fieldBase: 'depreciation', type: 'currency' },
  { pattern: /\bdiluted\s*shares\b/i, name: 'Diluted Shares', fieldBase: 'diluted_shares', type: 'number' },
  { pattern: /\bshares\s*out/i, name: 'Shares Outstanding', fieldBase: 'shares_out', type: 'number' },
  { pattern: /\bdividend\s*yield\b/i, name: 'Dividend Yield', fieldBase: 'div_yield', type: 'percent' },
  { pattern: /\bdividend\b/i, name: 'Dividend', fieldBase: 'dividend', type: 'currency' },
  // Price target
  { pattern: /\bprice\s*target\b/i, name: 'Price Target', fieldBase: 'price_target', type: 'currency' },
]

// Common year header patterns with their regex strings
// Made more flexible - allow whitespace and optional suffixes
const YEAR_DETECTION_PATTERNS = [
  { pattern: /^\s*FY\s*'?(\d{4})\s*[EA]?\s*$/i, regex: 'FY\\s*\'?(\\d{4})', label: 'FY2024' },
  { pattern: /^\s*FY\s*'?(\d{2})\s*[EA]?\s*$/i, regex: "FY\\s*'?(\\d{2})", label: "FY'24" },
  { pattern: /^\s*CY\s*'?(\d{4})\s*[EA]?\s*$/i, regex: 'CY\\s*\'?(\\d{4})', label: 'CY2024' },
  { pattern: /^\s*(\d{4})\s*[EA]?\s*$/i, regex: '(20\\d{2})', label: '2024' },
  { pattern: /^\s*'(\d{2})\s*$/i, regex: "'(\\d{2})", label: "'24" },
  // Quarter patterns
  { pattern: /^\s*Q([1-4])\s*'?(\d{2,4})\s*$/i, regex: 'Q([1-4])\\s*\'?(\\d{2,4})', label: 'Q1 24' },
  { pattern: /^\s*([1-4])Q\s*'?(\d{2,4})\s*$/i, regex: '([1-4])Q\\s*\'?(\\d{2,4})', label: '1Q24' },
]

interface HeaderRowInfo {
  row: number
  columns: Array<{ col: number; colLetter: string; year: number; headerValue: string }>
  yearPattern: string
  startColumn: string
  endColumn: string
}

/**
 * Scan first few rows to find header rows with year patterns
 */
function detectHeaderRows(sheet: XLSX.WorkSheet, range: XLSX.Range): HeaderRowInfo[] {
  const headerRows: HeaderRowInfo[] = []
  const debugFirstRowValues: string[] = []

  // Check first 10 rows for potential headers
  for (let row = range.s.r; row <= Math.min(range.s.r + 9, range.e.r); row++) {
    const yearColumns: Array<{ col: number; colLetter: string; year: number; headerValue: string; patternIdx: number }> = []

    // Scan columns
    for (let col = range.s.c; col <= Math.min(range.e.c, 50); col++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
      const cell = sheet[cellRef]
      if (!cell) continue

      const value = String(cell.v || cell.w || '').trim()
      if (!value) continue

      // Log first 3 rows for debugging
      if (row <= range.s.r + 2) {
        debugFirstRowValues.push(`R${row+1}C${col}="${value}"`)
      }

      // Try each year pattern
      for (let patternIdx = 0; patternIdx < YEAR_DETECTION_PATTERNS.length; patternIdx++) {
        const { pattern, label } = YEAR_DETECTION_PATTERNS[patternIdx]
        const match = value.match(pattern)
        if (match) {
          let year: number
          // Quarter patterns have year in match[2], others in match[1]
          if (label.startsWith('Q') || label.includes('Q')) {
            year = parseInt(match[2], 10)
          } else {
            year = parseInt(match[1], 10)
          }
          if (year < 100) year += 2000
          if (year >= 2015 && year <= 2040) {
            yearColumns.push({
              col,
              colLetter: indexToColumn(col),
              year,
              headerValue: value,
              patternIdx
            })
          }
          break
        }
      }
    }

    // Need at least 2 consecutive/near years to be a valid header row
    if (yearColumns.length >= 2) {
      // Group by pattern type to find the dominant pattern
      const patternGroups = new Map<number, typeof yearColumns>()
      for (const yc of yearColumns) {
        const group = patternGroups.get(yc.patternIdx) || []
        group.push(yc)
        patternGroups.set(yc.patternIdx, group)
      }

      // Use the pattern with the most matches
      let bestGroup: typeof yearColumns = []
      for (const group of patternGroups.values()) {
        if (group.length > bestGroup.length) bestGroup = group
      }

      if (bestGroup.length >= 2) {
        // Sort by column
        bestGroup.sort((a, b) => a.col - b.col)

        const patternIdx = bestGroup[0].patternIdx
        headerRows.push({
          row: row + 1, // 1-based for user display
          columns: bestGroup.map(c => ({
            col: c.col,
            colLetter: c.colLetter,
            year: c.year,
            headerValue: c.headerValue
          })),
          yearPattern: YEAR_DETECTION_PATTERNS[patternIdx].regex,
          startColumn: bestGroup[0].colLetter,
          endColumn: bestGroup[bestGroup.length - 1].colLetter
        })
      }
    }
  }

  if (debugFirstRowValues.length > 0) {
    console.log('[detectHeaderRows] First row values sample:', debugFirstRowValues.slice(0, 15).join(', '))
  }

  return headerRows
}

interface MetricRowInfo {
  row: number
  label: string
  labelColumn: string
  metric: typeof DYNAMIC_METRIC_PATTERNS[0]
}

/**
 * Scan for rows that contain metric labels
 */
function detectMetricRows(sheet: XLSX.WorkSheet, range: XLSX.Range, labelColumn: string = 'A'): MetricRowInfo[] {
  const metricRows: MetricRowInfo[] = []
  const labelColIdx = columnToIndex(labelColumn)

  // Scan a bit before and after the declared range to catch labels
  const startRow = Math.max(0, range.s.r - 2)
  const endRow = Math.min(range.e.r + 5, 200)

  for (let row = startRow; row <= endRow; row++) {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: labelColIdx })
    const cell = sheet[cellRef]
    if (!cell) continue

    const value = String(cell.v || cell.w || '').trim()
    if (!value || value.length > 50) continue

    // Check against metric patterns
    for (const metric of DYNAMIC_METRIC_PATTERNS) {
      if (metric.pattern.test(value)) {
        metricRows.push({
          row: row + 1, // 1-based
          label: value,
          labelColumn,
          metric
        })
        break // Only first matching pattern
      }
    }
  }

  return metricRows
}

/**
 * Auto-detect potential dynamic mappings from a workbook
 */
export function detectDynamicMappings(workbook: XLSX.WorkBook): DetectedDynamicMapping[] {
  const detected: DetectedDynamicMapping[] = []
  const seen = new Set<string>() // Avoid duplicates

  console.log('[detectDynamicMappings] Starting detection on', workbook.SheetNames.length, 'sheets')

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet || !sheet['!ref']) {
      console.log('[detectDynamicMappings] Sheet', sheetName, 'has no ref, skipping')
      continue
    }

    const range = XLSX.utils.decode_range(sheet['!ref'])
    console.log('[detectDynamicMappings] Sheet', sheetName, 'range:', sheet['!ref'])

    // Find header rows with year patterns
    const headerRows = detectHeaderRows(sheet, range)
    console.log('[detectDynamicMappings] Sheet', sheetName, 'found', headerRows.length, 'header rows:', headerRows)
    if (headerRows.length === 0) continue

    // For each header row, look for metric labels in common label columns
    for (const header of headerRows) {
      // Try columns A, B, C, D for labels (some sheets start data at C or D)
      // Also try the first column with year headers minus 1 or 2
      const labelColsToTry = new Set(['A', 'B', 'C', 'D'])

      // Add the column just before the first year column
      if (header.columns.length > 0) {
        const firstYearCol = header.columns[0].col
        if (firstYearCol > 0) {
          labelColsToTry.add(indexToColumn(firstYearCol - 1))
        }
        if (firstYearCol > 1) {
          labelColsToTry.add(indexToColumn(firstYearCol - 2))
        }
      }

      for (const labelCol of labelColsToTry) {
        const metricRows = detectMetricRows(sheet, range, labelCol)
        if (metricRows.length > 0) {
          console.log('[detectDynamicMappings] Sheet', sheetName, 'col', labelCol, 'found', metricRows.length, 'metric rows:', metricRows.map(m => m.label))
        }

        for (const metricRow of metricRows) {
          // Skip if row is before or at header row
          if (metricRow.row <= header.row) continue

          const key = `${sheetName}:${metricRow.row}:${header.row}`
          if (seen.has(key)) continue
          seen.add(key)

          // Get sample values for this row across year columns
          const sampleValues: DetectedDynamicMapping['sampleValues'] = []
          for (const col of header.columns) {
            const cellRef = XLSX.utils.encode_cell({ r: metricRow.row - 1, c: col.col })
            const cell = sheet[cellRef]
            if (cell && cell.v !== undefined) {
              sampleValues.push({
                year: col.year,
                column: col.colLetter,
                value: cell.v
              })
            }
          }

          // Only include if we found at least 2 values
          if (sampleValues.length < 2) continue

          // Determine confidence
          const confidence: 'high' | 'medium' | 'low' =
            sampleValues.length >= 3 ? 'high' : 'medium'

          detected.push({
            id: `auto_${sheetName}_${metricRow.row}_${header.row}`,
            name: metricRow.metric.name,
            field_pattern: `${metricRow.metric.fieldBase}_fy{year}`,
            row_match: {
              label_column: metricRow.labelColumn,
              label_contains: metricRow.label,
              sheet: sheetName
            },
            column_match: {
              header_row: header.row,
              year_pattern: header.yearPattern,
              start_column: header.startColumn,
              end_column: header.endColumn
            },
            type: metricRow.metric.type,
            rowLabel: metricRow.label,
            rowNumber: metricRow.row,
            detectedYears: header.columns.map(c => c.year),
            sampleValues,
            confidence
          })
        }
      }
    }
  }

  // Sort by confidence and name
  return detected.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 }
    const confDiff = confOrder[a.confidence] - confOrder[b.confidence]
    if (confDiff !== 0) return confDiff
    return a.name.localeCompare(b.name)
  })
}

/**
 * Create a DynamicFieldMapping from a detected mapping
 */
export function convertDetectedToMapping(detected: DetectedDynamicMapping): DynamicFieldMapping {
  return {
    id: `dm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: detected.name,
    field_pattern: detected.field_pattern,
    row_match: {
      label_column: detected.row_match.label_column,
      label_contains: detected.row_match.label_contains,
      sheet: detected.row_match.sheet
    },
    column_match: {
      header_row: detected.column_match.header_row,
      year_pattern: detected.column_match.year_pattern,
      start_column: detected.column_match.start_column,
      end_column: detected.column_match.end_column
    },
    type: detected.type
  }
}
