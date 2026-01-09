import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Edit2, Eye, X, Search, UserPlus, UserMinus, ExternalLink } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import {
  FILTER_TYPE_REGISTRY,
  FILTER_CATEGORIES,
  OPERATOR_LABELS,
  FilterTypeDefinition,
  FilterOperator,
  getFilterDefinition
} from '../../lib/universeFilters'
import { UniversePreviewModal } from '../modals/UniversePreviewModal'
import { supabase } from '../../lib/supabase'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

interface FilterRule {
  id: string
  type: string
  operator: FilterOperator
  values: any
  combineWith?: 'AND' | 'OR'
}

// Logic expression token types (matching wizard)
type LogicToken =
  | { type: 'filter'; filterId: string }
  | { type: 'operator'; value: 'AND' | 'OR' }
  | { type: 'paren'; value: '(' | ')' }

interface SimplifiedUniverseBuilderProps {
  workflowId: string
  rules: FilterRule[]
  onRulesChange: (rules: FilterRule[]) => void
  onSave?: () => void
  isEditable?: boolean
  canEdit?: boolean
  isEditMode?: boolean

  // Data for dropdowns
  analysts?: Array<{ value: string; label: string }>
  lists?: Array<{ value: string; label: string }>
  themes?: Array<{ value: string; label: string }>
  portfolios?: Array<{ value: string; label: string }>
}

