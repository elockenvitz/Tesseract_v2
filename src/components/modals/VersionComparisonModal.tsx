import React, { useState, useMemo } from 'react'
import { X, ArrowRight, Plus, Minus, Edit, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { formatVersion } from '../../lib/versionUtils'

interface TemplateVersion {
  id: string
  workflow_id: string
  version_number: number
  major_version?: number | null
  minor_version?: number | null
  version_name: string | null
  version_type?: 'major' | 'minor'
  description: string | null
  is_active: boolean
  created_at: string
  created_by: string
  stages: any[]
  checklist_templates: any[]
  automation_rules: any[]
  universe_rules?: any[]
  cadence_days?: number
  cadence_timeframe?: string
  kickoff_cadence?: string
}

interface VersionComparisonModalProps {
  isOpen: boolean
  onClose: () => void
  version1: TemplateVersion
  version2: TemplateVersion
  workflowName: string
}

type DiffType = 'added' | 'removed' | 'modified' | 'unchanged'

interface StageDiff {
  type: DiffType
  stage: any
  oldStage?: any
  changes?: string[]
}

interface Section {
  id: string
  name: string
  icon: React.ReactNode
}

export function VersionComparisonModal({
  isOpen,
  onClose,
  version1,
  version2,
  workflowName
}: VersionComparisonModalProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['stages']))

  if (!isOpen) return null

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId)
    } else {
      newExpanded.add(sectionId)
    }
    setExpandedSections(newExpanded)
  }

  // Determine which is older/newer
  const isVersion1Older = version1.version_number < version2.version_number
  const olderVersion = isVersion1Older ? version1 : version2
  const newerVersion = isVersion1Older ? version2 : version1

  // Compare stages
  const stageDiffs = useMemo(() => {
    const diffs: StageDiff[] = []
    const olderStages = olderVersion.stages || []
    const newerStages = newerVersion.stages || []

    // Find removed and modified stages
    olderStages.forEach(oldStage => {
      const newStage = newerStages.find(s => s.stage_key === oldStage.stage_key)
      if (!newStage) {
        diffs.push({ type: 'removed', stage: oldStage })
      } else {
        const changes: string[] = []
        if (oldStage.stage_label !== newStage.stage_label) {
          changes.push(`Label: "${oldStage.stage_label}" → "${newStage.stage_label}"`)
        }
        if (oldStage.stage_color !== newStage.stage_color) {
          changes.push('Color changed')
        }
        if (oldStage.standard_deadline_days !== newStage.standard_deadline_days) {
          changes.push(`Deadline: ${oldStage.standard_deadline_days} → ${newStage.standard_deadline_days} days`)
        }
        if (oldStage.stage_description !== newStage.stage_description) {
          changes.push('Description changed')
        }
        if (oldStage.sort_order !== newStage.sort_order) {
          changes.push('Order changed')
        }

        if (changes.length > 0) {
          diffs.push({ type: 'modified', stage: newStage, oldStage, changes })
        } else {
          diffs.push({ type: 'unchanged', stage: newStage })
        }
      }
    })

    // Find added stages
    newerStages.forEach(newStage => {
      const oldStage = olderStages.find(s => s.stage_key === newStage.stage_key)
      if (!oldStage) {
        diffs.push({ type: 'added', stage: newStage })
      }
    })

    return diffs.sort((a, b) => {
      const orderA = a.stage.sort_order || 0
      const orderB = b.stage.sort_order || 0
      return orderA - orderB
    })
  }, [olderVersion, newerVersion])

  // Compare universe rules
  const universeRulesDiff = useMemo(() => {
    const oldRules = olderVersion.universe_rules || []
    const newRules = newerVersion.universe_rules || []

    if (oldRules.length === 0 && newRules.length === 0) return null

    const hasChanges = JSON.stringify(oldRules) !== JSON.stringify(newRules)
    return {
      hasChanges,
      oldCount: oldRules.length,
      newCount: newRules.length,
      oldRules,
      newRules
    }
  }, [olderVersion, newerVersion])

  // Compare cadence settings
  const cadenceDiff = useMemo(() => {
    const changes: string[] = []

    if (olderVersion.cadence_days !== newerVersion.cadence_days) {
      changes.push(`Days: ${olderVersion.cadence_days || 'Not set'} → ${newerVersion.cadence_days || 'Not set'}`)
    }
    if (olderVersion.cadence_timeframe !== newerVersion.cadence_timeframe) {
      changes.push(`Timeframe: ${olderVersion.cadence_timeframe || 'Not set'} → ${newerVersion.cadence_timeframe || 'Not set'}`)
    }
    if (olderVersion.kickoff_cadence !== newerVersion.kickoff_cadence) {
      changes.push(`Kickoff: ${olderVersion.kickoff_cadence || 'Not set'} → ${newerVersion.kickoff_cadence || 'Not set'}`)
    }

    return changes.length > 0 ? changes : null
  }, [olderVersion, newerVersion])

  // Compare automation rules
  const automationRulesDiff = useMemo(() => {
    const oldRules = olderVersion.automation_rules || []
    const newRules = newerVersion.automation_rules || []

    if (oldRules.length === 0 && newRules.length === 0) return null

    const hasChanges = JSON.stringify(oldRules) !== JSON.stringify(newRules)
    return {
      hasChanges,
      oldCount: oldRules.length,
      newCount: newRules.length
    }
  }, [olderVersion, newerVersion])

  // Compare checklist templates
  const checklistDiff = useMemo(() => {
    const oldChecklists = olderVersion.checklist_templates || []
    const newChecklists = newerVersion.checklist_templates || []

    if (oldChecklists.length === 0 && newChecklists.length === 0) return null

    const hasChanges = JSON.stringify(oldChecklists) !== JSON.stringify(newChecklists)
    return {
      hasChanges,
      oldCount: oldChecklists.length,
      newCount: newChecklists.length
    }
  }, [olderVersion, newerVersion])

  const getDiffColor = (type: DiffType) => {
    switch (type) {
      case 'added': return 'bg-green-50 border-green-300'
      case 'removed': return 'bg-red-50 border-red-300'
      case 'modified': return 'bg-blue-50 border-blue-300'
      default: return 'bg-white border-gray-200'
    }
  }

  const getDiffIcon = (type: DiffType) => {
    switch (type) {
      case 'added': return <Plus className="w-4 h-4 text-green-600" />
      case 'removed': return <Minus className="w-4 h-4 text-red-600" />
      case 'modified': return <Edit className="w-4 h-4 text-blue-600" />
      default: return null
    }
  }

  const getDiffBadge = (type: DiffType) => {
    switch (type) {
      case 'added': return <Badge className="bg-green-100 text-green-700 border-green-300">Added</Badge>
      case 'removed': return <Badge className="bg-red-100 text-red-700 border-red-300">Removed</Badge>
      case 'modified': return <Badge className="bg-blue-100 text-blue-700 border-blue-300">Modified</Badge>
      default: return null
    }
  }

  const changesCount = stageDiffs.filter(d => d.type !== 'unchanged').length +
    (universeRulesDiff?.hasChanges ? 1 : 0) +
    (cadenceDiff ? 1 : 0) +
    (automationRulesDiff?.hasChanges ? 1 : 0) +
    (checklistDiff?.hasChanges ? 1 : 0)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Version Comparison</h2>
              <div className="flex items-center space-x-2 mt-2">
                <div className="flex items-center space-x-2 px-3 py-1 bg-gray-100 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">
                    {formatVersion(olderVersion.version_number, olderVersion.major_version, olderVersion.minor_version)}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-400" />
                <div className="flex items-center space-x-2 px-3 py-1 bg-primary-100 rounded-lg">
                  <span className="text-sm font-medium text-primary-700">
                    {formatVersion(newerVersion.version_number, newerVersion.major_version, newerVersion.minor_version)}
                  </span>
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                {changesCount} {changesCount === 1 ? 'change' : 'changes'} detected
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Stages Comparison */}
            <div>
              <button
                onClick={() => toggleSection('stages')}
                className="flex items-center space-x-2 w-full mb-3 hover:text-gray-700"
              >
                {expandedSections.has('stages') ? (
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-500" />
                )}
                <h3 className="text-lg font-semibold text-gray-900">
                  Stages {stageDiffs.filter(d => d.type !== 'unchanged').length > 0 && `(${stageDiffs.filter(d => d.type !== 'unchanged').length} changes)`}
                </h3>
              </button>

              {expandedSections.has('stages') && (
                <div className="space-y-2">
                  {stageDiffs.map((diff, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-lg border ${getDiffColor(diff.type)}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3 flex-1">
                          {getDiffIcon(diff.type)}
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-1">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: diff.stage.stage_color }}
                              />
                              <h4 className="font-medium text-gray-900">{diff.stage.stage_label}</h4>
                              {getDiffBadge(diff.type)}
                            </div>
                            {diff.stage.stage_description && (
                              <p className="text-sm text-gray-600 mb-2">{diff.stage.stage_description}</p>
                            )}
                            {diff.type === 'modified' && diff.changes && (
                              <div className="mt-2 space-y-1">
                                {diff.changes.map((change, cidx) => (
                                  <div key={cidx} className="text-xs text-blue-700 flex items-center space-x-1">
                                    <ArrowRight className="w-3 h-3" />
                                    <span>{change}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Universe Rules Comparison */}
            {universeRulesDiff && (
              <div>
                <button
                  onClick={() => toggleSection('universe')}
                  className="flex items-center space-x-2 w-full mb-3 hover:text-gray-700"
                >
                  {expandedSections.has('universe') ? (
                    <ChevronDown className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  )}
                  <h3 className="text-lg font-semibold text-gray-900">
                    Universe Rules {universeRulesDiff.hasChanges && '(Modified)'}
                  </h3>
                </button>

                {expandedSections.has('universe') && (
                  <div className={`p-4 rounded-lg border ${universeRulesDiff.hasChanges ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div>
                          <p className="text-sm text-gray-600">Rule count changed</p>
                          <p className="text-lg font-semibold text-gray-900">
                            {universeRulesDiff.oldCount} → {universeRulesDiff.newCount}
                          </p>
                        </div>
                      </div>
                      {universeRulesDiff.hasChanges && (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-300">Modified</Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cadence Comparison */}
            {cadenceDiff && (
              <div>
                <button
                  onClick={() => toggleSection('cadence')}
                  className="flex items-center space-x-2 w-full mb-3 hover:text-gray-700"
                >
                  {expandedSections.has('cadence') ? (
                    <ChevronDown className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  )}
                  <h3 className="text-lg font-semibold text-gray-900">
                    Cadence Settings (Modified)
                  </h3>
                </button>

                {expandedSections.has('cadence') && (
                  <div className="p-4 rounded-lg border bg-blue-50 border-blue-300">
                    <div className="space-y-2">
                      {cadenceDiff.map((change, idx) => (
                        <div key={idx} className="flex items-center space-x-2 text-sm text-blue-700">
                          <ArrowRight className="w-3 h-3" />
                          <span>{change}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Automation Rules Comparison */}
            {automationRulesDiff && (
              <div>
                <button
                  onClick={() => toggleSection('automation')}
                  className="flex items-center space-x-2 w-full mb-3 hover:text-gray-700"
                >
                  {expandedSections.has('automation') ? (
                    <ChevronDown className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  )}
                  <h3 className="text-lg font-semibold text-gray-900">
                    Automation Rules {automationRulesDiff.hasChanges && '(Modified)'}
                  </h3>
                </button>

                {expandedSections.has('automation') && (
                  <div className={`p-4 rounded-lg border ${automationRulesDiff.hasChanges ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div>
                          <p className="text-sm text-gray-600">Rule count changed</p>
                          <p className="text-lg font-semibold text-gray-900">
                            {automationRulesDiff.oldCount} → {automationRulesDiff.newCount}
                          </p>
                        </div>
                      </div>
                      {automationRulesDiff.hasChanges && (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-300">Modified</Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Checklist Templates Comparison */}
            {checklistDiff && (
              <div>
                <button
                  onClick={() => toggleSection('checklists')}
                  className="flex items-center space-x-2 w-full mb-3 hover:text-gray-700"
                >
                  {expandedSections.has('checklists') ? (
                    <ChevronDown className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  )}
                  <h3 className="text-lg font-semibold text-gray-900">
                    Checklist Templates {checklistDiff.hasChanges && '(Modified)'}
                  </h3>
                </button>

                {expandedSections.has('checklists') && (
                  <div className={`p-4 rounded-lg border ${checklistDiff.hasChanges ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div>
                          <p className="text-sm text-gray-600">Checklist count changed</p>
                          <p className="text-lg font-semibold text-gray-900">
                            {checklistDiff.oldCount} → {checklistDiff.newCount}
                          </p>
                        </div>
                      </div>
                      {checklistDiff.hasChanges && (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-300">Modified</Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* No changes message */}
            {changesCount === 0 && (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                  <Check className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Changes Detected</h3>
                <p className="text-sm text-gray-500">
                  These versions appear to be identical
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
