import React, { useState } from 'react'
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd'
import { Plus, Trash2, GripVertical, Search, X, Filter, Users, FileText, Target, Building2, Star, Check, Edit3 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'

interface UniverseRule {
  id: string
  type: 'analyst' | 'list' | 'theme' | 'sector' | 'priority'
  operator: 'includes' | 'excludes'
  values: string[]
  combineWith?: 'AND' | 'OR'
}

interface UniverseRuleBuilderProps {
  rules: UniverseRule[]
  onChange: (rules: UniverseRule[]) => void
  analysts?: { user_id: string; analyst_name: string }[]
  assetLists?: { id: string; name: string; color?: string }[]
  themes?: { id: string; name: string; color?: string }[]
  sectors?: string[]
  priorities?: string[]
}

const RULE_TYPE_CONFIG = {
  analyst: {
    label: 'Analyst Coverage',
    icon: Users,
    color: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    iconColor: 'text-indigo-600',
    bgColor: 'bg-indigo-100'
  },
  list: {
    label: 'Asset List',
    icon: FileText,
    color: 'bg-blue-50 border-blue-200 text-blue-700',
    iconColor: 'text-blue-600',
    bgColor: 'bg-blue-100'
  },
  theme: {
    label: 'Investment Theme',
    icon: Target,
    color: 'bg-purple-50 border-purple-200 text-purple-700',
    iconColor: 'text-purple-600',
    bgColor: 'bg-purple-100'
  },
  sector: {
    label: 'Sector',
    icon: Building2,
    color: 'bg-green-50 border-green-200 text-green-700',
    iconColor: 'text-green-600',
    bgColor: 'bg-green-100'
  },
  priority: {
    label: 'Priority Level',
    icon: Star,
    color: 'bg-amber-50 border-amber-200 text-amber-700',
    iconColor: 'text-amber-600',
    bgColor: 'bg-amber-100'
  }
}

export function UniverseRuleBuilder({
  rules,
  onChange,
  analysts = [],
  assetLists = [],
  themes = [],
  sectors = [],
  priorities = []
}: UniverseRuleBuilderProps) {
  const [showAddRule, setShowAddRule] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [selectedRuleType, setSelectedRuleType] = useState<UniverseRule['type'] | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedOperator, setSelectedOperator] = useState<'includes' | 'excludes'>('includes')
  const [tempSelectedValues, setTempSelectedValues] = useState<string[]>([])

  const handleDragEnd = (result: any) => {
    if (!result.destination) return

    const newRules = Array.from(rules)
    const [removed] = newRules.splice(result.source.index, 1)
    newRules.splice(result.destination.index, 0, removed)

    onChange(newRules)
  }

  const addRule = () => {
    if (!selectedRuleType || tempSelectedValues.length === 0) return

    if (editingRuleId) {
      // Update existing rule
      const updatedRules = rules.map(rule =>
        rule.id === editingRuleId
          ? { ...rule, type: selectedRuleType, operator: selectedOperator, values: tempSelectedValues }
          : rule
      )
      onChange(updatedRules)
    } else {
      // Add new rule
      const newRule: UniverseRule = {
        id: `rule-${Date.now()}`,
        type: selectedRuleType,
        operator: selectedOperator,
        values: tempSelectedValues,
        combineWith: rules.length > 0 ? 'OR' : undefined
      }
      onChange([...rules, newRule])
    }

    // Reset form
    setShowAddRule(false)
    setEditingRuleId(null)
    setSelectedRuleType(null)
    setSearchTerm('')
    setTempSelectedValues([])
    setSelectedOperator('includes')
  }

  const editRule = (ruleId: string) => {
    const rule = rules.find(r => r.id === ruleId)
    if (!rule) return

    setEditingRuleId(ruleId)
    setSelectedRuleType(rule.type)
    setSelectedOperator(rule.operator)
    setTempSelectedValues(rule.values)
    setShowAddRule(true)
  }

  const removeRule = (ruleId: string) => {
    const newRules = rules.filter(r => r.id !== ruleId)
    // Update combineWith for the first rule if it exists
    if (newRules.length > 0 && newRules[0].combineWith) {
      newRules[0].combineWith = undefined
    }
    onChange(newRules)
  }

  const updateRuleCombinator = (ruleId: string, combinator: 'AND' | 'OR') => {
    const newRules = rules.map(r =>
      r.id === ruleId ? { ...r, combineWith: combinator } : r
    )
    onChange(newRules)
  }

  const getAvailableOptions = (): { id: string; name: string }[] => {
    switch (selectedRuleType) {
      case 'analyst':
        return analysts.map(a => ({ id: a.user_id, name: a.analyst_name }))
      case 'list':
        return assetLists.map(l => ({ id: l.id, name: l.name }))
      case 'theme':
        return themes.map(t => ({ id: t.id, name: t.name }))
      case 'sector':
        return sectors.map(s => ({ id: s, name: s }))
      case 'priority':
        return priorities.map(p => ({ id: p, name: p }))
      default:
        return []
    }
  }

  const filteredOptions = getAvailableOptions().filter(opt =>
    opt.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getValueName = (type: UniverseRule['type'], valueId: string): string => {
    switch (type) {
      case 'analyst':
        return analysts.find(a => a.user_id === valueId)?.analyst_name || valueId
      case 'list':
        return assetLists.find(l => l.id === valueId)?.name || valueId
      case 'theme':
        return themes.find(t => t.id === valueId)?.name || valueId
      case 'sector':
      case 'priority':
        return valueId
      default:
        return valueId
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Universe Rules</h4>
          <p className="text-xs text-gray-500 mt-1">
            Build rules to automatically include or exclude assets from this workflow
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAddRule(true)}>
          <Plus className="w-4 h-4 mr-1" />
          Add Rule
        </Button>
      </div>

      {/* Rules List */}
      {rules.length === 0 ? (
        <Card className="p-8 text-center border-2 border-dashed">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
            <Filter className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="text-sm font-medium text-gray-900 mb-1">No rules defined</h3>
          <p className="text-xs text-gray-500 mb-4">
            Add rules to define which assets should receive this workflow
          </p>
          <Button size="sm" onClick={() => setShowAddRule(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Add First Rule
          </Button>
        </Card>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="universe-rules">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="space-y-3"
              >
                {rules.map((rule, index) => {
                  const Icon = RULE_TYPE_CONFIG[rule.type].icon
                  return (
                    <div key={rule.id}>
                      {/* Combinator between rules */}
                      {index > 0 && rule.combineWith && (
                        <div className="flex items-center justify-center py-2">
                          <div className="flex items-center space-x-2 bg-gray-100 rounded-full px-3 py-1">
                            <button
                              onClick={() => updateRuleCombinator(rule.id, 'AND')}
                              className={`text-xs font-semibold px-2 py-0.5 rounded transition-colors ${
                                rule.combineWith === 'AND'
                                  ? 'bg-gray-700 text-white'
                                  : 'text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              AND
                            </button>
                            <button
                              onClick={() => updateRuleCombinator(rule.id, 'OR')}
                              className={`text-xs font-semibold px-2 py-0.5 rounded transition-colors ${
                                rule.combineWith === 'OR'
                                  ? 'bg-gray-700 text-white'
                                  : 'text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              OR
                            </button>
                          </div>
                        </div>
                      )}

                      <Draggable draggableId={rule.id} index={index}>
                        {(provided, snapshot) => (
                          <Card
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`p-4 transition-shadow ${
                              snapshot.isDragging ? 'shadow-lg' : ''
                            }`}
                          >
                            <div className="flex items-start space-x-3">
                              <div
                                {...provided.dragHandleProps}
                                className="mt-1 text-gray-400 hover:text-gray-600 cursor-grab"
                              >
                                <GripVertical className="w-5 h-5" />
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2 mb-2">
                                  <div className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md border ${RULE_TYPE_CONFIG[rule.type].color}`}>
                                    <Icon className={`w-4 h-4 ${RULE_TYPE_CONFIG[rule.type].iconColor}`} />
                                    <span className="text-xs font-semibold">
                                      {RULE_TYPE_CONFIG[rule.type].label}
                                    </span>
                                  </div>
                                  <Badge
                                    variant={rule.operator === 'includes' ? 'default' : 'destructive'}
                                    size="sm"
                                  >
                                    {rule.operator === 'includes' ? 'Includes' : 'Excludes'}
                                  </Badge>
                                </div>

                                <div className="flex flex-wrap gap-1.5">
                                  {rule.values.map((valueId) => (
                                    <Badge key={valueId} variant="outline" size="sm">
                                      {getValueName(rule.type, valueId)}
                                    </Badge>
                                  ))}
                                </div>

                                {rule.values.length > 5 && (
                                  <p className="text-xs text-gray-500 mt-2">
                                    {rule.values.length} items selected
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center space-x-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => editRule(rule.id)}
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeRule(rule.id)}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </Card>
                        )}
                      </Draggable>
                    </div>
                  )
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {/* Add Rule Modal */}
      {showAddRule && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-5xl h-[75vh] overflow-hidden flex flex-col bg-white">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">
                    {editingRuleId ? 'Edit Universe Rule' : 'Add Universe Rule'}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Define criteria to filter assets for this workflow</p>
                </div>
                <button
                  onClick={() => {
                    setShowAddRule(false)
                    setEditingRuleId(null)
                    setSelectedRuleType(null)
                    setSearchTerm('')
                    setTempSelectedValues([])
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 p-6">
              <div className="flex gap-6">
                {/* Left: Filter Type Selection */}
                <div className="w-64 flex-shrink-0">
                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                    1. Filter Type
                  </label>
                  <div className="space-y-2">
                    {(Object.entries(RULE_TYPE_CONFIG) as [UniverseRule['type'], typeof RULE_TYPE_CONFIG[keyof typeof RULE_TYPE_CONFIG]][]).map(([type, config]) => {
                      const Icon = config.icon
                      return (
                        <button
                          key={type}
                          onClick={() => {
                            setSelectedRuleType(type)
                            setTempSelectedValues([])
                            setSearchTerm('')
                          }}
                          className={`w-full p-3 border-2 rounded-lg text-left transition-all ${
                            selectedRuleType === type
                              ? `${config.color} border-current shadow-sm`
                              : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${
                              selectedRuleType === type ? config.bgColor : 'bg-gray-100'
                            }`}>
                              <Icon className={`w-5 h-5 ${selectedRuleType === type ? config.iconColor : 'text-gray-600'}`} />
                            </div>
                            <span className="text-sm font-medium">{config.label}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Operator Selection - always visible but greyed out until selection */}
                <div className={`w-56 flex-shrink-0 transition-all ${!selectedRuleType ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                    2. Action
                  </label>
                  <div className="space-y-2">
                    <button
                      onClick={() => setSelectedOperator('includes')}
                      disabled={!selectedRuleType}
                      className={`w-full p-3 border-2 rounded-lg text-left transition-all ${
                        selectedOperator === 'includes'
                          ? 'border-green-500 bg-green-50 text-green-700 shadow-sm'
                          : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <Check className={`w-4 h-4 ${selectedOperator === 'includes' ? 'text-green-600' : 'text-gray-400'}`} />
                        <div>
                          <div className="text-sm font-medium">Include</div>
                          <div className="text-xs text-gray-600 mt-0.5">Add matching assets</div>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => setSelectedOperator('excludes')}
                      disabled={!selectedRuleType}
                      className={`w-full p-3 border-2 rounded-lg text-left transition-all ${
                        selectedOperator === 'excludes'
                          ? 'border-red-500 bg-red-50 text-red-700 shadow-sm'
                          : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <X className={`w-4 h-4 ${selectedOperator === 'excludes' ? 'text-red-600' : 'text-gray-400'}`} />
                        <div>
                          <div className="text-sm font-medium">Exclude</div>
                          <div className="text-xs text-gray-600 mt-0.5">Remove matching assets</div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Middle: Selection List - always visible but greyed out until selection */}
                <div className={`flex-1 min-w-0 transition-all ${!selectedRuleType ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                    3. Select Items
                  </label>

                  {/* Search */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder={selectedRuleType ? `Search ${RULE_TYPE_CONFIG[selectedRuleType].label.toLowerCase()}s...` : 'Select a filter type first...'}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      disabled={!selectedRuleType}
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                  </div>

                  {/* Options */}
                  <div className="border border-gray-200 rounded-lg h-80 overflow-y-auto">
                    {!selectedRuleType ? (
                      <div className="p-8 text-center text-sm text-gray-500">
                        Select a filter type to see available options
                      </div>
                    ) : filteredOptions.length === 0 ? (
                      <div className="p-8 text-center text-sm text-gray-500">
                        No {RULE_TYPE_CONFIG[selectedRuleType].label.toLowerCase()}s found
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {filteredOptions.map((option) => (
                          <label
                            key={option.id}
                            className="flex items-center space-x-3 p-3 hover:bg-blue-50 cursor-pointer transition-colors group"
                          >
                            <div className="relative flex items-center justify-center">
                              <input
                                type="checkbox"
                                checked={tempSelectedValues.includes(option.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setTempSelectedValues([...tempSelectedValues, option.id])
                                  } else {
                                    setTempSelectedValues(tempSelectedValues.filter(id => id !== option.id))
                                  }
                                }}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                            </div>
                            <span className="text-sm text-gray-900 group-hover:text-blue-700 font-medium">{option.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500">
                  {tempSelectedValues.length > 0 && selectedRuleType && (
                    <>
                      {selectedOperator === 'includes' ? 'Adding' : 'Excluding'} assets from{' '}
                      <span className="font-semibold">{tempSelectedValues.length}</span>{' '}
                      {RULE_TYPE_CONFIG[selectedRuleType].label.toLowerCase()}
                      {tempSelectedValues.length !== 1 ? 's' : ''}
                    </>
                  )}
                </p>
                <div className="flex space-x-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddRule(false)
                      setEditingRuleId(null)
                      setSelectedRuleType(null)
                      setSearchTerm('')
                      setTempSelectedValues([])
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={addRule}
                    disabled={!selectedRuleType || tempSelectedValues.length === 0}
                    className="min-w-32"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    {editingRuleId ? 'Update Rule' : 'Add Rule'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
