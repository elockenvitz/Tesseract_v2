/**
 * WorkflowTemplateVersionCard Component
 *
 * Displays the active template version information with stats.
 * Part of the Overview view.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'
import { GitBranch, Eye } from 'lucide-react'
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

export interface WorkflowTemplateVersionCardProps {
  versions?: TemplateVersion[]
  onViewAllVersions?: () => void
}

export function WorkflowTemplateVersionCard({
  versions,
  onViewAllVersions
}: WorkflowTemplateVersionCardProps) {
  const activeVersion = versions?.find(v => v.is_active)
  const hasVersions = versions && versions.length > 0

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <GitBranch className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-gray-900">Template Version</h3>
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
                    {activeVersion.description && (
                      <p className="text-xs text-gray-500 mt-1">{activeVersion.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-4 text-xs text-gray-500 pt-2 border-t">
                  <span>{activeVersion.stages?.length || 0} stages</span>
                  <span>•</span>
                  <span>{activeVersion.checklist_templates?.length || 0} checklists</span>
                  <span>•</span>
                  <span>{activeVersion.automation_rules?.length || 0} rules</span>
                  <span>•</span>
                  <span>Created {new Date(activeVersion.created_at).toLocaleDateString()}</span>
                </div>
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
