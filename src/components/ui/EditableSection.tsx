import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { Edit3 } from 'lucide-react'
import { clsx } from 'clsx'

interface EditableSectionProps {
  title: string
  content: string
  onSave: (content: string) => Promise<void>
  placeholder?: string
  className?: string
  onEditStart?: () => void
  onEditEnd?: () => void
  onError?: (error: any) => void
}

export interface EditableSectionRef {
  saveIfEditing: () => Promise<void>
  isEditing: boolean
}

export const EditableSection = forwardRef<EditableSectionRef, EditableSectionProps>(({ 
  title, 
  content, 
  onSave, 
  placeholder = "Click to add content...",
  className,
  onEditStart,
  onEditEnd,
  onError
}, ref) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(content)
  const [isSaving, setIsSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setEditContent(content)
  }, [content])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isEditing])

  const saveIfEditing = async () => {
    if (isEditing && editContent !== content) {
      await handleSave()
    }
  }

  useImperativeHandle(ref, () => ({
    saveIfEditing,
    isEditing
  }))

  const handleEdit = () => {
    onEditStart?.()
    setIsEditing(true)
    setEditContent(content)
  }

  const handleSave = async () => {
    if (editContent === content) {
      setIsEditing(false)
      onEditEnd?.()
      return
    }

    setIsSaving(true)
    try {
      console.log('🚀 EditableSection saving:', editContent.length, 'characters')
      await onSave(editContent)
      console.log('✅ EditableSection save completed')
      setIsEditing(false)
      onEditEnd?.()
    } catch (error) {
      if (onError) {
        onError(error)
      } else {
        console.error('❌ EditableSection save failed:', error)
      }
      setIsEditing(false)
      onEditEnd?.()
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditContent(content)
    setIsEditing(false)
    onEditEnd?.()
  }

  const handleBlur = () => {
    // Auto-save when clicking outside the textarea
    handleSave()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value)
  }

  return (
    <div className={clsx('group', className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {!isEditing && (
          <button
            onClick={handleEdit}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 rounded transition-all"
            title="Edit section"
          >
            <Edit3 className="h-4 w-4" />
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={handleTextareaChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full h-[120px] p-3 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 overflow-y-auto"
          />
          {isSaving && (
            <div className="flex items-center text-xs text-gray-500">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-500 mr-2" />
              Saving...
            </div>
          )}
        </div>
      ) : (
        <div 
          className="h-[120px] prose prose-sm max-w-none cursor-pointer hover:bg-gray-50 rounded-lg p-3 -m-3 transition-colors overflow-y-auto"
          onClick={handleEdit}
        >
          {content ? (
            <div className="text-gray-700 whitespace-pre-wrap">{content}</div>
          ) : (
            <div className="text-gray-400 italic">{placeholder}</div>
          )}
        </div>
      )}
    </div>
  )
})

EditableSection.displayName = 'EditableSection'