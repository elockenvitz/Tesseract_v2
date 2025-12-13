import React, { useState } from 'react'
import { X, GitBranch, CheckCircle, Clock, ChevronDown, ChevronRight, List, Zap, Target } from 'lucide-react'
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
  branch_ending_rules?: any[]
  cadence_days?: number
  cadence_timeframe?: string
  kickoff_cadence?: string
}

interface VersionDetailModalProps {
  isOpen: boolean
  onClose: () => void
  version: TemplateVersion
  workflowName: string
}

export function VersionDetailModal({
  isOpen,
  onClose,
  version,
  workflowName
}: VersionDetailModalProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  )

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

  const stageCount = version.stages?.length || 0
  const checklistCount = version.checklist_templates?.length || 0
  const branchCreationRuleCount = version.automation_rules?.length || 0
  const assetPopulationRuleCount = version.universe_rules?.length || 0
  const branchEndingRuleCount = version.branch_ending_rules?.length || 0

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[75vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-1">
                <GitBranch className="w-5 h-5 text-indigo-600" />
                <h2 className="text-lg font-bold text-gray-900">
                  {formatVersion(version.version_number, version.major_version, version.minor_version)}
                </h2>
                {version.version_type && (
                  <Badge className={
                    version.version_type === 'major'
                      ? 'bg-amber-100 text-amber-700 border-amber-300'
                      : 'bg-blue-100 text-blue-700 border-blue-300'
                  }>
                    {version.version_type === 'major' ? 'Major' : 'Minor'}
                  </Badge>
                )}
                {version.is_active && (
                  <Badge className="bg-green-100 text-green-700 border-green-300">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                )}
              </div>
              <p className="text-sm text-gray-600 mb-1">{workflowName}</p>
              {version.description && (
                <p className="text-sm text-gray-700 mb-2">{version.description}</p>
              )}
              <div className="flex items-center space-x-1 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                <span>
                  Created {new Date(version.created_at).toLocaleDateString()} at{' '}
                  {new Date(version.created_at).toLocaleTimeString()}
                </span>
              </div>
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
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-5 gap-3">
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Stages</p>
                    <p className="text-xl font-bold text-gray-900">{stageCount}</p>
                  </div>
                  <Target className="w-6 h-6 text-indigo-600 opacity-20" />
                </div>
              </Card>
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Checklists</p>
                    <p className="text-xl font-bold text-gray-900">{checklistCount}</p>
                  </div>
                  <List className="w-6 h-6 text-blue-600 opacity-20" />
                </div>
              </Card>
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Creation</p>
                    <p className="text-xl font-bold text-gray-900">{branchCreationRuleCount}</p>
                  </div>
                  <Zap className="w-6 h-6 text-amber-600 opacity-20" />
                </div>
              </Card>
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Population</p>
                    <p className="text-xl font-bold text-gray-900">{assetPopulationRuleCount}</p>
                  </div>
                  <GitBranch className="w-6 h-6 text-purple-600 opacity-20" />
                </div>
              </Card>
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Ending</p>
                    <p className="text-xl font-bold text-gray-900">{branchEndingRuleCount}</p>
                  </div>
                  <X className="w-6 h-6 text-red-600 opacity-20" />
                </div>
              </Card>
            </div>

            {/* Stages Section with Collapsible Checklists */}
            {stageCount > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Stages ({stageCount})
                </h3>

                <div className="space-y-2">
                  {(() => {
                    // Group checklists by stage
                    const stages = version.stages || []
                    const sortedStages = [...stages].sort((a, b) =>
                      (a.sort_order ?? a.order_index ?? 0) - (b.sort_order ?? b.order_index ?? 0)
                    )

                    // Group checklists by stage
                    const checklistsByStage = new Map<string, any[]>()
                    version.checklist_templates?.forEach((item: any) => {
                      const stageId = item.stage_id || item.stage_key || 'unknown'
                      if (!checklistsByStage.has(stageId)) {
                        checklistsByStage.set(stageId, [])
                      }
                      checklistsByStage.get(stageId)!.push(item)
                    })

                    // Sort checklists within each stage by sort_order
                    checklistsByStage.forEach((items) => {
                      items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    })

                    return sortedStages.map((stage: any) => {
                      const stageKey = stage.stage_key || stage.key || stage.id
                      const stageItems = checklistsByStage.get(stageKey) || []
                      const isExpanded = expandedSections.has(`stage-${stageKey}`)

                      return (
                        <Card key={stageKey} className="overflow-hidden">
                          <button
                            onClick={() => toggleSection(`stage-${stageKey}`)}
                            className="w-full p-4 flex items-start space-x-3 hover:bg-gray-50 transition-colors text-left"
                          >
                            <div className="flex items-center space-x-2 mt-0.5">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-gray-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-400" />
                              )}
                              <div
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: stage.stage_color || stage.color || '#6B7280' }}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <h4 className="font-semibold text-gray-900">
                                  {stage.stage_label || stage.name}
                                </h4>
                                <span className="text-xs text-gray-500">
                                  {stageItems.length} item{stageItems.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                              {(stage.stage_description || stage.description) && (
                                <p className="text-sm text-gray-500 mt-0.5">{stage.stage_description || stage.description}</p>
                              )}
                            </div>
                          </button>

                          {isExpanded && stageItems.length > 0 && (
                            <div className="px-4 pb-4 pt-0 ml-9 border-t border-gray-100">
                              <div className="pt-3 space-y-2">
                                {stageItems.map((item: any, idx: number) => (
                                  <div
                                    key={idx}
                                    className="flex items-start space-x-2 py-1"
                                  >
                                    <div className="flex-shrink-0 w-4 h-4 border border-gray-300 rounded mt-0.5" />
                                    <p className="flex-1 text-sm text-gray-700">{item.item_text || item.name}</p>
                                    {item.is_required && (
                                      <Badge className="bg-red-100 text-red-700 text-xs">Required</Badge>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </Card>
                      )
                    })
                  })()}
                </div>
              </div>
            )}

            {/* Branch Creation Rules Section */}
            {branchCreationRuleCount > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Branch Creation Rules ({branchCreationRuleCount})
                </h3>
                <div className="space-y-2">
                  {version.automation_rules.map((rule: any, idx: number) => {
                    const ruleKey = `creation-${idx}`
                    const isExpanded = expandedSections.has(ruleKey)
                    return (
                      <Card key={idx} className="overflow-hidden">
                        <button
                          onClick={() => toggleSection(ruleKey)}
                          className="w-full p-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center space-x-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                            <Zap className="w-4 h-4 text-amber-500" />
                            <span className="font-medium text-gray-900">
                              {rule.rule_name || rule.name || `Rule ${idx + 1}`}
                            </span>
                          </div>
                          <Badge className={rule.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                            {rule.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-0 ml-6 border-t border-gray-100">
                            <div className="pt-3 grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Trigger</p>
                                <p className="text-gray-700">
                                  {rule.condition_type || rule.trigger_type}: {rule.condition_value || rule.trigger_value}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Action</p>
                                <p className="text-gray-700">
                                  {rule.action_type}: {rule.action_value}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Asset Population Rules Section */}
            {assetPopulationRuleCount > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Asset Population Rules ({assetPopulationRuleCount})
                </h3>
                <div className="space-y-2">
                  {version.universe_rules?.map((rule: any, idx: number) => {
                    const ruleKey = `population-${idx}`
                    const isExpanded = expandedSections.has(ruleKey)
                    return (
                      <Card key={idx} className="overflow-hidden">
                        <button
                          onClick={() => toggleSection(ruleKey)}
                          className="w-full p-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center space-x-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                            <GitBranch className="w-4 h-4 text-purple-500" />
                            <span className="font-medium text-gray-900">
                              {rule.rule_name || rule.name || `Rule ${idx + 1}`}
                            </span>
                          </div>
                          <Badge className={rule.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                            {rule.is_active !== false ? 'Active' : 'Inactive'}
                          </Badge>
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-0 ml-6 border-t border-gray-100">
                            <div className="pt-3 text-sm">
                              <p className="text-xs text-gray-500 mb-1">Description</p>
                              <p className="text-gray-700">
                                {rule.rule_description || rule.description || 'No description'}
                              </p>
                              {rule.rule_type && (
                                <div className="mt-2">
                                  <p className="text-xs text-gray-500 mb-1">Type</p>
                                  <p className="text-gray-700">{rule.rule_type}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Branch Ending Rules Section */}
            {branchEndingRuleCount > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Branch Ending Rules ({branchEndingRuleCount})
                </h3>
                <div className="space-y-2">
                  {version.branch_ending_rules?.map((rule: any, idx: number) => {
                    const ruleKey = `ending-${idx}`
                    const isExpanded = expandedSections.has(ruleKey)
                    return (
                      <Card key={idx} className="overflow-hidden">
                        <button
                          onClick={() => toggleSection(ruleKey)}
                          className="w-full p-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center space-x-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                            <X className="w-4 h-4 text-red-500" />
                            <span className="font-medium text-gray-900">
                              {rule.rule_name || rule.name || `Rule ${idx + 1}`}
                            </span>
                          </div>
                          <Badge className={rule.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                            {rule.is_active !== false ? 'Active' : 'Inactive'}
                          </Badge>
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-0 ml-6 border-t border-gray-100">
                            <div className="pt-3 grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Trigger</p>
                                <p className="text-gray-700">
                                  {rule.condition_type || rule.trigger_type || 'Not specified'}: {rule.condition_value || rule.trigger_value || ''}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Action</p>
                                <p className="text-gray-700">
                                  {rule.action_type || 'End branch'}: {rule.action_value || ''}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Cadence Information */}
            {(version.cadence_days || version.cadence_timeframe || version.kickoff_cadence) && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Cadence Settings</h3>
                <Card className="p-4">
                  <div className="grid grid-cols-3 gap-4">
                    {version.cadence_days && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Cadence Days</p>
                        <p className="text-lg font-semibold text-gray-900">{version.cadence_days}</p>
                      </div>
                    )}
                    {version.cadence_timeframe && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Timeframe</p>
                        <p className="text-lg font-semibold text-gray-900">{version.cadence_timeframe}</p>
                      </div>
                    )}
                    {version.kickoff_cadence && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Kickoff Cadence</p>
                        <p className="text-lg font-semibold text-gray-900">{version.kickoff_cadence}</p>
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end flex-shrink-0">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