export function SimplifiedUniverseBuilder({
  workflowId,
  rules,
  onRulesChange,
  onSave,
  isEditable = true,
  canEdit = false,
  isEditMode = false,
  analysts = [],
  lists = [],
  themes = [],
  portfolios = []
}: SimplifiedUniverseBuilderProps) {
  console.log('SimplifiedUniverseBuilder analysts prop:', analysts)
  const [showAddFilter, setShowAddFilter] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [editingRule, setEditingRule] = useState<FilterRule | null>(null)
  const [selectedFilterType, setSelectedFilterType] = useState<string | null>(null)
  const [currentOperator, setCurrentOperator] = useState<FilterOperator>('includes')
  const [currentValues, setCurrentValues] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  // Logic expression state (matching wizard)
  const [logicExpression, setLogicExpression] = useState<LogicToken[]>([])
  const [selectedTokens, setSelectedTokens] = useState<Set<number>>(new Set())

  const queryClient = useQueryClient()

  // Initialize logic expression from rules
  // Create a stable key from rule IDs to detect when rules actually change
  const rulesKey = rules.map(r => r.id).join(',')

  useEffect(() => {
    if (rules.length === 0) {
      setLogicExpression([])
      return
    }

    // Build logic expression from rules
    const expr: LogicToken[] = []
    rules.forEach((rule, index) => {
      if (index > 0) {
        expr.push({ type: 'operator', value: rule.combineWith || 'AND' })
      }
      expr.push({ type: 'filter', filterId: rule.id })
    })
    setLogicExpression(expr)
  }, [rulesKey, rules.length]) // Rebuild when rules change (by ID) or count changes

  // Get filter by ID
  const getFilterById = (filterId: string): FilterRule | undefined => {
    return rules.find(r => r.id === filterId)
  }

  // Toggle operator in logic expression
  const toggleOperator = (index: number) => {
    if (!isEditable) return
    const token = logicExpression[index]
    if (token.type === 'operator') {
      const newExpr = [...logicExpression]
      newExpr[index] = { type: 'operator', value: token.value === 'AND' ? 'OR' : 'AND' }
      setLogicExpression(newExpr)

      // Also update the rule's combineWith to stay in sync
      // Find the filter token after this operator
      for (let i = index + 1; i < logicExpression.length; i++) {
        const nextToken = logicExpression[i]
        if (nextToken.type === 'filter') {
          const updatedRules = rules.map(r =>
            r.id === nextToken.filterId
              ? { ...r, combineWith: token.value === 'AND' ? 'OR' as const : 'AND' as const }
              : r
          )
          onRulesChange(updatedRules)
          break
        }
      }
    }
  }

  // Toggle token selection
  const toggleTokenSelection = (index: number) => {
    if (!isEditable) return
    const newSelection = new Set(selectedTokens)
    if (newSelection.has(index)) {
      newSelection.delete(index)
    } else {
      newSelection.add(index)
    }
    setSelectedTokens(newSelection)
  }

  // Group selected tokens with parentheses
  const groupSelectedTokens = () => {
    if (!isEditable || selectedTokens.size < 2) return

    const indices = Array.from(selectedTokens).sort((a, b) => a - b)
    const minIndex = indices[0]
    const maxIndex = indices[indices.length - 1]

    const newExpr = [...logicExpression]
    newExpr.splice(maxIndex + 1, 0, { type: 'paren', value: ')' })
    newExpr.splice(minIndex, 0, { type: 'paren', value: '(' })

    setLogicExpression(newExpr)
    setSelectedTokens(new Set())
  }

  // Remove parentheses pair
  const removeParentheses = (openIndex: number) => {
    if (!isEditable) return
    const token = logicExpression[openIndex]
    if (token?.type !== 'paren' || token?.value !== '(') return

    let depth = 1
    let closeIndex = -1
    for (let i = openIndex + 1; i < logicExpression.length; i++) {
      const t = logicExpression[i]
      if (t.type === 'paren') {
        if (t.value === '(') depth++
        else if (t.value === ')') {
          depth--
          if (depth === 0) {
            closeIndex = i
            break
          }
        }
      }
    }

    if (closeIndex > -1) {
      const newExpr = logicExpression.filter((_, i) => i !== openIndex && i !== closeIndex)
      setLogicExpression(newExpr)
      setSelectedTokens(new Set())
    }
  }

  // Clear selection
  const clearSelection = () => {
    setSelectedTokens(new Set())
  }

  // Format filter value for compact display
  const formatFilterValueCompact = (rule: FilterRule): string => {
    if (rule.type === 'financial_metric' && typeof rule.values === 'object' && rule.values !== null) {
      const metricLabels: Record<string, string> = {
        market_cap: 'Market Cap',
        price: 'Stock Price',
        volume: 'Trading Volume',
        pe_ratio: 'P/E Ratio',
        dividend_yield: 'Dividend Yield'
      }
      const parts = [metricLabels[rule.values.metric] || rule.values.metric]
      if (rule.values.min != null) parts.push(`>${rule.values.min}`)
      if (rule.values.max != null) parts.push(`<${rule.values.max}`)
      return parts.join(' ')
    }

    const options = getOptionsForFilter(rule.type)
    if (Array.isArray(rule.values)) {
      if (rule.values.length <= 2) {
        return rule.values.map(v => {
          const opt = options.find(o => o.value === v)
          return opt?.label || v
        }).join(', ')
      }
      const first = options.find(o => o.value === rule.values[0])?.label || rule.values[0]
      return `${first} +${rule.values.length - 1}`
    }
    return String(rule.values)
  }

  // Fetch universe overrides for this workflow
  const { data: universeOverrides = [] } = useQuery({
    queryKey: ['workflow-universe-overrides', workflowId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_universe_overrides')
        .select(`
          *,
          assets (
            id,
            symbol,
            company_name
          )
        `)
        .eq('workflow_id', workflowId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    staleTime: 30 * 1000, // 30 seconds
  })

  // Mutation to delete an override
  const deleteOverrideMutation = useMutation({
    mutationFn: async (override: any) => {
      // First, get the override details to know what action to reverse
      const overrideType = override.override_type
      const assetId = override.asset_id

      // Delete the override record
      const { error: deleteError } = await supabase
        .from('workflow_universe_overrides')
        .delete()
        .eq('id', override.id)

      if (deleteError) throw deleteError

      // If this was an 'add' override, remove the asset from the workflow
      if (overrideType === 'add') {
        const { error: removeError } = await supabase
          .from('asset_workflow_progress')
          .delete()
          .eq('asset_id', assetId)
          .eq('workflow_id', workflowId)

        if (removeError) throw removeError
      }

      // If this was a 'remove' override, we would re-add the asset to the workflow
      // only if it matches the universe rules. For now, we'll just remove the override
      // and let the user manually re-add if needed.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-universe-overrides', workflowId] })
      queryClient.invalidateQueries({ queryKey: ['asset-all-workflows'] })
      queryClient.invalidateQueries({ queryKey: ['asset-available-workflows'] })
      queryClient.invalidateQueries({ queryKey: ['asset-effective-workflow'] })
      queryClient.invalidateQueries({ queryKey: ['assets'] }) // Invalidate assets cache so workflow_id updates
    }
  })

  // Debug: log rules prop changes
  React.useEffect(() => {
    console.log('🔄 Rules prop changed:', rules)
  }, [rules])

  // Add a new rule
  const addRule = (rule: FilterRule) => {
    const newRules = [...rules, { ...rule, combineWith: rules.length > 0 ? 'OR' : undefined }]
    console.log('📝 Adding rule:', rule)
    console.log('📝 Current rules:', rules)
    console.log('📝 New rules array:', newRules)
    onRulesChange(newRules)
    // Save is now handled by parent component's edit mode
  }

  // Delete a rule
  const deleteRule = (ruleId: string) => {
    const newRules = rules.filter(r => r.id !== ruleId)
    // Remove combineWith from first rule
    if (newRules.length > 0 && newRules[0].combineWith) {
      newRules[0] = { ...newRules[0], combineWith: undefined }
    }
    onRulesChange(newRules)
    // Save is now handled by parent component's edit mode
  }

  // Update rule
  const updateRule = (updatedRule: FilterRule) => {
    const newRules = rules.map(r =>
      r.id === updatedRule.id ? { ...updatedRule, combineWith: r.combineWith } : r
    )
    onRulesChange(newRules)
    // Save is now handled by parent component's edit mode
  }

  // Open add filter modal
  const openAddFilterModal = () => {
    setEditingRule(null)
    setSelectedFilterType(null)
    setCurrentOperator('includes')
    setCurrentValues(null)
    setSearchTerm('')
    setFilterSearch('')
    setShowAddFilter(true)
  }

  // Open edit filter modal
  const openEditFilterModal = async (rule: FilterRule) => {
    setEditingRule(rule)
    setSelectedFilterType(rule.type)
    setCurrentOperator(rule.operator)
    setCurrentValues(rule.values)
    setSearchTerm('')
    setFilterSearch('')

    // If editing a symbol filter, fetch the full details for selected symbols
    if (rule.type === 'symbol' && Array.isArray(rule.values) && rule.values.length > 0) {
      const { data } = await supabase
        .from('assets')
        .select('symbol, company_name')
        .in('symbol', rule.values)

      if (data) {
        setSelectedSymbolsCache(
          data.map(asset => ({
            value: asset.symbol,
            label: `${asset.symbol} - ${asset.company_name}`
          }))
        )
      }
    }

    // If editing an analyst filter, fetch the full details for selected analysts
    if (rule.type === 'analyst' && Array.isArray(rule.values) && rule.values.length > 0) {
      const { data } = await supabase
        .from('coverage')
        .select('user_id, analyst_name')
        .in('user_id', rule.values)

      if (data) {
        // Get unique analysts
        const uniqueAnalysts = data.reduce((acc: any[], curr) => {
          if (!acc.find(a => a.user_id === curr.user_id)) {
            acc.push(curr)
          }
          return acc
        }, [])

        setSelectedAnalystsCache(
          uniqueAnalysts.map(analyst => ({
            value: analyst.user_id,
            label: analyst.analyst_name
          }))
        )
      }
    }

    setShowAddFilter(true)
  }

  // Save filter
  const saveFilter = () => {
    if (!selectedFilterType) return

    const filterDef = getFilterDefinition(selectedFilterType)
    if (!filterDef) return

    // Validate that values are provided based on type
    if (currentValues === null || currentValues === undefined) return

    // For range types, check if at least one value is provided
    if (filterDef.valueType === 'number_range' || filterDef.valueType === 'date_range') {
      const hasValue = currentValues.value !== null && currentValues.value !== undefined && currentValues.value !== ''
      const hasMin = currentValues.min !== null && currentValues.min !== undefined && currentValues.min !== ''
      const hasMax = currentValues.max !== null && currentValues.max !== undefined && currentValues.max !== ''
      const hasStart = currentValues.start !== null && currentValues.start !== undefined && currentValues.start !== ''
      const hasEnd = currentValues.end !== null && currentValues.end !== undefined && currentValues.end !== ''

      if (!hasValue && !hasMin && !hasMax && !hasStart && !hasEnd) {
        return
      }
    }

    // For arrays, check if not empty
    if (Array.isArray(currentValues) && currentValues.length === 0) return

    const newRule: FilterRule = {
      id: editingRule?.id || `rule-${Date.now()}`,
      type: selectedFilterType,
      operator: currentOperator,
      values: currentValues
    }

    if (editingRule) {
      updateRule(newRule)
    } else {
      addRule(newRule)
    }

    setShowAddFilter(false)
    resetModal()
  }

  const resetModal = () => {
    setSelectedFilterType(null)
    setCurrentOperator('includes')
    setCurrentValues(null)
    setEditingRule(null)
    setSearchTerm('')
    setFilterSearch('')
    setShowSelectedOnly(false)
    setSelectedSymbolsCache([])
    setSelectedAnalystsCache([])
  }

  // State for symbol typeahead
  const [symbolInput, setSymbolInput] = React.useState('')
  const [symbolSuggestions, setSymbolSuggestions] = React.useState<Array<{ value: string; label: string }>>([])
  const [showSelectedOnly, setShowSelectedOnly] = React.useState(false)
  const [selectedSymbolsCache, setSelectedSymbolsCache] = React.useState<Array<{ value: string; label: string }>>([])

  // State for analyst typeahead
  const [analystSuggestions, setAnalystSuggestions] = React.useState<Array<{ value: string; label: string }>>([])
  const [selectedAnalystsCache, setSelectedAnalystsCache] = React.useState<Array<{ value: string; label: string }>>([])

  // Fetch symbol suggestions
  const fetchSymbolSuggestions = React.useCallback(async (query: string) => {
    if (query.length < 1) {
      setSymbolSuggestions([])
      return
    }

    const { data } = await supabase
      .from('assets')
      .select('symbol, company_name')
      .ilike('symbol', `${query}%`)
      .limit(10)

    setSymbolSuggestions(
      data?.map(asset => ({
        value: asset.symbol,
        label: `${asset.symbol} - ${asset.company_name}`
      })) || []
    )
  }, [])

  // Fetch analyst suggestions
  const fetchAnalystSuggestions = React.useCallback(async (query: string) => {
    if (query.length < 1) {
      setAnalystSuggestions([])
      return
    }

    const { data } = await supabase
      .from('coverage')
      .select('user_id, analyst_name')
      .ilike('analyst_name', `%${query}%`)
      .order('analyst_name')
      .limit(20)

    if (data) {
      // Get unique analysts
      const uniqueAnalysts = data.reduce((acc: any[], curr) => {
        if (!acc.find(a => a.user_id === curr.user_id)) {
          acc.push(curr)
        }
        return acc
      }, [])

      setAnalystSuggestions(
        uniqueAnalysts.map(analyst => ({
          value: analyst.user_id,
          label: analyst.analyst_name
        }))
      )
    }
  }, [])

  // Get options for multi-select filters
  const getOptionsForFilter = (filterType: string): Array<{ value: string; label: string }> => {
    switch (filterType) {
      case 'symbol':
        // Combine suggestions with cached selected symbols to ensure all selected items are visible
        const allSymbolOptions = [...selectedSymbolsCache]
        symbolSuggestions.forEach(suggestion => {
          if (!allSymbolOptions.find(opt => opt.value === suggestion.value)) {
            allSymbolOptions.push(suggestion)
          }
        })
        return allSymbolOptions
      case 'analyst':
        // When in modal, always use the full analysts list as the base
        // and merge in any cached selections and search suggestions
        if (showAddFilter) {
          // Start with the full analysts list
          const allAnalystOptions = [...analysts]

          // Add cached selections that might not be in the analysts list
          selectedAnalystsCache.forEach(cached => {
            if (!allAnalystOptions.find(opt => opt.value === cached.value)) {
              allAnalystOptions.push(cached)
            }
          })

          // Add search suggestions that might not be in the list
          analystSuggestions.forEach(suggestion => {
            if (!allAnalystOptions.find(opt => opt.value === suggestion.value)) {
              allAnalystOptions.push(suggestion)
            }
          })

          return allAnalystOptions
        }
        // Use full analysts list for display of saved rules
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
          { value: 'Consumer Discretionary', label: 'Consumer Discretionary' },
          { value: 'Consumer Staples', label: 'Consumer Staples' },
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
          { value: 'critical', label: 'Critical' },
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' }
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
        const filteredOptions = options.filter(opt => {
          // If showing selected only, filter to only selected items
          if (showSelectedOnly && definition.valueType === 'multi_select') {
            return currentValues?.includes(opt.value)
          }
          // Otherwise, apply search filter
          return opt.label?.toLowerCase().includes(searchTerm.toLowerCase())
        })

        return (
          <div className="space-y-2">
            <input
              type="text"
              placeholder={
                definition.id === 'symbol'
                  ? 'Type to search tickers...'
                  : definition.id === 'analyst'
                  ? 'Type to search analysts...'
                  : 'Search...'
              }
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setShowSelectedOnly(false) // Reset when user types
                if (definition.id === 'symbol') {
                  fetchSymbolSuggestions(e.target.value)
                } else if (definition.id === 'analyst') {
                  fetchAnalystSuggestions(e.target.value)
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            <div className="h-48 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-2">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
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
                            // Cache symbol information for later display
                            if (definition.id === 'symbol' && !selectedSymbolsCache.find(s => s.value === option.value)) {
                              setSelectedSymbolsCache([...selectedSymbolsCache, option])
                            }
                            // Cache analyst information for later display
                            if (definition.id === 'analyst' && !selectedAnalystsCache.find(a => a.value === option.value)) {
                              setSelectedAnalystsCache([...selectedAnalystsCache, option])
                            }
                          } else {
                            setCurrentValues(newValues.filter((v: string) => v !== option.value))
                            // Remove from cache when unchecked
                            if (definition.id === 'symbol') {
                              setSelectedSymbolsCache(selectedSymbolsCache.filter(s => s.value !== option.value))
                            }
                            // Remove from cache when unchecked
                            if (definition.id === 'analyst') {
                              setSelectedAnalystsCache(selectedAnalystsCache.filter(a => a.value !== option.value))
                            }
                          }
                        } else {
                          setCurrentValues(option.value)
                        }
                      }}
                      className="rounded text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))
              ) : (
                <div className="p-2 text-xs text-gray-500 text-center">
                  {showSelectedOnly ? 'No items selected' : 'No results found'}
                </div>
              )}
            </div>
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        )

      case 'number_range':
        // Special handling for financial_metric filter - show metric selector first
        if (definition.id === 'financial_metric') {
          const metricOptions = [
            { value: 'market_cap', label: 'Market Cap', placeholder: 'Enter value in millions', formatHint: '(in millions USD)' },
            { value: 'price', label: 'Stock Price', placeholder: 'Enter price', formatHint: '(USD)' },
            { value: 'volume', label: 'Trading Volume', placeholder: 'Enter volume', formatHint: '(shares)' },
            { value: 'pe_ratio', label: 'P/E Ratio', placeholder: 'Enter P/E ratio', formatHint: '' },
            { value: 'dividend_yield', label: 'Dividend Yield', placeholder: 'Enter percentage', formatHint: '(%)' }
          ]
          const selectedMetric = metricOptions.find(m => m.value === currentValues?.metric)

          return (
            <div className="space-y-4">
              {/* Metric Selector */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">Select Metric</label>
                <select
                  value={currentValues?.metric || ''}
                  onChange={(e) => setCurrentValues({ ...currentValues, metric: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                >
                  <option value="">Choose a metric...</option>
                  {metricOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Value Input - only show after metric is selected */}
              {currentValues?.metric && (
                <>
                  {currentOperator === 'greater_than' && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Minimum Value {selectedMetric?.formatHint}
                      </label>
                      <input
                        type="number"
                        placeholder={selectedMetric?.placeholder || 'Enter minimum'}
                        value={currentValues?.min || ''}
                        onChange={(e) =>
                          setCurrentValues({ ...currentValues, min: parseFloat(e.target.value) || null })
                        }
                        min={0}
                        step={currentValues?.metric === 'price' ? 0.01 : 1}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                  )}
                  {currentOperator === 'less_than' && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Maximum Value {selectedMetric?.formatHint}
                      </label>
                      <input
                        type="number"
                        placeholder={selectedMetric?.placeholder || 'Enter maximum'}
                        value={currentValues?.max || ''}
                        onChange={(e) =>
                          setCurrentValues({ ...currentValues, max: parseFloat(e.target.value) || null })
                        }
                        min={0}
                        step={currentValues?.metric === 'price' ? 0.01 : 1}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                  )}
                  {currentOperator === 'between' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Min {selectedMetric?.formatHint}</label>
                        <input
                          type="number"
                          placeholder="Min"
                          value={currentValues?.min || ''}
                          onChange={(e) =>
                            setCurrentValues({ ...currentValues, min: parseFloat(e.target.value) || null })
                          }
                          min={0}
                          step={currentValues?.metric === 'price' ? 0.01 : 1}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Max {selectedMetric?.formatHint}</label>
                        <input
                          type="number"
                          placeholder="Max"
                          value={currentValues?.max || ''}
                          onChange={(e) =>
                            setCurrentValues({ ...currentValues, max: parseFloat(e.target.value) || null })
                          }
                          min={0}
                          step={currentValues?.metric === 'price' ? 0.01 : 1}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        }

        // Standard number_range handling for other filters
        // Show different inputs based on operator
        if (currentOperator === 'equals') {
          return (
            <input
              type="number"
              placeholder={definition.placeholder || 'Enter value'}
              value={currentValues?.value || ''}
              onChange={(e) =>
                setCurrentValues({ value: parseFloat(e.target.value) || null })
              }
              min={definition.min}
              step={definition.step}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          )
        } else if (currentOperator === 'greater_than') {
          return (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Minimum Value</label>
              <input
                type="number"
                placeholder="Enter minimum"
                value={currentValues?.min || ''}
                onChange={(e) =>
                  setCurrentValues({ min: parseFloat(e.target.value) || null })
                }
                min={definition.min}
                step={definition.step}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>
          )
        } else if (currentOperator === 'less_than') {
          return (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Maximum Value</label>
              <input
                type="number"
                placeholder="Enter maximum"
                value={currentValues?.max || ''}
                onChange={(e) =>
                  setCurrentValues({ max: parseFloat(e.target.value) || null })
                }
                min={definition.min}
                step={definition.step}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>
          )
        } else {
          // 'between' operator - show both fields
          return (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Min</label>
                <input
                  type="number"
                  placeholder="Min"
                  value={currentValues?.min || ''}
                  onChange={(e) =>
                    setCurrentValues({ ...currentValues, min: parseFloat(e.target.value) || null })
                  }
                  min={definition.min}
                  step={definition.step}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Max</label>
                <input
                  type="number"
                  placeholder="Max"
                  value={currentValues?.max || ''}
                  onChange={(e) =>
                    setCurrentValues({ ...currentValues, max: parseFloat(e.target.value) || null })
                  }
                  min={definition.min}
                  step={definition.step}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
            </div>
          )
        }

      case 'text':
        return (
          <input
            type="text"
            placeholder={definition.placeholder || 'Enter text'}
            value={currentValues || ''}
            onChange={(e) => setCurrentValues(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        )

      case 'date':
        return (
          <input
            type="date"
            value={currentValues || ''}
            onChange={(e) => setCurrentValues(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        )

      case 'date_range':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Start</label>
              <input
                type="date"
                value={currentValues?.start || ''}
                onChange={(e) =>
                  setCurrentValues({ ...currentValues, start: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">End</label>
              <input
                type="date"
                value={currentValues?.end || ''}
                onChange={(e) =>
                  setCurrentValues({ ...currentValues, end: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
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

  // Get all available filter types
  const allFilterTypes = Object.values(FILTER_TYPE_REGISTRY)
  const filteredFilterTypes = allFilterTypes.filter(filter =>
    filter.name.toLowerCase().includes(filterSearch.toLowerCase()) ||
    filter.description.toLowerCase().includes(filterSearch.toLowerCase())
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-gray-900">Universe Filters</h3>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              console.log('🔍 Preview button clicked')
              console.log('📋 Current rules:', rules)
              console.log('📏 Rules count:', rules.length)
              setShowPreview(true)
            }}
            disabled={rules.length === 0}
          >
            <Eye className="w-4 h-4 mr-1" />
            Preview
          </Button>
          {isEditable && (
            <Button size="sm" onClick={openAddFilterModal}>
              <Plus className="w-4 h-4 mr-1" />
              Add Filter
            </Button>
          )}
        </div>
      </div>

      {/* Filter Rules */}
      {rules.length === 0 ? (
        <Card className="p-8 text-center border-2 border-dashed border-gray-300">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
            <Plus className="w-6 h-6 text-gray-400" />
          </div>
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Filters Defined</h4>
          <p className="text-sm text-gray-500 mb-4">
            {isEditable ? 'Add filters to define your universe of assets' : 'No universe filters have been defined for this workflow'}
          </p>
          {isEditable && (
            <Button onClick={openAddFilterModal}>
              <Plus className="w-4 h-4 mr-1" />
              Add First Filter
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Logic Builder Section - Show when there are 2+ filters */}
          {rules.length >= 2 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">Filter Logic</h4>
                <div className="flex items-center gap-2">
                  {isEditable && selectedTokens.size >= 2 && (
                    <>
                      <button
                        type="button"
                        onClick={groupSelectedTokens}
                        className="text-xs px-2 py-1 bg-purple-600 text-white hover:bg-purple-700 rounded font-medium"
                      >
                        ( ) Group Selected
                      </button>
                      <button
                        type="button"
                        onClick={clearSelection}
                        className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-200 rounded"
                      >
                        Clear
                      </button>
                    </>
                  )}
                  {isEditable && selectedTokens.size > 0 && selectedTokens.size < 2 && (
                    <span className="text-xs text-gray-500">Select more to group</span>
                  )}
                </div>
              </div>

              {/* Logic Expression Display */}
              <div className="flex flex-wrap items-center gap-1.5 p-3 bg-white border border-gray-200 rounded-lg min-h-[48px]">
                {(() => {
                  // Filter out orphaned operators (operators next to missing filters)
                  const validExpression = logicExpression.filter((token, idx) => {
                    if (token.type === 'filter') {
                      return !!getFilterById(token.filterId)
                    }
                    if (token.type === 'operator') {
                      // Check if both adjacent filters exist
                      const prevFilter = logicExpression.slice(0, idx).reverse().find(t => t.type === 'filter')
                      const nextFilter = logicExpression.slice(idx + 1).find(t => t.type === 'filter')
                      const prevExists = prevFilter && getFilterById((prevFilter as any).filterId)
                      const nextExists = nextFilter && getFilterById((nextFilter as any).filterId)
                      return prevExists && nextExists
                    }
                    return true // parentheses
                  })

                  return validExpression.map((token, index) => {
                    const isSelected = selectedTokens.has(logicExpression.indexOf(token))

                    if (token.type === 'filter') {
                      const filter = getFilterById(token.filterId)
                      if (!filter) return null
                    const def = getFilterDefinition(filter.type)
                    const fullDetails = `${def?.name || filter.type} ${OPERATOR_LABELS[filter.operator]} ${formatFilterValueCompact(filter)}`
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => toggleTokenSelection(index)}
                        className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium transition-all ${
                          isSelected
                            ? 'bg-purple-200 text-purple-900 ring-2 ring-purple-400'
                            : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                        } ${!isEditable ? 'cursor-default' : 'cursor-pointer'}`}
                        title={fullDetails}
                        disabled={!isEditable}
                      >
                        {def?.name || filter.type}
                      </button>
                    )
                  } else if (token.type === 'operator') {
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={(e) => {
                          if (!isEditable) return
                          if (e.shiftKey) {
                            toggleTokenSelection(index)
                          } else {
                            toggleOperator(index)
                          }
                        }}
                        className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                          isSelected
                            ? 'bg-purple-200 text-purple-900 ring-2 ring-purple-400'
                            : token.value === 'AND'
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                        } ${isEditable ? 'cursor-pointer' : 'cursor-default'}`}
                        title={isEditable ? "Click to toggle AND/OR, Shift+Click to select" : undefined}
                        disabled={!isEditable}
                      >
                        {token.value}
                      </button>
                    )
                  } else if (token.type === 'paren') {
                    const isOpenParen = token.value === '('
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={(e) => {
                          if (!isEditable) return
                          e.preventDefault()
                          e.stopPropagation()
                          if (isOpenParen) {
                            removeParentheses(index)
                          } else {
                            let depth = 1
                            for (let i = index - 1; i >= 0; i--) {
                              const t = logicExpression[i]
                              if (t.type === 'paren') {
                                if (t.value === ')') depth++
                                else if (t.value === '(') {
                                  depth--
                                  if (depth === 0) {
                                    removeParentheses(i)
                                    break
                                  }
                                }
                              }
                            }
                          }
                        }}
                        className={`font-bold text-lg px-0.5 transition-colors text-purple-600 ${isEditable ? 'hover:text-red-600 hover:bg-red-50 cursor-pointer' : 'cursor-default'} rounded`}
                        title={isEditable ? "Click to remove this ( ) pair" : undefined}
                        disabled={!isEditable}
                      >
                        {token.value}
                      </button>
                    )
                  }
                    return null
                  })
                })()}
              </div>

              <p className="text-xs text-gray-500 mt-2">
                {isEditable ? 'Click AND/OR to toggle. Click filters to select, then group with parentheses.' : 'View-only mode'}
              </p>
            </div>
          )}

          {/* Filter Cards */}
          <div className="space-y-2">
            {rules.map((rule) => {
              const definition = getFilterDefinition(rule.type)
              if (!definition) return null

              const Icon = definition.icon

              return (
                <div key={rule.id} className="flex items-center space-x-4 p-4 bg-white rounded-lg border-2 border-gray-200 hover:border-blue-300 hover:shadow-md transition-all">
                  <Icon className={`w-6 h-6 text-${definition.color}-500 flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 flex-wrap gap-2">
                      <Badge variant="secondary" size="md" className="font-semibold">
                        {definition.name}
                      </Badge>
                      <Badge
                        variant={rule.operator === 'excludes' ? 'destructive' : 'default'}
                        size="md"
                      >
                        {OPERATOR_LABELS[rule.operator]}
                      </Badge>
                      <span className="text-base text-gray-700 font-medium truncate">
                        {(() => {
                          // Handle array values (multi-select)
                          if (Array.isArray(rule.values)) {
                            const options = getOptionsForFilter(rule.type)
                            const labels = rule.values.map(val => {
                              const option = options.find(opt => opt.value === val)
                              return option ? option.label : val
                            })
                            return labels.length > 3
                              ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`
                              : labels.join(', ')
                          }

                          // Handle range values (objects with min/max)
                          if (typeof rule.values === 'object' && rule.values !== null) {
                            const parts = []
                            if (rule.type === 'financial_metric' && rule.values.metric) {
                              const metricLabels: Record<string, string> = {
                                market_cap: 'Market Cap',
                                price: 'Stock Price',
                                volume: 'Trading Volume',
                                pe_ratio: 'P/E Ratio',
                                dividend_yield: 'Dividend Yield'
                              }
                              parts.push(metricLabels[rule.values.metric] || rule.values.metric)
                            }
                            if (rule.values.min !== null && rule.values.min !== undefined) {
                              parts.push(`Min: ${rule.values.min}`)
                            }
                            if (rule.values.max !== null && rule.values.max !== undefined) {
                              parts.push(`Max: ${rule.values.max}`)
                            }
                            return parts.join(', ')
                          }

                          return String(rule.values)
                        })()}
                      </span>
                    </div>
                  </div>
                  {isEditable && (
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <Button
                        size="md"
                        variant="ghost"
                        onClick={() => openEditFilterModal(rule)}
                        className="hover:bg-blue-50"
                      >
                        <Edit2 className="w-5 h-5" />
                      </Button>
                      <Button
                        size="md"
                        variant="ghost"
                        onClick={() => deleteRule(rule.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Universe Overrides Section */}
      {universeOverrides.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Manual Overrides</h3>
              <p className="text-sm text-gray-500">Assets manually added or removed from this workflow</p>
            </div>
            <Badge variant="outline" size="md">
              {universeOverrides.length} {universeOverrides.length === 1 ? 'override' : 'overrides'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {universeOverrides.map((override: any) => (
              <Card key={override.id} className="p-4 hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                    {override.override_type === 'add' ? (
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <UserPlus className="w-4 h-4 text-green-600" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <UserMinus className="w-4 h-4 text-red-600" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <Link
                          to={`/assets/${override.assets.id}`}
                          className="font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate"
                        >
                          {override.assets.symbol}
                        </Link>
                        <ExternalLink className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      </div>
                      <p className="text-sm text-gray-600 truncate">{override.assets.company_name}</p>
                      <div className="flex items-center space-x-2 mt-2">
                        <Badge
                          variant={override.override_type === 'add' ? 'success' : 'destructive'}
                          size="xs"
                        >
                          {override.override_type === 'add' ? 'Manually Added' : 'Manually Removed'}
                        </Badge>
                        <span className="text-xs text-gray-500">
                          {new Date(override.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {override.notes && (
                        <p className="text-xs text-gray-500 mt-1 italic">{override.notes}</p>
                      )}
                    </div>
                  </div>
                  {isEditable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteOverrideMutation.mutate(override)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0"
                      title="Remove override"
                      disabled={deleteOverrideMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Filter Modal */}
      {showAddFilter && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingRule ? 'Edit Filter' : 'Add Filter'}
              </h3>
              <button
                onClick={() => {
                  setShowAddFilter(false)
                  resetModal()
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Step 1: Filter Type Selection */}
              {!selectedFilterType ? (
                <div>
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Filter Type
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search filters..."
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                    {filteredFilterTypes.map((filterDef) => {
                      const Icon = filterDef.icon
                      const category = FILTER_CATEGORIES.find(c => c.id === filterDef.category)
                      return (
                        <button
                          key={filterDef.id}
                          onClick={() => {
                            setSelectedFilterType(filterDef.id)
                            setCurrentOperator(filterDef.defaultOperator)
                            // Initialize values based on filter type
                            if (filterDef.valueType === 'number_range' || filterDef.valueType === 'date_range') {
                              setCurrentValues({})
                            } else if (filterDef.valueType === 'multi_select') {
                              setCurrentValues([])
                            } else {
                              setCurrentValues(null)
                            }
                          }}
                          className="text-left p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                        >
                          <div className="flex items-start space-x-2">
                            <Icon className={`w-4 h-4 text-${filterDef.color}-500 mt-0.5 flex-shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-gray-900 truncate">{filterDef.name}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{filterDef.description}</div>
                              {category && (
                                <div className="mt-1">
                                  <Badge variant="outline" size="xs">{category.name}</Badge>
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <>
                  {/* Selected Filter Info */}
                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center space-x-2">
                      {(() => {
                        const def = getFilterDefinition(selectedFilterType)
                        if (!def) return null
                        const Icon = def.icon
                        return (
                          <>
                            <Icon className={`w-5 h-5 text-${def.color}-500`} />
                            <div>
                              <div className="font-medium text-sm text-gray-900">{def.name}</div>
                              <div className="text-xs text-gray-600">{def.description}</div>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                    <button
                      onClick={() => {
                        setSelectedFilterType(null)
                        setCurrentOperator('includes')
                        setCurrentValues(null)
                        setSearchTerm('')
                      }}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Change
                    </button>
                  </div>

                  {/* Step 2: Operator Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Condition
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {getFilterDefinition(selectedFilterType)?.availableOperators.map((operator) => (
                        <button
                          key={operator}
                          onClick={() => setCurrentOperator(operator)}
                          className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                            currentOperator === operator
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {OPERATOR_LABELS[operator]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Step 3: Value Configuration */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Value
                    </label>
                    {getFilterDefinition(selectedFilterType)?.helpText && (
                      <div className="mb-3 p-2 bg-blue-50 rounded text-xs text-blue-700">
                        {getFilterDefinition(selectedFilterType)?.helpText}
                      </div>
                    )}
                    {renderValueInput(getFilterDefinition(selectedFilterType)!)}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 flex justify-between items-center flex-shrink-0">
              <div>
                {selectedFilterType && Array.isArray(currentValues) && currentValues.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSelectedOnly(!showSelectedOnly)
                      setSearchTerm('') // Clear search when toggling
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                  >
                    {showSelectedOnly ? 'Show all options' : `View ${currentValues.length} selected`}
                  </button>
                )}
              </div>
              <div className="flex space-x-2">
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
                  disabled={(() => {
                    if (!selectedFilterType || currentValues === null || currentValues === undefined) return true

                    const filterDef = getFilterDefinition(selectedFilterType)
                    if (!filterDef) return true

                    // For financial_metric, require metric selection and at least one value
                    if (selectedFilterType === 'financial_metric') {
                      if (!currentValues.metric) return true
                      return !currentValues.min && !currentValues.max
                    }

                    // For range types, require at least one value
                    if (filterDef.valueType === 'number_range' || filterDef.valueType === 'date_range') {
                      return !currentValues.min && !currentValues.max && !currentValues.start && !currentValues.end
                    }

                    // For arrays, require at least one item
                    if (Array.isArray(currentValues)) return currentValues.length === 0

                    return false
                  })()}
                >
                  {editingRule ? 'Update' : 'Add'} Filter
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <UniversePreviewModal
          workflowId={workflowId}
          rules={rules}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
