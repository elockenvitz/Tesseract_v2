import React, {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react'
import { Edit3, History, X } from 'lucide-react'
import { clsx } from 'clsx'
import { FieldHistory } from './FieldHistory'
import { CitationButton } from '../communication/CitationButton'

interface EditableSectionWithHistoryProps {
  title: string
  content: string
  onSave: (content: string) => Promise<void>
  placeholder?: string
  className?: string
  onEditStart?: () => void
  onEditEnd?: () => void
  tableName: string
  recordId: string
  fieldName: string
  onCite?: (content: string, fieldName?: string) => void
}

export interface EditableSectionWithHistoryRef {
  saveIfEditing: () => Promise<void>
  isEditing: boolean
}

function EditableSectionWithHistoryInner(
  {
    title,
    content,
    onSave,
    placeholder = 'Click to add content...',
    className,
    onEditStart,
    onEditEnd,
    tableName,
    recordId,
    fieldName,
    onCite,
  }: EditableSectionWithHistoryProps,
  ref: React.Ref<EditableSectionWithHistoryRef>
) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(content)
  const [isSaving, setIsSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'content' | 'history'>('content')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync props into local state ONLY when not editing
  useEffect(() => {
    if (!isEditing) {
      setEditContent(content)
    }
  }, [content, fieldName, isEditing])

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
    isEditing,
  }))

  const handleEdit = () => {
    setViewMode('content')
    onEditStart?.()
    setIsEditing(true)
    setEditContent(content)
  }

  const handleSave = async () => {
    if (isSaving) return // re-entrancy guard
    if (editContent === content) {
      setIsEditing(false)
      onEditEnd?.()
      return
    }

    setIsSaving(true)
    try {
      await onSave(editContent)
      setIsEditing(false)
      onEditEnd?.()
    } catch (error) {
      // keep editing so user can retry
      // optionally add toast here
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditContent(content)
    setIsEditing(false)
    onEditEnd?.()
  }

  // Safe blur: save if changed, otherwise just exit
  const handleBlur = () => {
    if (isSaving) return // avoid double-fire during save
    if (editContent !== content) {
      void handleSave()
    } else {
      setIsEditing(false)
      onEditEnd?.()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleSave()
    }
  }

  const toggleView = () => {
    setViewMode(viewMode === 'content' ? 'history' : 'content')
  }

  return (
    <div className={clsx('group', className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center space-x-2">
          {onCite && content && (
            <CitationButton
              onCite={onCite}
              content={content}
              fieldName={fieldName}
              className="opacity-0 group-hover:opacity-100"
            />
          )}
          <button
            onClick={toggleView}
            className={clsx(
              'p-1 rounded transition-all',
              viewMode === 'history'
                ? 'text-primary-600 hover:text-primary-700 opacity-100'
                : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600'
            )}
            title={viewMode === 'history' ? 'Back to content' : 'View change history'}
          >
            {viewMode === 'history' ? (
              <X className="h-4 w-4" />
            ) : (
              <History className="h-4 w-4" />
            )}
          </button>
          {!isEditing && viewMode === 'content' && (
            <button
              onClick={handleEdit}
              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 rounded transition-all"
              title="Edit section"
            >
              <Edit3 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        {/* Content View */}
        <div
          className={clsx(
            'transition-all duration-300 ease-in-out',
            viewMode === 'content'
              ? 'opacity-100 translate-x-0'
              : 'opacity-0 -translate-x-4 absolute inset-0 pointer-events-none'
          )}
        >
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
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
                <div className="text-gray-700 whitespace-pre-wrap group relative">
                  {content}
                  {onCite && (
                    <CitationButton
                      onCite={onCite}
                      content={content}
                      fieldName={fieldName}
                    />
                  )}
                </div>
              ) : (
                <div className="text-gray-400 italic">{placeholder}</div>
              )}
            </div>
          )}
        </div>

        {/* History View */}
        <div
          className={clsx(
            'transition-all duration-300 ease-in-out',
            viewMode === 'history'
              ? 'opacity-100 translate-x-0'
              : 'opacity-0 translate-x-4 absolute inset-0 pointer-events-none'
          )}
        >
          <div
            className={clsx(
              'transition-all duration-300 border border-gray-200 rounded-lg',
              viewMode === 'history' ? 'h-[400px]' : 'h-[120px]'
            )}
          >
            <FieldHistory
              tableName={tableName}
              recordId={recordId}
              fieldName={fieldName}
              className="h-full"
              isExpanded={viewMode === 'history'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const EditableSectionWithHistory = forwardRef(EditableSectionWithHistoryInner)
EditableSectionWithHistory.displayName = 'EditableSectionWithHistory'
