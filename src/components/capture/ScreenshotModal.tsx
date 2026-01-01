import React, { useState, useEffect, useRef } from 'react'
import { X, Image, Link2, Tag, FileText, Upload, AlertCircle, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

interface ScreenshotModalProps {
  isOpen: boolean
  screenshotDataUrl: string | null
  screenshotBlob: Blob | null
  onConfirm: (metadata: {
    sourceUrl: string
    title: string
    notes: string
    tags: string[]
  }) => void
  onCancel: () => void
  isUploading?: boolean
}

export function ScreenshotModal({
  isOpen,
  screenshotDataUrl,
  screenshotBlob,
  onConfirm,
  onCancel,
  isUploading = false
}: ScreenshotModalProps) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])

  const sourceUrlRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSourceUrl('')
      setTitle('')
      setNotes('')
      setTagInput('')
      setTags([])
      // Focus on source URL input
      setTimeout(() => sourceUrlRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Handle tag input
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
  }

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
    }
    setTagInput('')
  }

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove))
  }

  // Handle confirm
  const handleConfirm = () => {
    onConfirm({
      sourceUrl: sourceUrl.trim(),
      title: title.trim() || 'Screenshot',
      notes: notes.trim(),
      tags
    })
  }

  // Handle key shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel()
    } else if (e.key === 'Enter' && e.metaKey) {
      handleConfirm()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-violet-100 rounded-lg">
              <Image className="h-4 w-4 text-violet-600" />
            </div>
            <h3 className="font-semibold text-gray-900">Add Screenshot Details</h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Preview */}
        {screenshotDataUrl && (
          <div className="p-4 bg-gray-50 border-b border-gray-100">
            <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-white">
              <img
                src={screenshotDataUrl}
                alt="Screenshot preview"
                className="max-h-64 w-full object-contain"
              />
              {screenshotBlob && (
                <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                  {(screenshotBlob.size / 1024).toFixed(1)} KB
                </div>
              )}
            </div>
          </div>
        )}

        {/* Form */}
        <div className="p-4 space-y-4">
          {/* Source URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <div className="flex items-center gap-1.5">
                <Link2 className="h-4 w-4 text-gray-400" />
                Source URL
              </div>
            </label>
            <input
              ref={sourceUrlRef}
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://example.com/page"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Where was this screenshot taken from?
            </p>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <div className="flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-gray-400" />
                Title
              </div>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Screenshot title (optional)"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any context or notes about this screenshot..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <div className="flex items-center gap-1.5">
                <Tag className="h-4 w-4 text-gray-400" />
                Tags
              </div>
            </label>
            <div className="flex flex-wrap gap-1.5 p-2 border border-gray-200 rounded-lg min-h-[42px] focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:border-primary-500">
              {tags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-sm"
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder={tags.length === 0 ? "Add tags (press Enter)" : ""}
                className="flex-1 min-w-[100px] text-sm outline-none bg-transparent"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            <kbd className="px-1.5 py-0.5 bg-white border rounded">⌘</kbd>
            <span className="mx-1">+</span>
            <kbd className="px-1.5 py-0.5 bg-white border rounded">Enter</kbd>
            <span className="ml-1">to save</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={isUploading}
              className={clsx(
                'flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg transition-colors',
                isUploading
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-primary-600 text-white hover:bg-primary-700'
              )}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Save Screenshot
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScreenshotModal
