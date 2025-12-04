import React, { useState, useEffect } from 'react'
import { X, GitBranch, Info, Tag, AlertCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

interface TemplateChange {
  type: string
  description: string
  timestamp: number
  elementId: string
}

interface CreateVersionModalProps {
  isOpen: boolean
  onClose: () => void
  workflowName: string
  currentVersionNumber: number
  detectedVersionType: 'major' | 'minor'
  onCreateVersion: (versionName: string, versionType: 'major' | 'minor', description: string) => void
  previewData: {
    stageCount: number
    checklistCount: number
    ruleCount: number
  }
  /** List of changes to auto-populate version notes */
  changes?: TemplateChange[]
}

export function CreateVersionModal({
  isOpen,
  onClose,
  workflowName,
  currentVersionNumber,
  detectedVersionType,
  onCreateVersion,
  previewData,
  changes = []
}: CreateVersionModalProps) {
  const [versionType, setVersionType] = useState<'major' | 'minor'>(detectedVersionType)
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ description?: string }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Store the initial values when modal opens to prevent updates during submission
  const [initialVersionType, setInitialVersionType] = useState<'major' | 'minor'>(detectedVersionType)
  const [initialPreviewData, setInitialPreviewData] = useState(previewData)

  // Generate auto-populated notes from changes
  const generateAutoNotes = (changes: TemplateChange[]): string => {
    if (changes.length === 0) return ''

    // Group changes by type for a cleaner summary
    const changesByType: Record<string, string[]> = {}

    changes.forEach(change => {
      // Extract the category from description (e.g., "Stage Added:", "Checklist Item Deleted:")
      const desc = change.description
      if (!changesByType[change.type]) {
        changesByType[change.type] = []
      }
      changesByType[change.type].push(desc)
    })

    // Build summary lines
    const lines: string[] = []

    // Process in a logical order
    const typeOrder = [
      'stage_added', 'stage_edited', 'stage_deleted', 'stage_reordered',
      'checklist_added', 'checklist_edited', 'checklist_deleted',
      'rule_added', 'rule_edited', 'rule_deleted',
      'cadence_updated', 'universe_updated', 'workflow_updated'
    ]

    typeOrder.forEach(type => {
      if (changesByType[type]) {
        changesByType[type].forEach(desc => {
          lines.push(`• ${desc}`)
        })
      }
    })

    // Add any types not in the order
    Object.keys(changesByType).forEach(type => {
      if (!typeOrder.includes(type)) {
        changesByType[type].forEach(desc => {
          lines.push(`• ${desc}`)
        })
      }
    })

    return lines.join('\n')
  }

  // Update version type and auto-populate description when modal opens
  // Only update if not currently submitting to prevent UI changes during save
  useEffect(() => {
    if (isOpen && !isSubmitting) {
      setVersionType(detectedVersionType)
      setInitialVersionType(detectedVersionType)
      setInitialPreviewData(previewData)
      // Auto-populate description from changes
      const autoNotes = generateAutoNotes(changes)
      setDescription(autoNotes)
    }
  }, [isOpen]) // Only depend on isOpen - capture initial state when modal opens

  // Reset submitting state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  // Calculate semantic version numbers using initial values to prevent changes during save
  const currentMajor = Math.floor(currentVersionNumber / 100) || 1
  const currentMinor = currentVersionNumber % 100

  // Use initialVersionType to prevent UI changes during submission
  const displayVersionType = isSubmitting ? initialVersionType : versionType
  const nextMajor = displayVersionType === 'major' ? currentMajor + 1 : currentMajor
  const nextMinor = displayVersionType === 'major' ? 0 : currentMinor + 1
  const nextVersionString = `v${nextMajor}.${nextMinor}`

  // Use initial preview data during submission
  const displayPreviewData = isSubmitting ? initialPreviewData : previewData

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validate inputs
    const newErrors: { description?: string } = {}

    if (!description.trim()) {
      newErrors.description = 'Version notes are required'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // Set submitting state to lock the UI
    setIsSubmitting(true)

    // Call the create version handler - don't reset form here
    // The modal will be closed by the parent, and form resets on next open via useEffect
    onCreateVersion(nextVersionString, versionType, description.trim())
  }

  const handleClose = () => {
    setVersionType('minor')
    setDescription('')
    setErrors({})
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-8 pt-24 pb-12">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2">
              <GitBranch className="w-5 h-5 text-indigo-600" />
              <h2 className="text-lg font-bold text-gray-900">Create Template Version</h2>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            {/* Version Number Display */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Info className="w-4 h-4 text-indigo-600" />
                  <span className="text-sm font-medium text-indigo-900">
                    Creating {nextVersionString} for {workflowName}
                  </span>
                </div>
                <div className="px-3 py-1 bg-indigo-600 text-white rounded-full text-sm font-bold">
                  {nextVersionString}
                </div>
              </div>
            </div>

            {/* Version Type - Auto-detected, Read-only */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  <Tag className="w-4 h-4 inline mr-1" />
                  Version Type
                </label>
                <span className="text-xs text-gray-500 italic">
                  Auto-detected based on changes
                </span>
              </div>
              <div className={`p-4 rounded-lg border-2 ${
                displayVersionType === 'major'
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-indigo-300 bg-indigo-50'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`font-semibold text-sm ${
                      displayVersionType === 'major' ? 'text-amber-900' : 'text-indigo-900'
                    }`}>
                      {displayVersionType === 'major' ? 'Major Update' : 'Minor Update'}
                    </div>
                    <div className={`text-xs mt-1 ${
                      displayVersionType === 'major' ? 'text-amber-700' : 'text-indigo-700'
                    }`}>
                      {displayVersionType === 'major'
                        ? 'Stage changes detected (added, edited, deleted, or reordered)'
                        : 'Incremental changes to checklists, rules, cadence, or metadata'
                      }
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                    displayVersionType === 'major'
                      ? 'bg-amber-200 text-amber-800'
                      : 'bg-indigo-200 text-indigo-800'
                  }`}>
                    {displayVersionType === 'major' ? 'MAJOR' : 'MINOR'}
                  </div>
                </div>
              </div>
            </div>

            {/* Description/Notes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                  Version Notes *
                </label>
                <span className="text-xs text-gray-500 italic">
                  Auto-generated from changes • Edit as needed
                </span>
              </div>
              <textarea
                id="description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  if (errors.description) {
                    setErrors({ ...errors, description: undefined })
                  }
                }}
                placeholder="Describe what changed in this version..."
                rows={5}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm ${
                  errors.description ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.description && (
                <div className="mt-1 flex items-center space-x-1 text-red-600 text-xs">
                  <AlertCircle className="w-3 h-3" />
                  <span>{errors.description}</span>
                </div>
              )}
            </div>

            {/* Preview - More Compact */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">Snapshot includes:</span>
                <div className="flex items-center space-x-4">
                  <span className="font-semibold text-indigo-600">{displayPreviewData.stageCount} stages</span>
                  <span className="font-semibold text-indigo-600">{displayPreviewData.checklistCount} checklists</span>
                  <span className="font-semibold text-indigo-600">{displayPreviewData.ruleCount} rules</span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3 flex-shrink-0">
            <Button type="button" onClick={handleClose} variant="outline">
              Cancel
            </Button>
            <Button type="submit">
              <GitBranch className="w-4 h-4 mr-2" />
              Create {nextVersionString}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
