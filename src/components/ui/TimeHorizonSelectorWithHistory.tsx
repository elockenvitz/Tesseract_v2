import { useState, useRef, useEffect } from 'react'
import { Edit3, History } from 'lucide-react'
import { clsx } from 'clsx'
import { PriceTargetFieldHistory } from './PriceTargetFieldHistory'

interface TimeHorizonSelectorWithHistoryProps {
  value: string
  onSave: (value: string) => Promise<void>
  className?: string
  displayClassName?: string
  priceTargetId: string
  caseType: 'bull' | 'base' | 'bear'
}

const PRESET_OPTIONS = [
  { value: '1 week', label: '1 Week' },
  { value: '1 month', label: '1 Month' },
  { value: '3 months', label: '3 Months' },
  { value: '6 months', label: '6 Months' },
  { value: '12 months', label: '12 Months' },
  { value: '18 months', label: '18 Months' },
]

export function TimeHorizonSelectorWithHistory({ 
  value, 
  onSave, 
  className,
  displayClassName,
  priceTargetId,
  caseType
}: TimeHorizonSelectorWithHistoryProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value || '12 months')
  const [inputType, setInputType] = useState<'preset' | 'date' | 'custom'>('preset')
  const [customValue, setCustomValue] = useState('')
  const [customUnit, setCustomUnit] = useState('months')
  const [isSaving, setIsSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setEditValue(value || '12 months')
    
    // Determine input type based on current value
    if (value) {
      const isPreset = PRESET_OPTIONS.some(option => option.value === value)
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(value)
      
      if (isPreset) {
        setInputType('preset')
      } else if (isDate) {
        setInputType('date')
      } else {
        setInputType('custom')
        // Parse custom value like "15 days" or "8 weeks"
        const match = value.match(/^(\d+)\s+(days?|weeks?|months?|years?)$/i)
        if (match) {
          setCustomValue(match[1])
          setCustomUnit(match[2].toLowerCase().replace(/s$/, '') + 's') // Normalize to plural
        }
      }
    }
  }, [value])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        handleCancel()
      }
    }

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isEditing])

  const handleEdit = () => {
    setIsEditing(true)
  }

  const handleSave = async () => {
    let finalValue = editValue

    if (inputType === 'custom' && customValue) {
      finalValue = `${customValue} ${customUnit}`
    }

    if (finalValue === value) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(finalValue)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditValue(value || '12 months')
    setIsEditing(false)
  }

  const handlePresetSelect = (presetValue: string) => {
    setEditValue(presetValue)
    setInputType('preset')
  }

  const handleDateChange = (dateValue: string) => {
    setEditValue(dateValue)
    setInputType('date')
  }

  const handleCustomChange = () => {
    setInputType('custom')
  }

  const formatDisplayValue = (val: string) => {
    if (!val) return 'Set timeframe'
    
    // If it's a date, format it nicely
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const date = new Date(val)
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })
    }
    
    return val
  }

  return (
    <div className={clsx('group relative', className)} ref={dropdownRef}>
      {isEditing ? (
        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-4 min-w-[280px] z-50">
          <div className="space-y-4">
            {/* Tab Selection */}
            <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setInputType('preset')}
                className={clsx(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  inputType === 'preset' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                Preset
              </button>
              <button
                onClick={() => setInputType('date')}
                className={clsx(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  inputType === 'date' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                Date
              </button>
              <button
                onClick={handleCustomChange}
                className={clsx(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  inputType === 'custom' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                Custom
              </button>
            </div>

            {/* Content based on selected type */}
            {inputType === 'preset' && (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {PRESET_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handlePresetSelect(option.value)}
                    className={clsx(
                      'px-3 py-2 text-xs text-left rounded-md border transition-colors',
                      editValue === option.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {inputType === 'date' && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Target Date
                </label>
                <input
                  type="date"
                  value={inputType === 'date' ? editValue : ''}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  min={new Date().toISOString().split('T')[0]} // Prevent past dates
                />
              </div>
            )}

            {inputType === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Custom Timeframe
                </label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    placeholder="Number"
                    min="1"
                    className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  <select
                    value={customUnit}
                    onChange={(e) => setCustomUnit(e.target.value)}
                    className="px-3 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                    <option value="years">Years</option>
                  </select>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-2 pt-2 border-t border-gray-200">
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || (inputType === 'custom' && !customValue)}
                className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div 
          className={clsx(
            'cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1 transition-colors group-hover:bg-gray-50',
            displayClassName
          )}
          onClick={handleEdit}
        >
          <div className="flex items-center justify-center w-full relative">
            <span className={value ? 'text-gray-500' : 'text-gray-400 italic'}>
              {formatDisplayValue(value)}
            </span>
            <div className="absolute right-0 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {priceTargetId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowHistory(!showHistory)
                  }}
                  className="p-1 hover:bg-gray-200 rounded"
                  title={`View ${caseType} case timeframe history`}
                >
                  <History className="h-3 w-3 text-gray-400" />
                </button>
              )}
              <Edit3 className="h-3 w-3 text-gray-400" />
            </div>
          </div>
        </div>
      )}
      
      {showHistory && priceTargetId && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50">
          <PriceTargetFieldHistory
            priceTargetId={priceTargetId}
            fieldName="timeframe"
            caseType={caseType}
          />
        </div>
      )}
    </div>
  )
}