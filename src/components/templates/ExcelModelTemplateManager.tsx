import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import * as XLSX from 'xlsx'
import {
  Plus,
  Edit2,
  Trash2,
  Copy,
  Check,
  X,
  Loader2,
  FileSpreadsheet,
  Share2,
  ChevronDown,
  ChevronRight,
  Grid3X3,
  Target,
  Settings,
  Building2,
  Users,
  Search,
  User,
  Lock,
  Calendar,
  ArrowLeft,
  Upload,
  MousePointer2,
  Table,
  Sparkles,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Download,
  FileUp
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import {
  useModelTemplates,
  ModelTemplate,
  FieldMapping,
  DynamicFieldMapping,
  SnapshotRange,
  DetectionRules,
  COMMON_FIELD_MAPPINGS,
  STATIC_PRESET_CATEGORIES,
  METRIC_CATEGORIES,
  PERIOD_TYPES,
  AVAILABLE_YEARS,
  buildTimePeriod,
  generateFieldMapping,
  MetricDefinition,
  PeriodTypeOption
} from '../../hooks/useModelTemplates'
import { useAuth } from '../../hooks/useAuth'
import { ModelTemplateSharingModal } from './ModelTemplateSharingModal'
import {
  detectFields,
  previewExtraction,
  previewDynamicMapping,
  detectDynamicMappings,
  convertDetectedToMapping,
  DynamicExtractedField,
  DetectedField,
  DetectedDynamicMapping
} from '../../utils/excelParser'
import { useSearchUsers } from '../../hooks/useTemplateCollaborations'
import { supabase } from '../../lib/supabase'
import { useQuery } from '@tanstack/react-query'

// ============================================================================
// TYPES
// ============================================================================

interface SnapshotRangeEditorProps {
  ranges: SnapshotRange[]
  onChange: (ranges: SnapshotRange[]) => void
  workbook: XLSX.WorkBook | null
}

interface DetectionRulesEditorProps {
  rules: DetectionRules
  onChange: (rules: DetectionRules) => void
}

// ============================================================================
// PRESET DROPDOWN (Portal-based with Metric + Period selection)
// ============================================================================

interface PresetDropdownProps {
  mappings: FieldMapping[]
  onAddMapping: (mapping: FieldMapping) => void
  onAddCustomField: () => void
  showDropdown: boolean
  setShowDropdown: (show: boolean) => void
  detectedFields?: DetectedField[]
  pendingCell?: string | null // Cell selected for new mapping
  onSetPendingCell?: (cell: string | null) => void
  onStartCellSelection?: () => void // Callback to start cell selection mode
}

type DropdownView = 'main' | 'periods'

function PresetDropdown({
  mappings,
  onAddMapping,
  onAddCustomField,
  showDropdown,
  setShowDropdown,
  detectedFields = [],
  pendingCell = null,
  onSetPendingCell,
  onStartCellSelection,
}: PresetDropdownProps) {
  const [search, setSearch] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'static' | 'metrics'>('metrics')
  const [view, setView] = useState<DropdownView>('main')
  const [manualCellInput, setManualCellInput] = useState('')
  const [selectedMetric, setSelectedMetric] = useState<MetricDefinition | null>(null)
  const [selectedPeriodType, setSelectedPeriodType] = useState<PeriodTypeOption | null>(null)

  // Get already added fields and detected fields
  const addedFields = new Set(mappings.map(m => m.field))
  const detectedFieldIds = new Set(detectedFields.map(d => d.suggestedField))

  const closeDropdown = () => {
    setShowDropdown(false)
    setSearch('')
    setView('main')
    setSelectedMetric(null)
    setSelectedPeriodType(null)
  }

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleSelectMetric = (metric: MetricDefinition) => {
    if (metric.supportsPeriods) {
      setSelectedMetric(metric)
      setSelectedPeriodType(null)
      setView('periods')
    } else {
      // Add metric without period
      const mapping = generateFieldMapping(metric)
      if (!addedFields.has(mapping.field) && pendingCell) {
        onAddMapping({ ...mapping, cell: pendingCell })
        closeDropdown()
      }
    }
  }

  const handleSelectPeriodType = (periodType: PeriodTypeOption) => {
    setSelectedPeriodType(periodType)
  }

  const handleSelectYear = (year: number) => {
    if (!selectedMetric || !selectedPeriodType || !pendingCell) return
    const period = buildTimePeriod(selectedPeriodType, year)
    const mapping = generateFieldMapping(selectedMetric, period)
    if (!addedFields.has(mapping.field)) {
      onAddMapping({ ...mapping, cell: pendingCell })
      closeDropdown() // Close after adding since cell is specific
    }
  }

  const handleAddStaticPreset = (key: string, preset: FieldMapping) => {
    if (!addedFields.has(preset.field) && pendingCell) {
      onAddMapping({ ...preset, cell: pendingCell, isPreset: true })
      closeDropdown()
    }
  }

  // Filter static presets based on search
  const filteredStaticCategories = STATIC_PRESET_CATEGORIES.map(category => {
    if (!search) return category
    const filteredPresets = Object.entries(category.presets).filter(([key, preset]) =>
      preset.label?.toLowerCase().includes(search.toLowerCase()) ||
      key.toLowerCase().includes(search.toLowerCase())
    )
    return { ...category, presets: Object.fromEntries(filteredPresets) }
  }).filter(category => Object.keys(category.presets).length > 0)

  // Filter metric categories based on search
  const filteredMetricCategories = METRIC_CATEGORIES.map(category => {
    if (!search) return category
    const filteredMetrics = category.metrics.filter(m =>
      m.label.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase())
    )
    return { ...category, metrics: filteredMetrics }
  }).filter(category => category.metrics.length > 0)

  // Get available period types for selected metric
  const getAvailablePeriodTypes = () => {
    if (!selectedMetric?.periodsAllowed) return []
    return PERIOD_TYPES.filter(pt => selectedMetric.periodsAllowed?.includes(pt.category))
  }

  const availablePeriodTypes = getAvailablePeriodTypes()
  const annualTypes = availablePeriodTypes.filter(pt => pt.category === 'annual')
  const quarterlyTypes = availablePeriodTypes.filter(pt => pt.category === 'quarterly')

  // Only render the modal portal when showDropdown is true
  if (!showDropdown) return null

  return createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={closeDropdown}
            />
            {/* Modal */}
            <div className="relative z-10 w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-gray-900">Add New Field</h3>
                  {pendingCell && (
                    <span className="text-sm text-gray-500">
                      for cell <code className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">{pendingCell}</code>
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeDropdown}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Step 1: Cell Selection */}
              <div className={clsx(
                "px-4 py-3 border-b",
                pendingCell ? "border-green-200 bg-green-50" : "border-blue-200 bg-blue-50"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={clsx(
                      "flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold",
                      pendingCell ? "bg-green-500 text-white" : "bg-blue-500 text-white"
                    )}>
                      {pendingCell ? '✓' : '1'}
                    </span>
                    <span className="text-sm font-medium text-gray-700">
                      {pendingCell ? 'Cell Selected' : 'Select Cell'}
                    </span>
                  </div>
                  {pendingCell ? (
                    <div className="flex items-center gap-2">
                      <code className="px-2 py-1 bg-green-100 text-green-800 rounded font-mono text-sm">
                        {pendingCell}
                      </code>
                      <button
                        type="button"
                        onClick={() => onSetPendingCell?.(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={manualCellInput}
                        onChange={(e) => setManualCellInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && manualCellInput.trim()) {
                            onSetPendingCell?.(manualCellInput.trim())
                            setManualCellInput('')
                          }
                        }}
                        placeholder="e.g., B5"
                        className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                      />
                      <span className="text-xs text-gray-400">or</span>
                      <button
                        type="button"
                        onClick={() => {
                          closeDropdown()
                          onStartCellSelection?.()
                        }}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium"
                      >
                        Click in Spreadsheet
                      </button>
                    </div>
                  )}
                </div>
              </div>

            {view === 'main' ? (
              <>
                {/* Step 2: Select Field Header */}
                <div className={clsx(
                  "px-4 py-2 border-b flex items-center gap-2",
                  pendingCell ? "border-gray-200 bg-gray-50" : "border-gray-100 bg-gray-50/50"
                )}>
                  <span className={clsx(
                    "flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold",
                    pendingCell ? "bg-primary-500 text-white" : "bg-gray-300 text-gray-500"
                  )}>
                    2
                  </span>
                  <span className={clsx(
                    "text-sm font-medium",
                    pendingCell ? "text-gray-700" : "text-gray-400"
                  )}>
                    Select Field
                  </span>
                  {!pendingCell && (
                    <span className="text-xs text-gray-400 ml-auto">Select a cell first</span>
                  )}
                </div>

                {/* Field Selection Content - Disabled when no cell selected */}
                <div className={clsx(!pendingCell && "opacity-50 pointer-events-none")}>
                  {/* Tabs */}
                  <div className="flex border-b border-gray-200">
                    <button
                      type="button"
                      onClick={() => setActiveTab('metrics')}
                      className={clsx(
                        'flex-1 px-4 py-2 text-sm font-medium',
                        activeTab === 'metrics'
                          ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      )}
                    >
                      <Calendar className="w-4 h-4 inline mr-1.5" />
                      Metrics + Period
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('static')}
                      className={clsx(
                        'flex-1 px-4 py-2 text-sm font-medium',
                        activeTab === 'static'
                          ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      )}
                    >
                      <Settings className="w-4 h-4 inline mr-1.5" />
                      Settings & Other
                    </button>
                  </div>

                {/* Search */}
                <div className="p-2 border-b border-gray-100">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search..."
                      className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Content */}
                <div className="max-h-96 overflow-y-auto">
                  {/* Custom Field Option */}
                  <button
                    type="button"
                    onClick={() => {
                      onAddCustomField()
                      closeDropdown()
                    }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left border-b border-gray-100 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2">
                      <Edit2 className="w-4 h-4 text-gray-500" />
                      <span className="font-medium text-gray-700">Custom Field</span>
                    </div>
                    <span className="text-xs text-gray-500">Enter your own field ID</span>
                  </button>

                  {activeTab === 'metrics' ? (
                    // Metrics tab
                    filteredMetricCategories.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">No metrics found</p>
                    ) : (
                      filteredMetricCategories.map((category) => {
                        const isExpanded = expandedCategories.has(category.name) || search.length > 0
                        return (
                          <div key={category.name}>
                            <button
                              type="button"
                              onClick={() => toggleCategory(category.name)}
                              className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 sticky top-0"
                            >
                              <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                {category.name}
                              </div>
                              <span className="text-xs text-gray-500">{category.metrics.length}</span>
                            </button>
                            {isExpanded && (
                              <div className="py-1">
                                {category.metrics.map(metric => (
                                  <button
                                    key={metric.id}
                                    type="button"
                                    onClick={() => handleSelectMetric(metric)}
                                    className="w-full flex items-center justify-between px-6 py-1.5 text-sm text-left text-gray-700 hover:bg-primary-50"
                                  >
                                    <span>{metric.label}</span>
                                    <ChevronRight className="w-4 h-4 text-gray-400" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )
                  ) : (
                    // Static presets tab
                    filteredStaticCategories.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">No presets found</p>
                    ) : (
                      filteredStaticCategories.map((category) => {
                        const isExpanded = expandedCategories.has(category.name) || search.length > 0
                        const presetEntries = Object.entries(category.presets)
                        const addedCount = presetEntries.filter(([_, p]) => addedFields.has(p.field)).length

                        return (
                          <div key={category.name}>
                            <button
                              type="button"
                              onClick={() => toggleCategory(category.name)}
                              className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 sticky top-0"
                            >
                              <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                {category.name}
                              </div>
                              <span className="text-xs text-gray-500">
                                {addedCount > 0 && `${addedCount}/`}{presetEntries.length}
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="py-1">
                                {presetEntries.map(([key, preset]) => {
                                  const isAdded = addedFields.has(preset.field)
                                  const isDetected = detectedFieldIds.has(preset.field)
                                  const isUnavailable = isAdded || isDetected
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => !isUnavailable && handleAddStaticPreset(key, preset as FieldMapping)}
                                      disabled={isUnavailable}
                                      className={clsx(
                                        'w-full flex items-center justify-between px-6 py-1.5 text-sm text-left',
                                        isUnavailable ? 'text-gray-400 cursor-not-allowed bg-gray-50' : 'text-gray-700 hover:bg-primary-50'
                                      )}
                                    >
                                      <span>{preset.label}</span>
                                      {isAdded ? (
                                        <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                                          <Check className="w-3 h-3" />
                                          Mapped
                                        </span>
                                      ) : isDetected ? (
                                        <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                          <Sparkles className="w-3 h-3" />
                                          Auto-detected
                                        </span>
                                      ) : null}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )
                  )}
                </div>
                </div>
              </>
            ) : (
              // Period selection view - Two step: Period Type → Year
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedPeriodType) {
                        setSelectedPeriodType(null)
                      } else {
                        setView('main')
                        setSelectedMetric(null)
                      }
                    }}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900">
                      {selectedMetric?.label}
                    </span>
                    {selectedPeriodType && (
                      <span className="text-sm text-gray-500 ml-2">
                        → {selectedPeriodType}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 space-y-4 max-h-96 overflow-y-auto">
                  {!selectedPeriodType ? (
                    // Step 1: Select period type
                    <>
                      <p className="text-xs font-medium text-gray-500">Select period type</p>

                      {/* Current (no period) option */}
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedMetric && !addedFields.has(selectedMetric.id) && pendingCell) {
                              const mapping = generateFieldMapping(selectedMetric)
                              onAddMapping({ ...mapping, cell: pendingCell })
                              closeDropdown()
                            }
                          }}
                          disabled={selectedMetric ? addedFields.has(selectedMetric.id) : !pendingCell}
                          className={clsx(
                            'w-full px-4 py-3 text-sm font-medium rounded-lg border transition-colors text-left',
                            selectedMetric && addedFields.has(selectedMetric.id)
                              ? 'bg-green-50 border-green-200 text-green-700'
                              : 'border-primary-200 bg-primary-50 text-primary-700 hover:border-primary-400 hover:bg-primary-100'
                          )}
                        >
                          {selectedMetric && addedFields.has(selectedMetric.id) && <Check className="w-3 h-3 inline mr-1" />}
                          Current
                          <span className="block text-xs font-normal text-primary-500 mt-0.5">
                            No specific time period
                          </span>
                        </button>
                      </div>

                      {/* Annual types */}
                      {annualTypes.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-2">Annual</p>
                          <div className="flex gap-2">
                            {annualTypes.map(pt => (
                              <button
                                key={pt.id}
                                type="button"
                                onClick={() => handleSelectPeriodType(pt.id)}
                                className="flex-1 px-4 py-3 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-primary-400 hover:bg-primary-50 transition-colors"
                              >
                                {pt.id}
                                <span className="block text-xs font-normal text-gray-400 mt-0.5">
                                  {pt.label}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Quarterly types */}
                      {quarterlyTypes.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-2">Quarterly</p>
                          <div className="grid grid-cols-4 gap-2">
                            {quarterlyTypes.map(pt => (
                              <button
                                key={pt.id}
                                type="button"
                                onClick={() => handleSelectPeriodType(pt.id)}
                                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-primary-400 hover:bg-primary-50 transition-colors"
                              >
                                {pt.id}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    // Step 2: Select year(s)
                    <>
                      <p className="text-xs font-medium text-gray-500">
                        Select year for {selectedMetric?.label} {selectedPeriodType}
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        {AVAILABLE_YEARS.map(year => {
                          const period = buildTimePeriod(selectedPeriodType, year)
                          const fieldId = selectedMetric ? generateFieldMapping(selectedMetric, period).field : ''
                          const isAdded = addedFields.has(fieldId)
                          const isDetected = detectedFieldIds.has(fieldId)
                          const isUnavailable = isAdded || isDetected
                          return (
                            <button
                              key={year}
                              type="button"
                              onClick={() => !isUnavailable && handleSelectYear(year)}
                              disabled={isUnavailable}
                              className={clsx(
                                'px-3 py-2 text-sm rounded-lg border transition-colors flex items-center justify-center gap-1',
                                isAdded
                                  ? 'bg-green-50 border-green-200 text-green-700'
                                  : isDetected
                                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                                  : 'bg-white border-gray-200 text-gray-700 hover:border-primary-400 hover:bg-primary-50'
                              )}
                            >
                              {year}
                              {isAdded && (
                                <span className="flex items-center gap-0.5 text-[10px] bg-green-100 px-1 rounded">
                                  <Check className="w-2.5 h-2.5" />
                                </span>
                              )}
                              {isDetected && !isAdded && (
                                <span className="flex items-center gap-0.5 text-[10px] bg-amber-100 px-1 rounded">
                                  <Sparkles className="w-2.5 h-2.5" />
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>

                      {/* Quick preview of what will be added */}
                      <div className="mt-2 p-2 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-500">
                          Click years to add: <span className="font-medium text-gray-700">{selectedPeriodType}{'{year}'} {selectedMetric?.label}</span>
                        </p>
                      </div>
                    </>
                  )}
                </div>

                <div className="px-3 py-2 border-t border-gray-200 bg-gray-50">
                  <button
                    type="button"
                    onClick={closeDropdown}
                    className="w-full px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
            </div>
          </div>,
    document.body
  )
}

// ============================================================================
// SPREADSHEET VIEWER (for cell selection)
// ============================================================================

interface SpreadsheetViewerProps {
  workbook: XLSX.WorkBook
  onCellSelect: (cellRef: string) => void
  onCreateMappingFromCell?: (cellRef: string, value: string) => void
  selectingForIndex: number | null
  isSelectingForNewField?: boolean
  isSelectingDynamicRow?: boolean
  isSelectingDynamicColumn?: boolean
  onCancelSelection?: () => void
  detectedFields?: DetectedField[]
  acceptedMappings?: FieldMapping[]
  editingCell?: string | null
  onConfirmField?: (field: DetectedField) => void
  onEditField?: (field: DetectedField) => void
  onRejectField?: (field: DetectedField) => void
  // Dynamic mapping detection from preview
  detectedDynamicMappings?: DetectedDynamicMapping[]
  acceptedDynamicIds?: Set<string>
  onAcceptDynamic?: (detected: DetectedDynamicMapping) => void
  onRejectDynamic?: (id: string) => void
  // Accepted dynamic mappings for green highlighting
  acceptedDynamicMappings?: DynamicFieldMapping[]
  onRemoveDynamicMapping?: (id: string) => void
  // Focus/scroll to specific cell or range
  focusCell?: {
    cell: string;
    sheet?: string;
    mappingName: string;
    mappingType: 'fixed' | 'dynamic';
    range?: { startRow: number; endRow: number; columns: string[] };
  } | null
  onFocusCellHandled?: () => void
  onClearFocus?: () => void
}

function SpreadsheetViewer({
  workbook,
  onCellSelect,
  onCreateMappingFromCell,
  selectingForIndex,
  isSelectingForNewField = false,
  isSelectingDynamicRow = false,
  isSelectingDynamicColumn = false,
  onCancelSelection,
  detectedFields = [],
  acceptedMappings = [],
  editingCell = null,
  onConfirmField,
  onEditField,
  onRejectField,
  detectedDynamicMappings = [],
  acceptedDynamicIds = new Set(),
  onAcceptDynamic,
  onRejectDynamic,
  acceptedDynamicMappings = [],
  onRemoveDynamicMapping,
  focusCell,
  onFocusCellHandled,
  onClearFocus
}: SpreadsheetViewerProps) {
  const [activeSheet, setActiveSheet] = useState(workbook.SheetNames[0])
  const [hoveredCell, setHoveredCell] = useState<string | null>(null)
  const [hoveredDynamicRow, setHoveredDynamicRow] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [hasScrolled, setHasScrolled] = useState(false)

  // Handle focus cell navigation - scroll once when focusCell changes
  useEffect(() => {
    if (focusCell && !hasScrolled) {
      // Switch to correct sheet if specified
      if (focusCell.sheet && workbook.SheetNames.includes(focusCell.sheet)) {
        setActiveSheet(focusCell.sheet)
      }

      // Scroll to the cell after a brief delay to allow sheet switch
      setTimeout(() => {
        const cellElement = document.querySelector(`[data-cell="${focusCell.cell.toUpperCase()}"]`)
        if (cellElement) {
          cellElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
        }
      }, 100)

      setHasScrolled(true)
    }
  }, [focusCell, workbook.SheetNames, hasScrolled])

  // Reset hasScrolled when focusCell changes
  useEffect(() => {
    if (focusCell) {
      setHasScrolled(false)
    }
  }, [focusCell?.cell, focusCell?.mappingName])

  // Check if a cell is in the focused range
  const isCellInFocusedRange = useCallback((cellRef: string): boolean => {
    if (!focusCell) return false

    // For fixed mappings, just check exact cell match
    if (focusCell.mappingType === 'fixed') {
      return cellRef.toUpperCase() === focusCell.cell.toUpperCase()
    }

    // For dynamic mappings with range info
    if (focusCell.range) {
      const match = cellRef.match(/^([A-Z]+)(\d+)$/i)
      if (!match) return false
      const col = match[1].toUpperCase()
      const row = parseInt(match[2], 10)
      return (
        row >= focusCell.range.startRow &&
        row <= focusCell.range.endRow &&
        focusCell.range.columns.includes(col)
      )
    }

    return cellRef.toUpperCase() === focusCell.cell.toUpperCase()
  }, [focusCell])

  // Build a map of detected cells for quick lookup
  // Key: "SheetName!CellRef" or just "CellRef" if no sheet prefix
  const detectedCellMap = useMemo(() => {
    const map = new Map<string, DetectedField>()
    for (const field of detectedFields) {
      // Parse the cell reference - could be "Sheet1!B5" or just "B5"
      const parts = field.cell.split('!')
      const sheetName = parts.length > 1 ? parts[0] : null
      const cellRef = parts.length > 1 ? parts[1] : parts[0]

      // Store with sheet name as key for matching
      if (sheetName) {
        map.set(`${sheetName}!${cellRef}`, field)
      }
      // Also store just the cell ref for current sheet matching
      map.set(cellRef, field)
    }
    return map
  }, [detectedFields])

  // Build a map of accepted/mapped cells for quick lookup
  const acceptedCellMap = useMemo(() => {
    const map = new Map<string, FieldMapping>()
    for (const mapping of acceptedMappings) {
      if (!mapping.cell) continue
      const parts = mapping.cell.split('!')
      const sheetName = parts.length > 1 ? parts[0] : null
      const cellRef = parts.length > 1 ? parts[1] : parts[0]

      if (sheetName) {
        map.set(`${sheetName}!${cellRef}`, mapping)
      }
      map.set(cellRef, mapping)
    }
    return map
  }, [acceptedMappings])

  // Build a map of rows that have detected dynamic mappings
  // Key: "SheetName:rowNumber" -> DetectedDynamicMapping
  const dynamicRowMap = useMemo(() => {
    const map = new Map<string, DetectedDynamicMapping>()
    for (const dm of detectedDynamicMappings) {
      // Only show pending (not accepted or rejected)
      if (acceptedDynamicIds.has(dm.id)) continue
      const key = `${dm.row_match.sheet || workbook.SheetNames[0]}:${dm.rowNumber}`
      map.set(key, dm)
    }
    return map
  }, [detectedDynamicMappings, acceptedDynamicIds, workbook.SheetNames])

  // Build maps of cells that are part of detected dynamic mappings
  // For highlighting: label cells and year header cells
  const { dynamicLabelCells, dynamicHeaderCells } = useMemo(() => {
    const labelCells = new Map<string, DetectedDynamicMapping>() // "SheetName!CellRef" -> mapping
    const headerCells = new Map<string, DetectedDynamicMapping>() // "SheetName!CellRef" -> mapping

    for (const dm of detectedDynamicMappings) {
      // Only show pending (not accepted or rejected)
      if (acceptedDynamicIds.has(dm.id)) continue

      const sheetName = dm.row_match.sheet || workbook.SheetNames[0]

      // Add label cell (the cell with the metric name like "EPS")
      const labelCellRef = `${dm.row_match.label_column}${dm.rowNumber}`
      labelCells.set(`${sheetName}!${labelCellRef}`, dm)

      // Add header cells (the year column headers)
      for (const sample of dm.sampleValues) {
        const headerCellRef = `${sample.column}${dm.column_match.header_row}`
        headerCells.set(`${sheetName}!${headerCellRef}`, dm)
      }
    }

    return { dynamicLabelCells: labelCells, dynamicHeaderCells: headerCells }
  }, [detectedDynamicMappings, acceptedDynamicIds, workbook.SheetNames])

  // Build a map of cells that belong to accepted dynamic mappings (for green highlighting)
  // Map: "SheetName!CellRef" -> { mappingId, isLabelCell }
  const acceptedDynamicCellMap = useMemo(() => {
    const cellMap = new Map<string, { mappingId: string; mappingName: string; isLabelCell: boolean }>()

    for (const mapping of acceptedDynamicMappings) {
      // Preview the mapping to get actual cells
      const preview = previewDynamicMapping(workbook, mapping)
      if (!preview.success || !preview.rowNumber) continue

      const sheetName = mapping.row_match.sheet || workbook.SheetNames[0]

      // Add the label cell (this is the main identifier)
      const labelCellRef = `${mapping.row_match.label_column}${preview.rowNumber}`
      cellMap.set(`${sheetName}!${labelCellRef}`, { mappingId: mapping.id, mappingName: mapping.name, isLabelCell: true })

      // Add all data cells in the row (for each found column)
      for (const col of preview.columnsFound) {
        const dataCellRef = `${col.column}${preview.rowNumber}`
        cellMap.set(`${sheetName}!${dataCellRef}`, { mappingId: mapping.id, mappingName: mapping.name, isLabelCell: false })
        // Also add the header cell
        const headerCellRef = `${col.column}${mapping.column_match.header_row}`
        cellMap.set(`${sheetName}!${headerCellRef}`, { mappingId: mapping.id, mappingName: mapping.name, isLabelCell: false })
      }
    }

    return cellMap
  }, [acceptedDynamicMappings, workbook])

  // Check if a cell is part of an accepted dynamic mapping
  const isAcceptedDynamicCell = (cellRef: string): boolean => {
    const key = `${activeSheet}!${cellRef}`
    return acceptedDynamicCellMap.has(key)
  }

  // Get the accepted dynamic mapping info for a cell
  const getAcceptedDynamicInfo = (cellRef: string): { mappingId: string; mappingName: string; isLabelCell: boolean } | undefined => {
    const key = `${activeSheet}!${cellRef}`
    return acceptedDynamicCellMap.get(key)
  }

  // Get dynamic mapping for a row in current sheet
  const getDynamicMappingForRow = (rowNumber: number): DetectedDynamicMapping | undefined => {
    const key = `${activeSheet}:${rowNumber}`
    return dynamicRowMap.get(key)
  }

  // Check if a cell is a dynamic label cell
  const getDynamicLabelMapping = (cellRef: string): DetectedDynamicMapping | undefined => {
    const key = `${activeSheet}!${cellRef}`
    return dynamicLabelCells.get(key)
  }

  // Check if a cell is a dynamic header cell
  const getDynamicHeaderMapping = (cellRef: string): DetectedDynamicMapping | undefined => {
    const key = `${activeSheet}!${cellRef}`
    return dynamicHeaderCells.get(key)
  }

  // Get detected field for a cell in current sheet
  const getDetectedField = (cellRef: string): DetectedField | undefined => {
    // First try with sheet name prefix
    const withSheet = `${activeSheet}!${cellRef}`
    if (detectedCellMap.has(withSheet)) {
      return detectedCellMap.get(withSheet)
    }
    // Fallback to just cell ref (for single-sheet workbooks)
    return detectedCellMap.get(cellRef)
  }

  // Get accepted mapping for a cell in current sheet
  const getAcceptedMapping = (cellRef: string): FieldMapping | undefined => {
    const withSheet = `${activeSheet}!${cellRef}`
    if (acceptedCellMap.has(withSheet)) {
      return acceptedCellMap.get(withSheet)
    }
    return acceptedCellMap.get(cellRef)
  }

  // Check if a cell is currently being edited
  const isEditingCell = (cellRef: string): boolean => {
    if (!editingCell) return false
    const withSheet = `${activeSheet}!${cellRef}`
    return editingCell === withSheet || editingCell === cellRef
  }

  const sheet = workbook.Sheets[activeSheet]
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }

  // Limit display to reasonable size
  const maxRows = Math.min(range.e.r + 1, 50)
  const maxCols = Math.min(range.e.c + 1, 20)

  const getCellValue = (row: number, col: number) => {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
    const cell = sheet[cellRef]
    if (!cell) return ''
    // Format the value for display
    if (cell.w) return cell.w // formatted value
    if (cell.v !== undefined) return String(cell.v)
    return ''
  }

  const handleCellClick = (row: number, col: number) => {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
    const fullRef = workbook.SheetNames.length > 1 ? `${activeSheet}!${cellRef}` : cellRef

    // If selecting for any type of field, use that callback
    if (isSelectingForNewField || isSelectingDynamicRow || isSelectingDynamicColumn || selectingForIndex !== null) {
      onCellSelect(fullRef)
      return
    }

    // Check if this cell is already mapped or detected
    const isAlreadyMapped = getAcceptedMapping(cellRef)
    const isDetected = getDetectedField(cellRef)

    // If cell is not mapped/detected and we have the create callback, create a new mapping
    if (!isAlreadyMapped && !isDetected && onCreateMappingFromCell) {
      const value = getCellValue(row, col)
      onCreateMappingFromCell(fullRef, value)
    }
  }

  const getColumnLabel = (col: number) => {
    let label = ''
    let c = col
    while (c >= 0) {
      label = String.fromCharCode(65 + (c % 26)) + label
      c = Math.floor(c / 26) - 1
    }
    return label
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Header with sheet tabs */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Table className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Spreadsheet Viewer</span>
          {isSelectingForNewField && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full animate-pulse">
                Click a cell to add fixed field
              </span>
              {onCancelSelection && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCancelSelection()
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          {isSelectingDynamicRow && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full animate-pulse">
                Click a cell with a row label (e.g., "EPS", "Revenue")
              </span>
              {onCancelSelection && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCancelSelection()
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          {isSelectingDynamicColumn && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full animate-pulse">
                Click a column header cell (e.g., "2024", "FY25")
              </span>
              {onCancelSelection && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCancelSelection()
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          {selectingForIndex !== null && !isSelectingForNewField && (
            <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full animate-pulse">
              Click a cell to select
            </span>
          )}
          {focusCell && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full border border-dashed border-green-500">
                {focusCell.mappingType === 'fixed' ? '📍' : '🔄'} {focusCell.mappingName}
              </span>
              <button
                type="button"
                onClick={() => onClearFocus?.()}
                className="text-xs text-gray-500 hover:text-gray-700"
                title="Clear selection"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sheet tabs */}
      {workbook.SheetNames.length > 1 && (
        <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
          {workbook.SheetNames.map(name => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                activeSheet === name
                  ? 'border-primary-500 text-primary-600 bg-white'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Spreadsheet grid */}
      <div className="overflow-auto max-h-96">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-10 px-2 py-1 bg-gray-100 border-b border-r border-gray-200 text-gray-500 font-medium"></th>
              {Array.from({ length: maxCols }, (_, i) => (
                <th
                  key={i}
                  className="min-w-[60px] px-2 py-1 bg-gray-100 border-b border-r border-gray-200 text-gray-500 font-medium text-center"
                >
                  {getColumnLabel(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRows }, (_, rowIndex) => {
              const rowNumber = rowIndex + 1
              const dynamicMapping = getDynamicMappingForRow(rowNumber)
              const isDynamicRow = !!dynamicMapping
              const isHoveredDynamicRow = hoveredDynamicRow === rowNumber

              return (
              <tr key={rowIndex}>
                <td className="px-2 py-1 bg-gray-50 border-b border-r border-gray-200 text-gray-500 font-medium text-center">
                  {rowNumber}
                </td>
                {Array.from({ length: maxCols }, (_, colIndex) => {
                  const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
                  const isHovered = hoveredCell === cellRef
                  const value = getCellValue(rowIndex, colIndex)
                  const acceptedMapping = getAcceptedMapping(cellRef)
                  const isAccepted = !!acceptedMapping
                  const isEditing = isEditingCell(cellRef)
                  const detectedField = getDetectedField(cellRef)
                  const isDetected = !!detectedField && !isAccepted
                  const showActions = isHovered && isDetected && selectingForIndex === null && !isEditing

                  // Check for dynamic mapping cells (label or header) - pending detection
                  const dynamicLabelMapping = getDynamicLabelMapping(cellRef)
                  const dynamicHeaderMapping = getDynamicHeaderMapping(cellRef)
                  const isDynamicLabel = !!dynamicLabelMapping
                  const isDynamicHeader = !!dynamicHeaderMapping
                  const isDynamicCell = isDynamicLabel || isDynamicHeader
                  const dynamicMapping = dynamicLabelMapping || dynamicHeaderMapping

                  // Check for accepted dynamic mapping cells (green highlighting)
                  const isAcceptedDynamic = isAcceptedDynamicCell(cellRef)
                  const acceptedDynamicInfo = isAcceptedDynamic ? getAcceptedDynamicInfo(cellRef) : undefined

                  const isFocused = isCellInFocusedRange(cellRef)

                  return (
                    <td
                      key={colIndex}
                      data-cell={cellRef}
                      onClick={() => {
                        // Clear focus if clicking on a cell that's not part of the focused range
                        if (focusCell && !isFocused) {
                          onClearFocus?.()
                        }
                        if (!showActions) {
                          handleCellClick(rowIndex, colIndex)
                        }
                      }}
                      onMouseEnter={() => setHoveredCell(cellRef)}
                      onMouseLeave={() => setHoveredCell(null)}
                      className={clsx(
                        'relative px-2 py-1 border-b border-r border-gray-200 truncate max-w-[120px] cursor-pointer transition-colors',
                        isFocused
                          ? 'bg-green-50 outline outline-2 outline-dashed outline-green-500 outline-offset-[-2px]'
                          : isEditing
                          ? 'bg-blue-200 ring-2 ring-blue-500 ring-inset'
                          : isHovered && selectingForIndex !== null
                          ? 'bg-primary-100 ring-2 ring-primary-500 ring-inset'
                          : (isAccepted || isAcceptedDynamic) && !isEditing
                          ? 'bg-green-100 ring-1 ring-green-400 ring-inset'
                          : isHovered && isDynamicCell
                          ? 'bg-purple-200 ring-2 ring-purple-400 ring-inset'
                          : isHovered && isDetected
                          ? 'bg-amber-200 ring-2 ring-amber-400 ring-inset'
                          : isHovered && !isAccepted && !isDetected && !isDynamicCell && !isAcceptedDynamic
                          ? 'bg-primary-50 ring-1 ring-primary-300 ring-inset'
                          : isDynamicLabel
                          ? 'bg-purple-200 ring-2 ring-purple-400 ring-inset font-medium'
                          : isDynamicHeader
                          ? 'bg-purple-100 ring-1 ring-purple-300 ring-inset'
                          : isDetected
                          ? 'bg-amber-100 ring-1 ring-amber-300 ring-inset'
                          : 'bg-white',
                        (isSelectingForNewField || isSelectingDynamicRow || isSelectingDynamicColumn || selectingForIndex !== null) ? 'cursor-crosshair' : !isAccepted && !isDetected && !isAcceptedDynamic ? 'cursor-cell' : 'cursor-pointer'
                      )}
                      title={
                        isEditing ? `✏️ Editing: ${value}`
                        : isAccepted ? `✓ ${acceptedMapping.label}: ${value}`
                        : isAcceptedDynamic ? `✓ ${acceptedDynamicInfo?.mappingName || 'Dynamic Mapping'}: ${value}`
                        : isDynamicLabel ? `🔄 Dynamic Label: ${dynamicMapping?.name} - "${value}"`
                        : isDynamicHeader ? `🔄 Dynamic Header: ${dynamicMapping?.name} - ${value}`
                        : isDetected ? `${detectedField.label}: ${value}`
                        : value ? `Click to map: ${value}`
                        : 'Click to map this cell'
                      }
                    >
                      <span className="block truncate">{value}</span>
                      {/* Action buttons overlay for detected fixed fields */}
                      {showActions && detectedField && (
                        <div className="absolute inset-0 flex items-center justify-end gap-0.5 pr-1 bg-gradient-to-l from-amber-200 via-amber-100/90 to-transparent">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onConfirmField?.(detectedField)
                            }}
                            className="p-1 text-green-700 bg-green-100 hover:bg-green-300 rounded transition-colors"
                            title="Accept this field"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onEditField?.(detectedField)
                            }}
                            className="p-1 text-blue-700 bg-blue-100 hover:bg-blue-300 rounded transition-colors"
                            title="Edit this field"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onRejectField?.(detectedField)
                            }}
                            className="p-1 text-red-700 bg-red-100 hover:bg-red-300 rounded transition-colors"
                            title="Reject this field"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {/* Action buttons overlay for detected dynamic mappings (show on label cell hover) */}
                      {isHovered && isDynamicLabel && dynamicMapping && selectingForIndex === null && !isEditing && (
                        <div className="absolute inset-0 flex items-center justify-end gap-0.5 pr-1 bg-gradient-to-l from-purple-300 via-purple-200/90 to-transparent">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onAcceptDynamic?.(dynamicMapping)
                            }}
                            className="p-1 text-green-700 bg-green-100 hover:bg-green-300 rounded transition-colors"
                            title={`Accept "${dynamicMapping.name}" dynamic mapping`}
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onRejectDynamic?.(dynamicMapping.id)
                            }}
                            className="p-1 text-red-700 bg-red-100 hover:bg-red-300 rounded transition-colors"
                            title={`Reject "${dynamicMapping.name}" dynamic mapping`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {/* Action button for accepted dynamic mapping cells (unaccept) */}
                      {isHovered && isAcceptedDynamic && acceptedDynamicInfo && selectingForIndex === null && !isEditing && onRemoveDynamicMapping && (
                        <div className="absolute inset-0 flex items-center justify-end gap-0.5 pr-1 bg-gradient-to-l from-green-200 via-green-100/90 to-transparent">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onRemoveDynamicMapping(acceptedDynamicInfo.mappingId)
                            }}
                            className="p-1 text-red-700 bg-red-100 hover:bg-red-300 rounded transition-colors"
                            title={`Remove "${acceptedDynamicInfo.mappingName}" dynamic mapping`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {/* Footer info - fixed height to prevent layout shift */}
      <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 h-7 flex items-center">
        {hoveredCell ? (
          (() => {
            const hoveredDetectedField = getDetectedField(hoveredCell)
            const cellValue = getCellValue(
              XLSX.utils.decode_cell(hoveredCell).r,
              XLSX.utils.decode_cell(hoveredCell).c
            )
            return (
              <span className="truncate flex items-center gap-2">
                <span>
                  Cell: <code className="px-1 py-0.5 bg-gray-200 rounded">{activeSheet}!{hoveredCell}</code>
                </span>
                {cellValue && (
                  <span>
                    Value: <span className="font-medium text-gray-700">{cellValue}</span>
                  </span>
                )}
                {hoveredDetectedField && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                    <Sparkles className="w-3 h-3" />
                    <span className="font-medium">{hoveredDetectedField.label}</span>
                    <span className={clsx(
                      'px-1 py-0.5 rounded text-[10px] font-medium',
                      hoveredDetectedField.confidence === 'high'
                        ? 'bg-green-200 text-green-800'
                        : hoveredDetectedField.confidence === 'medium'
                        ? 'bg-amber-200 text-amber-800'
                        : 'bg-gray-200 text-gray-600'
                    )}>
                      {hoveredDetectedField.confidence}
                    </span>
                  </span>
                )}
              </span>
            )
          })()
        ) : (
          <span className="text-gray-400">Hover over a cell to see details</span>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// DYNAMIC MAPPINGS SECTION
// ============================================================================

interface DynamicMappingsSectionProps {
  detectedMappings: DetectedDynamicMapping[]
  acceptedIds: Set<string>
  rejectedIds: Set<string>
  onAccept: (detected: DetectedDynamicMapping) => void
  onReject: (id: string) => void
}

// Common year patterns for the dropdown
const YEAR_PATTERNS = [
  { label: 'FY2024, FY2025...', value: 'FY(\\d{4})', description: 'Fiscal Year' },
  { label: '2024, 2025...', value: '(20\\d{2})', description: 'Calendar Year' },
  { label: 'CY2024, CY2025...', value: 'CY(\\d{4})', description: 'Calendar Year with prefix' },
  { label: "'24, '25...", value: "'(\\d{2})", description: 'Short Year' },
]

const QUARTER_PATTERNS = [
  { label: 'Q1 2024, Q2 2024...', value: 'Q([1-4])\\s*(\\d{4})', description: 'Quarter with year' },
  { label: '1Q24, 2Q24...', value: '([1-4])Q(\\d{2})', description: 'Quarter prefix short' },
  { label: 'Q1\'24, Q2\'24...', value: "Q([1-4])'(\\d{2})", description: 'Quarter with apostrophe' },
]

// Visual pattern selector component
function PatternSelector({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [category, setCategory] = useState<'annual' | 'quarterly'>('annual')

  const patterns = category === 'annual' ? YEAR_PATTERNS : QUARTER_PATTERNS

  return (
    <div className="space-y-2">
      {/* Category tabs */}
      <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
        <button
          type="button"
          onClick={() => setCategory('annual')}
          className={`flex-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
            category === 'annual'
              ? 'bg-white text-purple-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Annual
        </button>
        <button
          type="button"
          onClick={() => setCategory('quarterly')}
          className={`flex-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
            category === 'quarterly'
              ? 'bg-white text-purple-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Quarterly
        </button>
      </div>

      {/* Pattern options */}
      <div className="grid grid-cols-2 gap-1.5">
        {patterns.map(p => {
          const isSelected = value === p.value
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(p.value)}
              className={`text-left px-2 py-1.5 rounded-lg border transition-all ${
                isSelected
                  ? 'border-purple-400 bg-purple-50 ring-1 ring-purple-200'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className={`text-xs font-medium ${isSelected ? 'text-purple-700' : 'text-gray-700'}`}>
                {p.label.split(',')[0]}
              </div>
              <div className="text-[10px] text-gray-500">{p.description}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DynamicMappingsSection({
  detectedMappings,
  acceptedIds,
  rejectedIds,
  onAccept,
  onReject
}: DynamicMappingsSectionProps) {
  const [showDetected, setShowDetected] = useState(false) // Collapsed by default

  // Filter detected mappings to only show pending ones (not accepted or rejected)
  const pendingDetected = detectedMappings.filter(
    d => !acceptedIds.has(d.id) && !rejectedIds.has(d.id)
  )

  return (
    <div className="space-y-3 mt-4">
      {/* Auto-detected dynamic mappings (pending) */}
      {pendingDetected.length > 0 && (
        <div className="border border-purple-200 rounded-lg overflow-hidden bg-purple-50/50">
          <button
            type="button"
            onClick={() => setShowDetected(!showDetected)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-purple-100/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-medium text-gray-900">Dynamic Mappings Auto-Detected</span>
              <span className="text-xs bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded-full">
                {pendingDetected.length}
              </span>
            </div>
            {showDetected ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
          </button>

          {showDetected && (
            <div className="px-3 pb-3 space-y-1.5">
              {pendingDetected.map(detected => (
                <div
                  key={detected.id}
                  className="flex items-center justify-between p-2 bg-white rounded-lg border border-purple-200 gap-2"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="font-medium text-gray-900 text-sm truncate">{detected.name}</span>
                    <code className="text-[10px] px-1 py-0.5 bg-purple-100 text-purple-700 rounded shrink-0">
                      {detected.field_pattern}
                    </code>
                    <span className="text-[10px] text-gray-500 shrink-0">
                      Row {detected.rowNumber} • {detected.sampleValues.length} values
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onAccept(detected)}
                      className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                      title="Accept"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onReject(detected.id)}
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Reject"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Sub-component for the dynamic mapping form
function DynamicMappingForm({
  formState,
  setFormState,
  preview,
  onSave,
  onCancel,
  workbook,
  isNew = false
}: {
  formState: Partial<DynamicFieldMapping>
  setFormState: (state: Partial<DynamicFieldMapping>) => void
  preview: ReturnType<typeof previewDynamicMapping> | null
  onSave: () => void
  onCancel: () => void
  workbook: XLSX.WorkBook | null
  isNew?: boolean
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input
            type="text"
            value={formState.name || ''}
            onChange={(e) => setFormState({ ...formState, name: e.target.value })}
            placeholder="e.g., EPS by Year"
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        {/* Field Pattern */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Field Pattern</label>
          <input
            type="text"
            value={formState.field_pattern || ''}
            onChange={(e) => setFormState({ ...formState, field_pattern: e.target.value })}
            placeholder="e.g., eps_fy{year}"
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
          />
          <p className="text-[10px] text-gray-500 mt-0.5">Use {'{year}'} and {'{quarter}'} as placeholders</p>
        </div>
      </div>

      {/* Row matching */}
      <div className="border-t border-gray-200 pt-3">
        <p className="text-xs font-medium text-gray-600 mb-2">Find Row By Label</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Label Column</label>
            <input
              type="text"
              value={formState.row_match?.label_column || 'A'}
              onChange={(e) => setFormState({
                ...formState,
                row_match: { ...formState.row_match!, label_column: e.target.value.toUpperCase() }
              })}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
              maxLength={2}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] text-gray-500 mb-0.5">Label Contains</label>
            <input
              type="text"
              value={formState.row_match?.label_contains || ''}
              onChange={(e) => setFormState({
                ...formState,
                row_match: { ...formState.row_match!, label_contains: e.target.value }
              })}
              placeholder="e.g., EPS, Revenue, EBITDA"
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
            />
          </div>
        </div>
      </div>

      {/* Column matching */}
      <div className="border-t border-gray-200 pt-3">
        <p className="text-xs font-medium text-gray-600 mb-2">Find Columns By Header</p>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Header Row</label>
            <input
              type="number"
              value={formState.column_match?.header_row || 1}
              onChange={(e) => setFormState({
                ...formState,
                column_match: { ...formState.column_match!, header_row: parseInt(e.target.value) || 1 }
              })}
              min={1}
              className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Column Pattern</label>
            <PatternSelector
              value={formState.column_match?.year_pattern || ''}
              onChange={(value) => setFormState({
                ...formState,
                column_match: { ...formState.column_match!, year_pattern: value, quarter_pattern: undefined }
              })}
            />
          </div>
        </div>
      </div>

      {/* Type */}
      <div className="border-t border-gray-200 pt-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Value Type</label>
        <select
          value={formState.type || 'number'}
          onChange={(e) => setFormState({ ...formState, type: e.target.value as FieldMapping['type'] })}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
        >
          <option value="number">Number</option>
          <option value="currency">Currency</option>
          <option value="percent">Percent</option>
          <option value="multiple">Multiple (x)</option>
          <option value="text">Text</option>
        </select>
      </div>

      {/* Preview */}
      {preview && (
        <div className="border-t border-gray-200 pt-3">
          <p className="text-xs font-medium text-gray-600 mb-2">Preview</p>
          {preview.errors.length > 0 ? (
            <div className="text-xs text-red-600 space-y-1">
              {preview.errors.map((err, i) => (
                <div key={i} className="flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {err}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Found row {preview.rowNumber}, {preview.columnsFound.length} columns
              </div>
              {preview.extractedFields.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {preview.extractedFields.map((field, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                      {field.label}: {typeof field.formattedValue === 'number' ? field.formattedValue.toLocaleString() : field.formattedValue}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={onSave}>
          {isNew ? 'Add' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// FIELD MAPPING EDITOR
// ============================================================================

interface FieldMappingEditorProps {
  mappings: FieldMapping[]
  onChange: (mappings: FieldMapping[]) => void
  dynamicMappings: DynamicFieldMapping[]
  onDynamicMappingsChange: (mappings: DynamicFieldMapping[]) => void
  workbook: XLSX.WorkBook | null
  fileName: string | null
  onLoadFile: () => void
  onFileDrop: (file: File) => void
  selectingForIndex: number | null
  onSetSelectingIndex: (index: number | null) => void
  detectedFields: DetectedField[]
  onDetectedFieldsChange: (fields: DetectedField[]) => void
  // Dynamic mapping detection
  detectedDynamicMappings: DetectedDynamicMapping[]
  acceptedDynamicIds: Set<string>
  rejectedDynamicIds: Set<string>
  onAcceptDynamic: (detected: DetectedDynamicMapping) => void
  onRejectDynamic: (id: string) => void
}

// Helper to check if a fixed mapping's cell could overlap with a dynamic mapping's range
function checkOverlap(
  cell: string,
  dynamicMappings: DynamicFieldMapping[],
  workbook: XLSX.WorkBook | null
): DynamicFieldMapping | null {
  if (!workbook || dynamicMappings.length === 0) return null

  // Parse the cell reference to get row number
  const cellMatch = cell.match(/[A-Z]+(\d+)$/)
  if (!cellMatch) return null
  const cellRow = parseInt(cellMatch[1], 10)

  // Check each dynamic mapping to see if this cell's row could match
  for (const dm of dynamicMappings) {
    if (!dm.row_match?.label_contains) continue

    // If cell is in the same row as a dynamic mapping's label search area
    // This is a simplified check - we're looking for potential overlap
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    // Check if the label_contains pattern exists in this row
    const labelCol = dm.row_match.label_column
    const labelCellRef = `${labelCol}${cellRow}`
    const labelCell = sheet[labelCellRef]

    if (labelCell && labelCell.v) {
      const labelValue = String(labelCell.v).toLowerCase()
      const searchTerm = dm.row_match.label_contains.toLowerCase()
      if (labelValue.includes(searchTerm)) {
        // This row matches the dynamic mapping's row pattern
        return dm
      }
    }
  }

  return null
}

// Helper to check if a dynamic mapping overlaps with any fixed mappings
function checkDynamicOverlap(
  dynamicMapping: DynamicFieldMapping,
  fixedMappings: FieldMapping[],
  workbook: XLSX.WorkBook | null
): FieldMapping[] {
  if (!workbook || fixedMappings.length === 0) return []

  const overlapping: FieldMapping[] = []
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet || !dynamicMapping.row_match?.label_contains) return []

  // For each fixed mapping, check if its row matches the dynamic mapping's pattern
  for (const fm of fixedMappings) {
    const cellMatch = fm.cell.match(/[A-Z]+(\d+)$/)
    if (!cellMatch) continue
    const cellRow = parseInt(cellMatch[1], 10)

    const labelCol = dynamicMapping.row_match.label_column
    const labelCellRef = `${labelCol}${cellRow}`
    const labelCell = sheet[labelCellRef]

    if (labelCell && labelCell.v) {
      const labelValue = String(labelCell.v).toLowerCase()
      const searchTerm = dynamicMapping.row_match.label_contains.toLowerCase()
      if (labelValue.includes(searchTerm)) {
        overlapping.push(fm)
      }
    }
  }

  return overlapping
}

// Unified Accepted Mappings Section - shows both fixed and dynamic in one place
function AcceptedMappingsSection({
  fixedMappings,
  fixedPreview,
  dynamicMappings,
  workbook,
  onEditFixed,
  onRemoveFixed,
  onEditDynamic,
  onRemoveDynamic,
  onNavigateToCell
}: {
  fixedMappings: FieldMapping[]
  fixedPreview: Array<{
    field: string
    label?: string
    cell: string
    value: any
    formattedValue: string | number
    found: boolean
    empty?: boolean
  }> | null
  dynamicMappings: DynamicFieldMapping[]
  workbook: XLSX.WorkBook | null
  onEditFixed: (index: number) => void
  onRemoveFixed: (index: number) => void
  onEditDynamic: (id: string) => void
  onRemoveDynamic: (id: string) => void
  onNavigateToCell: (data: {
    cell: string;
    sheet?: string;
    mappingName: string;
    mappingType: 'fixed' | 'dynamic';
    range?: { startRow: number; endRow: number; columns: string[] };
  }) => void
}) {
  const [expanded, setExpanded] = useState(true)

  const hasFixed = fixedMappings.length > 0
  const hasDynamic = dynamicMappings.length > 0

  if (!hasFixed && !hasDynamic) return null

  return (
    <div className="border border-green-200 rounded-lg overflow-hidden bg-green-50/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-green-50 hover:bg-green-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span className="text-sm font-medium text-gray-900">Accepted Mappings</span>
          <div className="flex items-center gap-1.5">
            {hasFixed && (
              <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">
                {fixedMappings.length} fixed
              </span>
            )}
            {hasDynamic && (
              <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                {dynamicMappings.length} dynamic
              </span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="p-3 space-y-1.5">
          {/* Fixed mappings - Pattern: Metric (bold) | Fixed | Tesseract field | Cell ref */}
          {fixedMappings.map((mapping, idx) => {
            const previewItem = fixedPreview?.find(p => p.field === mapping.field && p.cell === mapping.cell)
            const isFound = previewItem?.found ?? false
            const isEmpty = previewItem?.empty ?? false
            return (
              <div
                key={`fixed-${idx}`}
                className={clsx(
                  'flex items-center justify-between px-2 py-1.5 rounded text-sm group',
                  isFound ? 'bg-white border border-green-200' : isEmpty ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                )}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isFound ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  ) : isEmpty ? (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  )}
                  <span className="font-medium text-gray-900 shrink-0">{mapping.label || mapping.field}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full shrink-0">Fixed</span>
                  <code className="text-[10px] px-1 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">{mapping.field}</code>
                  <button
                    type="button"
                    onClick={() => onNavigateToCell({
                      cell: mapping.cell,
                      mappingName: mapping.label || mapping.field,
                      mappingType: 'fixed'
                    })}
                    className="text-[10px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded font-mono hover:bg-blue-200 transition-colors cursor-pointer"
                  >
                    {mapping.cell}
                  </button>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" onClick={() => onEditFixed(idx)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => onRemoveFixed(idx)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}

          {/* Dynamic mappings - Pattern: Metric (bold) | Dynamic | Tesseract fields | Cell refs */}
          {dynamicMappings.map(mapping => {
            const dmPreview = workbook ? previewDynamicMapping(workbook, mapping) : null
            const fieldIds = dmPreview?.extractedFields.map(f => f.field) ?? []
            // Build spreadsheet reference: Row X, columns A-Z
            const rowRef = dmPreview?.rowNumber ? `Row ${dmPreview.rowNumber}` : null
            const columns = dmPreview?.columnsFound?.map(c => c.column) ?? []
            const colRef = columns.length > 0
              ? columns.length === 1
                ? columns[0]
                : `${columns[0]}-${columns[columns.length - 1]}`
              : null
            return (
              <div
                key={`dynamic-${mapping.id}`}
                className="flex items-center justify-between px-2 py-1.5 rounded bg-white border border-purple-200 group"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                  <CheckCircle className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                  <span className="font-medium text-gray-900 shrink-0">{mapping.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full shrink-0">Dynamic</span>
                  {fieldIds.length > 0 && fieldIds.map((fieldId, idx) => (
                    <code key={idx} className="text-[10px] px-1 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">
                      {fieldId}
                    </code>
                  ))}
                  {fieldIds.length === 0 && dmPreview && (
                    <span className="text-[10px] text-amber-600">No fields found</span>
                  )}
                  {rowRef && colRef && (
                    <button
                      type="button"
                      onClick={() => {
                        // Navigate to first data cell of the dynamic mapping
                        const firstCol = columns[0] || 'A'
                        const cellRef = `${firstCol}${dmPreview?.rowNumber || 1}`
                        onNavigateToCell({
                          cell: cellRef,
                          sheet: mapping.row_match.sheet,
                          mappingName: mapping.name,
                          mappingType: 'dynamic',
                          range: dmPreview?.rowNumber ? {
                            startRow: dmPreview.rowNumber,
                            endRow: dmPreview.rowNumber,
                            columns: columns
                          } : undefined
                        })
                      }}
                      className="text-[10px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded font-mono hover:bg-blue-200 transition-colors cursor-pointer"
                    >
                      {rowRef}, {colRef}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button type="button" onClick={() => onEditDynamic(mapping.id)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => onRemoveDynamic(mapping.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FieldMappingEditor({
  mappings,
  onChange,
  dynamicMappings,
  onDynamicMappingsChange,
  workbook,
  fileName,
  onLoadFile,
  onFileDrop,
  selectingForIndex,
  onSetSelectingIndex,
  detectedFields,
  onDetectedFieldsChange,
  detectedDynamicMappings,
  acceptedDynamicIds,
  rejectedDynamicIds,
  onAcceptDynamic,
  onRejectDynamic
}: FieldMappingEditorProps) {
  const [expanded, setExpanded] = useState(true)
  const [showPresetDropdown, setShowPresetDropdown] = useState(false)
  const [showAddNewDropdown, setShowAddNewDropdown] = useState(false)
  const [showDynamicMappingModal, setShowDynamicMappingModal] = useState(false)
  const [selectingForNewField, setSelectingForNewField] = useState(false) // True when selecting a cell for a new fixed field
  const [pendingNewFieldCell, setPendingNewFieldCell] = useState<string | null>(null) // Cell selected for new fixed field
  const [newDynamicMapping, setNewDynamicMapping] = useState<Partial<DynamicFieldMapping>>({
    name: '',
    field_pattern: '',
    row_match: { label_column: 'A', label_contains: '' },
    column_match: { header_row: 1, year_pattern: 'FY(\\d{4})' },
    type: 'number'
  })
  // Dynamic mapping step-by-step selection
  const [dynamicMappingStep, setDynamicMappingStep] = useState<'row' | 'column' | 'configure'>('row')
  const [selectingDynamicRow, setSelectingDynamicRow] = useState(false)
  const [selectingDynamicColumn, setSelectingDynamicColumn] = useState(false)
  const [pendingDynamicRowCell, setPendingDynamicRowCell] = useState<string | null>(null)
  const [pendingDynamicColumnCell, setPendingDynamicColumnCell] = useState<string | null>(null)
  const [showDetected, setShowDetected] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [viewMode, setViewMode] = useState<'spreadsheet' | 'fields'>('spreadsheet')
  const [focusCell, setFocusCell] = useState<{
    cell: string;
    sheet?: string;
    mappingName: string;
    mappingType: 'fixed' | 'dynamic';
    range?: { startRow: number; endRow: number; columns: string[] };
  } | null>(null)
  const [selectedDetections, setSelectedDetections] = useState<Set<string>>(new Set())
  const [rejectedDetections, setRejectedDetections] = useState<Set<string>>(new Set())
  const [isDragging, setIsDragging] = useState(false)
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null)
  const [showEditPresetModal, setShowEditPresetModal] = useState(false)
  const [editingFromDetected, setEditingFromDetected] = useState<DetectedField | null>(null)
  const [isAddingNewField, setIsAddingNewField] = useState(false)
  const [editPresetSearch, setEditPresetSearch] = useState('')
  const [editPresetTab, setEditPresetTab] = useState<'static' | 'metrics'>('metrics')
  const [editPresetExpandedCategories, setEditPresetExpandedCategories] = useState<Set<string>>(new Set())
  const [editPresetSelectedMetric, setEditPresetSelectedMetric] = useState<MetricDefinition | null>(null)
  const [editPresetSelectedPeriodType, setEditPresetSelectedPeriodType] = useState<PeriodTypeOption | null>(null)
  const [editPresetView, setEditPresetView] = useState<'main' | 'periods'>('main')
  const [showAddFieldModal, setShowAddFieldModal] = useState(false)

  // Helper: Get all field IDs covered by dynamic mappings
  const getDynamicMappingFieldIds = useMemo(() => {
    const fieldIds = new Set<string>()
    if (!workbook) return fieldIds

    for (const dm of dynamicMappings) {
      const preview = previewDynamicMapping(workbook, dm)
      if (preview.extractedFields) {
        preview.extractedFields.forEach(f => fieldIds.add(f.field))
      }
    }
    return fieldIds
  }, [dynamicMappings, workbook])

  // Helper: Check if a field ID conflicts with any dynamic mapping
  const getConflictingDynamicMapping = (fieldId: string): DynamicFieldMapping | null => {
    if (!workbook) return null

    for (const dm of dynamicMappings) {
      const preview = previewDynamicMapping(workbook, dm)
      if (preview.extractedFields?.some(f => f.field === fieldId)) {
        return dm
      }
    }
    return null
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (
      droppedFile.name.endsWith('.xlsx') ||
      droppedFile.name.endsWith('.xls') ||
      droppedFile.name.endsWith('.xlsm')
    )) {
      onFileDrop(droppedFile)
    }
  }

  // Calculate extraction preview when workbook or mappings change
  // Only include complete mappings (those with both field and cell set)
  const completeMappings = mappings.filter(m => m.field && m.cell)
  const preview = workbook && completeMappings.length > 0
    ? previewExtraction(workbook, { field_mappings: completeMappings })
    : null

  const foundCount = preview?.filter(p => p.found).length ?? 0
  const totalCount = preview?.length ?? 0

  const addMapping = () => {
    onChange([
      ...mappings,
      { field: '', cell: '', type: 'text', label: '', isPreset: false }
    ])
  }

  const updateMapping = (index: number, updates: Partial<FieldMapping>) => {
    const newMappings = [...mappings]
    newMappings[index] = { ...newMappings[index], ...updates }
    onChange(newMappings)
  }

  const removeMapping = (index: number) => {
    onChange(mappings.filter((_, i) => i !== index))
  }

  const addPresetMapping = (mapping: FieldMapping) => {
    // If we have a pending cell from "Add New > Fixed Field" flow, use it
    const cell = pendingNewFieldCell || mapping.cell
    const newMapping = { ...mapping, cell }

    // Check for conflict with dynamic mappings
    const conflictingDynamic = getConflictingDynamicMapping(newMapping.field)
    if (conflictingDynamic) {
      // Remove the conflicting dynamic mapping since user is explicitly choosing a fixed mapping
      console.log('[Conflict] Fixed mapping', newMapping.field, 'conflicts with dynamic mapping', conflictingDynamic.name, '- removing dynamic')
      onDynamicMappingsChange(dynamicMappings.filter(dm => dm.id !== conflictingDynamic.id))
    }

    if (!mappings.some(m => m.field === newMapping.field && m.cell === newMapping.cell)) {
      onChange([...mappings, newMapping])
    }

    // Clear the pending cell
    setPendingNewFieldCell(null)
  }

  const handleCellSelect = (cellRef: string) => {
    if (selectingForNewField) {
      // Store the selected cell and open preset dropdown to select field
      setPendingNewFieldCell(cellRef)
      setSelectingForNewField(false)
      setShowPresetDropdown(true)
    } else if (selectingDynamicRow) {
      // Store the selected row cell for dynamic mapping
      setPendingDynamicRowCell(cellRef)
      setSelectingDynamicRow(false)
      // Extract row info from cell and update the mapping
      const match = cellRef.match(/([A-Z]+)(\d+)$/i)
      if (match) {
        const colLetter = match[1].toUpperCase()
        const rowNum = parseInt(match[2])
        // Get the cell value to use as label
        if (workbook) {
          const sheetMatch = cellRef.match(/^(.+)!/)
          const sheetName = sheetMatch ? sheetMatch[1] : workbook.SheetNames[0]
          const sheet = workbook.Sheets[sheetName]
          const cellAddr = match[1].toUpperCase() + match[2]
          const cell = sheet?.[cellAddr]
          const labelValue = cell?.v?.toString() || cell?.w || ''
          setNewDynamicMapping(prev => ({
            ...prev,
            row_match: {
              ...prev.row_match!,
              label_column: colLetter,
              label_contains: labelValue
            }
          }))
        }
      }
      setDynamicMappingStep('column')
      setShowDynamicMappingModal(true)
    } else if (selectingDynamicColumn) {
      // Store the selected column header cell for dynamic mapping
      setPendingDynamicColumnCell(cellRef)
      setSelectingDynamicColumn(false)
      // Extract column info from cell
      const match = cellRef.match(/([A-Z]+)(\d+)$/i)
      if (match) {
        const rowNum = parseInt(match[2])
        setNewDynamicMapping(prev => ({
          ...prev,
          column_match: {
            ...prev.column_match!,
            header_row: rowNum
          }
        }))
      }
      setDynamicMappingStep('configure')
      setShowDynamicMappingModal(true)
    } else if (selectingForIndex !== null) {
      updateMapping(selectingForIndex, { cell: cellRef })
      onSetSelectingIndex(null)
    }
  }

  // Helper to check if a field ID matches a preset pattern
  const isPresetField = useCallback((fieldId: string): boolean => {
    // Check static presets
    for (const category of STATIC_PRESET_CATEGORIES) {
      if (Object.values(category.presets).some(p => p.field === fieldId)) {
        return true
      }
    }
    // Check metric + period patterns
    for (const category of METRIC_CATEGORIES) {
      for (const metric of category.metrics) {
        // Exact metric match (no period)
        if (fieldId === metric.id) return true
        // Metric with period suffix (e.g., eps_fy2027, revenue_q1_2027)
        if (fieldId.startsWith(`${metric.id}_`)) {
          const suffix = fieldId.slice(metric.id.length + 1)
          // Check FY/CY patterns (fy2027, cy2027)
          if (/^(fy|cy)\d{4}$/.test(suffix)) return true
          // Check quarterly patterns (q1_2027, q2_2027, etc.)
          if (/^q[1-4]_\d{4}$/.test(suffix)) return true
        }
      }
    }
    return false
  }, [])

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
    const mappingsToAdd: FieldMapping[] = detectedFields
      .filter(d => selectedDetections.has(d.cell))
      .map(d => ({
        field: d.suggestedField,
        cell: d.cell,
        type: d.suggestedType,
        label: d.label,
        isPreset: isPresetField(d.suggestedField)
      }))

    // Check for conflicts with dynamic mappings and remove them
    const conflictingDynamicIds = new Set<string>()
    for (const mapping of mappingsToAdd) {
      const conflicting = getConflictingDynamicMapping(mapping.field)
      if (conflicting) {
        console.log('[Conflict] Fixed mapping', mapping.field, 'conflicts with dynamic mapping', conflicting.name, '- removing dynamic')
        conflictingDynamicIds.add(conflicting.id)
      }
    }
    if (conflictingDynamicIds.size > 0) {
      onDynamicMappingsChange(dynamicMappings.filter(dm => !conflictingDynamicIds.has(dm.id)))
    }

    onChange([...mappings, ...mappingsToAdd])
    setSelectedDetections(new Set())

    // Remove added fields from detected list - also remove any with same suggested field
    const addedCells = new Set(mappingsToAdd.map(m => m.cell))
    const addedFields = new Set(mappingsToAdd.map(m => m.field))
    onDetectedFieldsChange(detectedFields.filter(d =>
      !addedCells.has(d.cell) && !addedFields.has(d.suggestedField)
    ))
  }

  const handleAddSingleDetection = (detected: DetectedField) => {
    const mapping: FieldMapping = {
      field: detected.suggestedField,
      cell: detected.cell,
      type: detected.suggestedType,
      label: detected.label,
      isPreset: isPresetField(detected.suggestedField)
    }

    // Check for conflict with dynamic mappings
    const conflictingDynamic = getConflictingDynamicMapping(mapping.field)
    if (conflictingDynamic) {
      // Remove the conflicting dynamic mapping since user is explicitly choosing a fixed mapping
      console.log('[Conflict] Fixed mapping', mapping.field, 'conflicts with dynamic mapping', conflictingDynamic.name, '- removing dynamic')
      onDynamicMappingsChange(dynamicMappings.filter(dm => dm.id !== conflictingDynamic.id))
    }

    onChange([...mappings, mapping])
    // Remove this detection and any others with the same suggested field
    onDetectedFieldsChange(detectedFields.filter(d =>
      d.cell !== detected.cell && d.suggestedField !== detected.suggestedField
    ))
  }

  // Add detected field and open for editing the field type
  const handleEditDetection = (detected: DetectedField) => {
    const mapping: FieldMapping = {
      field: detected.suggestedField,
      cell: detected.cell,
      type: detected.suggestedType,
      label: detected.label,
      isPreset: isPresetField(detected.suggestedField)
    }
    // Store the original detected field so we can restore on cancel
    setEditingFromDetected(detected)
    // Add to mappings
    const newMappings = [...mappings, mapping]
    onChange(newMappings)
    // Remove from detected - also remove any others with the same suggested field
    onDetectedFieldsChange(detectedFields.filter(d =>
      d.cell !== detected.cell && d.suggestedField !== detected.suggestedField
    ))
    // Set editing mode for the new mapping so user can change the field
    setEditingFieldIndex(newMappings.length - 1)
    // Ensure the mappings section is expanded
    setExpanded(true)
  }

  // Cancel editing - restore detected field if we were editing from detected, or remove new field
  const handleCancelEdit = () => {
    if (editingFieldIndex !== null) {
      if (editingFromDetected) {
        // Remove the mapping we added
        const newMappings = mappings.filter((_, i) => i !== editingFieldIndex)
        onChange(newMappings)
        // Restore the detected field
        onDetectedFieldsChange([...detectedFields, editingFromDetected])
      } else if (isAddingNewField) {
        // Remove the new mapping we added from cell click
        const newMappings = mappings.filter((_, i) => i !== editingFieldIndex)
        onChange(newMappings)
      }
    }
    setEditingFieldIndex(null)
    setEditingFromDetected(null)
    setIsAddingNewField(false)
    resetEditPresetModal()
  }

  // Accept editing - clear the detected origin and new field state
  const handleAcceptEdit = () => {
    setEditingFieldIndex(null)
    setEditingFromDetected(null)
    setIsAddingNewField(false)
    resetEditPresetModal()
  }

  // Reset edit preset modal state
  const resetEditPresetModal = () => {
    setShowEditPresetModal(false)
    setEditPresetSearch('')
    setEditPresetTab('metrics')
    setEditPresetExpandedCategories(new Set())
    setEditPresetSelectedMetric(null)
    setEditPresetSelectedPeriodType(null)
    setEditPresetView('main')
  }

  // Close the edit preset modal
  const closeEditPresetModal = () => {
    setShowEditPresetModal(false)
    setEditPresetSearch('')
    setEditPresetView('main')
    setEditPresetSelectedMetric(null)
    setEditPresetSelectedPeriodType(null)
  }

  // Toggle category expansion in edit modal
  const toggleEditPresetCategory = (name: string) => {
    setEditPresetExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Apply a preset selection from the edit modal
  const applyEditPreset = (field: string, label: string, type: FieldMapping['type']) => {
    if (editingFieldIndex !== null) {
      updateMapping(editingFieldIndex, { field, label, type, isPreset: true })
      closeEditPresetModal()
      // If not editing from a detected field, close the edit panel too
      if (!editingFromDetected) {
        setEditingFieldIndex(null)
      }
    }
  }

  // Handle metric selection in edit modal
  const handleEditMetricSelect = (metric: MetricDefinition) => {
    if (metric.supportsPeriods) {
      setEditPresetSelectedMetric(metric)
      setEditPresetSelectedPeriodType(null)
      setEditPresetView('periods')
    } else {
      // Add metric without period
      const mapping = generateFieldMapping(metric)
      applyEditPreset(mapping.field, mapping.label || '', mapping.type)
    }
  }

  // Handle year selection in edit modal
  const handleEditYearSelect = (year: number) => {
    if (!editPresetSelectedMetric || !editPresetSelectedPeriodType) return
    const period = buildTimePeriod(editPresetSelectedPeriodType, year)
    const mapping = generateFieldMapping(editPresetSelectedMetric, period)
    applyEditPreset(mapping.field, mapping.label || '', mapping.type)
  }

  // Toggle rejection state for a detected field (can be un-rejected by clicking again)
  const handleToggleRejection = (detected: DetectedField) => {
    setRejectedDetections(prev => {
      const next = new Set(prev)
      if (next.has(detected.cell)) {
        next.delete(detected.cell)
      } else {
        next.add(detected.cell)
        // Also remove from selected if rejecting
        setSelectedDetections(sel => {
          const newSel = new Set(sel)
          newSel.delete(detected.cell)
          return newSel
        })
      }
      return next
    })
  }

  // Computed values for edit modal period view
  const editAvailablePeriodTypes = useMemo(() => {
    if (!editPresetSelectedMetric?.periodsAllowed) return []
    return PERIOD_TYPES.filter(pt => editPresetSelectedMetric.periodsAllowed?.includes(pt.category))
  }, [editPresetSelectedMetric])

  const editAnnualTypes = useMemo(() =>
    editAvailablePeriodTypes.filter(pt => pt.category === 'annual'),
    [editAvailablePeriodTypes]
  )

  const editQuarterlyTypes = useMemo(() =>
    editAvailablePeriodTypes.filter(pt => pt.category === 'quarterly'),
    [editAvailablePeriodTypes]
  )

  const editAddedFieldsSet = useMemo(() =>
    new Set(mappings.filter((_, i) => i !== editingFieldIndex).map(m => m.field)),
    [mappings, editingFieldIndex]
  )

  const editDetectedFieldsSet = useMemo(() =>
    new Set(detectedFields.map(d => d.suggestedField)),
    [detectedFields]
  )

  // Helper to get period type status (mapped/detected counts)
  const getEditPeriodTypeStatus = useCallback((pt: { id: PeriodTypeOption }) => {
    let mappedCount = 0
    let detectedCount = 0
    if (!editPresetSelectedMetric) return { mappedCount, detectedCount }

    for (const year of AVAILABLE_YEARS) {
      const period = buildTimePeriod(pt.id, year)
      const m = generateFieldMapping(editPresetSelectedMetric, period)
      if (editAddedFieldsSet.has(m.field)) mappedCount++
      else if (editDetectedFieldsSet.has(m.field)) detectedCount++
    }
    return { mappedCount, detectedCount }
  }, [editPresetSelectedMetric, editAddedFieldsSet, editDetectedFieldsSet])

  // Filter out already-mapped cells/fields from detected fields, separate rejected ones
  const unmappedDetectedFields = detectedFields.filter(
    d => !mappings.some(m => m.cell === d.cell || m.field === d.suggestedField) && !rejectedDetections.has(d.cell)
  )
  const rejectedDetectedFields = detectedFields.filter(
    d => !mappings.some(m => m.cell === d.cell || m.field === d.suggestedField) && rejectedDetections.has(d.cell)
  )

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 hover:text-gray-700 transition-colors"
          >
            <Grid3X3 className="w-4 h-4 text-gray-500" />
            <span className="font-medium text-gray-900">Field Mappings</span>
            <span className="text-sm text-gray-500">({mappings.length + dynamicMappings.length})</span>
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
          </button>

          {/* Add New dropdown - moved to header */}
          {expanded && workbook && (
            <div className="relative">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAddNewDropdown(!showAddNewDropdown)}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add New
                <ChevronDown className="w-4 h-4 ml-1" />
              </Button>

              {showAddNewDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowAddNewDropdown(false)}
                  />
                  <div className="absolute left-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddNewDropdown(false)
                        setPendingNewFieldCell(null)
                        setShowPresetDropdown(true)
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <Target className="w-4 h-4 text-blue-500" />
                      Fixed Field
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddNewDropdown(false)
                        setNewDynamicMapping({
                          name: '',
                          field_pattern: '',
                          row_match: { label_column: 'A', label_contains: '' },
                          column_match: { header_row: 1, year_pattern: 'FY(\\d{4})' },
                          type: 'number'
                        })
                        setShowDynamicMappingModal(true)
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <Grid3X3 className="w-4 h-4 text-purple-500" />
                      Dynamic Mapping
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle - only show when expanded and workbook loaded */}
          {expanded && workbook && (
            <div className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('spreadsheet')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors',
                  viewMode === 'spreadsheet'
                    ? 'bg-primary-100 text-primary-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <Table className="w-4 h-4" />
                Spreadsheet
              </button>
              <button
                type="button"
                onClick={() => setViewMode('fields')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors',
                  viewMode === 'fields'
                    ? 'bg-primary-100 text-primary-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <Grid3X3 className="w-4 h-4" />
                Fields
                {(unmappedDetectedFields.length > 0 || dynamicMappings.length > 0 || mappings.length > 0) && (
                  <span className={clsx(
                    'text-xs px-1.5 py-0.5 rounded-full',
                    viewMode === 'fields' ? 'bg-primary-200 text-primary-800' : 'bg-gray-200 text-gray-600'
                  )}>
                    {unmappedDetectedFields.length + mappings.length + dynamicMappings.length}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* File info */}
          {workbook && fileName && (
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
              <span className="font-medium text-green-800">{fileName}</span>
              <span className="text-xs text-green-600">
                ({workbook.SheetNames.length} sheet{workbook.SheetNames.length !== 1 ? 's' : ''})
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onLoadFile}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-all border-2',
              isDragging
                ? 'bg-primary-100 text-primary-700 border-primary-400 ring-2 ring-primary-300 scale-105'
                : workbook
                ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200 hover:border-green-300'
                : 'bg-primary-50 text-primary-700 border-primary-200 hover:bg-primary-100 hover:border-primary-300'
            )}
          >
            <Upload className={clsx('w-4 h-4', isDragging && 'animate-bounce')} />
            {isDragging ? 'Drop file here' : workbook ? 'Change File' : 'Load Spreadsheet'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Spreadsheet View: Spreadsheet viewer for cell selection */}
          {viewMode === 'spreadsheet' && workbook && (
            <SpreadsheetViewer
              workbook={workbook}
              onCellSelect={handleCellSelect}
              onCreateMappingFromCell={(cellRef, value) => {
                // If we're already adding a new field, remove the previous incomplete mapping first
                let currentMappings = mappings
                if (isAddingNewField && editingFieldIndex !== null) {
                  currentMappings = mappings.filter((_, i) => i !== editingFieldIndex)
                }

                // Create a new custom mapping for the clicked cell
                const newMapping: FieldMapping = {
                  field: '',
                  cell: cellRef,
                  type: 'text',
                  label: value ? `Cell ${cellRef}` : '',
                  isPreset: false
                }
                onChange([...currentMappings, newMapping])
                setEditingFieldIndex(currentMappings.length)
                setIsAddingNewField(true)
                setEditingFromDetected(null)
              }}
              selectingForIndex={selectingForIndex}
              isSelectingForNewField={selectingForNewField}
              isSelectingDynamicRow={selectingDynamicRow}
              isSelectingDynamicColumn={selectingDynamicColumn}
              onCancelSelection={() => {
                setSelectingForNewField(false)
                setSelectingDynamicRow(false)
                setSelectingDynamicColumn(false)
              }}
              detectedFields={unmappedDetectedFields}
              acceptedMappings={completeMappings}
              editingCell={editingFieldIndex !== null && mappings[editingFieldIndex] ? mappings[editingFieldIndex].cell : null}
              onConfirmField={handleAddSingleDetection}
              onEditField={handleEditDetection}
              onRejectField={handleToggleRejection}
              detectedDynamicMappings={detectedDynamicMappings.filter(d => {
                // Filter out detected mappings that have the same name or pattern as existing accepted ones
                const existingNames = new Set(dynamicMappings.map(dm => dm.name.toLowerCase()))
                const existingPatterns = new Set(dynamicMappings.map(dm => dm.field_pattern.toLowerCase()))
                return !existingNames.has(d.name.toLowerCase()) && !existingPatterns.has(d.field_pattern.toLowerCase())
              })}
              acceptedDynamicIds={acceptedDynamicIds}
              onAcceptDynamic={onAcceptDynamic}
              onRejectDynamic={onRejectDynamic}
              acceptedDynamicMappings={dynamicMappings}
              onRemoveDynamicMapping={(id) => {
                onDynamicMappingsChange(dynamicMappings.filter(m => m.id !== id))
              }}
              focusCell={focusCell}
              onFocusCellHandled={() => {}}
              onClearFocus={() => setFocusCell(null)}
            />
          )}

          {/* Inline edit panel - appears when editing a field */}
          {editingFieldIndex !== null && mappings[editingFieldIndex] && (
            <div className="border-2 border-blue-400 rounded-lg overflow-hidden bg-blue-50 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {isAddingNewField ? (
                    <Plus className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Edit2 className="w-4 h-4 text-blue-600" />
                  )}
                  <span className="font-medium text-gray-900">
                    {isAddingNewField ? 'Add New Field' : 'Edit Field Mapping'}
                  </span>
                  {mappings[editingFieldIndex].cell ? (
                    <span className="text-sm text-gray-500">
                      Cell: <code className="px-1.5 py-0.5 bg-blue-200 text-blue-800 rounded">{mappings[editingFieldIndex].cell}</code>
                    </span>
                  ) : (
                    <span className="text-sm text-amber-600 font-medium animate-pulse">
                      ← Click on a cell in the spreadsheet to select it
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 items-end">
                {/* Field Selection - shows input for custom fields or preset selector */}
                <div className="col-span-2">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs font-medium text-gray-600">
                      {mappings[editingFieldIndex].isPreset ? 'Tesseract Field' : 'Custom Field ID'}
                    </label>
                    {mappings[editingFieldIndex].isPreset ? (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                        <Lock className="w-2.5 h-2.5" />
                        Preset
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowEditPresetModal(true)}
                        className="text-[10px] text-primary-600 hover:text-primary-700 hover:underline"
                      >
                        Use preset instead
                      </button>
                    )}
                  </div>
                  {mappings[editingFieldIndex].isPreset ? (
                    <button
                      type="button"
                      onClick={() => setShowEditPresetModal(true)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:border-blue-400 hover:bg-blue-50 text-left flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={mappings[editingFieldIndex].label || mappings[editingFieldIndex].field ? 'text-gray-900 truncate' : 'text-gray-400'}>
                          {mappings[editingFieldIndex].label || mappings[editingFieldIndex].field || 'Select field...'}
                        </span>
                        {mappings[editingFieldIndex].field && (
                          <code className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded flex-shrink-0">
                            {mappings[editingFieldIndex].field}
                          </code>
                        )}
                      </div>
                      <Edit2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    </button>
                  ) : (
                    <input
                      type="text"
                      value={mappings[editingFieldIndex].field}
                      onChange={(e) => updateMapping(editingFieldIndex, { field: e.target.value })}
                      placeholder="e.g., custom_metric_fy2027"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                    />
                  )}
                </div>

                {/* Type */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select
                    value={mappings[editingFieldIndex].type}
                    onChange={(e) => updateMapping(editingFieldIndex, { type: e.target.value as FieldMapping['type'] })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="currency">Currency</option>
                    <option value="percent">Percent</option>
                    <option value="multiple">Multiple (x)</option>
                    <option value="date">Date</option>
                  </select>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-blue-200">
                {!editingFromDetected && (
                  <button
                    type="button"
                    onClick={() => {
                      removeMapping(editingFieldIndex)
                      setEditingFieldIndex(null)
                      setEditingFromDetected(null)
                    }}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-100 rounded-lg font-medium"
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-4 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAcceptEdit}
                  className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                >
                  Accept
                </button>
              </div>
            </div>
          )}

          {/* Edit Preset Modal - matches main PresetDropdown */}
          {showEditPresetModal && editingFieldIndex !== null && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={closeEditPresetModal}
              />
              <div className="relative z-10 w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-base font-semibold text-gray-900">Select Field Preset</h3>
                  <button
                    type="button"
                    onClick={closeEditPresetModal}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {editPresetView === 'main' ? (
                  <>
                    {/* Current Selection */}
                    {editingFieldIndex !== null && mappings[editingFieldIndex]?.field && (
                      <div className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                        <div className="text-xs text-blue-600 font-medium mb-1">Current Selection</div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-blue-900">
                            {mappings[editingFieldIndex].label || mappings[editingFieldIndex].field}
                          </span>
                          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                            {mappings[editingFieldIndex].type}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Tabs */}
                    <div className="flex border-b border-gray-200">
                      <button
                        type="button"
                        onClick={() => setEditPresetTab('metrics')}
                        className={clsx(
                          'flex-1 px-4 py-2 text-sm font-medium',
                          editPresetTab === 'metrics'
                            ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        )}
                      >
                        <Calendar className="w-4 h-4 inline mr-1.5" />
                        Metrics + Period
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPresetTab('static')}
                        className={clsx(
                          'flex-1 px-4 py-2 text-sm font-medium',
                          editPresetTab === 'static'
                            ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        )}
                      >
                        <Settings className="w-4 h-4 inline mr-1.5" />
                        Settings & Other
                      </button>
                    </div>

                    {/* Search */}
                    <div className="p-2 border-b border-gray-100">
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          value={editPresetSearch}
                          onChange={(e) => setEditPresetSearch(e.target.value)}
                          placeholder="Search metrics..."
                          className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="max-h-96 overflow-y-auto">
                      {/* Custom Field Option */}
                      <button
                        type="button"
                        onClick={() => {
                          if (editingFieldIndex !== null) {
                            updateMapping(editingFieldIndex, { isPreset: false })
                            closeEditPresetModal()
                          }
                        }}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left border-b border-gray-100 hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-2">
                          <Edit2 className="w-4 h-4 text-gray-500" />
                          <span className="font-medium text-gray-700">Custom Field</span>
                        </div>
                        <span className="text-xs text-gray-500">Enter your own field ID</span>
                      </button>

                      {editPresetTab === 'metrics' ? (
                        // Metrics tab
                        (() => {
                          const addedFields = new Set(mappings.filter((_, i) => i !== editingFieldIndex).map(m => m.field))
                          const detectedFieldIds = new Set(detectedFields.map(d => d.suggestedField))
                          const filteredCategories = METRIC_CATEGORIES.map(category => {
                            if (!editPresetSearch) return category
                            const filteredMetrics = category.metrics.filter(m =>
                              m.label.toLowerCase().includes(editPresetSearch.toLowerCase()) ||
                              m.id.toLowerCase().includes(editPresetSearch.toLowerCase())
                            )
                            return { ...category, metrics: filteredMetrics }
                          }).filter(category => category.metrics.length > 0)

                          return filteredCategories.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-4">No metrics found. Try a different search term.</p>
                          ) : (
                            <>
                              {!editPresetSearch && (
                                <p className="text-xs text-gray-500 px-3 py-2 bg-gray-50 border-b border-gray-100">
                                  Click a category to expand
                                </p>
                              )}
                              {filteredCategories.map((category) => {
                                const isExpanded = editPresetExpandedCategories.has(category.name) || editPresetSearch.length > 0
                                return (
                                  <div key={category.name}>
                                    <button
                                      type="button"
                                      onClick={() => toggleEditPresetCategory(category.name)}
                                      className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 sticky top-0 border-b border-gray-100"
                                    >
                                      <div className="flex items-center gap-2">
                                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        {category.name}
                                      </div>
                                      <span className="text-xs text-gray-500">{category.metrics.length}</span>
                                    </button>
                                    {isExpanded && (
                                      <div className="py-1">
                                        {category.metrics.map(metric => (
                                          <button
                                            key={metric.id}
                                            type="button"
                                            onClick={() => handleEditMetricSelect(metric)}
                                            className="w-full flex items-center justify-between px-6 py-1.5 text-sm text-left text-gray-700 hover:bg-primary-50"
                                          >
                                            <span>{metric.label}</span>
                                            <ChevronRight className="w-4 h-4 text-gray-400" />
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </>
                          )
                        })()
                      ) : (
                        // Static presets tab
                        (() => {
                          const addedFields = new Set(mappings.filter((_, i) => i !== editingFieldIndex).map(m => m.field))
                          const detectedFieldIds = new Set(detectedFields.map(d => d.suggestedField))
                          const filteredCategories = STATIC_PRESET_CATEGORIES.map(category => {
                            if (!editPresetSearch) return category
                            const filteredPresets = Object.entries(category.presets).filter(([key, preset]) =>
                              (preset as FieldMapping).label?.toLowerCase().includes(editPresetSearch.toLowerCase()) ||
                              key.toLowerCase().includes(editPresetSearch.toLowerCase())
                            )
                            return { ...category, presets: Object.fromEntries(filteredPresets) }
                          }).filter(category => Object.keys(category.presets).length > 0)

                          return filteredCategories.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-4">No presets found. Try a different search term.</p>
                          ) : (
                            <>
                              {!editPresetSearch && (
                                <p className="text-xs text-gray-500 px-3 py-2 bg-gray-50 border-b border-gray-100">
                                  Click a category to expand
                                </p>
                              )}
                              {filteredCategories.map((category) => {
                                const isExpanded = editPresetExpandedCategories.has(category.name) || editPresetSearch.length > 0
                                const presetEntries = Object.entries(category.presets)
                                const addedCount = presetEntries.filter(([_, p]) => addedFields.has((p as FieldMapping).field)).length

                                return (
                                  <div key={category.name}>
                                    <button
                                      type="button"
                                      onClick={() => toggleEditPresetCategory(category.name)}
                                      className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 sticky top-0 border-b border-gray-100"
                                    >
                                      <div className="flex items-center gap-2">
                                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        {category.name}
                                      </div>
                                      <span className="text-xs text-gray-500">
                                        {addedCount > 0 && `${addedCount}/`}{presetEntries.length}
                                      </span>
                                    </button>
                                    {isExpanded && (
                                      <div className="py-1">
                                        {presetEntries.map(([key, preset]) => {
                                          const p = preset as FieldMapping
                                          const isAdded = addedFields.has(p.field)
                                          const isDetected = detectedFieldIds.has(p.field)
                                          const isUnavailable = isAdded || isDetected
                                          return (
                                            <button
                                              key={key}
                                              type="button"
                                              onClick={() => !isUnavailable && applyEditPreset(p.field, p.label || '', p.type)}
                                              disabled={isUnavailable}
                                              className={clsx(
                                                'w-full flex items-center justify-between px-6 py-1.5 text-sm text-left',
                                                isUnavailable ? 'text-gray-400 cursor-not-allowed bg-gray-50' : 'text-gray-700 hover:bg-primary-50'
                                              )}
                                            >
                                              <span>{p.label}</span>
                                              {isAdded ? (
                                                <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                                                  <Check className="w-3 h-3" />
                                                  Mapped
                                                </span>
                                              ) : isDetected ? (
                                                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                                  <Sparkles className="w-3 h-3" />
                                                  Auto-detected
                                                </span>
                                              ) : null}
                                            </button>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </>
                          )
                        })()
                      )}
                    </div>
                  </>
                ) : (
                  // Period selection view - matches main PresetDropdown
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
                      <button
                        type="button"
                        onClick={() => {
                          if (editPresetSelectedPeriodType) {
                            setEditPresetSelectedPeriodType(null)
                          } else {
                            setEditPresetView('main')
                            setEditPresetSelectedMetric(null)
                          }
                        }}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900">
                          {editPresetSelectedMetric?.label}
                        </span>
                        {editPresetSelectedPeriodType && (
                          <span className="text-sm text-gray-500 ml-2">
                            → {editPresetSelectedPeriodType}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 space-y-4 max-h-96 overflow-y-auto">
                      {!editPresetSelectedPeriodType ? (
                        // Step 1: Select period type
                        <>
                          <p className="text-xs font-medium text-gray-500">Select period type</p>

                          {/* Show already detected/mapped fields for this metric */}
                          {editPresetSelectedMetric && (() => {
                            // Find all detected/mapped fields for this metric
                            const metricPrefix = `${editPresetSelectedMetric.id}_`
                            const detectedForMetric = Array.from(editDetectedFieldsSet).filter(f => f.startsWith(metricPrefix))
                            const mappedForMetric = Array.from(editAddedFieldsSet).filter(f => f.startsWith(metricPrefix))

                            if (detectedForMetric.length === 0 && mappedForMetric.length === 0) return null

                            // Parse field ID to friendly label (e.g., eps_fy2027 -> FY 2027)
                            const parseFieldLabel = (fieldId: string) => {
                              const suffix = fieldId.replace(metricPrefix, '')
                              if (suffix.startsWith('fy')) return `FY ${suffix.slice(2)}`
                              if (suffix.startsWith('cy')) return `CY ${suffix.slice(2)}`
                              if (suffix.startsWith('q')) {
                                const match = suffix.match(/q(\d)_(\d+)/)
                                if (match) return `Q${match[1]} ${match[2]}`
                              }
                              return suffix
                            }

                            return (
                              <div className="mb-3 p-2 bg-gray-50 rounded-lg border border-gray-200">
                                <p className="text-xs font-medium text-gray-600 mb-1.5">Already in use for {editPresetSelectedMetric.label}:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {mappedForMetric.map(f => (
                                    <span key={f} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                                      <Check className="w-3 h-3" />
                                      {parseFieldLabel(f)}
                                    </span>
                                  ))}
                                  {detectedForMetric.map(f => (
                                    <span key={f} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                      <Sparkles className="w-3 h-3" />
                                      {parseFieldLabel(f)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )
                          })()}

                          {/* Current (no period) option */}
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                if (editPresetSelectedMetric) {
                                  const m = generateFieldMapping(editPresetSelectedMetric)
                                  applyEditPreset(m.field, m.label || '', m.type)
                                }
                              }}
                              className="w-full px-4 py-3 text-sm font-medium rounded-lg border border-primary-200 bg-primary-50 text-primary-700 hover:border-primary-400 hover:bg-primary-100 transition-colors text-left"
                            >
                              Current
                              <span className="block text-xs font-normal text-primary-500 mt-0.5">
                                No specific time period
                              </span>
                            </button>
                          </div>

                          {/* Annual types */}
                          {editAnnualTypes.length > 0 && (
                            <div>
                              <p className="text-xs text-gray-400 mb-2">Annual</p>
                              <div className="flex gap-2">
                                {editAnnualTypes.map(pt => (
                                  <button
                                    key={pt.id}
                                    type="button"
                                    onClick={() => setEditPresetSelectedPeriodType(pt.id)}
                                    className="flex-1 px-4 py-3 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-primary-400 hover:bg-primary-50 transition-colors text-left"
                                  >
                                    <span>{pt.id}</span>
                                    <span className="block text-xs font-normal text-gray-400 mt-0.5">
                                      {pt.label}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Quarterly types */}
                          {editQuarterlyTypes.length > 0 && (
                            <div>
                              <p className="text-xs text-gray-400 mb-2">Quarterly</p>
                              <div className="grid grid-cols-4 gap-2">
                                {editQuarterlyTypes.map(pt => (
                                  <button
                                    key={pt.id}
                                    type="button"
                                    onClick={() => setEditPresetSelectedPeriodType(pt.id)}
                                    className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-primary-400 hover:bg-primary-50 transition-colors"
                                  >
                                    {pt.id}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        // Step 2: Select year
                        <>
                          <p className="text-xs font-medium text-gray-500">
                            Select year for {editPresetSelectedMetric?.label} {editPresetSelectedPeriodType}
                          </p>
                          <div className="grid grid-cols-4 gap-2">
                            {AVAILABLE_YEARS.map(year => {
                              const period = buildTimePeriod(editPresetSelectedPeriodType, year)
                              const m = editPresetSelectedMetric ? generateFieldMapping(editPresetSelectedMetric, period) : null
                              const fieldId = m?.field || ''
                              const isAdded = editAddedFieldsSet.has(fieldId)
                              const isDetected = editDetectedFieldsSet.has(fieldId)
                              const isUnavailable = isAdded || isDetected
                              return (
                                <button
                                  key={year}
                                  type="button"
                                  onClick={() => !isUnavailable && handleEditYearSelect(year)}
                                  disabled={isUnavailable}
                                  className={clsx(
                                    'px-3 py-2 text-sm rounded-lg border transition-colors flex flex-col items-center',
                                    isAdded
                                      ? 'bg-green-50 border-green-200 text-green-700'
                                      : isDetected
                                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                                      : 'bg-white border-gray-200 text-gray-700 hover:border-primary-400 hover:bg-primary-50'
                                  )}
                                >
                                  <span>{year}</span>
                                  {isAdded && (
                                    <span className="text-[9px] mt-0.5 flex items-center gap-0.5">
                                      <Check className="w-2.5 h-2.5" /> Mapped
                                    </span>
                                  )}
                                  {isDetected && !isAdded && (
                                    <span className="text-[9px] mt-0.5 flex items-center gap-0.5">
                                      <Sparkles className="w-2.5 h-2.5" /> Detected
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Done button - matches main PresetDropdown */}
                    <div className="px-3 py-2 border-t border-gray-200 bg-gray-50">
                      <button
                        type="button"
                        onClick={closeEditPresetModal}
                        className="w-full px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                      >
                        Done
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body
          )}

          {/* Dynamic Mapping Modal */}
          {showDynamicMappingModal && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              {/* Backdrop */}
              <div
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={() => setShowDynamicMappingModal(false)}
              />
              {/* Modal */}
              <div className="relative z-10 w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-purple-200 bg-purple-50">
                  <div className="flex items-center gap-2">
                    <Grid3X3 className="w-5 h-5 text-purple-600" />
                    <h3 className="text-base font-semibold text-gray-900">Add Dynamic Mapping</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDynamicMappingModal(false)}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-purple-100 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Step Indicators */}
                <div className="flex items-center justify-center gap-2 px-4 py-2 border-b border-purple-100 bg-purple-50/50">
                  <div className={clsx(
                    "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                    dynamicMappingStep === 'row' ? "bg-purple-600 text-white" : pendingDynamicRowCell ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                  )}>
                    {pendingDynamicRowCell ? <Check className="w-3 h-3" /> : <span>1</span>}
                    <span>Row</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                  <div className={clsx(
                    "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                    dynamicMappingStep === 'column' ? "bg-purple-600 text-white" : pendingDynamicColumnCell ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                  )}>
                    {pendingDynamicColumnCell ? <Check className="w-3 h-3" /> : <span>2</span>}
                    <span>Column</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                  <div className={clsx(
                    "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                    dynamicMappingStep === 'configure' ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-500"
                  )}>
                    <span>3</span>
                    <span>Configure</span>
                  </div>
                </div>

                {/* Modal Content */}
                <div className="p-4 space-y-4">
                  {/* Step 1: Row Selection */}
                  {dynamicMappingStep === 'row' && (
                    <div className="space-y-3">
                      <div className="text-center py-4">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-100 mb-3">
                          <MousePointer2 className="w-6 h-6 text-purple-600" />
                        </div>
                        <h4 className="text-sm font-medium text-gray-900">Select a Row Label Cell</h4>
                        <p className="text-xs text-gray-500 mt-1">Click on a cell that contains a metric label (e.g., "EPS", "Revenue")</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowDynamicMappingModal(false)
                          setSelectingDynamicRow(true)
                        }}
                        className="w-full py-3 px-4 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg font-medium text-sm transition-colors"
                      >
                        Click in Spreadsheet to Select Row
                      </button>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-gray-200"></div>
                        </div>
                        <div className="relative flex justify-center">
                          <span className="px-2 bg-white text-xs text-gray-500">or enter manually</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">Label Column</label>
                          <input
                            type="text"
                            value={newDynamicMapping.row_match?.label_column || 'A'}
                            onChange={(e) => setNewDynamicMapping({
                              ...newDynamicMapping,
                              row_match: { ...newDynamicMapping.row_match!, label_column: e.target.value.toUpperCase() }
                            })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
                            maxLength={2}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[10px] text-gray-500 mb-0.5">Label Contains</label>
                          <input
                            type="text"
                            value={newDynamicMapping.row_match?.label_contains || ''}
                            onChange={(e) => setNewDynamicMapping({
                              ...newDynamicMapping,
                              row_match: { ...newDynamicMapping.row_match!, label_contains: e.target.value }
                            })}
                            placeholder="e.g., EPS, Revenue"
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Column Selection */}
                  {dynamicMappingStep === 'column' && (
                    <div className="space-y-3">
                      <div className="text-center py-4">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-100 mb-3">
                          <Grid3X3 className="w-6 h-6 text-purple-600" />
                        </div>
                        <h4 className="text-sm font-medium text-gray-900">Select a Column Header Cell</h4>
                        <p className="text-xs text-gray-500 mt-1">Click on a cell in the header row (e.g., "2024", "FY25")</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowDynamicMappingModal(false)
                          setSelectingDynamicColumn(true)
                        }}
                        className="w-full py-3 px-4 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg font-medium text-sm transition-colors"
                      >
                        Click in Spreadsheet to Select Column
                      </button>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-gray-200"></div>
                        </div>
                        <div className="relative flex justify-center">
                          <span className="px-2 bg-white text-xs text-gray-500">or enter manually</span>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">Header Row</label>
                          <input
                            type="number"
                            value={newDynamicMapping.column_match?.header_row || 1}
                            onChange={(e) => setNewDynamicMapping({
                              ...newDynamicMapping,
                              column_match: { ...newDynamicMapping.column_match!, header_row: parseInt(e.target.value) || 1 }
                            })}
                            min={1}
                            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-1">Column Pattern</label>
                          <PatternSelector
                            value={newDynamicMapping.column_match?.year_pattern || ''}
                            onChange={(value) => setNewDynamicMapping({
                              ...newDynamicMapping,
                              column_match: { ...newDynamicMapping.column_match!, year_pattern: value, quarter_pattern: undefined }
                            })}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Configure */}
                  {dynamicMappingStep === 'configure' && (
                    <div className="space-y-3">
                      {/* Summary of selections */}
                      <div className="grid grid-cols-2 gap-2 p-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500">Row:</span>
                          <code className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                            {newDynamicMapping.row_match?.label_column}:{newDynamicMapping.row_match?.label_contains || '?'}
                          </code>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500">Header Row:</span>
                          <code className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                            {newDynamicMapping.column_match?.header_row}
                          </code>
                        </div>
                      </div>

                      {/* Name and Field Pattern */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                          <input
                            type="text"
                            value={newDynamicMapping.name || ''}
                            onChange={(e) => setNewDynamicMapping({ ...newDynamicMapping, name: e.target.value })}
                            placeholder="e.g., EPS by Year"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Field Pattern</label>
                          <input
                            type="text"
                            value={newDynamicMapping.field_pattern || ''}
                            onChange={(e) => setNewDynamicMapping({ ...newDynamicMapping, field_pattern: e.target.value })}
                            placeholder="e.g., eps_fy{year}"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
                          />
                          <p className="text-[10px] text-gray-500 mt-0.5">Use {'{year}'} and {'{quarter}'} as placeholders</p>
                        </div>
                      </div>

                      {/* Type */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Value Type</label>
                        <select
                          value={newDynamicMapping.type || 'number'}
                          onChange={(e) => setNewDynamicMapping({ ...newDynamicMapping, type: e.target.value as FieldMapping['type'] })}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="number">Number</option>
                          <option value="currency">Currency</option>
                          <option value="percent">Percent</option>
                          <option value="multiple">Multiple (x)</option>
                          <option value="text">Text</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
                  <div>
                    {dynamicMappingStep !== 'row' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (dynamicMappingStep === 'column') {
                            setDynamicMappingStep('row')
                          } else if (dynamicMappingStep === 'configure') {
                            setDynamicMappingStep('column')
                          }
                        }}
                      >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        Back
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowDynamicMappingModal(false)
                        setDynamicMappingStep('row')
                        setPendingDynamicRowCell(null)
                        setPendingDynamicColumnCell(null)
                      }}
                    >
                      Cancel
                    </Button>
                    {dynamicMappingStep === 'row' && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setDynamicMappingStep('column')}
                        disabled={!newDynamicMapping.row_match?.label_contains}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                    {dynamicMappingStep === 'column' && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setDynamicMappingStep('configure')}
                        disabled={!newDynamicMapping.column_match?.year_pattern}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                    {dynamicMappingStep === 'configure' && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          const mapping: DynamicFieldMapping = {
                            id: `dm_${Date.now()}`,
                            name: newDynamicMapping.name || 'New Dynamic Mapping',
                            field_pattern: newDynamicMapping.field_pattern || '',
                            row_match: {
                              label_column: newDynamicMapping.row_match?.label_column || 'A',
                              label_contains: newDynamicMapping.row_match?.label_contains,
                              label_equals: newDynamicMapping.row_match?.label_equals,
                              sheet: newDynamicMapping.row_match?.sheet
                            },
                            column_match: {
                              header_row: newDynamicMapping.column_match?.header_row || 1,
                              year_pattern: newDynamicMapping.column_match?.year_pattern,
                              quarter_pattern: newDynamicMapping.column_match?.quarter_pattern,
                              start_column: newDynamicMapping.column_match?.start_column,
                              end_column: newDynamicMapping.column_match?.end_column
                            },
                            type: newDynamicMapping.type || 'number'
                          }
                          onDynamicMappingsChange([...dynamicMappings, mapping])
                          setShowDynamicMappingModal(false)
                          setDynamicMappingStep('row')
                          setPendingDynamicRowCell(null)
                          setPendingDynamicColumnCell(null)
                          setNewDynamicMapping({
                            name: '',
                            field_pattern: '',
                            row_match: { label_column: 'A', label_contains: '' },
                            column_match: { header_row: 1, year_pattern: 'FY(\\d{4})' },
                            type: 'number'
                          })
                        }}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        Add Mapping
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* Fields View: Accepted Mappings first, then Auto-detected, then Dynamic Detection */}
          {viewMode === 'fields' && (
            <>
              {/* Unified Accepted Mappings - shows both fixed and dynamic in one section */}
              <AcceptedMappingsSection
                fixedMappings={mappings}
                fixedPreview={preview}
                dynamicMappings={dynamicMappings}
                workbook={workbook}
                onEditFixed={(index) => {
                  setEditingFieldIndex(index)
                  setEditingFromDetected(null)
                  setIsAddingNewField(false)
                  // Switch to spreadsheet view to show inline edit
                  setViewMode('spreadsheet')
                }}
                onRemoveFixed={removeMapping}
                onEditDynamic={(id) => {
                  // Find the dynamic mapping and open edit modal
                  const mapping = dynamicMappings.find(m => m.id === id)
                  if (mapping) {
                    setNewDynamicMapping(mapping)
                    setShowDynamicMappingModal(true)
                  }
                }}
                onRemoveDynamic={(id) => {
                  onDynamicMappingsChange(dynamicMappings.filter(m => m.id !== id))
                }}
                onNavigateToCell={(data) => {
                  setFocusCell(data)
                  setViewMode('spreadsheet')
                }}
              />

              {/* Auto-detected fields section - compact single line format */}
              {(unmappedDetectedFields.length > 0 || rejectedDetectedFields.length > 0) && (
                <div className="border border-amber-200 rounded-lg overflow-hidden bg-amber-50/50">
                  <button
                    type="button"
                    onClick={() => setShowDetected(!showDetected)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-amber-100/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      <span className="text-sm font-medium text-gray-900">Fixed Mappings Auto-Detected</span>
                      <span className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">
                        {unmappedDetectedFields.length}
                      </span>
                      {rejectedDetectedFields.length > 0 && (
                        <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                          {rejectedDetectedFields.length} hidden
                        </span>
                      )}
                    </div>
                    {showDetected ? (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                  </button>

                  {showDetected && (
                    <div className="px-3 pb-3 space-y-1">
                      {/* Select all + Add selected */}
                      <div className="flex items-center justify-between py-1">
                        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                          <input
                            type="checkbox"
                            checked={selectedDetections.size === unmappedDetectedFields.length && unmappedDetectedFields.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDetections(new Set(unmappedDetectedFields.map(f => f.cell)))
                              } else {
                                setSelectedDetections(new Set())
                              }
                            }}
                            className="h-3.5 w-3.5 text-primary-600 rounded border-gray-300"
                          />
                          <span>Select all</span>
                        </label>
                        {selectedDetections.size > 0 && (
                          <Button
                            type="button"
                            onClick={handleAddSelectedMappings}
                            size="sm"
                            variant="default"
                            className="h-6 text-xs px-2"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add {selectedDetections.size}
                          </Button>
                        )}
                      </div>

                      {/* Active detected fields - compact single line */}
                      {unmappedDetectedFields.map((field, idx) => {
                        const isSelected = selectedDetections.has(field.cell)
                        return (
                          <div
                            key={idx}
                            className={clsx(
                              'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
                              isSelected
                                ? 'bg-primary-100 border border-primary-300'
                                : 'bg-white border border-gray-200 hover:border-gray-300'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleDetection(field.cell)}
                              className="h-3.5 w-3.5 text-primary-600 rounded border-gray-300 flex-shrink-0"
                            />
                            <span className="text-xs text-gray-500 flex-shrink-0">{field.cell}</span>
                            <span className="font-medium text-gray-900 truncate">{field.label}</span>
                            <span className="text-gray-400 flex-shrink-0">→</span>
                            <code className="text-xs px-1 py-0.5 bg-gray-100 text-gray-600 rounded truncate max-w-[140px] flex-shrink-0">
                              {field.suggestedField}
                            </code>
                            <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
                              <button
                                type="button"
                                onClick={() => handleAddSingleDetection(field)}
                                className="p-0.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                                title="Accept"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleRejection(field)}
                                className="p-0.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Reject"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )
                      })}

                      {/* Rejected/hidden fields - can be un-rejected */}
                      {rejectedDetectedFields.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-amber-200">
                          <p className="text-xs text-gray-500 mb-1">Hidden fields (click to restore):</p>
                          <div className="flex flex-wrap gap-1">
                            {rejectedDetectedFields.map((field, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleToggleRejection(field)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded hover:bg-gray-200 hover:text-gray-700 transition-colors"
                                title="Click to restore"
                              >
                                <X className="w-3 h-3" />
                                {field.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Dynamic Mappings Detection Section - only shows pending auto-detected mappings */}
              <DynamicMappingsSection
                detectedMappings={detectedDynamicMappings}
                acceptedIds={acceptedDynamicIds}
                rejectedIds={rejectedDynamicIds}
                onAccept={onAcceptDynamic}
                onReject={onRejectDynamic}
              />
            </>
          )}

          {/* Presets dropdown - Metric + Period selection (available in both views) */}
          <PresetDropdown
            mappings={mappings}
            onAddMapping={addPresetMapping}
            onAddCustomField={() => {
              if (!pendingNewFieldCell) return
              const newMapping: FieldMapping = { field: '', cell: pendingNewFieldCell, type: 'text', label: '', isPreset: false }
              onChange([...mappings, newMapping])
              setEditingFieldIndex(mappings.length)
              setPendingNewFieldCell(null)
            }}
            showDropdown={showPresetDropdown}
            setShowDropdown={(show) => {
              setShowPresetDropdown(show)
              if (!show) {
                setPendingNewFieldCell(null)
              }
            }}
            detectedFields={detectedFields}
            pendingCell={pendingNewFieldCell}
            onSetPendingCell={setPendingNewFieldCell}
            onStartCellSelection={() => {
              setShowPresetDropdown(false)
              setSelectingForNewField(true)
            }}
          />

          {mappings.length === 0 && unmappedDetectedFields.length === 0 && rejectedDetectedFields.length === 0 && dynamicMappings.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No field mappings yet. Click "Add New" to get started.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// SNAPSHOT RANGE EDITOR
// ============================================================================

function SnapshotRangeEditor({ ranges, onChange, workbook }: SnapshotRangeEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectingForIndex, setSelectingForIndex] = useState<number | null>(null)
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null)
  const [activeSheet, setActiveSheet] = useState(workbook?.SheetNames[0] || '')
  const [selectionStart, setSelectionStart] = useState<{ row: number; col: number } | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<{ row: number; col: number } | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)

  // Update active sheet when workbook changes
  useEffect(() => {
    if (workbook && !workbook.SheetNames.includes(activeSheet)) {
      setActiveSheet(workbook.SheetNames[0])
    }
  }, [workbook, activeSheet])

  const addRange = () => {
    onChange([...ranges, { name: '', range: '' }])
  }

  const updateRange = (index: number, updates: Partial<SnapshotRange>) => {
    const newRanges = [...ranges]
    newRanges[index] = { ...newRanges[index], ...updates }
    onChange(newRanges)
  }

  const removeRange = (index: number) => {
    onChange(ranges.filter((_, i) => i !== index))
  }

  const getColumnLabel = (col: number) => {
    let label = ''
    let c = col
    while (c >= 0) {
      label = String.fromCharCode(65 + (c % 26)) + label
      c = Math.floor(c / 26) - 1
    }
    return label
  }

  const handleCellMouseDown = (row: number, col: number) => {
    setSelectionStart({ row, col })
    setSelectionEnd({ row, col })
    setIsSelecting(true)
  }

  const handleCellMouseEnter = (row: number, col: number) => {
    if (isSelecting) {
      setSelectionEnd({ row, col })
    }
  }

  const handleConfirmSelection = () => {
    if (selectionStart && selectionEnd && selectingForIndex !== null) {
      const startRow = Math.min(selectionStart.row, selectionEnd.row) + 1
      const endRow = Math.max(selectionStart.row, selectionEnd.row) + 1
      const startCol = getColumnLabel(Math.min(selectionStart.col, selectionEnd.col))
      const endCol = getColumnLabel(Math.max(selectionStart.col, selectionEnd.col))

      const rangeStr = workbook && workbook.SheetNames.length > 1
        ? `${activeSheet}!${startCol}${startRow}:${endCol}${endRow}`
        : `${startCol}${startRow}:${endCol}${endRow}`

      updateRange(selectingForIndex, { range: rangeStr })
      closeModal()
    }
  }

  const handleMouseUp = () => {
    setIsSelecting(false)
  }

  const closeModal = () => {
    setSelectingForIndex(null)
    setSelectionStart(null)
    setSelectionEnd(null)
    setIsSelecting(false)
  }

  const isCellInSelection = (row: number, col: number) => {
    if (!selectionStart || !selectionEnd) return false
    const minRow = Math.min(selectionStart.row, selectionEnd.row)
    const maxRow = Math.max(selectionStart.row, selectionEnd.row)
    const minCol = Math.min(selectionStart.col, selectionEnd.col)
    const maxCol = Math.max(selectionStart.col, selectionEnd.col)
    return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol
  }

  // Get which edges of the selection a cell is on (for border styling)
  const getCellSelectionEdges = (row: number, col: number) => {
    if (!selectionStart || !selectionEnd) return { top: false, right: false, bottom: false, left: false }
    const minRow = Math.min(selectionStart.row, selectionEnd.row)
    const maxRow = Math.max(selectionStart.row, selectionEnd.row)
    const minCol = Math.min(selectionStart.col, selectionEnd.col)
    const maxCol = Math.max(selectionStart.col, selectionEnd.col)
    return {
      top: row === minRow,
      right: col === maxCol,
      bottom: row === maxRow,
      left: col === minCol
    }
  }

  // Get cell value from workbook
  const getCellValue = (row: number, col: number) => {
    if (!workbook) return ''
    const sheet = workbook.Sheets[activeSheet]
    if (!sheet) return ''
    const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
    const cell = sheet[cellRef]
    if (!cell) return ''
    if (cell.w) return cell.w
    if (cell.v !== undefined) return String(cell.v)
    return ''
  }

  // Get sheet dimensions - extend beyond content for margin selection
  const getSheetDimensions = () => {
    if (!workbook) return { maxRows: 50, maxCols: 26 }
    const sheet = workbook.Sheets[activeSheet]
    if (!sheet || !sheet['!ref']) return { maxRows: 50, maxCols: 26 }
    const range = XLSX.utils.decode_range(sheet['!ref'])
    // Add extra rows and columns beyond content for margin selection
    const extraRows = 30
    const extraCols = 10
    return {
      maxRows: Math.max(range.e.r + 1 + extraRows, 100),
      maxCols: Math.max(range.e.c + 1 + extraCols, 30)
    }
  }

  const { maxRows, maxCols } = getSheetDimensions()

  const selectionRangeString = selectionStart && selectionEnd
    ? `${workbook && workbook.SheetNames.length > 1 ? `${activeSheet}!` : ''}${getColumnLabel(Math.min(selectionStart.col, selectionEnd.col))}${Math.min(selectionStart.row, selectionEnd.row) + 1}:${getColumnLabel(Math.max(selectionStart.col, selectionEnd.col))}${Math.max(selectionStart.row, selectionEnd.row) + 1}`
    : null

  // Parse range string and get preview data
  const parseRangeString = (rangeStr: string) => {
    if (!workbook || !rangeStr) return null
    try {
      // Handle sheet!range format
      let sheetName = workbook.SheetNames[0]
      let rangePart = rangeStr
      if (rangeStr.includes('!')) {
        const parts = rangeStr.split('!')
        sheetName = parts[0]
        rangePart = parts[1]
      }
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) return null

      const decoded = XLSX.utils.decode_range(rangePart)
      return { sheetName, decoded, sheet }
    } catch {
      return null
    }
  }

  // Get cell value from a specific sheet
  const getCellValueFromSheet = (sheet: XLSX.WorkSheet, row: number, col: number) => {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
    const cell = sheet[cellRef]
    if (!cell) return ''
    if (cell.w) return cell.w
    if (cell.v !== undefined) return String(cell.v)
    return ''
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-gray-500" />
          <span className="font-medium text-gray-900">Snapshot Ranges</span>
          <span className="text-sm text-gray-500">({ranges.length})</span>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {ranges.map((range, index) => {
            const parsed = parseRangeString(range.range)
            const isPreviewOpen = previewingIndex === index && parsed
            return (
              <div key={index} className="flex items-center gap-1.5 bg-gray-50 rounded px-2 py-1">
                <input
                  type="text"
                  value={range.name}
                  onChange={(e) => updateRange(index, { name: e.target.value })}
                  placeholder="Name"
                  className="w-52 px-1.5 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent bg-white"
                />
                <input
                  type="text"
                  value={range.range}
                  onChange={(e) => updateRange(index, { range: e.target.value })}
                  placeholder="A1:H30"
                  className="w-40 px-1.5 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent font-mono bg-white"
                />
                {workbook && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectingForIndex(index)
                      setSelectionStart(null)
                      setSelectionEnd(null)
                    }}
                    className="p-1 text-primary-600 hover:text-primary-700 hover:bg-primary-100 rounded transition-colors"
                    title="Select Range"
                  >
                    <Grid3X3 className="w-3.5 h-3.5" />
                  </button>
                )}
                {range.range && workbook && parsed && (
                  <button
                    type="button"
                    onClick={() => setPreviewingIndex(index)}
                    className="p-1 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                    title="Preview Snapshot"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (previewingIndex === index) setPreviewingIndex(null)
                    removeRange(index)
                  }}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}

          {ranges.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-1">
              No snapshot ranges defined.
            </p>
          )}

          <button
            type="button"
            onClick={addRange}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Range
          </button>
        </div>
      )}

      {/* Range Selection Modal */}
      {selectingForIndex !== null && workbook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-xl">
              <div className="flex items-center gap-3">
                <Target className="w-5 h-5 text-primary-600" />
                <div>
                  <h3 className="font-semibold text-gray-900">
                    Select Range for "{ranges[selectingForIndex]?.name || `Range ${selectingForIndex + 1}`}"
                  </h3>
                  <p className="text-xs text-gray-500">Click and drag to select a range of cells</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sheet tabs */}
            {workbook.SheetNames.length > 1 && (
              <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto px-2">
                {workbook.SheetNames.map(name => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setActiveSheet(name)
                      setSelectionStart(null)
                      setSelectionEnd(null)
                    }}
                    className={clsx(
                      'px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                      activeSheet === name
                        ? 'border-primary-500 text-primary-600 bg-white'
                        : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}

            {/* Spreadsheet grid */}
            <div
              className="flex-1 overflow-auto"
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                if (isSelecting) setIsSelecting(false)
              }}
            >
              <table className="w-full border-collapse text-xs select-none">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-12 px-2 py-2 bg-gray-100 border-b border-r border-gray-300 text-gray-600 font-semibold"></th>
                    {Array.from({ length: maxCols }, (_, i) => (
                      <th
                        key={i}
                        className="min-w-[80px] px-2 py-2 bg-gray-100 border-b border-r border-gray-300 text-gray-600 font-semibold text-center"
                      >
                        {getColumnLabel(i)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: maxRows }, (_, rowIndex) => (
                    <tr key={rowIndex}>
                      <td className="px-2 py-1.5 bg-gray-50 border-b border-r border-gray-300 text-gray-600 font-semibold text-center sticky left-0 z-[5]">
                        {rowIndex + 1}
                      </td>
                      {Array.from({ length: maxCols }, (_, colIndex) => {
                        const inSelection = isCellInSelection(rowIndex, colIndex)
                        const value = getCellValue(rowIndex, colIndex)
                        const edges = inSelection ? getCellSelectionEdges(rowIndex, colIndex) : null
                        return (
                          <td
                            key={colIndex}
                            onMouseDown={() => handleCellMouseDown(rowIndex, colIndex)}
                            onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                            className={clsx(
                              'px-2 py-1.5 truncate max-w-[120px] cursor-crosshair transition-colors',
                              inSelection ? 'bg-primary-100' : 'bg-white hover:bg-primary-50 border-b border-r border-gray-200'
                            )}
                            style={inSelection && edges ? {
                              borderTop: edges.top ? '2px solid rgb(99, 102, 241)' : 'none',
                              borderRight: edges.right ? '2px solid rgb(99, 102, 241)' : 'none',
                              borderBottom: edges.bottom ? '2px solid rgb(99, 102, 241)' : 'none',
                              borderLeft: edges.left ? '2px solid rgb(99, 102, 241)' : 'none'
                            } : undefined}
                          >
                            {value}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <div className="text-sm text-gray-600">
                {selectionRangeString ? (
                  <>
                    Selected: <code className="px-2 py-1 bg-primary-100 text-primary-700 rounded font-mono font-medium">{selectionRangeString}</code>
                  </>
                ) : (
                  <span className="text-gray-400">Click and drag to select a range</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={closeModal}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirmSelection}
                  disabled={!selectionRangeString}
                >
                  <Check className="w-4 h-4 mr-1" />
                  Confirm Selection
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewingIndex !== null && workbook && (() => {
        const previewRange = ranges[previewingIndex]
        const parsed = previewRange ? parseRangeString(previewRange.range) : null
        if (!parsed) return null

        const numRows = parsed.decoded.e.r - parsed.decoded.s.r + 1
        const numCols = parsed.decoded.e.c - parsed.decoded.s.c + 1

        // Get column widths from sheet
        const getColWidth = (colIdx: number) => {
          const cols = parsed.sheet['!cols']
          if (cols && cols[parsed.decoded.s.c + colIdx]) {
            const w = cols[parsed.decoded.s.c + colIdx].wpx || cols[parsed.decoded.s.c + colIdx].wch
            if (w) return typeof w === 'number' ? (cols[parsed.decoded.s.c + colIdx].wpx || w * 7) : 64
          }
          return 64
        }

        // Get row heights from sheet
        const getRowHeight = (rowIdx: number) => {
          const rows = parsed.sheet['!rows']
          if (rows && rows[parsed.decoded.s.r + rowIdx]) {
            const h = rows[parsed.decoded.s.r + rowIdx].hpx || rows[parsed.decoded.s.r + rowIdx].hpt
            if (h) return typeof h === 'number' ? h : 20
          }
          return 20
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-xl shadow-2xl max-w-[90vw] max-h-[90vh] flex flex-col">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-xl">
                <div className="flex items-center gap-3">
                  <Eye className="w-5 h-5 text-primary-600" />
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      Snapshot Preview: {previewRange.name || previewRange.range}
                    </h3>
                    <p className="text-xs text-gray-500">This is how the range will appear when captured</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewingIndex(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Preview Content */}
              <div className="p-6 overflow-auto bg-gray-100">
                <div className="inline-block bg-white shadow-lg">
                  <table className="border-collapse" style={{ borderSpacing: 0 }}>
                    <tbody>
                      {Array.from({ length: numRows }, (_, rowIdx) => (
                        <tr key={rowIdx}>
                          {Array.from({ length: numCols }, (_, colIdx) => {
                            const cellRef = XLSX.utils.encode_cell({
                              r: parsed.decoded.s.r + rowIdx,
                              c: parsed.decoded.s.c + colIdx
                            })
                            const cell = parsed.sheet[cellRef]
                            const value = cell ? (cell.w || (cell.v !== undefined ? String(cell.v) : '')) : ''

                            // Try to get alignment from cell style
                            const style = cell?.s
                            const textAlign = style?.alignment?.horizontal || 'left'
                            const verticalAlign = style?.alignment?.vertical || 'bottom'
                            const fontWeight = style?.font?.bold ? 'bold' : 'normal'
                            const fontStyle = style?.font?.italic ? 'italic' : 'normal'

                            return (
                              <td
                                key={colIdx}
                                style={{
                                  width: getColWidth(colIdx),
                                  height: getRowHeight(rowIdx),
                                  padding: '2px 4px',
                                  fontSize: '11px',
                                  fontFamily: 'Calibri, Arial, sans-serif',
                                  textAlign: textAlign as 'left' | 'center' | 'right',
                                  verticalAlign: verticalAlign as 'top' | 'middle' | 'bottom',
                                  fontWeight,
                                  fontStyle,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                }}
                              >
                                {value}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <Button variant="outline" size="sm" onClick={() => setPreviewingIndex(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ============================================================================
// DETECTION RULES EDITOR
// ============================================================================

function DetectionRulesEditor({ rules, onChange }: DetectionRulesEditorProps) {
  const [expanded, setExpanded] = useState(false)

  // Store raw value for editing, only clean on blur/save
  const [filenameInput, setFilenameInput] = useState((rules.filename_patterns || []).join('\n'))
  const [sheetNamesInput, setSheetNamesInput] = useState((rules.sheet_names || []).join('\n'))

  // Sync with props when rules change externally
  useEffect(() => {
    setFilenameInput((rules.filename_patterns || []).join('\n'))
  }, [rules.filename_patterns])

  useEffect(() => {
    setSheetNamesInput((rules.sheet_names || []).join('\n'))
  }, [rules.sheet_names])

  const saveFilenamePatterns = () => {
    const patterns = filenameInput.split('\n').map(s => s.trim()).filter(Boolean)
    onChange({ ...rules, filename_patterns: patterns.length ? patterns : undefined })
  }

  const saveSheetNames = () => {
    const names = sheetNamesInput.split('\n').map(s => s.trim()).filter(Boolean)
    onChange({ ...rules, sheet_names: names.length ? names : undefined })
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-gray-500" />
          <span className="font-medium text-gray-900">Detection Rules</span>
          <span className="text-sm text-gray-500">(Optional)</span>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3">
          <p className="text-xs text-gray-500">
            When uploading Excel files, these rules help automatically match files to this template.
          </p>

          <div>
            <label className="block text-xs text-gray-700 mb-1">
              <span className="font-medium">Filename Patterns</span> <span className="text-gray-400">— match files by name, one per line, use * as wildcard</span>
            </label>
            <textarea
              value={filenameInput}
              onChange={(e) => setFilenameInput(e.target.value)}
              onBlur={saveFilenamePatterns}
              placeholder="*Model*&#10;*DCF*&#10;*Valuation*"
              rows={3}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent resize-none font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-700 mb-1">
              <span className="font-medium">Required Sheet Names</span> <span className="text-gray-400">— only match files containing these tabs, one per line</span>
            </label>
            <textarea
              value={sheetNamesInput}
              onChange={(e) => setSheetNamesInput(e.target.value)}
              onBlur={saveSheetNames}
              placeholder="Summary&#10;Model&#10;Assumptions"
              rows={3}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent resize-none font-mono"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// TEMPLATE CARD
// ============================================================================

interface TemplateCollaboration {
  template_id: string
  user_id: string | null
  org_node_id: string | null
  org_node?: { id: string; name: string; node_type: string } | null
  target_user?: { id: string; first_name: string | null; last_name: string | null } | null
}

interface TemplateCardProps {
  template: ModelTemplate
  onEdit?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onShare?: () => void
  onUploadBaseTemplate?: (file: File) => void
  onDownloadBaseTemplate?: () => void
  onDeleteBaseTemplate?: () => void
  onPreview?: () => void
  onExcelPreview?: (type: 'field' | 'snapshot' | 'dynamic', item?: FieldMapping | SnapshotRange | DynamicFieldMapping) => void
  isOwner?: boolean
  collaborations?: TemplateCollaboration[]
  isUploadingBase?: boolean
  loadingExcelPreview?: boolean
}

function ModelTemplateCard({
  template,
  onEdit,
  onDelete,
  onDuplicate,
  onShare,
  onUploadBaseTemplate,
  onDownloadBaseTemplate,
  onDeleteBaseTemplate,
  onPreview,
  onExcelPreview,
  isOwner,
  collaborations = [],
  isUploadingBase = false,
  loadingExcelPreview = false
}: TemplateCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const baseFileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const dragLeaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const fixedFieldCount = template.field_mappings?.length || 0
  const dynamicFieldCount = template.dynamic_mappings?.length || 0
  const snapshotCount = template.snapshot_ranges?.length || 0

  // Clear drag state when upload starts
  useEffect(() => {
    if (isUploadingBase) {
      setIsDraggingOver(false)
    }
  }, [isUploadingBase])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dragLeaveTimeoutRef.current) {
        clearTimeout(dragLeaveTimeoutRef.current)
      }
    }
  }, [])

  // Handle drag and drop for base template - with debounced leave to prevent edge flickering
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Clear any pending leave timeout
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current)
      dragLeaveTimeoutRef.current = null
    }
    if (!isUploadingBase) {
      setIsDraggingOver(true)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Clear any pending leave timeout and ensure drag state is active
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current)
      dragLeaveTimeoutRef.current = null
    }
    if (!isUploadingBase && !isDraggingOver) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Use a small delay before removing drag state to prevent edge flickering
    // This gives time for dragEnter on child elements to fire first
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current)
    }
    dragLeaveTimeoutRef.current = setTimeout(() => {
      setIsDraggingOver(false)
      dragLeaveTimeoutRef.current = null
    }, 50)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Clear any pending leave timeout
    if (dragLeaveTimeoutRef.current) {
      clearTimeout(dragLeaveTimeoutRef.current)
      dragLeaveTimeoutRef.current = null
    }
    setIsDraggingOver(false)

    if (isUploadingBase || !onUploadBaseTemplate) return

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const file = files[0]
      const fileName = file.name.toLowerCase()
      // Check if it's an Excel file
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        // Create a new File from ArrayBuffer to ensure consistent behavior across browsers
        const arrayBuffer = await file.arrayBuffer()
        const blob = new Blob([arrayBuffer], { type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        const newFile = new File([blob], file.name, { type: blob.type })
        onUploadBaseTemplate(newFile)
      }
    }
  }

  // Parse sharing info
  const orgWideShare = collaborations.find(c => !c.user_id && !c.org_node_id)
  const userShares = collaborations.filter(c => c.user_id && c.target_user)
  const nodeShares = collaborations.filter(c => c.org_node_id && c.org_node)
  const hasSharing = collaborations.length > 0

  return (
    <div className="border border-gray-200 hover:border-gray-300 rounded-lg transition-colors overflow-hidden">
      {/* Main row - clickable to expand */}
      <div
        className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <button type="button" className="p-0.5 text-gray-400">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        <FileSpreadsheet className="w-4 h-4 text-green-600 flex-shrink-0" />

        <div className="flex-1 min-w-0 flex items-center gap-3">
          <span className="font-medium text-gray-900 truncate">{template.name}</span>

          {/* Field counts */}
          <div className="flex items-center gap-1.5 text-[10px]">
            {fixedFieldCount > 0 && (
              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                {fixedFieldCount} fixed field{fixedFieldCount !== 1 ? 's' : ''}
              </span>
            )}
            {dynamicFieldCount > 0 && (
              <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
                {dynamicFieldCount} dynamic field{dynamicFieldCount !== 1 ? 's' : ''}
              </span>
            )}
            {snapshotCount > 0 && (
              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                {snapshotCount} snapshot{snapshotCount !== 1 ? 's' : ''}
              </span>
            )}
            {template.base_template_path && (
              <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded flex items-center gap-0.5">
                <FileSpreadsheet className="w-3 h-3" />
                Template
              </span>
            )}
          </div>

          {/* Sharing indicator */}
          {hasSharing && (
            <span className="text-[10px] text-gray-400 flex items-center gap-1">
              <Users className="w-3 h-3" />
              Shared
            </span>
          )}

          {template.is_firm_template && (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
              <Building2 className="w-3 h-3" />
              Firm
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Duplicate"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {isOwner && onShare && (
            <button
              type="button"
              onClick={onShare}
              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
              title="Share"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          )}
          {isOwner && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Edit"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          {isOwner && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 space-y-3">
          {/* Description */}
          {template.description && (
            <p className="text-sm text-gray-600">{template.description}</p>
          )}

          {/* Field Mappings Summary */}
          {(fixedFieldCount > 0 || dynamicFieldCount > 0 || snapshotCount > 0) && (
            <div className="grid grid-cols-1 gap-2">
              {/* Fixed Fields */}
              {fixedFieldCount > 0 && (
                <div className="flex items-start gap-2">
                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    <span className="text-[10px] font-medium text-gray-500">Fixed</span>
                    {template.base_template_path && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onExcelPreview) onExcelPreview('field', undefined)
                        }}
                        disabled={loadingExcelPreview}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                        title="Preview in spreadsheet"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 flex flex-wrap gap-1">
                    {template.field_mappings?.slice(0, 8).map((m, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-600"
                      >
                        {m.label || m.field} → <code className="text-gray-400">{m.cell}</code>
                      </span>
                    ))}
                    {fixedFieldCount > 8 && (
                      <span className="text-[10px] text-gray-400 py-0.5">+{fixedFieldCount - 8} more</span>
                    )}
                  </div>
                </div>
              )}

              {/* Dynamic Fields */}
              {dynamicFieldCount > 0 && (
                <div className="flex items-start gap-2">
                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    <span className="text-[10px] font-medium text-gray-500">Dynamic</span>
                    {template.base_template_path && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onExcelPreview && template.dynamic_mappings?.[0]) onExcelPreview('dynamic', template.dynamic_mappings[0])
                        }}
                        disabled={loadingExcelPreview}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                        title="Preview in spreadsheet"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 flex flex-wrap gap-1">
                    {template.dynamic_mappings?.slice(0, 8).map((m, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 bg-purple-50 border border-purple-100 rounded text-purple-600"
                      >
                        {m.name}
                      </span>
                    ))}
                    {dynamicFieldCount > 8 && (
                      <span className="text-[10px] text-gray-400 py-0.5">+{dynamicFieldCount - 8} more</span>
                    )}
                  </div>
                </div>
              )}

              {/* Snapshots */}
              {snapshotCount > 0 && (
                <div className="flex items-start gap-2">
                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    <span className="text-[10px] font-medium text-gray-500">Snapshots</span>
                    {template.base_template_path && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onExcelPreview && template.snapshot_ranges?.[0]) onExcelPreview('snapshot', template.snapshot_ranges[0])
                        }}
                        disabled={loadingExcelPreview}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                        title="Preview in spreadsheet"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 flex flex-wrap gap-1">
                    {template.snapshot_ranges?.slice(0, 6).map((s, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 bg-blue-50 border border-blue-100 rounded text-blue-600"
                      >
                        {s.name || 'Unnamed'}: <code className="text-blue-500">{s.range}</code>
                      </span>
                    ))}
                    {snapshotCount > 6 && (
                      <span className="text-[10px] text-gray-400 py-0.5">+{snapshotCount - 6} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sharing Details */}
          {hasSharing && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 mb-1">Shared With</h5>
              <div className="flex flex-wrap gap-1.5">
                {orgWideShare && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                    <Building2 className="w-3 h-3" />
                    Entire Organization
                  </span>
                )}
                {nodeShares.map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                    <Users className="w-3 h-3" />
                    {(c.org_node as any)?.name}
                  </span>
                ))}
                {userShares.map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded">
                    <User className="w-3 h-3" />
                    {(c.target_user as any)?.first_name} {(c.target_user as any)?.last_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Detection Rules */}
          {(template.detection_rules?.filename_patterns?.length || template.detection_rules?.sheet_names?.length) && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 mb-1">Detection Rules</h5>
              <div className="text-[10px] text-gray-600 space-y-0.5">
                {template.detection_rules.filename_patterns?.length > 0 && (
                  <div>Filename patterns: {template.detection_rules.filename_patterns.join(', ')}</div>
                )}
                {template.detection_rules.sheet_names?.length > 0 && (
                  <div>Required sheets: {template.detection_rules.sheet_names.join(', ')}</div>
                )}
              </div>
            </div>
          )}

          {/* Base Template File */}
          {isOwner && (
            <div
              className={clsx(
                "border-t border-gray-200 pt-3 mt-3 transition-colors",
                isDraggingOver && "bg-primary-50 rounded-lg"
              )}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <h5 className="text-xs font-medium text-gray-500 mb-2">Base Template File</h5>
              <input
                ref={baseFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file && onUploadBaseTemplate) {
                    onUploadBaseTemplate(file)
                  }
                  e.target.value = ''
                }}
              />
              {template.base_template_path && !isDraggingOver ? (
                <div className="flex items-center justify-between p-2 bg-white border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSpreadsheet className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{template.base_template_filename}</div>
                      <div className="text-[10px] text-gray-500">
                        {template.base_template_size ? `${Math.round(template.base_template_size / 1024)} KB` : ''}
                        {template.base_template_uploaded_at && ` • Uploaded ${new Date(template.base_template_uploaded_at).toLocaleDateString()}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={onDownloadBaseTemplate}
                      className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                      title="Download template"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => baseFileInputRef.current?.click()}
                      disabled={isUploadingBase}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                      title="Replace template"
                    >
                      {isUploadingBase ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={onDeleteBaseTemplate}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Remove template"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  ref={dropZoneRef}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => !isUploadingBase && baseFileInputRef.current?.click()}
                  className={clsx(
                    "w-full flex flex-col items-center justify-center gap-1 px-3 py-4 border-2 border-dashed rounded-lg text-sm cursor-pointer transition-colors",
                    isDraggingOver
                      ? "border-primary-500 bg-primary-50 text-primary-600"
                      : "border-gray-300 text-gray-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50",
                    isUploadingBase && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isUploadingBase ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : isDraggingOver ? (
                    <>
                      <Download className="w-5 h-5" />
                      <span>Drop Excel file here</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      <span>Drag & drop or click to upload</span>
                      <span className="text-[10px] text-gray-400">.xlsx or .xls files</span>
                    </>
                  )}
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-1">
                Upload an Excel file to use as a starting point when analysts use this template.
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ExcelModelTemplateManager() {
  const { user } = useAuth()
  const {
    templates,
    myTemplates,
    sharedTemplates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    uploadBaseTemplate,
    deleteBaseTemplate,
    getBaseTemplateUrl
  } = useModelTemplates()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set())
  const [sharingTemplate, setSharingTemplate] = useState<ModelTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSharingSection, setShowSharingSection] = useState(false)
  const [showOrgDropdown, setShowOrgDropdown] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [uploadingBaseForTemplate, setUploadingBaseForTemplate] = useState<string | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<ModelTemplate | null>(null)

  // Excel preview state
  const [excelPreviewData, setExcelPreviewData] = useState<{
    template: ModelTemplate
    type: 'field' | 'snapshot' | 'dynamic'
    item?: FieldMapping | SnapshotRange | DynamicFieldMapping
    // For field mappings: the entire spreadsheet data with all mappings highlighted
    spreadsheetData?: {
      headers: string[]
      rows: { rowNum: number; cells: { value: any; isMapped: boolean; mappingLabel?: string; fieldId?: string }[] }[]
      startRow: number
      startCol: number
    }
    // For field mappings: previews for each sheet with mappings
    sheetPreviews?: {
      sheetName: string
      headers: string[]
      rows: { rowNum: number; cells: { value: any; isMapped: boolean; mappingLabel?: string; fieldId?: string }[] }[]
      startRow: number
      startCol: number
      mappingCount: number
    }[]
    // For snapshot: the rendered image data URL
    snapshotImageUrl?: string
    // For snapshot: the range data for fallback
    rangeData?: { headers: string[]; rows: any[][] }
    sheetName: string
    allMappings?: FieldMapping[]
  } | null>(null)
  const [loadingExcelPreview, setLoadingExcelPreview] = useState(false)
  const [selectedPreviewSheet, setSelectedPreviewSheet] = useState<string>('')
  const [selectedCellFieldId, setSelectedCellFieldId] = useState<string | null>(null)
  const snapshotPreviewRef = useRef<HTMLDivElement>(null)

  // Query for template collaborations to show sharing info
  const { data: templateCollaborations = [] } = useQuery({
    queryKey: ['model-template-collaborations', user?.id],
    queryFn: async () => {
      if (!user) return []

      // Get collaborations for templates user owns
      const { data, error } = await supabase
        .from('model_template_collaborations')
        .select(`
          template_id,
          user_id,
          org_node_id,
          org_node:org_chart_nodes(id, name, node_type),
          target_user:users!model_template_collaborations_user_id_fkey(id, first_name, last_name)
        `)
        .in('template_id', myTemplates.map(t => t.id))

      if (error) throw error
      return data || []
    },
    enabled: !!user && myTemplates.length > 0
  })

  // Build sharing info map
  const templateSharingInfo = useMemo(() => {
    const infoMap: Record<string, string> = {}

    for (const template of myTemplates) {
      const collabs = templateCollaborations.filter(c => c.template_id === template.id)
      if (collabs.length === 0) continue

      const parts: string[] = []

      // Check for org-wide sharing
      const orgWide = collabs.find(c => !c.user_id && !c.org_node_id)
      if (orgWide) {
        parts.push('Entire Org')
      }

      // Count users
      const userCount = collabs.filter(c => c.user_id).length
      if (userCount > 0) {
        parts.push(`${userCount} user${userCount !== 1 ? 's' : ''}`)
      }

      // Get org node names
      const orgNodes = collabs.filter(c => c.org_node_id && c.org_node)
      for (const node of orgNodes) {
        if (node.org_node) {
          parts.push((node.org_node as any).name)
        }
      }

      if (parts.length > 0) {
        infoMap[template.id] = parts.join(', ')
      }
    }

    return infoMap
  }, [myTemplates, templateCollaborations])

  // Spreadsheet cell selection state
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [loadedFile, setLoadedFile] = useState<File | null>(null) // Store the actual file for uploading as base template
  const [selectingForIndex, setSelectingForIndex] = useState<number | null>(null)
  const [detectedFields, setDetectedFields] = useState<DetectedField[]>([])
  const [detectedDynamicMappings, setDetectedDynamicMappings] = useState<DetectedDynamicMapping[]>([])
  const [acceptedDynamicIds, setAcceptedDynamicIds] = useState<Set<string>>(new Set())
  const [rejectedDynamicIds, setRejectedDynamicIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  type PermissionLevel = 'view' | 'edit' | 'admin'
  type ShareEntryType = 'user' | 'division' | 'department' | 'team' | 'portfolio'
  interface ShareEntry {
    id: string
    type: ShareEntryType
    name: string
    email?: string
    permission: PermissionLevel
  }

  interface OrgNode {
    id: string
    name: string
    node_type: 'division' | 'department' | 'team' | 'portfolio'
    parent_id: string | null
  }

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    fieldMappings: [] as FieldMapping[],
    dynamicMappings: [] as DynamicFieldMapping[],
    snapshotRanges: [] as SnapshotRange[],
    detectionRules: {} as DetectionRules,
    shareWithOrg: false,
    orgPermission: 'view' as PermissionLevel,
    shareEntries: [] as ShareEntry[]
  })

  // For user search in sharing section
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const { data: searchResults = [], isLoading: isSearchingUsers } = useSearchUsers(userSearchQuery)

  // Fetch org chart nodes for sharing
  const { data: orgNodes = [] } = useQuery({
    queryKey: ['org-chart-nodes-for-sharing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .eq('is_active', true)
        .order('node_type')
        .order('name')
      if (error) throw error
      return (data || []) as OrgNode[]
    }
  })

  // Group org nodes by type
  const divisions = orgNodes.filter(n => n.node_type === 'division')
  const departments = orgNodes.filter(n => n.node_type === 'department')
  const teams = orgNodes.filter(n => n.node_type === 'team')
  const portfolios = orgNodes.filter(n => n.node_type === 'portfolio')

  // Handle spreadsheet file loading
  const handleLoadFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const processFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        setWorkbook(wb)
        setFileName(file.name)
        setLoadedFile(file) // Store the file for base template upload
        setSelectingForIndex(null)

        // Run auto-detection on the loaded file
        const detected = detectFields(wb)
        setDetectedFields(detected)

        // Run dynamic mapping auto-detection
        const detectedDynamic = detectDynamicMappings(wb)
        console.log('[Dynamic Detection] Found', detectedDynamic.length, 'potential dynamic mappings:', detectedDynamic)
        setDetectedDynamicMappings(detectedDynamic)
        // Reset accepted/rejected when loading new file
        setAcceptedDynamicIds(new Set())
        setRejectedDynamicIds(new Set())
      } catch (err) {
        console.error('Error reading Excel file:', err)
        setError('Failed to read Excel file')
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const handleFileDrop = useCallback((file: File) => {
    processFile(file)
  }, [processFile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    processFile(file)

    // Reset input so same file can be selected again
    e.target.value = ''
  }, [processFile])

  // Handlers for dynamic mapping detection
  const handleAcceptDynamic = useCallback((detected: DetectedDynamicMapping) => {
    // Convert the detected mapping to an actual DynamicFieldMapping
    const newMapping = convertDetectedToMapping(detected)

    // Check for duplicate dynamic mappings (by name or field pattern)
    const existingWithSameName = formData.dynamicMappings.find(
      dm => dm.name.toLowerCase() === newMapping.name.toLowerCase()
    )
    if (existingWithSameName) {
      setError(`A dynamic mapping named "${newMapping.name}" already exists. Please remove it first or choose a different mapping.`)
      return
    }
    const existingWithSamePattern = formData.dynamicMappings.find(
      dm => dm.field_pattern.toLowerCase() === newMapping.field_pattern.toLowerCase()
    )
    if (existingWithSamePattern) {
      setError(`A dynamic mapping with field pattern "${newMapping.field_pattern}" already exists (${existingWithSamePattern.name}). Please remove it first.`)
      return
    }

    // Check for conflicts with existing fixed mappings
    // Get the field IDs that this dynamic mapping will generate
    const dynamicFieldIds = new Set<string>()
    if (workbook) {
      const preview = previewDynamicMapping(workbook, newMapping)
      if (preview.extractedFields) {
        preview.extractedFields.forEach(f => dynamicFieldIds.add(f.field))
      }
    }

    setFormData(prev => {
      // Filter out any fixed mappings that conflict with the dynamic mapping's field IDs
      const conflictingFixed = prev.fieldMappings.filter(fm => dynamicFieldIds.has(fm.field))
      if (conflictingFixed.length > 0) {
        console.log('[Conflict] Removing', conflictingFixed.length, 'fixed mappings that conflict with dynamic mapping:',
          conflictingFixed.map(f => f.field))
      }
      const filteredFieldMappings = prev.fieldMappings.filter(fm => !dynamicFieldIds.has(fm.field))

      return {
        ...prev,
        fieldMappings: filteredFieldMappings,
        dynamicMappings: [...prev.dynamicMappings, newMapping]
      }
    })
    // Mark as accepted
    setAcceptedDynamicIds(prev => new Set([...prev, detected.id]))
  }, [workbook, formData.dynamicMappings])

  const handleRejectDynamic = useCallback((id: string) => {
    setRejectedDynamicIds(prev => new Set([...prev, id]))
  }, [])

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      fieldMappings: [],
      dynamicMappings: [],
      snapshotRanges: [],
      detectionRules: {},
      shareWithOrg: false,
      orgPermission: 'view',
      shareEntries: []
    })
    setUserSearchQuery('')
    setShowForm(false)
    setEditingId(null)
    setError(null)
    setShowSharingSection(false)
    setShowOrgDropdown(false)
    setWorkbook(null)
    setFileName(null)
    setSelectingForIndex(null)
    setDetectedFields([])
    setDetectedDynamicMappings([])
    setAcceptedDynamicIds(new Set())
    setRejectedDynamicIds(new Set())
  }

  const startEdit = (template: ModelTemplate) => {
    // Show form immediately
    setFormData({
      name: template.name,
      description: template.description || '',
      fieldMappings: template.field_mappings || [],
      dynamicMappings: template.dynamic_mappings || [],
      snapshotRanges: template.snapshot_ranges || [],
      detectionRules: template.detection_rules || {},
      shareWithOrg: false,
      orgPermission: 'view',
      shareEntries: [] // Existing sharing is managed via the modal when editing
    })
    setUserSearchQuery('')
    setEditingId(template.id)
    setShowForm(true)

    // Set filename immediately for visual feedback
    if (template.base_template_filename) {
      setFileName(template.base_template_filename)
    }

    // Load the base template file in the background
    if (template.base_template_path) {
      (async () => {
        try {
          const url = await getBaseTemplateUrl(template.base_template_path!)
          const response = await fetch(url)
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer()
            const wb = XLSX.read(arrayBuffer, { type: 'array' })
            setWorkbook(wb)

            // Get existing mapped cells to filter them out from autodetection
            const existingMappedCells = new Set(
              (template.field_mappings || []).map(m => m.cell)
            )
            const existingMappedFields = new Set(
              (template.field_mappings || []).map(m => m.field)
            )

            // Run auto-detection on the loaded file
            const detected = detectFields(wb)
            // Filter out fields that are already mapped (by cell OR by field name)
            const filteredDetected = detected.filter(d =>
              !existingMappedCells.has(d.cell) && !existingMappedFields.has(d.suggestedField)
            )
            setDetectedFields(filteredDetected)

            // Run dynamic mapping auto-detection
            const detectedDynamic = detectDynamicMappings(wb)
            // Filter out dynamic mappings that match existing ones by name
            const existingDynamicNames = new Set(
              (template.dynamic_mappings || []).map(m => m.name.toLowerCase())
            )
            const filteredDynamic = detectedDynamic.filter(d =>
              !existingDynamicNames.has(d.name.toLowerCase())
            )
            setDetectedDynamicMappings(filteredDynamic)

            // Mark already-mapped dynamic fields as accepted
            const existingDynamicIds = new Set(
              (template.dynamic_mappings || []).map(m => m.id)
            )
            setAcceptedDynamicIds(existingDynamicIds)
            setRejectedDynamicIds(new Set())
          }
        } catch (err) {
          console.error('Failed to load base template for editing:', err)
        }
      })()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name.trim()) {
      setError('Template name is required')
      return
    }

    if (formData.fieldMappings.length === 0 && (!formData.dynamicMappings || formData.dynamicMappings.length === 0)) {
      setError('At least one field mapping (fixed or dynamic) is required')
      return
    }

    // Validate field mappings
    const invalidMappings = formData.fieldMappings.filter(m => !m.cell || !m.field)
    if (invalidMappings.length > 0) {
      setError('All field mappings must have both a cell reference and a Tesseract field')
      return
    }

    // Check for duplicate dynamic mappings (by name or field pattern)
    if (formData.dynamicMappings && formData.dynamicMappings.length > 1) {
      const seenNames = new Set<string>()
      const seenPatterns = new Set<string>()
      for (const dm of formData.dynamicMappings) {
        const nameLower = dm.name.toLowerCase()
        const pattern = dm.field_pattern.toLowerCase()
        if (seenNames.has(nameLower)) {
          setError(`Duplicate dynamic mapping name: "${dm.name}". Each dynamic mapping must have a unique name.`)
          return
        }
        if (seenPatterns.has(pattern)) {
          setError(`Duplicate dynamic mapping field pattern: "${dm.field_pattern}". Each dynamic mapping must have a unique field pattern.`)
          return
        }
        seenNames.add(nameLower)
        seenPatterns.add(pattern)
      }
    }

    try {
      let templateId: string | null = null

      if (editingId) {
        await updateTemplate.mutateAsync({
          id: editingId,
          name: formData.name,
          description: formData.description || undefined,
          fieldMappings: formData.fieldMappings,
          dynamicMappings: formData.dynamicMappings,
          snapshotRanges: formData.snapshotRanges,
          detectionRules: formData.detectionRules
        })
        templateId = editingId
      } else {
        const newTemplate = await createTemplate.mutateAsync({
          name: formData.name,
          description: formData.description || undefined,
          fieldMappings: formData.fieldMappings,
          dynamicMappings: formData.dynamicMappings,
          snapshotRanges: formData.snapshotRanges,
          detectionRules: formData.detectionRules
        })

        templateId = newTemplate?.id || null

        // Apply sharing settings for new template
        if (newTemplate) {
          const collaborations: Array<{
            template_id: string
            user_id: string | null
            team_id: string | null
            org_node_id: string | null
            permission: string
            invited_by: string | undefined
          }> = []

          // Org-wide sharing
          if (formData.shareWithOrg) {
            collaborations.push({
              template_id: newTemplate.id,
              user_id: null,
              team_id: null,
              org_node_id: null,
              permission: formData.orgPermission,
              invited_by: user?.id
            })
          }

          // Individual users and org nodes
          for (const entry of formData.shareEntries) {
            const isUser = entry.type === 'user'
            const isOrgNode = ['division', 'department', 'team', 'portfolio'].includes(entry.type)

            collaborations.push({
              template_id: newTemplate.id,
              user_id: isUser ? entry.id : null,
              team_id: null, // Legacy field, not used
              org_node_id: isOrgNode ? entry.id : null,
              permission: entry.permission,
              invited_by: user?.id
            })
          }

          if (collaborations.length > 0) {
            await supabase
              .from('model_template_collaborations')
              .insert(collaborations)
          }
        }
      }

      // Upload the loaded spreadsheet as the base template file
      if (templateId && loadedFile) {
        try {
          await uploadBaseTemplate.mutateAsync({ templateId, file: loadedFile })
        } catch (uploadErr) {
          console.error('Error uploading base template file:', uploadErr)
          // Don't fail the whole save if base template upload fails
        }
      }

      resetForm()
    } catch (err) {
      console.error('Error saving model template:', err)
      setError(err instanceof Error ? err.message : 'Failed to save template')
    }
  }

  const handleDelete = async (id: string) => {
    // Immediately hide the template by adding to pending deletes
    setPendingDeletes(prev => new Set(prev).add(id))
    setDeleteConfirm(null)

    try {
      await deleteTemplate.mutateAsync(id)
    } catch (err) {
      console.error('Error deleting model template:', err)
      // If delete failed, remove from pending deletes to show it again
      setPendingDeletes(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleDuplicate = async (templateId: string) => {
    try {
      await duplicateTemplate.mutateAsync(templateId)
    } catch (err) {
      console.error('Error duplicating model template:', err)
    }
  }

  // Handle base template file upload
  const handleUploadBaseTemplate = async (templateId: string, file: File) => {
    setUploadingBaseForTemplate(templateId)
    try {
      await uploadBaseTemplate.mutateAsync({ templateId, file })
    } catch (err) {
      console.error('Error uploading base template:', err)
      setError('Failed to upload base template file')
    } finally {
      setUploadingBaseForTemplate(null)
    }
  }

  // Handle base template download
  const handleDownloadBaseTemplate = async (template: ModelTemplate) => {
    if (!template.base_template_path) return
    try {
      const url = await getBaseTemplateUrl(template.base_template_path)
      const link = document.createElement('a')
      link.href = url
      link.download = template.base_template_filename || 'template.xlsx'
      link.click()
    } catch (err) {
      console.error('Error downloading base template:', err)
      setError('Failed to download base template file')
    }
  }

  // Handle base template delete
  const handleDeleteBaseTemplate = async (templateId: string) => {
    try {
      await deleteBaseTemplate.mutateAsync(templateId)
    } catch (err) {
      console.error('Error deleting base template:', err)
      setError('Failed to delete base template file')
    }
  }

  // Handle Excel preview for field mappings and snapshot ranges
  const handleExcelPreview = async (
    template: ModelTemplate,
    type: 'field' | 'snapshot' | 'dynamic',
    item?: FieldMapping | SnapshotRange | DynamicFieldMapping
  ) => {
    if (!template.base_template_path) {
      setError('No base template file available for preview')
      return
    }

    setLoadingExcelPreview(true)
    try {
      // Fetch the base template file
      const url = await getBaseTemplateUrl(template.base_template_path)
      const response = await fetch(url)
      if (!response.ok) throw new Error('Failed to fetch template file')

      const arrayBuffer = await response.arrayBuffer()
      const wb = XLSX.read(arrayBuffer, { type: 'array' })

      // Determine which sheet to use (first sheet by default)
      const sheetName = wb.SheetNames[0]
      const sheet = wb.Sheets[sheetName]
      const sheetRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1')

      if (type === 'field') {
        // For field mappings, show the spreadsheet with ALL field mappings highlighted
        const allMappings = template.field_mappings || []

        if (allMappings.length === 0) {
          setError('No field mappings defined')
          setLoadingExcelPreview(false)
          return
        }

        // Helper to parse cell reference (handles "Sheet!B5" or just "B5")
        const parseCellRef = (cellRef: string): { sheet: string; cell: string; addr: { r: number; c: number } } => {
          const parts = cellRef.split('!')
          const cellOnly = parts.length > 1 ? parts[1] : parts[0]
          const sheetOnly = parts.length > 1 ? parts[0].replace(/^'|'$/g, '') : sheetName // Default to first sheet
          return {
            sheet: sheetOnly,
            cell: cellOnly,
            addr: XLSX.utils.decode_cell(cellOnly)
          }
        }

        // Group mappings by sheet
        const mappingsBySheet = new Map<string, { mapping: FieldMapping; cell: string; addr: { r: number; c: number } }[]>()

        for (const mapping of allMappings) {
          try {
            const parsed = parseCellRef(mapping.cell)
            if (!mappingsBySheet.has(parsed.sheet)) {
              mappingsBySheet.set(parsed.sheet, [])
            }
            mappingsBySheet.get(parsed.sheet)!.push({
              mapping,
              cell: parsed.cell,
              addr: parsed.addr
            })
          } catch (e) {
            console.warn('Failed to parse cell reference:', mapping.cell, e)
          }
        }

        // Build data for each sheet that has mappings
        const sheetPreviews: {
          sheetName: string
          headers: string[]
          rows: { rowNum: number; cells: { value: any; isMapped: boolean; mappingLabel?: string; fieldId?: string }[] }[]
          startRow: number
          startCol: number
          mappingCount: number
        }[] = []

        for (const [targetSheetName, sheetMappings] of mappingsBySheet) {
          const targetSheet = wb.Sheets[targetSheetName]
          if (!targetSheet) continue

          const targetSheetRange = XLSX.utils.decode_range(targetSheet['!ref'] || 'A1')

          // Build map of all mapped cells for this sheet
          const mappedCells = new Map<string, { fieldId: string; displayLabel: string }>()
          for (const { mapping, cell } of sheetMappings) {
            mappedCells.set(cell, {
              fieldId: mapping.field,
              displayLabel: mapping.label || mapping.field
            })
          }

          // Show the full used range of the sheet so user can scroll around
          const startRow = 0
          const endRow = Math.min(targetSheetRange.e.r, 200) // Cap at 200 rows for performance
          const startCol = 0
          const endCol = Math.min(targetSheetRange.e.c, 25) // Cap at column Z for performance

          // Build headers
          const headers: string[] = []
          for (let c = startCol; c <= endCol; c++) {
            headers.push(XLSX.utils.encode_col(c))
          }

          // Build rows
          const rows: { rowNum: number; cells: { value: any; isMapped: boolean; mappingLabel?: string; fieldId?: string }[] }[] = []
          for (let r = startRow; r <= endRow; r++) {
            const rowCells: { value: any; isMapped: boolean; mappingLabel?: string; fieldId?: string }[] = []
            for (let c = startCol; c <= endCol; c++) {
              const addr = XLSX.utils.encode_cell({ r, c })
              const cell = targetSheet[addr]
              const mappingInfo = mappedCells.get(addr)
              rowCells.push({
                value: cell ? cell.v : '',
                isMapped: !!mappingInfo,
                mappingLabel: mappingInfo?.displayLabel,
                fieldId: mappingInfo?.fieldId
              })
            }
            rows.push({ rowNum: r + 1, cells: rowCells })
          }

          sheetPreviews.push({
            sheetName: targetSheetName,
            headers,
            rows,
            startRow,
            startCol,
            mappingCount: sheetMappings.length
          })
        }

        // Use the first sheet with mappings as default
        const defaultPreview = sheetPreviews[0]
        if (!defaultPreview) {
          setError('No valid mappings found')
          setLoadingExcelPreview(false)
          return
        }

        setExcelPreviewData({
          template,
          type,
          sheetName: defaultPreview.sheetName,
          allMappings,
          spreadsheetData: {
            headers: defaultPreview.headers,
            rows: defaultPreview.rows,
            startRow: defaultPreview.startRow,
            startCol: defaultPreview.startCol
          },
          sheetPreviews // Store all sheet previews for tab switching
        })
      } else if (type === 'snapshot') {
        // For snapshot ranges, show the range as an image preview
        const snapshot = item as SnapshotRange
        if (!snapshot) {
          setError('No snapshot range provided')
          setLoadingExcelPreview(false)
          return
        }

        // Parse range - handle "Sheet!A1:D10" or just "A1:D10"
        let rangeRef = snapshot.range
        let targetSheetName = sheetName
        if (rangeRef.includes('!')) {
          const parts = rangeRef.split('!')
          targetSheetName = parts[0].replace(/^'|'$/g, '') // Remove quotes if present
          rangeRef = parts[1]
        }

        // Get the correct sheet
        const targetSheet = wb.Sheets[targetSheetName] || sheet

        try {
          const rangeAddr = XLSX.utils.decode_range(rangeRef)
          const headers: string[] = []
          const rows: any[][] = []

          // Build headers (column letters)
          for (let c = rangeAddr.s.c; c <= rangeAddr.e.c; c++) {
            headers.push(XLSX.utils.encode_col(c))
          }

          // Build rows
          for (let r = rangeAddr.s.r; r <= rangeAddr.e.r; r++) {
            const row: any[] = []
            for (let c = rangeAddr.s.c; c <= rangeAddr.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c })
              const cell = targetSheet[addr]
              row.push(cell ? cell.v : '')
            }
            rows.push(row)
          }

          setExcelPreviewData({
            template,
            type,
            item,
            rangeData: { headers, rows },
            sheetName: targetSheetName
          })
        } catch (rangeErr) {
          console.error('Error parsing snapshot range:', rangeErr, { rangeRef, originalRange: snapshot.range })
          setError('Invalid range format')
          setLoadingExcelPreview(false)
        }
      } else if (type === 'dynamic') {
        // For dynamic mappings, show the area where data is captured from
        const dynamicMapping = item as DynamicFieldMapping
        if (!dynamicMapping) {
          setError('No dynamic mapping provided')
          setLoadingExcelPreview(false)
          return
        }

        // Determine the area to show based on row_match and column_match
        const labelCol = dynamicMapping.row_match?.label_column || 'A'
        const headerRow = (dynamicMapping.column_match?.header_row || 1) - 1 // Convert to 0-indexed
        const startColLetter = dynamicMapping.column_match?.start_column || labelCol
        const fieldPattern = dynamicMapping.field_pattern || '{metric}_{period}'

        const labelColIdx = XLSX.utils.decode_col(labelCol)
        const startColIdx = XLSX.utils.decode_col(startColLetter)

        // Show full sheet for scrolling
        const startCol = 0
        const endCol = Math.min(sheetRange.e.c, 25) // Up to column Z
        const startRow = 0
        const endRow = Math.min(sheetRange.e.r, 100) // Up to 100 rows

        // Get header values for field ID calculation
        const headerValues: Map<number, { raw: string; period: string; year: string; quarter: string }> = new Map()
        for (let c = startColIdx; c <= endCol; c++) {
          const addr = XLSX.utils.encode_cell({ r: headerRow, c })
          const cell = sheet[addr]
          if (cell?.v) {
            const rawHeader = String(cell.v)
            // Clean up header value for period (e.g., "FY 2027" -> "fy2027")
            const period = rawHeader.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
            // Extract year (4-digit number)
            const yearMatch = rawHeader.match(/\b(20\d{2})\b/)
            const year = yearMatch ? yearMatch[1] : ''
            // Extract quarter (Q1, Q2, Q3, Q4)
            const quarterMatch = rawHeader.match(/Q(\d)/i)
            const quarter = quarterMatch ? quarterMatch[1] : ''
            headerValues.set(c, { raw: rawHeader, period, year, quarter })
          }
        }

        // Get row labels for field ID calculation
        const rowLabels: Map<number, string> = new Map()
        for (let r = headerRow + 1; r <= endRow; r++) {
          const addr = XLSX.utils.encode_cell({ r, c: labelColIdx })
          const cell = sheet[addr]
          if (cell?.v) {
            // Clean up row label for field ID (e.g., "Operating Margin" -> "operating_margin")
            const cleanLabel = String(cell.v).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
            rowLabels.set(r, cleanLabel)
          }
        }

        const headers: string[] = []
        for (let c = startCol; c <= endCol; c++) {
          headers.push(XLSX.utils.encode_col(c))
        }

        // Build rows with calculated field IDs for data cells
        const rows: { rowNum: number; cells: { value: any; isMapped: boolean; mappingLabel?: string; fieldId?: string; isDataCell?: boolean }[] }[] = []
        for (let r = startRow; r <= endRow; r++) {
          const rowCells: { value: any; isMapped: boolean; mappingLabel?: string; fieldId?: string; isDataCell?: boolean }[] = []
          for (let c = startCol; c <= endCol; c++) {
            const addr = XLSX.utils.encode_cell({ r, c })
            const cell = sheet[addr]
            const isHeaderRow = r === headerRow
            const isLabelCol = c === labelColIdx
            const isDataCell = r > headerRow && c >= startColIdx && rowLabels.has(r) && headerValues.has(c)

            // Calculate field ID for data cells
            let fieldId: string | undefined
            if (isDataCell) {
              const rowLabel = rowLabels.get(r) || ''
              const colInfo = headerValues.get(c)
              if (colInfo && rowLabel) {
                // Construct field ID: metric + period info
                // e.g., "operating_margin_fy2027" or "eps_q1_2025"
                if (colInfo.quarter) {
                  fieldId = `${rowLabel}_q${colInfo.quarter}_${colInfo.year}`
                } else if (colInfo.year) {
                  fieldId = `${rowLabel}_fy${colInfo.year}`
                } else {
                  fieldId = `${rowLabel}_${colInfo.period}`
                }
              }
            }

            rowCells.push({
              value: cell ? cell.v : '',
              isMapped: isHeaderRow || isLabelCol,
              isDataCell,
              fieldId,
              mappingLabel: isHeaderRow && isLabelCol ? 'Anchor' : isHeaderRow ? 'Header' : isLabelCol ? 'Label' : undefined
            })
          }
          rows.push({ rowNum: r + 1, cells: rowCells })
        }

        setExcelPreviewData({
          template,
          type,
          item,
          sheetName,
          spreadsheetData: { headers, rows, startRow, startCol }
        })
      }
    } catch (err) {
      console.error('Error loading Excel preview:', err)
      setError('Failed to load Excel preview')
    } finally {
      setLoadingExcelPreview(false)
    }
  }

  // Other templates (not mine, not firm-wide)
  const otherTemplates = templates.filter(
    t => t.created_by !== user?.id && !t.is_firm_template
  )

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </Card>
    )
  }

  return (
    <Card padding="sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        {showForm ? (
          <>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h3 className="text-lg font-medium text-gray-900">
                  {editingId ? 'Edit Template' : 'Create Template'}
                </h3>
                <p className="text-sm text-gray-500">
                  {editingId ? 'Modify your template settings' : 'Configure how Excel files map to Tesseract data'}
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <h3 className="text-lg font-medium text-gray-900">Excel Extraction Templates</h3>
              <p className="text-sm text-gray-500 mt-1">
                Configure how Excel files map to Tesseract data. Define cell references for price targets, estimates, and more.
              </p>
            </div>
            <Button onClick={() => setShowForm(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" />
              New Template
            </Button>
          </>
        )}
      </div>

      {/* Create/Edit Form View */}
      {showForm ? (
        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'TEXTAREA') {
              e.stopPropagation()
              // Don't prevent default - let textarea handle the Enter naturally
            }
            // Prevent form submission on Enter except for textareas
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA' && (e.target as HTMLElement).tagName !== 'BUTTON') {
              e.preventDefault()
            }
          }}
          className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200"
        >
          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Name *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value })
                      if (error === 'Template name is required' && e.target.value.trim()) {
                        setError(null)
                      }
                    }}
                    placeholder="e.g. Standard Template"
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent ${
                      error === 'Template name is required'
                        ? 'border-red-400 bg-red-50/50 pr-10'
                        : 'border-gray-300'
                    }`}
                  />
                  {error === 'Template name is required' && (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    </div>
                  )}
                </div>
                {error === 'Template name is required' && (
                  <p className="mt-1 text-xs text-red-600">Name is required</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of this template"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Hidden file input for spreadsheet loading */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Field Mappings */}
            <FieldMappingEditor
              mappings={formData.fieldMappings}
              onChange={(mappings) => setFormData({ ...formData, fieldMappings: mappings })}
              dynamicMappings={formData.dynamicMappings}
              onDynamicMappingsChange={(mappings) => setFormData({ ...formData, dynamicMappings: mappings })}
              workbook={workbook}
              fileName={fileName}
              onLoadFile={handleLoadFile}
              onFileDrop={handleFileDrop}
              selectingForIndex={selectingForIndex}
              onSetSelectingIndex={setSelectingForIndex}
              detectedFields={detectedFields}
              onDetectedFieldsChange={setDetectedFields}
              detectedDynamicMappings={detectedDynamicMappings.filter(d => {
                // Filter out detected mappings that have the same name or pattern as existing accepted ones
                const existingNames = new Set(formData.dynamicMappings.map(dm => dm.name.toLowerCase()))
                const existingPatterns = new Set(formData.dynamicMappings.map(dm => dm.field_pattern.toLowerCase()))
                return !existingNames.has(d.name.toLowerCase()) && !existingPatterns.has(d.field_pattern.toLowerCase())
              })}
              acceptedDynamicIds={acceptedDynamicIds}
              rejectedDynamicIds={rejectedDynamicIds}
              onAcceptDynamic={handleAcceptDynamic}
              onRejectDynamic={handleRejectDynamic}
            />

            {/* Snapshot Ranges */}
            <SnapshotRangeEditor
              ranges={formData.snapshotRanges}
              onChange={(ranges) => setFormData({ ...formData, snapshotRanges: ranges })}
              workbook={workbook}
            />

            {/* Detection Rules */}
            <DetectionRulesEditor
              rules={formData.detectionRules}
              onChange={(rules) => setFormData({ ...formData, detectionRules: rules })}
            />

            {/* Sharing - Compact */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSharingSection(!showSharingSection)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-gray-500" />
                  <span className="font-medium text-gray-900">Sharing</span>
                  {(formData.shareWithOrg || formData.shareEntries.length > 0) && (
                    <span className="text-xs px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded">
                      {formData.shareWithOrg ? 'Org' : ''}{formData.shareWithOrg && formData.shareEntries.length > 0 ? ' + ' : ''}{formData.shareEntries.length > 0 ? formData.shareEntries.length : ''}
                    </span>
                  )}
                </div>
                {showSharingSection ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {showSharingSection && (
                <div className="px-3 pb-3 pt-1 space-y-3">
                  {/* Org Groups Multiselect */}
                  {orgNodes.length > 0 && (
                    <div>
                      <label className="block text-xs text-gray-700 mb-1">
                        <span className="font-medium">Share with groups</span> <span className="text-gray-400">— select divisions, departments, teams, or portfolios</span>
                      </label>

                      <div className="relative">
                        <button
                          type="button"
                          data-org-dropdown-trigger
                          onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 text-sm border border-gray-300 rounded bg-white hover:border-gray-400"
                        >
                          <span className="text-gray-500 text-xs">
                            {formData.shareEntries.filter(e => e.type !== 'user').length > 0
                              ? 'Add more groups...'
                              : 'Click to select groups...'}
                          </span>
                          <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', showOrgDropdown && 'rotate-180')} />
                        </button>

                        {showOrgDropdown && createPortal(
                          <div
                            className="fixed inset-0 z-[60]"
                            onClick={() => setShowOrgDropdown(false)}
                          >
                            <div
                              className="absolute bg-white border border-gray-200 rounded-lg shadow-xl w-64 overflow-hidden"
                              style={{
                                top: Math.min(
                                  (document.querySelector('[data-org-dropdown-trigger]') as HTMLElement)?.getBoundingClientRect().bottom + 4 || 200,
                                  window.innerHeight - 320
                                ),
                                left: (document.querySelector('[data-org-dropdown-trigger]') as HTMLElement)?.getBoundingClientRect().left || 100,
                              }}
                              onClick={e => e.stopPropagation()}
                            >
                              <div className="overflow-y-auto max-h-72">
                                {/* Entire Organization option */}
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const isSelected = formData.shareWithOrg
                                      setFormData({ ...formData, shareWithOrg: !isSelected })
                                    }}
                                    className={clsx('w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 border-b border-gray-100', formData.shareWithOrg && 'bg-primary-50')}
                                  >
                                    <div className={clsx('w-4 h-4 border rounded flex items-center justify-center shrink-0', formData.shareWithOrg ? 'bg-primary-600 border-primary-600' : 'border-gray-300')}>
                                      {formData.shareWithOrg && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                                    <span className="font-medium">Entire Organization</span>
                                  </button>
                                </div>
                                {divisions.length > 0 && (
                                  <div>
                                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-100 sticky top-0 border-b border-gray-200 flex items-center gap-2">
                                      <Building2 className="w-3.5 h-3.5" />
                                      Divisions
                                    </div>
                                    {divisions.map(node => {
                                      const isSelected = formData.shareEntries.some(s => s.id === node.id)
                                      return (
                                        <button
                                          key={node.id}
                                          type="button"
                                          onClick={() => {
                                            if (isSelected) {
                                              setFormData({ ...formData, shareEntries: formData.shareEntries.filter(s => s.id !== node.id) })
                                            } else {
                                              setFormData({ ...formData, shareEntries: [...formData.shareEntries, { id: node.id, type: 'division', name: node.name, permission: 'view' }] })
                                            }
                                          }}
                                          className={clsx('w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50', isSelected && 'bg-primary-50')}
                                        >
                                          <div className={clsx('w-4 h-4 border rounded flex items-center justify-center shrink-0', isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300')}>
                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                          </div>
                                          <span className="truncate">{node.name}</span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                                {departments.length > 0 && (
                                  <div>
                                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-100 sticky top-0 border-b border-gray-200 flex items-center gap-2">
                                      <Users className="w-3.5 h-3.5" />
                                      Departments
                                    </div>
                                    {departments.map(node => {
                                      const isSelected = formData.shareEntries.some(s => s.id === node.id)
                                      return (
                                        <button
                                          key={node.id}
                                          type="button"
                                          onClick={() => {
                                            if (isSelected) {
                                              setFormData({ ...formData, shareEntries: formData.shareEntries.filter(s => s.id !== node.id) })
                                            } else {
                                              setFormData({ ...formData, shareEntries: [...formData.shareEntries, { id: node.id, type: 'department', name: node.name, permission: 'view' }] })
                                            }
                                          }}
                                          className={clsx('w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50', isSelected && 'bg-primary-50')}
                                        >
                                          <div className={clsx('w-4 h-4 border rounded flex items-center justify-center shrink-0', isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300')}>
                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                          </div>
                                          <span className="truncate">{node.name}</span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                                {teams.length > 0 && (
                                  <div>
                                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-100 sticky top-0 border-b border-gray-200 flex items-center gap-2">
                                      <Users className="w-3.5 h-3.5" />
                                      Teams
                                    </div>
                                    {teams.map(node => {
                                      const isSelected = formData.shareEntries.some(s => s.id === node.id)
                                      return (
                                        <button
                                          key={node.id}
                                          type="button"
                                          onClick={() => {
                                            if (isSelected) {
                                              setFormData({ ...formData, shareEntries: formData.shareEntries.filter(s => s.id !== node.id) })
                                            } else {
                                              setFormData({ ...formData, shareEntries: [...formData.shareEntries, { id: node.id, type: 'team', name: node.name, permission: 'view' }] })
                                            }
                                          }}
                                          className={clsx('w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50', isSelected && 'bg-primary-50')}
                                        >
                                          <div className={clsx('w-4 h-4 border rounded flex items-center justify-center shrink-0', isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300')}>
                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                          </div>
                                          <span className="truncate">{node.name}</span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                                {portfolios.length > 0 && (
                                  <div>
                                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-100 sticky top-0 border-b border-gray-200 flex items-center gap-2">
                                      <FileSpreadsheet className="w-3.5 h-3.5" />
                                      Portfolios
                                    </div>
                                    {portfolios.map(node => {
                                      const isSelected = formData.shareEntries.some(s => s.id === node.id)
                                      return (
                                        <button
                                          key={node.id}
                                          type="button"
                                          onClick={() => {
                                            if (isSelected) {
                                              setFormData({ ...formData, shareEntries: formData.shareEntries.filter(s => s.id !== node.id) })
                                            } else {
                                              setFormData({ ...formData, shareEntries: [...formData.shareEntries, { id: node.id, type: 'portfolio', name: node.name, permission: 'view' }] })
                                            }
                                          }}
                                          className={clsx('w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50', isSelected && 'bg-primary-50')}
                                        >
                                          <div className={clsx('w-4 h-4 border rounded flex items-center justify-center shrink-0', isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300')}>
                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                          </div>
                                          <span className="truncate">{node.name}</span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                                {orgNodes.length === 0 && (
                                  <div className="px-3 py-4 text-sm text-gray-500 text-center">
                                    No groups available
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>,
                          document.body
                        )}
                      </div>
                    </div>
                  )}

                  {/* User Search */}
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">
                      <span className="font-medium">Share with people</span> <span className="text-gray-400">— search by name or email</span>
                    </label>
                    <div className="relative z-[62]">
                      <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        data-user-search-input
                        value={userSearchQuery}
                        onChange={(e) => setUserSearchQuery(e.target.value)}
                        placeholder="Type to search..."
                        className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 rounded bg-white"
                      />
                      {userSearchQuery.length >= 2 && createPortal(
                        <>
                          <div
                            className="fixed inset-0 z-[60]"
                            onClick={() => setUserSearchQuery('')}
                          />
                          <div
                            className="fixed bg-white border border-gray-200 rounded shadow-lg w-64 max-h-48 overflow-y-auto z-[61]"
                            style={{
                              top: Math.min(
                                (document.querySelector('[data-user-search-input]') as HTMLElement)?.getBoundingClientRect().bottom + 4 || 200,
                                window.innerHeight - 200
                              ),
                              left: (document.querySelector('[data-user-search-input]') as HTMLElement)?.getBoundingClientRect().left || 100,
                            }}
                          >
                            {isSearchingUsers ? (
                              <div className="flex items-center justify-center py-3">
                                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                              </div>
                            ) : searchResults.filter(u => !formData.shareEntries.some(s => s.id === u.id)).length === 0 ? (
                              <p className="text-xs text-gray-500 py-2 px-3">No users found</p>
                            ) : (
                              searchResults.filter(u => !formData.shareEntries.some(s => s.id === u.id)).map(u => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => {
                                    setFormData({
                                      ...formData,
                                      shareEntries: [...formData.shareEntries, {
                                        id: u.id, type: 'user',
                                        name: u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email,
                                        email: u.email, permission: 'view'
                                      }]
                                    })
                                    setUserSearchQuery('')
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-gray-50 text-xs"
                                >
                                  <div className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center text-xs font-medium text-primary-700 shrink-0">
                                    {u.first_name?.[0] || u.email[0].toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium">{u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email}</div>
                                    {u.first_name && <div className="truncate text-gray-400">{u.email}</div>}
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </>,
                        document.body
                      )}
                    </div>
                  </div>

                  {/* Selected Items - Compact chips */}
                  {(formData.shareWithOrg || formData.shareEntries.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
                      {formData.shareWithOrg && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border bg-blue-100 text-blue-700 border-blue-200">
                          <Building2 className="w-3 h-3" />
                          Entire Org
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, shareWithOrg: false })}
                            className="hover:bg-black/10 rounded-full"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}
                      {formData.shareEntries.map((entry) => {
                        const colors: Record<ShareEntryType, string> = {
                          user: 'bg-purple-100 text-purple-700 border-purple-200',
                          division: 'bg-blue-100 text-blue-700 border-blue-200',
                          department: 'bg-green-100 text-green-700 border-green-200',
                          team: 'bg-orange-100 text-orange-700 border-orange-200',
                          portfolio: 'bg-pink-100 text-pink-700 border-pink-200'
                        }
                        return (
                          <span key={entry.id} className={clsx('inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border', colors[entry.type])}>
                            {entry.name}
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, shareEntries: formData.shareEntries.filter(s => s.id !== entry.id) })}
                              className="hover:bg-black/10 rounded-full"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {/* Link to full modal when editing */}
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        const template = templates.find(t => t.id === editingId)
                        if (template) setSharingTemplate(template)
                      }}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      Manage all collaborators →
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-2 pt-2">
              {error && error !== 'Template name is required' ? (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createTemplate.isPending || updateTemplate.isPending}
                >
                  {(createTemplate.isPending || updateTemplate.isPending) && (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  )}
                  {editingId ? 'Update' : 'Create'} Template
                </Button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <>
          {/* Search */}
          {(myTemplates.length > 0 || sharedTemplates.length > 0) && (
            <div className="mb-4">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* My Templates */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">My Templates ({myTemplates.length})</h4>

            {myTemplates.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                No Excel templates yet. Create one to define how your Excel models map to Tesseract.
              </p>
            ) : (
              <div className="space-y-1.5">
                {myTemplates
                  .filter(t => !pendingDeletes.has(t.id))
                  .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.description?.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(template => (
                    <ModelTemplateCard
                      key={template.id}
                      template={template}
                      onEdit={() => startEdit(template)}
                      onDelete={() => setDeleteConfirm(template.id)}
                      onDuplicate={() => handleDuplicate(template.id)}
                      onShare={() => setSharingTemplate(template)}
                      onUploadBaseTemplate={(file) => handleUploadBaseTemplate(template.id, file)}
                      onDownloadBaseTemplate={() => handleDownloadBaseTemplate(template)}
                      onDeleteBaseTemplate={() => handleDeleteBaseTemplate(template.id)}
                      onPreview={() => setPreviewTemplate(template)}
                      onExcelPreview={(type, item) => handleExcelPreview(template, type, item)}
                      isOwner={true}
                      collaborations={templateCollaborations.filter(c => c.template_id === template.id)}
                      isUploadingBase={uploadingBaseForTemplate === template.id}
                      loadingExcelPreview={loadingExcelPreview}
                    />
                  ))}
              </div>
            )}
          </div>

          {/* Shared With Me */}
          {sharedTemplates.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
                <Share2 className="w-3.5 h-3.5 text-blue-500" />
                Shared With Me ({sharedTemplates.length})
              </h4>
              <div className="space-y-1.5">
                {sharedTemplates
                  .filter(t => !pendingDeletes.has(t.id))
                  .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.description?.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(template => (
                    <ModelTemplateCard
                      key={template.id}
                      template={template}
                      onDuplicate={() => handleDuplicate(template.id)}
                      onPreview={() => setPreviewTemplate(template)}
                      onExcelPreview={(type, item) => handleExcelPreview(template, type, item)}
                      onDownloadBaseTemplate={template.base_template_path ? () => handleDownloadBaseTemplate(template) : undefined}
                      isOwner={false}
                      loadingExcelPreview={loadingExcelPreview}
                    />
                  ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Sharing Modal */}
      {sharingTemplate && (
        <ModelTemplateSharingModal
          template={sharingTemplate}
          onClose={() => setSharingTemplate(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-red-100 rounded-full">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Delete Template</h3>
                  <p className="text-sm text-gray-500">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-gray-700 mb-2">
                Are you sure you want to permanently delete{' '}
                <span className="font-medium text-gray-900">
                  "{templates.find(t => t.id === deleteConfirm)?.name || 'this template'}"
                </span>?
              </p>
              <p className="text-sm text-gray-500">
                All field mappings, snapshot ranges, and sharing settings will be permanently removed.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Delete Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{previewTemplate.name}</h3>
                {previewTemplate.description && (
                  <p className="text-sm text-gray-500 mt-0.5">{previewTemplate.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Snapshot Ranges */}
              {previewTemplate.snapshot_ranges && previewTemplate.snapshot_ranges.length > 0 ? (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Grid3X3 className="w-4 h-4 text-blue-600" />
                    Snapshot Ranges ({previewTemplate.snapshot_ranges.length})
                  </h4>
                  <div className="grid gap-3">
                    {previewTemplate.snapshot_ranges.map((snapshot, i) => (
                      <div key={i} className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-blue-900">{snapshot.name || `Snapshot ${i + 1}`}</span>
                          <code className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">{snapshot.range}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-gray-500">
                  <Grid3X3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No snapshot ranges defined for this template</p>
                </div>
              )}

              {/* Fixed Field Mappings */}
              {previewTemplate.field_mappings?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-gray-600" />
                    Fixed Field Mappings ({previewTemplate.field_mappings.length})
                  </h4>
                  <div className="grid gap-2 max-h-48 overflow-y-auto">
                    {previewTemplate.field_mappings.map((mapping, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-gray-900 truncate">{mapping.label || mapping.field}</span>
                          {mapping.format && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded shrink-0">
                              {mapping.format}
                            </span>
                          )}
                        </div>
                        <code className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded shrink-0">{mapping.cell}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dynamic Field Mappings */}
              {previewTemplate.dynamic_mappings?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    Dynamic Field Mappings ({previewTemplate.dynamic_mappings.length})
                  </h4>
                  <div className="grid gap-2 max-h-48 overflow-y-auto">
                    {previewTemplate.dynamic_mappings.map((mapping, i) => (
                      <div key={i} className="p-2 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-purple-900">{mapping.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                            {mapping.direction === 'horizontal' ? 'Horizontal' : 'Vertical'}
                          </span>
                        </div>
                        <div className="text-xs text-purple-700">
                          Anchor: <code className="px-1 bg-purple-100 rounded">{mapping.anchorCell}</code>
                          {mapping.headerPattern && <span className="ml-2">Pattern: {mapping.headerPattern}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Base Template */}
              {previewTemplate.base_template_path && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-green-600" />
                    Base Template
                  </h4>
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-5 h-5 text-green-600" />
                      <div>
                        <div className="font-medium text-green-900">{previewTemplate.base_template_filename}</div>
                        <div className="text-xs text-green-600">
                          {previewTemplate.base_template_size ? `${Math.round(previewTemplate.base_template_size / 1024)} KB` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownloadBaseTemplate(previewTemplate)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-white border border-green-300 rounded hover:bg-green-50"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                  </div>
                </div>
              )}

              {/* Detection Rules */}
              {(previewTemplate.detection_rules?.filename_patterns?.length > 0 || previewTemplate.detection_rules?.sheet_names?.length > 0) && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-gray-600" />
                    Detection Rules
                  </h4>
                  <div className="text-sm text-gray-600 space-y-2">
                    {previewTemplate.detection_rules.filename_patterns?.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-gray-500 shrink-0">Filename patterns:</span>
                        <div className="flex flex-wrap gap-1">
                          {previewTemplate.detection_rules.filename_patterns.map((p, i) => (
                            <code key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{p}</code>
                          ))}
                        </div>
                      </div>
                    )}
                    {previewTemplate.detection_rules.sheet_names?.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-gray-500 shrink-0">Required sheets:</span>
                        <div className="flex flex-wrap gap-1">
                          {previewTemplate.detection_rules.sheet_names.map((s, i) => (
                            <code key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{s}</code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excel Data Preview Modal */}
      {excelPreviewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-3">
                {excelPreviewData.type === 'field' && (
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Target className="w-5 h-5 text-green-600" />
                  </div>
                )}
                {excelPreviewData.type === 'snapshot' && (
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Grid3X3 className="w-5 h-5 text-blue-600" />
                  </div>
                )}
                {excelPreviewData.type === 'dynamic' && (
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {excelPreviewData.type === 'field' && (
                      <>
                        Field Mappings Preview
                        <span className="ml-2 text-sm font-normal text-gray-500">
                          {excelPreviewData.allMappings?.length || 0} fields mapped
                        </span>
                      </>
                    )}
                    {excelPreviewData.type === 'snapshot' && excelPreviewData.item && (
                      <>
                        Snapshot Preview
                        <span className="ml-2 text-sm font-normal text-gray-500">
                          {(excelPreviewData.item as SnapshotRange).name || 'Unnamed'} • {(excelPreviewData.item as SnapshotRange).range}
                        </span>
                      </>
                    )}
                    {excelPreviewData.type === 'dynamic' && excelPreviewData.item && (
                      <>
                        Dynamic Mapping Preview
                        <span className="ml-2 text-sm font-normal text-gray-500">
                          {(excelPreviewData.item as DynamicFieldMapping).name} • Col {(excelPreviewData.item as DynamicFieldMapping).row_match?.label_column || 'A'}, Row {(excelPreviewData.item as DynamicFieldMapping).column_match?.header_row || 1}
                        </span>
                      </>
                    )}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Sheet: {excelPreviewData.sheetName} • From: {excelPreviewData.template.base_template_filename}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setExcelPreviewData(null); setSelectedCellFieldId(null) }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Excel Preview Content */}
            <div className="flex-1 overflow-auto p-4 min-h-0">
              {/* Field Mappings - Show spreadsheet with all mappings highlighted */}
              {excelPreviewData.type === 'field' && excelPreviewData.spreadsheetData && (
                <div className="space-y-3">
                  {/* Sheet Tabs - show if multiple sheets have mappings */}
                  {excelPreviewData.sheetPreviews && excelPreviewData.sheetPreviews.length > 1 && (
                    <div className="flex items-center gap-1 border-b border-gray-200 pb-2">
                      {excelPreviewData.sheetPreviews.map((preview) => (
                        <button
                          key={preview.sheetName}
                          type="button"
                          onClick={() => {
                            setSelectedPreviewSheet(preview.sheetName)
                            setExcelPreviewData({
                              ...excelPreviewData,
                              sheetName: preview.sheetName,
                              spreadsheetData: {
                                headers: preview.headers,
                                rows: preview.rows,
                                startRow: preview.startRow,
                                startCol: preview.startCol
                              }
                            })
                          }}
                          className={clsx(
                            "px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 transition-colors",
                            (selectedPreviewSheet || excelPreviewData.sheetName) === preview.sheetName
                              ? "bg-white text-green-700 border-green-500"
                              : "bg-gray-50 text-gray-600 border-transparent hover:bg-gray-100"
                          )}
                        >
                          {preview.sheetName}
                          <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-green-100 text-green-700 rounded-full">
                            {preview.mappingCount}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Legend */}
                  <div className="flex items-center gap-4 px-2 flex-shrink-0">
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-4 h-4 bg-green-200 border-2 border-green-500 rounded" />
                      <span className="text-gray-600">Mapped Field</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      Hover over highlighted cells to see field IDs
                    </div>
                  </div>

                  {/* Spreadsheet Table */}
                  <div className="overflow-auto border border-gray-200 rounded-lg max-h-[50vh]">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-20">
                        <tr>
                          <th className="sticky left-0 z-30 bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-500 border-r border-b border-gray-200 w-12">

                          </th>
                          {excelPreviewData.spreadsheetData.headers.map((header, i) => (
                            <th
                              key={i}
                              className="px-2 py-1.5 text-xs font-medium text-gray-500 border-b border-gray-200 bg-gray-100 min-w-[80px] text-center"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {excelPreviewData.spreadsheetData.rows.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            <td className="sticky left-0 z-10 bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-500 border-r border-gray-200 text-center">
                              {row.rowNum}
                            </td>
                            {row.cells.map((cell, cellIdx) => (
                              <td
                                key={cellIdx}
                                title={cell.isMapped ? `${cell.fieldId}${cell.mappingLabel && cell.mappingLabel !== cell.fieldId ? ` (${cell.mappingLabel})` : ''}` : undefined}
                                className={clsx(
                                  "px-2 py-1.5 border-b border-gray-100 transition-colors whitespace-nowrap",
                                  cell.isMapped
                                    ? "bg-green-100 border-2 border-green-400 font-medium text-green-900 cursor-help relative"
                                    : "bg-white text-gray-700"
                                )}
                              >
                                {cell.isMapped && (
                                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
                                )}
                                {cell.value !== '' && cell.value !== null && cell.value !== undefined
                                  ? String(cell.value).length > 25
                                    ? String(cell.value).slice(0, 25) + '...'
                                    : String(cell.value)
                                  : ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Field Mappings List */}
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <h4 className="text-xs font-medium text-gray-500 mb-2">Mapped Tesseract Fields</h4>
                    <div className="flex flex-wrap gap-2">
                      {excelPreviewData.allMappings?.map((m, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 text-xs px-2 py-1 bg-green-100 text-green-800 rounded border border-green-200"
                          title={m.label && m.label !== m.field ? m.label : undefined}
                        >
                          <code className="font-mono text-green-700 bg-green-50 px-1 rounded">{m.field}</code>
                          <span className="text-green-400">→</span>
                          <span className="text-green-700">{m.cell}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Snapshot Preview - Show as image-like preview */}
              {excelPreviewData.type === 'snapshot' && excelPreviewData.rangeData && (
                <div className="space-y-4">
                  {/* Snapshot frame */}
                  <div className="border-4 border-blue-200 rounded-lg overflow-hidden shadow-lg bg-white">
                    <div className="bg-blue-50 px-3 py-2 border-b border-blue-200 flex items-center gap-2">
                      <Grid3X3 className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-800">
                        {excelPreviewData.item && (excelPreviewData.item as SnapshotRange).name || 'Snapshot'}
                      </span>
                      <span className="text-xs text-blue-600 ml-auto">
                        {excelPreviewData.item && (excelPreviewData.item as SnapshotRange).range}
                      </span>
                    </div>
                    <div ref={snapshotPreviewRef} className="p-3 overflow-auto max-h-[60vh] bg-white">
                      <table className="min-w-full">
                        <tbody>
                          {excelPreviewData.rangeData.rows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                              {row.map((cell, cellIdx) => (
                                <td
                                  key={cellIdx}
                                  className="px-2 py-1 text-sm bg-white text-gray-900 min-w-[50px] whitespace-nowrap"
                                >
                                  {cell !== '' && cell !== null && cell !== undefined ? String(cell) : ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 text-center">
                    This is how the snapshot will appear when captured from the spreadsheet
                  </p>
                </div>
              )}

              {/* Dynamic Mapping Preview */}
              {excelPreviewData.type === 'dynamic' && excelPreviewData.spreadsheetData && (
                <div className="space-y-3">
                  {/* Legend and Selected Field */}
                  <div className="flex flex-wrap items-center justify-between gap-4 px-2">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-4 h-4 bg-purple-100 border border-purple-300 rounded-sm" />
                        <span className="text-gray-600">Header/Label</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-4 h-4 bg-green-100 border border-green-300 rounded-sm" />
                        <span className="text-gray-600">Data Cell</span>
                      </div>
                    </div>
                    {selectedCellFieldId && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 border border-green-300 rounded-lg">
                        <span className="text-xs text-green-700">Field ID:</span>
                        <code className="text-sm font-mono font-medium text-green-800">{selectedCellFieldId}</code>
                        <button
                          type="button"
                          onClick={() => setSelectedCellFieldId(null)}
                          className="ml-1 text-green-600 hover:text-green-800"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Spreadsheet Table */}
                  <div className="overflow-auto border border-gray-200 rounded-lg max-h-[50vh]">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-20">
                        <tr>
                          <th className="sticky left-0 z-30 bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-500 border-r border-b border-gray-200 w-12">

                          </th>
                          {excelPreviewData.spreadsheetData.headers.map((header, i) => (
                            <th
                              key={i}
                              className="px-2 py-1.5 text-xs font-medium text-gray-500 border-b border-gray-200 bg-gray-100 min-w-[80px] text-center"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {excelPreviewData.spreadsheetData.rows.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            <td className="sticky left-0 z-10 bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-500 border-r border-gray-200 text-center">
                              {row.rowNum}
                            </td>
                            {row.cells.map((cell, cellIdx) => {
                              const isDataCell = (cell as any).isDataCell
                              const fieldId = (cell as any).fieldId
                              return (
                                <td
                                  key={cellIdx}
                                  onClick={() => {
                                    if (isDataCell && fieldId) {
                                      setSelectedCellFieldId(fieldId)
                                    }
                                  }}
                                  className={clsx(
                                    "px-2 py-1.5 border-b border-gray-100 whitespace-nowrap",
                                    cell.isMapped
                                      ? "bg-purple-100 text-purple-800 font-medium"
                                      : isDataCell
                                      ? "bg-green-50 text-green-800 cursor-pointer hover:bg-green-200 hover:ring-2 hover:ring-green-400"
                                      : "bg-white text-gray-700"
                                  )}
                                >
                                  {cell.value !== '' && cell.value !== null && cell.value !== undefined
                                    ? String(cell.value).length > 15
                                      ? String(cell.value).slice(0, 15) + '...'
                                      : String(cell.value)
                                    : ''}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Info */}
                  <p className="text-xs text-gray-500 text-center">
                    Click on green data cells to see the calculated field ID
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200">
              <button
                type="button"
                onClick={() => { setExcelPreviewData(null); setSelectedCellFieldId(null) }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay for Excel preview */}
      {loadingExcelPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl p-6 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
            <span className="text-gray-700">Loading Excel preview...</span>
          </div>
        </div>
      )}
    </Card>
  )
}
