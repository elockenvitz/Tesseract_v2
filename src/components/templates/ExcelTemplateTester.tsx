import { useState, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle,
  XCircle,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Plus,
  AlertCircle
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { Button } from '../ui/Button'
import {
  readExcelFile,
  detectFields,
  previewExtraction,
  DetectedField
} from '../../utils/excelParser'
import type { FieldMapping } from '../../hooks/useModelTemplates'

interface ExcelTemplateTesterProps {
  fieldMappings: FieldMapping[]
  onAddMappings?: (mappings: FieldMapping[]) => void
  className?: string
}

export function ExcelTemplateTester({
  fieldMappings,
  onAddMappings,
  className
}: ExcelTemplateTesterProps) {
  const [file, setFile] = useState<File | null>(null)
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [preview, setPreview] = useState<Array<{
    field: string
    cell: string
    label?: string
    value: any
    formattedValue: any
    found: boolean
  }> | null>(null)

  const [detectedFields, setDetectedFields] = useState<DetectedField[]>([])
  const [showDetected, setShowDetected] = useState(true)
  const [selectedDetections, setSelectedDetections] = useState<Set<string>>(new Set())

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    setError(null)
    setIsLoading(true)
    setPreview(null)
    setDetectedFields([])
    setSelectedDetections(new Set())

    try {
      const wb = await readExcelFile(selectedFile)
      setWorkbook(wb)

      // Run preview if we have mappings
      if (fieldMappings.length > 0) {
        const previewResult = previewExtraction(wb, { field_mappings: fieldMappings })
        setPreview(previewResult)
      }

      // Run smart detection
      const detected = detectFields(wb)
      setDetectedFields(detected)
    } catch (err) {
      console.error('Error processing file:', err)
      setError(err instanceof Error ? err.message : 'Failed to process file')
    } finally {
      setIsLoading(false)
    }
  }, [fieldMappings])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      handleFileSelect(droppedFile)
    }
  }, [handleFileSelect])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      handleFileSelect(selectedFile)
    }
  }

  const toggleDetection = (cell: string) => {
    const newSelected = new Set(selectedDetections)
    if (newSelected.has(cell)) {
      newSelected.delete(cell)
    } else {
      newSelected.add(cell)
    }
    setSelectedDetections(newSelected)
  }

  const handleAddSelectedMappings = () => {
    if (!onAddMappings) return

    const mappingsToAdd: FieldMapping[] = detectedFields
      .filter(d => selectedDetections.has(d.cell))
      .map(d => ({
        field: d.suggestedField,
        cell: d.cell,
        type: d.suggestedType,
        label: d.label
      }))

    onAddMappings(mappingsToAdd)
    setSelectedDetections(new Set())
  }

  const foundCount = preview?.filter(p => p.found).length ?? 0
  const totalCount = preview?.length ?? 0

  return (
    <div className={clsx('border border-gray-200 rounded-lg overflow-hidden', className)}>
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className="font-medium text-gray-900">Template Tester</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Upload a sample Excel file to test your mappings and auto-detect fields
        </p>
      </div>

      <div className="p-4">
        {/* File Upload */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={clsx(
            'border-2 border-dashed rounded-lg p-4 text-center transition-colors',
            isLoading ? 'border-gray-200 bg-gray-50' : 'border-gray-300 hover:border-primary-400 hover:bg-primary-50/50'
          )}
        >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Processing...</span>
            </div>
          ) : file ? (
            <div className="flex items-center justify-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-gray-900">{file.name}</span>
              <button
                onClick={() => {
                  setFile(null)
                  setWorkbook(null)
                  setPreview(null)
                  setDetectedFields([])
                }}
                className="text-xs text-gray-500 hover:text-gray-700 underline ml-2"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">
                Drop an Excel file here or{' '}
                <label className="text-primary-600 hover:underline cursor-pointer">
                  browse
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </label>
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Preview Results */}
        {preview && preview.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">Extraction Preview</h4>
              <span className={clsx(
                'text-xs font-medium px-2 py-0.5 rounded-full',
                foundCount === totalCount
                  ? 'bg-green-100 text-green-700'
                  : foundCount > 0
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-red-100 text-red-700'
              )}>
                {foundCount}/{totalCount} found
              </span>
            </div>

            <div className="space-y-1.5">
              {preview.map((item, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'flex items-center justify-between p-2 rounded text-sm',
                    item.found ? 'bg-green-50' : 'bg-red-50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {item.found ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="font-medium text-gray-900">
                      {item.label || item.field}
                    </span>
                    <span className="text-gray-500 text-xs">{item.cell}</span>
                  </div>
                  <div className="text-right">
                    {item.found ? (
                      <span className="font-mono text-gray-900">
                        {typeof item.formattedValue === 'number'
                          ? item.formattedValue.toLocaleString()
                          : item.formattedValue ?? '—'}
                      </span>
                    ) : (
                      <span className="text-red-600 text-xs">Not found</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Smart Detection Results */}
        {detectedFields.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowDetected(!showDetected)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h4 className="text-sm font-medium text-gray-700">Auto-Detected Fields</h4>
                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                  {detectedFields.length}
                </span>
              </div>
              {showDetected ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
            </button>

            {showDetected && (
              <div className="mt-2 space-y-1.5">
                {detectedFields.map((field, idx) => {
                  const isSelected = selectedDetections.has(field.cell)
                  const alreadyMapped = fieldMappings.some(m => m.cell === field.cell)

                  return (
                    <div
                      key={idx}
                      onClick={() => !alreadyMapped && toggleDetection(field.cell)}
                      className={clsx(
                        'flex items-center justify-between p-2 rounded text-sm cursor-pointer transition-colors',
                        alreadyMapped
                          ? 'bg-gray-100 opacity-50 cursor-not-allowed'
                          : isSelected
                          ? 'bg-primary-50 border border-primary-200'
                          : 'bg-gray-50 hover:bg-gray-100'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={alreadyMapped}
                          onChange={() => {}}
                          className="h-4 w-4 text-primary-600 rounded border-gray-300"
                        />
                        <div>
                          <span className="font-medium text-gray-900">
                            {field.label}
                          </span>
                          <span className="text-gray-500 text-xs ml-2">
                            → {field.suggestedField}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        <span className="text-xs text-gray-500">{field.cell}</span>
                        <span className="font-mono text-gray-900">
                          {typeof field.value === 'number'
                            ? field.value.toLocaleString()
                            : field.value}
                        </span>
                        <span className={clsx(
                          'text-xs px-1.5 py-0.5 rounded',
                          field.confidence === 'high'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        )}>
                          {field.confidence}
                        </span>
                      </div>
                    </div>
                  )
                })}

                {onAddMappings && selectedDetections.size > 0 && (
                  <Button
                    onClick={handleAddSelectedMappings}
                    size="sm"
                    className="mt-2"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add {selectedDetections.size} Selected Mapping{selectedDetections.size !== 1 ? 's' : ''}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sheet Info */}
        {workbook && (
          <div className="mt-4 text-xs text-gray-500">
            <span className="font-medium">Sheets:</span>{' '}
            {workbook.SheetNames.join(', ')}
          </div>
        )}
      </div>
    </div>
  )
}
