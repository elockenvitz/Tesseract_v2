import React, { useState, useEffect } from 'react'
import { X, Orbit, Network, Calendar, CalendarDays, CalendarRange, Clock, Timer, CheckCircle2, Bell } from 'lucide-react'
import { Button } from '../ui/Button'
import { processDynamicSuffix } from '../../utils/workflow/workflowSuffixHelpers'

interface WorkflowBranch {
  id: string
  name: string
  branch_suffix: string | null
  branched_at: string
  created_at: string
}

export interface EndingRuleOption {
  id: string
  name: string
  description: string
  conditionType: string
  conditionValue: any
  actionType: string
}

interface CreateBranchModalProps {
  workflowId: string
  workflowName: string
  existingBranches: WorkflowBranch[]
  preselectedSourceBranch?: string | null
  defaultSuffixFormat?: string | null
  /** Available ending rules from the process template */
  endingRules?: EndingRuleOption[]
  onClose: () => void
  onSubmit: (branchName: string, branchSuffix: string, copyProgress: boolean, sourceBranchId?: string, endingRuleId?: string) => void
}

// Quick suffix options
const QUICK_SUFFIX_OPTIONS = [
  {
    format: '{MONTH} {YEAR}',
    label: 'Monthly',
    icon: Calendar,
    description: 'e.g., Dec 2025'
  },
  {
    format: '{QUARTER} {YEAR}',
    label: 'Quarterly',
    icon: CalendarRange,
    description: 'e.g., Q4 2025'
  },
  {
    format: '{YEAR}',
    label: 'Yearly',
    icon: CalendarDays,
    description: 'e.g., 2025'
  },
  {
    format: '{DATE}',
    label: 'Full Date',
    icon: Clock,
    description: 'e.g., Dec 3 2025'
  }
]

export function CreateBranchModal({ workflowId, workflowName, existingBranches, preselectedSourceBranch, defaultSuffixFormat, endingRules = [], onClose, onSubmit }: CreateBranchModalProps) {
  const [branchSuffix, setBranchSuffix] = useState('')
  const [branchSource, setBranchSource] = useState<'template' | 'branch'>(preselectedSourceBranch ? 'branch' : 'template')
  const [sourceBranchId, setSourceBranchId] = useState<string>(preselectedSourceBranch || '')
  const [selectedEndingRuleId, setSelectedEndingRuleId] = useState<string>(endingRules.length === 1 ? endingRules[0].id : '')

  // Pre-populate with default suffix format if set
  useEffect(() => {
    if (defaultSuffixFormat) {
      setBranchSuffix(defaultSuffixFormat)
    }
  }, [defaultSuffixFormat])

  // Process and preview the suffix (handles dynamic placeholders)
  const processedSuffix = processDynamicSuffix(branchSuffix.trim())

  // Construct the full branch name from the base workflow name and processed suffix
  const fullBranchName = processedSuffix
    ? `${workflowName} - ${processedSuffix}`
    : workflowName


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (branchSuffix.trim()) {
      const copyProgress = branchSource === 'branch'
      // Pass the processed suffix (with placeholders resolved)
      onSubmit(fullBranchName, processedSuffix, copyProgress, sourceBranchId || undefined, selectedEndingRuleId || undefined)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 pt-20">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Create Run</h2>
              <p className="text-sm text-gray-500 mt-1">Create a new run of "{workflowName}"</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Run Suffix
            </label>
            <input
              type="text"
              value={branchSuffix}
              onChange={(e) => setBranchSuffix(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Nov 2025 or Q4 2025"
              required
            />

            {/* Quick suffix options */}
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-2">Quick options:</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_SUFFIX_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const isSelected = branchSuffix === option.format
                  return (
                    <button
                      key={option.format}
                      type="button"
                      onClick={() => setBranchSuffix(option.format)}
                      className={`flex items-center space-x-2 px-3 py-2 rounded-lg border text-left transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                          {processDynamicSuffix(option.format)}
                        </div>
                        <div className={`text-xs ${isSelected ? 'text-blue-600' : 'text-gray-500'}`}>
                          {option.label}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Or use placeholders: {'{MONTH}'}, {'{YEAR}'}, {'{QUARTER}'}, {'{DATE}'}
            </p>

            {branchSuffix.trim() && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">
                  <span className="text-gray-500">Branch name:</span>{' '}
                  <span className="font-medium text-gray-900">{fullBranchName}</span>
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Run Source
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
                    No existing runs to copy from
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Run Ending */}
          {endingRules.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Run Ending
              </label>
              <div className="space-y-2">
                {/* No auto-end option */}
                <label className={`flex items-start px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                  !selectedEndingRuleId ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input type="radio" checked={!selectedEndingRuleId} onChange={() => setSelectedEndingRuleId('')}
                    className="mt-0.5 mr-2.5 accent-blue-600" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">End manually</div>
                    <p className="text-xs text-gray-400 mt-0.5">You'll end this run yourself when it's done.</p>
                  </div>
                </label>

                {/* Configured ending rules */}
                {endingRules.map(rule => {
                  const isSelected = selectedEndingRuleId === rule.id
                  const icon = rule.actionType === 'archive_branch' ? Timer : rule.actionType === 'mark_complete' ? CheckCircle2 : Bell
                  const Icon = icon
                  return (
                    <label key={rule.id} className={`flex items-start px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                      isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <input type="radio" checked={isSelected} onChange={() => setSelectedEndingRuleId(rule.id)}
                        className="mt-0.5 mr-2.5 accent-blue-600" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                          <span className="text-sm font-medium text-gray-900">{rule.name}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{rule.description}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <Button variant="outline" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button type="submit">
              Create Run
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
