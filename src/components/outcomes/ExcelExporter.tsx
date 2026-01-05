import { useState } from 'react'
import { clsx } from 'clsx'
import { Download, FileSpreadsheet, Loader2, FileDown, FilePlus } from 'lucide-react'
import { format } from 'date-fns'
import { useAnalystPriceTargets } from '../../hooks/useAnalystPriceTargets'
import { useAnalystEstimates } from '../../hooks/useAnalystEstimates'
import { useAnalystRatings } from '../../hooks/useAnalystRatings'
import {
  exportAssetToExcel,
  downloadTemplate,
  ExportData,
  ExportPriceTarget,
  ExportEstimate,
  ExportRating
} from '../../utils/excelExporter'

interface ExcelExporterProps {
  assetId: string
  assetSymbol: string
  assetName: string
  currentPrice?: number
  className?: string
}

export function ExcelExporter({
  assetId,
  assetSymbol,
  assetName,
  currentPrice,
  className
}: ExcelExporterProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [showOptions, setShowOptions] = useState(false)

  const { priceTargets } = useAnalystPriceTargets({ assetId })
  const { estimates } = useAnalystEstimates({ assetId })
  const { ratings } = useAnalystRatings({ assetId })

  const handleExportData = async () => {
    setIsExporting(true)
    try {
      // Transform price targets
      const exportPriceTargets: ExportPriceTarget[] = priceTargets.map(pt => ({
        analyst: pt.user?.full_name || 'Unknown',
        scenario: pt.scenario?.name || 'Base',
        price: pt.price,
        timeframe: pt.timeframe || '12 months',
        targetDate: pt.target_date || undefined,
        probability: pt.probability || undefined,
        reasoning: pt.reasoning || undefined,
        updatedAt: format(new Date(pt.updated_at), 'yyyy-MM-dd HH:mm')
      }))

      // Transform estimates
      const exportEstimates: ExportEstimate[] = estimates.map(est => ({
        analyst: est.user?.full_name || 'Unknown',
        metric: est.metric_key.toUpperCase(),
        fiscalYear: est.fiscal_year,
        fiscalQuarter: est.fiscal_quarter || undefined,
        periodType: est.period_type,
        value: Number(est.value),
        updatedAt: format(new Date(est.updated_at), 'yyyy-MM-dd HH:mm')
      }))

      // Transform ratings
      const exportRatings: ExportRating[] = ratings.map(r => ({
        analyst: r.user?.full_name || 'Unknown',
        rating: r.rating_value,
        scale: r.rating_scale?.name || 'Standard',
        notes: r.notes || undefined,
        updatedAt: format(new Date(r.updated_at), 'yyyy-MM-dd HH:mm')
      }))

      const exportData: ExportData = {
        assetSymbol,
        assetName,
        currentPrice,
        exportDate: format(new Date(), 'yyyy-MM-dd HH:mm'),
        priceTargets: exportPriceTargets,
        estimates: exportEstimates,
        ratings: exportRatings
      }

      exportAssetToExcel(exportData)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setIsExporting(false)
      setShowOptions(false)
    }
  }

  const handleDownloadTemplate = () => {
    downloadTemplate(assetSymbol, assetName)
    setShowOptions(false)
  }

  const totalItems = priceTargets.length + estimates.length + ratings.length

  return (
    <div className={clsx('relative', className)}>
      <button
        onClick={() => setShowOptions(!showOptions)}
        disabled={isExporting}
        className={clsx(
          'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors',
          'border border-gray-300 bg-white text-gray-700',
          'hover:bg-gray-50 hover:border-gray-400',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {isExporting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-4 h-4 text-green-600" />
        )}
        Export
      </button>

      {showOptions && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowOptions(false)}
          />

          {/* Dropdown */}
          <div className="absolute right-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
            <div className="p-2">
              <button
                onClick={handleExportData}
                disabled={totalItems === 0}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                  totalItems > 0
                    ? 'hover:bg-gray-50'
                    : 'opacity-50 cursor-not-allowed'
                )}
              >
                <FileDown className="w-5 h-5 text-blue-600" />
                <div>
                  <div className="text-sm font-medium text-gray-900">Export Data</div>
                  <div className="text-xs text-gray-500">
                    {totalItems} items ({priceTargets.length} PT, {estimates.length} Est, {ratings.length} Rtg)
                  </div>
                </div>
              </button>

              <button
                onClick={handleDownloadTemplate}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors"
              >
                <FilePlus className="w-5 h-5 text-green-600" />
                <div>
                  <div className="text-sm font-medium text-gray-900">Download Template</div>
                  <div className="text-xs text-gray-500">
                    Blank template for {assetSymbol}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
