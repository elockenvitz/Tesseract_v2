import { useState, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import {
  Loader2,
  Plus,
  Edit2,
  Check,
  X,
  TrendingUp,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Trash2,
  Upload,
  User
} from 'lucide-react'
import { useModelFiles } from '../../hooks/useModelTemplates'
import { useAnalystEstimates } from '../../hooks/useAnalystEstimates'
import { useAuth } from '../../hooks/useAuth'
import { formatDistanceToNow } from 'date-fns'

interface AnalystEstimatesSectionProps {
  assetId: string
  className?: string
  isEditable?: boolean
}

// Format value based on type
const formatValue = (value: any, type?: string) => {
  if (value === null || value === undefined) return '—'

  const numValue = typeof value === 'number' ? value : parseFloat(value)

  if (isNaN(numValue)) return String(value)

  switch (type) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(numValue)
    case 'percent':
      return `${numValue.toFixed(1)}%`
    case 'ratio':
      return numValue.toFixed(2)
    default:
      return numValue >= 1000
        ? new Intl.NumberFormat('en-US', {
            notation: 'compact',
            maximumFractionDigits: 1
          }).format(numValue)
        : numValue.toFixed(2)
  }
}

// Unified estimate interface
interface EstimateField {
  id: string
  field: string
  label: string
  value: any
  formattedValue: string
  type?: string
  source: 'model' | 'manual'
  sourceLabel?: string // model name or "Manual"
  userId?: string
  userName?: string
  updatedAt?: string
}

// Add field row component
interface AddFieldRowProps {
  onAdd: (field: string, label: string, value: number, type: string) => void
  onCancel: () => void
  isSaving: boolean
}

