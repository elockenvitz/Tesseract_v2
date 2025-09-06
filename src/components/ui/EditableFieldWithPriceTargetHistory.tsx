import React, { useState, useRef, useEffect } from 'react'
import { Edit3, History } from 'lucide-react'
import { clsx } from 'clsx'
import { PriceTargetFieldHistory } from './PriceTargetFieldHistory'

interface EditableFieldWithPriceTargetHistoryProps {
  value: string | number
  onSave: (value: string) => Promise<void>
  placeholder?: string
  type?: 'text' | 'number'
  className?: string
  displayClassName?: string
  inputClassName?: string
  prefix?: string
  suffix?: string
  // History tracking props
  priceTargetId: string
  fieldName: string
  caseType: 'bull' | 'base' | 'bear'
}

export function EditableFieldWithPriceTargetHistory({ 
  value, 
  onSave, 
  placeholder = "Click to edit...",
  type = 'text',
  className,
  displayClassName,
  inputClassName,
  prefix,
  suffix,
  priceTargetId,
  fieldName,
  caseType
}: EditableFieldWithPriceTargetHistoryProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(String(value || ''))
  const [isSaving, setIsSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditValue(String(value || ''))
  }, [value])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleEdit = () => {
    setIsEditing(true)
    setEditValue(String(value || ''))
  }

  const handleSave = async () => {
    if (editValue === String(value)) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(editValue)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditValue(String(value || ''))
    setIsEditing(false)
  }

  const handleBlur = () => {
    handleSave()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel()
    } else if (e.key === 'Enter') {
      handleSave()
    }
  }

  const displayValue = value ? `${prefix || ''}${value}${suffix || ''}` : placeholder

  return (
    <div className={clsx('group relative', className)}>
      {isEditing ? (
        <div className="relative">
          <input
            ref={inputRef}
            type={type}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={clsx(
              'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
              inputClassName
            )}
          />
          {isSaving && (
            <div className="absolute -bottom-5 left-0 flex items-center text-xs text-gray-500">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-500 mr-1" />
              Saving...
            </div>
          )}
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
            <span className={value ? 'text-gray-900' : 'text-gray-400 italic'}>
              {displayValue}
            </span>
            <div className="absolute right-0 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {priceTargetId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowHistory(!showHistory)
                  }}
                  className="p-1 hover:bg-gray-200 rounded"
                  title={`View ${caseType} case ${fieldName} history`}
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
            fieldName={fieldName}
            caseType={caseType}
          />
        </div>
      )}
    </div>
  )
}