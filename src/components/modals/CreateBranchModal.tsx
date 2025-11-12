import React, { useState } from 'react'
import { X, Orbit, Network } from 'lucide-react'
import { Button } from '../ui/Button'

interface WorkflowBranch {
  id: string
  name: string
  branch_suffix: string | null
  branched_at: string
  created_at: string
}

interface CreateBranchModalProps {
  workflowId: string
  workflowName: string
  existingBranches: WorkflowBranch[]
  preselectedSourceBranch?: string | null
  onClose: () => void
  onSubmit: (branchName: string, branchSuffix: string, copyProgress: boolean, sourceBranchId?: string) => void
}

export function CreateBranchModal({ workflowId, workflowName, existingBranches, preselectedSourceBranch, onClose, onSubmit }: CreateBranchModalProps) {
  const [branchName, setBranchName] = useState(`${workflowName} - `)
  const [branchSuffix, setBranchSuffix] = useState('')
  const [branchSource, setBranchSource] = useState<'template' | 'branch'>(preselectedSourceBranch ? 'branch' : 'template')
  const [sourceBranchId, setSourceBranchId] = useState<string>(preselectedSourceBranch || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (branchName.trim()) {
      const copyProgress = branchSource === 'branch'
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
              <p className="text-sm text-gray-500 mt-1">Create a new branch of "{workflowName}"</p>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Branch Source
            </label>

            {/* Branch from Template Option */}
            <div
              className={`border-2 rounded-lg p-3 cursor-pointer transition-all ${
                branchSource === 'template'
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => {
                setBranchSource('template')
                setSourceBranchId('')
              }}
            >
              <div className="flex items-start">
                <input
                  type="radio"
                  id="sourceTemplate"
                  name="branchSource"
                  checked={branchSource === 'template'}
                  onChange={() => {
                    setBranchSource('template')
                    setSourceBranchId('')
                  }}
                  className="mt-0.5 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <Orbit className="w-4 h-4 text-indigo-600" />
                    <label htmlFor="sourceTemplate" className="text-sm font-medium text-gray-900 cursor-pointer">
                      Create clean branch from template
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    Start fresh with the original workflow template (no existing progress)
                  </p>
                </div>
              </div>
            </div>

            {/* Branch from Existing Branch Option */}
            <div
              className={`border-2 rounded-lg p-3 cursor-pointer transition-all ${
                branchSource === 'branch'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => setBranchSource('branch')}
            >
              <div className="flex items-start">
                <input
                  type="radio"
                  id="sourceBranch"
                  name="branchSource"
                  checked={branchSource === 'branch'}
                  onChange={() => setBranchSource('branch')}
                  className="mt-0.5 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <Network className="w-4 h-4 text-blue-600" />
                    <label htmlFor="sourceBranch" className="text-sm font-medium text-gray-900 cursor-pointer">
                      Copy data from existing branch
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    Create a new branch with copied progress from an existing branch
                  </p>
                </div>
              </div>
            </div>

            {/* Branch Selection Dropdown - Only shown when branching from existing branch */}
            {branchSource === 'branch' && (
              <div className="ml-6 mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Branch to Copy From
                </label>
                <select
                  value={sourceBranchId}
                  onChange={(e) => setSourceBranchId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={branchSource === 'branch'}
                >
                  <option value="">Select a branch...</option>
                  {existingBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}{branch.branch_suffix ? ` (${branch.branch_suffix})` : ''} - {new Date(branch.branched_at || branch.created_at).toLocaleDateString()}
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
