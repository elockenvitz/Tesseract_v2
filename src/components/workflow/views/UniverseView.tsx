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
      {/* Simplified Universe Builder */}
      <SimplifiedUniverseBuilder
        workflowId={workflowId}
        rules={rules}
        onRulesChange={onRulesChange || (() => {})}
        onSave={onSave || (() => {})}
        isEditable={canEdit}
        canEdit={canEdit}
        isEditMode={isEditMode}
        analysts={analysts}
        lists={lists}
        themes={themes}
        portfolios={portfolios}
      />
    </div>
  )
}
