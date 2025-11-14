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
    new Set(['stages', 'checklists', 'automation', 'universe'])
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
  const ruleCount = version.automation_rules?.length || 0
  const universeRuleCount = version.universe_rules?.length || 0

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
            <div className="grid grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Stages</p>
                    <p className="text-2xl font-bold text-gray-900">{stageCount}</p>
                  </div>
                  <Target className="w-8 h-8 text-indigo-600 opacity-20" />
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Checklists</p>
                    <p className="text-2xl font-bold text-gray-900">{checklistCount}</p>
                  </div>
                  <List className="w-8 h-8 text-blue-600 opacity-20" />
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Auto Rules</p>
                    <p className="text-2xl font-bold text-gray-900">{ruleCount}</p>
                  </div>
                  <Zap className="w-8 h-8 text-amber-600 opacity-20" />
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Universe</p>
                    <p className="text-2xl font-bold text-gray-900">{universeRuleCount}</p>
                  </div>
                  <GitBranch className="w-8 h-8 text-purple-600 opacity-20" />
                </div>
              </Card>
            </div>

            {/* Stages Section */}
            {stageCount > 0 && (
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
                    Stages ({stageCount})
                  </h3>
                </button>

                {expandedSections.has('stages') && (
                  <div className="space-y-2">
                    {version.stages.map((stage: any, idx: number) => (
                      <Card key={idx} className="p-4">
                        <div className="flex items-start space-x-3">
                          <div
                            className="w-4 h-4 rounded-full mt-0.5 flex-shrink-0"
                            style={{ backgroundColor: stage.stage_color || stage.color || '#6B7280' }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-semibold text-gray-900">
                                {stage.stage_label || stage.name}
                              </h4>
                              {stage.standard_deadline_days && (
                                <span className="text-xs text-gray-500">
                                  {stage.standard_deadline_days} days
                                </span>
                              )}
                            </div>
                            {(stage.stage_description || stage.description) && (
                              <p className="text-sm text-gray-600">{stage.stage_description || stage.description}</p>
                            )}
                            <div className="flex items-center space-x-3 mt-2 text-xs text-gray-500">
                              <span>Order: {stage.sort_order !== undefined ? stage.sort_order : stage.order_index}</span>
                              {(stage.stage_icon || stage.icon) && <span>Icon: {stage.stage_icon || stage.icon}</span>}
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Checklist Templates Section */}
            {checklistCount > 0 && (
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
                    Checklist Templates ({checklistCount})
                  </h3>
                </button>

                {expandedSections.has('checklists') && (
                  <Card className="p-4">
                    <div className="space-y-2">
                      {version.checklist_templates.map((item: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-start space-x-2 py-2 border-b border-gray-100 last:border-b-0"
                        >
                          <div className="flex-shrink-0 w-5 h-5 border border-gray-300 rounded mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm text-gray-900">{item.item_text || item.name}</p>
                            {item.stage_id && (
                              <p className="text-xs text-gray-500 mt-1">
                                Stage: {item.stage_id}
                              </p>
                            )}
                          </div>
                          {item.is_required && (
                            <Badge className="bg-red-100 text-red-700 text-xs">Required</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* Automation Rules Section */}
            {ruleCount > 0 && (
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
                    Automation Rules ({ruleCount})
                  </h3>
                </button>

                {expandedSections.has('automation') && (
                  <div className="space-y-2">
                    {version.automation_rules.map((rule: any, idx: number) => (
                      <Card key={idx} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 mb-1">
                              {rule.rule_name || rule.name}
                            </h4>
                            <div className="grid grid-cols-2 gap-3 text-sm">
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
                          <Badge className={rule.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                            {rule.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Universe Rules Section */}
            {universeRuleCount > 0 && (
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
                    Universe Rules ({universeRuleCount})
                  </h3>
                </button>

                {expandedSections.has('universe') && (
                  <div className="space-y-2">
                    {version.universe_rules?.map((rule: any, idx: number) => (
                      <Card key={idx} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 mb-1">
                              {rule.rule_name || rule.name || `Universe Rule ${idx + 1}`}
                            </h4>
                            <p className="text-sm text-gray-600">
                              {rule.rule_description || rule.description || 'No description'}
                            </p>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
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
