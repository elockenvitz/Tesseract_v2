/**
 * WorkflowHeader Component
 *
 * Header section for selected workflow showing:
 * - Workflow title and description (editable in template edit mode)
 * - Edit template controls
 * - Tab navigation
 *
 * Extracted from WorkflowsPage.tsx during Phase 2 refactoring.
 */

import React from 'react'
import { Pencil, Save, X, AlertCircle, ChevronDown, BarChart3, UserCog, Globe, Target, Calendar, Network, Copy } from 'lucide-react'
import { Button } from '../../ui/Button'
import { WorkflowWithStats } from '../../../types/workflow/workflow.types'

interface TemplateChange {
  type: string
  description: string
  timestamp: number
}

interface WorkflowHeaderProps {
  workflow: WorkflowWithStats
  activeView: 'overview' | 'admins' | 'universe' | 'stages' | 'cadence' | 'branches' | 'models'
  onTabChange: (view: 'overview' | 'admins' | 'universe' | 'stages' | 'cadence' | 'branches' | 'models') => void

  // Template edit mode
  isTemplateEditMode?: boolean
  templateChanges?: TemplateChange[]
  onEnterEditMode?: () => void
  onCancelEdit?: () => void
  onSaveChanges?: () => void
  showChangesList?: boolean
  setShowChangesList?: (show: boolean) => void
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'admins', label: 'Team & Admins', icon: UserCog },
  { id: 'universe', label: 'Universe', icon: Globe },
  { id: 'stages', label: 'Stages', icon: Target },
  { id: 'cadence', label: 'Cadence', icon: Calendar },
  { id: 'branches', label: 'Branches', icon: Network },
  { id: 'models', label: 'Models', icon: Copy }
] as const

export function WorkflowHeader({
  workflow,
  activeView,
  onTabChange,
  isTemplateEditMode = false,
  templateChanges = [],
  onEnterEditMode,
  onCancelEdit,
  onSaveChanges,
  showChangesList = false,
  setShowChangesList
}: WorkflowHeaderProps) {
  const canEdit = workflow.user_permission === 'admin'

  return (
    <>
      {/* Workflow Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center space-x-4">
          {isTemplateEditMode ? (
            <>
              <div
                className="w-8 h-8 rounded-full flex-shrink-0"
                style={{ backgroundColor: workflow.color }}
              />
              <div className="flex-1 flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{workflow.name}</h1>
                  <p className="text-gray-600 text-sm">{workflow.description}</p>
                  <p className="text-xs text-amber-600 mt-1">
                    Template Edit Mode - Make your changes then Save & Version
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  {/* Changes Counter */}
                  {setShowChangesList && (
                    <button
                      onClick={() => setShowChangesList(!showChangesList)}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors border border-amber-300"
                      title="View changes"
                    >
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {templateChanges.length} change{templateChanges.length !== 1 ? 's' : ''}
                      </span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showChangesList ? 'rotate-180' : ''}`} />
                    </button>
                  )}

                  {/* Cancel Button */}
                  {onCancelEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onCancelEdit}
                      className="flex items-center space-x-2"
                    >
                      <X className="w-4 h-4" />
                      <span>Cancel</span>
                    </Button>
                  )}

                  {/* Save Button */}
                  {onSaveChanges && (
                    <Button
                      size="sm"
                      onClick={onSaveChanges}
                      disabled={templateChanges.length === 0}
                      className="flex items-center space-x-2"
                    >
                      <Save className="w-4 h-4" />
                      <span>Save & Version</span>
                    </Button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div
                className="w-8 h-8 rounded-full flex-shrink-0"
                style={{ backgroundColor: workflow.color }}
              />
              <div className="flex-1 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">{workflow.name}</h1>
                    <p className="text-gray-600 text-sm">{workflow.description}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  {canEdit && onEnterEditMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onEnterEditMode}
                      className="flex items-center space-x-2"
                    >
                      <Pencil className="w-4 h-4" />
                      <span>Edit Template</span>
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 bg-white">
        <nav className="flex space-x-8 px-6">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id as any)}
                className={`flex items-center space-x-2 py-4 px-1 border-b-2 text-sm font-medium transition-colors ${
                  activeView === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </>
  )
}
