import React, { useState, useEffect } from 'react'
import { X, Link2, FileText, FileSpreadsheet } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { ExternalNoteProvider } from './CompactNoteCard'
import type { ExternalProvider } from '../../hooks/useAssetModels'

interface ExternalLinkModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    url: string
    provider: string
    description?: string
  }) => void
  type: 'note' | 'model'
  isLoading?: boolean
}

const noteProviders: { value: ExternalNoteProvider; label: string; domain: string }[] = [
  { value: 'google_docs', label: 'Google Docs', domain: 'docs.google.com' },
  { value: 'notion', label: 'Notion', domain: 'notion.so' },
  { value: 'evernote', label: 'Evernote', domain: 'evernote.com' },
  { value: 'onenote', label: 'OneNote', domain: 'onenote.com' },
  { value: 'confluence', label: 'Confluence', domain: 'atlassian.net' },
  { value: 'other', label: 'Other', domain: '' }
]

const modelProviders: { value: ExternalProvider; label: string; domain: string }[] = [
  { value: 'google_sheets', label: 'Google Sheets', domain: 'docs.google.com/spreadsheets' },
  { value: 'airtable', label: 'Airtable', domain: 'airtable.com' },
  { value: 'excel_online', label: 'Excel Online', domain: 'onedrive.live.com' },
  { value: 'smartsheet', label: 'Smartsheet', domain: 'smartsheet.com' },
  { value: 'other', label: 'Other', domain: '' }
]

export function ExternalLinkModal({
  isOpen,
  onClose,
  onSubmit,
  type,
  isLoading = false
}: ExternalLinkModalProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [detectedProvider, setDetectedProvider] = useState<string>('other')

  const providers = type === 'note' ? noteProviders : modelProviders

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('')
      setUrl('')
      setDescription('')
      setDetectedProvider('other')
    }
  }, [isOpen])

  // Auto-detect provider from URL
  useEffect(() => {
    if (!url) {
      setDetectedProvider('other')
      return
    }

    const lowerUrl = url.toLowerCase()
    const provider = providers.find(p => p.domain && lowerUrl.includes(p.domain))
    setDetectedProvider(provider?.value || 'other')
  }, [url, providers])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return

    onSubmit({
      name: name.trim(),
      url: url.trim(),
      provider: detectedProvider,
      description: description.trim() || undefined
    })
  }

  const isValidUrl = (urlString: string) => {
    try {
      new URL(urlString)
      return true
    } catch {
      return false
    }
  }

  if (!isOpen) return null

  const Icon = type === 'note' ? FileText : FileSpreadsheet

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-auto transform transition-all">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
          >
            <X className="h-5 w-5" />
          </button>

          <form onSubmit={handleSubmit} className="p-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Link2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Link External {type === 'note' ? 'Note' : 'Model'}
                </h3>
                <p className="text-sm text-gray-500">
                  Add a link to an external {type === 'note' ? 'document' : 'spreadsheet'}
                </p>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-error-500">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={type === 'note' ? 'Q4 Analysis Notes' : 'DCF Model'}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL <span className="text-error-500">*</span>
                </label>
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://docs.google.com/..."
                  required
                />
                {url && !isValidUrl(url) && (
                  <p className="text-xs text-error-500 mt-1">Please enter a valid URL</p>
                )}
              </div>

              {/* Auto-detected provider */}
              {url && isValidUrl(url) && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Detected:</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                    <Icon className="h-3 w-3" />
                    {providers.find(p => p.value === detectedProvider)?.label || 'External Link'}
                  </span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description <span className="text-gray-400">(optional)</span>
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description..."
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex space-x-3 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1"
                loading={isLoading}
                disabled={!name.trim() || !url.trim() || !isValidUrl(url)}
              >
                Add Link
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
