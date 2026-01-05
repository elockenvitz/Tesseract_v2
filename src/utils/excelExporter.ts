import * as XLSX from 'xlsx'
import { format } from 'date-fns'

// ============================================================================
// TYPES
// ============================================================================

export interface ExportPriceTarget {
  analyst: string
  scenario: string
  price: number
  timeframe: string
  targetDate?: string
  probability?: number
  reasoning?: string
  updatedAt: string
}

export interface ExportEstimate {
  analyst: string
  metric: string
  fiscalYear: number
  fiscalQuarter?: number
  periodType: string
  value: number
  updatedAt: string
}

export interface ExportRating {
  analyst: string
  rating: string
  scale: string
  notes?: string
  updatedAt: string
}

export interface ExportData {
  assetSymbol: string
  assetName: string
  currentPrice?: number
  exportDate: string
  priceTargets?: ExportPriceTarget[]
  estimates?: ExportEstimate[]
  ratings?: ExportRating[]
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Create a workbook with multiple sheets for asset data
 */
export function createAssetExportWorkbook(data: ExportData): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()

  // Summary sheet
  const summaryData = [
    ['Asset Export'],
    [],
    ['Symbol', data.assetSymbol],
    ['Name', data.assetName],
    ['Current Price', data.currentPrice ?? 'N/A'],
    ['Export Date', data.exportDate],
    [],
    ['Sections Included:'],
    ['Price Targets', data.priceTargets?.length ?? 0],
    ['Estimates', data.estimates?.length ?? 0],
    ['Ratings', data.ratings?.length ?? 0]
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  // Price Targets sheet
  if (data.priceTargets && data.priceTargets.length > 0) {
    const ptHeaders = ['Analyst', 'Scenario', 'Price Target', 'Timeframe', 'Target Date', 'Probability', 'Reasoning', 'Last Updated']
    const ptRows = data.priceTargets.map(pt => [
      pt.analyst,
      pt.scenario,
      pt.price,
      pt.timeframe,
      pt.targetDate ?? '',
      pt.probability ? `${(pt.probability * 100).toFixed(0)}%` : '',
      pt.reasoning ?? '',
      pt.updatedAt
    ])
    const ptSheet = XLSX.utils.aoa_to_sheet([ptHeaders, ...ptRows])

    // Set column widths
    ptSheet['!cols'] = [
      { wch: 20 }, // Analyst
      { wch: 12 }, // Scenario
      { wch: 12 }, // Price
      { wch: 12 }, // Timeframe
      { wch: 12 }, // Target Date
      { wch: 12 }, // Probability
      { wch: 40 }, // Reasoning
      { wch: 20 }  // Updated
    ]

    XLSX.utils.book_append_sheet(workbook, ptSheet, 'Price Targets')
  }

  // Estimates sheet
  if (data.estimates && data.estimates.length > 0) {
    const estHeaders = ['Analyst', 'Metric', 'Period Type', 'Fiscal Year', 'Fiscal Quarter', 'Value', 'Last Updated']
    const estRows = data.estimates.map(est => [
      est.analyst,
      est.metric,
      est.periodType,
      est.fiscalYear,
      est.fiscalQuarter ?? '',
      est.value,
      est.updatedAt
    ])
    const estSheet = XLSX.utils.aoa_to_sheet([estHeaders, ...estRows])

    estSheet['!cols'] = [
      { wch: 20 }, // Analyst
      { wch: 15 }, // Metric
      { wch: 12 }, // Period Type
      { wch: 12 }, // FY
      { wch: 12 }, // FQ
      { wch: 15 }, // Value
      { wch: 20 }  // Updated
    ]

    XLSX.utils.book_append_sheet(workbook, estSheet, 'Estimates')
  }

  // Ratings sheet
  if (data.ratings && data.ratings.length > 0) {
    const rHeaders = ['Analyst', 'Rating', 'Scale', 'Notes', 'Last Updated']
    const rRows = data.ratings.map(r => [
      r.analyst,
      r.rating,
      r.scale,
      r.notes ?? '',
      r.updatedAt
    ])
    const rSheet = XLSX.utils.aoa_to_sheet([rHeaders, ...rRows])

    rSheet['!cols'] = [
      { wch: 20 }, // Analyst
      { wch: 15 }, // Rating
      { wch: 20 }, // Scale
      { wch: 40 }, // Notes
      { wch: 20 }  // Updated
    ]

    XLSX.utils.book_append_sheet(workbook, rSheet, 'Ratings')
  }

  return workbook
}

/**
 * Export workbook to file and trigger download
 */
export function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(workbook, filename)
}

/**
 * Export asset data to Excel file
 */
