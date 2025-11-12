import React from 'react'
import { CheckCircle, X, GitBranch, Eye } from 'lucide-react'
import { Button } from '../ui/Button'

interface VersionCreatedModalProps {
  isOpen: boolean
  onClose: () => void
  versionNumber: number
  versionName: string
  versionType: 'major' | 'minor'
  workflowName: string
  onViewVersion?: () => void
}

export function VersionCreatedModal({
  isOpen,
  onClose,
  versionNumber,
  versionName,
  versionType,
  workflowName,
  onViewVersion
}: VersionCreatedModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Version Created Successfully
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Your template version has been saved
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Workflow</span>
              <span className="text-sm font-medium text-gray-900">{workflowName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Version</span>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-900">
                  {versionNumber} - {versionName}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs ${
                  versionType === 'major'
                    ? 'bg-amber-100 text-amber-700 border border-amber-300'
                    : 'bg-blue-100 text-blue-700 border border-blue-300'
                }`}>
                  {versionType === 'major' ? 'Major' : 'Minor'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-800">
              This version is now active and will be used for all new workflow instances.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
          {onViewVersion && (
            <Button onClick={() => {
              onViewVersion()
              onClose()
            }}>
              <Eye className="w-4 h-4 mr-2" />
              View Version
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
