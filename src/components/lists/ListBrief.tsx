import React, { useState, useEffect, useMemo } from 'react'
import { Edit3, Check, X, Plus, ChevronDown, FileText } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import { RichTextEditor } from '../rich-text-editor/RichTextEditor'
import { useUpdateListBrief } from '../../hooks/lists/useUpdateListBrief'

interface ListBriefProps {
  listId: string
  brief: string | null
  canEdit: boolean
}

// Strip HTML and collapse whitespace to a plain preview string.
function toPreviewText(html: string): string {
  if (!html) return ''
  const stripped = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  return stripped.replace(/\s+/g, ' ').trim()
}

export function ListBrief({ listId, brief, canEdit }: ListBriefProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [draft, setDraft] = useState(brief ?? '')

  useEffect(() => {
    if (!isEditing) setDraft(brief ?? '')
  }, [brief, isEditing])

  const updateBrief = useUpdateListBrief(listId)

  const hasContent = !!brief && brief.trim().length > 0 && brief !== '<p></p>'
  const previewText = useMemo(() => toPreviewText(brief ?? ''), [brief])

  const handleSave = async () => {
    await updateBrief.mutateAsync(draft)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setDraft(brief ?? '')
    setIsEditing(false)
  }

  const handleStartEdit = () => {
    setDraft(brief ?? '')
    setIsEditing(true)
    setIsExpanded(true)
  }

  // Empty + no edit access → render nothing
  if (!hasContent && !canEdit && !isEditing) return null

  // Editing mode — inline editor with save/cancel
  if (isEditing) {
    return (
      <div className="py-2">
        <RichTextEditor
          value={draft}
          onChange={(html) => setDraft(html)}
          placeholder="Why this list exists — the goal, the frame, the stakes."
          minHeight="120px"
        />
        <div className="flex items-center justify-end gap-1 mt-2">
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={updateBrief.isPending}>
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={updateBrief.isPending}>
            <Check className="h-3.5 w-3.5 mr-1" />
            {updateBrief.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {updateBrief.error && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
            {(updateBrief.error as Error).message}
          </p>
        )}
      </div>
    )
  }

  // Empty + can edit → whisper-level CTA
  if (!hasContent) {
    return (
      <button
        onClick={handleStartEdit}
        className="group inline-flex self-start items-center gap-1.5 py-1 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
      >
        <Plus className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        Add a brief — what are we trying to do here?
      </button>
    )
  }

  // Populated — collapsed by default (single-line teaser), expandable
  return (
    <div className="group">
      {!isExpanded ? (
        <div className="flex items-center gap-2 py-1">
          <FileText className="h-3 w-3 text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <button
            onClick={() => setIsExpanded(true)}
            className="flex-1 min-w-0 text-left text-[13px] text-gray-600 dark:text-gray-400 truncate hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
            title="Expand brief"
          >
            {previewText || '(empty brief)'}
          </button>
          <button
            onClick={() => setIsExpanded(true)}
            className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded flex-shrink-0"
            title="Expand"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative py-1.5 border-l-2 border-gray-200 dark:border-gray-800 pl-3">
          <div className="flex items-start justify-between gap-2">
            <div
              className={clsx(
                'prose prose-sm dark:prose-invert max-w-none text-[13px]',
                'text-gray-600 dark:text-gray-400 leading-relaxed flex-1 min-w-0'
              )}
              dangerouslySetInnerHTML={{ __html: brief ?? '' }}
            />
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {canEdit && (
                <button
                  onClick={handleStartEdit}
                  className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800 rounded"
                  title="Edit brief"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsExpanded(false)}
                className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800 rounded"
                title="Collapse"
              >
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