function AddFieldRow({ onAdd, onCancel, isSaving }: AddFieldRowProps) {
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [type, setType] = useState<'number' | 'currency' | 'percent'>('number')

  const handleSave = () => {
    if (!label.trim() || !value.trim()) return
    const numValue = parseFloat(value)
    if (isNaN(numValue)) return

    const field = label.toLowerCase().replace(/\s+/g, '_')
    onAdd(field, label.trim(), numValue, type)
  }

  return (
    <div className="flex items-center gap-2 py-2 bg-gray-50 px-3 rounded-lg mt-2">
      <input
        type="text"
        placeholder="Field name (e.g., EPS FY25)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        autoFocus
      />
      <input
        type="number"
        step="0.01"
        placeholder="Value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-28 px-2 py-1.5 text-sm text-right border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as any)}
        className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent"
      >
        <option value="number">#</option>
        <option value="currency">$</option>
        <option value="percent">%</option>
      </select>
      <button
        onClick={handleSave}
        disabled={isSaving || !label.trim() || !value.trim()}
        className="p-1.5 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
      >
        {isSaving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Check className="w-4 h-4" />
        )}
      </button>
      <button
        onClick={onCancel}
        className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// Field row component
interface FieldRowProps {
  field: EstimateField
  isEditable: boolean
  onEdit?: (value: number) => void
  onDelete?: () => void
  isSaving?: boolean
}

function FieldRow({ field, isEditable, onEdit, onDelete, isSaving }: FieldRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const handleStartEdit = () => {
    setEditValue(String(field.value))
    setIsEditing(true)
  }

  const handleSave = () => {
    const numValue = parseFloat(editValue)
    if (isNaN(numValue)) return
    onEdit?.(numValue)
    setIsEditing(false)
  }

  const canEdit = isEditable && field.source === 'manual'

  return (
    <div className="flex items-center py-2.5 border-b border-gray-100 last:border-0">
      {/* Label & Source */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-900">{field.label}</span>
        {field.sourceLabel && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">
            {field.source === 'model' ? (
              <FileSpreadsheet className="w-3 h-3" />
            ) : null}
            <span>{field.sourceLabel}</span>
            {field.userName && (
              <>
                <span>·</span>
                <span>{field.userName}</span>
              </>
            )}
            {field.updatedAt && (
              <>
                <span>·</span>
                <span>{formatDistanceToNow(new Date(field.updatedAt), { addSuffix: true })}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="flex items-center gap-2">
        {isEditing ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') setIsEditing(false)
              }}
            />
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="p-1 text-green-600 hover:bg-green-50 rounded"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="p-1 text-gray-400 hover:bg-gray-100 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <span className="text-sm font-semibold text-gray-900">
              {field.formattedValue}
            </span>
            {canEdit && (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleStartEdit}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onDelete}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Main component
export function AnalystEstimatesSection({
  assetId,
  className,
  isEditable = false
}: AnalystEstimatesSectionProps) {
  const { user } = useAuth()
  const [isExpanded, setIsExpanded] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch model files to get extracted data
  const { files: modelFiles, isLoading: filesLoading, uploadFile } = useModelFiles({
    assetId,
    latestOnly: true
  })

  // Fetch manual estimates
  const {
    myEstimates,
    saveEstimate,
    deleteEstimate,
    isLoading: estimatesLoading
  } = useAnalystEstimates({ assetId })

  // Build unified list of estimate fields
  const allFields = useMemo(() => {
    const fields: EstimateField[] = []

    // Add fields from model files
    for (const file of modelFiles || []) {
      if (!file.extracted_data?.values) continue

      const values = file.extracted_data.values as Array<{
        field: string
        label?: string
        formattedValue: any
        value?: any
        type?: string
      }>

      for (const val of values) {
        fields.push({
          id: `${file.id}-${val.field}`,
          field: val.field,
          label: val.label || val.field,
          value: val.value ?? val.formattedValue,
          formattedValue: String(val.formattedValue ?? formatValue(val.value, val.type)),
          type: val.type,
          source: 'model',
          sourceLabel: file.filename,
          userId: file.user_id,
          userName: file.user ? `${file.user.first_name || ''} ${file.user.last_name || ''}`.trim() || undefined : undefined,
          updatedAt: file.synced_at || file.updated_at
        })
      }
    }

    // Add manual estimates
    for (const est of myEstimates) {
      fields.push({
        id: est.id,
        field: est.metric_key,
        label: est.notes || est.metric_key,
        value: est.value,
        formattedValue: formatValue(est.value, 'number'),
        type: 'number',
        source: 'manual',
        updatedAt: est.updated_at
      })
    }

    return fields
  }, [modelFiles, myEstimates])

  // Handle file upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      await uploadFile.mutateAsync({
        file,
        assetId
      })
    } catch (err) {
      console.error('Upload error:', err)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Handle adding a manual field
  const handleAddField = async (field: string, label: string, value: number, type: string) => {
    await saveEstimate.mutateAsync({
      metricKey: field,
      periodType: 'annual',
      fiscalYear: new Date().getFullYear(),
      value,
      notes: label,
      source: 'manual'
    })
    setIsAdding(false)
  }

  // Handle editing a manual field
  const handleEditField = async (estimateId: string, newValue: number) => {
    const estimate = myEstimates.find(e => e.id === estimateId)
    if (!estimate) return

    await saveEstimate.mutateAsync({
      metricKey: estimate.metric_key,
      periodType: estimate.period_type,
      fiscalYear: estimate.fiscal_year,
      fiscalQuarter: estimate.fiscal_quarter,
      value: newValue,
      notes: estimate.notes || undefined,
      source: 'manual'
    })
  }

  // Handle deleting a manual field
  const handleDeleteField = async (estimateId: string) => {
    if (confirm('Delete this field?')) {
      await deleteEstimate.mutateAsync(estimateId)
    }
  }

  const isLoading = filesLoading || estimatesLoading
  const hasData = allFields.length > 0

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1"
        >
          <TrendingUp className="w-4 h-4 text-gray-500" />
          <h4 className="text-sm font-medium text-gray-900">Estimates</h4>
          {hasData && (
            <span className="text-xs text-gray-500">
              ({allFields.length})
            </span>
          )}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {/* Actions */}
        {isEditable && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              Upload Model
            </button>
            <button
              onClick={() => setIsAdding(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Field
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-2">
          {/* Fields list */}
          {hasData ? (
            <div>
              {allFields.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  isEditable={isEditable}
                  onEdit={field.source === 'manual' ? (value) => handleEditField(field.id, value) : undefined}
                  onDelete={field.source === 'manual' ? () => handleDeleteField(field.id) : undefined}
                  isSaving={saveEstimate.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="py-6 text-center">
              <FileSpreadsheet className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500 mb-3">No estimates captured yet</p>
              {isEditable && (
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    Upload Model
                  </button>
                  <span className="text-gray-400">or</span>
                  <button
                    onClick={() => setIsAdding(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 border border-primary-300 hover:border-primary-400 rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Field
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Add field form */}
          {isAdding && (
            <AddFieldRow
              onAdd={handleAddField}
              onCancel={() => setIsAdding(false)}
              isSaving={saveEstimate.isPending}
            />
          )}
        </div>
      )}
    </div>
  )
}