export function exportAssetToExcel(data: ExportData) {
  const workbook = createAssetExportWorkbook(data)
  const filename = `${data.assetSymbol}_Export_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
  downloadWorkbook(workbook, filename)
}

/**
 * Create a template workbook that analysts can fill in
 */
export function createTemplateWorkbook(assetSymbol: string, assetName: string): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()

  // Instructions sheet
  const instructionsData = [
    ['Excel Model Template'],
    [],
    ['Asset:', assetSymbol],
    ['Name:', assetName],
    [],
    ['Instructions:'],
    ['1. Fill in your estimates, price targets, and rating on the respective sheets'],
    ['2. Save this file and upload it to Tesseract'],
    ['3. Tesseract will automatically extract and sync your data'],
    [],
    ['Notes:'],
    ['- Leave cells blank if you don\'t have an estimate'],
    ['- Price targets should be numeric values (no $ sign needed)'],
    ['- Use the exact rating values from your firm\'s scale (e.g., OW, N, UW)']
  ]
  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsData)
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions')

  // Price Targets sheet
  const ptData = [
    ['Price Targets'],
    [],
    ['Scenario', 'Price Target', 'Probability', 'Timeframe', 'Reasoning'],
    ['Bull', '', '', '12 months', ''],
    ['Base', '', '', '12 months', ''],
    ['Bear', '', '', '12 months', '']
  ]
  const ptSheet = XLSX.utils.aoa_to_sheet(ptData)
  ptSheet['!cols'] = [
    { wch: 12 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 40 }
  ]
  XLSX.utils.book_append_sheet(workbook, ptSheet, 'Price Targets')

  // Estimates sheet
  const currentYear = new Date().getFullYear()
  const estData = [
    ['Estimates'],
    [],
    ['Metric', `FY${currentYear}`, `FY${currentYear + 1}`, `FY${currentYear + 2}`],
    ['EPS', '', '', ''],
    ['Revenue', '', '', ''],
    ['EBITDA', '', '', ''],
    ['Net Income', '', '', ''],
    ['FCF', '', '', '']
  ]
  const estSheet = XLSX.utils.aoa_to_sheet(estData)
  estSheet['!cols'] = [
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 }
  ]
  XLSX.utils.book_append_sheet(workbook, estSheet, 'Estimates')

  // Rating sheet
  const ratingData = [
    ['Rating'],
    [],
    ['Your Rating:', ''],
    [],
    ['Rating Scale Reference:'],
    ['OW = Overweight (Buy)'],
    ['N = Neutral (Hold)'],
    ['UW = Underweight (Sell)'],
    [],
    ['Notes:', '']
  ]
  const ratingSheet = XLSX.utils.aoa_to_sheet(ratingData)
  XLSX.utils.book_append_sheet(workbook, ratingSheet, 'Rating')

  return workbook
}

/**
 * Download a blank template for an asset
 */
export function downloadTemplate(assetSymbol: string, assetName: string) {
  const workbook = createTemplateWorkbook(assetSymbol, assetName)
  const filename = `${assetSymbol}_Template.xlsx`
  downloadWorkbook(workbook, filename)
}

/**
 * Export multiple assets to a single workbook
 */
export function exportMultipleAssetsToExcel(assets: ExportData[]) {
  const workbook = XLSX.utils.book_new()

  // Summary sheet with all assets
  const summaryData = [
    ['Multi-Asset Export'],
    ['Export Date:', format(new Date(), 'yyyy-MM-dd HH:mm')],
    [],
    ['Symbol', 'Name', 'Current Price', 'Price Targets', 'Estimates', 'Ratings']
  ]

  for (const asset of assets) {
    summaryData.push([
      asset.assetSymbol,
      asset.assetName,
      asset.currentPrice?.toString() ?? 'N/A',
      (asset.priceTargets?.length ?? 0).toString(),
      (asset.estimates?.length ?? 0).toString(),
      (asset.ratings?.length ?? 0).toString()
    ])
  }

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  // Add individual asset sheets
  for (const asset of assets) {
    // Price targets for this asset
    if (asset.priceTargets && asset.priceTargets.length > 0) {
      const ptHeaders = ['Analyst', 'Scenario', 'Price', 'Timeframe', 'Updated']
      const ptRows = asset.priceTargets.map(pt => [
        pt.analyst,
        pt.scenario,
        pt.price,
        pt.timeframe,
        pt.updatedAt
      ])
      const ptSheet = XLSX.utils.aoa_to_sheet([ptHeaders, ...ptRows])
      const sheetName = `${asset.assetSymbol}_PT`.substring(0, 31) // Excel sheet name limit
      XLSX.utils.book_append_sheet(workbook, ptSheet, sheetName)
    }
  }

  const filename = `Portfolio_Export_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
  downloadWorkbook(workbook, filename)
}
