import React, { useState } from 'react'
import { Plus, Trash2, Copy, Eye, Folder, ChevronDown, ChevronRight, Save, Sparkles } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import {
  FILTER_TYPE_REGISTRY,
  FILTER_CATEGORIES,
  OPERATOR_LABELS,
  FilterTypeDefinition,
  FilterOperator,
  getFilterDefinition,
  getFiltersByCategory
} from '../../lib/universeFilters'
import { UniversePreviewModal } from '../modals/UniversePreviewModal'

interface FilterRule {
  id: string
  type: string
  operator: FilterOperator
  values: any
  combineWith?: 'AND' | 'OR'
}

interface FilterGroup {
  id: string
  name: string
  description?: string
  combineWith?: 'AND' | 'OR'
  rules: FilterRule[]
  isExpanded?: boolean
}

interface EnhancedUniverseBuilderProps {
  workflowId: string
  groups: FilterGroup[]
  onGroupsChange: (groups: FilterGroup[]) => void

  // Data for dropdowns
  analysts?: Array<{ value: string; label: string }>
  lists?: Array<{ value: string; label: string }>
  themes?: Array<{ value: string; label: string }>
  portfolios?: Array<{ value: string; label: string }>
}

export function EnhancedUniverseBuilder({
  workflowId,
  groups,
  onGroupsChange,
  analysts = [],
  lists = [],
  themes = [],
  portfolios = []
}: EnhancedUniverseBuilderProps) {
  const [showAddFilter, setShowAddFilter] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<{ groupId: string; rule: FilterRule } | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('basic')
  const [selectedFilterType, setSelectedFilterType] = useState<string | null>(null)
  const [currentOperator, setCurrentOperator] = useState<FilterOperator>('includes')
  const [currentValues, setCurrentValues] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Add a new group
  const addGroup = () => {
    const newGroup: FilterGroup = {
      id: `group-${Date.now()}`,
      name: 'New Filter Group',
      description: '',
      combineWith: groups.length > 0 ? 'AND' : undefined,
      rules: [],
      isExpanded: true
    }
    onGroupsChange([...groups, newGroup])
  }

  // Delete a group
  const deleteGroup = (groupId: string) => {
    const newGroups = groups.filter(g => g.id !== groupId)
    // Remove combineWith from first group
    if (newGroups.length > 0 && newGroups[0].combineWith) {
      newGroups[0] = { ...newGroups[0], combineWith: undefined }
    }
    onGroupsChange(newGroups)
  }

  // Toggle group expansion
  const toggleGroup = (groupId: string) => {
    onGroupsChange(
      groups.map(g =>
        g.id === groupId ? { ...g, isExpanded: !g.isExpanded } : g
      )
    )
  }

  // Update group combinator
  const updateGroupCombinator = (groupId: string, combinator: 'AND' | 'OR') => {
    onGroupsChange(
      groups.map(g =>
        g.id === groupId ? { ...g, combineWith: combinator } : g
      )
    )
  }

  // Add rule to group
  const addRuleToGroup = (groupId: string, rule: FilterRule) => {
    onGroupsChange(
      groups.map(g => {
        if (g.id === groupId) {
          const newRules = [...g.rules, rule]
          // Set combineWith for new rule if not the first
          if (newRules.length > 1 && !rule.combineWith) {
            rule.combineWith = 'OR'
          }
          return { ...g, rules: newRules }
        }
        return g
      })
    )
  }

  // Delete rule from group
  const deleteRule = (groupId: string, ruleId: string) => {
    onGroupsChange(
      groups.map(g => {
        if (g.id === groupId) {
          const newRules = g.rules.filter(r => r.id !== ruleId)
          // Remove combineWith from first rule
          if (newRules.length > 0 && newRules[0].combineWith) {
            newRules[0] = { ...newRules[0], combineWith: undefined }
          }
          return { ...g, rules: newRules }
        }
        return g
      })
    )
  }

  // Update rule combinator
  const updateRuleCombinator = (groupId: string, ruleId: string, combinator: 'AND' | 'OR') => {
    onGroupsChange(
      groups.map(g => {
        if (g.id === groupId) {
          return {
            ...g,
            rules: g.rules.map(r =>
              r.id === ruleId ? { ...r, combineWith: combinator } : r
            )
          }
        }
        return g
      })
    )
  }

  // Open filter modal
  const openAddFilterModal = (groupId: string) => {
    setEditingGroupId(groupId)
    setEditingRule(null)
    setSelectedFilterType(null)
    setCurrentValues(null)
    setShowAddFilter(true)
  }

  // Open edit filter modal
  const openEditFilterModal = (groupId: string, rule: FilterRule) => {
    setEditingGroupId(groupId)
    setEditingRule({ groupId, rule })
    setSelectedFilterType(rule.type)
    setCurrentOperator(rule.operator)
    setCurrentValues(rule.values)
    setShowAddFilter(true)
  }

  // Save filter from modal
  const saveFilter = () => {
    if (!selectedFilterType || !editingGroupId) return

    const newRule: FilterRule = {
      id: editingRule?.rule.id || `rule-${Date.now()}`,
      type: selectedFilterType,
      operator: currentOperator,
      values: currentValues
    }

    if (editingRule) {
      // Update existing rule
      onGroupsChange(
        groups.map(g => {
          if (g.id === editingGroupId) {
            return {
              ...g,
              rules: g.rules.map(r =>
                r.id === newRule.id ? { ...newRule, combineWith: r.combineWith } : r
              )
            }
          }
          return g
        })
      )
    } else {
      // Add new rule
      addRuleToGroup(editingGroupId, newRule)
    }

    setShowAddFilter(false)
    resetModal()
  }

  const resetModal = () => {
    setSelectedFilterType(null)
    setCurrentOperator('includes')
    setCurrentValues(null)
    setEditingRule(null)
    setEditingGroupId(null)
    setSearchTerm('')
  }

  // Get options for multi-select filters
  const getOptionsForFilter = (filterType: string): Array<{ value: string; label: string }> => {
    switch (filterType) {
      case 'analyst':
        return analysts
      case 'list':
        return lists
      case 'theme':
        return themes
      case 'portfolio':
        return portfolios
      case 'sector':
        return [
          { value: 'Communication Services', label: 'Communication Services' },
          { value: 'Consumer', label: 'Consumer' },
          { value: 'Energy', label: 'Energy' },
          { value: 'Financials', label: 'Financials' },
          { value: 'Healthcare', label: 'Healthcare' },
          { value: 'Industrials', label: 'Industrials' },
          { value: 'Materials', label: 'Materials' },
          { value: 'Real Estate', label: 'Real Estate' },
          { value: 'Technology', label: 'Technology' },
          { value: 'Utilities', label: 'Utilities' }
        ]
      case 'priority':
        return [
          { value: 'Critical', label: 'Critical' },
          { value: 'High', label: 'High' },
          { value: 'Medium', label: 'Medium' },
          { value: 'Low', label: 'Low' }
        ]
      default:
        return []
    }
  }

  // Render filter value input based on type
  const renderValueInput = (definition: FilterTypeDefinition) => {
    if (!definition) return null

    switch (definition.valueType) {
      case 'multi_select':
      case 'single_select':
        const options = getOptionsForFilter(definition.id)
        const filteredOptions = options.filter(opt =>
          opt.label.toLowerCase().includes(searchTerm.toLowerCase())
        )

        return (
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Search options..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="max-h-64 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-3">
              {filteredOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                >
                  <input
                    type={definition.valueType === 'multi_select' ? 'checkbox' : 'radio'}
                    checked={
                      definition.valueType === 'multi_select'
                        ? currentValues?.includes(option.value)
                        : currentValues === option.value
                    }
                    onChange={(e) => {
                      if (definition.valueType === 'multi_select') {
                        const newValues = currentValues || []
                        if (e.target.checked) {
                          setCurrentValues([...newValues, option.value])
                        } else {
                          setCurrentValues(newValues.filter((v: string) => v !== option.value))
                        }
                      } else {
                        setCurrentValues(option.value)
                      }
                    }}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{option.label}</span>
                </label>
              ))}
            </div>
            {definition.valueType === 'multi_select' && currentValues?.length > 0 && (
              <div className="text-sm text-gray-500">
                {currentValues.length} item{currentValues.length !== 1 ? 's' : ''} selected
              </div>
            )}
          </div>
        )

      case 'number':
      case 'percentage':
        return (
          <input
            type="number"
            placeholder={definition.placeholder || 'Enter value'}
            value={currentValues || ''}
            onChange={(e) => setCurrentValues(parseFloat(e.target.value) || null)}
            min={definition.min}
            max={definition.max}
            step={definition.step}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )

      case 'number_range':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Minimum</label>
              <input
                type="number"
                placeholder="Min"
                value={currentValues?.min || ''}
                onChange={(e) =>
                  setCurrentValues({ ...currentValues, min: parseFloat(e.target.value) || null })
                }
                min={definition.min}
                step={definition.step}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Maximum</label>
              <input
                type="number"
                placeholder="Max"
                value={currentValues?.max || ''}
                onChange={(e) =>
                  setCurrentValues({ ...currentValues, max: parseFloat(e.target.value) || null })
                }
                min={definition.min}
                step={definition.step}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        )

      case 'text':
        return (
          <input
            type="text"
            placeholder={definition.placeholder || 'Enter text'}
            value={currentValues || ''}
            onChange={(e) => setCurrentValues(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )

      case 'date':
        return (
          <input
            type="date"
            value={currentValues || ''}
            onChange={(e) => setCurrentValues(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )

      case 'date_range':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Start Date</label>
              <input
                type="date"
                value={currentValues?.start || ''}
                onChange={(e) =>
                  setCurrentValues({ ...currentValues, start: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">End Date</label>
              <input
                type="date"
                value={currentValues?.end || ''}
                onChange={(e) =>
                  setCurrentValues({ ...currentValues, end: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        )

      case 'boolean':
        return (
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                checked={currentValues === true}
                onChange={() => setCurrentValues(true)}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Yes</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                checked={currentValues === false}
                onChange={() => setCurrentValues(false)}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">No</span>
            </label>
          </div>
        )

      default:
        return null
    }
  }

  // Convert groups to legacy format for preview
  const convertToLegacyRules = (): any[] => {
    const legacyRules: any[] = []

    groups.forEach((group, groupIndex) => {
      group.rules.forEach((rule, ruleIndex) => {
        legacyRules.push({
          id: rule.id,
          type: rule.type,
          operator: rule.operator,
          values: Array.isArray(rule.values) ? rule.values : [rule.values],
          combineWith: ruleIndex === 0 && groupIndex > 0 ? group.combineWith : rule.combineWith
        })
      })
    })

    return legacyRules
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Universe Filters</h3>
          <p className="text-sm text-gray-500">Define which assets should be included in this workflow</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowPreview(true)}
            disabled={groups.length === 0 || groups.every(g => g.rules.length === 0)}
          >
            <Eye className="w-4 h-4 mr-1" />
            Preview Universe
          </Button>
          <Button size="sm" onClick={addGroup}>
            <Folder className="w-4 h-4 mr-1" />
            Add Filter Group
          </Button>
        </div>
      </div>

      {/* Filter Groups */}
      {groups.length === 0 ? (
        <Card className="p-8 text-center border-2 border-dashed border-gray-300">
          <Sparkles className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Filters Defined</h4>
          <p className="text-sm text-gray-500 mb-4">
            Start by creating a filter group to define your universe
          </p>
          <Button onClick={addGroup}>
            <Folder className="w-4 h-4 mr-1" />
            Create First Group
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {/* Group Combinator */}
              {groupIndex > 0 && (
                <div className="flex justify-center my-2">
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => updateGroupCombinator(group.id, 'AND')}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        group.combineWith === 'AND'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      AND
                    </button>
                    <button
                      onClick={() => updateGroupCombinator(group.id, 'OR')}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        group.combineWith === 'OR'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      OR
                    </button>
                  </div>
                </div>
              )}

              {/* Group Card */}
              <Card className="overflow-hidden">
                {/* Group Header */}
                <div className="bg-gradient-to-r from-gray-50 to-white p-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 flex-1">
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        {group.isExpanded ? (
                          <ChevronDown className="w-5 h-5" />
                        ) : (
                          <ChevronRight className="w-5 h-5" />
                        )}
                      </button>
                      <Folder className="w-5 h-5 text-blue-500" />
                      <div className="flex-1">
                        <input
                          type="text"
                          value={group.name}
                          onChange={(e) =>
                            onGroupsChange(
                              groups.map(g =>
                                g.id === group.id ? { ...g, name: e.target.value } : g
                              )
                            )
                          }
                          className="font-medium text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 p-0"
                        />
                        <div className="text-xs text-gray-500">
                          {group.rules.length} filter{group.rules.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openAddFilterModal(group.id)}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add Filter
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteGroup(group.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Group Rules */}
                {group.isExpanded && (
                  <div className="p-4">
                    {group.rules.length === 0 ? (
                      <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                        <p className="text-sm text-gray-500 mb-3">No filters in this group</p>
                        <Button size="sm" variant="outline" onClick={() => openAddFilterModal(group.id)}>
                          <Plus className="w-4 h-4 mr-1" />
                          Add Filter
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {group.rules.map((rule, ruleIndex) => {
                          const definition = getFilterDefinition(rule.type)
                          if (!definition) return null

                          const Icon = definition.icon

                          return (
                            <div key={rule.id}>
                              {/* Rule Combinator */}
                              {ruleIndex > 0 && (
                                <div className="flex justify-center my-2">
                                  <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
                                    <button
                                      onClick={() => updateRuleCombinator(group.id, rule.id, 'AND')}
                                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                        rule.combineWith === 'AND'
                                          ? 'bg-white text-gray-900 shadow-sm'
                                          : 'text-gray-600 hover:text-gray-900'
                                      }`}
                                    >
                                      AND
                                    </button>
                                    <button
                                      onClick={() => updateRuleCombinator(group.id, rule.id, 'OR')}
                                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                        rule.combineWith === 'OR'
                                          ? 'bg-white text-gray-900 shadow-sm'
                                          : 'text-gray-600 hover:text-gray-900'
                                      }`}
                                    >
                                      OR
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Rule Card */}
                              <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <Icon className={`w-5 h-5 text-${definition.color}-500`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center space-x-2 flex-wrap">
                                    <Badge variant="secondary" size="sm">
                                      {definition.name}
                                    </Badge>
                                    <Badge
                                      variant={rule.operator === 'excludes' ? 'destructive' : 'default'}
                                      size="sm"
                                    >
                                      {OPERATOR_LABELS[rule.operator]}
                                    </Badge>
                                    <span className="text-sm text-gray-600">
                                      {Array.isArray(rule.values)
                                        ? `${rule.values.length} item${rule.values.length !== 1 ? 's' : ''}`
                                        : definition.formatValue
                                        ? definition.formatValue(rule.values)
                                        : rule.values}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openEditFilterModal(group.id, rule)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => deleteRule(group.id, rule.id)}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Filter Modal */}
      {showAddFilter && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingRule ? 'Edit Filter' : 'Add Filter'}
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-3 gap-6">
                {/* Step 1: Category & Type Selection */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">1. Select Filter Type</h4>

                  {/* Category Tabs */}
                  <div className="space-y-2 mb-4">
                    {FILTER_CATEGORIES.map((category) => {
                      const CategoryIcon = category.icon
                      return (
                        <button
                          key={category.id}
                          onClick={() => setSelectedCategory(category.id)}
                          className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                            selectedCategory === category.id
                              ? `bg-${category.color}-50 text-${category.color}-700 border border-${category.color}-200`
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <CategoryIcon className="w-4 h-4" />
                          <span className="text-sm font-medium">{category.name}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Filter Types */}
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {getFiltersByCategory(selectedCategory).map((filterDef) => {
                      const Icon = filterDef.icon
                      return (
                        <button
                          key={filterDef.id}
                          onClick={() => {
                            setSelectedFilterType(filterDef.id)
                            setCurrentOperator(filterDef.defaultOperator)
                            setCurrentValues(null)
                          }}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            selectedFilterType === filterDef.id
                              ? `border-${filterDef.color}-500 bg-${filterDef.color}-50`
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start space-x-2">
                            <Icon className={`w-4 h-4 text-${filterDef.color}-500 mt-0.5`} />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-gray-900">{filterDef.name}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{filterDef.description}</div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Step 2: Operator Selection */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">2. Select Operator</h4>
                  {selectedFilterType ? (
                    <div className="space-y-2">
                      {getFilterDefinition(selectedFilterType)?.availableOperators.map((operator) => (
                        <button
                          key={operator}
                          onClick={() => setCurrentOperator(operator)}
                          className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                            currentOperator === operator
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="font-medium text-sm">{OPERATOR_LABELS[operator]}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-sm text-gray-500">
                      Select a filter type first
                    </div>
                  )}
                </div>

                {/* Step 3: Value Selection */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">3. Configure Value</h4>
                  {selectedFilterType ? (
                    <div>
                      {getFilterDefinition(selectedFilterType)?.helpText && (
                        <div className="mb-3 p-2 bg-blue-50 rounded text-xs text-blue-700">
                          {getFilterDefinition(selectedFilterType)?.helpText}
                        </div>
                      )}
                      {renderValueInput(getFilterDefinition(selectedFilterType)!)}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-sm text-gray-500">
                      Select a filter type first
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddFilter(false)
                  resetModal()
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={saveFilter}
                disabled={!selectedFilterType || currentValues === null}
              >
                <Save className="w-4 h-4 mr-1" />
                {editingRule ? 'Update Filter' : 'Add Filter'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <UniversePreviewModal
          workflowId={workflowId}
          rules={convertToLegacyRules()}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
