import React, { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

interface DeleteProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  projectTitle: string
  isDeleting?: boolean
}

export function DeleteProjectModal({
  isOpen,
  onClose,
  onConfirm,
  projectTitle,
  isDeleting = false
}: DeleteProjectModalProps) {
  const [confirmText, setConfirmText] = useState('')

  const handleConfirm = () => {
    if (confirmText === projectTitle) {
      onConfirm()
      setConfirmText('')
    }
  }

  const handleClose = () => {
    setConfirmText('')
    onClose()
  }

  const isConfirmValid = confirmText === projectTitle

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-auto transform transition-all">
          <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Cancel Project
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This action cannot be undone
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            disabled={isDeleting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200">
              <strong>Warning:</strong> Cancelling this project will permanently remove:
            </p>
            <ul className="mt-2 text-sm text-red-700 dark:text-red-300 list-disc list-inside space-y-1">
              <li>All project deliverables and their completion status</li>
              <li>All team member assignments</li>
              <li>All project comments and discussions</li>
              <li>Project metadata and history</li>
            </ul>
          </div>

          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              You are about to cancel the project:
            </p>
            <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <p className="font-semibold text-gray-900 dark:text-white">
                {projectTitle}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              To confirm, type the project name exactly as shown above:
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Enter project name to confirm"
              disabled={isDeleting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isConfirmValid) {
                  handleConfirm()
                }
              }}
            />
            {confirmText && !isConfirmValid && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                Project name doesn't match. Please type exactly: <strong>{projectTitle}</strong>
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 mt-6">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isDeleting}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isConfirmValid || isDeleting}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isDeleting ? 'Cancelling...' : 'Cancel Project'}
          </Button>
        </div>
      </div>
        </div>
      </div>
    </div>
  )
}
