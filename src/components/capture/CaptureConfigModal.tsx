import React, { useState, useEffect, useRef } from 'react'
import {
  X, Search, RefreshCw, Clock, TrendingUp, Briefcase, Building2,
  FileText, ListChecks, GitBranch, FolderKanban, Target, CheckSquare,
  ChevronRight, Image
} from 'lucide-react'
import { clsx } from 'clsx'
import { useCaptureMode, CapturedElement } from '../../contexts/CaptureContext'
import { useEntitySearch } from '../../hooks/useEntitySearch'
import type { CaptureEntityType, CaptureMode } from '../../types/capture'

// Entity type configuration
const ENTITY_TYPES: Array<{
  type: CaptureEntityType
  icon: React.ComponentType<{ className?: string }>
  label: string
  color: string
}> = [
  { type: 'asset', icon: TrendingUp, label: 'Asset', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { type: 'portfolio', icon: Briefcase, label: 'Portfolio', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { type: 'theme', icon: Building2, label: 'Theme', color: 'text-purple-600 bg-purple-50 border-purple-200' },
  { type: 'note', icon: FileText, label: 'Note', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { type: 'list', icon: ListChecks, label: 'List', color: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
  { type: 'workflow', icon: GitBranch, label: 'Workflow', color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  { type: 'project', icon: FolderKanban, label: 'Project', color: 'text-pink-600 bg-pink-50 border-pink-200' },
  { type: 'price_target', icon: Target, label: 'Price Target', color: 'text-red-600 bg-red-50 border-red-200' },
  { type: 'workflow_item', icon: CheckSquare, label: 'Checklist Item', color: 'text-slate-600 bg-slate-50 border-slate-200' }
]

type Step = 'type' | 'search' | 'mode'

export function CaptureConfigModal() {
  const { capturedElement, clearCapturedElement, completeCapture, cancelCaptureMode } = useCaptureMode()

  const [step, setStep] = useState<Step>('type')
  const [selectedType, setSelectedType] = useState<CaptureEntityType | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEntity, setSelectedEntity] = useState<{ id: string; title: string } | null>(null)
  const [selectedMode, setSelectedMode] = useState<CaptureMode>('live')

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Use entity search
  const { results, isLoading } = useEntitySearch({
    query: searchQuery,
    types: selectedType ? [selectedType] : [],
    limit: 8,
    enabled: step === 'search' && searchQuery.length > 0 && !!selectedType
  })

  // Reset state when modal opens
  useEffect(() => {
    if (capturedElement) {
      // If entity was auto-detected, pre-fill
      if (capturedElement.detectedType && capturedElement.detectedId) {
        setSelectedType(capturedElement.detectedType)
        setSelectedEntity({
          id: capturedElement.detectedId,
          title: capturedElement.detectedTitle || 'Unknown'
        })
        setStep('mode')
      } else if (capturedElement.detectedType) {
        setSelectedType(capturedElement.detectedType)
        setStep('search')
      } else {
        setStep('type')
      }
      setSearchQuery('')
      setSelectedMode('live')
    }
  }, [capturedElement])

  // Focus search input when entering search step
  useEffect(() => {
    if (step === 'search' && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [step])

  // Handle type selection
  const handleTypeSelect = (type: CaptureEntityType) => {
    setSelectedType(type)
    setStep('search')
  }

  // Handle entity selection from search
  const handleEntitySelect = (entity: { id: string; title: string }) => {
    setSelectedEntity(entity)
    setStep('mode')
  }

  // Handle mode selection and complete
  const handleModeSelect = (mode: CaptureMode) => {
    if (!selectedType || !selectedEntity) return

    completeCapture(
      selectedType,
      selectedEntity.id,
      selectedEntity.title,
      mode
    )
  }

  // Handle close
  const handleClose = () => {
    clearCapturedElement()
  }

  // Handle cancel (back to capture mode)
  const handleCancel = () => {
    clearCapturedElement()
    // Stay in capture mode for another try
  }

  // Handle full cancel (exit capture mode entirely)
  const handleExitCaptureMode = () => {
    cancelCaptureMode()
  }

  // Go back to previous step
  const handleBack = () => {
    if (step === 'mode') {
      setSelectedEntity(null)
      setStep('search')
    } else if (step === 'search') {
      setSelectedType(null)
      setStep('type')
    }
  }

  if (!capturedElement) return null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step !== 'type' && (
              <button
                onClick={handleBack}
                className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600"
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
              </button>
            )}
            <h3 className="font-semibold text-gray-900">
              {step === 'type' && 'What did you capture?'}
              {step === 'search' && `Find ${selectedType}`}
              {step === 'mode' && 'Choose capture mode'}
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Preview of captured element */}
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Image className="h-5 w-5 text-gray-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-700 truncate">
                {capturedElement.detectedTitle || 'Selected element'}
              </div>
              <div className="text-xs text-gray-500">
                {capturedElement.detectedType
                  ? `Detected: ${ENTITY_TYPES.find(t => t.type === capturedElement.detectedType)?.label}`
                  : 'Select the type below'}
              </div>
            </div>
          </div>
        </div>

        {/* Content based on step */}
        <div className="p-4">
          {/* Step 1: Select entity type */}
          {step === 'type' && (
            <div className="grid grid-cols-3 gap-2">
              {ENTITY_TYPES.map(({ type, icon: Icon, label, color }) => (
                <button
                  key={type}
                  onClick={() => handleTypeSelect(type)}
                  className={clsx(
                    'flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:shadow-sm',
                    'hover:border-primary-300 hover:bg-primary-50',
                    color.split(' ')[2] // border color
                  )}
                >
                  <div className={clsx('p-2 rounded-lg', color.split(' ').slice(0, 2).join(' '))}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-gray-700">{label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Search for specific entity */}
          {step === 'search' && selectedType && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search for ${ENTITY_TYPES.find(t => t.type === selectedType)?.label}...`}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>

              <div className="max-h-64 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 text-gray-500">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  </div>
                ) : results.length > 0 ? (
                  <div className="space-y-1">
                    {results.map((result) => {
                      const config = ENTITY_TYPES.find(t => t.type === result.type)
                      const Icon = config?.icon || FileText

                      return (
                        <button
                          key={result.id}
                          onClick={() => handleEntitySelect({ id: result.id, title: result.title })}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className={clsx('p-1.5 rounded-md', config?.color.split(' ').slice(0, 2).join(' '))}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">{result.title}</div>
                            {result.subtitle && (
                              <div className="text-xs text-gray-500 truncate">{result.subtitle}</div>
                            )}
                          </div>
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </button>
                      )
                    })}
                  </div>
                ) : searchQuery.length > 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    No results found
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    Type to search
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Select capture mode */}
          {step === 'mode' && selectedEntity && (
            <div className="space-y-3">
              <div className="text-center mb-4">
                <div className="text-sm text-gray-600 mb-1">Capturing</div>
                <div className="font-semibold text-gray-900">{selectedEntity.title}</div>
              </div>

              <button
                onClick={() => handleModeSelect('live')}
                className="w-full flex items-center gap-4 p-4 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-all group"
              >
                <div className="p-3 rounded-lg bg-green-100 text-green-600 group-hover:bg-green-200">
                  <RefreshCw className="h-5 w-5" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-semibold text-gray-900">Live Reference</div>
                  <div className="text-sm text-gray-500">
                    Always shows current state. Updates automatically when the source changes.
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleModeSelect('static')}
                className="w-full flex items-center gap-4 p-4 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-all group"
              >
                <div className="p-3 rounded-lg bg-amber-100 text-amber-600 group-hover:bg-amber-200">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-semibold text-gray-900">Snapshot</div>
                  <div className="text-sm text-gray-500">
                    Captures current state as a citation. Shows differences if source changes.
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={handleCancel}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Try another element
          </button>
          <button
            onClick={handleExitCaptureMode}
            className="text-sm text-red-500 hover:text-red-700"
          >
            Cancel capture
          </button>
        </div>
      </div>
    </div>
  )
}

export default CaptureConfigModal
