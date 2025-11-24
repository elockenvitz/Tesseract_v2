/**
 * UniverseView Component
 *
 * Complete Universe tab view for workflows.
 * Displays and manages universe rules that filter which assets
 * are eligible for this workflow.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { AlertCircle } from 'lucide-react'
import { SimplifiedUniverseBuilder } from '../SimplifiedUniverseBuilder'

export interface FilterRule {
  id: string
  type: string
  operator: any
  values: any
  combineWith?: 'AND' | 'OR'
}

export interface DropdownOption {
  value: string
  label: string
}

export interface UniverseViewProps {
  /** The workflow ID */
  workflowId: string

  /** Current universe rules */
  rules: FilterRule[]

  /** Whether the workflow is in template edit mode */
  isEditMode?: boolean

  /** Whether user has admin permission */
  canEdit?: boolean

  /** Available analysts for analyst filter */
  analysts?: DropdownOption[]

  /** Available asset lists for list filter */
  lists?: DropdownOption[]

  /** Available themes for theme filter */
  themes?: DropdownOption[]

  /** Available portfolios for portfolio filter */
  portfolios?: DropdownOption[]

  /** Callback when rules change */
  onRulesChange?: (rules: FilterRule[]) => void

  /** Callback to save rules */
  onSave?: () => void
}

export function UniverseView({
  workflowId,
  rules,
  isEditMode = false,
  canEdit = false,
  analysts = [],
  lists = [],
  themes = [],
  portfolios = [],
  onRulesChange,
  onSave
}: UniverseViewProps) {
  return (
    <div className="space-y-6">
      {/* Info Banner - Show if not in edit mode but user can edit */}
      {canEdit && !isEditMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-blue-900 font-medium">Template Edit Mode</p>
            <p className="text-sm text-blue-700 mt-1">
              Click <strong>"Edit Template"</strong> in the header to modify universe rules that determine which assets are eligible for this workflow.
            </p>
          </div>
        </div>
      )}

      {/* Simplified Universe Builder */}
      <SimplifiedUniverseBuilder
        workflowId={workflowId}
        rules={rules}
        onRulesChange={onRulesChange || (() => {})}
        onSave={onSave || (() => {})}
        isEditable={isEditMode}
        analysts={analysts}
        lists={lists}
        themes={themes}
        portfolios={portfolios}
      />
    </div>
  )
}
