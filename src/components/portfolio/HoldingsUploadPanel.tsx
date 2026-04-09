/**
 * HoldingsUploadPanel — CSV holdings upload with column mapping.
 *
 * Flow:
 *   1. Drag-and-drop or select CSV file
 *   2. Auto-detect column mappings (editable)
 *   3. Preview parsed data
 *   4. Set snapshot date
 *   5. Submit → creates snapshot + positions
 */

import { useState, useCallback, useRef } from 'react'
import { Upload, FileSpreadsheet, AlertTriangle, Check, X, ChevronDown, Calendar } from 'lucide-react'
import { clsx } from 'clsx'
import {
  useHoldingsUpload,
  parseHoldingsCSV,
  autoDetectMappings,
  STANDARD_FIELDS,
  type ParseResult,
  type ParsedPosition,
} from '../../hooks/useHoldingsUpload'
import { useToast } from '../common/Toast'

interface HoldingsUploadPanelProps {
  portfolioId: string
  portfolioName: string
}

type Step = 'upload' | 'mapping' | 'preview' | 'done'

export function HoldingsUploadPanel({ portfolioId, portfolioName }: HoldingsUploadPanelProps) {
  const { configs, uploadMutation, uploadHistory } = useHoldingsUpload(portfolioId)
  const { success, error: showError } = useToast()

  const [step, setStep] = useState<Step>('upload')
  const [csvText, setCsvText] = useState('')
  const [filename, setFilename] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().split('T')[0])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setCsvText(text)
      setFilename(file.name)

      // Parse headers from first row
      const firstLine = text.split(/\r?\n/).find(l => l.trim())
      if (firstLine) {
        const hdrs = firstLine.split(',').map(h => h.replace(/"/g, '').trim())
        setHeaders(hdrs)
        setMappings(autoDetectMappings(hdrs))
      }

      setStep('mapping')
    }
    reader.readAsText(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleFile(file)
    }
  }, [handleFile])

  const handleParsePreview = () => {
    const result = parseHoldingsCSV(csvText, mappings, 0)
    setParseResult(result)
    setStep('preview')
  }

  const handleUpload = async () => {
    if (!parseResult) return
    try {
      const result = await uploadMutation.mutateAsync({
        positions: parseResult.positions,
        snapshotDate,
        filename,
      })
      success(`Uploaded ${result.positionsCount} positions${result.warnings.length > 0 ? ` with ${result.warnings.length} warnings` : ''}`)
      setStep('done')
    } catch (err: any) {
      showError(err.message || 'Upload failed')
    }
  }

  const reset = () => {
    setStep('upload')
    setCsvText('')
    setFilename('')
    setHeaders([])
    setMappings({})
    setParseResult(null)
    setSnapshotDate(new Date().toISOString().split('T')[0])
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          Upload Holdings — {portfolioName}
        </h3>
        {step !== 'upload' && (
          <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Start Over
          </button>
        )}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all"
        >
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600 font-medium">Drop a CSV file here or click to browse</p>
          <p className="text-xs text-gray-400 mt-1">Supported: .csv files with holdings data</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
              <span className="font-medium">{filename}</span>
              <span className="text-gray-400">— {headers.length} columns detected</span>
            </div>

            <div className="space-y-2">
              {STANDARD_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <label className="w-32 text-xs font-medium text-gray-600 flex items-center gap-1">
                    {field.label}
                    {field.required && <span className="text-red-400">*</span>}
                  </label>
                  <select
                    value={mappings[field.key] || ''}
                    onChange={(e) => setMappings(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">— Not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {mappings[field.key] && (
                    <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Snapshot date */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              Snapshot Date
            </label>
            <input
              type="date"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleParsePreview}
              disabled={!mappings['symbol'] || !mappings['shares']}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
            >
              Preview Data
            </button>
            <button onClick={reset} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && parseResult && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-600">{parseResult.positions.length} positions parsed</span>
            {parseResult.warnings.length > 0 && (
              <span className="text-amber-600 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {parseResult.warnings.length} warnings
              </span>
            )}
            {parseResult.errors.length > 0 && (
              <span className="text-red-600">{parseResult.errors.length} errors</span>
            )}
          </div>

          {/* Warnings */}
          {parseResult.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 max-h-24 overflow-y-auto">
              {parseResult.warnings.slice(0, 10).map((w, i) => (
                <p key={i} className="text-[11px] text-amber-700">{w}</p>
              ))}
              {parseResult.warnings.length > 10 && (
                <p className="text-[11px] text-amber-500 mt-1">...and {parseResult.warnings.length - 10} more</p>
              )}
            </div>
          )}

          {/* Data table preview */}
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Symbol</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Shares</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Price</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Mkt Value</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parseResult.positions.slice(0, 50).map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50/50">
                    <td className="px-3 py-1.5 font-mono font-medium text-gray-900">{p.symbol}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{p.shares.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{p.price != null ? `$${p.price.toFixed(2)}` : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{p.market_value != null ? `$${p.market_value.toLocaleString()}` : '—'}</td>
                    <td className="px-3 py-1.5">
                      {p.warning ? (
                        <span className="text-amber-600 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> Unresolved
                        </span>
                      ) : (
                        <span className="text-green-600 flex items-center gap-0.5">
                          <Check className="w-3 h-3" /> Matched
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parseResult.positions.length > 50 && (
              <div className="px-3 py-2 bg-gray-50 text-xs text-gray-400 text-center">
                Showing 50 of {parseResult.positions.length} positions
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleUpload}
              disabled={parseResult.positions.length === 0 || uploadMutation.isPending}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
            >
              {uploadMutation.isPending ? 'Uploading...' : `Upload ${parseResult.positions.length} Positions`}
            </button>
            <button onClick={() => setStep('mapping')} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors">
              Back to Mapping
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && (
        <div className="text-center py-6 bg-green-50 border border-green-200 rounded-lg">
          <Check className="w-8 h-8 text-green-600 mx-auto mb-2" />
          <p className="text-sm font-medium text-green-800">Holdings uploaded successfully</p>
          <p className="text-xs text-green-600 mt-1">Snapshot created for {snapshotDate}</p>
          <button onClick={reset} className="mt-3 px-4 py-1.5 text-xs font-medium rounded-lg border border-green-300 text-green-700 hover:bg-green-100 transition-colors">
            Upload Another
          </button>
        </div>
      )}

      {/* Upload History */}
      {uploadHistory.length > 0 && step === 'upload' && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Recent Uploads</h4>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {uploadHistory.slice(0, 5).map((entry) => (
              <div key={entry.id} className="px-3 py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-gray-700">{entry.filename}</span>
                  <span className="text-gray-400">{entry.positions_count} positions</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={clsx(
                    'px-1.5 py-0.5 rounded text-[10px] font-medium',
                    entry.status === 'success' ? 'bg-green-100 text-green-700' :
                    entry.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  )}>
                    {entry.status}
                  </span>
                  <span className="text-gray-400">{new Date(entry.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
