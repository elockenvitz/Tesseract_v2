import React, { useState } from 'react'
import { X, GitBranch, CheckCircle, Clock, Eye, Plus, ChevronDown, ChevronRight, GitCompare } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { VersionComparisonModal } from './VersionComparisonModal'

interface TemplateVersion {
  id: string
  workflow_id: string
  version_number: number
  version_name: string | null
  version_type?: 'major' | 'minor'
  description: string | null
  is_active: boolean
  created_at: string
  created_by: string
  stages: any[]
  checklist_templates: any[]
  automation_rules: any[]
}

interface TemplateVersionsModalProps {
  isOpen: boolean
  onClose: () => void
  workflowId: string
  workflowName: string
  versions: TemplateVersion[]
  canCreateVersion: boolean
  onCreateVersion: () => void
  onViewVersion: (versionId: string) => void
}

export function TemplateVersionsModal({
  isOpen,
  onClose,
  workflowId,
  workflowName,
  versions,
  canCreateVersion,
  onCreateVersion,
  onViewVersion
}: TemplateVersionsModalProps) {
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set())
  const [compareMode, setCompareMode] = useState(false)
  const [selectedVersions, setSelectedVersions] = useState<string[]>([])
  const [showComparison, setShowComparison] = useState(false)

  if (!isOpen) return null

  const toggleExpanded = (versionId: string) => {
    const newExpanded = new Set(expandedVersions)
    if (newExpanded.has(versionId)) {
      newExpanded.delete(versionId)
    } else {
      newExpanded.add(versionId)
    }
    setExpandedVersions(newExpanded)
  }

  const toggleVersionSelection = (versionId: string) => {
    setSelectedVersions(prev => {
      if (prev.includes(versionId)) {
        return prev.filter(id => id !== versionId)
      } else if (prev.length < 2) {
        return [...prev, versionId]
      } else {
        // Replace the first selected version
        return [prev[1], versionId]
      }
    })
  }

  const handleCompare = () => {
    if (selectedVersions.length === 2) {
      setShowComparison(true)
    }
  }

  const handleCancelCompare = () => {
    setCompareMode(false)
    setSelectedVersions([])
  }

  const sortedVersions = [...versions].sort((a, b) => b.version_number - a.version_number)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <GitBranch className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-gray-900">Template Versions</h2>
              {compareMode && (
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                  Compare Mode
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {compareMode
                ? `Select 2 versions to compare (${selectedVersions.length}/2 selected)`
                : `Version history for "${workflowName}"`
              }
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {versions.length === 0 ? (
            <div className="text-center py-12">
              <GitBranch className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No versions yet</h3>
              <p className="text-sm text-gray-500 mb-4">
                Create your first template version to start tracking changes
              </p>
              {canCreateVersion && (
                <Button onClick={onCreateVersion}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Version 1
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {sortedVersions.map((version) => {
                const isExpanded = expandedVersions.has(version.id)
                const stageCount = version.stages?.length || 0
                const checklistCount = version.checklist_templates?.length || 0
                const ruleCount = version.automation_rules?.length || 0

                const isSelected = selectedVersions.includes(version.id)

                return (
                  <Card
                    key={version.id}
                    className={compareMode && isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''}
                  >
                    <div className="p-4">
                      {/* Version Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3 flex-1">
                          {compareMode ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleVersionSelection(version.id)}
                              className="mt-1.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                          ) : (
                            <button
                              onClick={() => toggleExpanded(version.id)}
                              className="mt-1 p-1 hover:bg-gray-100 rounded transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-500" />
                              )}
                            </button>
                          )}
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-1">
                              <h3 className="text-base font-semibold text-gray-900">
                                Version {version.version_number}
                                {version.version_name && ` - ${version.version_name}`}
                              </h3>
                              {version.version_type && (
                                <span className={`px-2 py-0.5 rounded-full text-xs flex items-center ${
                                  version.version_type === 'major'
                                    ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                    : 'bg-blue-100 text-blue-700 border border-blue-300'
                                }`}>
                                  {version.version_type === 'major' ? 'Major' : 'Minor'}
                                </span>
                              )}
                              {version.is_active && (
                                <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300 flex items-center space-x-1">
                                  <CheckCircle className="w-3 h-3" />
                                  <span>Active</span>
                                </span>
                              )}
                            </div>
                            {version.description && (
                              <p className="text-sm text-gray-600 mb-2">{version.description}</p>
                            )}
                            <div className="flex items-center space-x-4 text-xs text-gray-500">
                              <div className="flex items-center space-x-1">
                                <Clock className="w-3 h-3" />
                                <span>
                                  {new Date(version.created_at).toLocaleDateString()} at{' '}
                                  {new Date(version.created_at).toLocaleTimeString()}
                                </span>
                              </div>
                              <span>•</span>
                              <span>{stageCount} stages</span>
                              <span>•</span>
                              <span>{checklistCount} checklists</span>
                              <span>•</span>
                              <span>{ruleCount} rules</span>
                            </div>
                          </div>
                        </div>
                        {!compareMode && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onViewVersion(version.id)}
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </Button>
                        )}
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="mt-4 pl-8 space-y-3 border-l-2 border-gray-200">
                          {/* Stages */}
                          {stageCount > 0 && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 mb-2">
                                Stages ({stageCount})
                              </h4>
                              <div className="space-y-1">
                                {version.stages.map((stage: any, idx: number) => (
                                  <div
                                    key={idx}
                                    className="text-xs text-gray-600 flex items-center space-x-2"
                                  >
                                    <div
                                      className="w-2 h-2 rounded-full"
                                      style={{ backgroundColor: stage.color || '#6B7280' }}
                                    />
                                    <span>{stage.name}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Checklist Templates */}
                          {checklistCount > 0 && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 mb-2">
                                Checklist Templates ({checklistCount})
                              </h4>
                              <div className="space-y-1">
                                {version.checklist_templates.slice(0, 5).map((item: any, idx: number) => (
                                  <div key={idx} className="text-xs text-gray-600">
                                    • {item.name}
                                  </div>
                                ))}
                                {checklistCount > 5 && (
                                  <div className="text-xs text-gray-500 italic">
                                    +{checklistCount - 5} more...
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Automation Rules */}
                          {ruleCount > 0 && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 mb-2">
                                Automation Rules ({ruleCount})
                              </h4>
                              <div className="space-y-1">
                                {version.automation_rules.slice(0, 3).map((rule: any, idx: number) => (
                                  <div key={idx} className="text-xs text-gray-600">
                                    • {rule.name}
                                  </div>
                                ))}
                                {ruleCount > 3 && (
                                  <div className="text-xs text-gray-500 italic">
                                    +{ruleCount - 3} more...
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {versions.length} {versions.length === 1 ? 'version' : 'versions'} total
          </div>
          <div className="flex items-center space-x-3">
            {compareMode ? (
              <>
                <Button onClick={handleCancelCompare} variant="outline">
                  Cancel
                </Button>
                <Button
                  onClick={handleCompare}
                  disabled={selectedVersions.length !== 2}
                >
                  <GitCompare className="w-4 h-4 mr-1" />
                  Compare Selected
                </Button>
              </>
            ) : (
              <>
                {versions.length >= 2 && (
                  <Button onClick={() => setCompareMode(true)} variant="outline">
                    <GitCompare className="w-4 h-4 mr-1" />
                    Compare Versions
                  </Button>
                )}
                <Button onClick={onClose} variant="outline">
                  Close
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Comparison Modal */}
      {showComparison && selectedVersions.length === 2 && (
        <VersionComparisonModal
          isOpen={showComparison}
          onClose={() => {
            setShowComparison(false)
            setCompareMode(false)
            setSelectedVersions([])
          }}
          version1={versions.find(v => v.id === selectedVersions[0])!}
          version2={versions.find(v => v.id === selectedVersions[1])!}
          workflowName={workflowName}
        />
      )}
    </div>
  )
}
