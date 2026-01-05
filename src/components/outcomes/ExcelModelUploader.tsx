import { useState, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  Upload,
  FileSpreadsheet,
  X,
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  RefreshCw,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import { useModelTemplates, useModelFiles, type ModelTemplate } from '../../hooks/useModelTemplates'
import { useAnalystEstimates } from '../../hooks/useAnalystEstimates'
import { useAnalystRatings, useRatingScales } from '../../hooks/useAnalystRatings'
import { useAnalystPriceTargets } from '../../hooks/useAnalystPriceTargets'
import { useScenarios } from '../../hooks/useScenarios'
import { useAuth } from '../../hooks/useAuth'
import {
  readExcelFile,
  parseExcelFile,
  detectTemplate,
  prepareDataForSync,
  type ParsedValue,
  type ParseResult
} from '../../utils/excelParser'
import type * as XLSX from 'xlsx'

interface ExcelModelUploaderProps {
  assetId: string
  className?: string
  onSyncComplete?: () => void
}

type UploadStep = 'select' | 'preview' | 'syncing' | 'complete'

export function ExcelModelUploader({ assetId, className, onSyncComplete }: ExcelModelUploaderProps) {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State
  const [step, setStep] = useState<UploadStep>('select')
  const [file, setFile] = useState<File | null>(null)
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [syncErrors, setSyncErrors] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Hooks
  const { templates, isLoading: templatesLoading } = useModelTemplates()
  const { uploadFile } = useModelFiles({ assetId })
  const { bulkSaveEstimates } = useAnalystEstimates({ assetId })
  const { saveRating } = useAnalystRatings({ assetId })
  const { defaultScale } = useRatingScales()
  const { scenarios, defaultScenarios } = useScenarios({ assetId })
  const { savePriceTarget } = useAnalystPriceTargets({ assetId })

  // Get scenarios for price target sync
  const getScenarioByName = (name: string) => defaultScenarios.find(s => s.name === name)

  // Selected template
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

  // Handle file selection
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.match(/\.(xlsx|xls|xlsm)$/i)) {
      setSyncErrors(['Please select an Excel file (.xlsx, .xls, or .xlsm)'])
      return
    }

    setIsLoading(true)
    setSyncErrors([])

    try {
      const wb = await readExcelFile(selectedFile)
      setFile(selectedFile)
      setWorkbook(wb)

      // Try to auto-detect template
      const detected = detectTemplate(wb, selectedFile.name, templates)
      if (detected) {
        setSelectedTemplateId(detected.id)
        // Auto-parse with detected template
        const result = parseExcelFile(wb, detected)
        setParseResult(result)
        setStep('preview')
      } else if (templates.length === 1) {
        // If only one template, use it
        setSelectedTemplateId(templates[0].id)
        const result = parseExcelFile(wb, templates[0])
        setParseResult(result)
        setStep('preview')
      } else {
        // Need manual template selection
        setStep('preview')
      }
    } catch (err) {
      console.error('Error reading file:', err)
      setSyncErrors(['Failed to read Excel file'])
    } finally {
      setIsLoading(false)
    }
  }, [templates])

  // Handle template change
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId)
    if (workbook && templateId) {
      const template = templates.find(t => t.id === templateId)
      if (template) {
        const result = parseExcelFile(workbook, template)
        setParseResult(result)
      }
    }
  }

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      handleFileSelect(droppedFile)
    }
  }, [handleFileSelect])

  // Handle sync
  const handleSync = async () => {
    if (!file || !selectedTemplate || !parseResult) return

    setStep('syncing')
    setSyncErrors([])
    const errors: string[] = []

    try {
      const syncData = prepareDataForSync(parseResult.values)

      // Save estimates
      if (syncData.estimates.length > 0) {
        try {
          await bulkSaveEstimates.mutateAsync(
            syncData.estimates.map(est => ({
              ...est,
              source: 'excel_sync' as const
            }))
          )
        } catch (err) {
          errors.push('Failed to sync estimates')
          console.error('Estimate sync error:', err)
        }
      }

      // Save rating
      if (syncData.rating && defaultScale) {
        try {
          await saveRating.mutateAsync({
            ratingValue: syncData.rating,
            ratingScaleId: defaultScale.id,
            source: 'excel_sync'
          })
        } catch (err) {
          errors.push('Failed to sync rating')
          console.error('Rating sync error:', err)
        }
      }

      // Save price targets (Bull/Base/Bear)
      if (syncData.priceTargets.length > 0) {
        for (const pt of syncData.priceTargets) {
          const scenario = getScenarioByName(pt.scenario)
          if (!scenario) {
            errors.push(`Scenario "${pt.scenario}" not found`)
            continue
          }
          try {
            await savePriceTarget.mutateAsync({
              scenarioId: scenario.id,
              price: pt.price,
              timeframe: '12 months',
              reasoning: `Synced from Excel: ${file.name}`
            })
          } catch (err) {
            errors.push(`Failed to sync ${pt.scenario} price target`)
            console.error(`${pt.scenario} price target sync error:`, err)
          }
        }
      }

      // Upload file record
      try {
        await uploadFile.mutateAsync({
          file,
          templateId: selectedTemplate.id,
          extractedData: {
            values: parseResult.values,
            syncData
          }
        })
      } catch (err) {
        errors.push('Failed to save file record')
        console.error('File upload error:', err)
      }

      if (errors.length > 0) {
        setSyncErrors(errors)
        setStep('preview')
      } else {
        setStep('complete')
        onSyncComplete?.()
      }
    } catch (err) {
      console.error('Sync error:', err)
      setSyncErrors(['An unexpected error occurred during sync'])
      setStep('preview')
    }
  }

  // Reset
  const handleReset = () => {
    setFile(null)
    setWorkbook(null)
    setSelectedTemplateId('')
    setParseResult(null)
    setSyncErrors([])
    setStep('select')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Format value for display
  const formatDisplayValue = (val: ParsedValue) => {
    if (val.formattedValue === null) return '—'
    switch (val.type) {
      case 'currency':
        return typeof val.formattedValue === 'number'
          ? `$${val.formattedValue.toFixed(2)}`
          : val.formattedValue
      case 'percent':
        return typeof val.formattedValue === 'number'
          ? `${(val.formattedValue * 100).toFixed(1)}%`
          : val.formattedValue
      default:
        return String(val.formattedValue)
    }
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-green-600" />
          Excel Model Sync
        </h4>
        {step !== 'select' && step !== 'syncing' && (
          <button
            onClick={handleReset}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Start Over
          </button>
        )}
      </div>

      <div className="p-4">
        {/* Step 1: File Selection */}
        {step === 'select' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={clsx(
              'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
              dragOver
                ? 'border-primary-400 bg-primary-50'
                : 'border-gray-300 hover:border-gray-400'
            )}
          >
            {isLoading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                <p className="text-sm text-gray-500">Reading file...</p>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600 mb-1">
                  Drag and drop your Excel model here
                </p>
                <p className="text-xs text-gray-500 mb-3">
                  or click to browse
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm"
                  onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
                >
                  Select File
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 2: Preview & Template Selection */}
        {step === 'preview' && file && (
          <div className="space-y-4">
            {/* File info */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <FileSpreadsheet className="w-8 h-8 text-green-600" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {(file.size / 1024).toFixed(1)} KB
                  {workbook && ` · ${workbook.SheetNames.length} sheet${workbook.SheetNames.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <button
                onClick={handleReset}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Template selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Template
              </label>
              <div className="relative">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent appearance-none bg-white"
                  disabled={templatesLoading}
                >
                  <option value="">Select a template...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.is_firm_template ? ' (Firm)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Errors */}
            {syncErrors.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
                  <div className="text-sm text-red-700">
                    {syncErrors.map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Parse errors */}
            {parseResult?.errors && parseResult.errors.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div className="text-sm text-amber-700">
                    <p className="font-medium mb-1">Some fields could not be extracted:</p>
                    {parseResult.errors.map((err, i) => (
                      <p key={i} className="text-xs">{err}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Extracted values preview */}
            {parseResult && parseResult.values.length > 0 && (
              <div>
                <h5 className="text-sm font-medium text-gray-700 mb-2">
                  Extracted Data ({parseResult.values.length} fields)
                </h5>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                  {parseResult.values.map((val, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        {val.formattedValue !== null ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-gray-300" />
                        )}
                        <span className="text-gray-700">{val.label || val.field}</span>
                        <span className="text-xs text-gray-400">{val.cell}</span>
                      </div>
                      <span className={clsx(
                        'font-medium',
                        val.formattedValue !== null ? 'text-gray-900' : 'text-gray-400'
                      )}>
                        {formatDisplayValue(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No values extracted */}
            {parseResult && parseResult.values.length === 0 && selectedTemplate && (
              <div className="text-center py-6 text-gray-500">
                <p className="text-sm">No data could be extracted with this template.</p>
                <p className="text-xs mt-1">Check that the cell references match your Excel file.</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSync}
                disabled={!selectedTemplate || !parseResult || parseResult.values.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-4 h-4" />
                Sync Data
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Syncing */}
        {step === 'syncing' && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-600">Syncing data...</p>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 'complete' && (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900 mb-1">Sync Complete!</p>
            <p className="text-xs text-gray-500 mb-4">
              Your Excel data has been synced to Tesseract.
            </p>
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100"
            >
              Upload Another File
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
