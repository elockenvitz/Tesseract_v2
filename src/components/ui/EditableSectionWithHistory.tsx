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

// ---------------------------------------------------------------------------
// Render plain text with bullet/list detection
// ---------------------------------------------------------------------------

function renderFormattedContent(text: string): React.ReactNode {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let bulletGroup: string[] = []

  const flushBullets = () => {
    if (bulletGroup.length === 0) return
    elements.push(
      <ul key={`ul-${elements.length}`} className="list-disc pl-5 my-1.5 space-y-0.5">
        {bulletGroup.map((b, i) => (
          <li key={i} className="text-sm text-gray-700">{b}</li>
        ))}
      </ul>
    )
    bulletGroup = []
  }

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-•*–+]\s+(.+)/)
    if (bulletMatch) {
      bulletGroup.push(bulletMatch[1])
    } else {
      flushBullets()
      if (line.trim() === '') {
        // Visible blank line spacer
        elements.push(<div key={`sp-${elements.length}`} className="h-3" />)
      } else {
        elements.push(<p key={`p-${elements.length}`} className="text-sm text-gray-700 my-0.5 leading-relaxed">{line}</p>)
      }
    }
  }
  flushBullets()

  return <>{elements}</>
}

interface EditableSectionWithHistoryProps {
  title: string
  content: string
  onSave: (content: string) => Promise<void>
  placeholder?: string
  className?: string
  onEditStart?: () => void
  onEditEnd?: () => void
  assetId: string
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
    assetId,
    fieldName,
    onCite,
  }: EditableSectionWithHistoryProps,
  ref: React.Ref<EditableSectionWithHistoryRef>
) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(content)
  const [displayContent, setDisplayContent] = useState(content)
  const [isSaving, setIsSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'content' | 'history'>('content')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync incoming props when NOT editing
  useEffect(() => {
    if (!isEditing) {
      setEditContent(content)
      setDisplayContent(content)
    }
  }, [content, fieldName, isEditing])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      autoGrow(textareaRef.current)
    }
  }, [isEditing])

  const saveIfEditing = async () => {
    if (isEditing && editContent.trim() !== content.trim()) {
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
    if (isSaving) return
    const next = editContent.trim()
    const prev = content.trim()
    if (next === prev) {
      setIsEditing(false)
      onEditEnd?.()
      return
    }
    setIsSaving(true)
    try {
      setDisplayContent(next)
      await onSave(next)
      setIsEditing(false)
      onEditEnd?.()
    } catch {
      // keep editing so user can retry
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditContent(content)
    setIsEditing(false)
    onEditEnd?.()
  }

  // AUTOSAVE on blur; guard against re-entrancy
  const handleBlur = () => {
    if (isSaving) return
    if (editContent.trim() !== content.trim()) {
      void handleSave()
    } else {
      setIsEditing(false)
      onEditEnd?.()
    }
  }

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.max(120, el.scrollHeight)}px`
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      handleCancel()
      return
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleSave()
      return
    }
    // Auto-continue bullet lists on Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      const el = e.currentTarget
      const { selectionStart } = el
      const before = editContent.slice(0, selectionStart)
      const after = editContent.slice(selectionStart)

      // Find the current line
      const lastNewline = before.lastIndexOf('\n')
      const currentLine = before.slice(lastNewline + 1)

      // Check if current line starts with a bullet pattern
      const bulletMatch = currentLine.match(/^(\s*)([-•*])\s/)
      if (bulletMatch) {
        const [fullMatch, indent, bulletChar] = bulletMatch
        const lineContent = currentLine.slice(fullMatch.length)

        // If the line is empty (just a bullet), remove the bullet instead of continuing
        if (lineContent.trim() === '') {
          e.preventDefault()
          const newContent = before.slice(0, lastNewline + 1) + after
          setEditContent(newContent)
          // Set cursor position after React re-renders
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = lastNewline + 1
            autoGrow(el)
          })
          return
        }

        // Continue with same bullet on next line
        e.preventDefault()
        const insertion = `\n${indent}${bulletChar} `
        const newContent = before + insertion + after
        setEditContent(newContent)
        const newPos = selectionStart + insertion.length
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = newPos
          autoGrow(el)
        })
        return
      }
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
            {viewMode === 'history' ? <X className="h-4 w-4" /> : <History className="h-4 w-4" />}
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
                value={editContent.replace(/\n\n/g, '\n\u00A0\n')}
                onChange={(e) => {
                  setEditContent(e.target.value.replace(/\u00A0/g, ''))
                  autoGrow(e.target)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace') {
                    const el = e.currentTarget
                    const pos = el.selectionStart
                    const displayVal = el.value
                    const lineStart = displayVal.lastIndexOf('\n', pos - 1) + 1
                    const lineContent = displayVal.slice(lineStart, pos)
                    if ((lineContent === '\u00A0' || lineContent === '') && lineStart > 0) {
                      e.preventDefault()
                      const beforeInReal = displayVal.slice(0, lineStart).replace(/\u00A0/g, '')
                      const afterInReal = displayVal.slice(lineStart).replace(/\u00A0/g, '')
                      const newVal = beforeInReal.slice(0, -1) + afterInReal
                      const newPos = beforeInReal.length - 1
                      setEditContent(newVal)
                      setTimeout(() => {
                        el.selectionStart = el.selectionEnd = newPos
                        autoGrow(el)
                      }, 0)
                      return
                    }
                  }
                  handleKeyDown(e as any)
                }}
                onBlur={handleBlur}
                placeholder={placeholder}
                className="w-full min-h-[300px] p-3 border border-gray-300 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 overflow-auto caret-gray-900 transition-all duration-200"
                style={{ lineHeight: '1.5em' }}
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
              className="min-h-[120px] prose prose-sm max-w-none cursor-pointer hover:bg-gray-50 rounded-lg p-3 -m-3 transition-colors"
              onClick={handleEdit}
            >
              {displayContent ? (
                <div className="text-gray-700 group relative">
                  {renderFormattedContent(displayContent)}
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
              assetId={assetId}
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
