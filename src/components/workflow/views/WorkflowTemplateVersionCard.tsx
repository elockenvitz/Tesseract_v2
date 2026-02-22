/**
 * WorkflowTemplateVersionCard Component
 *
 * Displays the active template version information with stats.
 * Part of the Overview view.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React, { useState } from 'react'
import { GitBranch, Eye, ChevronDown, ChevronRight, CheckSquare } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { formatVersion } from '../../../lib/versionUtils'

export interface TemplateVersion {
  id: string
  version_number: number
  major_version?: number
  minor_version?: number
  description?: string
  is_active: boolean
  created_at: string
  stages?: any[]
  checklist_templates?: any[]
  automation_rules?: any[]
}

interface StageInfo {
  id: string
  stage_label: string
  stage_key?: string
  sort_order?: number
}

interface ChecklistItemInfo {
  id: string
  item_text: string
  stage_id?: string
  sort_order?: number
}

export interface WorkflowTemplateVersionCardProps {
  versions?: TemplateVersion[]
  stages?: StageInfo[]
  checklistItems?: ChecklistItemInfo[]
  onViewAllVersions?: () => void
}

export function WorkflowTemplateVersionCard({
  versions,
  stages,
  checklistItems,
  onViewAllVersions
}: WorkflowTemplateVersionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const activeVersion = versions?.find(v => v.is_active)
  const hasVersions = versions && versions.length > 0

  // Derive a clean display description — hide verbose auto-generated change logs
  const displayDescription = (() => {
    const desc = activeVersion?.description
    if (!desc) return null
    // Auto-generated notes start with "•" — too verbose for the overview card
    if (desc.trimStart().startsWith('•')) return null
    // Truncate long freeform descriptions
    if (desc.length > 120) return desc.slice(0, 117) + '…'
    return desc
  })()

  return (
    <Card className="flex flex-col">
      <div className="p-5 flex-1">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <GitBranch className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-gray-900">Process Definition</h3>
          </div>
          {onViewAllVersions && hasVersions && (
            <Button
              size="sm"
              variant="outline"
              onClick={onViewAllVersions}
            >
              <Eye className="w-4 h-4 mr-2" />
              View All Versions
            </Button>
          )}
        </div>

        {hasVersions ? (
          <div className="space-y-3">
            {activeVersion ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-gray-900">
                        {formatVersion(
                          activeVersion.version_number,
                          activeVersion.major_version,
                          activeVersion.minor_version
                        )}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300">
                        Active
                      </span>
                    </div>
                    {displayDescription && (
                      <p className="text-xs text-gray-500 mt-1">{displayDescription}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="w-full flex items-center justify-between pt-2 border-t group/expand cursor-pointer"
                >
                  <div className="flex items-center space-x-4 text-xs text-gray-500">
                    <span>{stages?.length || activeVersion.stages?.length || 0} stages</span>
                    <span>•</span>
                    <span>{checklistItems?.length || activeVersion.checklist_templates?.length || 0} checklists</span>
                    <span>•</span>
                    <span>{activeVersion.automation_rules?.length || 0} rules</span>
                    <span>•</span>
                    <span>Created {new Date(activeVersion.created_at).toLocaleDateString()}</span>
                  </div>
                  {expanded
                    ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                    : <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover/expand:text-gray-600" />
                  }
                </button>

                {expanded && stages && stages.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {stages.map((stage, idx) => {
                      const stageChecklist = (checklistItems || []).filter(
                        c => c.stage_id === stage.stage_key || c.stage_id === stage.id
                      )
                      return (
                        <div key={stage.id} className="rounded-md border border-gray-100 bg-gray-50/50">
                          <div className="flex items-center space-x-2 px-3 py-2">
                            <span className="text-[10px] font-medium text-gray-400 w-4 text-right">{idx + 1}</span>
                            <span className="text-sm font-medium text-gray-800">{stage.stage_label}</span>
                            {stageChecklist.length > 0 && (
                              <span className="text-[10px] text-gray-400">{stageChecklist.length} items</span>
                            )}
                          </div>
                          {stageChecklist.length > 0 && (
                            <div className="px-3 pb-2 space-y-0.5">
                              {stageChecklist.map(item => (
                                <div key={item.id} className="flex items-center space-x-2 pl-6">
                                  <CheckSquare className="w-3 h-3 text-gray-300 flex-shrink-0" />
                                  <span className="text-xs text-gray-500">{item.item_text}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500">No active version</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500 mb-2">No versions created yet</p>
            <p className="text-xs text-gray-400">Create a version to track template changes over time</p>
          </div>
        )}
      </div>
    </Card>
  )
}
