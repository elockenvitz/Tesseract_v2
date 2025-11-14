import React, { useState, useEffect } from 'react'
import { X, GitBranch, Info, Tag, AlertCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

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
}

export function CreateVersionModal({
  isOpen,
  onClose,
  workflowName,
  currentVersionNumber,
  detectedVersionType,
  onCreateVersion,
  previewData
}: CreateVersionModalProps) {
  const [versionType, setVersionType] = useState<'major' | 'minor'>(detectedVersionType)
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ description?: string }>({})

  // Update version type when modal opens or detectedVersionType changes
  useEffect(() => {
    if (isOpen) {
      setVersionType(detectedVersionType)
    }
  }, [isOpen, detectedVersionType])

  if (!isOpen) return null

  // Calculate semantic version numbers
  const currentMajor = Math.floor(currentVersionNumber / 100) || 1
  const currentMinor = currentVersionNumber % 100

  const nextMajor = detectedVersionType === 'major' ? currentMajor + 1 : currentMajor
  const nextMinor = detectedVersionType === 'major' ? 0 : currentMinor + 1
  const nextVersionString = `v${nextMajor}.${nextMinor}`

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

    onCreateVersion(nextVersionString, versionType, description.trim())

    // Reset form
    setVersionType('minor')
    setDescription('')
    setErrors({})
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
                versionType === 'major'
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-indigo-300 bg-indigo-50'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`font-semibold text-sm ${
                      versionType === 'major' ? 'text-amber-900' : 'text-indigo-900'
                    }`}>
                      {versionType === 'major' ? 'Major Update' : 'Minor Update'}
                    </div>
                    <div className={`text-xs mt-1 ${
                      versionType === 'major' ? 'text-amber-700' : 'text-indigo-700'
                    }`}>
                      {versionType === 'major'
                        ? 'Stage changes detected (added, edited, deleted, or reordered)'
                        : 'Incremental changes to checklists, rules, cadence, or metadata'
                      }
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                    versionType === 'major'
                      ? 'bg-amber-200 text-amber-800'
                      : 'bg-indigo-200 text-indigo-800'
                  }`}>
                    {versionType === 'major' ? 'MAJOR' : 'MINOR'}
                  </div>
                </div>
              </div>
            </div>

            {/* Description/Notes */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Version Notes *
              </label>
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
                rows={3}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${
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
                  <span className="font-semibold text-indigo-600">{previewData.stageCount} stages</span>
                  <span className="font-semibold text-indigo-600">{previewData.checklistCount} checklists</span>
                  <span className="font-semibold text-indigo-600">{previewData.ruleCount} rules</span>
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
