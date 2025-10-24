import React, { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '../ui/Button'

interface WorkflowBranch {
  id: string
  name: string
  branched_at: string
  created_at: string
}

interface CreateBranchModalProps {
  workflowId: string
  workflowName: string
  existingBranches: WorkflowBranch[]
  onClose: () => void
  onSubmit: (branchName: string, branchSuffix: string, copyProgress: boolean, sourceBranchId?: string) => void
}

export function CreateBranchModal({ workflowId, workflowName, existingBranches, onClose, onSubmit }: CreateBranchModalProps) {
  const [branchName, setBranchName] = useState(`${workflowName} - `)
  const [branchSuffix, setBranchSuffix] = useState('')
  const [copyProgress, setCopyProgress] = useState(false)
  const [sourceBranchId, setSourceBranchId] = useState<string>('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (branchName.trim()) {
      onSubmit(branchName.trim(), branchSuffix.trim(), copyProgress, sourceBranchId || undefined)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Create Workflow Branch</h2>
              <p className="text-sm text-gray-500 mt-1">Create a new instance of "{workflowName}"</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Branch Name
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Research Workflow - Nov 2025"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Suffix
            </label>
            <input
              type="text"
              value={branchSuffix}
              onChange={(e) => setBranchSuffix(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., {MONTH} {YEAR} or Q4 2025"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Use dynamic placeholders like {'{MONTH}'}, {'{YEAR}'}, {'{QUARTER}'}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="copyProgress"
                checked={copyProgress}
                onChange={(e) => {
                  setCopyProgress(e.target.checked)
                  if (!e.target.checked) {
                    setSourceBranchId('')
                  }
                }}
                className="mr-2 rounded"
              />
              <label htmlFor="copyProgress" className="text-sm text-gray-700">
                Copy progress from an existing branch
              </label>
            </div>

            {copyProgress && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Branch to Copy From
                </label>
                <select
                  value={sourceBranchId}
                  onChange={(e) => setSourceBranchId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={copyProgress}
                >
                  <option value="">Select a branch...</option>
                  {existingBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} - {new Date(branch.branched_at || branch.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                {existingBranches.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    No existing branches available to copy from
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <Button variant="outline" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button type="submit">
              Create Branch
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
