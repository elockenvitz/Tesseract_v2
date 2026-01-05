import { useState, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  X,
  ChevronDown,
  ChevronRight,
  Play,
  Pause
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useModelTemplates, useModelFiles, type ModelTemplate } from '../../hooks/useModelTemplates'
import { readExcelFile, parseExcelFile, detectTemplate, prepareDataForSync } from '../../utils/excelParser'
import { useScenarios } from '../../hooks/useScenarios'
import { useAnalystPriceTargets } from '../../hooks/useAnalystPriceTargets'
import { useAnalystEstimates } from '../../hooks/useAnalystEstimates'
import { useAnalystRatings } from '../../hooks/useAnalystRatings'

interface BulkExcelImporterProps {
  assetId: string
  className?: string
  onComplete?: () => void
}

interface FileToImport {
  id: string
  file: File
  status: 'pending' | 'processing' | 'success' | 'error'
  detectedTemplate?: ModelTemplate
  selectedTemplateId?: string
  error?: string
  extractedValues?: number
}

export function BulkExcelImporter({
  assetId,
  className,
  onComplete
}: BulkExcelImporterProps) {
  const [files, setFiles] = useState<FileToImport[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [showFiles, setShowFiles] = useState(true)

  const { templates } = useModelTemplates()
  const { uploadFile, updateSyncStatus } = useModelFiles({ assetId })
  const { scenarios, getScenarioByName } = useScenarios(assetId)
  const { savePriceTarget } = useAnalystPriceTargets({ assetId })
  const { saveEstimate } = useAnalystEstimates({ assetId })
  const { saveRating, defaultScale } = useAnalystRatings({ assetId })

  const handleFilesSelected = useCallback(async (selectedFiles: FileList) => {
    const newFiles: FileToImport[] = []

    for (const file of Array.from(selectedFiles)) {
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) continue

      try {
        const workbook = await readExcelFile(file)
        const detected = detectTemplate(workbook, file.name, templates)

        newFiles.push({
          id: `${Date.now()}-${file.name}`,
          file,
          status: 'pending',
          detectedTemplate: detected || undefined,
          selectedTemplateId: detected?.id
        })
      } catch (err) {
        newFiles.push({
          id: `${Date.now()}-${file.name}`,
          file,
          status: 'error',
          error: 'Failed to read file'
        })
      }
    }

    setFiles(prev => [...prev, ...newFiles])
  }, [templates])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFilesSelected(e.dataTransfer.files)
  }, [handleFilesSelected])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFilesSelected(e.target.files)
    }
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const setFileTemplate = (id: string, templateId: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, selectedTemplateId: templateId } : f
    ))
  }

  const processFile = async (fileItem: FileToImport): Promise<FileToImport> => {
    const template = templates.find(t => t.id === fileItem.selectedTemplateId)
    if (!template) {
      return { ...fileItem, status: 'error', error: 'No template selected' }
    }

    try {
      const workbook = await readExcelFile(fileItem.file)
      const parseResult = parseExcelFile(workbook, template)

      if (!parseResult.success) {
        return {
          ...fileItem,
          status: 'error',
          error: parseResult.errors.join(', ')
        }
      }

      // Upload file
      const uploadedFile = await uploadFile.mutateAsync({
        file: fileItem.file,
        templateId: template.id,
        extractedData: { values: parseResult.values }
      })

      // Sync data
      const syncData = prepareDataForSync(parseResult.values)
      const syncErrors: string[] = []

      // Sync price targets
      for (const pt of syncData.priceTargets) {
        const scenario = getScenarioByName(pt.scenario)
        if (scenario) {
          try {
            await savePriceTarget.mutateAsync({
              scenarioId: scenario.id,
              price: pt.price,
              timeframe: '12 months',
              reasoning: `Synced from Excel: ${fileItem.file.name}`
            })
          } catch (err) {
            syncErrors.push(`Failed to sync ${pt.scenario} price target`)
          }
        }
      }

      // Sync estimates
      for (const est of syncData.estimates) {
        try {
          await saveEstimate.mutateAsync({
            metricKey: est.metricKey,
            periodType: est.periodType,
            fiscalYear: est.fiscalYear,
            fiscalQuarter: est.fiscalQuarter,
            value: est.value
          })
        } catch (err) {
          syncErrors.push(`Failed to sync ${est.metricKey} estimate`)
        }
      }

      // Sync rating
      if (syncData.rating && defaultScale) {
        try {
          await saveRating.mutateAsync({
            ratingValue: syncData.rating,
            ratingScaleId: defaultScale.id
          })
        } catch (err) {
          syncErrors.push('Failed to sync rating')
        }
      }

      // Update sync status
      await updateSyncStatus.mutateAsync({
        fileId: uploadedFile.id,
        status: syncErrors.length > 0 ? 'error' : 'synced',
        error: syncErrors.length > 0 ? syncErrors.join('; ') : undefined
      })

      return {
        ...fileItem,
        status: syncErrors.length > 0 ? 'error' : 'success',
        extractedValues: parseResult.values.length,
        error: syncErrors.length > 0 ? syncErrors.join('; ') : undefined
      }
    } catch (err) {
      return {
        ...fileItem,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error'
      }
    }
  }

  const processAllFiles = async () => {
    setIsProcessing(true)

    const pendingFiles = files.filter(f => f.status === 'pending' && f.selectedTemplateId)

    for (const fileItem of pendingFiles) {
      // Update to processing
      setFiles(prev => prev.map(f =>
        f.id === fileItem.id ? { ...f, status: 'processing' } : f
      ))

      const result = await processFile(fileItem)

      setFiles(prev => prev.map(f =>
        f.id === fileItem.id ? result : f
      ))
    }

    setIsProcessing(false)
    onComplete?.()
  }

  const pendingCount = files.filter(f => f.status === 'pending' && f.selectedTemplateId).length
  const successCount = files.filter(f => f.status === 'success').length
  const errorCount = files.filter(f => f.status === 'error').length

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
            <Upload className="w-4 h-4 text-gray-500" />
            Bulk Import
          </h4>
          {files.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              {successCount > 0 && (
                <span className="text-green-600">{successCount} imported</span>
              )}
              {errorCount > 0 && (
                <span className="text-red-600">{errorCount} failed</span>
              )}
              {pendingCount > 0 && (
                <span className="text-gray-500">{pendingCount} pending</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-4">
        {/* Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={clsx(
            'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
            'border-gray-300 hover:border-primary-400 hover:bg-primary-50/50'
          )}
        >
          <FileSpreadsheet className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600">
            Drop multiple Excel files here or{' '}
            <label className="text-primary-600 hover:underline cursor-pointer">
              browse
              <input
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Supports .xlsx and .xls files
          </p>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowFiles(!showFiles)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2"
            >
              {showFiles ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Files ({files.length})
            </button>

            {showFiles && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {files.map(fileItem => (
                  <div
                    key={fileItem.id}
                    className={clsx(
                      'flex items-center gap-3 p-2 rounded-lg text-sm',
                      fileItem.status === 'success' ? 'bg-green-50' :
                      fileItem.status === 'error' ? 'bg-red-50' :
                      fileItem.status === 'processing' ? 'bg-blue-50' :
                      'bg-gray-50'
                    )}
                  >
                    {/* Status Icon */}
                    {fileItem.status === 'success' && (
                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    )}
                    {fileItem.status === 'error' && (
                      <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    )}
                    {fileItem.status === 'processing' && (
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />
                    )}
                    {fileItem.status === 'pending' && (
                      <FileSpreadsheet className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}

                    {/* File Name */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {fileItem.file.name}
                      </div>
                      {fileItem.error && (
                        <div className="text-xs text-red-600 truncate">
                          {fileItem.error}
                        </div>
                      )}
                      {fileItem.extractedValues && (
                        <div className="text-xs text-green-600">
                          {fileItem.extractedValues} values extracted
                        </div>
                      )}
                    </div>

                    {/* Template Selector */}
                    {fileItem.status === 'pending' && (
                      <select
                        value={fileItem.selectedTemplateId || ''}
                        onChange={(e) => setFileTemplate(fileItem.id, e.target.value)}
                        className="text-xs px-2 py-1 border border-gray-300 rounded bg-white"
                      >
                        <option value="">Select template...</option>
                        {templates.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {fileItem.detectedTemplate?.id === t.id ? ' (detected)' : ''}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Remove Button */}
                    {fileItem.status !== 'processing' && (
                      <button
                        onClick={() => removeFile(fileItem.id)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <button
                onClick={() => setFiles([])}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear all
              </button>

              <Button
                onClick={processAllFiles}
                disabled={isProcessing || pendingCount === 0}
                size="sm"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-1" />
                    Import {pendingCount} File{pendingCount !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
